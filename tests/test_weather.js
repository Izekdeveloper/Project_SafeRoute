/**
 * test_weather.js
 * Kiểm thử mô-đun thời tiết (js/weather.js) và tích hợp sự cố thời tiết.
 *
 * Bao phủ:
 *  - Logic thuần: phân loại mưa, tầm nhìn, thang Beaufort.
 *  - Sinh payload sự cố thời tiết (deterministic, không mutate input).
 *  - Cache toạ độ (làm tròn 2 chữ số) + TTL.
 *  - Xử lý lỗi: timeout, HTTP lỗi, JSON hỏng, mất mạng -> KHÔNG throw.
 *  - injectWeatherIncidents trong js/incidents.js (upsert + reconcile).
 *
 * Chạy: node tests/test_weather.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

/* =========================================================
   THIẾT LẬP MÔI TRƯỜNG TRÌNH DUYỆT GIẢ
   ========================================================= */
const CONFIG = require(path.join(__dirname, '..', 'js', 'config.js'));

const toasts = [];
const eventLog = [];
const el = () => ({ value: '', innerHTML: '', classList: { add() {}, remove() {} } });
const els = {};
['start-input', 'end-input'].forEach(id => { els[id] = el(); });

global.window = {
  CONFIG: CONFIG.CONFIG,
  INCIDENT_DECAY_CONFIG: CONFIG.INCIDENT_DECAY_CONFIG,
  INCIDENT_TYPE_WEIGHT: CONFIG.INCIDENT_TYPE_WEIGHT,
  INCIDENT_LEVEL_WEIGHT: CONFIG.INCIDENT_LEVEL_WEIGHT,
  INCIDENT_TYPES: CONFIG.INCIDENT_TYPES,
  INCIDENT_RENDER_MODE: CONFIG.INCIDENT_RENDER_MODE,
  LEVEL_LABEL: CONFIG.LEVEL_LABEL,
  isValidCoordinate: CONFIG.isValidCoordinate,
  haversineMeters: CONFIG.haversineMeters,
  escapeHtml: CONFIG.escapeHtml,
  renderIncidents: () => { eventLog.push('renderIncidents'); },
  renderNearbyPanel: () => { eventLog.push('renderNearbyPanel'); },
  showToast: (t) => { toasts.push(t); }
};
global.window.addEventListener = () => {};
global.document = {
  hidden: false,
  readyState: 'complete',
  getElementById: (id) => els[id] || null,
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => []
};

// incidents.js chạy timer dọn dẹp định kỳ -> vô hiệu hoá cho test
global.setTimeout = () => 0;
global.clearTimeout = () => {};
global.setInterval = () => 0;

const weather = require(path.join(__dirname, '..', 'js', 'weather.js'));

/* =========================================================
   TIỆN ÍCH KIỂM THỬ
   ========================================================= */
let passed = 0, failed = 0;
const tests = [];
function test(section, name, fn) { tests.push({ section, name, fn }); }

async function runAll() {
  let cur = null;
  for (const { section, name, fn } of tests) {
    if (section !== cur) { cur = section; console.log(`\n--- ${section} ---`); }
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error('    ' + (err && err.message ? err.message : err));
      failed++;
    }
  }
  console.log('\n================================================================');
  console.log(`WEATHER MODULE: ${passed} passed, ${failed} failed`);
  console.log('================================================================');
  if (failed > 0) process.exitCode = 1;
}

const S_RAIN = 'W1. Phân loại mưa';
const S_VIS = 'W2. Phân loại tầm nhìn';
const S_WIND = 'W3. Thang Beaufort';
const S_PAYLOAD = 'W4. Sinh payload sự cố';
const S_SAMPLE = 'W5. Lấy mẫu toạ độ & chuẩn hoá API';
const S_NET = 'W6. Mạng, cache, timeout & fail-safe';
const S_INJECT = 'W7. injectWeatherIncidents (incidents.js)';

/* =========================================================
   W1. PHÂN LOẠI MƯA
   ========================================================= */
