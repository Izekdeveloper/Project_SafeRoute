/**
 * ============================================================================
 * SafeRoute Research Project: System Configuration & Math Utilities
 * File: js/config.js
 * 
 * Mục đích nghiên cứu:
 * Tập trung hóa toàn bộ các siêu tham số (hyperparameters) và hằng số của hệ thống.
 * Các trọng số khởi tạo ở đây mang tính heuristic sơ bộ và sẽ được hiệu chuẩn
 * (calibrated) bằng khảo sát AHP (Analytic Hierarchy Process) và dữ liệu thực nghiệm.
 * ============================================================================
 */

/**
 * Định danh người dùng giả lập cho phiên làm việc hiện tại
 * (tránh trường hợp một người dùng spam vote xác nhận liên tục)
 */
const DEMO_USER_ID = 'demo-user-' + Math.random().toString(36).slice(2, 9);

/**
 * CẤU HÌNH TOÀN CỤC CỦA HỆ THỐNG (GLOBAL CONFIG)
 */
const CONFIG = {
  // Bán kính làm mịn Gaussian KDE (mét)
  // Ghi chú học thuật: Giá trị h = 150m dựa trên quy tắc ngón tay cái Silverman h = 1.06 * sigma * n^(-1/5)
  kde_bandwidth: 150,

  // Hệ số đánh đổi thời gian - rủi ro (alpha parameter): w = time * (1 + alpha * risk)
  // fastest: 0 (bỏ qua rủi ro, ưu tiên thời gian tuyệt đối)
  // balanced: 1 (cân bằng thời gian và an toàn)
  // safest: 3 (tối đa hóa an toàn, chấp nhận đi vòng)
  mode_alpha: {
    fastest: 0,
    balanced: 1,
    safest: 3
  },

  // Bán kính gộp sự cố trùng lặp cùng loại (mét)
  incident_merge_radius_m: 100,

  // Trọng số ảnh hưởng theo khoảng cách từ sự cố đến tim đường
  risk_impact: {
    STRONG_THRESHOLD_M: 100,   // < 100m: ảnh hưởng trực tiếp
    MEDIUM_THRESHOLD_M: 300,   // 100–300m: ảnh hưởng ngoại vi
    STRONG_WEIGHT: 1.0,
    MEDIUM_WEIGHT: 0.4
  },

  // Trọng số mức độ nghiêm trọng trong hàm chấm điểm rủi ro
  incident_level_weight: {
    cao: 1.0,
    trungbinh: 0.5,
    thap: 0.2
  },

  // Trọng số loại sự cố
  incident_type_weight: {
    accident: 0.30,
    flood: 0.25,
    danger: 0.20,
    construction: 0.15,
    traffic: 0.12,
    damaged_road: 0.10,
    obstacle: 0.08
  },

  // Cấu hình chu kỳ bán rã (Half-life) suy giảm độ tin cậy theo thời gian (giờ)
  // C(t) = C_0 * (0.5)^(t / halfLife)
  decay: {
    flood:        { halfLifeHours: 3    }, // Nước rút sau vài giờ
    accident:     { halfLifeHours: 1    }, // Hiện trường giải tỏa nhanh
    construction: { halfLifeHours: 72   }, // Thi công kéo dài nhiều ngày
    traffic:      { halfLifeHours: 0.5  }, // Ùn tắc tan nhanh sau giờ cao điểm
    damaged_road: { halfLifeHours: 168  }, // Ổ gà, sụt lún tồn tại lâu
    danger:       { halfLifeHours: 168  }, // Điểm đen nguy hiểm tồn tại lâu
    obstacle:     { halfLifeHours: 6    }  // Chướng ngại vật dọn dẹp trong ngày
  },

  // Hệ số thời gian theo ngữ cảnh (Temporal factors)
  temporal: {
    rush_hour_mult: 1.5,
    night_mult: 1.3,
    weekend_construction_mult: 0.5
  },

  // Số lượng tuyến đường ứng viên cần tìm
  k_shortest: 3,

  // Màu sắc phân biệt các tuyến đường trên bản đồ
  route_colors: ['#2f7ee0', '#f08a1c', '#12b76a', '#8a4fe0', '#e3492c'],

  // ==============================================================
  // CẤU HÌNH TỐI ƯU HÓA OSRM ROUTING ENGINE
  // ==============================================================
  osrm_timeout_ms: 8000,                // Timeout mỗi request OSRM (8 giây)
  osrm_cache_ttl_ms: 180000,            // TTL lưu cache hình học OSRM (3 phút = 180.000 ms)
  osrm_cache_max_entries: 100,          // Giới hạn số lượng entries trong cache (LRU)
  osrm_max_concurrent_requests: 3,      // Giới hạn số request OSRM đồng thời tối đa
  osrm_max_waypoints: 4,                // Giới hạn số lượng waypoint tránh sự cố tối đa
  osrm_max_routes: 6,                   // Giới hạn số lượng tuyến ứng viên đưa vào chấm điểm
  osrm_enable_alternatives: true,       // Bật alternatives cho tuyến cơ sở base route
  osrm_candidate_steps: false,          // Tắt turn-by-turn steps cho các tuyến ứng viên (giảm payload)
  osrm_final_steps: true,               // Bật turn-by-turn steps cho tuyến được chọn hiển thị
  debug_routing: false                  // Tắt chế độ debug log và metrics hiệu năng routing (mặc định production)
};

