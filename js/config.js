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
  route_colors: ['#2f7ee0', '#f08a1c', '#12b76a', '#8a4fe0', '#e3492c']
};

// Aliases cho tương thích ngược với code cũ
const INCIDENT_MERGE_RADIUS_METERS = CONFIG.incident_merge_radius_m;
const RISK_IMPACT = CONFIG.risk_impact;
const INCIDENT_TYPE_WEIGHT = CONFIG.incident_type_weight;
const INCIDENT_LEVEL_WEIGHT = CONFIG.incident_level_weight;
const INCIDENT_DECAY_CONFIG = CONFIG.decay;
const ROUTE_COLORS = CONFIG.route_colors;

/**
 * Định nghĩa metadata trực quan cho từng loại sự cố
 */
const INCIDENT_TYPES = {
  accident:     { label: 'Tai nạn giao thông',       emoji: '🔴', color: '#e3492c' },
  flood:        { label: 'Ngập nước',                emoji: '🔵', color: '#2f7ee0' },
  construction: { label: 'Công trình đang thi công', emoji: '🟠', color: '#f08a1c' },
  traffic:      { label: 'Ùn tắc',                   emoji: '🟡', color: '#f4b400' },
  danger:       { label: 'Khu vực nguy hiểm',        emoji: '⚠️', color: '#8a4fe0' },
  damaged_road: { label: 'Đường hư hỏng',            emoji: '🟤', color: '#8d6e63' },
  obstacle:     { label: 'Chướng ngại vật',          emoji: '🟣', color: '#7c4dff' },
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
 * @param {number} lat 
 * @param {number} lng 
 * @param {Array<[number, number]>} coords 
 * @returns {number} Mét
 */
function minDistanceToPolyline(lat, lng, coords) {
  let min = Infinity;
  for (const c of coords) {
    const d = haversineMeters(lat, lng, c[0], c[1]);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Định dạng thời gian tương đối theo tiếng Việt (ví dụ: '5 phút trước')
 * @param {number} ts - Timestamp mili-giây
 * @returns {string}
 */
function formatRelativeTime(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
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
  window.INCIDENT_TYPES = INCIDENT_TYPES;
  window.LEVEL_LABEL = LEVEL_LABEL;
  window.escapeHtml = escapeHtml;
  window.shortenDisplayName = shortenDisplayName;
  window.isValidCoordinate = isValidCoordinate;
  window.haversineMeters = haversineMeters;
  window.distanceMeters = distanceMeters;
  window.minDistanceToPolyline = minDistanceToPolyline;
  window.formatRelativeTime = formatRelativeTime;
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
    INCIDENT_TYPES,
    LEVEL_LABEL,
    escapeHtml,
    shortenDisplayName,
    isValidCoordinate,
    haversineMeters,
    distanceMeters,
    minDistanceToPolyline,
    formatRelativeTime
  };
}