test(S_RAIN, 'classifyRain: đúng các khoảng nghiệp vụ', () => {
  assert.strictEqual(weather.classifyRain(0).category, 'none');
  assert.strictEqual(weather.classifyRain(0).needsIncident, false);

  assert.strictEqual(weather.classifyRain(1.5).category, 'light');
  assert.strictEqual(weather.classifyRain(1.5).level, 'thap');
  assert.strictEqual(weather.classifyRain(1.5).needsIncident, false, 'mưa nhỏ chưa cần sự cố');

  assert.strictEqual(weather.classifyRain(2.5).category, 'moderate');
  assert.strictEqual(weather.classifyRain(2.5).level, 'trungbinh');

  assert.strictEqual(weather.classifyRain(10).category, 'moderate', '10 mm/h chưa phải mưa lớn');
  assert.strictEqual(weather.classifyRain(10.1).category, 'heavy');
  assert.strictEqual(weather.classifyRain(10.1).level, 'cao');
});

test(S_RAIN, 'classifyRain: ngưỡng sinh sự cố là 5 mm/h', () => {
  assert.strictEqual(weather.classifyRain(4.9).needsIncident, false);
  assert.strictEqual(weather.classifyRain(5).needsIncident, true);
  assert.strictEqual(weather.classifyRain(7).needsIncident, true);
});

test(S_RAIN, 'classifyRain: dông lốc / mã bão buộc mức cao bất kể lượng mưa', () => {
  [95, 96, 99].forEach(code => {
    const r = weather.classifyRain(0, code);
    assert.strictEqual(r.isThunderstorm, true, `mã ${code} phải là dông lốc`);
    assert.strictEqual(r.category, 'heavy');
    assert.strictEqual(r.level, 'cao');
    assert.strictEqual(r.needsIncident, true);
  });
  [65, 67, 82].forEach(code => {
    const r = weather.classifyRain(0, code);
    assert.strictEqual(r.category, 'heavy', `mã ${code} = mưa lớn`);
    assert.strictEqual(r.needsIncident, true);
  });
});

test(S_RAIN, 'classifyRain: dữ liệu hỏng phải fail-safe, không sinh sự cố giả', () => {
  [null, undefined, NaN, '', false, {}, []].forEach(bad => {
    const r = weather.classifyRain(bad);
    assert.ok(r, 'phải trả về object');
    assert.strictEqual(r.needsIncident, false, `r=${bad} không được sinh sự cố`);
  });
  // Lượng mưa âm là dữ liệu bất thường -> coi như 0
  assert.strictEqual(weather.classifyRain(-5).category, 'none');
});

/* =========================================================
   W2. PHÂN LOẠI TẦM NHÌN
   ========================================================= */
test(S_VIS, 'classifyVisibility: đúng các khoảng nghiệp vụ', () => {
  assert.strictEqual(weather.classifyVisibility(20000).category, 'normal');
  assert.strictEqual(weather.classifyVisibility(20000).needsIncident, false);

  assert.strictEqual(weather.classifyVisibility(3000).category, 'limited');
  assert.strictEqual(weather.classifyVisibility(3000).needsIncident, false);

  assert.strictEqual(weather.classifyVisibility(1500).category, 'limited');
  assert.strictEqual(weather.classifyVisibility(1500).needsIncident, true, '<2000m -> sinh sự cố');

  assert.strictEqual(weather.classifyVisibility(500).category, 'danger');
  assert.strictEqual(weather.classifyVisibility(500).level, 'cao');
  assert.strictEqual(weather.classifyVisibility(500).needsIncident, true);
});

test(S_VIS, 'classifyVisibility: tầm nhìn thiếu = KHÔNG rõ, không được coi là 0m', () => {
  // Number(null) === 0: nếu không chặn, tầm nhìn thiếu sẽ bị coi là nguy hiểm tối đa
  [null, undefined, '', NaN, false, {}].forEach(bad => {
    const r = weather.classifyVisibility(bad);
    assert.strictEqual(r.category, 'unknown', `r=${String(bad)} phải là unknown`);
    assert.strictEqual(r.needsIncident, false, 'không được sinh sự cố từ dữ liệu thiếu');
    assert.strictEqual(r.meters, null);
  });
  assert.strictEqual(weather.classifyVisibility(0).needsIncident, true, '0m thật thì vẫn phải chặn');
});

