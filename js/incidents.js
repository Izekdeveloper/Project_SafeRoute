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

function _isDebugMerge() {
  return (typeof window !== 'undefined' && window.DEBUG_MERGE != null)
    ? window.DEBUG_MERGE === true
    : ((typeof window !== 'undefined' && window.DEBUG_ROUTING != null)
      ? window.DEBUG_ROUTING === true
      : (typeof CONFIG !== 'undefined' && CONFIG.debug_routing === true));
}

/**
 * Ghi log debug quá trình gộp node sự cố
 */
function logMergeDebug(info) {
  if (_isDebugMerge() && typeof console !== 'undefined' && console.debug) {
    console.debug('[SafeRoute][MERGE]', {
      distance: info.distance != null ? Math.round(info.distance * 10) / 10 : null,
      roadNameA: info.roadNameA || '(không rõ)',
      roadNameB: info.roadNameB || '(không rõ)',
      osmWayIdA: info.osmWayIdA || null,
      osmWayIdB: info.osmWayIdB || null,
      sameRoad: Boolean(info.sameRoad),
      merge: Boolean(info.merge),
      reason: info.reason || ''
    });
  }
}

/**
 * Kiểm tra xem chuỗi có phải là chuỗi tọa độ thuần túy không (ví dụ "10.77250, 106.69800")
 */
function isCoordinateString(str) {
  if (!str) return false;
  const s = String(str).trim();
  return /^[\d\s.,;:\-+]+$/.test(s) && /\d/.test(s);
}

/**
 * Trích xuất và chuẩn hóa tên đường (bỏ tiền tố Đường, Phố, dấu tiếng Việt)
 * để so sánh chính xác 2 điểm có cùng nằm trên 1 tuyến đường hay không.
 */
function extractStreetName(rawName) {
  if (!rawName) return '';
  if (isCoordinateString(rawName)) return '';
  let s = String(rawName).split(',')[0].trim();
  if (isCoordinateString(s)) return '';
  s = s.replace(/^(đường|phố|hẻm|ngõ|đoạn\s+đường|street|avenue|road)\s+/i, '');
  return isCoordinateString(s) ? '' : s.trim();
}

function normalizeStreetName(rawName) {
  const s = extractStreetName(rawName);
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bộ nhớ đệm lưu hình học các đoạn đường đã truy vấn để tái sử dụng tức thì,
 * tránh gọi lặp lại API bên ngoài và loại bỏ độ trễ hiển thị.
 */
const _roadSegmentCache = new Map();

/**
 * Tính khoảng cách nhỏ nhất từ một tọa độ (lat, lng) tới tập điểm (pts)
 */
function minDistanceToPoints(lat, lng, pts) {
  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = distFn(lat, lng, pts[i][0], pts[i][1]);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Tính tổng chiều dài hình học của polyline (mét)
 */
function calculatePolylineDistance(coords) {
  if (!coords || coords.length < 2) return 0;
  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += distFn(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return total;
}

/**
 * Chiếu một điểm (lat, lng) vuông góc lên đoạn thẳng [p1, p2]
 * Trả về tọa độ chiếu [lat, lng] và tỷ lệ t trong [0, 1]
 */
function projectPointToSegment(p, p1, p2) {
  const latRad = ((p1[0] + p2[0]) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(latRad);
  const x = p[1] * cosLat, y = p[0];
  const x1 = p1[1] * cosLat, y1 = p1[0];
  const x2 = p2[1] * cosLat, y2 = p2[0];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { pt: [p1[0], p1[1]], t: 0 };
  let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return {
    pt: [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])],
    t: t
  };
}

/**
 * Tìm điểm chiếu gần nhất của (lat, lng) trên toàn bộ polyline tim đường
 * Trả về { pt: [lat, lng], segIdx: number, dist: number, cumDist: number }
 */
function snapPointToPolyline(lat, lng, polyline) {
  if (!polyline || polyline.length === 0) return null;
  if (polyline.length === 1) return { pt: polyline[0], segIdx: 0, t: 0, dist: 0, cumDist: 0 };

  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  let bestDist = Infinity;
  let bestSnap = null;
  let runningDist = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const segLen = distFn(polyline[i][0], polyline[i][1], polyline[i + 1][0], polyline[i + 1][1]);
    const proj = projectPointToSegment([lat, lng], polyline[i], polyline[i + 1]);
    const d = distFn(lat, lng, proj.pt[0], proj.pt[1]);
    if (d < bestDist) {
      bestDist = d;
      bestSnap = {
        pt: proj.pt,
        segIdx: i,
        t: proj.t,
        dist: d,
        cumDist: runningDist + segLen * proj.t
      };
    }
    runningDist += segLen;
  }

  return bestSnap;
}

/**
 * Cắt lát chính xác hình học con đường giữa 2 vị trí chiếu snap1 và snap2
 * - Giữ lại TOÀN BỘ các đỉnh (vertices) uốn lượn trung gian của con đường
 * - Không bao giờ vẽ đường thẳng nối tắt
 */
function sliceRoadBetweenSnaps(roadCoords, snap1, snap2) {
  if (!roadCoords || roadCoords.length < 2 || !snap1 || !snap2) return null;

  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  const pts = [];

  let s1 = snap1, s2 = snap2;
  if (snap1.cumDist > snap2.cumDist) {
    s1 = snap2;
    s2 = snap1;
  }

  // Điểm đầu tiên là hình chiếu của node đầu lên tim đường
  pts.push(s1.pt);

  // Đưa tất cả các đỉnh cong trung gian của con đường vào
  for (let i = s1.segIdx + 1; i <= s2.segIdx; i++) {
    pts.push([roadCoords[i][0], roadCoords[i][1]]);
  }

  // Điểm cuối cùng là hình chiếu của node cuối lên tim đường
  pts.push(s2.pt);

  // Lọc các điểm siêu trùng nhau (< 0.5m)
  const cleaned = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      cleaned.push(pts[i]);
    } else {
      const prev = cleaned[cleaned.length - 1];
      const d = distFn(prev[0], prev[1], pts[i][0], pts[i][1]);
      if (d > 0.5) {
        cleaned.push(pts[i]);
      }
    }
  }

  return cleaned.length >= 2 ? cleaned : (pts.length >= 2 ? pts : null);
}

