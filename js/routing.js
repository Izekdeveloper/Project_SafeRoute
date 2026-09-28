/**
 * ============================================================================
 * SafeRoute Research Project: Route Finding, Risk Scoring & Multimodal Fallback
 * File: js/routing.js
 * 
 * Mục đích nghiên cứu:
 * Chịu trách nhiệm tính toán đường đi, đánh giá rủi ro tuyến đường từ các sự cố lân cận,
 * sắp xếp thứ tự ưu tiên đa tiêu chí (Multi-Criteria Route Ranking),
 * và kích hoạt phương án trung chuyển đa phương thức (Multimodal Fallback)
 * khi không tồn tại lộ trình đường bộ nội địa khép kín trong lãnh thổ Việt Nam.
 * ============================================================================
 */

const _minDistanceToPolyline = (typeof window !== 'undefined' && window.minDistanceToPolyline) ? window.minDistanceToPolyline : (() => Infinity);
const _ROUTE_COLORS = (typeof window !== 'undefined' && window.ROUTE_COLORS) ? window.ROUTE_COLORS : ['#2f7ee0', '#f08a1c', '#12b76a', '#8a4fe0', '#e3492c'];


/* ---------------------------------------------------------------
   1. ĐỊNH NGHĨA RANH GIỚI VIỆT NAM (VIETNAM BORDER VALIDATION)
--------------------------------------------------------------- */
// Khoảng cách đường chim bay tối thiểu (km) để đề xuất phương án trung chuyển
const MULTIMODAL_MIN_DISTANCE_KM = 300;

const VIETNAM_MAINLAND_POLYGON = [
  // Tây Bắc (Điện Biên - Lai Châu - Lào Cai)
  [22.40, 102.15], [22.50, 102.35], [22.75, 102.65], [22.80, 103.00], [22.65, 103.40],
  [22.55, 103.80], [22.60, 104.00], [22.70, 104.15],
  // Đông Bắc (Hà Giang - Cao Bằng - Lạng Sơn - Quảng Ninh)
  [22.75, 104.45], [23.00, 104.85], [23.25, 105.15], [23.39, 105.32], [23.15, 105.65],
  [23.00, 105.90], [22.95, 106.15], [22.88, 106.50], [22.75, 106.75], [22.50, 106.80],
  [22.25, 106.55], [21.88, 106.82], [21.65, 107.05], [21.55, 107.30], [21.55, 107.50],
  [21.53, 107.97],
  // Bờ biển phía Đông (Quảng Ninh đến Cà Mau) - có đệm biển 5-15km
  [21.55, 108.10], [21.20, 108.05], [20.75, 107.30], [20.50, 106.90], [20.00, 106.60],
  [19.50, 106.20], [19.00, 106.10], [18.30, 106.50], [17.80, 106.85], [17.10, 107.40],
  [16.80, 107.75], [16.40, 108.05], [16.15, 108.50], [15.80, 108.70], [15.30, 109.05],
  [14.70, 109.25], [14.00, 109.35], [13.40, 109.45], [12.80, 109.50], [12.20, 109.45],
  [11.60, 109.25], [11.10, 109.00], [10.60, 108.30], [10.25, 107.50], [10.15, 107.00],
  [9.95, 106.75],  [9.40, 106.40],  [8.80, 105.80],  [8.40, 105.00],  [8.45, 104.70],
  // Vịnh Thái Lan (Cà Mau đến Hà Tiên)
  [8.70, 104.55], [9.15, 104.60], [9.60, 104.70], [10.10, 104.30], [10.38, 104.40],
  [10.45, 104.45],
  // Biên giới Tây Nam với Campuchia (Kiên Giang đến Kon Tum)
  [10.55, 104.55], [10.65, 104.90], [10.75, 105.15], [10.95, 105.20], [11.00, 105.50],
  [11.10, 105.85], [11.45, 106.00], [11.75, 106.05], [11.95, 106.55], [12.15, 106.80],
  [12.28, 107.12], [12.15, 107.30], [12.35, 107.48], [12.50, 107.55], [12.80, 107.50],
  [13.15, 107.45], [13.45, 107.52], [13.78, 107.50], [14.05, 107.52], [14.30, 107.50],
  [14.69, 107.56],
  // Biên giới Tây với Lào
  [15.00, 107.65], [15.25, 107.55], [15.55, 107.45], [15.85, 107.40], [16.15, 107.25],
  [16.32, 107.15], [16.50, 106.85], [16.62, 106.60], [16.85, 106.55], [17.15, 106.28],
  [17.40, 105.95], [17.75, 105.75], [18.15, 105.45], [18.35, 105.18], [18.55, 105.25],
  [18.85, 105.00], [19.15, 104.60], [19.38, 104.12], [19.65, 104.00], [19.95, 104.08],
  [20.30, 104.50], [20.55, 104.62], [20.65, 104.82], [20.72, 104.60], [20.75, 104.30],
  [20.90, 103.80], [21.05, 103.45], [21.25, 103.05], [21.50, 102.95], [21.80, 102.85],
  [22.15, 102.40], [22.40, 102.15]
];