/* =========================================================
   W3. THANG BEAUFORT
   ========================================================= */
test(S_WIND, 'beaufortFromSpeed: bảng ngưỡng chuẩn 0-12', () => {
  const cases = [
    [0, 0], [1, 1], [5, 1], [6, 2], [11, 2], [12, 3], [19, 3],
    [20, 4], [28, 4], [29, 5], [38, 5], [39, 6], [49, 6], [50, 7],
    [61, 7], [62, 8], [74, 8], [75, 9], [88, 9], [89, 10], [102, 10],
    [103, 11], [117, 11], [118, 12], [250, 12]
  ];
  cases.forEach(([kmh, expected]) => {
    assert.strictEqual(weather.beaufortFromSpeed(kmh).level, expected,
      `${kmh} km/h phải là cấp ${expected}`);
  });
});

test(S_WIND, 'beaufortFromSpeed: cấp 5 trở lên được coi là nguy hiểm', () => {
  assert.strictEqual(weather.beaufortFromSpeed(29).danger, true);
  assert.strictEqual(weather.beaufortFromSpeed(28).danger, false);
  assert.strictEqual(weather.beaufortFromSpeed(62).level >= 8, true);
});

test(S_WIND, 'beaufortFromSpeed: dữ liệu hỏng -> cấp 0, không nguy hiểm', () => {
  [null, undefined, NaN, '', false, {}].forEach(bad => {
    const r = weather.beaufortFromSpeed(bad);
    assert.strictEqual(r.level, 0);
    assert.strictEqual(r.danger, false, 'không được sinh cảnh báo gió từ dữ liệu thiếu');
    assert.strictEqual(r.kmh, null);
  });
  assert.strictEqual(weather.beaufortFromSpeed(-10).kmh, 0, 'gió âm -> 0');
});

test(S_WIND, 'bridgeRiskMultiplier: cầu vượt nhân rủi ro, đường thường giữ nguyên', () => {
  assert.strictEqual(weather.bridgeRiskMultiplier(false), 1);
  assert.strictEqual(weather.bridgeRiskMultiplier(undefined), 1);
  assert.ok(weather.bridgeRiskMultiplier(true) > 1, 'cầu vượt phải tăng hệ số');
  assert.strictEqual(weather.bridgeRiskMultiplier(true, 2), 3);
});

/* =========================================================
   W4. SINH PAYLOAD SỰ CỐ
   ========================================================= */
test(S_PAYLOAD, 'buildWeatherIncidentPayloads: mưa >= 5mm/h sinh weather_rain', () => {
  const p = weather.buildWeatherIncidentPayloads([
    { lat: 10.77, lng: 106.70, rain: 15, weatherCode: 65, windSpeed: 5, visibility: 20000 }
  ]);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].type, 'weather_rain');
  assert.strictEqual(p[0].level, 'cao');
  assert.strictEqual(p[0].source, 'weather_api');
  assert.ok(p[0].confidence > 0 && p[0].confidence <= 100);
  assert.ok(/mm\/h/.test(p[0].desc), `desc phải có lượng mưa: ${p[0].desc}`);
  assert.strictEqual(p[0].weather.rainMmPerHour, 15);
});

test(S_PAYLOAD, 'buildWeatherIncidentPayloads: tầm nhìn < 2000m sinh sự cố', () => {
  const p = weather.buildWeatherIncidentPayloads([
    { lat: 10.77, lng: 106.70, rain: 0, weatherCode: 45, windSpeed: 3, visibility: 400 }
  ]);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].type, 'weather_rain');
  assert.strictEqual(p[0].level, 'cao');
  assert.ok(/tầm nhìn/i.test(p[0].desc));
  assert.strictEqual(p[0].weather.visibilityMeters, 400);
});

