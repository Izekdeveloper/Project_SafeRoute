/**
 * test_weather_render.js
 * Kiểm thử phần HIỂN THỊ sự cố thời tiết trong js/map.js:
 *  - _buildWeatherMetricRows / _wxNum định dạng chỉ số.
 *  - _buildWeatherIncidentLayer sinh đúng 2 lớp: circleMarker + divIcon.
 *  - Nhãn trực quan trên bản đồ: cấp gió (Beaufort) cho gió, mm/h cho mưa.
 *  - Popup sự cố thời tiết KHÔNG có nút xác nhận/bình chọn.
 *  - Nhánh thời tiết trong _buildIncidentLayer không rơi vào nhánh vote của user.
 *
 * Chạy: node tests/test_weather_render.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

/* =========================================================
   STUB LEAFLET TỐI THIỂU
   ========================================================= */
// Ghi lại mọi layer được thêm vào group để assert.
let added = [];
function _mkLayer(latlng, opts) {
  return {
    latlng, opts,
    _tooltip: null, _popup: null, _events: {},
    // Leaflet thật: addTo trả về chính layer này (không phải group)
    addTo(group) { group.addLayer(this); return this; },
    bindTooltip(html, o) { this._tooltip = { html, opts: o }; return this; },
    bindPopup(html) { this._popup = html; return this; },
    on(ev, fn) { this._events[ev] = fn; return this; },
    setStyle() { return this; },
    setLatLng() { return this; }
  };
}
global.L = {
  layerGroup: () => ({ addLayer(l) { added.push(l); return this; }, clearLayers() { return this; } }),
  circleMarker: _mkLayer,
  marker: _mkLayer,
  divIcon: (o) => ({ __isDivIcon: true, ...o }),
  map: () => null
};

const CONFIG = require(path.join(__dirname, '..', 'js', 'config.js'));
global.window = {
  CONFIG: CONFIG.CONFIG,
  INCIDENT_TYPES: CONFIG.INCIDENT_TYPES,
  LEVEL_LABEL: CONFIG.LEVEL_LABEL,
  INCIDENT_RENDER_MODE: CONFIG.INCIDENT_RENDER_MODE,
  escapeHtml: CONFIG.escapeHtml,
  getConfidenceColor: () => 'var(--risk-mid)',
  formatDateTime: () => 'dd/mm',
  formatRelativeTime: () => 'vừa xong'
};
const mapjs = require(path.join(__dirname, '..', 'js', 'map.js'));

/* =========================================================
   TIỆN ÍCH
   ========================================================= */
let passed = 0, failed = 0;
const tests = [];
function test(section, name, fn) { tests.push({ section, name, fn }); }

function buildWeather(inc) {
  added = [];
  const group = mapjs._buildWeatherIncidentLayer(inc, 80);
  return { group, layers: added.slice() };
}
function iconOf(layers) { return layers.find(l => l.opts && l.opts.icon && l.opts.icon.__isDivIcon); }
function circleOf(layers) { return layers.find(l => l.opts && typeof l.opts.radius === 'number'); }
function labelOf(layers) {
  const icon = iconOf(layers);
  if (!icon) return null;
  const m = icon.opts.icon.html.match(/incident-badge-count[^>]*>([^<]*)</);
  return m ? m[1].trim() : null;
}

const WX_RAIN = (over) => Object.assign({
  id: 'wx-rain-1', source: 'weather_api', type: 'weather_rain', level: 'cao',
  lat: 10.77, lng: 106.70, desc: 'Mưa lớn', confidence: 85,
  weather: { rainMmPerHour: 12.5, visibilityMeters: 600, windSpeedKmh: 20, windGustKmh: 30, beaufort: 3, weatherCode: 65, bridge: false }
}, over || {});
const WX_WIND = (over) => Object.assign({
  id: 'wx-wind-1', source: 'weather_api', type: 'weather_wind', level: 'cao',
  lat: 10.80, lng: 106.75, desc: 'Gió mạnh', confidence: 90,
  weather: { rainMmPerHour: 0, visibilityMeters: 9000, windSpeedKmh: 95, windGustKmh: 120, beaufort: 9, weatherCode: 3, bridge: true }
}, over || {});

const S_FMT = 'R1. Định dạng chỉ số';
const S_LAYER = 'R2. Lớp hiển thị & nhãn trực quan';
const S_POPUP = 'R3. Popup sự cố thời tiết';
const S_DISPATCH = 'R4. Phân nhánh weather vs user incident';
const S_EDGE = 'R5. Dữ liệu hỏng / thiếu';

