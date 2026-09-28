/**
 * ============================================================================
 * SafeRoute Research Project: Community Incidents & Bayesian Confidence Decay
 * File: js/incidents.js
 * 
 * Mục đích nghiên cứu:
 * Quản lý vòng đời dữ liệu sự cố giao thông do cộng đồng đóng góp.
 * Mô hình hóa sự suy giảm độ tin cậy theo thời gian thực (Half-Life Exponential Decay)
 * và cơ chế xác thực cộng đồng (Crowdsourced Bayesian Confirmation).
 * ============================================================================
 */

const _CONFIG = (typeof window !== 'undefined' && window.CONFIG) ? window.CONFIG : {};
const _INCIDENT_MERGE_RADIUS_METERS = (typeof window !== 'undefined' && window.INCIDENT_MERGE_RADIUS_METERS) ? window.INCIDENT_MERGE_RADIUS_METERS : 100;
const _INCIDENT_DECAY_CONFIG = (typeof window !== 'undefined' && window.INCIDENT_DECAY_CONFIG) ? window.INCIDENT_DECAY_CONFIG : (_CONFIG.decay || {});
const _DEMO_USER_ID = (typeof window !== 'undefined' && window.DEMO_USER_ID) ? window.DEMO_USER_ID : 'demo-user-default';
const _distanceMeters = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : ((typeof window !== 'undefined' && window.haversineMeters) ? window.haversineMeters : (lat1, lng1, lat2, lng2) => 0);

/**
 * Danh sách sự cố giao thông thời gian thực.
 * Bắt đầu rỗng: không còn dữ liệu mẫu hard-code. Sự cố sẽ được tạo động
 * khi người dùng báo cáo qua nút "Báo cáo sự cố" (xem addOrConfirmIncident).
 */
let incidents = [];

/**
 * Tính confidence hiện tại của incident dựa trên mô hình Half-Life decay theo thời gian thực.
 * Công thức: C(t) = C_0 * (0.5)^(elapsedHours / halfLifeHours)
 * 
 * @param {Object} incident 
 * @param {number} [now=Date.now()]
 * @returns {number} Giá trị trong khoảng [0, 100]
 */
function calculateCurrentConfidence(incident, now = Date.now()) {
  const decayConfig = (typeof window !== 'undefined' && window.INCIDENT_DECAY_CONFIG) ? window.INCIDENT_DECAY_CONFIG : _INCIDENT_DECAY_CONFIG;
  const cfg = decayConfig[incident.type] || { halfLifeHours: 24 };
  const lastActivity = incident.lastConfirmedAt || incident.createdAt || now;
  const elapsedHours = Math.max(0, (now - lastActivity) / (1000 * 60 * 60));
  const c = incident.confidence * Math.pow(0.5, elapsedHours / cfg.halfLifeHours);
  return Math.max(0, Math.min(100, c));
}

/**
 * Xác định mã màu CSS biểu thị mức độ tin cậy
 * @param {number} c - Confidence [0, 100]
 * @returns {string} Biến CSS màu
 */
function getConfidenceColor(c) {
  if (c >= 70) return 'var(--risk-low)';
  if (c >= 40) return 'var(--risk-mid)';
  return 'var(--risk-high)';
}

/**
 * Dọn dẹp các sự cố đã hết hạn (confidence suy giảm dưới ngưỡng 0.1)
 */
function cleanupExpiredIncidents() {
  const now = Date.now();
  const before = incidents.length;
  incidents = incidents.filter(inc => {
    const c = calculateCurrentConfidence(inc, now);
    inc.confidence = c;
    return c > 0.1;
  });

  if (incidents.length !== before) {
    if (typeof window !== 'undefined' && typeof window.renderIncidents === 'function') {
      window.renderIncidents();
    }
  }
  if (typeof window !== 'undefined' && typeof window.renderNearbyPanel === 'function') {
    window.renderNearbyPanel();
  }
}

// Chạy định kỳ dọn dẹp decay mỗi 60 giây
setInterval(cleanupExpiredIncidents, 60 * 1000);

/**
 * Thêm mới hoặc xác nhận gộp sự cố từ cộng đồng
 * @param {Object} data 
 */