// Cấu hình kiểu hiển thị mặc định theo từng loại sự cố (point vs segment)
const INCIDENT_RENDER_MODE = {
  flood: 'segment',
  accident: 'point',
  construction: 'segment',
  traffic: 'segment',
  damaged_road: 'segment',
  danger: 'point',
  obstacle: 'point'
};

// Aliases cho tương thích ngược với code cũ
const INCIDENT_MERGE_RADIUS_METERS = CONFIG.incident_merge_radius_m;
const RISK_IMPACT = CONFIG.risk_impact;
const INCIDENT_TYPE_WEIGHT = CONFIG.incident_type_weight;
const INCIDENT_LEVEL_WEIGHT = CONFIG.incident_level_weight;
const INCIDENT_DECAY_CONFIG = CONFIG.decay;
const ROUTE_COLORS = CONFIG.route_colors;

// Aliases cho cấu hình OSRM
const OSRM_TIMEOUT = CONFIG.osrm_timeout_ms || 8000;
const OSRM_CACHE_TTL = CONFIG.osrm_cache_ttl_ms || 180000;
const OSRM_CACHE_MAX_ENTRIES = CONFIG.osrm_cache_max_entries || 100;
const OSRM_MAX_CONCURRENT_REQUESTS = CONFIG.osrm_max_concurrent_requests || 3;
const OSRM_MAX_WAYPOINTS = CONFIG.osrm_max_waypoints || 4;
const OSRM_MAX_ROUTES = CONFIG.osrm_max_routes || 6;
const OSRM_ENABLE_ALTERNATIVES = CONFIG.osrm_enable_alternatives !== false;
const OSRM_CANDIDATE_STEPS = CONFIG.osrm_candidate_steps === true;
const OSRM_FINAL_STEPS = CONFIG.osrm_final_steps !== false;
const DEBUG_ROUTING = CONFIG.debug_routing === true;

/**
 * Định nghĩa metadata trực quan và renderMode cho từng loại sự cố
 */
const INCIDENT_TYPES = {
  flood:        { label: 'Ngập nước',                emoji: '🔵', color: '#2563eb', renderMode: 'segment' },
  accident:     { label: 'Tai nạn giao thông',       emoji: '🔴', color: '#ef4444', renderMode: 'point' },
  construction: { label: 'Công trình đang thi công', emoji: '🟠', color: '#f97316', renderMode: 'segment' },
  traffic:      { label: 'Ùn tắc',                   emoji: '🟡', color: '#f59e0b', renderMode: 'segment' },
  damaged_road: { label: 'Đường hư hỏng',            emoji: '🟤', color: '#8d6e63', renderMode: 'segment' },
  danger:       { label: 'Khu vực nguy hiểm',        emoji: '⚠️', color: '#8a4fe0', renderMode: 'point' },
  obstacle:     { label: 'Chướng ngại vật',          emoji: '🟣', color: '#7c4dff', renderMode: 'point' },
};

const LEVEL_LABEL = {
  thap: 'Thấp',
  trungbinh: 'Trung bình',
  cao: 'Cao'
};

/* ---------------------------------------------------------------
   CÁC HÀM TIỆN ÍCH DÙNG CHUNG (UTILITY FUNCTIONS)
--------------------------------------------------------------- */