const PHU_QUOC_POLYGON = [
  [9.95, 103.80], [10.50, 103.80], [10.50, 104.20], [9.95, 104.20]
];

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > lng) !== (yj > lng))
        && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInVietnam(lat, lng) {
  return pointInPolygon(lat, lng, VIETNAM_MAINLAND_POLYGON) ||
         pointInPolygon(lat, lng, PHU_QUOC_POLYGON);
}

function isRouteInsideVietnam(route) {
  const coords = route.coords;
  if (!coords || coords.length === 0) return false;
  const step = Math.max(1, Math.floor(coords.length / 120));
  for (let i = 0; i < coords.length; i += step) {
    if (!isPointInVietnam(coords[i][0], coords[i][1])) return false;
  }
  if (!isPointInVietnam(coords[coords.length - 1][0], coords[coords.length - 1][1])) return false;
  return true;
}

/* ---------------------------------------------------------------
   2. TRUY VẤN OSRM ROUTING API
--------------------------------------------------------------- */
async function fetchOsrmRawRoute(waypoints) {
  const coordStr = waypoints.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) return [];
  return data.routes.map((route, index) => ({
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: route.distance / 1000,
    duration: route.duration / 60,
    legs: route.legs,
    routeIndex: index,
    riskScore: 0,
    source: 'osrm'
  }));
}

async function findSafeRoutes(start, end) {
  let initialRoutes = [];
  try {
    initialRoutes = await fetchOsrmRawRoute([start, end]);
  } catch (err) {
    console.warn('OSRM raw route error:', err.message);
  }

  let validRoutes = initialRoutes.filter(r => isRouteInsideVietnam(r));

  // Thử các waypoint nội địa nếu OSRM mặc định đi vòng qua biên giới
  if (validRoutes.length === 0) {
    const minLat = Math.min(start.lat, end.lat);
    const maxLat = Math.max(start.lat, end.lat);
    const candidateWps = [
      { lat: 16.0544, lng: 108.2022 }, // Đà Nẵng
      { lat: 13.7830, lng: 109.2197 }, // Quy Nhơn
      { lat: 18.6796, lng: 105.6813 }, // Vinh
      { lat: 12.2388, lng: 109.1967 }, // Nha Trang
    ].filter(wp => wp.lat > minLat + 0.3 && wp.lat < maxLat - 0.3);

    for (const wp of candidateWps) {
      try {
        const segRoutes = await fetchOsrmRawRoute([start, wp, end]);
        const ok = segRoutes.filter(r => isRouteInsideVietnam(r));
        if (ok.length > 0) {
          validRoutes.push(...ok);
          break;
        }
      } catch (_) {}
    }
  }

  // Đích quá xa (>= 300km): luôn đề xuất thêm phương án trung chuyển 3 chặng
  // (đường bộ -> máy bay/tàu -> đường bộ), hiển thị song song với các tuyến đường bộ.
  if (typeof window !== 'undefined') window.transportFallback = null;
  const directDistKm = haversineKm(start.lat, start.lng, end.lat, end.lng);
  if (directDistKm >= MULTIMODAL_MIN_DISTANCE_KM) {
    try {
      const plan = await planMultimodalFallback(start, end);
      if (typeof window !== 'undefined') window.transportFallback = plan;
    } catch (err) {
      console.warn('[SafeRoute] Không lập được phương án trung chuyển:', err);
    }
  }
  if (validRoutes.length === 0) return [];

  return validRoutes.map((route, index) => ({
    ...route,
    id: String.fromCharCode(65 + index),
    routeIndex: index,
  }));
}