function addOrConfirmIncident(data) {
  cleanupExpiredIncidents();

  // Tìm sự cố cùng loại, nằm trong bán kính INCIDENT_MERGE_RADIUS_METERS
  const mergeRadius = (typeof window !== 'undefined' && window.INCIDENT_MERGE_RADIUS_METERS) ? window.INCIDENT_MERGE_RADIUS_METERS : _INCIDENT_MERGE_RADIUS_METERS;
  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  const demoUser = (typeof window !== 'undefined' && window.DEMO_USER_ID) ? window.DEMO_USER_ID : _DEMO_USER_ID;

  const nearby = incidents.find(inc => {
    if (inc.type !== data.type) return false;
    const c = calculateCurrentConfidence(inc);
    if (c <= 0) return false;
    return distFn(inc.lat, inc.lng, data.lat, data.lng) <= mergeRadius;
  });

  if (nearby) {
    // Chống spam: không cho cùng 1 user xác nhận liên tục
    if (nearby.reporterIds && nearby.reporterIds.includes(demoUser)) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Bạn đã báo cáo hoặc xác nhận sự cố này rồi.');
      }
      return;
    }

    const currentC = calculateCurrentConfidence(nearby);
    nearby.confidence = Math.min(100, currentC + 50);
    nearby.lastConfirmedAt = Date.now();
    nearby.reporterCount = (nearby.reporterCount || 1) + 1;
    nearby.reporterIds = [...(nearby.reporterIds || []), demoUser];

    if (typeof window !== 'undefined') {
      if (typeof window.renderIncidents === 'function') window.renderIncidents();
      if (typeof window.renderNearbyPanel === 'function') window.renderNearbyPanel();
      if (typeof window.showToast === 'function') {
        window.showToast(`Đã xác nhận sự cố. Độ tin cậy: ${Math.round(nearby.confidence)}%`);
      }
      window.dispatchEvent(new CustomEvent('incidents-changed'));
    }
    return;
  }

  // Tạo incident mới
  const newInc = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'inc-' + Date.now(),
    type: data.type,
    level: data.level,
    lat: data.lat,
    lng: data.lng,
    desc: data.desc,
    confidence: 50,
    reporterCount: 1,
    reporterIds: [demoUser],
    createdAt: Date.now(),
    lastConfirmedAt: Date.now(),
  };

  incidents.push(newInc);

  if (typeof window !== 'undefined') {
    if (typeof window.renderIncidents === 'function') window.renderIncidents();
    if (typeof window.renderNearbyPanel === 'function') window.renderNearbyPanel();
    window.dispatchEvent(new CustomEvent('incidents-changed'));
  }
}

/**
 * Vote xác nhận sự cố trực tiếp từ Popup bản đồ (+50% confidence)
 * @param {string} id 
 */
function voteConfirmIncident(id) {
  const inc = incidents.find(item => item.id === id);
  if (!inc) return;

  const demoUser = (typeof window !== 'undefined' && window.DEMO_USER_ID) ? window.DEMO_USER_ID : _DEMO_USER_ID;

  if (inc.reporterIds && inc.reporterIds.includes(demoUser)) {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('Bạn đã xác nhận sự cố này rồi.');
    }
    return;
  }

  const currentC = calculateCurrentConfidence(inc);
  inc.confidence = Math.min(100, currentC + 50);
  inc.lastConfirmedAt = Date.now();
  inc.reporterCount = (inc.reporterCount || 1) + 1;
  inc.reporterIds = [...(inc.reporterIds || []), demoUser];

  if (typeof window !== 'undefined') {
    if (typeof window.renderIncidents === 'function') window.renderIncidents();
    if (typeof window.renderNearbyPanel === 'function') window.renderNearbyPanel();
    if (typeof window.showToast === 'function') {
      window.showToast(`Cảm ơn bạn! Độ tin cậy tăng lên: ${Math.round(inc.confidence)}%`);
    }
    window.dispatchEvent(new CustomEvent('incidents-changed'));
  }
}

/**
 * Đánh dấu sự cố đã hết / không còn tồn tại
 * @param {string} id 
 */
function dismissIncident(id) {
  const inc = incidents.find(item => item.id === id);
  if (!inc) return;

  inc.confidence = Math.max(0, inc.confidence - 60);
  if (inc.confidence <= 10) {
    incidents = incidents.filter(item => item.id !== id);
  }

  if (typeof window !== 'undefined') {
    if (typeof window.renderIncidents === 'function') window.renderIncidents();
    if (typeof window.renderNearbyPanel === 'function') window.renderNearbyPanel();
    if (typeof window.showToast === 'function') {
      window.showToast('Đã ghi nhận thông báo hết sự cố.');
    }
    window.dispatchEvent(new CustomEvent('incidents-changed'));
  }
}

// Gắn lên window để truy cập từ giao diện HTML
if (typeof window !== 'undefined') {
  // Dùng getter/setter để window.incidents luôn trỏ tới mảng hiện hành
  // (cleanupExpiredIncidents / dismissIncident gán lại `incidents = incidents.filter(...)`,
  // nếu chỉ gán một lần thì map.js đọc window.incidents sẽ thấy mảng cũ và không vẽ sự cố mới).
  Object.defineProperty(window, 'incidents', {
    get() { return incidents; },
    set(v) { incidents = v; },
    configurable: true
  });
  window.calculateCurrentConfidence = calculateCurrentConfidence;
  window.getConfidenceColor = getConfidenceColor;
  window.cleanupExpiredIncidents = cleanupExpiredIncidents;
  window.addOrConfirmIncident = addOrConfirmIncident;
  window.voteConfirmIncident = voteConfirmIncident;
  window.dismissIncident = dismissIncident;
}