/**
 * Thoát các ký tự đặc biệt trong chuỗi để hiển thị an toàn trên DOM (chống XSS)
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

/**
 * Rút gọn chuỗi địa chỉ từ Nominatim để hiển thị gọn gàng trên nhãn
 * @param {string} dn - Tên hiển thị đầy đủ
 * @returns {string}
 */
function shortenDisplayName(dn) {
  return String(dn).split(',').map(p => p.trim()).slice(0, 3).join(', ');
}

/**
 * Kiểm tra tính hợp lệ của cặp tọa độ WGS84
 * @param {number} lat - Vĩ độ [-90, 90]
 * @param {number} lng - Kinh độ [-180, 180]
 * @returns {boolean}
 */
function isValidCoordinate(lat, lng) {
  return Number.isFinite(+lat) && Number.isFinite(+lng)
    && +lat >= -90 && +lat <= 90 && +lng >= -180 && +lng <= 180;
}

/**
 * Tính khoảng cách Haversine giữa 2 tọa độ (mét)
 * @param {number} lat1 
 * @param {number} lng1 
 * @param {number} lat2 
 * @param {number} lng2 
 * @returns {number} Mét
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const distanceMeters = haversineMeters;

/**
 * Tìm khoảng cách nhỏ nhất từ 1 điểm đến một đường polyline (mảng [lat, lng])
 * Sử dụng hình chiếu trực giao vuông góc lên từng đoạn thẳng (point-to-segment)
 * kết hợp kẹp tỷ lệ t trong [0, 1] để đo khoảng cách chính xác ngay cả khi điểm
 * nằm ở khoảng giữa hai đỉnh thẳng hàng.
 * @param {number} lat - Vĩ độ điểm cần đo
 * @param {number} lng - Kinh độ điểm cần đo
 * @param {Array<[number, number]>} coords - Mảng các đỉnh của polyline [[lat, lng], ...]
 * @returns {number} Khoảng cách nhỏ nhất tính bằng mét (trả về Infinity nếu dữ liệu không hợp lệ)
 */
function minDistanceToPolyline(lat, lng, coords) {
  if (!isValidCoordinate(lat, lng)) return Infinity;
  if (!coords || !Array.isArray(coords) || coords.length === 0) return Infinity;

  // Trường hợp chỉ có đúng 1 điểm đỉnh: tính khoảng cách thẳng đến đỉnh đó
  if (coords.length === 1) {
    const p0 = coords[0];
    if (!p0 || !isValidCoordinate(p0[0], p0[1])) return Infinity;
    return haversineMeters(lat, lng, p0[0], p0[1]);
  }

  let min = Infinity;
  const rad = Math.PI / 180;
  // Hệ số chiếu cục bộ: vĩ độ trung bình bù trừ độ co kinh tuyến WGS84
  const cosLat = Math.cos(lat * rad);
  const METERS_PER_DEG_LAT = 111132.95; // 1 độ vĩ ≈ 111.133 km
  const METERS_PER_DEG_LNG = 111412.84 * cosLat; // 1 độ kinh tại vĩ độ lat

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    if (!p1 || !p2 || !isValidCoordinate(p1[0], p1[1]) || !isValidCoordinate(p2[0], p2[1])) {
      continue;
    }

    // Chuyển p1, p2 sang tọa độ mét cục bộ lấy điểm (lat, lng) làm gốc (0, 0)
    const x1 = (p1[1] - lng) * METERS_PER_DEG_LNG;
    const y1 = (p1[0] - lat) * METERS_PER_DEG_LAT;
    const x2 = (p2[1] - lng) * METERS_PER_DEG_LNG;
    const y2 = (p2[0] - lat) * METERS_PER_DEG_LAT;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLenSq = dx * dx + dy * dy;

    let dist;
    if (segLenSq < 1e-6) {
      // Đoạn thẳng 2 đầu mút trùng nhau
      dist = Math.hypot(x1, y1);
    } else {
      // Vector từ p1 tới điểm (0, 0) là (-x1, -y1)
      // Tỷ lệ hình chiếu t trên đoạn thẳng: t = - (x1 * dx + y1 * dy) / segLenSq
      const t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / segLenSq));
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      dist = Math.hypot(projX, projY);
    }

    if (dist < min) {
      min = dist;
      if (min === 0) return 0;
    }
  }

  // Fallback: Nếu không có đoạn thẳng hợp lệ nào được tính, thử so sánh với các đỉnh đơn lẻ
  if (!Number.isFinite(min)) {
    for (const c of coords) {
      if (c && isValidCoordinate(c[0], c[1])) {
        const d = haversineMeters(lat, lng, c[0], c[1]);
        if (d < min) min = d;
      }
    }
  }

  return min;
}