/* =========================================================
   R1
   ========================================================= */
test(S_FMT, '_wxNum: định dạng 1 chữ số thập phân, hỏng -> em dash', () => {
  assert.strictEqual(mapjs._wxNum(12.34), '12.3');
  assert.strictEqual(mapjs._wxNum(0), '0');
  assert.strictEqual(mapjs._wxNum(null), '—');
  assert.strictEqual(mapjs._wxNum(undefined), '—');
  assert.strictEqual(mapjs._wxNum(NaN), '—');
  assert.strictEqual(mapjs._wxNum('abc'), '—');
});

test(S_FMT, '_buildWeatherMetricRows: có tầm nhìn, chi tiết gió, chỉ số hỏng thì bỏ', () => {
  const rows = mapjs._buildWeatherMetricRows(WX_RAIN());
  const labels = rows.map(r => r.label);
  assert.ok(labels.includes('Lượng mưa'), 'phải có dòng lượng mưa');
  assert.ok(labels.includes('Tầm nhìn'), 'phải có dòng tầm nhìn');
  assert.ok(rows.every(r => r.value && !/NaN|undefined|null/.test(r.value)), 'không lộ NaN/undefined');

  // Dòng gió hiện khi type là weather_wind HOẶC Beaufort >= 5
  assert.ok(mapjs._buildWeatherMetricRows(WX_WIND()).some(r => r.label === 'Gió'), 'gió phải hiện khi type=weather_wind');
  assert.ok(mapjs._buildWeatherMetricRows(
    WX_RAIN({ weather: { rainMmPerHour: 1, visibilityMeters: 9000, beaufort: 6, windSpeedKmh: 40, windGustKmh: 55 } })
  ).some(r => r.label === 'Gió'), 'gió phải hiện khi Beaufort >= 5 dù type là mưa');
  assert.ok(!mapjs._buildWeatherMetricRows(
    WX_RAIN({ weather: { rainMmPerHour: 1, visibilityMeters: 9000, beaufort: 3, windSpeedKmh: 12, windGustKmh: 18 } })
  ).some(r => r.label === 'Gió'), 'gió nhẹ thì không cần dòng gió');

  // bridge chỉ hiện khi === true (payload cũ có undefined)
  assert.ok(mapjs._buildWeatherMetricRows(WX_WIND()).some(r => r.label === 'Vị trí'), 'bridge=true phải hiện');
  assert.ok(!mapjs._buildWeatherMetricRows(WX_WIND({ weather: { beaufort: 7, bridge: undefined } }))
    .some(r => r.label === 'Vị trí'), 'bridge undefined không được hiện');

  // Không có chỉ số nào -> vẫn trả về dòng thay thế, không rỗng
  const empty = mapjs._buildWeatherMetricRows({ id: 'wx', type: 'weather_rain' });
  assert.strictEqual(empty.length, 1, 'phải có dòng báo chưa có chỉ số');
});

/* =========================================================
   R2
   ========================================================= */
test(S_LAYER, 'gió: sinh circleMarker + divIcon, nhãn hiển thị CẤP GIÓ', () => {
  const { layers } = buildWeather(WX_WIND());
  assert.ok(circleOf(layers), 'phải có circleMarker nền');
  assert.ok(iconOf(layers), 'phải có divIcon hiển thị biểu tượng');
  assert.strictEqual(labelOf(layers), 'Cấp 9', 'nhãn phải là cấp Beaufort');
  assert.ok(/💨/.test(iconOf(layers).opts.icon.html), 'phải có biểu tượng gió');
});

test(S_LAYER, 'mưa: nhãn hiển thị LƯỢNG MƯA mm/h', () => {
  const { layers } = buildWeather(WX_RAIN());
  assert.strictEqual(labelOf(layers), '12.5 mm/h');
  assert.ok(/🌧/.test(iconOf(layers).opts.icon.html), 'phải có biểu tượng mây mưa');
});

test(S_LAYER, 'màu phân biệt theo LOẠI sự cố (mưa xanh dương đậm, gió khác)', () => {
  const rainColor = circleOf(buildWeather(WX_RAIN()).layers).opts.fillColor;
  const windColor = circleOf(buildWeather(WX_WIND()).layers).opts.fillColor;
  assert.notStrictEqual(rainColor, windColor, 'mưa và gió phải khác màu để phân biệt nhanh');
  assert.strictEqual(rainColor, CONFIG.INCIDENT_TYPES.weather_rain.color, 'mưa dùng màu cấu hình');
  // Cấp độ được phản ánh qua bán kính + màu badge, không phải màu chấm nền
  assert.strictEqual(circleOf(buildWeather(WX_RAIN({ level: 'thap' })).layers).opts.fillColor, rainColor,
    'cùng loại thì cùng màu nền, phân cấp bằng kích thước');
});

