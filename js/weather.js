/**
 * ============================================================================
 * SafeRoute Research Project: Weather Integration Module (Open-Meteo)
 * File: js/weather.js
 *
 * Mục đích nghiên cứu:
 * Lấy dữ liệu thời tiết thời gian thực (Open-Meteo, không cần API key) dọc theo
 * tuyến đường / vùng đang hiển thị, đánh giá rủi ro khí tượng (mưa, tầm nhìn, gió
 * theo thang Beaufort) và sinh ra các "payload sự cố thời tiết" đưa vào hệ thống
 * tính điểm rủi ro và thuật toán định tuyến hiện có.
 *
 * Nguyên tắc thiết kế:
 * 1. Tách bạch "thu thập dữ liệu" (network) và "quyết định rủi ro" (logic thuần).
 *    Các hàm phân loại là hàm thuần (pure) -> test tuyệt đối, không mạng, không thời gian.
 * 2. Không để lỗi mạng / timeout làm hỏng ứng dụng: mọi lỗi bị nuốt, trả về giá trị an toàn.
 * 3. Không phụ thuộc Leaflet / DOM: module chỉ làm việc với toạ độ và số liệu.
 * 4. Không mutate đầu vào.
 * ============================================================================
 */

const _weatherConfig = (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.weather)
  ? window.CONFIG.weather
  : ((typeof CONFIG !== 'undefined' && CONFIG.weather) ? CONFIG.weather : {});

const _weatherIsValidCoord = (typeof window !== 'undefined' && window.isValidCoordinate)
  ? window.isValidCoordinate
  : ((typeof isValidCoordinate === 'function') ? isValidCoordinate
    : (lat, lng) => Number.isFinite(+lat) && Number.isFinite(+lng) && +lat >= -90 && +lat <= 90 && +lng >= -180 && +lng <= 180);

const _WEATHER_API_URL = _weatherConfig.api_url || 'https://api.open-meteo.com/v1/forecast';
const _WEATHER_TIMEOUT_MS = _weatherConfig.timeout_ms || 6000;
const _WEATHER_CACHE_TTL_MS = _weatherConfig.cache_ttl_ms || 1200000;      // 20 phút
const _WEATHER_CACHE_MAX = _weatherConfig.cache_max_entries || 120;
const _WEATHER_ROUND_DECIMALS = (_weatherConfig.coord_round_decimals != null)
  ? _weatherConfig.coord_round_decimals : 2;
const _WEATHER_MAX_SAMPLES = _weatherConfig.max_samples_per_route || 6;
const _WEATHER_MAX_CONCURRENT = _weatherConfig.max_concurrent_requests || 3;
const _WEATHER_THUNDERSTORM_CODES = _weatherConfig.thunderstorm_codes || [95, 96, 99];
const _WEATHER_HEAVY_RAIN_CODES = _weatherConfig.heavy_rain_codes || [65, 67, 82];

const _pick = (obj, key, fallback) => (obj && obj[key] != null) ? obj[key] : fallback;

const _RAIN_LIGHT_MAX = _pick(_weatherConfig.rain, 'light_max', 2.5);
const _RAIN_MODERATE_MAX = _pick(_weatherConfig.rain, 'moderate_max', 10);
const _RAIN_INCIDENT_THRESHOLD = _pick(_weatherConfig.rain, 'incident_threshold', 5);
const _RAIN_CONFIDENCE_BASE = _pick(_weatherConfig.rain, 'confidence_base', 55);

const _VIS_DANGER_M = _pick(_weatherConfig.visibility, 'danger_m', 1000);
const _VIS_LIMITED_M = _pick(_weatherConfig.visibility, 'limited_m', 5000);
const _VIS_INCIDENT_THRESHOLD_M = _pick(_weatherConfig.visibility, 'incident_threshold_m', 2000);
const _VIS_CONFIDENCE_BASE = _pick(_weatherConfig.visibility, 'confidence_base', 60);

const _WIND_INCIDENT_BEAUFORT = _pick(_weatherConfig.wind, 'incident_beaufort', 5);
const _WIND_CONFIDENCE_BASE = _pick(_weatherConfig.wind, 'confidence_base', 50);
const _WIND_BRIDGE_BOOST = _pick(_weatherConfig.wind, 'bridge_boost', 1.5);

const _WEATHER_ENABLED = _weatherConfig.enabled !== false;