/* ---------------------------------------------------------------
   3. PHƯƠNG ÁN TRUNG CHUYỂN SÂN BAY / GA TÀU (FALLBACK)
--------------------------------------------------------------- */
const OSM_VERIFIED_HUBS = [
  // Sân bay
  { name: 'Sân bay Quốc tế Tân Sơn Nhất', lat: 10.8188, lng: 106.6519, type: 'airport' },
  { name: 'Sân bay Quốc tế Nội Bài', lat: 21.2212, lng: 105.8072, type: 'airport' },
  { name: 'Sân bay Quốc tế Đà Nẵng', lat: 16.0439, lng: 108.1994, type: 'airport' },
  { name: 'Sân bay Quốc tế Cam Ranh', lat: 11.9982, lng: 109.2194, type: 'airport' },
  { name: 'Sân bay Quốc tế Phú Bài (Huế)', lat: 16.4011, lng: 107.7031, type: 'airport' },
  { name: 'Sân bay Quốc tế Cát Bi (Hải Phòng)', lat: 20.8194, lng: 106.7247, type: 'airport' },
  { name: 'Sân bay Quốc tế Vinh', lat: 18.7275, lng: 105.6703, type: 'airport' },
  { name: 'Sân bay Quốc tế Cần Thơ', lat: 10.0851, lng: 105.7119, type: 'airport' },
  { name: 'Sân bay Liên Khương (Đà Lạt)', lat: 11.7506, lng: 108.3742, type: 'airport' },
  { name: 'Sân bay Phù Cát (Quy Nhơn)', lat: 13.9553, lng: 109.0422, type: 'airport' },
  { name: 'Sân bay Pleiku', lat: 14.0044, lng: 108.0169, type: 'airport' },
  { name: 'Sân bay Buôn Ma Thuột', lat: 12.6683, lng: 108.1203, type: 'airport' },
  // Ga tàu
  { name: 'Ga Sài Gòn', lat: 10.7828, lng: 106.6778, type: 'railway' },
  { name: 'Ga Hà Nội', lat: 21.0245, lng: 105.8412, type: 'railway' },
  { name: 'Ga Đà Nẵng', lat: 16.0719, lng: 108.2144, type: 'railway' },
  { name: 'Ga Huế', lat: 16.4589, lng: 107.5794, type: 'railway' },
  { name: 'Ga Nha Trang', lat: 12.2497, lng: 109.1869, type: 'railway' },
  { name: 'Ga Vinh', lat: 18.6814, lng: 105.6669, type: 'railway' }
];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestHub(point, type) {
  const candidates = OSM_VERIFIED_HUBS.filter(h => h.type === type);
  let nearest = null, minDist = Infinity;
  for (const h of candidates) {
    const d = haversineKm(point.lat, point.lng, h.lat, h.lng);
    if (d < minDist) { minDist = d; nearest = h; }
  }
  return { hub: nearest, distanceKm: minDist };
}

function estimateTransitDuration(distanceKm, type) {
  if (type === 'airport') return Math.round((distanceKm / 750) * 60 + 90);
  return Math.round((distanceKm / 70) * 60 + 30);
}