test(S_LAYER, 'bán kính chấm toạ độ lớn hơn khi nghiêm trọng hơn', () => {
  const thap = circleOf(buildWeather(WX_RAIN({ level: 'thap' })).layers).opts.radius;
  const cao = circleOf(buildWeather(WX_RAIN({ level: 'cao' })).layers).opts.radius;
  assert.ok(cao > thap, 'cấp cao phải to hơn cấp thấp');
});

test(S_LAYER, 'icon có tooltip dán (sticky) và neo đúng vị trí', () => {
  const { layers } = buildWeather(WX_WIND());
  const icon = iconOf(layers);
  assert.ok(icon._tooltip, 'icon phải có tooltip');
  assert.strictEqual(icon._tooltip.opts.sticky, true, 'tooltip phải sticky');
  assert.deepStrictEqual(icon.latlng, [10.80, 106.75], 'icon phải đặt đúng toạ độ sự cố');
  assert.strictEqual(icon.opts.zIndexOffset, 500, 'icon không được che marker điểm đầu/điểm đến');
});

/* =========================================================
   R3
   ========================================================= */
test(S_POPUP, 'popup thời tiết KHÔNG có nút xác nhận/bình chọn của user', () => {
  const layers = buildWeather(WX_WIND()).layers;
  const popups = layers.map(l => l._popup).filter(Boolean);
  assert.ok(popups.length > 0, 'phải có popup');
  popups.forEach(p => {
    assert.ok(!/data-incident-action/.test(p), 'popup thời tiết không được chứa nút hành động của user');
    assert.ok(!/data-action=/.test(p), 'không được chứa data-action');
  });
});

test(S_POPUP, 'popup thời tiết ghi rõ tên loại + nguồn Open-Meteo + ghi chú không cần xác nhận', () => {
  const p = buildWeather(WX_WIND()).layers.map(l => l._popup).find(Boolean);
  assert.ok(/Gió/i.test(p), 'phải hiện loại sự cố');
  assert.ok(/Open-Meteo/i.test(p), 'phải ghi rõ nguồn dữ liệu khách quan');
  assert.ok(/không cần người dùng xác nhận/i.test(p), 'phải giải thích vì sao không có nút xác nhận');
});

test(S_POPUP, 'mở popup thời tiết đánh dấu đúng id để khóa vote logic', () => {
  const inc = WX_WIND();
  const { layers } = buildWeather(inc);
  layers.forEach(l => {
    if (l._events && l._events.popupopen) l._events.popupopen();
  });
  assert.strictEqual(mapjs.getPopupOpenIncidentId(), inc.id);
  layers.forEach(l => {
    if (l._events && l._events.popupclose) l._events.popupclose();
  });
  assert.strictEqual(mapjs.getPopupOpenIncidentId(), null);
});

/* =========================================================
   R4
   ========================================================= */
test(S_DISPATCH, 'source=weather_api đi vào nhánh thời tiết', () => {
  added = [];
  mapjs._buildIncidentLayer(WX_WIND(), 80);
  const popups = added.map(l => l._popup).filter(Boolean);
  assert.ok(popups.length > 0);
  popups.forEach(p => assert.ok(!/data-incident-action/.test(p), 'không rơi vào nhánh vote'));
});

test(S_DISPATCH, 'mất field source nhưng còn tiền tố id wx- vẫn là nhánh thời tiết', () => {
  const inc = WX_WIND(); delete inc.source;
  added = [];
  mapjs._buildIncidentLayer(inc, 80);
  const popups = added.map(l => l._popup).filter(Boolean);
  popups.forEach(p => assert.ok(!/data-incident-action/.test(p), 'vẫn phải là nhánh thời tiết'));
});

test(S_DISPATCH, 'type=weather_* vẫn là nhánh thời tiết dù không có source/id wx-', () => {
  const inc = WX_RAIN(); delete inc.source; inc.id = 'plain-id';
  added = [];
  mapjs._buildIncidentLayer(inc, 80);
  added.map(l => l._popup).filter(Boolean)
    .forEach(p => assert.ok(!/data-incident-action/.test(p), 'type thời tiết phải thắng'));
});