/* ---------------------------------------------------------------
   1. BỘ NHỚ ĐỆM TOẠ ĐỘ (TTL + LRU đơn giản)
   --------------------------------------------------------------- */

/** @type {Map<string, {at: number, sample: object}>} Cache thời tiết theo toạ độ đã làm tròn. */
const _weatherCache = new Map();

/**
 * Tạo khoá cache từ toạ độ đã làm tròn 2 chữ số thập phân (~1.1km),
 * giúp gộp nhiều điểm gần nhau thành một request.
 *
 * @param {number} lat - Vĩ độ.
 * @param {number} lng - Kinh độ.
 * @returns {string|null} Khoá cache, hoặc null nếu toạ độ không hợp lệ.
 */
function weatherCacheKey(lat, lng) {
  if (!_weatherIsValidCoord(lat, lng)) return null;
  const f = Math.pow(10, _WEATHER_ROUND_DECIMALS);
  const rl = Math.round(+lat * f) / f;
  const rn = Math.round(+lng * f) / f;
  return `${rl.toFixed(_WEATHER_ROUND_DECIMALS)},${rn.toFixed(_WEATHER_ROUND_DECIMALS)}`;
}

/**
 * Đọc cache còn hiệu lực, tự xoá entry hết hạn.
 * @param {string} key - Khoá cache.
 * @param {number} [now=Date.now()] - Mốc thời gian hiện tại (ms).
 * @returns {object|null} Sample đã cache, hoặc null.
 */
function _readWeatherCache(key, now = Date.now()) {
  const entry = _weatherCache.get(key);
  if (!entry) return null;
  if (now - entry.at > _WEATHER_CACHE_TTL_MS) {
    _weatherCache.delete(key);
    return null;
  }
  return entry.sample;
}

/**
 * Ghi cache, xoá entry cũ nhất khi đạt giới hạn.
 * @param {string} key - Khoá cache.
 * @param {object} sample - Sample thời tiết.
 * @param {number} [now=Date.now()] - Mốc thời gian hiện tại (ms).
 * @returns {void}
 */
function _writeWeatherCache(key, sample, now = Date.now()) {
  if (_weatherCache.size >= _WEATHER_CACHE_MAX) {
    const oldestKey = _weatherCache.keys().next().value;
    if (oldestKey !== undefined) _weatherCache.delete(oldestKey);
  }
  _weatherCache.set(key, { at: now, sample });
}

/**
 * Xoá toàn bộ cache thời tiết (dùng cho test hoặc làm mới cưỡng bức).
 * @returns {void}
 */
function clearWeatherCache() {
  _weatherCache.clear();
}

/* ---------------------------------------------------------------
   2. PHÂN LOẠI MƯA, TẦM NHÌN VÀ GIÓ (BEAUFORT) - HÀM THUẦN
   --------------------------------------------------------------- */

/**
 * Chuẩn hoá giá trị số đo được; trả null nếu KHÔNG phải số hữu hạn.
 *
 * Cẩn thận: Number(null), Number('') và Number(false) đều bằng 0, nên phải loại
 * các giá trị đó trước. Nếu không, một trường dữ liệu bị thiếu sẽ bị hiểu thành 0
 * (ví dụ tầm nhìn 0m = nguy hiểm tối đa) thay vì là "không rõ".
 *
 * @param {*} v - Giá trị cần chuẩn hoá.
 * @returns {number|null}
 */