/**
 * Định dạng thời gian tuyệt đối theo tiếng Việt (ví dụ: '28/09/2026 10:42')
 * Dữ liệu thời gian động 100%, tuyệt đối không hard-code ngày tháng
 * @param {number} ts - Timestamp mili-giây
 * @returns {string}
 */
function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

/**
 * Định dạng thời gian tương đối theo tiếng Việt (ví dụ: '5 phút trước')
 * @param {number} ts - Timestamp mili-giây
 * @returns {string}
 */
function formatRelativeTime(ts) {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'Vừa xong';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  return `${Math.floor(hrs / 24)} ngày trước`;
}

// Gắn lên window để truy cập từ script truyền thống nếu không dùng bundler
if (typeof window !== 'undefined') {
  window.DEMO_USER_ID = DEMO_USER_ID;
  window.CONFIG = CONFIG;
  window.INCIDENT_MERGE_RADIUS_METERS = INCIDENT_MERGE_RADIUS_METERS;
  window.RISK_IMPACT = RISK_IMPACT;
  window.INCIDENT_TYPE_WEIGHT = INCIDENT_TYPE_WEIGHT;
  window.INCIDENT_LEVEL_WEIGHT = INCIDENT_LEVEL_WEIGHT;
  window.INCIDENT_DECAY_CONFIG = INCIDENT_DECAY_CONFIG;
  window.ROUTE_COLORS = ROUTE_COLORS;
  window.INCIDENT_RENDER_MODE = INCIDENT_RENDER_MODE;
  window.INCIDENT_TYPES = INCIDENT_TYPES;
  window.LEVEL_LABEL = LEVEL_LABEL;
  window.escapeHtml = escapeHtml;
  window.shortenDisplayName = shortenDisplayName;
  window.isValidCoordinate = isValidCoordinate;
  window.haversineMeters = haversineMeters;
  window.distanceMeters = distanceMeters;
  window.minDistanceToPolyline = minDistanceToPolyline;
  window.formatRelativeTime = formatRelativeTime;
  window.formatDateTime = formatDateTime;

  // OSRM constants
  window.OSRM_TIMEOUT = OSRM_TIMEOUT;
  window.OSRM_CACHE_TTL = OSRM_CACHE_TTL;
  window.OSRM_CACHE_MAX_ENTRIES = OSRM_CACHE_MAX_ENTRIES;
  window.OSRM_MAX_CONCURRENT_REQUESTS = OSRM_MAX_CONCURRENT_REQUESTS;
  window.OSRM_MAX_WAYPOINTS = OSRM_MAX_WAYPOINTS;
  window.OSRM_MAX_ROUTES = OSRM_MAX_ROUTES;
  window.OSRM_ENABLE_ALTERNATIVES = OSRM_ENABLE_ALTERNATIVES;
  window.OSRM_CANDIDATE_STEPS = OSRM_CANDIDATE_STEPS;
  window.OSRM_FINAL_STEPS = OSRM_FINAL_STEPS;
  window.DEBUG_ROUTING = DEBUG_ROUTING;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEMO_USER_ID,
    CONFIG,
    INCIDENT_MERGE_RADIUS_METERS,
    RISK_IMPACT,
    INCIDENT_TYPE_WEIGHT,
    INCIDENT_LEVEL_WEIGHT,
    INCIDENT_DECAY_CONFIG,
    ROUTE_COLORS,
    INCIDENT_RENDER_MODE,
    INCIDENT_TYPES,
    LEVEL_LABEL,
    escapeHtml,
    shortenDisplayName,
    isValidCoordinate,
    haversineMeters,
    distanceMeters,
    minDistanceToPolyline,
    formatRelativeTime,
    formatDateTime,
    OSRM_TIMEOUT,
    OSRM_CACHE_TTL,
    OSRM_CACHE_MAX_ENTRIES,
    OSRM_MAX_CONCURRENT_REQUESTS,
    OSRM_MAX_WAYPOINTS,
    OSRM_MAX_ROUTES,
    OSRM_ENABLE_ALTERNATIVES,
    OSRM_CANDIDATE_STEPS,
    OSRM_FINAL_STEPS,
    DEBUG_ROUTING
  };
}