test(S_PAYLOAD, 'buildWeatherIncidentPayloads: gió >= cấp 5 sinh weather_wind kèm giật gió', () => {
  const p = weather.buildWeatherIncidentPayloads([
    { lat: 10.77, lng: 106.70, rain: 0, weatherCode: 3, windSpeed: 55, windGust: 82, visibility: 20000 }
  ]);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].type, 'weather_wind');
  assert.strictEqual(p[0].weather.beaufort, 7);
  assert.strictEqual(p[0].weather.windGustKmh, 82);
  assert.ok(/giật 82 km\/h/.test(p[0].desc), `desc phải có tốc độ giật: ${p[0].desc}`);
  assert.ok(/cấp 7/.test(p[0].desc));
});

test(S_PAYLOAD, 'buildWeatherIncidentPayloads: mưa + gió tại cùng điểm -> 2 sự cố', () => {
  const p = weather.buildWeatherIncidentPayloads([
    { lat: 10.77, lng: 106.70, rain: 20, weatherCode: 95, windSpeed: 70, windGust: 100, visibility: 300 }
  ]);
  const types = p.map(x => x.type).sort();
  assert.deepStrictEqual(types, ['weather_rain', 'weather_wind']);
  assert.strictEqual(new Set(p.map(x => x.key)).size, 2, 'khoá phải khác nhau theo loại');
});

test(S_PAYLOAD, 'buildWeatherIncidentPayloads: không khí hết thì không sinh gì', () => {
  const p = weather.buildWeatherIncidentPayloads([
    { lat: 10.77, lng: 106.70, rain: 0, weatherCode: 1, windSpeed: 4, windGust: 8, visibility: 25000 }
  ]);
  assert.strictEqual(p.length, 0, 'trời quang -> không có sự cố thời tiết');
  assert.deepStrictEqual(weather.buildWeatherIncidentPayloads([]), []);
  assert.deepStrictEqual(weather.buildWeatherIncidentPayloads(null), []);
});

test(S_PAYLOAD, 'buildWeatherIncidentPayloads: HÀM THUẦN - không mutate & deterministic', () => {
  const samples = [{ lat: 10.77, lng: 106.70, rain: 20, weatherCode: 95, windSpeed: 70, visibility: 300 }];
  const before = JSON.stringify(samples);
  const a = weather.buildWeatherIncidentPayloads(samples);
  const b = weather.buildWeatherIncidentPayloads(samples);
  assert.strictEqual(JSON.stringify(samples), before, 'không được mutate input');
  assert.deepStrictEqual(a, b, 'cùng input phải cho cùng output');
  assert.ok(!JSON.stringify(a).match(/\d{10,}/), 'payload không được chứa timestamp');
});

test(S_PAYLOAD, 'buildWeatherIncidentPayloads: gộp mẫu trùng toạ độ chỉ sinh 1 sự cố', () => {
  const p = weather.buildWeatherIncidentPayloads([
    { lat: 10.771, lng: 106.701, rain: 20, weatherCode: 65, windSpeed: 3, visibility: 9000 },
    { lat: 10.772, lng: 106.702, rain: 22, weatherCode: 65, windSpeed: 3, visibility: 9000 }
  ]);
  assert.strictEqual(p.length, 1, 'hai mẫu trùng vùng phải gộp');
});

test(S_PAYLOAD, 'buildWeatherIncidentPayloads: cầu vượt được ghi nhận trong metadata', () => {
  const p = weather.buildWeatherIncidentPayloads([
    { lat: 10.77, lng: 106.70, rain: 0, windSpeed: 70, windGust: 90, visibility: 20000, bridge: true }
  ]);
  assert.strictEqual(p[0].weather.bridge, true);
  assert.ok(/cầu vượt/.test(p[0].desc));
  assert.ok(p[0].confidence > 70, `cầu vượt + gió mạnh phải có confidence cao, thực tế ${p[0].confidence}`);
});