function _num(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  if (typeof v === 'object') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Kiểm tra mã WMO có thuộc danh sách mã nghiêm trọng hay không.
 * @param {number} weatherCode - Mã thời tiết WMO.
 * @param {number[]} codes - Danh sách mã cần kiểm tra.
 * @returns {boolean}
 */
function _isCodeIn(weatherCode, codes) {
  const c = _num(weatherCode);
  return c != null && Array.isArray(codes) && codes.indexOf(c) !== -1;
}

/**
 * Phân loại cường độ mưa theo lượng mưa (mm/h) và mã thời tiết WMO.
 *
 * Nghiệp vụ:
 *  - Mưa nhỏ (< 2.5 mm/h)           -> rủi ro thấp, trơn trượt nhẹ.
 *  - Mưa vừa (2.5 - 10 mm/h)        -> rủi ro trung bình, giảm tốc trên đồ thị.
 *  - Mưa lớn (> 10 mm/h hoặc dông)  -> rủi ro cao, nguy cơ ngập tức thời, trơn trượt nặng.
 *
 * Lượng mưa âm (dữ liệu bất thường) được coi như 0.
 *
 * @param {number} rainMmPerHour - Lượng mưa (mm/h).
 * @param {number} [weatherCode] - Mã thời tiết WMO (ưu tiên mã bão/dông).
 * @returns {{level: string, category: string, label: string, isHeavy: boolean, isThunderstorm: boolean, needsIncident: boolean, mmPerHour: number|null}}
 */
function classifyRain(rainMmPerHour, weatherCode) {
  const raw = _num(rainMmPerHour);
  const mm = raw == null ? null : Math.max(0, raw);

  const isThunderstorm = _isCodeIn(weatherCode, _WEATHER_THUNDERSTORM_CODES);
  const isHeavyCode = _isCodeIn(weatherCode, _WEATHER_HEAVY_RAIN_CODES);

  let category = 'none';
  let level = 'thap';
  let label = 'Không mưa';

  if (isThunderstorm) {
    category = 'heavy'; level = 'cao'; label = 'Mưa kèm dông lốc';
  } else if (mm != null && mm > _RAIN_MODERATE_MAX) {
    category = 'heavy'; level = 'cao'; label = 'Mưa lớn';
  } else if (isHeavyCode) {
    category = 'heavy'; level = 'cao'; label = 'Mưa lớn';
  } else if (mm != null && mm >= _RAIN_LIGHT_MAX) {
    category = 'moderate'; level = 'trungbinh'; label = 'Mưa vừa';
  } else if (mm != null && mm > 0) {
    category = 'light'; level = 'thap'; label = 'Mưa nhỏ';
  }

  const isHeavy = category === 'heavy';
  const needsIncident = isThunderstorm || isHeavy || (mm != null && mm >= _RAIN_INCIDENT_THRESHOLD);

  return { level, category, label, isHeavy, isThunderstorm, needsIncident, mmPerHour: mm };
}

/**
 * Phân loại tầm nhìn (mét).
 *
 *  - > 5000m   : bình thường.
 *  - 1000-5000 : hạn chế tầm nhìn.
 *  - < 1000m   : nguy hiểm cao (sương mù / mưa xối xả).
 *
 * Giá trị null (API không trả tầm nhìn) = không đánh giá, không sinh sự cố.
 *
 * @param {number} visibilityMeters - Tầm nhìn (mét).
 * @returns {{level: string, category: string, label: string, needsIncident: boolean, meters: number|null}}
 */
function classifyVisibility(visibilityMeters) {
  const raw = _num(visibilityMeters);
  if (raw == null) {
    return { level: 'thap', category: 'unknown', label: 'Không rõ tầm nhìn', needsIncident: false, meters: null };
  }
  const m = Math.max(0, raw);
  if (m < _VIS_DANGER_M) {
    return { level: 'cao', category: 'danger', label: 'Tầm nhìn rất kém', needsIncident: true, meters: m };
  }
  // <= 5000m là "hạn chế tầm nhìn"; chỉ < 2000m mới sinh sự cố trong nhóm này
  if (m <= _VIS_LIMITED_M) {
    return {
      level: 'trungbinh', category: 'limited', label: 'Tầm nhìn hạn chế',
      needsIncident: m < _VIS_INCIDENT_THRESHOLD_M, meters: m
    };
  }
  return { level: 'thap', category: 'normal', label: 'Tầm nhìn bình thường', needsIncident: false, meters: m };
}

/**
 * Quy đổi tốc độ gió (km/h) sang cấp gió Beaufort (0-12).
 *
 * Ngưỡng chuẩn Beaufort (km/h): 1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118.
 *   0-3 : gió nhẹ, an toàn.
 *   4-5 : gió vừa, xe máy bắt đầu lảo đảo.
 *   6-7 : gió mạnh, nguy hiểm với cầu vượt và cây cối.
 *   >=8 : gió giật cực mạnh, nguy cơ đổ cây, cấm qua cầu dài/trống gió.
 *
 * @param {number} windKmh - Tốc độ gió (km/h).
 * @returns {{level: number, category: string, label: string, danger: boolean, kmh: number|null}}
 */
function beaufortFromSpeed(windKmh) {
  const raw = _num(windKmh);
  if (raw == null) {
    return { level: 0, category: 'unknown', label: 'Không rõ tốc độ gió', danger: false, kmh: null };
  }
  const kmh = Math.max(0, raw);

  const THRESHOLDS = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  let level = 0;
  for (let i = 0; i < THRESHOLDS.length; i++) {
    if (kmh >= THRESHOLDS[i]) level = i + 1;
  }
  if (kmh >= 118) level = 12;

  const CATEGORIES = [
    'calm', 'light', 'light', 'light',
    'moderate', 'moderate',
    'strong', 'strong',
    'severe', 'severe', 'severe', 'severe'
  ];
  const category = level === 12 ? 'hurricane' : CATEGORIES[level];

  let label;
  if (level <= 3) label = `Gió nhẹ (cấp ${level})`;
  else if (level <= 5) label = `Gió vừa (cấp ${level})`;
  else if (level <= 7) label = `Gió mạnh (cấp ${level})`;
  else if (level === 12) label = 'Bão tố (cấp 12)';
  else label = `Gió giật rất mạnh (cấp ${level})`;

  return { level, category, label, danger: level >= _WIND_INCIDENT_BEAUFORT, kmh };
}

/**
 * Đánh giá tổng hợp một mẫu thời tiết: mưa + tầm nhìn + gió. Hàm thuần.
 *
 * @param {object} sample - Mẫu thời tiết chuẩn hoá.
 * @returns {{rain: object, visibility: object, wind: object, severity: string, bridge: boolean, hasHazard: boolean}}
 */
function evaluateWeather(sample) {
  const s = sample && typeof sample === 'object' ? sample : {};
  const rain = classifyRain(s.rain != null ? s.rain : s.precipitation, s.weatherCode);
  const visibility = classifyVisibility(s.visibility);
  const wind = beaufortFromSpeed(s.windSpeed);
  const bridge = s.bridge === true;

  const hazards = [rain.needsIncident, visibility.needsIncident, wind.danger].filter(Boolean).length;

  let severity = 'thap';
  if (hazards >= 2) severity = 'cao';
  else if (hazards === 1) severity = 'trungbinh';

  return { rain, visibility, wind, severity, bridge, hasHazard: hazards > 0 };
}

/* ---------------------------------------------------------------
   3. CHUẨN HOÁ DỮ LIỆU API
   --------------------------------------------------------------- */

/**
 * Chuyển JSON phản hồi của Open-Meteo thành mẫu thời tiết chuẩn hoá.
 * Hàm thuần: cùng đầu vào luôn cho cùng đầu ra.
 *
 * @param {object} json - JSON phản hồi từ Open-Meteo.
 * @param {number} lat - Vĩ độ đã truy vấn.
 * @param {number} lng - Kinh độ đã truy vấn.
 * @returns {object|null} Mẫu thời tiết, hoặc null nếu dữ liệu không dùng được.
 */
function normalizeWeatherSample(json, lat, lng) {
  if (!json || typeof json !== 'object') return null;
  const current = json.current;
  if (!current || typeof current !== 'object') return null;

  const rain = _num(current.rain);
  const showers = _num(current.showers);
  const precipitation = _num(current.precipitation);

  return {
    lat: +lat,
    lng: +lng,
    // Ưu tiên `rain`, bù bằng `showers` rồi `precipitation`
    rain: rain != null ? rain : (showers != null ? showers : precipitation),
    precipitation,
    showers,
    weatherCode: _num(current.weather_code),
    windSpeed: _num(current.wind_speed_10m),
    windGust: _num(current.wind_gusts_10m),
    visibility: _num(current.visibility),
    bridge: false
  };
}

/* ---------------------------------------------------------------
   4. SINH PAYLOAD SỰ CỐ THỜI TIẾT (HÀM THUẦN - TEST ĐƯỢC)
   --------------------------------------------------------------- */

/**
 * Tạo khoá định danh ổn định cho một điểm thời tiết.
 * Làm khoá gộp trong incidents.js nên KHÔNG chứa thời gian hay số ngẫu nhiên.
 *
 * @param {string} type - Loại sự cố ('weather_rain' | 'weather_wind').
 * @param {number} lat - Vĩ độ.
 * @param {number} lng - Kinh độ.
 * @returns {string}
 */
function weatherPointKey(type, lat, lng) {
  const f = Math.pow(10, _WEATHER_ROUND_DECIMALS);
  const rl = Math.round(+lat * f) / f;
  const rn = Math.round(+lng * f) / f;
  return `${type}-${rl.toFixed(_WEATHER_ROUND_DECIMALS)}_${rn.toFixed(_WEATHER_ROUND_DECIMALS)}`;
}

/**
 * Tính confidence cho sự cố mưa: mưa nặng / tầm nhìn kém / cầu vượt thì tin cậy hơn.
 * @param {object} evaluation - Kết quả evaluateWeather.
 * @returns {number} Confidence [0, 100]
 */
function _rainConfidence(evaluation) {
  let c = _RAIN_CONFIDENCE_BASE;
  const mm = evaluation.rain.mmPerHour;
  if (mm != null && mm > _RAIN_MODERATE_MAX) c += 20;
  else if (mm != null && mm >= _RAIN_LIGHT_MAX) c += 10;
  if (evaluation.visibility.needsIncident) c += 15;
  if (evaluation.bridge) c += 10;
  return Math.max(0, Math.min(100, Math.round(c)));
}

/**
 * Tính confidence cho sự cố gió: cấp Beaufort càng cao, cầu vượt càng nguy hiểm.
 * @param {object} evaluation - Kết quả evaluateWeather.
 * @returns {number} Confidence [0, 100]
 */
function _windConfidence(evaluation) {
  let c = _WIND_CONFIDENCE_BASE;
  const lvl = evaluation.wind.level;
  if (lvl >= 8) c += 30;
  else if (lvl >= 6) c += 20;
  else if (lvl >= _WIND_INCIDENT_BEAUFORT) c += 10;
  if (evaluation.bridge) c += 20;
  return Math.max(0, Math.min(100, Math.round(c)));
}

/**
 * Sinh danh sách payload sự cố thời tiết từ các mẫu thời tiết đã lấy được.
 *
 * HÀM THUẦN TUYỆT ĐỐI: không dùng Date.now(), Math.random(), không gọi mạng,
 * không mutate `samples`. Nhờ vậy toàn bộ logic nghiệp vụ có thể test được.
 *
 * Ngưỡng sinh sự cố:
 *  - Mưa: >= 5 mm/h, hoặc mưa lớn (> 10 mm/h), hoặc dông lốc.
 *  - Tầm nhìn: < 2000m (dưới 1000m -> mức 'cao').
 *  - Gió: >= cấp Beaufort 5.
 *
 * @param {Array<object>} samples - Danh sách mẫu thời tiết chuẩn hoá.
 * @returns {Array<object>} Payload sẵn sàng đưa vào injectWeatherIncidents.
 */
function buildWeatherIncidentPayloads(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return [];

  const payloads = [];
  const seenKeys = {};

  const makeWeather = (sample, ev, gust) => ({
    rainMmPerHour: ev.rain.mmPerHour,
    visibilityMeters: ev.visibility.meters,
    windSpeedKmh: ev.wind.kmh,
    windGustKmh: gust,
    beaufort: ev.wind.level,
    weatherCode: _num(sample.weatherCode),
    bridge: ev.bridge
  });

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!sample || typeof sample !== 'object') continue;
    if (!_weatherIsValidCoord(sample.lat, sample.lng)) continue;

    const ev = evaluateWeather(sample);
    const gust = _num(sample.windGust);

    /* --- Sự cố mưa / tầm nhìn kém (gộp chung loại weather_rain) --- */
    const rainKey = weatherPointKey('weather_rain', sample.lat, sample.lng);
    if ((ev.rain.needsIncident || ev.visibility.needsIncident) && !seenKeys[rainKey]) {
      seenKeys[rainKey] = true;
      const isRainHazard = ev.rain.needsIncident;
      const mmText = ev.rain.mmPerHour != null ? `${ev.rain.mmPerHour.toFixed(1)} mm/h` : 'không đo được';
      const visText = ev.visibility.meters != null ? `, tầm nhìn ${Math.round(ev.visibility.meters)}m` : '';
      const desc = isRainHazard
        ? `${ev.rain.label} (${mmText}${visText}) - nguy cơ trơn trượt, tầm nhìn xấu khi lái xe.`
        : `${ev.visibility.label} (~${Math.round(ev.visibility.meters)}m) - sương mù hoặc mưa xối xả che khuất tầm nhìn.`;

      payloads.push({
        key: rainKey,
        type: 'weather_rain',
        level: isRainHazard ? ev.rain.level : ev.visibility.level,
        lat: sample.lat,
        lng: sample.lng,
        desc,
        confidence: _rainConfidence(ev),
        source: 'weather_api',
        weather: makeWeather(sample, ev, gust)
      });
    }

    /* --- Sự cố gió mạnh --- */
    if (ev.wind.danger) {
      const windKey = weatherPointKey('weather_wind', sample.lat, sample.lng);
      if (!seenKeys[windKey]) {
        seenKeys[windKey] = true;
        const gustText = gust != null ? `, giật ${Math.round(gust)} km/h` : '';
        const bridgeText = ev.bridge ? ' - đoạn đường là cầu vượt, nguy cơ rất cao.' : '';
        const speedText = ev.wind.kmh != null ? ` — tốc độ ${Math.round(ev.wind.kmh)} km/h${gustText}` : '';
        payloads.push({
          key: windKey,
          type: 'weather_wind',
          level: ev.wind.level >= 8 ? 'cao' : 'trungbinh',
          lat: sample.lat,
          lng: sample.lng,
          desc: `${ev.wind.label}${speedText}${bridgeText}`,
          confidence: _windConfidence(ev),
          source: 'weather_api',
          weather: makeWeather(sample, ev, gust)
        });
      }
    }
  }

  return payloads;
}