/**
 * Cắt lát mảng tọa độ tim đường OSM giữa 2 điểm node n1 và n2
 */
function sliceRoadBetweenNodes(roadCoords, n1, n2) {
  if (!roadCoords || roadCoords.length < 2) return null;
  const snap1 = snapPointToPolyline(n1.lat, n1.lng, roadCoords);
  const snap2 = snapPointToPolyline(n2.lat, n2.lng, roadCoords);
  if (!snap1 || !snap2) return null;
  return sliceRoadBetweenSnaps(roadCoords, snap1, snap2);
}

/**
 * Tìm node đầu và node cuối dọc theo con đường dựa trên positionAlongRoad (min và max cumDist)
 * Khi chưa có roadGeometry thì fallback tìm cặp có Haversine lớn nhất.
 */
function findFarthestNodePair(nodes, roadGeometry = null) {
  if (!nodes || nodes.length < 2) return null;
  if (nodes.length === 2) return [nodes[0], nodes[1]];

  if (roadGeometry && roadGeometry.length >= 2) {
    let minPos = Infinity;
    let maxPos = -Infinity;
    let startNode = nodes[0];
    let endNode = nodes[nodes.length - 1];

    for (let i = 0; i < nodes.length; i++) {
      const snap = snapPointToPolyline(nodes[i].lat, nodes[i].lng, roadGeometry);
      if (!snap) continue;
      if (snap.cumDist < minPos) {
        minPos = snap.cumDist;
        startNode = nodes[i];
      }
      if (snap.cumDist > maxPos) {
        maxPos = snap.cumDist;
        endNode = nodes[i];
      }
    }
    return [startNode, endNode];
  }

  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  let maxDist = -1;
  let pair = [nodes[0], nodes[1]];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = distFn(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng);
      if (d > maxDist) {
        maxDist = d;
        pair = [nodes[i], nodes[j]];
      }
    }
  }

  return pair;
}

/**
 * Thực hiện gọi fetch với thời gian chờ (timeout) tối đa bằng AbortController
 */
function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  if (typeof AbortController === 'undefined') {
    return fetch(url, options);
  }
  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutId = setTimeout(() => {
    try { controller.abort(); } catch (_) {}
  }, timeoutMs);
  return fetch(url, { ...options, signal })
    .finally(() => {
      clearTimeout(timeoutId);
    });
}

/**
 * Truy vấn OSRM 2 chiều để lấy chuỗi tọa độ tim đường uốn lượn thực tế
 */