test(S_PAYLOAD, 'buildWeatherIncidentPayloads: bỏ qua mẫu hỏng, không throw', () => {
  const p = weather.buildWeatherIncidentPayloads([
    null, undefined, {}, { lat: NaN, lng: 1, rain: 50 }, { lat: 5, lng: 5, rain: 50 }, 'x', 123
  ]);
  assert.strictEqual(p.length, 1, 'chỉ mẫu hợp lệ mới sinh sự cố');
  assert.strictEqual(p[0].lat, 5);
});

/* =========================================================
   W5. LẤY MẪU TOẠ ĐỘ & CHUẨN HOÁ API
   ========================================================= */
test(S_SAMPLE, 'sampleRouteCoordinates: trải đều và giới hạn số điểm', () => {
  const coords = [];
  for (let i = 0; i < 50; i++) coords.push([10 + i * 0.1, 106 + i * 0.1]);

  const s = weather.sampleRouteCoordinates(coords, 6);
  assert.strictEqual(s.length, 6);
  assert.deepStrictEqual(s[0], { lat: 10, lng: 106 }, 'phải bắt đầu từ đầu tuyến');
  assert.deepStrictEqual(s[5], { lat: 14.9, lng: 110.9 }, 'phải kết thúc ở cuối tuyến');
});

test(S_SAMPLE, 'sampleRouteCoordinates: xử lý polyline ngắn / rỗng / hỏng', () => {
  assert.strictEqual(weather.sampleRouteCoordinates([]).length, 0);
  assert.strictEqual(weather.sampleRouteCoordinates(null).length, 0);
  assert.strictEqual(weather.sampleRouteCoordinates([[10, 106]]).length, 1);
  assert.strictEqual(weather.sampleRouteCoordinates([[10, 106], [11, 107]], 6).length, 2);
  assert.strictEqual(weather.sampleRouteCoordinates([[NaN, 1], ['x', 2]]).length, 0);
});

test(S_SAMPLE, 'normalizeWeatherSample: đọc đúng trường `current` của Open-Meteo', () => {
  const json = {
    current: {
      precipitation: 12.4, rain: 10.1, showers: 2.3, weather_code: 65,
      wind_speed_10m: 45.5, wind_gusts_10m: 70.2, visibility: 900
    }
  };
  const s = weather.normalizeWeatherSample(json, 10.77, 106.70);
  assert.strictEqual(s.rain, 10.1);
  assert.strictEqual(s.weatherCode, 65);
  assert.strictEqual(s.windSpeed, 45.5);
  assert.strictEqual(s.windGust, 70.2);
  assert.strictEqual(s.visibility, 900);
  assert.strictEqual(s.lat, 10.77);
});

test(S_SAMPLE, 'normalizeWeatherSample: JSON hỏng -> null', () => {
  assert.strictEqual(weather.normalizeWeatherSample(null, 1, 2), null);
  assert.strictEqual(weather.normalizeWeatherSample({}, 1, 2), null);
  assert.strictEqual(weather.normalizeWeatherSample({ current: null }, 1, 2), null);
  assert.strictEqual(weather.normalizeWeatherSample({ current: { rain: null } }, 1, 2).rain, null);
});

test(S_SAMPLE, 'weatherCacheKey: làm tròn 2 chữ số để gộp request', () => {
  assert.strictEqual(weather.weatherCacheKey(10.7712, 106.7011), '10.77,106.70');
  assert.strictEqual(weather.weatherCacheKey(10.7712, 106.7011), weather.weatherCacheKey(10.7749, 106.7049),
    'các toạ độ trong ~1.1km phải dùng chung khoá');
  assert.strictEqual(weather.weatherCacheKey(NaN, 1), null);
  assert.strictEqual(weather.weatherCacheKey(200, 1), null, 'toạ độ ngoài phạm vi');
});

test(S_SAMPLE, 'sampleBoundingBox: chấp nhận getBounds() hoặc object thuần', () => {
  const viaFn = weather.sampleBoundingBox({ getBounds: () => ({ north: 11, south: 10, east: 107, west: 106 }) }, 4);
  assert.strictEqual(viaFn.length, 4);
  const plain = weather.sampleBoundingBox({ north: 11, south: 10, east: 107, west: 106 }, 4);
  assert.strictEqual(plain.length, 4);
  assert.strictEqual(weather.sampleBoundingBox(null).length, 0);
  assert.strictEqual(weather.sampleBoundingBox({ getBounds: () => { throw new Error('x'); } }).length, 0);
});