test(S_DISPATCH, 'sự cố người dùng GIỮ nguyên logic cũ, có nút xác nhận', () => {
  added = [];
  mapjs._buildIncidentLayer({
    id: 'u-1', type: 'accident', level: 'cao', lat: 10.9, lng: 106.9,
    desc: 'Tai nạn', confidence: 80, nodes: [{ lat: 10.9, lng: 106.9 }], createdAt: Date.now()
  }, 80);
  const popups = added.map(l => l._popup).filter(Boolean);
  assert.ok(popups.length > 0, 'phải tạo popup cho sự cố user');
  assert.ok(popups.some(p => /data-incident-action/.test(p)), 'sự cố user phải có nút xác nhận như trước');
});

test(S_DISPATCH, 'id chứa "wx-" ở giữa KHÔNG bị co là thời tiết', () => {
  const inc = { id: 'user-wx-note', type: 'accident', level: 'cao', lat: 10.9, lng: 106.9, desc: 'x', nodes: [{ lat: 10.9, lng: 106.9 }] };
  added = [];
  mapjs._buildIncidentLayer(inc, 80);
  const popups = added.map(l => l._popup).filter(Boolean);
  assert.ok(popups.some(p => /data-incident-action/.test(p)), 'chỉ tiền tố wx- mới tính là thời tiết');
});

/* =========================================================
   R5
   ========================================================= */
test(S_EDGE, 'thiếu hoàn toàn weather metrics vẫn render được, không throw', () => {
  assert.doesNotThrow(() => {
    const { layers } = buildWeather({ id: 'wx-x', source: 'weather_api', type: 'weather_rain', level: 'thap', lat: 1, lng: 2, desc: '' });
    assert.ok(circleOf(layers), 'vẫn phải có chấm nền');
    assert.strictEqual(labelOf(layers), null, 'không có số liệu thì không gắn nhãn sai');
  });
});

test(S_EDGE, 'metrics null / chuỗi / NaN không sinh nhãn sai', () => {
  [
    { rainMmPerHour: null, beaufort: null },
    { rainMmPerHour: 'abc', beaufort: 'xyz' },
    { rainMmPerHour: NaN, beaufort: NaN },
    { rainMmPerHour: 0, beaufort: 0 }
  ].forEach(w => {
    const inc = { id: 'wx-y', source: 'weather_api', type: 'weather_rain', level: 'thap', lat: 1, lng: 2, desc: '', weather: w };
    const { layers } = buildWeather(inc);
    const lbl = labelOf(layers);
    assert.ok(lbl === null || /mm\/h$/.test(lbl), `nhãn không hợp lệ cho ${JSON.stringify(w)}: ${lbl}`);
    assert.ok(lbl === null || !/NaN|undefined|null/.test(lbl), 'không được lộ NaN/undefined ra UI');
  });
});

test(S_EDGE, 'weather là null/undefined không làm vỡ hàm', () => {
  [null, undefined, 'x', 0].forEach(w => {
    assert.doesNotThrow(() => buildWeather({ id: 'wx-z', source: 'weather_api', type: 'weather_rain', level: 'thap', lat: 1, lng: 2, desc: '', weather: w }), `weather=${String(w)}`);
  });
});

test(S_EDGE, 'desc chứa HTML bị escape trong popup và tooltip', () => {
  const inc = WX_WIND({ desc: '<img src=x onerror=alert(1)>' });
  const { layers } = buildWeather(inc);
  layers.forEach(l => {
    if (l._popup) assert.ok(!/<img src=x/.test(l._popup), 'popup phải escape HTML');
    if (l._tooltip) assert.ok(!/<img src=x/.test(l._tooltip.html), 'tooltip phải escape HTML');
  });
  const icon = iconOf(layers);
  assert.ok(!/<img src=x/.test(icon.opts.icon.html), 'nhãn trên bản đồ phải escape HTML');
});

test(S_EDGE, 'môi trường thiếu divIcon vẫn vẽ được bằng circleMarker', () => {
  const saved = global.L.divIcon, savedMarker = global.L.marker;
  global.L.divIcon = undefined; global.L.marker = undefined;
  try {
    const { layers } = buildWeather(WX_WIND());
    assert.ok(circleOf(layers), 'phải fallback về circleMarker');
  } finally {
    global.L.divIcon = saved; global.L.marker = savedMarker;
  }
});

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
  console.log(`WEATHER RENDER: ${passed} passed, ${failed} failed`);
  console.log('================================================================');
  if (failed > 0) process.exitCode = 1;
}

runAll();