async function fetchOsrmRoadGeometry(n1, n2, targetStreetName = '') {
  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  const directDistM = distFn(n1.lat, n1.lng, n2.lat, n2.lng);
  if (directDistM > 3000) return null;

  const cacheKey = `osrm_${n1.lat.toFixed(5)},${n1.lng.toFixed(5)}_${n2.lat.toFixed(5)},${n2.lng.toFixed(5)}`;
  if (_roadSegmentCache.has(cacheKey)) {
    return _roadSegmentCache.get(cacheKey);
  }

  const osrmOpts = 'overview=full&geometries=geojson&continue_straight=false&approaches=unrestricted;unrestricted';
  const url1 = `https://router.project-osrm.org/route/v1/driving/${n1.lng},${n1.lat};${n2.lng},${n2.lat}?${osrmOpts}`;
  const url2 = `https://router.project-osrm.org/route/v1/driving/${n2.lng},${n2.lat};${n1.lng},${n1.lat}?${osrmOpts}`;

  const p1 = fetchWithTimeout(url1, {}, 3000).then(r => r.ok ? r.json() : null).catch(() => null);
  const p2 = fetchWithTimeout(url2, {}, 3000).then(r => r.ok ? r.json() : null).catch(() => null);

  const [res1, res2] = await Promise.all([p1, p2]);
  const candidates = [];

  const checkAndPush = (res) => {
    if (res?.code !== 'Ok' || !res.routes?.[0]) return;
    const r = res.routes[0];
    if (!r.geometry?.coordinates || r.geometry.coordinates.length < 2) return;

    // Khoảng cách theo đường bộ không được vòng vèo quá 2.5 lần khoảng cách chim bay
    const maxAllowedDist = Math.max(150, directDistM * 2.5);
    if (r.distance > maxAllowedDist) return;

    const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    candidates.push({
      distance: r.distance,
      coords: coords
    });
  };

  checkAndPush(res1);
  checkAndPush(res2);

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.distance - b.distance);
    const best = candidates[0].coords;
    _roadSegmentCache.set(cacheKey, best);
    return best;
  }

  return null;
}

/**
 * Truy vấn Overpass API để trích xuất tim đường vật lý từ OpenStreetMap
 */
async function fetchOverpassRoadGeometry(n1, n2, targetStreetName = '') {
  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  const directDistM = distFn(n1.lat, n1.lng, n2.lat, n2.lng);
  const midLat = (n1.lat + n2.lat) / 2;
  const midLng = (n1.lng + n2.lng) / 2;
  const radius = Math.max(80, Math.min(1000, Math.round(directDistM * 1.8)));

  const query = `[out:json][timeout:5];way(around:${radius},${midLat},${midLng})[highway];out geom;`;
  const url = `https://overpass-api.de/api/interpreter?data=` + encodeURIComponent(query);

  const res = await fetchWithTimeout(url, {}, 4000).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!res?.elements?.length) return null;

  const ways = res.elements.filter(el => el.type === 'way' && el.geometry && el.geometry.length >= 2);
  if (!ways.length) return null;

  const normTarget = normalizeStreetName(targetStreetName);
  let bestWay = null;
  let bestScore = Infinity;

  for (const w of ways) {
    const wayName = w.tags?.name || '';
    const normWayName = normalizeStreetName(wayName);
    const wayPoints = w.geometry.map(pt => [pt.lat, pt.lon]);

    const d1 = minDistanceToPoints(n1.lat, n1.lng, wayPoints);
    const d2 = minDistanceToPoints(n2.lat, n2.lng, wayPoints);
    let score = d1 + d2;

    if (normTarget && normWayName && (normWayName.includes(normTarget) || normTarget.includes(normWayName))) {
      score -= 100;
    }

    if (score < bestScore) {
      bestScore = score;
      bestWay = wayPoints;
    }
  }

  return bestWay;
}

/**
 * Truy vấn Nominatim để lấy LineString tim đường từ OSM Reverse Geocoding
 */