/**
 * Hệ số nhân rủi ro khi đoạn đường là cầu vượt.
 * Gió mạnh trên cầu vượt là tổ hợp rủi ro rất cao nên được tăng trọng số.
 *
 * @param {boolean} bridge - Đoạn đường có phải cầu vượt hay không.
 * @param {number} [severityScore=1] - Mức rủi ro khí tượng (>=1).
 * @returns {number} Hệ số nhân.
 */
function bridgeRiskMultiplier(bridge, severityScore = 1) {
  if (bridge !== true) return 1;
  return Math.max(1, Number(severityScore) || 1) * _WIND_BRIDGE_BOOST;
}

/* ---------------------------------------------------------------
   5. LẤY DỮ LIỆU THỜI TIẾT TỪ OPEN-METEO (CACHE + TIMEOUT)
   --------------------------------------------------------------- */

/**
 * Lấy thời tiết tại một toạ độ. Có cache theo toạ độ làm tròn + timeout.
 *
 * TUYỆT ĐỐI KHÔNG THROW: mọi lỗi mạng / timeout / dữ liệu đều trả về null.
 *
 * @param {number} lat - Vĩ độ WGS84.
 * @param {number} lng - Kinh độ WGS84.
 * @param {object} [opts={}] - Tuỳ chọn: { timeoutMs, forceRefresh }.
 * @returns {Promise<object|null>} Mẫu thời tiết, hoặc null nếu thất bại.
 */