async function planMultimodalFallback(start, end) {
  const totalDirectDist = haversineKm(start.lat, start.lng, end.lat, end.lng);
  const transitType = totalDirectDist >= 600 ? 'airport' : 'railway';

  const originHubInfo = findNearestHub(start, transitType);
  const destHubInfo = findNearestHub(end, transitType);
  if (!originHubInfo.hub || !destHubInfo.hub || originHubInfo.hub.name === destHubInfo.hub.name) {
    return null;
  }

  const originHub = originHubInfo.hub;
  const destHub = destHubInfo.hub;

  let roadToOriginHub = null, roadFromDestHub = null;
  try {
    const routes1 = await fetchOsrmRawRoute([start, originHub]);
    if (routes1.length) roadToOriginHub = routes1[0];
  } catch (_) {}

  try {
    const routes2 = await fetchOsrmRawRoute([destHub, end]);
    if (routes2.length) roadFromDestHub = routes2[0];
  } catch (_) {}

  if (!roadToOriginHub) {
    roadToOriginHub = {
      coords: [[start.lat, start.lng], [originHub.lat, originHub.lng]],
      distance: originHubInfo.distanceKm,
      duration: (originHubInfo.distanceKm / 40) * 60
    };
  }
  if (!roadFromDestHub) {
    roadFromDestHub = {
      coords: [[destHub.lat, destHub.lng], [end.lat, end.lng]],
      distance: destHubInfo.distanceKm,
      duration: (destHubInfo.distanceKm / 40) * 60
    };
  }

  roadToOriginHub.riskScore = calculateRouteRisk(roadToOriginHub);
  roadFromDestHub.riskScore = calculateRouteRisk(roadFromDestHub);

  const transitDistKm = haversineKm(originHub.lat, originHub.lng, destHub.lat, destHub.lng);
  const transitDurationMins = estimateTransitDuration(transitDistKm, transitType);

  return {
    originHub,
    destinationHub: destHub,
    roadToOriginHub,
    roadFromDestinationHub: roadFromDestHub,
    transit: {
      type: transitType,
      distance: transitDistKm,
      estimatedDuration: transitDurationMins
    },
    totalEstimatedDuration: roadToOriginHub.duration + transitDurationMins + roadFromDestHub.duration
  };
}