async function fetchNominatimRoadGeometry(n1, n2) {
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${n1.lat}&lon=${n1.lng}&zoom=18&polygon_geojson=1&addressdetails=1&accept-language=vi`;
    const nomRes = await fetchWithTimeout(nomUrl, {}, 2500).then(r => r.ok ? r.json() : null).catch(() => null);
    if (nomRes?.geojson?.coordinates && nomRes.geojson.type === 'LineString') {
      const nomCoords = nomRes.geojson.coordinates.map(([lng, lat]) => [lat, lng]);
      if (nomCoords.length >= 2) return nomCoords;
    }
  } catch (_) {}
  return null;
}

/**
 * Lấy hình học đoạn đường an toàn (giữ tương thích ngược)
 */
async function fetchSafeRoadSegment(n1, n2, targetStreetName) {
  const geom = await fetchOsrmRoadGeometry(n1, n2, targetStreetName) ||
               await fetchOverpassRoadGeometry(n1, n2, targetStreetName) ||
               await fetchNominatimRoadGeometry(n1, n2);
  if (geom && geom.length >= 2) {
    return sliceRoadBetweenNodes(geom, n1, n2) || geom;
  }
  return null;
}

/**
 * HÀM CHUYÊN DỤNG XÂY DỰNG ĐOẠN ĐƯỜNG NGUY HIỂM UỐN LƯỢN CHO INCIDENT:
 * incident.nodes
 *       ↓
 * xác định road geometry (multi-tier: cache -> OSRM -> Overpass -> Nominatim)
 *       ↓
 * snap từng node vào geometry
 *       ↓
 * tính positionAlongRoad
 *       ↓
 * tìm node đầu/cuối (min và max positionAlongRoad)
 *       ↓
 * slice polyline (bảo toàn toàn bộ các điểm cong)
 *       ↓
 * gán roadCoords & segmentCoords
 *       ↓
 * return segmentCoords (Array<[lat, lng]>, length >= 2)
 */
async function buildIncidentRoadSegment(incident) {
  if (!incident || !incident.nodes || incident.nodes.length < 2) {
    return null;
  }

  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  const nodes = incident.nodes;

  // Bước 1: Tìm cặp node xa nhất theo khoảng cách chim bay ban đầu làm mốc truy vấn OSRM
  let maxBirdDist = 0;
  let qNode1 = nodes[0];
  let qNode2 = nodes[nodes.length - 1];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = distFn(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng);
      if (d > maxBirdDist) {
        maxBirdDist = d;
        qNode1 = nodes[i];
        qNode2 = nodes[j];
      }
    }
  }

  // Bước 2: Thu thập / Xác định road geometry qua các tầng
  let fullGeometry = null;

  // Nguồn 1: Đã lưu sẵn trong incident
  if (incident.fullRoadGeometry && incident.fullRoadGeometry.length >= 2) {
    fullGeometry = incident.fullRoadGeometry;
  }

  // Nguồn 2: OSRM route 2 chiều approaches=unrestricted
  if (!fullGeometry) {
    try {
      fullGeometry = await fetchOsrmRoadGeometry(qNode1, qNode2, incident.roadName);
    } catch (_) {}
  }

  // Nguồn 3: Overpass OSM Way
  if (!fullGeometry) {
    try {
      fullGeometry = await fetchOverpassRoadGeometry(qNode1, qNode2, incident.roadName);
    } catch (_) {}
  }

  // Nguồn 4: Nominatim
  if (!fullGeometry) {
    try {
      fullGeometry = await fetchNominatimRoadGeometry(qNode1, qNode2);
    } catch (_) {}
  }

  // Nếu vẫn chưa lấy được geometry: KHÔNG fallback đường thẳng, lên lịch tự động retry sau 1.5s
  if (!fullGeometry || fullGeometry.length < 2) {
    console.debug('[SafeRoute][SEGMENT]', {
      incidentId: incident.id,
      nodeCount: nodes.length,
      startNode: null,
      endNode: null,
      roadPointCount: 0,
      segmentDistance: 0,
      success: false,
      reason: 'Đang đợi nạp road geometry... lên lịch thử lại tự động'
    });

    if (!incident._retrySegmentTimer) {
      incident._retrySegmentTimer = setTimeout(async () => {
        incident._retrySegmentTimer = null;
        const res = await buildIncidentRoadSegment(incident);
        if (res && res.length >= 2) {
          if (typeof window !== 'undefined' && typeof window.renderIncidents === 'function') {
            window.renderIncidents();
          }
        }
      }, 1500);
    }
    return null;
  }

  // Lưu lại fullRoadGeometry vào incident để tái sử dụng
  incident.fullRoadGeometry = fullGeometry;

  // Bước 3: Snap từng node vào fullGeometry và tính positionAlongRoad (cumDist)
  const nodeSnaps = [];
  for (let i = 0; i < nodes.length; i++) {
    const snap = snapPointToPolyline(nodes[i].lat, nodes[i].lng, fullGeometry);
    if (snap) {
      nodeSnaps.push({
        node: nodes[i],
        snap: snap,
        pos: snap.cumDist
      });
    }
  }

  if (nodeSnaps.length < 2) return null;

  // Bước 4: Sắp xếp theo vị trí dọc đường và tìm min, max
  nodeSnaps.sort((a, b) => a.pos - b.pos);
  const first = nodeSnaps[0];
  const last = nodeSnaps[nodeSnaps.length - 1];

  const startNode = first.node;
  const endNode = last.node;
  const segmentDistance = last.pos - first.pos;

  // Bước 5: Cắt lát geometry giữa first.snap và last.snap (bảo toàn toàn bộ điểm uốn lượn trung gian)
  const slicedCoords = sliceRoadBetweenSnaps(fullGeometry, first.snap, last.snap);
  if (!slicedCoords || slicedCoords.length < 2) return null;

  // Bước 6: Kiểm tra sai số snap đầu và cuối
  const startError = distFn(slicedCoords[0][0], slicedCoords[0][1], startNode.lat, startNode.lng);
  const endError = distFn(slicedCoords[slicedCoords.length - 1][0], slicedCoords[slicedCoords.length - 1][1], endNode.lat, endNode.lng);

  // Bước 7: Gán kết quả vào incident
  incident.roadCoords = slicedCoords;
  incident.segmentCoords = slicedCoords;
  incident.farthestDistance = segmentDistance;
  incident.segmentLengthMeters = Math.round(segmentDistance);
  incident.farthestPair = [startNode, endNode];

  // Bước 8: Ghi log chuẩn theo yêu cầu
  console.debug('[SafeRoute][SEGMENT]', {
    incidentId: incident.id,
    type: incident.type,
    nodeCount: nodes.length,
    startNode: { lat: startNode.lat, lng: startNode.lng },
    endNode: { lat: endNode.lat, lng: endNode.lng },
    roadPointCount: slicedCoords.length,
    segmentDistance: Math.round(segmentDistance * 10) / 10,
    startErrorM: Math.round(startError * 10) / 10,
    endErrorM: Math.round(endError * 10) / 10,
    success: true
  });

  return slicedCoords;
}

/**
 * Tính góc phương vị (bearing theo độ [0, 360)) từ (lat1, lng1) đến (lat2, lng2)
 */
function computeBearingDegrees(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLng = (lng2 - lng1) * rad;
  const la1 = lat1 * rad;
  const la2 = lat2 * rad;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  const deg = Math.atan2(y, x) * 180 / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Tính độ lệch góc nhỏ nhất giữa 2 bearing [0, 180]
 */
function bearingAngleDiff(b1, b2) {
  if (b1 == null || b2 == null) return 0;
  let diff = Math.abs(b1 - b2) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Tìm hướng di chuyển (bearing) của con đường tại điểm (lat, lng) dựa trên chuỗi tọa độ tim đường
 */
function computeRoadBearingAtPoint(lat, lng, wayCoords) {
  if (!wayCoords || wayCoords.length < 2) return null;
  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  let bestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < wayCoords.length - 1; i++) {
    const midLat = (wayCoords[i][0] + wayCoords[i + 1][0]) / 2;
    const midLng = (wayCoords[i][1] + wayCoords[i + 1][1]) / 2;
    const d = distFn(lat, lng, midLat, midLng);
    if (d < minDist) {
      minDist = d;
      bestIdx = i;
    }
  }
  return computeBearingDegrees(
    wayCoords[bestIdx][0],
    wayCoords[bestIdx][1],
    wayCoords[bestIdx + 1][0],
    wayCoords[bestIdx + 1][1]
  );
}

/**
 * Phân tích hình học khoảng cách giữa 2 điểm theo hệ trục con đường:
 * - dLongitudinal: khoảng cách dọc theo chiều dài con đường
 * - dLateral: khoảng cách ngang lòng đường (vuông góc với tim đường)
 */
function computeProjectedDistances(lat1, lng1, lat2, lng2, bearingDeg) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const bRad = bearingDeg * rad;
  const dx = (lng2 - lng1) * rad * R * Math.cos(((lat1 + lat2) / 2) * rad);
  const dy = (lat2 - lat1) * rad * R;
  const ux = Math.sin(bRad);
  const uy = Math.cos(bRad);
  const dLongitudinal = Math.abs(dx * ux + dy * uy);
  const dLateral = Math.abs(-dx * uy + dy * ux);
  return { dLongitudinal, dLateral };
}

/**
 * Ràng buộc: KIỂM TRA 2 NODE CÓ CÙNG NẰM TRÊN 1 ĐƯỜNG VÀ CÙNG CHIỀU KHÔNG?
 * - Nếu đường 2 chiều mà mỗi chiều 1 node (bearing ngược nhau > 100°): TUYỆT ĐỐI KHÔNG GỘP.
 * - Khác tên đường: TUYỆT ĐỐI KHÔNG GỘP.
 */
function isSameRoadAndDirection(inc, data) {
  // Phải cùng loại sự cố (bảo vệ kép)
  if (inc.type && data.type && inc.type !== data.type) {
    return false;
  }

  const norm1 = inc.normalizedStreet || normalizeStreetName(inc.roadName);
  const norm2 = data.normalizedStreet || normalizeStreetName(data.roadName);
  if (norm1 && norm2) {
    const match = (norm1 === norm2) || norm1.includes(norm2) || norm2.includes(norm1);
    if (!match) return false;
  }

  // 1. Kiểm tra OSM Way ID và Bearing:
  if (inc.osmWayId && data.osmWayId && inc.osmWayId !== data.osmWayId) {
    if (inc.roadBearing != null && data.roadBearing != null) {
      const angleDiff = bearingAngleDiff(inc.roadBearing, data.roadBearing);
      if (angleDiff > 100) return false;
    }
  }

  // 2. Kiểm tra hướng lưu thông (bearing) của con đường tại 2 điểm:
  if (inc.roadBearing != null && data.roadBearing != null) {
    const angleDiff = bearingAngleDiff(inc.roadBearing, data.roadBearing);
    if (angleDiff > 100) {
      return false; // 2 chiều xe chạy ngược nhau trên đường phân cách
    }
  }

  return true;
}

/**
 * Thêm mới hoặc xác nhận gộp sự cố từ cộng đồng:
 * - Hỗ trợ 2 kiểu hiển thị (renderMode): 'segment' và 'point' tập trung từ INCIDENT_RENDER_MODE.
 * - Với 'segment' (ngập nước, ùn tắc, công trình, đường hỏng): gộp mắt xích liên tục trên cùng con đường,
 *   không giới hạn cứng <=100m tổng chiều dài, hiển thị đường liền màu bám sát tim đường thực tế.
 * - Với 'point' (tai nạn, nguy hiểm, chướng ngại vật): chỉ gộp xác nhận khi cực gần (<= 25m),
 *   luôn hiển thị dưới dạng điểm độc lập, tuyệt đối không tạo polyline nối đường.
 * - Cực kỳ quan trọng: Tuyệt đối KHÔNG gộp các loại sự cố khác nhau (inc.type !== data.type).
 * - Lưu trữ thời gian động: startedAt, createdAt, lastConfirmedAt, không bao giờ hard-code.
 */
async function addOrConfirmIncident(data) {
  cleanupExpiredIncidents();

  const distFn = (typeof window !== 'undefined' && window.distanceMeters) ? window.distanceMeters : _distanceMeters;
  const demoUser = (typeof window !== 'undefined' && window.DEMO_USER_ID) ? window.DEMO_USER_ID : _DEMO_USER_ID;

  let roadName = extractStreetName(data.locationLabel) || '';
  let snappedLat = Number(data.lat);
  let snappedLng = Number(data.lng);
  let osmWayId = data.osmWayId || null;
  let roadBearing = data.roadBearing != null ? data.roadBearing : null;
  let normStreet = normalizeStreetName(roadName);

  // Xác định renderMode theo cấu hình INCIDENT_RENDER_MODE tập trung
  const renderMode = (typeof window !== 'undefined' && window.INCIDENT_RENDER_MODE && window.INCIDENT_RENDER_MODE[data.type])
    || (typeof window !== 'undefined' && window.INCIDENT_TYPES && window.INCIDENT_TYPES[data.type]?.renderMode)
    || 'point';

  // Ngưỡng khoảng cách nối chuỗi liên tiếp cho segment: 120m (hoặc theo cấu hình)
  const CHAIN_MERGE_DISTANCE_METERS = (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.incident_merge_radius_m) 
    ? Math.max(120, window.CONFIG.incident_merge_radius_m) 
    : 120;
  // Ngưỡng gộp cho point: 25m (chỉ gộp khi xác nhận cùng điểm sự cố)
  const POINT_MERGE_DISTANCE_METERS = 25;

  let nearby = null;
  let minDistance = Infinity;

  const currentPayload = {
    roadName,
    normalizedStreet: normStreet,
    osmWayId,
    roadBearing,
    lat: snappedLat,
    lng: snappedLng,
    type: data.type
  };

  // CHỈ GỘP KHI CÙNG LOẠI SỰ CỐ, CÙNG ĐƯỜNG VÀ THỎA MÃN ĐIỀU KIỆN
  for (const inc of incidents) {
    const c = calculateCurrentConfidence(inc);
    if (c <= 0) continue;

    // 1. CỰC KỲ QUAN TRỌNG: TUYỆT ĐỐI KHÔNG GỘP CÁC LOẠI SỰ CỐ KHÁC NHAU!
    // Ví dụ: Ngập nước không gộp với tai nạn hay công trình
    if (inc.type !== data.type) {
      continue;
    }

    if (renderMode === 'point') {
      // Đối với sự cố dạng point (accident, danger, obstacle):
      // Chỉ gộp khi khoảng cách rất gần (<= 25m) nhằm xác nhận cùng 1 sự cố tại vị trí đó
      const dPoint = distFn(inc.lat, inc.lng, data.lat, data.lng);
      if (dPoint <= POINT_MERGE_DISTANCE_METERS && dPoint < minDistance) {
        minDistance = dPoint;
        nearby = inc;
      }
      continue;
    }

    // Đối với sự cố dạng segment (flood, traffic, construction, damaged_road):
    // Gộp theo chuỗi mắt xích liên tục trên cùng tuyến đường (khoảng cách tới bất kỳ node nào trong cluster <= 120m)
    let d = distFn(inc.lat, inc.lng, data.lat, data.lng);
    if (inc.nodes && inc.nodes.length > 0) {
      for (const node of inc.nodes) {
        const dNode = distFn(node.lat, node.lng, data.lat, data.lng);
        if (dNode < d) d = dNode;
      }
    }
    if (inc.segmentCoords && inc.segmentCoords.length >= 2) {
      const dPoly = (typeof window.minDistanceToPolyline === 'function') 
        ? window.minDistanceToPolyline(data.lat, data.lng, inc.segmentCoords) 
        : Infinity;
      if (dPoly < d) d = dPoly;
    }

    if (d > CHAIN_MERGE_DISTANCE_METERS) {
      logMergeDebug({
        distance: d,
        roadNameA: inc.roadName,
        roadNameB: roadName,
        osmWayIdA: inc.osmWayId,
        osmWayIdB: osmWayId,
        sameRoad: false,
        merge: false,
        reason: `Khoảng cách mắt xích (${Math.round(d)}m) vượt quá ngưỡng ${CHAIN_MERGE_DISTANCE_METERS}m`
      });
      continue;
    }

    if (!isSameRoadAndDirection(inc, currentPayload)) {
      logMergeDebug({
        distance: d,
        roadNameA: inc.roadName,
        roadNameB: roadName,
        osmWayIdA: inc.osmWayId,
        osmWayIdB: osmWayId,
        sameRoad: false,
        merge: false,
        reason: `Không cùng tuyến đường hoặc khác chiều lưu thông`
      });
      continue;
    }

    if (d < minDistance) {
      minDistance = d;
      nearby = inc;
    }
  }

  if (nearby) {
    // Chống click đúp tại chính xác cùng 1 tọa độ (< 5m)
    if (minDistance < 5 && nearby.reporterIds && nearby.reporterIds.includes(demoUser)) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Bạn đã báo cáo hoặc xác nhận sự cố tại điểm này rồi.');
      }
      return nearby;
    }

    // 1. Gộp dữ liệu (Data merge):
    nearby.reporterCount = (nearby.reporterCount || 1) + 1;
    const currentC = calculateCurrentConfidence(nearby);
    nearby.confidence = Math.min(100, Math.max(75, currentC + 30));

    // QUAN TRỌNG: TUYỆT ĐỐI KHÔNG GHI ĐÈ startedAt / createdAt!
    if (!nearby.startedAt) nearby.startedAt = nearby.createdAt || Date.now();
    nearby.lastConfirmedAt = Date.now();

    const newReporterId = 'user-' + Math.random().toString(36).slice(2, 7);
    nearby.reporterIds = [...(nearby.reporterIds || []), newReporterId];

    // Cập nhật mức độ nghiêm trọng
    if (data.level === 'cao' || nearby.level === 'cao') {
      nearby.level = 'cao';
    } else if (data.level === 'trungbinh' || nearby.level === 'trungbinh') {
      nearby.level = 'trungbinh';
    }

    // Gán tên đường chuẩn xác nếu trước đó chưa có
    if (!nearby.roadName && roadName) {
      nearby.roadName = roadName;
      nearby.normalizedStreet = normStreet;
    }
    if (!nearby.osmWayId && osmWayId) nearby.osmWayId = osmWayId;
    if (nearby.roadBearing == null && roadBearing != null) nearby.roadBearing = roadBearing;

    // Ghi nhận node mới vào danh sách node
    if (!nearby.nodes || nearby.nodes.length === 0) {
      nearby.nodes = [{ lat: nearby.lat, lng: nearby.lng, osmWayId: nearby.osmWayId, roadBearing: nearby.roadBearing, reportedAt: nearby.startedAt }];
    }
    const newNode = {
      lat: snappedLat,
      lng: snappedLng,
      rawLat: data.lat,
      rawLng: data.lng,
      osmWayId,
      roadBearing,
      reportedAt: Date.now()
    };
    nearby.nodes.push(newNode);

    // 2. Gộp hiển thị (Visual merge):
    if (nearby.renderMode === 'segment' || renderMode === 'segment') {
      nearby.renderMode = 'segment';

      // Làm mới fullRoadGeometry nếu node mới cách xa hình học cũ để bao quát toàn bộ đoạn đường mới
      if (nearby.fullRoadGeometry) {
        const snapCheck = snapPointToPolyline(newNode.lat, newNode.lng, nearby.fullRoadGeometry);
        if (!snapCheck || snapCheck.dist > 50) {
          nearby.fullRoadGeometry = null;
        }
      }

      await buildIncidentRoadSegment(nearby);

      if (nearby.segmentCoords && nearby.segmentCoords.length >= 2) {
        nearby.segmentLengthMeters = Math.round(calculatePolylineDistance(nearby.segmentCoords));
      }

      console.debug('[SafeRoute][INCIDENT_CLUSTER]', {
        incidentId: nearby.id,
        type: nearby.type,
        renderMode: 'segment',
        nodeCount: nearby.nodes.length,
        roadName: nearby.roadName,
        totalLengthMeters: nearby.segmentLengthMeters || 0,
        startedAt: nearby.startedAt,
        lastConfirmedAt: nearby.lastConfirmedAt
      });
    }

    logMergeDebug({
      distance: minDistance,
      roadNameA: nearby.roadName,
      roadNameB: roadName || nearby.roadName,
      osmWayIdA: nearby.osmWayId,
      osmWayIdB: osmWayId,
      sameRoad: true,
      merge: true,
      reason: `Đã gộp thành công ${nearby.reporterCount} người báo cáo trên đường ${nearby.roadName || 'này'}`
    });

    if (typeof window !== 'undefined') {
      if (typeof window.renderIncidents === 'function') window.renderIncidents();
      if (typeof window.renderNearbyPanel === 'function') window.renderNearbyPanel();
      if (typeof window.showToast === 'function') {
        const typeMeta = (window.INCIDENT_TYPES && window.INCIDENT_TYPES[nearby.type]) || {};
        const typeName = typeMeta.label || nearby.type;
        const displayRoad = nearby.roadName ? `trên đường ${nearby.roadName} ` : '';
        const lenText = (nearby.renderMode === 'segment' && nearby.segmentLengthMeters)
          ? ` (đoạn đường ~${nearby.segmentLengthMeters}m)`
          : '';
        window.showToast(`Đã gộp ${nearby.reporterCount} người báo cáo ${typeName} ${displayRoad}${lenText}.`);
      }
      window.dispatchEvent(new CustomEvent('incidents-changed'));
    }

    return nearby;
  } else {
    // Tạo incident mới
    const now = Date.now();
    const newInc = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'inc-' + Date.now(),
      type: data.type,
      level: data.level,
      renderMode: renderMode,
      lat: snappedLat,
      lng: snappedLng,
      rawLat: data.lat,
      rawLng: data.lng,
      desc: data.desc,
      roadName: roadName,
      normalizedStreet: normStreet,
      osmWayId: osmWayId,
      roadBearing: roadBearing,
      confidence: 50,
      reporterCount: 1,
      reporterIds: [demoUser],
      nodes: [{ lat: snappedLat, lng: snappedLng, rawLat: data.lat, rawLng: data.lng, osmWayId, roadBearing, reportedAt: now }],
      startedAt: now,
      createdAt: now,
      lastConfirmedAt: now,
      roadCoords: null,
      segmentCoords: null,
      segmentLengthMeters: 0
    };

    incidents.push(newInc);

    logMergeDebug({
      distance: null,
      roadNameA: roadName,
      roadNameB: null,
      osmWayIdA: osmWayId,
      osmWayIdB: null,
      sameRoad: true,
      merge: false,
      reason: 'Tạo mới điểm báo cáo sự cố (chưa có điểm lân cận cùng loại để gộp)'
    });

    if (typeof window !== 'undefined') {
      if (typeof window.renderIncidents === 'function') window.renderIncidents();
      if (typeof window.renderNearbyPanel === 'function') window.renderNearbyPanel();
      window.dispatchEvent(new CustomEvent('incidents-changed'));
    }

    // Bổ sung tên đường / osmWayId ngầm nếu còn thiếu
    if (!newInc.roadName || !newInc.osmWayId) {
      fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${data.lat}&lon=${data.lng}&zoom=18&addressdetails=1&accept-language=vi`, {}, 2000)
        .then(r => r.ok ? r.json() : null)
        .then(nomData => {
          if (nomData) {
            if (nomData.osm_type === 'way' && nomData.osm_id && !newInc.osmWayId) {
              newInc.osmWayId = String(nomData.osm_id);
            }
            if (nomData.display_name && !newInc.roadName) {
              const fn = extractStreetName(nomData.display_name);
              if (fn) {
                newInc.roadName = fn;
                newInc.normalizedStreet = normalizeStreetName(fn);
              }
            }
          }
        })
        .catch(() => {});
    }

    return newInc;
  }
}

/**
 * Vote xác nhận sự cố trực tiếp từ Popup bản đồ (+30% confidence)
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
  inc.confidence = Math.min(100, currentC + 30);
  inc.lastConfirmedAt = Date.now();
  if (!inc.startedAt) inc.startedAt = inc.createdAt || Date.now();
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
  inc.lastConfirmedAt = Date.now();
  if (inc.confidence <= 10) {
    inc.resolvedAt = Date.now();
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
  window.findFarthestNodePair = findFarthestNodePair;
  window.fetchSafeRoadSegment = fetchSafeRoadSegment;
  window.isSameRoadAndDirection = isSameRoadAndDirection;
  window.sliceRoadBetweenNodes = sliceRoadBetweenNodes;
  window.sliceRoadBetweenSnaps = sliceRoadBetweenSnaps;
  window.buildIncidentRoadSegment = buildIncidentRoadSegment;
  window.logMergeDebug = logMergeDebug;
}