/* =========================================================
   W6. MẠNG, CACHE, TIMEOUT & FAIL-SAFE
   ========================================================= */
const S_NET_FETCH = 'W6. Mạng, cache, timeout & fail-safe';

function stubFetch(handler) {
  global.fetch = handler;
}

test(S_NET_FETCH, 'fetchWeatherSample: thành công thì trả mẫu đã chuẩn hoá', async () => {
  weather.clearWeatherCache();
  stubFetch(async () => ({
    ok: true,
    json: async () => ({ current: { rain: 3, weather_code: 61, wind_speed_10m: 10, visibility: 12000 } })
  }));
  const s = await weather.fetchWeatherSample(10.77, 106.70, { forceRefresh: true });
  assert.ok(s);
  assert.strictEqual(s.rain, 3);
  assert.strictEqual(s.weatherCode, 61);
  stubFetch(async () => { throw new Error('không được gọi lại khi đã cache'); });
  const cached = await weather.fetchWeatherSample(10.77, 106.70);
  assert.strictEqual(cached.rain, 3, 'phải dùng cache, không gọi mạng lần 2');
});

test(S_NET_FETCH, 'fetchWeatherSample: dùng chung cache cho toạ độ gần nhau', async () => {
  weather.clearWeatherCache();
  let calls = 0;
  stubFetch(async () => {
    calls++;
    return { ok: true, json: async () => ({ current: { rain: 1, weather_code: 3 } }) };
  });
  await weather.fetchWeatherSample(10.771, 106.701);
  await weather.fetchWeatherSample(10.774, 106.704);
  assert.strictEqual(calls, 1, 'hai toạ độ ~300m phải chung 1 request');
});

test(S_NET_FETCH, 'fetchWeatherSample: HTTP lỗi / JSON hỏng / mất mạng -> null, KHÔNG throw', async () => {
  weather.clearWeatherCache();
  stubFetch(async () => ({ ok: false, status: 500 }));
  assert.strictEqual(await weather.fetchWeatherSample(10.77, 106.70, { forceRefresh: true }), null);

  stubFetch(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }));
  assert.strictEqual(await weather.fetchWeatherSample(10.78, 106.70, { forceRefresh: true }), null);

  stubFetch(async () => { throw new TypeError('Failed to fetch'); });
  assert.strictEqual(await weather.fetchWeatherSample(10.79, 106.70, { forceRefresh: true }), null);

  stubFetch(async () => ({ ok: true, json: async () => ({}) }));
  assert.strictEqual(await weather.fetchWeatherSample(10.80, 106.70, { forceRefresh: true }), null);
});

test(S_NET_FETCH, 'fetchWeatherSample: toạ độ không hợp lệ -> null, không gọi mạng', async () => {
  let calls = 0;
  stubFetch(async () => { calls++; return { ok: true, json: async () => ({ current: { rain: 1 } }) }; });
  assert.strictEqual(await weather.fetchWeatherSample(NaN, 106.7), null);
  assert.strictEqual(await weather.fetchWeatherSample(999, 106.7), null);
  assert.strictEqual(calls, 0);
});

test(S_NET_FETCH, 'fetchWeatherSamples: gộp trùng + đếm đúng success/failure', async () => {
  weather.clearWeatherCache();
  stubFetch(async (url) => {
    if (String(url).includes('longitude=107.9')) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ current: { rain: 2, weather_code: 3 } }) };
  });
  const res = await weather.fetchWeatherSamples([
    [10.771, 106.701], [10.772, 106.702], [10.774, 106.704], [10.900, 107.900], [NaN, 1]
  ]);
  assert.strictEqual(res.successCount, 1, '3 toạ độ trùng + 1 toạ độ hỏng -> gộp thành 1 request');
  assert.strictEqual(res.failureCount, 1);
  assert.strictEqual(res.ok, true);
});