async function fetchWeatherSample(lat, lng, opts = {}) {
  if (!_WEATHER_ENABLED) return null;
  const key = weatherCacheKey(lat, lng);
  if (key == null) return null;

  if (!opts.forceRefresh) {
    const cached = _readWeatherCache(key);
    if (cached) return cached;
  }

  const timeoutMs = opts.timeoutMs || _WEATHER_TIMEOUT_MS;
  let timer = null;

  try {
    if (typeof AbortController === 'undefined' || typeof fetch !== 'function') return null;

    const query = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current: 'precipitation,rain,showers,weather_code,wind_speed_10m,wind_gusts_10m,visibility'
    });

    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${_WEATHER_API_URL}?${query}`, { signal: controller.signal });
    if (!res || !res.ok) return null;

    const json = await res.json();
    const sample = normalizeWeatherSample(json, lat, lng);
    if (!sample) return null;

    _writeWeatherCache(key, sample);
    return sample;
  } catch (err) {
    // Timeout / mất mạng / JSON hỏng: coi như thất bại và bỏ qua, không làm hỏng app
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * Lấy thời tiết cho nhiều điểm, tự gộp toạ độ trùng nhau (cache) và giới hạn
 * số request đồng thời. TUYỆT ĐỐI KHÔNG THROW.
 *
 * @param {Array<Array<number>|{lat: number, lng: number}>} points - Danh sách toạ độ.
 * @param {object} [opts={}] - Tuỳ chọn: { timeoutMs, forceRefresh, bridge, maxConcurrent }.
 * @returns {Promise<{samples: Array<object>, successCount: number, failureCount: number, ok: boolean}>}
 */
async function fetchWeatherSamples(points, opts = {}) {
  const result = { samples: [], successCount: 0, failureCount: 0, ok: false };
  if (!Array.isArray(points) || points.length === 0) return result;

  // Chuẩn hoá input về [{lat, lng}] và gộp theo cache key
  const byKey = new Map();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const lat = Array.isArray(p) ? p[0] : p.lat;
    const lng = Array.isArray(p) ? p[1] : p.lng;
    if (!_weatherIsValidCoord(lat, lng)) continue;
    const k = weatherCacheKey(lat, lng);
    if (k == null || byKey.has(k)) continue;
    byKey.set(k, { lat: +lat, lng: +lng });
  }

  const unique = Array.from(byKey.values());
  if (unique.length === 0) return result;

  // Giới hạn số request đồng thời để không spam Open-Meteo
  const queue = unique.slice();
  const limit = Math.max(1, opts.maxConcurrent || _WEATHER_MAX_CONCURRENT);

  async function worker() {
    while (queue.length > 0) {
      const pt = queue.shift();
      const sample = await fetchWeatherSample(pt.lat, pt.lng, opts);
      if (sample) {
        if (opts.bridge === true) sample.bridge = true;
        result.samples.push(sample);
        result.successCount++;
      } else {
        result.failureCount++;
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, unique.length); i++) workers.push(worker());
  await Promise.all(workers);

  result.ok = result.successCount > 0;
  return result;
}

/* ---------------------------------------------------------------
   6. LẤY MẪU DỌC TUYẾN ĐƯỜNG / VÙNG ĐANG XEM
   --------------------------------------------------------------- */

/**
 * Chọn tối đa `maxSamples` điểm đại diện dọc một polyline, trải đều.
 * Hàm thuần, không mutate đầu vào.
 *
 * @param {Array<Array<number>>} coords - Polyline tuyến đường [[lat, lng], ...].
 * @param {number} [maxSamples] - Số điểm tối đa (mặc định lấy từ CONFIG).
 * @returns {Array<{lat: number, lng: number}>}
 */
function sampleRouteCoordinates(coords, maxSamples = _WEATHER_MAX_SAMPLES) {
  if (!Array.isArray(coords) || coords.length === 0) return [];

  const valid = coords.filter(c => Array.isArray(c) && _weatherIsValidCoord(c[0], c[1]));
  if (valid.length === 0) return [];
  if (valid.length === 1) return [{ lat: +valid[0][0], lng: +valid[0][1] }];

  const n = Math.max(1, Math.min(maxSamples, valid.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * (valid.length - 1) / (n - 1));
    out.push({ lat: +valid[idx][0], lng: +valid[idx][1] });
  }
  return out;
}

/**
 * Chọn điểm lấy mẫu theo vùng đang xem trên bản đồ.
 * @param {{getBounds: function}|object} boundsLike - Đối tượng có getBounds() hoặc {north,south,east,west}.
 * @param {number} [maxSamples=4] - Số điểm tối đa.
 * @returns {Array<{lat: number, lng: number}>}
 */
function sampleBoundingBox(boundsLike, maxSamples = 4) {
  let b = null;
  try {
    b = (boundsLike && typeof boundsLike.getBounds === 'function') ? boundsLike.getBounds() : boundsLike;
  } catch (err) {
    return [];
  }
  if (!b) return [];

  const north = _num(typeof b.getNorth === 'function' ? b.getNorth() : b.north);
  const south = _num(typeof b.getSouth === 'function' ? b.getSouth() : b.south);
  const east = _num(typeof b.getEast === 'function' ? b.getEast() : b.east);
  const west = _num(typeof b.getWest === 'function' ? b.getWest() : b.west);
  if (north == null || south == null || east == null || west == null) return [];

  const n = Math.max(1, Math.min(maxSamples, 9));
  const out = [];
  for (let i = 0; i < n; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const lat = north - (north - south) * (0.2 + 0.3 * row);
    const lng = west + (east - west) * (0.2 + 0.3 * col);
    if (_weatherIsValidCoord(lat, lng)) out.push({ lat: +lat, lng: +lng });
  }
  return out;
}

/* ---------------------------------------------------------------
   7. ĐIỀU PHỐI: LẤY MẪU -> SINH PAYLOAD -> NẠP VÀO HỆ THỐNG SỰ CỐ
   --------------------------------------------------------------- */

/**
 * Lấy thời tiết cho một danh sách toạ độ rồi nạp sự cố vào hệ thống.
 *
 * Fail-safe: nếu KHÔNG lấy được mẫu nào (mất mạng/timeout) thì tuyệt đối không
 * gọi injectWeatherIncidents, nhờ đó các sự cố thời tiết đang hiển thị được giữ nguyên
 * thay vì bị xoá sạch.
 *
 * @param {Array<object>} points - Danh sách toạ độ cần lấy mẫu.
 * @param {object} [opts={}] - Tuỳ chọn: { bridge, forceRefresh, timeoutMs }.
 * @returns {Promise<{ok: boolean, samples: Array<object>, injected: number, updated: number, removed: number}>}
 */
async function refreshWeatherForPoints(points, opts = {}) {
  const out = { ok: false, samples: [], injected: 0, updated: 0, removed: 0 };
  if (!_WEATHER_ENABLED) return out;
  if (!Array.isArray(points) || points.length === 0) return out;

  const fetchRes = await fetchWeatherSamples(points, opts);
  out.samples = fetchRes.samples;
  if (!fetchRes.ok) return out;   // Không có dữ liệu -> giữ nguyên hiện trạng

  const payloads = buildWeatherIncidentPayloads(fetchRes.samples);

  if (typeof window === 'undefined') return out;
  const inject = window.injectWeatherIncidents;
  if (typeof inject !== 'function') return out;

  try {
    // Chỉ đối soát (xoá sự cố cũ) khi TẤT CẢ các điểm lấy mẫu đều thành công.
    // Nếu chỉ một điểm lỗi thì bỏ qua việc dọn để tránh sự cố cũ nhấp nháy
    // biến mất rồi xuất hiện lại trên bản đồ.
    const summary = inject(payloads, { reconcile: fetchRes.failureCount === 0 });
    out.ok = true;
    if (summary && typeof summary === 'object') {
      out.injected = Number(summary.injected) || 0;
      out.updated = Number(summary.updated) || 0;
      out.removed = Number(summary.removed) || 0;
    }
  } catch (err) {
    // Hệ thống sự cố bị lỗi không được làm hỏng luồng định tuyến
    return out;
  }
  return out;
}

/**
 * Lấy thời tiết dọc một tuyến đường (polyline) rồi nạp sự cố.
 * @param {Array<Array<number>>} coords - Polyline tuyến đường.
 * @param {object} [opts={}] - Tuỳ chọn như refreshWeatherForPoints.
 * @returns {Promise<object>} Kết quả như refreshWeatherForPoints.
 */
async function refreshWeatherForRoute(coords, opts = {}) {
  const points = sampleRouteCoordinates(coords, opts.maxSamples);
  return refreshWeatherForPoints(points, opts);
}

/* ---------------------------------------------------------------
   8. EXPORTS
   --------------------------------------------------------------- */

if (typeof window !== 'undefined') {
  window.fetchWeatherSample = fetchWeatherSample;
  window.fetchWeatherSamples = fetchWeatherSamples;
  window.refreshWeatherForPoints = refreshWeatherForPoints;
  window.refreshWeatherForRoute = refreshWeatherForRoute;
  window.buildWeatherIncidentPayloads = buildWeatherIncidentPayloads;
  window.evaluateWeather = evaluateWeather;
  window.classifyRain = classifyRain;
  window.classifyVisibility = classifyVisibility;
  window.beaufortFromSpeed = beaufortFromSpeed;
  window.bridgeRiskMultiplier = bridgeRiskMultiplier;
  window.sampleRouteCoordinates = sampleRouteCoordinates;
  window.sampleBoundingBox = sampleBoundingBox;
  window.normalizeWeatherSample = normalizeWeatherSample;
  window.weatherCacheKey = weatherCacheKey;
  window.clearWeatherCache = clearWeatherCache;
  window._weatherCache = _weatherCache;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchWeatherSample,
    fetchWeatherSamples,
    refreshWeatherForPoints,
    refreshWeatherForRoute,
    buildWeatherIncidentPayloads,
    evaluateWeather,
    classifyRain,
    classifyVisibility,
    beaufortFromSpeed,
    bridgeRiskMultiplier,
    sampleRouteCoordinates,
    sampleBoundingBox,
    normalizeWeatherSample,
    weatherCacheKey,
    clearWeatherCache,
    _weatherCache
  };
}