function renderTransportFallback(fallback, opts = {}) {
  if (routeLayerGroup) routeLayerGroup.clearLayers();
  if (!transportFallbackLayerGroup) return;
  transportFallbackLayerGroup.clearLayers();

  const transitTypeLabel = fallback.transit.type === 'airport' ? 'Hàng không' : 'Đường sắt';
  const transitColor = fallback.transit.type === 'airport' ? '#0ea5e9' : '#f08a1c';
  const bounds = [];

  // Chặng 1: Đường bộ (start -> originHub)
  L.polyline(fallback.roadToOriginHub.coords, {
    color: '#2f7ee0', weight: 6, opacity: 0.95
  }).addTo(transportFallbackLayerGroup);
  fallback.roadToOriginHub.coords.forEach(c => bounds.push(c));

  // Chặng 2: Trung chuyển (originHub -> destHub)
  const transitCoords = [
    [fallback.originHub.lat, fallback.originHub.lng],
    [fallback.destinationHub.lat, fallback.destinationHub.lng]
  ];
  L.polyline(transitCoords, {
    color: transitColor, weight: 4, dashArray: '6, 8', opacity: 0.9
  }).addTo(transportFallbackLayerGroup);
  transitCoords.forEach(c => bounds.push(c));

  // Chặng 3: Đường bộ (destHub -> end)
  L.polyline(fallback.roadFromDestinationHub.coords, {
    color: '#2f7ee0', weight: 6, opacity: 0.95
  }).addTo(transportFallbackLayerGroup);
  fallback.roadFromDestinationHub.coords.forEach(c => bounds.push(c));

  // Markers
  [fallback.originHub, fallback.destinationHub].forEach((hub, idx) => {
    const isOrigin = idx === 0;
    const hubIcon = L.divIcon({
      className: '',
      html: `<div class="transport-hub-combo">
        <div class="transport-hub-note"><span class="th-title">${escapeHtml(hub.name)}</span></div>
        <div class="transport-hub-marker ${hub.type}"><i class="fa-solid ${hub.type === 'airport' ? 'fa-plane' : 'fa-train'}"></i></div>
      </div>`,
      iconSize: [140, 60],
      iconAnchor: [70, 56]
    });
    L.marker([hub.lat, hub.lng], { icon: hubIcon }).addTo(transportFallbackLayerGroup);
  });

  if (bounds.length && map) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }

  const resultsEl = document.getElementById('route-results');
  if (!resultsEl) return;
  resultsEl.classList.add('show');

  const rc1 = fallback.roadToOriginHub.riskScore >= 66 ? 'var(--risk-high)' : fallback.roadToOriginHub.riskScore >= 34 ? 'var(--risk-mid)' : 'var(--risk-low)';
  const rc3 = fallback.roadFromDestinationHub.riskScore >= 66 ? 'var(--risk-high)' : fallback.roadFromDestinationHub.riskScore >= 34 ? 'var(--risk-mid)' : 'var(--risk-low)';

  resultsEl.innerHTML = `
    <div class="transport-fallback-card">
      ${opts.canGoBack ? `<button class="choose-btn tf-back-btn" onclick="backToRoadRoutes()"><i class="fa-solid fa-arrow-left"></i> Quay lại các tuyến đường bộ</button>` : ''}
      <div class="tf-badge"><i class="fa-solid fa-route"></i> PHƯƠNG ÁN KẾT HỢP TRUNG CHUYỂN (3 CHẶNG)</div>
      <p class="tf-notice">
        ${opts.canGoBack ? 'Điểm đến khá xa, bạn có thể thay đi đường bộ toàn tuyến bằng phương án kết hợp trung chuyển giữa' : 'Không tìm thấy tuyến đường bộ liên tục 100% trong lãnh thổ Việt Nam. Hệ thống đề xuất phương án kết hợp trung chuyển giữa'} <b>${escapeHtml(fallback.originHub.name)}</b> và <b>${escapeHtml(fallback.destinationHub.name)}</b>.
      </p>
      <div class="tf-leg-card">
        <div class="tf-leg-head"><span class="tf-leg-tag">Chặng 1: Đường bộ</span><span class="tf-leg-dest">Đến ${escapeHtml(fallback.originHub.name)}</span></div>
        <div class="route-stats">
          <div class="stat"><b>${fallback.roadToOriginHub.distance.toFixed(1)} km</b><span>Quãng đường</span></div>
          <div class="stat"><b>${Math.round(fallback.roadToOriginHub.duration)} phút</b><span>Thời gian</span></div>
        </div>
        <div class="risk-row">
          <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${fallback.roadToOriginHub.riskScore}%;background:${rc1}"></div></div>
          <span class="risk-value" style="color:${rc1}">Mức rủi ro: ${fallback.roadToOriginHub.riskScore}/100</span>
        </div>
      </div>
      <div class="tf-leg-card transit">
        <div class="tf-leg-head"><span class="tf-leg-tag ${fallback.transit.type === 'airport' ? 'plane' : 'train'}">Chặng 2: Trung chuyển ${transitTypeLabel.toLowerCase()} dự kiến</span><span class="tf-leg-dest">${escapeHtml(fallback.originHub.name)} → ${escapeHtml(fallback.destinationHub.name)}</span></div>
        <div class="route-stats">
          <div class="stat"><b>~${fallback.transit.distance.toFixed(0)} km</b><span>Khoảng cách</span></div>
          <div class="stat"><b>~${fallback.transit.estimatedDuration} phút</b><span>Dự kiến</span></div>
        </div>
        <div class="tf-transit-note"><i class="fa-solid fa-circle-info"></i> Chặng trung chuyển là phương án dự kiến chưa kiểm tra lịch trình thực tế.</div>
      </div>
      <div class="tf-leg-card">
        <div class="tf-leg-head"><span class="tf-leg-tag">Chặng 3: Đường bộ</span><span class="tf-leg-dest">Đến ${escapeHtml((window.endLocation || endLocation) ? (window.endLocation || endLocation).label : 'Điểm đích')}</span></div>
        <div class="route-stats">
          <div class="stat"><b>${fallback.roadFromDestinationHub.distance.toFixed(1)} km</b><span>Quãng đường</span></div>
          <div class="stat"><b>${Math.round(fallback.roadFromDestinationHub.duration)} phút</b><span>Thời gian</span></div>
        </div>
        <div class="risk-row">
          <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${fallback.roadFromDestinationHub.riskScore}%;background:${rc3}"></div></div>
          <span class="risk-value" style="color:${rc3}">Mức rủi ro: ${fallback.roadFromDestinationHub.riskScore}/100</span>
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------
   4. CHẤM ĐIỂM RỦI RO & SẮP XẾP TUYẾN
--------------------------------------------------------------- */
function calculateRouteRisk(route) {
  let raw = 0;
  for (const inc of incidents) {
    const c = calculateCurrentConfidence(inc);
    if (c <= 0) continue;
    const distM = minDistanceToPolyline(inc.lat, inc.lng, route.coords);
    let distW = 0;
    if (distM < RISK_IMPACT.STRONG_THRESHOLD_M) distW = RISK_IMPACT.STRONG_WEIGHT;
    else if (distM < RISK_IMPACT.MEDIUM_THRESHOLD_M) distW = RISK_IMPACT.MEDIUM_WEIGHT;
    if (distW === 0) continue;
    raw += distW * (INCIDENT_TYPE_WEIGHT[inc.type] || 0.1) * (INCIDENT_LEVEL_WEIGHT[inc.level] || 0.2) * (c / 100);
  }
  return Math.min(100, Math.round((raw / 3.0) * 100));
}

function sortRoutesByMode(routes, mode) {
  const alpha = CONFIG.mode_alpha[mode] ?? 1;
  return [...routes].sort((a, b) => {
    const wA = a.duration * (1 + alpha * a.riskScore / 100);
    const wB = b.duration * (1 + alpha * b.riskScore / 100);
    return wA - wB;
  });
}

/* ---------------------------------------------------------------
   5. HƯỚNG DẪN TỪNG BƯỚC (TURN-BY-TURN STEPS)
--------------------------------------------------------------- */
function buildStepInstruction(step) {
  const type = step.maneuver?.type || '';
  const mod = step.maneuver?.modifier || '';
  const name = step.name ? `đường ${step.name}` : 'tiếp tục';
  const map2 = {
    depart: '🚦 Xuất phát', arrive: '🏁 Đến điểm đích',
    turn: mod.includes('left') ? '↰ Rẽ trái vào' : '↱ Rẽ phải vào',
    'new name': '➡️ Đổi sang', merge: '↗️ Nhập vào',
    fork: mod.includes('left') ? '↰ Rẽ trái tại ngã ba' : '↱ Rẽ phải tại ngã ba',
    'end of road': mod.includes('left') ? '↰ Rẽ trái' : '↱ Rẽ phải',
    continue: '⬆️ Đi thẳng', roundabout: '🔄 Vào vòng xuyến',
    rotary: '🔄 Vào vòng xuyến',
  };
  const prefix = map2[type] || '➡️ Đi';
  return type === 'arrive' ? prefix : `${prefix} ${name}`;
}

function buildStepsHtml(legs) {
  if (!legs?.length) return '';
  const steps = legs.flatMap(leg => leg.steps || []);
  if (!steps.length) return '';
  return `<details class="route-steps-details">
    <summary><i class="fa-solid fa-list-ul"></i> Xem hướng dẫn chi tiết</summary>
    <ul class="route-steps">
      ${steps.map(s => {
        const dist = s.distance >= 1000
          ? (s.distance / 1000).toFixed(1) + ' km'
          : Math.round(s.distance) + ' m';
        return `<li class="route-step">
          <span class="step-instr">${escapeHtml(buildStepInstruction(s))}</span>
          <span class="step-dist">${dist}</span>
        </li>`;
      }).join('')}
    </ul>
  </details>`;
}

function renderRouteSteps(route) {
  if (!route.legs) return '';
  return buildStepsHtml(route.legs);
}

/* ---------------------------------------------------------------
   6. VẼ CÁC TUYẾN LÊN BẢN ĐỒ & HIỂN THỊ KẾT QUẢ
--------------------------------------------------------------- */
function renderRoutes(routes, mode) {
  if (transportFallbackLayerGroup) transportFallbackLayerGroup.clearLayers();
  if (!routeLayerGroup) return;
  routeLayerGroup.clearLayers();

  const sorted = sortRoutesByMode(routes, mode);
  const bounds = [];

  let selectedRouteId = (typeof window !== 'undefined') ? window.selectedRouteId : null;
  if (!selectedRouteId || !sorted.some(r => r.id === selectedRouteId)) {
    selectedRouteId = sorted[0]?.id || null;
    if (typeof window !== 'undefined') window.selectedRouteId = selectedRouteId;
  }

  sorted.forEach((route, idx) => {
    const isSelected = route.id === selectedRouteId;
    const color = ROUTE_COLORS[route.routeIndex] || ROUTE_COLORS[0];

    const polyline = L.polyline(route.coords, {
      color: color,
      weight: isSelected ? 6 : 4,
      opacity: isSelected ? 0.95 : 0.55,
      dashArray: isSelected ? null : '3 7'
    }).addTo(routeLayerGroup);

    if (isSelected) polyline.bringToFront();

    polyline.on('click', () => chooseRoute(route.id));
    polyline.bindTooltip(`Tuyến ${route.id} · ${route.distance.toFixed(1)} km · ${Math.round(route.duration)} phút${isSelected ? ' (Đang chọn)' : ''}`, { sticky: true });
    route.coords.forEach(c => bounds.push(c));
  });

  if (bounds.length && map) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }

  const resultsEl = document.getElementById('route-results');
  if (!resultsEl) return;
  resultsEl.classList.add('show');
  const modeName = mode === 'fastest' ? 'NHANH NHẤT' : mode === 'balanced' ? 'CÂN BẰNG' : 'AN TOÀN NHẤT';

  resultsEl.innerHTML = `<p class="panel-title" style="margin-top:4px;">KẾT QUẢ TUYẾN ĐƯỜNG</p>
    <p class="routes-summary">Tìm thấy ${sorted.length} tuyến đường</p>` +
    sorted.map((route, idx) => {
      const isSelected = route.id === selectedRouteId;
      const isRecommended = idx === 0;
      const rc = route.riskScore >= 66 ? 'var(--risk-high)' : route.riskScore >= 34 ? 'var(--risk-mid)' : 'var(--risk-low)';
      const color = ROUTE_COLORS[route.routeIndex] || ROUTE_COLORS[0];
      return `<div class="route-card ${isSelected ? 'best selected' : ''}">
        <div class="route-card-head">
          <span class="title" style="color:${color}">● Tuyến ${route.id}</span>
          ${isRecommended ? `<span class="badge">Đề xuất (${modeName})</span>` : ''}
        </div>
        <div class="route-stats">
          <div class="stat"><b>${route.distance.toFixed(1)} km</b><span>Quãng đường</span></div>
          <div class="stat"><b>${Math.round(route.duration)} phút</b><span>Thời gian</span></div>
        </div>
        <div class="risk-row">
          <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${route.riskScore}%;background:${rc}"></div></div>
          <span class="risk-value" style="color:${rc}">${route.riskScore}/100</span>
        </div>
        ${renderRouteSteps(route)}
        ${isSelected
          ? `<button class="choose-btn selected" style="background:var(--primary);color:#fff;cursor:default;">✓ Đang chọn</button>`
          : `<button class="choose-btn" onclick="chooseRoute('${route.id}')">Chọn tuyến này</button>`
        }
      </div>`;
    }).join('') + buildMultimodalOptionCard();
}

/* ---------------------------------------------------------------
   6b. THẺ "PHƯƠNG ÁN TRUNG CHUYỂN 3 CHẶNG" HIỂN THỊ CÙNG CÁC TUYẾN BỘ
--------------------------------------------------------------- */
function formatMinutes(mins) {
  const m = Math.round(mins);
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

function buildMultimodalOptionCard() {
  const fb = (typeof window !== 'undefined') ? window.transportFallback : null;
  if (!fb) return '';
  const isAir = fb.transit.type === 'airport';
  const modeLabel = isAir ? 'Máy bay' : 'Tàu hỏa';
  const icon = isAir ? 'fa-plane' : 'fa-train';
  const worst = Math.max(fb.roadToOriginHub.riskScore || 0, fb.roadFromDestinationHub.riskScore || 0);
  const rc = worst >= 66 ? 'var(--risk-high)' : worst >= 34 ? 'var(--risk-mid)' : 'var(--risk-low)';
  const roadKm = fb.roadToOriginHub.distance + fb.roadFromDestinationHub.distance;
  return `<div class="route-card tf-option-card">
    <div class="route-card-head">
      <span class="title" style="color:#0ea5e9"><i class="fa-solid ${icon}"></i> Trung chuyển 3 chặng</span>
      <span class="badge">${modeLabel}</span>
    </div>
    <p class="tf-option-route">${escapeHtml(fb.originHub.name)} → ${escapeHtml(fb.destinationHub.name)}</p>
    <div class="route-stats">
      <div class="stat"><b>~${formatMinutes(fb.totalEstimatedDuration)}</b><span>Tổng thời gian dự kiến</span></div>
      <div class="stat"><b>${roadKm.toFixed(0)} km</b><span>Đường bộ (2 chặng)</span></div>
    </div>
    <div class="risk-row">
      <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${worst}%;background:${rc}"></div></div>
      <span class="risk-value" style="color:${rc}">${worst}/100</span>
    </div>
    <button class="choose-btn" onclick="showMultimodalOption()">Xem phương án này</button>
  </div>`;
}

function showMultimodalOption() {
  const fb = window.transportFallback;
  if (!fb) return;
  renderTransportFallback(fb, { canGoBack: (window.currentRoutes || []).length > 0 });
}

function backToRoadRoutes() {
  const routes = window.currentRoutes || [];
  if (routes.length) renderRoutes(routes, window.selectedMode || 'balanced');
}

function chooseRoute(id) {
  const currentRoutes = (typeof window !== 'undefined') ? window.currentRoutes : [];
  const target = currentRoutes.find(r => r.id === id);
  if (!target) return;
  if (typeof window !== 'undefined') {
    window.selectedRouteId = id;
    renderRoutes(currentRoutes, window.selectedMode || 'balanced');
    if (typeof window.showToast === 'function') window.showToast(`Đã chọn Tuyến ${id}. Bắt đầu chỉ đường...`);
  }
}

// Gắn lên window
if (typeof window !== 'undefined') {
  window.findSafeRoutes = findSafeRoutes;
  window.calculateRouteRisk = calculateRouteRisk;
  window.sortRoutesByMode = sortRoutesByMode;
  window.renderRoutes = renderRoutes;
  window.chooseRoute = chooseRoute;
  window.renderTransportFallback = renderTransportFallback;
  window.planMultimodalFallback = planMultimodalFallback;
  window.showMultimodalOption = showMultimodalOption;
  window.backToRoadRoutes = backToRoadRoutes;
}