test(S_NET_FETCH, 'refreshWeatherForPoints: mất mạng -> giữ nguyên sự cố cũ (không inject)', async () => {
  weather.clearWeatherCache();
  stubFetch(async () => { throw new Error('offline'); });
  let injected = null;
  window.injectWeatherIncidents = (p) => { injected = p; return { injected: 0, updated: 0, removed: 0 }; };

  const res = await weather.refreshWeatherForPoints([{ lat: 10.77, lng: 106.70 }]);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(injected, null, 'không được gọi inject khi không có dữ liệu nào');
  delete window.injectWeatherIncidents;
});

test(S_NET_FETCH, 'refreshWeatherForPoints: có dữ liệu -> inject đúng payload', async () => {
  weather.clearWeatherCache();
  stubFetch(async () => ({
    ok: true,
    json: async () => ({ current: { rain: 30, weather_code: 95, wind_speed_10m: 80, wind_gusts_10m: 110, visibility: 200 } })
  }));
  let received = null;
  window.injectWeatherIncidents = (p) => { received = p; return { injected: p.length, updated: 0, removed: 0 }; };

  const res = await weather.refreshWeatherForPoints([{ lat: 10.77, lng: 106.70 }]);
  assert.strictEqual(res.ok, true);
  assert.ok(received && received.length >= 1, 'phải truyền payload cho incidents.js');
  assert.ok(received.some(x => x.type === 'weather_rain'));
  assert.ok(received.some(x => x.type === 'weather_wind'));
  delete window.injectWeatherIncidents;
});

test(S_NET_FETCH, 'refreshWeatherForRoute: lấy mẫu dọc polyline rồi mới gọi API', async () => {
  weather.clearWeatherCache();
  let calls = 0;
  stubFetch(async () => { calls++; return { ok: true, json: async () => ({ current: { rain: 1, weather_code: 3 } }) }; });
  const coords = [];
  for (let i = 0; i < 100; i++) coords.push([10 + i * 0.05, 106 + i * 0.05]);
  await weather.refreshWeatherForRoute(coords, { maxSamples: 5 });
  assert.ok(calls > 0 && calls <= 5, `phải gọi tối đa 5 request, thực tế ${calls}`);
});

/* =========================================================
   W7. injectWeatherIncidents (js/incidents.js)
   ========================================================= */
const S_INJECT2 = 'W7. injectWeatherIncidents (incidents.js)';

let injectWeatherIncidents = null;
let incidentsModule = null;

function currentIncidents() {
  return (typeof window !== 'undefined' && window.incidents) ? window.incidents : [];
}

test(S_INJECT2, 'injectWeatherIncidents tồn tại và xuất ra window + module.exports', () => {
  incidentsModule = require(path.join(__dirname, '..', 'js', 'incidents.js'));
  injectWeatherIncidents = window.injectWeatherIncidents || incidentsModule.injectWeatherIncidents;
  assert.strictEqual(typeof injectWeatherIncidents, 'function',
    'thiếu injectWeatherIncidents (window hoặc module.exports)');
});

test(S_INJECT2, 'injectWeatherIncidents: tạo sự cố với đầy đủ trường bắt buộc', () => {
  const payload = {
    key: 'weather_rain-10.77_106.70',
    type: 'weather_rain', level: 'cao', lat: 10.77, lng: 106.70,
    desc: 'Mưa lớn (20.0 mm/h)', confidence: 80, source: 'weather_api',
    weather: { rainMmPerHour: 20, visibilityMeters: 500, windSpeedKmh: 30, windGustKmh: 50, beaufort: 4, weatherCode: 65, bridge: false }
  };
  const s = injectWeatherIncidents([payload]);
  assert.strictEqual(s.injected, 1);

  const inc = currentIncidents().find(i => i._weatherKey === payload.key);
  assert.ok(inc, 'phải có sự cố trong danh sách chung');
  assert.strictEqual(inc.type, 'weather_rain');
  assert.strictEqual(inc.level, 'cao');
  assert.strictEqual(inc.lat, 10.77);
  assert.strictEqual(inc.source, 'weather_api');
  assert.ok(Array.isArray(inc.nodes) && inc.nodes.length >= 1, 'phải có nodes');
  assert.ok(inc.createdAt > 0, 'phải có createdAt');
  assert.ok(inc.weather && inc.weather.rainMmPerHour === 20, 'phải giữ metadata weather');
});

test(S_INJECT2, 'injectWeatherIncidents: gọi 2 lần cùng key -> cập nhật, KHÔNG nhân bản', () => {
  const key = 'weather_rain-10.77_106.70';
  const before = currentIncidents().filter(i => i._weatherKey === key).length;
  const s = injectWeatherIncidents([{
    key, type: 'weather_rain', level: 'trungbinh', lat: 10.77, lng: 106.70,
    desc: 'Mưa vừa', confidence: 55, source: 'weather_api',
    weather: { rainMmPerHour: 6, visibilityMeters: 3000, windSpeedKmh: 10, windGustKmh: 20, beaufort: 2, weatherCode: 61, bridge: false }
  }]);
  const list = currentIncidents().filter(i => i._weatherKey === key);
  assert.strictEqual(list.length, 1, 'không được nhân bản sự cố');
  assert.strictEqual(list.length, before, 'tổng số sự cố không đổi');
  assert.ok(s.updated >= 1 || s.injected >= 1);
  assert.strictEqual(list[0].level, 'trungbinh', 'level phải được cập nhật');
  assert.strictEqual(list[0].weather.rainMmPerHour, 6);
});

test(S_INJECT2, 'injectWeatherIncidents: thời tiết hết -> xoá đúng sự cố cũ, giữ sự cố khác', () => {
  // Thêm một sự cố "thường" để chắc chắn không bị xoá nhầm
  const markerId = 'incident-user-test-1';
  const arr = currentIncidents();
  arr.push({
    id: markerId, type: 'accident', level: 'cao', lat: 10.9, lng: 106.9,
    desc: 'TNGT', confidence: 90, nodes: [{ lat: 10.9, lng: 106.9 }], createdAt: Date.now()
  });

  injectWeatherIncidents([]);
  const arr2 = currentIncidents();
  assert.ok(arr2.some(i => i.id === markerId), 'sự cố của người dùng phải được giữ nguyên');
  assert.ok(!arr2.some(i => i._weatherKey === 'weather_rain-10.77_106.70'),
    'sự cố thời tiết cũ phải bị gỡ khi không còn dữ liệu');

  arr.splice(arr.indexOf(arr.find(i => i.id === markerId)), 1);
});

test(S_INJECT2, 'injectWeatherIncidents: payload hỏng bị bỏ qua, không throw', () => {
  assert.doesNotThrow(() => injectWeatherIncidents([
    null, undefined, {}, { key: 'x' },
    { key: 'k1', type: 'weather_rain', level: 'cao', lat: NaN, lng: 1, desc: '', confidence: 50 }
  ]));
  assert.ok(!currentIncidents().some(i => i._weatherKey === 'k1'), 'toạ độ NaN phải bị bỏ qua');
});

test(S_INJECT2, 'injectWeatherIncidents: không phát sự kiện khi không có thay đổi', () => {
  eventLog.length = 0;
  injectWeatherIncidents([]);
  assert.strictEqual(eventLog.length, 0, 'không có thay đổi thì không render lại');

  eventLog.length = 0;
  injectWeatherIncidents([{
    key: 'weather_wind-11.00_107.00', type: 'weather_wind', level: 'cao',
    lat: 11.0, lng: 107.0, desc: 'Gió cấp 9', confidence: 90, source: 'weather_api',
    weather: { rainMmPerHour: 0, visibilityMeters: 9000, windSpeedKmh: 95, windGustKmh: 120, beaufort: 9, weatherCode: 3, bridge: true }
  }]);
  assert.ok(eventLog.includes('renderIncidents'), 'có thay đổi thì phải render lại bản đồ');
  assert.ok(eventLog.includes('renderNearbyPanel'), 'phải cập nhật panel gần bạn');
});

runAll();