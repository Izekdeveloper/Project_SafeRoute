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

const _minDistanceToPolyline = (typeof window !== 'undefined' && window.minDistanceToPolyline)
  ? window.minDistanceToPolyline
  : ((typeof minDistanceToPolyline === 'function') ? minDistanceToPolyline : (() => Infinity));
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

const _routeInVNCache = new WeakMap();

function isRouteInsideVietnam(route) {
  if (!route || typeof route !== 'object') return false;
  const cached = _routeInVNCache.get(route);
  if (cached !== undefined) return cached;

  const coords = route.coords;
  if (!coords || coords.length === 0) {
    _routeInVNCache.set(route, false);
    return false;
  }
  const step = Math.max(1, Math.floor(coords.length / 120));
  for (let i = 0; i < coords.length; i += step) {
    if (!isPointInVietnam(coords[i][0], coords[i][1])) {
      _routeInVNCache.set(route, false);
      return false;
    }
  }
  if (!isPointInVietnam(coords[coords.length - 1][0], coords[coords.length - 1][1])) {
    _routeInVNCache.set(route, false);
    return false;
  }
  _routeInVNCache.set(route, true);
  return true;
}

/* ---------------------------------------------------------------
   2. TRUY VẤN OSRM ROUTING API & BỘ NHỚ ĐỆM (ROUTE CACHE + IN-FLIGHT)
--------------------------------------------------------------- */

function _isDebugRouting() {
  return (typeof window !== 'undefined' && window.DEBUG_ROUTING != null)
    ? window.DEBUG_ROUTING === true
    : (typeof CONFIG !== 'undefined' && CONFIG.debug_routing === true);
}

/**
 * Đóng băng có chọn lọc waypoints và legs (không đóng băng coords và steps để tránh tốn CPU)
 */
function _freezeRouteNestedArrays(route) {
  if (!route || typeof route !== 'object') return;
  if (Array.isArray(route.waypoints) && !Object.isFrozen(route.waypoints)) {
    for (const wp of route.waypoints) {
      if (wp && typeof wp === 'object' && !Object.isFrozen(wp)) Object.freeze(wp);
    }
    Object.freeze(route.waypoints);
  }
  if (Array.isArray(route.legs) && !Object.isFrozen(route.legs)) {
    for (const leg of route.legs) {
      if (leg && typeof leg === 'object' && !Object.isFrozen(leg)) Object.freeze(leg);
    }
    Object.freeze(route.legs);
  }
}

/**
 * Lớp quản lý bộ nhớ đệm lộ trình OSRM (LRU + TTL Cache)
 * Tách biệt hoàn toàn tầng hình học OSRM với tầng tính điểm rủi ro sự cố
 */
class RouteCache {
  constructor(maxEntries = 100, ttlMs = 180000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    /** @type {Map<string, { data: any, expiresAt: number, createdAt: number }>} */
    this.cache = new Map();
  }

  /**
   * Tạo cache key duy nhất dựa trên profile, waypoints đã chuẩn hóa, và các options
   * Tọa độ được làm tròn 5 chữ số thập phân (~1.1m) để chống micro-jitter nhưng giữ nguyên độ chính xác định tuyến
   */
  static createKey(waypoints, options = {}) {
    const profile = options.profile || 'driving';
    const overview = options.overview || 'full';
    const steps = Boolean(options.steps);
    const alternatives = Boolean(options.alternatives);
    const coordStr = (waypoints || []).map(p => {
      const lat = Number(p.lat).toFixed(5);
      const lng = Number(p.lng).toFixed(5);
      return `${lng},${lat}`;
    }).join(';');
    return `${profile}::${coordStr}::ov=${overview}::st=${steps}::alt=${alternatives}`;
  }

  get(key) {
    if (!key) return null;
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh vị trí trong LRU Map
    this.cache.delete(key);
    this.cache.set(key, entry);

    // Trả về tham chiếu bất biến (immutable reference)
    return entry.data;
  }

  set(key, data) {
    if (!key || !data) return;

    // Giới hạn dung lượng: xóa entry cũ nhất nếu vượt quá giới hạn
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const ttl = (typeof window !== 'undefined' && window.OSRM_CACHE_TTL) ? window.OSRM_CACHE_TTL : this.ttlMs;
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item && typeof item === 'object') {
          if (!Object.isFrozen(item)) Object.freeze(item);
          _freezeRouteNestedArrays(item);
        }
      }
      if (!Object.isFrozen(data)) Object.freeze(data);
    } else if (typeof data === 'object') {
      if (!Object.isFrozen(data)) Object.freeze(data);
      _freezeRouteNestedArrays(data);
    }

    this.cache.set(key, {
      data,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

// Khởi tạo Singleton RouteCache và Map quản lý in-flight requests
const _initTtl = (typeof window !== 'undefined' && window.OSRM_CACHE_TTL) ? window.OSRM_CACHE_TTL : 180000;
const _initMax = (typeof window !== 'undefined' && window.OSRM_CACHE_MAX_ENTRIES) ? window.OSRM_CACHE_MAX_ENTRIES : 100;
const osrmRouteCache = new RouteCache(_initMax, _initTtl);
const inFlightRequests = new Map();

// Biến kiểm soát chống Race Condition và AbortController toàn cục cho phiên tìm đường
let routingRequestId = 0;
let activeRoutingController = null;

/**
 * Concurrency Limiter: Thực thi tác vụ bất đồng bộ với giới hạn số request song song tối đa
 * @param {Array<any>} items - Danh sách tham số đầu vào
 * @param {number} limit - Số request đồng thời tối đa (ví dụ 3)
 * @param {Function} asyncFn - Hàm bất đồng bộ cần chạy
 */
async function mapConcurrent(items, limit, asyncFn) {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => asyncFn(item));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.allSettled(results);
}

/**
 * Hàm truy vấn OSRM tối ưu hóa:
 * 1. Kiểm tra RouteCache (nếu hit -> trả về ngay, 0 network request)
 * 2. Quản lý in-flight requests dùng chung: mỗi request có AbortController độc lập,
 *    nhiều caller có thể cùng subscribe, caller bị hủy không làm chết shared request của caller khác.
 * 3. Hỗ trợ Timeout (OSRM_TIMEOUT = 8000ms) và AbortController
 * 4. Tùy chỉnh steps=false cho candidate routes để giảm 70% payload
 * 5. Tự động lưu cache và xử lý lỗi/fallback an toàn, không crash app
 */
async function fetchOsrmRoute(waypoints, options = {}, externalSignal = null, metrics = null) {
  if (!waypoints || waypoints.length < 2) return [];

  const overview = options.overview || 'full';
  const steps = Boolean(options.steps);
  const alternatives = Boolean(options.alternatives);
  const profile = options.profile || 'driving';

  const cacheKey = RouteCache.createKey(waypoints, { profile, overview, steps, alternatives });

  // 1. KIỂM TRA CACHE
  const cached = osrmRouteCache.get(cacheKey);
  if (cached) {
    if (metrics) metrics.cacheHits = (metrics.cacheHits || 0) + 1;
    if (_isDebugRouting()) console.log(`[OSRM] cache hit: ${cacheKey}`);
    return cached;
  }

  // 2. KIỂM TRA TÍN HIỆU ĐÃ BỊ HỦY CHƯA TRƯỚC KHI BẮT ĐẦU
  if (externalSignal && externalSignal.aborted) {
    if (_isDebugRouting()) console.log(`[OSRM] request skipped (aborted): ${cacheKey}`);
    return [];
  }

  // 3. THAM GIA HOẶC TẠO IN-FLIGHT REQUEST MỚI
  let inFlightEntry = inFlightRequests.get(cacheKey);

  if (inFlightEntry) {
    if (metrics) metrics.inFlightHits = (metrics.inFlightHits || 0) + 1;
    if (_isDebugRouting()) console.log(`[OSRM] in-flight subscriber joined: ${cacheKey}`);
  } else {
    // Tạo shared request mới với AbortController độc lập
    const sharedController = new AbortController();
    const timeoutMs = (typeof window !== 'undefined' && window.OSRM_TIMEOUT) 
      ? window.OSRM_TIMEOUT 
      : ((typeof CONFIG !== 'undefined' && CONFIG.osrm_timeout_ms) ? CONFIG.osrm_timeout_ms : 8000);

    let isTimedOut = false;
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      try { sharedController.abort(); } catch (_) {}
    }, timeoutMs);

    const coordStr = waypoints.map(p => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coordStr}?overview=${overview}&geometries=geojson&steps=${steps}&alternatives=${alternatives}`;

    if (metrics) metrics.requests = (metrics.requests || 0) + 1;

    const sharedPromise = (async () => {
      try {
        if (_isDebugRouting()) console.log(`[OSRM] request start: ${coordStr} (steps=${steps}, alt=${alternatives})`);
        const res = await fetch(url, { signal: sharedController.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          if (_isDebugRouting()) console.warn(`[OSRM] HTTP error: status ${res.status}`);
          return [];
        }

        const data = await res.json();
        if (data.code !== 'Ok' || !data.routes?.length) {
          if (_isDebugRouting()) console.warn(`[OSRM] API returned non-OK code: ${data.code}`);
          return [];
        }

        const mappedRoutes = data.routes.map((route, index) => ({
          coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distance: route.distance / 1000,
          duration: route.duration / 60,
          legs: route.legs || [],
          routeIndex: index,
          riskScore: 0,
          source: 'osrm',
          waypoints: waypoints.map(w => ({ lat: Number(w.lat), lng: Number(w.lng) }))
        }));

        if (_isDebugRouting()) console.log(`[OSRM] request completed: ${coordStr} -> ${mappedRoutes.length} route(s)`);

        // Lưu vào cache
        osrmRouteCache.set(cacheKey, mappedRoutes);
        return mappedRoutes;

      } catch (err) {
        clearTimeout(timeoutId);

        if (isTimedOut) {
          if (_isDebugRouting()) console.warn(`[OSRM] timeout (${timeoutMs}ms): ${coordStr}`);
        } else if (err.name === 'AbortError' || sharedController.signal.aborted) {
          if (_isDebugRouting()) console.log(`[OSRM] shared request aborted: ${coordStr}`);
        } else {
          if (_isDebugRouting()) console.warn(`[OSRM] network/parse error: ${err.message}`);
        }

        return [];
      } finally {
        clearTimeout(timeoutId);
        inFlightRequests.delete(cacheKey);
      }
    })();

    inFlightEntry = {
      controller: sharedController,
      subscribers: new Set(),
      promise: sharedPromise
    };
    inFlightRequests.set(cacheKey, inFlightEntry);
    if (_isDebugRouting()) console.log(`[OSRM] shared in-flight request created: ${cacheKey}`);
  }

  // 4. ĐĂNG KÝ CALLER VÀO DANH SÁCH SUBSCRIBER CỦA IN-FLIGHT REQUEST
  const subToken = Symbol('caller_sub');
  inFlightEntry.subscribers.add(subToken);

  return await new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (externalSignal && onCallerAbort) {
        externalSignal.removeEventListener('abort', onCallerAbort);
      }
      inFlightEntry.subscribers.delete(subToken);
    };

    const finish = (routes) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Immutable contract: Trả về reference đã frozen, loại bỏ JSON.parse(JSON.stringify) tốn kém
      if (routes && Array.isArray(routes)) {
        for (let i = 0; i < routes.length; i++) {
          const r = routes[i];
          if (r && typeof r === 'object') {
            if (!Object.isFrozen(r)) Object.freeze(r);
            _freezeRouteNestedArrays(r);
          }
        }
        resolve(routes);
      } else {
        resolve([]);
      }
    };

    const onCallerAbort = () => {
      if (settled) return;
      if (_isDebugRouting()) {
        console.log(`[OSRM] individual caller aborted, remaining subscribers: ${inFlightEntry.subscribers.size - 1}`);
      }
      cleanup();
      settled = true;

      // Chỉ hủy underlying request thực tế khi TẤT CẢ caller đều đã hủy / không còn subscriber nào chờ
      if (inFlightEntry.subscribers.size === 0) {
        if (_isDebugRouting()) {
          console.log(`[OSRM] 0 subscribers remaining -> aborting underlying OSRM request: ${cacheKey}`);
        }
        try { inFlightEntry.controller.abort(); } catch (_) {}
      }

      resolve([]);
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        onCallerAbort();
        return;
      }
      externalSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    inFlightEntry.promise.then(
      routes => finish(routes),
      () => finish([])
    );
  });
}

/**
 * Tương thích ngược với các module khác đang gọi fetchOsrmRawRoute
 */
async function fetchOsrmRawRoute(waypoints, options = {}, signal = null) {
  return await fetchOsrmRoute(waypoints, options, signal);
}

/**
 * Tìm kiếm các tuyến đường an toàn:
 * - Hỗ trợ phân tích đa tuyến, tránh sự cố bằng waypoints thông minh
 * - Tối ưu hóa request OSRM bằng Cache, In-flight deduplication, Concurrency Limiter
 * - Giảm payload OSRM (steps=false ở giai đoạn ứng viên, chỉ lấy steps=true cho tuyến cuối cùng)
 * - Chống race condition hoàn toàn bằng routingRequestId và AbortController
 */
async function findSafeRoutes(start, end, options = {}) {
  const thisRequestId = ++routingRequestId;

  // 1. HỦY PHIÊN TÌM ĐƯỜNG CŨ NẾU CÒN ĐANG CHẠY (ABORT CONTROLLER)
  if (activeRoutingController) {
    try { activeRoutingController.abort(); } catch (_) {}
    if (_isDebugRouting()) console.log('[OSRM] Đã hủy phiên tìm đường đang chạy trước đó.');
  }
  activeRoutingController = new AbortController();
  const sessionSignal = activeRoutingController.signal;

  const startTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const metrics = {
    requestId: thisRequestId,
    requests: 0,
    cacheHits: 0,
    inFlightHits: 0,
    candidates: 0,
    uniqueRoutes: 0,
    totalTimeMs: 0
  };

  // Tuyến cơ sở (Base route): yêu cầu geometry full, bật alternatives, tắt steps để giảm dung lượng
  const baseOptions = {
    overview: 'full',
    steps: (typeof window !== 'undefined' && window.OSRM_CANDIDATE_STEPS) ? window.OSRM_CANDIDATE_STEPS : false,
    alternatives: (typeof window !== 'undefined' && window.OSRM_ENABLE_ALTERNATIVES != null) ? window.OSRM_ENABLE_ALTERNATIVES : true
  };

  let initialRoutes = [];
  try {
    initialRoutes = await fetchOsrmRoute([start, end], baseOptions, sessionSignal, metrics);
  } catch (err) {
    if (_isDebugRouting()) console.warn('[OSRM] Base route fetch error:', err.message);
  }

  // Kiểm tra race condition
  if (thisRequestId !== routingRequestId || sessionSignal.aborted) {
    if (_isDebugRouting()) console.log(`[OSRM] Bỏ qua kết quả request #${thisRequestId} vì đã có request mới hơn #${routingRequestId}`);
    return [];
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
      if (thisRequestId !== routingRequestId || sessionSignal.aborted) return [];
      try {
        const segRoutes = await fetchOsrmRoute([start, wp, end], { overview: 'full', steps: false, alternatives: false }, sessionSignal, metrics);
        const ok = segRoutes.filter(r => isRouteInsideVietnam(r));
        if (ok.length > 0) {
          validRoutes.push(...ok);
          break;
        }
      } catch (_) {}
    }
  }

  // Đích quá xa (>= 300km): lập phương án trung chuyển 3 chặng kết hợp
  if (typeof window !== 'undefined') window.transportFallback = null;
  const directDistKm = haversineKm(start.lat, start.lng, end.lat, end.lng);
  if (directDistKm >= MULTIMODAL_MIN_DISTANCE_KM) {
    try {
      const plan = await planMultimodalFallback(start, end, sessionSignal, metrics);
      if (typeof window !== 'undefined') window.transportFallback = plan;
    } catch (err) {
      if (_isDebugRouting()) console.warn('[SafeRoute] Không lập được phương án trung chuyển:', err);
    }
  }

  if (thisRequestId !== routingRequestId || sessionSignal.aborted) return [];
  if (validRoutes.length === 0) return [];

  // ===== WAYPOINT AVOIDANCE ROUTING =====
  // Chủ động tạo các tuyến đường vòng tránh khu vực có sự cố/nguy hiểm
  const routingNow = Date.now();
  const rawIncList = (typeof window !== 'undefined' && window.incidents) ? window.incidents : (typeof incidents !== 'undefined' ? incidents : []);
  const activeIncidentSnapshot = createActiveIncidentSnapshot(rawIncList, routingNow);

  try {
    const avoidanceRoutes = await _generateAvoidanceRoutes(start, end, validRoutes, sessionSignal, metrics, activeIncidentSnapshot);
    if (avoidanceRoutes.length > 0) {
      validRoutes.push(...avoidanceRoutes);
      if (_isDebugRouting()) console.log(`[OSRM] candidate routes: Đã bổ sung ${avoidanceRoutes.length} tuyến tránh sự cố vào tập ứng viên.`);
    }
  } catch (err) {
    if (_isDebugRouting()) console.warn('[SafeRoute] Lỗi tạo tuyến tránh:', err);
  }

  if (thisRequestId !== routingRequestId || sessionSignal.aborted) return [];

  metrics.candidates = validRoutes.length;

  // 1. Loại trùng lặp tuyến
  validRoutes = _deduplicateRoutes(validRoutes);
  metrics.uniqueRoutes = validRoutes.length;
  if (_isDebugRouting()) console.log(`[OSRM] deduplicated routes: ${metrics.candidates} ứng viên -> ${metrics.uniqueRoutes} tuyến duy nhất`);

  // 2. Sắp xếp các tuyến ứng viên theo thời gian di chuyển (duration) từ nhanh nhất đến chậm hơn
  // Tuyến nhanh nhất luôn được chọn làm tuyến chính (primary route), các tuyến tiếp theo là tuyến thay thế (alternative routes)
  validRoutes.sort((a, b) => {
    if (Math.abs(a.duration - b.duration) > 0.05) {
      return a.duration - b.duration;
    }
    return a.distance - b.distance;
  });

  // 3. Giới hạn số lượng tuyến gợi ý tối đa cho giao diện (MAX_SUGGESTED_ROUTES = 3)
  const maxSuggestedRoutes = (typeof window !== 'undefined' && window.MAX_SUGGESTED_ROUTES) 
    ? window.MAX_SUGGESTED_ROUTES 
    : ((typeof CONFIG !== 'undefined' && CONFIG.max_suggested_routes) ? CONFIG.max_suggested_routes : 3);

  if (validRoutes.length > maxSuggestedRoutes) {
    validRoutes = validRoutes.slice(0, maxSuggestedRoutes);
  }

  // 4. CHỈ tính rủi ro cho tối đa MAX_SUGGESTED_ROUTES tuyến được chọn hiển thị
  // Không tính rủi ro cho các tuyến ứng viên chắc chắn bị loại (tiết kiệm CPU)
  // Tạo shallow copy để đảm bảo route đã đóng băng trong RouteCache không bị đột biến
  validRoutes = validRoutes.map(r => {
    const copy = { ...r };
    copy.riskScore = calculateRouteRisk(copy, activeIncidentSnapshot);
    return copy;
  });

  const finalRoutes = validRoutes.map((route, index) => ({
    ...route,
    id: String.fromCharCode(65 + index),
    routeIndex: index,
  }));

  // Tải chi tiết navigation steps (turn-by-turn) cho tuyến đề xuất đầu tiên nếu được bật
  const finalStepsEnabled = (typeof window !== 'undefined' && window.OSRM_FINAL_STEPS != null) 
    ? window.OSRM_FINAL_STEPS === true
    : (typeof CONFIG !== 'undefined' && CONFIG.osrm_final_steps !== false);

  if (finalStepsEnabled && finalRoutes.length > 0) {
    const topRoute = finalRoutes[0];
    if (topRoute.waypoints && (!topRoute.legs || !topRoute.legs[0]?.steps?.length)) {
      try {
        if (_isDebugRouting()) console.log('[OSRM] final route: Tải turn-by-turn navigation steps cho tuyến đề xuất...');
        const detailed = await fetchOsrmRoute(topRoute.waypoints, { overview: 'full', steps: true, alternatives: false }, sessionSignal, metrics);
        if (detailed && detailed.length > 0 && detailed[0].legs) {
          topRoute.legs = Array.isArray(detailed[0].legs) ? [...detailed[0].legs] : [];
        }
      } catch (_) {}
    }
  }

  const endTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  metrics.totalTimeMs = Math.round(endTime - startTime);

  if (_isDebugRouting()) {
    console.log(`[OSRM Metrics]
  Requests: ${metrics.requests}
  Cache hits: ${metrics.cacheHits}
  In-flight hits: ${metrics.inFlightHits}
  Candidates: ${metrics.candidates}
  Unique routes: ${metrics.uniqueRoutes}
  Total time: ${(metrics.totalTimeMs / 1000).toFixed(2)}s`);
  }

  return finalRoutes;
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

async function planMultimodalFallback(start, end, signal = null, metrics = null) {
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
    const routes1 = await fetchOsrmRoute([start, originHub], { overview: 'full', steps: false, alternatives: false }, signal, metrics);
    if (routes1.length) roadToOriginHub = routes1[0];
  } catch (_) {}

  try {
    const routes2 = await fetchOsrmRoute([destHub, end], { overview: 'full', steps: false, alternatives: false }, signal, metrics);
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

  roadToOriginHub = { ...roadToOriginHub };
  roadFromDestHub = { ...roadFromDestHub };
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
   3b. GEOMETRY METADATA & SPATIAL INDEX CACHE (WEAKMAPS)
--------------------------------------------------------------- */

/**
 * WeakMap lưu trữ siêu dữ liệu hình học của tuyến đường (bounding box, buffered bbox, coordinate count, signature).
 * Tự động giải phóng bộ nhớ khi route bị Garbage Collector thu hồi, chống memory leak.
 * @type {WeakMap<object, { bbox: number[], bufferedBbox: number[], coordCount: number, segmentCount: number, sig: string }>}
 */
const _routeMetadataCache = new WeakMap();

/**
 * WeakMap lưu trữ Bounding Box bao phủ của sự cố và các nút liên kết (nodes, roadCoords).
 * @type {WeakMap<object, number[]>}
 */
const _incidentBboxCache = new WeakMap();

/**
 * Lấy danh sách sampleCount điểm tọa độ [lat, lng] phân bố đều dọc theo polyline
 */
function _getRouteSamplePoints(coords, sampleCount = 15) {
  if (!coords || !Array.isArray(coords) || coords.length === 0) return [];
  const len = coords.length;
  if (len <= sampleCount) {
    return coords.slice();
  }
  const samples = [];
  const step = (len - 1) / (sampleCount - 1);
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.min(len - 1, Math.round(i * step));
    samples.push(coords[idx]);
  }
  return samples;
}

/**
 * Lấy chữ ký hình học (Geometry Signature) bằng cách lấy mẫu 15 điểm đều nhau dọc theo polyline,
 * làm tròn 3 chữ số thập phân (~100m) để nhận diện các tuyến đường đi cùng một hành lang.
 */
function _getRouteGeometrySignature(coords, sampleCount = 15) {
  const samples = _getRouteSamplePoints(coords, sampleCount);
  if (!samples.length) return '';
  return samples.map(p => `${Number(p[0]).toFixed(3)},${Number(p[1]).toFixed(3)}`).join('|');
}

/**
 * Trích xuất và cache siêu dữ liệu hình học của tuyến đường trong WeakMap:
 * - bbox: [minLat, maxLat, minLng, maxLng]
 * - bufferedBbox: bbox mở rộng thêm 600m đệm (~0.0055 độ) để lọc nhanh sự cố
 * - coordCount: số lượng đỉnh
 * - segmentCount: số lượng phân đoạn
 * - sig: chữ ký hình học 15 mẫu
 * - samplePoints: mảng 15 tọa độ mẫu phục vụ so khớp prefilter
 */
function getRouteMetadata(route) {
  if (!route || typeof route !== 'object') return null;
  const cached = _routeMetadataCache.get(route);
  if (cached) return cached;

  const coords = route.coords;
  if (!coords || !Array.isArray(coords) || coords.length === 0) {
    const emptyMeta = {
      bbox: null,
      bufferedBbox: null,
      coordCount: 0,
      segmentCount: 0,
      sig: '',
      samplePoints: []
    };
    _routeMetadataCache.set(route, emptyMeta);
    return emptyMeta;
  }

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  const len = coords.length;

  for (let i = 0; i < len; i++) {
    const p = coords[i];
    const lat = p[0];
    const lng = p[1];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  // Vùng đệm 600m: 1 độ vĩ ≈ 111.13km -> 600m ≈ 0.0055°
  // Đảm bảo mọi điểm ngoài bufferedBbox đều có khoảng cách tối thiểu > 600m đến polyline,
  // vượt xa ngưỡng ảnh hưởng rủi ro tối đa (300m / 350m).
  const midLat = (minLat + maxLat) / 2;
  const latBuf = 0.0055;
  const cosLat = Math.cos(midLat * Math.PI / 180);
  const lngBuf = 0.0055 / (cosLat > 0.1 ? cosLat : 1.0);

  const bbox = [minLat, maxLat, minLng, maxLng];
  const bufferedBbox = [
    minLat - latBuf,
    maxLat + latBuf,
    minLng - lngBuf,
    maxLng + lngBuf
  ];

  const samplePoints = _getRouteSamplePoints(coords, 15);
  const sig = route._sig || samplePoints.map(p => `${Number(p[0]).toFixed(3)},${Number(p[1]).toFixed(3)}`).join('|');
  if (!route._sig) route._sig = sig;

  const meta = {
    bbox,
    bufferedBbox,
    coordCount: len,
    segmentCount: Math.max(0, len - 1),
    sig,
    samplePoints
  };

  _routeMetadataCache.set(route, meta);
  return meta;
}

/**
 * Trích xuất và cache Bounding Box của một sự cố (bao gồm cả các node liên kết và roadCoords)
 */
function getIncidentBbox(inc) {
  if (!inc || typeof inc !== 'object') return null;
  const cached = _incidentBboxCache.get(inc);
  if (cached) return cached;

  let minLat = inc.lat, maxLat = inc.lat;
  let minLng = inc.lng, maxLng = inc.lng;

  if (inc.nodes && Array.isArray(inc.nodes)) {
    for (let i = 0; i < inc.nodes.length; i++) {
      const n = inc.nodes[i];
      if (n && typeof n.lat === 'number' && typeof n.lng === 'number') {
        if (n.lat < minLat) minLat = n.lat;
        if (n.lat > maxLat) maxLat = n.lat;
        if (n.lng < minLng) minLng = n.lng;
        if (n.lng > maxLng) maxLng = n.lng;
      }
    }
  }

  if (inc.roadCoords && Array.isArray(inc.roadCoords)) {
    for (let i = 0; i < inc.roadCoords.length; i++) {
      const pt = inc.roadCoords[i];
      if (pt && pt.length >= 2) {
        if (pt[0] < minLat) minLat = pt[0];
        if (pt[0] > maxLat) maxLat = pt[0];
        if (pt[1] < minLng) minLng = pt[1];
        if (pt[1] > maxLng) maxLng = pt[1];
      }
    }
  }

  const bbox = [minLat, maxLat, minLng, maxLng];
  _incidentBboxCache.set(inc, bbox);
  return bbox;
}

/**
 * Kiểm tra xem Bounding Box của sự cố có giao với vùng đệm buffered Bbox của route không (O(1)).
 * Nếu không giao nhau, sự cố chắc chắn cách polyline > 600m, an toàn loại bỏ 100% không làm sai lệch rủi ro.
 */
function isIncidentNearRouteBbox(incBbox, routeBufferedBbox) {
  if (!incBbox || !routeBufferedBbox) return true;
  // incBbox: [iMinLat, iMaxLat, iMinLng, iMaxLng]
  // routeBufferedBbox: [rMinLat, rMaxLat, rMinLng, rMaxLng]
  if (incBbox[1] < routeBufferedBbox[0] || incBbox[0] > routeBufferedBbox[1]) return false;
  if (incBbox[3] < routeBufferedBbox[2] || incBbox[2] > routeBufferedBbox[3]) return false;
  return true;
}

/* ---------------------------------------------------------------
   4. CHẤM ĐIỂM RỦI RO & PHÂN TÍCH SỰ CỐ (WEAKMAP CACHE & SINGLE-SCAN)
--------------------------------------------------------------- */

/**
 * WeakMap lưu trữ kết quả phân tích sự cố của tuyến đường (riskScore, rawRisk, items, _snapshotVersion).
 * Tự động giải phóng khi route bị thu hồi bởi Garbage Collector (zero memory leak).
 * @type {WeakMap<object, { riskScore: number, rawRisk: number, items: Array<object>, _snapshotVersion: number }>}
 */
const _routeIncidentAnalysisCache = new WeakMap();

/**
 * Phiên bản của dữ liệu snapshot sự cố, tăng tự động khi có sự kiện 'incidents-changed'.
 */
let _incidentSnapshotVersion = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('incidents-changed', () => {
    _incidentSnapshotVersion++;
  });
}

/**
 * Tạo bản chụp trạng thái hoạt động của sự cố (Active Incident Snapshot) cho một chu kỳ tìm đường:
 * - Tính độ tin cậy confidence duy nhất 1 lần cho mỗi incident với mốc thời gian routingNow nhất quán.
 * - Loại bỏ sớm các incident đã hết hạn (c <= 0.1) để giảm tải cho toàn bộ các bước tính toán sau.
 * - Gắn _snapshotVersion để kiểm tra tính hợp lệ của cache.
 * - Không làm thay đổi (mutate) incident gốc.
 * 
 * @param {Array<object>} [incList] - Danh sách incident thô
 * @param {number} [routingNow] - Mốc thời gian của chu kỳ routing (mặc định Date.now())
 * @returns {Array<object>} Danh sách snapshot gồm { incident, confidence, level, severity, type, lat, lng, roadBearing, osmWayId, nodes, roadCoords }
 */
function createActiveIncidentSnapshot(incList, routingNow = Date.now()) {
  const rawList = incList || (typeof window !== 'undefined' && window.incidents ? window.incidents : (typeof incidents !== 'undefined' ? incidents : []));
  if (!Array.isArray(rawList) || rawList.length === 0) return [];

  const confFn = (typeof window !== 'undefined' && window.calculateCurrentConfidence) 
    ? window.calculateCurrentConfidence 
    : (typeof calculateCurrentConfidence === 'function' ? calculateCurrentConfidence : (() => 50));

  const snapshot = [];
  const len = rawList.length;
  for (let i = 0; i < len; i++) {
    const inc = rawList[i];
    if (!inc || typeof inc !== 'object') continue;
    const c = confFn(inc, routingNow);
    if (c <= 0.1) continue;

    snapshot.push({
      incident: inc,
      confidence: c,
      level: inc.level || 'thap',
      severity: (typeof inc.severity === 'number') ? inc.severity : 0.2,
      type: inc.type || 'obstacle',
      lat: inc.lat,
      lng: inc.lng,
      roadBearing: inc.roadBearing != null ? inc.roadBearing : null,
      osmWayId: inc.osmWayId || null,
      nodes: inc.nodes || null,
      roadCoords: inc.roadCoords || null
    });
  }
  snapshot._snapshotVersion = _incidentSnapshotVersion;
  return snapshot;
}

/**
 * Quét polyline trong một lần duyệt duy nhất để tính:
 * - distance: khoảng cách vuông góc nhỏ nhất tới polyline (mét)
 * - segmentIndex: chỉ số phân đoạn [i, i+1] gần nhất
 * - projectedPoint: tọa độ [lat, lng] của điểm hình chiếu vuông góc trên polyline
 * - bearing: hướng phương vị (độ, [0, 360)) của phân đoạn gần nhất
 * 
 * Tối ưu hóa:
 * - So sánh khoảng cách bằng bình phương (distSq), chỉ tính Math.sqrt một lần duy nhất ở cuối.
 * - Zero allocations (không cấp phát object tạm) bên trong vòng lặp chính.
 * 
 * @param {number} lat - Vĩ độ của điểm cần đo
 * @param {number} lng - Kinh độ của điểm cần đo
 * @param {Array<[number, number]>} coords - Mảng tọa độ [[lat, lng], ...] của polyline
 * @param {object} [options] - Tuỳ chọn { needBearing: boolean }
 * @returns {{ distance: number, segmentIndex: number, projectedPoint: [number, number], bearing: number }}
 */
function getNearestPointOnPolyline(lat, lng, coords, options = {}) {
  const isValidCoord = (typeof isValidCoordinate === 'function') 
    ? isValidCoordinate 
    : ((la, lo) => typeof la === 'number' && typeof lo === 'number' && Number.isFinite(la) && Number.isFinite(lo));

  if (!isValidCoord(lat, lng)) {
    return { distance: Infinity, segmentIndex: -1, projectedPoint: null, bearing: 0 };
  }
  if (!coords || !Array.isArray(coords) || coords.length === 0) {
    return { distance: Infinity, segmentIndex: -1, projectedPoint: null, bearing: 0 };
  }

  // Trường hợp polyline chỉ có 1 điểm đỉnh
  if (coords.length === 1) {
    const p0 = coords[0];
    if (!p0 || !isValidCoord(p0[0], p0[1])) {
      return { distance: Infinity, segmentIndex: -1, projectedPoint: null, bearing: 0 };
    }
    const haversineM = (typeof haversineMeters === 'function') ? haversineMeters : ((la1, lo1, la2, lo2) => {
      const dLat = (la2 - la1) * Math.PI / 180;
      const dLng = (lo2 - lo1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    });
    return {
      distance: haversineM(lat, lng, p0[0], p0[1]),
      segmentIndex: 0,
      projectedPoint: [p0[0], p0[1]],
      bearing: 0
    };
  }

  let minDistSq = Infinity;
  let bestSegIdx = 0;
  let bestT = 0;

  const rad = Math.PI / 180;
  const cosLat = Math.cos(lat * rad);
  const METERS_PER_DEG_LAT = 111132.95;
  const METERS_PER_DEG_LNG = 111412.84 * (cosLat > 0.01 ? cosLat : 1.0);

  const numSegs = coords.length - 1;
  for (let i = 0; i < numSegs; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    if (!p1 || !p2 || !isValidCoord(p1[0], p1[1]) || !isValidCoord(p2[0], p2[1])) {
      continue;
    }

    const x1 = (p1[1] - lng) * METERS_PER_DEG_LNG;
    const y1 = (p1[0] - lat) * METERS_PER_DEG_LAT;
    const x2 = (p2[1] - lng) * METERS_PER_DEG_LNG;
    const y2 = (p2[0] - lat) * METERS_PER_DEG_LAT;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLenSq = dx * dx + dy * dy;

    let distSq;
    let t = 0;
    if (segLenSq < 1e-6) {
      distSq = x1 * x1 + y1 * y1;
      t = 0;
    } else {
      t = -(x1 * dx + y1 * dy) / segLenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      distSq = projX * projX + projY * projY;
    }

    if (distSq < minDistSq) {
      minDistSq = distSq;
      bestSegIdx = i;
      bestT = t;
      if (distSq === 0) break;
    }
  }

  if (!Number.isFinite(minDistSq)) {
    return { distance: Infinity, segmentIndex: -1, projectedPoint: null, bearing: 0 };
  }

  const distance = Math.sqrt(minDistSq);

  // Tính tọa độ điểm chiếu projectedPoint
  const pA = coords[bestSegIdx];
  const pB = coords[bestSegIdx + 1];
  const projLat = pA[0] + bestT * (pB[0] - pA[0]);
  const projLng = pA[1] + bestT * (pB[1] - pA[1]);

  // Tính bearing của segment gần nhất
  let bearing = 0;
  if (options.needBearing !== false) {
    if (pA[0] === pB[0] && pA[1] === pB[1]) {
      if (bestSegIdx > 0) {
        const prev = coords[bestSegIdx - 1];
        bearing = ((_bearingRad(prev[0], prev[1], pA[0], pA[1]) * 180 / Math.PI) + 360) % 360;
      }
    } else {
      bearing = ((_bearingRad(pA[0], pA[1], pB[0], pB[1]) * 180 / Math.PI) + 360) % 360;
    }
  }

  return {
    distance,
    segmentIndex: bestSegIdx,
    projectedPoint: [projLat, projLng],
    bearing
  };
}

/**
 * Hàm đo khoảng cách tối thiểu từ một điểm đến polyline (non-breaking wrapper gọi getNearestPointOnPolyline)
 */
function minDistanceToPolyline(lat, lng, coords) {
  const res = getNearestPointOnPolyline(lat, lng, coords, { needBearing: false });
  return res ? res.distance : Infinity;
}

/**
 * Phân tích rủi ro và các sự cố liên quan đến tuyến đường trong MỘT lần quét hình học:
 * - Cache kết quả phân tích trong WeakMap theo đối tượng route (O(1) cho các lần truy vấn tiếp theo).
 * - Dùng getNearestPointOnPolyline để gộp khoảng cách + nearest segment + bearing trong 1 lần duyệt polyline duy nhất.
 * - Trả về { riskScore, rawRisk, items } dùng chung cho cả calculateRouteRisk và findIncidentsAlongRoute.
 * 
 * @param {object} route - Tuyến đường { coords, distance, duration, ... }
 * @param {Array<object>} [incidentSnapshot] - Snapshot sự cố của chu kỳ routing (tùy chọn)
 * @returns {{ riskScore: number, rawRisk: number, items: Array<object> }}
 */
function analyzeRouteIncidents(route, incidentSnapshot = null) {
  if (!route || typeof route !== 'object' || !route.coords || !Array.isArray(route.coords) || route.coords.length === 0) {
    return { riskScore: 0, rawRisk: 0, items: [] };
  }

  // 1. Kiểm tra cache WeakMap
  // Khi incidentSnapshot được truyền vào khác với snapshot toàn cục -> bypass cache hoàn toàn (caller truyền snapshot tùy chỉnh)
  const isCustomSnapshot = Boolean(incidentSnapshot && incidentSnapshot._snapshotVersion !== _incidentSnapshotVersion);

  if (!isCustomSnapshot) {
    const cached = _routeIncidentAnalysisCache.get(route);
    if (cached && cached._snapshotVersion === _incidentSnapshotVersion) {
      return cached;
    }
  }

  const snapshot = incidentSnapshot || createActiveIncidentSnapshot();
  const meta = getRouteMetadata(route);
  const routeBufferedBbox = meta ? meta.bufferedBbox : null;
  const rCoords = route.coords;

  const riskImpact = (typeof RISK_IMPACT !== 'undefined')
    ? RISK_IMPACT
    : ((typeof CONFIG !== 'undefined' && CONFIG.risk_impact) ? CONFIG.risk_impact : { STRONG_THRESHOLD_M: 100, MEDIUM_THRESHOLD_M: 300, STRONG_WEIGHT: 1.0, MEDIUM_WEIGHT: 0.4 });
  const typeWeights = (typeof INCIDENT_TYPE_WEIGHT !== 'undefined') 
    ? INCIDENT_TYPE_WEIGHT 
    : ((typeof CONFIG !== 'undefined' && CONFIG.incident_type_weight) ? CONFIG.incident_type_weight : {});
  const levelWeights = (typeof INCIDENT_LEVEL_WEIGHT !== 'undefined')
    ? INCIDENT_LEVEL_WEIGHT
    : ((typeof CONFIG !== 'undefined' && CONFIG.incident_level_weight) ? CONFIG.incident_level_weight : {});

  let raw = 0;
  const items = [];

  for (let i = 0; i < snapshot.length; i++) {
    const item = snapshot[i];
    const c = item.confidence;
    if (c <= 0.1) continue;

    const rawInc = item.incident || item;

    // Spatial prefilter bằng bounding box
    if (routeBufferedBbox) {
      const incBbox = getIncidentBbox(rawInc);
      if (!isIncidentNearRouteBbox(incBbox, routeBufferedBbox)) continue;
    }

    // Gộp khoảng cách + bearing trong 1 lần quét polyline duy nhất
    const needBearing = (item.roadBearing != null && rCoords.length >= 2);
    const nearInfo = getNearestPointOnPolyline(item.lat, item.lng, rCoords, { needBearing });
    let distM = nearInfo ? nearInfo.distance : Infinity;

    // Kiểm tra nodes liên kết nếu có
    if (item.nodes && item.nodes.length > 0) {
      for (let n = 0; n < item.nodes.length; n++) {
        const node = item.nodes[n];
        if (node && typeof node.lat === 'number' && typeof node.lng === 'number') {
          const dNInfo = getNearestPointOnPolyline(node.lat, node.lng, rCoords, { needBearing: false });
          if (dNInfo && dNInfo.distance < distM) {
            distM = dNInfo.distance;
          }
        }
      }
    }

    // Kiểm tra roadCoords liên kết nếu có
    if (item.roadCoords && item.roadCoords.length >= 2) {
      for (let p = 0; p < item.roadCoords.length; p++) {
        const pt = item.roadCoords[p];
        if (pt && pt.length >= 2) {
          const dPInfo = getNearestPointOnPolyline(pt[0], pt[1], rCoords, { needBearing: false });
          if (dPInfo && dPInfo.distance < distM) {
            distM = dPInfo.distance;
          }
        }
      }
    }

    // Nếu khoảng cách vượt ngưỡng ảnh hưởng (MEDIUM_THRESHOLD_M = 300m), bỏ qua
    if (distM >= riskImpact.MEDIUM_THRESHOLD_M) continue;

    // Tính directional factor
    let directionalFactor = 1.0;
    if (needBearing && nearInfo && nearInfo.bearing != null) {
      let diff = Math.abs(nearInfo.bearing - item.roadBearing) % 360;
      if (diff > 180) diff = 360 - diff;
      if (diff > 100) {
        directionalFactor = (item.osmWayId || distM > 10) ? 0.08 : 0.35;
      }
    }

    let distW = 0;
    if (distM < riskImpact.STRONG_THRESHOLD_M) {
      distW = riskImpact.STRONG_WEIGHT * directionalFactor;
    } else if (distM < riskImpact.MEDIUM_THRESHOLD_M) {
      distW = riskImpact.MEDIUM_WEIGHT * directionalFactor;
    }

    if (distW > 0) {
      const typeW = typeWeights[item.type] || 0.1;
      const levelW = levelWeights[item.level] || 0.2;
      raw += distW * typeW * levelW * (c / 100);
    }

    // Thêm vào danh sách items cho cảnh báo sự cố
    items.push({
      incident: rawInc,
      distanceM: Math.round(distM),
      confidence: Math.round(c),
      zone: distM < riskImpact.STRONG_THRESHOLD_M ? 'direct' : 'nearby'
    });
  }

  const riskScore = raw <= 0 ? 0 : Math.min(100, Math.max(1, Math.round((raw / 3.0) * 100)));

  const analysis = {
    riskScore,
    rawRisk: raw,
    items,
    _snapshotVersion: snapshot._snapshotVersion
  };

  if (!isCustomSnapshot) {
    _routeIncidentAnalysisCache.set(route, analysis);
  }
  return analysis;
}

/**
 * Tính điểm rủi ro của tuyến đường [0 - 100] (0 = an toàn, 100 = cực kỳ nguy hiểm).
 * Tái sử dụng kết quả phân tích sự cố từ analyzeRouteIncidents qua WeakMap cache.
 * 
 * @param {object} route - Tuyến đường
 * @param {Array<object>} [incidentSnapshot] - Snapshot sự cố của chu kỳ routing (tùy chọn)
 * @returns {number} Điểm rủi ro [0 - 100]
 */
function calculateRouteRisk(route, incidentSnapshot = null) {
  const analysis = analyzeRouteIncidents(route, incidentSnapshot);
  return analysis.riskScore;
}

/**
 * Tìm tất cả sự cố nằm gần tuyến đường (trong bán kính MEDIUM_THRESHOLD_M = 300m).
 * Trả về mảng { incident, distanceM, confidence, zone } sắp xếp theo khoảng cách tăng dần.
 * Tái sử dụng kết quả phân tích sự cố từ analyzeRouteIncidents qua WeakMap cache (0 geometry scan).
 * 
 * @param {object} route - Tuyến đường
 * @param {Array<object>} [incidentSnapshot] - Snapshot sự cố của chu kỳ routing (tùy chọn)
 * @returns {Array<object>} Danh sách cảnh báo sự cố
 */
function findIncidentsAlongRoute(route, incidentSnapshot = null) {
  const analysis = analyzeRouteIncidents(route, incidentSnapshot);
  return analysis.items.slice().sort((a, b) => a.distanceM - b.distanceM);
}

/* ---------------------------------------------------------------
   4b. WAYPOINT AVOIDANCE ROUTING
   Thuật toán tạo tuyến tránh sự cố:
   1. Phát hiện sự cố trực tiếp trên tuyến đường OSRM
   2. Gom nhóm sự cố gần nhau thành cluster
   3. Tính waypoint vuông góc với hướng đường, xa khỏi sự cố
   4. Gọi OSRM lấy tuyến mới qua waypoint tránh
   5. Gộp tất cả ứng viên, loại trùng, trả về pool đa dạng
--------------------------------------------------------------- */

/**
 * Tính bearing (góc phương vị, radian) từ điểm A đến B trên mặt cầu
 */
function _bearingRad(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const la1 = lat1 * Math.PI / 180;
  const la2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return Math.atan2(y, x);
}

/**
 * Tính điểm đích từ vị trí gốc theo bearing và khoảng cách (mét)
 * Công thức Haversine nghịch đảo (inverse Haversine)
 */
function _destinationPoint(lat, lng, bearing, distanceMeters) {
  const R = 6371000;
  const d = distanceMeters / R;
  const la1 = lat * Math.PI / 180;
  const lo1 = lng * Math.PI / 180;
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(bearing)
  );
  const lo2 = lo1 + Math.atan2(
    Math.sin(bearing) * Math.sin(d) * Math.cos(la1),
    Math.cos(d) - Math.sin(la1) * Math.sin(la2)
  );
  return {
    lat: la2 * 180 / Math.PI,
    lng: ((lo2 * 180 / Math.PI) + 540) % 360 - 180
  };
}

/**
 * Tính các waypoint tránh sự cố: vuông góc với hướng đường (cả bên trái và bên phải).
 * @param {Array} routeCoords - Mảng [lat, lng] của tuyến đường
 * @param {number} incLat - Vĩ độ sự cố
 * @param {number} incLng - Kinh độ sự cố
 * @param {number} offsetMeters - Khoảng cách lệch (mét)
 * @returns {Array<{ lat: number, lng: number }>} Danh sách [wpLeft, wpRight]
 */
function _computeAvoidanceWaypoints(routeCoords, incLat, incLng, offsetMeters) {
  // Tìm điểm gần nhất trên polyline với sự cố
  let minDist = Infinity, closestIdx = 0;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversineKm(routeCoords[i][0], routeCoords[i][1], incLat, incLng);
    if (d < minDist) { minDist = d; closestIdx = i; }
  }

  const p = routeCoords[closestIdx];
  const pNext = routeCoords[Math.min(closestIdx + 1, routeCoords.length - 1)];
  let routeBearing;
  if (p[0] === pNext[0] && p[1] === pNext[1] && closestIdx > 0) {
    const pPrev = routeCoords[closestIdx - 1];
    routeBearing = _bearingRad(pPrev[0], pPrev[1], p[0], p[1]);
  } else {
    routeBearing = _bearingRad(p[0], p[1], pNext[0], pNext[1]);
  }

  // Hai hướng vuông góc với hướng đường (Trái 90° và Phải -90°)
  const perpLeft = routeBearing + Math.PI / 2;
  const perpRight = routeBearing - Math.PI / 2;

  const wpLeft = _destinationPoint(p[0], p[1], perpLeft, offsetMeters);
  const wpRight = _destinationPoint(p[0], p[1], perpRight, offsetMeters);

  return [wpLeft, wpRight];
}

/**
 * Gom nhóm sự cố gần nhau (< 500m) thành cluster bằng Spatial Hash Grid:
 * - Thay thế O(n²) all-pairs scan bằng Spatial Grid với cellSize = 0.005° (~555m).
 * - Mỗi incident được map vào (cellX, cellY).
 * - Chỉ kiểm tra ô hiện tại và 8 ô lân cận (9 ô tổng cộng), độ phức tạp tiệm cận O(n * M_local).
 * - Khoảng cách thực tế vẫn dùng haversineKm < 0.5km để đảm bảo tính chuẩn xác 100%.
 * - Bảo đảm toàn vẹn ngữ nghĩa: centroid, count, severity, và deterministic sorting.
 * - Xử lý an toàn mọi edge cases: 0 incident, 1 incident, cell boundary, invalid coords.
 */
function _clusterIncidents(activeIncidents) {
  if (!Array.isArray(activeIncidents) || activeIncidents.length === 0) return [];
  if (activeIncidents.length === 1) {
    const item = activeIncidents[0];
    const inc = item && item.incident ? item.incident : {};
    const lw = (typeof INCIDENT_LEVEL_WEIGHT !== 'undefined' && INCIDENT_LEVEL_WEIGHT[inc.level]) || 0.2;
    const severity = ((item.confidence || 50) / 100) * lw;
    return [{
      lat: (inc && typeof inc.lat === 'number') ? inc.lat : 0,
      lng: (inc && typeof inc.lng === 'number') ? inc.lng : 0,
      count: 1,
      severity
    }];
  }

  const CELL_SIZE = 0.005; // ~555m theo vĩ độ, đảm bảo bán kính cluster 500m luôn nằm trong ô lân cận (dx in [-1, 1], dy in [-1, 1])
  const grid = new Map();

  for (let i = 0; i < activeIncidents.length; i++) {
    const inc = activeIncidents[i] && activeIncidents[i].incident;
    const lat = inc ? inc.lat : null;
    const lng = inc ? inc.lng : null;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    const cx = Math.floor(lng / CELL_SIZE);
    const cy = Math.floor(lat / CELL_SIZE);
    const key = `${cx}_${cy}`;
    let cellList = grid.get(key);
    if (!cellList) {
      cellList = [];
      grid.set(key, cellList);
    }
    cellList.push(i);
  }

  const clusters = [];
  const used = new Set();

  for (let i = 0; i < activeIncidents.length; i++) {
    if (used.has(i)) continue;
    const cluster = [activeIncidents[i]];
    used.add(i);

    const incI = activeIncidents[i] && activeIncidents[i].incident;
    if (!incI || typeof incI.lat !== 'number' || typeof incI.lng !== 'number' || !Number.isFinite(incI.lat) || !Number.isFinite(incI.lng)) {
      // Trường hợp coordinate invalid: tạo cluster riêng để không làm mất incident
      const lw = (typeof INCIDENT_LEVEL_WEIGHT !== 'undefined' && incI && INCIDENT_LEVEL_WEIGHT[incI.level]) || 0.2;
      const severity = ((activeIncidents[i].confidence || 50) / 100) * lw;
      clusters.push({ lat: incI ? incI.lat : 0, lng: incI ? incI.lng : 0, count: 1, severity });
      continue;
    }

    const cx = Math.floor(incI.lng / CELL_SIZE);
    const cy = Math.floor(incI.lat / CELL_SIZE);

    // Thu thập các ứng viên từ ô hiện tại và 8 ô lân cận
    const candidateIndices = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborKey = `${cx + dx}_${cy + dy}`;
        const cellList = grid.get(neighborKey);
        if (cellList) {
          for (let k = 0; k < cellList.length; k++) {
            const j = cellList[k];
            if (j > i && !used.has(j)) {
              candidateIndices.push(j);
            }
          }
        }
      }
    }

    // Sắp xếp thứ tự chỉ số tăng dần để đảm bảo tính tất định (deterministic) tương đương thuật toán gốc
    if (candidateIndices.length > 1) {
      candidateIndices.sort((a, b) => a - b);
    }

    for (let k = 0; k < candidateIndices.length; k++) {
      const j = candidateIndices[k];
      if (used.has(j)) continue;
      const incJ = activeIncidents[j].incident;
      const d = haversineKm(incI.lat, incI.lng, incJ.lat, incJ.lng);
      if (d < 0.5) {
        cluster.push(activeIncidents[j]);
        used.add(j);
      }
    }

    // Trọng tâm cluster (centroid)
    const avgLat = cluster.reduce((s, w) => s + w.incident.lat, 0) / cluster.length;
    const avgLng = cluster.reduce((s, w) => s + w.incident.lng, 0) / cluster.length;
    // Mức độ nghiêm trọng tổng hợp
    const severity = cluster.reduce((s, w) => {
      const lw = (typeof INCIDENT_LEVEL_WEIGHT !== 'undefined' && INCIDENT_LEVEL_WEIGHT[w.incident.level]) || 0.2;
      return s + (w.confidence / 100) * lw;
    }, 0);
    clusters.push({ lat: avgLat, lng: avgLng, count: cluster.length, severity });
  }

  clusters.sort((a, b) => b.severity - a.severity);
  return clusters;
}

/**
 * Kiểm tra xem hai tuyến đường có trùng lặp về mặt bản chất hình học không:
 * Tối ưu hóa 3 tầng (Multi-tier Architecture):
 * 
 * LEVEL 0 — Identity Check:
 * - r1 === r2 -> return true (cùng địa chỉ tham chiếu, O(1))
 * 
 * LEVEL 1 — Cheap Checks (O(1)):
 * - Chênh lệch cự ly (distance) >= 2% hoặc thời gian (duration) >= 2% -> return false
 * - Bounding box không giao nhau (trong dung sai 0.001 độ ~110m) -> return false
 * 
 * LEVEL 2 — Geometry Signature / Sample Points Prefilter:
 * - Tuyệt đối KHÔNG kết luận duplicate ngay khi signature trùng nhau (để tránh rủi ro collision)
 * - So sánh các điểm mẫu 15 points: nếu chênh lệch đáng kể (> 15% số điểm mẫu lệch > 0.002 độ) -> return false
 * - Nếu vượt qua LEVEL 2 (có khả năng trùng) -> CHUYỂN TIẾP SANG LEVEL 3
 * 
 * LEVEL 3 — Exact Geometry Comparison:
 * - Lấy mẫu 10 điểm đo khoảng cách trực giao point-to-segment (minDistanceToPolyline < 50m)
 * - Tối ưu early break: ngay khi có 2 điểm trượt (mismatch > 1) -> dừng sớm lập tức (return false)
 * - Đạt tỷ lệ trùng lặp >= 85% (ngưỡng chuẩn) -> return true
 */
function _fastSampleMatch(ca, cb, samples = 30, tol = 0.0005) {
  if (!ca || !cb || ca.length < 2 || cb.length < 2) return false;
  const effectiveSamples = Math.min(samples, ca.length, cb.length);
  if (effectiveSamples < 2) return false;

  const stepA = (ca.length - 1) / (effectiveSamples - 1);
  const stepB = (cb.length - 1) / (effectiveSamples - 1);
  let matched = 0;
  for (let i = 0; i < effectiveSamples; i++) {
    const pa = ca[Math.round(i * stepA)];
    const pb = cb[Math.round(i * stepB)];
    if (Math.abs(pa[0] - pb[0]) < tol && Math.abs(pa[1] - pb[1]) < tol) matched++;
  }
  return (matched / effectiveSamples) >= 0.85;
}

function _areRoutesDuplicate(r1, r2) {
  if (!r1 || !r2) return false;
  if (r1 === r2) return true;

  const c1 = r1.coords;
  const c2 = r2.coords;
  if (!c1 || !c2 || c1.length === 0 || c2.length === 0) return false;

  // LEVEL 1: Cheap Checks (distance, duration, bbox)
  const distDiff = Math.abs(r1.distance - r2.distance) / Math.max(r1.distance, 0.01);
  const durDiff = Math.abs(r1.duration - r2.duration) / Math.max(r1.duration, 0.01);
  if (distDiff >= 0.02 || durDiff >= 0.02) return false;

  const meta1 = getRouteMetadata(r1);
  const meta2 = getRouteMetadata(r2);

  if (meta1 && meta2 && meta1.bbox && meta2.bbox) {
    const b1 = meta1.bbox;
    const b2 = meta2.bbox;
    const tol = 0.001; // ~110m dung sai
    if (b1[1] + tol < b2[0] || b2[1] + tol < b1[0] ||
        b1[3] + tol < b2[2] || b2[3] + tol < b1[2]) {
      return false;
    }
  }

  // LEVEL 2: Geometry Signature / Sample Points Prefilter
  // Nếu các điểm mẫu cách nhau xa -> chắc chắn khác nhau -> loại sớm
  // KHÔNG return true ở tầng này để tránh false-positive khi xảy ra signature collision
  const pts1 = meta1 ? meta1.samplePoints : _getRouteSamplePoints(c1, 15);
  const pts2 = meta2 ? meta2.samplePoints : _getRouteSamplePoints(c2, 15);

  if (pts1 && pts2 && pts1.length === pts2.length && pts1.length >= 5) {
    let sampleMismatches = 0;
    const maxAllowedMismatches = Math.floor(pts1.length * 0.15); // tối đa 2/15 điểm
    for (let i = 0; i < pts1.length; i++) {
      const p1 = pts1[i];
      const p2 = pts2[i];
      const dLat = Math.abs(p1[0] - p2[0]);
      const dLng = Math.abs(p1[1] - p2[1]);
      if (dLat > 0.002 || dLng > 0.002) {
        sampleMismatches++;
        if (sampleMismatches > maxAllowedMismatches) {
          return false; // Chắc chắn khác nhau
        }
      }
    }
  }

  // LEVEL 2.5: Fast Sample Match (30 điểm mẫu, dung sai ~55m)
  if (!_fastSampleMatch(c1, c2, 30, 0.0005)) return false;

  // LEVEL 3: Exact Geometry Comparison (Symmetric Overlap Check)
  const minDistFn = (typeof window !== 'undefined' && window.minDistanceToPolyline)
    ? window.minDistanceToPolyline
    : (typeof minDistanceToPolyline === 'function' ? minDistanceToPolyline : _minDistanceToPolyline);

  function checkDirection(ca, cb) {
    if (ca.length > 5 && cb.length > 5) {
      let matchedCount = 0;
      const testSamples = 10;
      const step = (ca.length - 1) / (testSamples - 1);

      for (let i = 0; i < testSamples; i++) {
        const idx = Math.min(ca.length - 1, Math.round(i * step));
        const p = ca[idx];
        const minD = minDistFn(p[0], p[1], cb);
        if (minD < 50) {
          matchedCount++;
        } else {
          // Early break: Nếu số điểm không khớp vượt quá 1 (tức tối đa chỉ đạt 8/10 = 80% < 85%),
          // thì không thể đạt ngưỡng 85% -> dừng sớm ngay lập tức!
          const unmatched = (i + 1) - matchedCount;
          if (unmatched > 1) return false;
        }
      }
      return (matchedCount / testSamples >= 0.85);
    } else {
      let matchedCount = 0;
      for (let i = 0; i < ca.length; i++) {
        const p = ca[i];
        const minD = minDistFn(p[0], p[1], cb);
        if (minD < 50) matchedCount++;
      }
      return (matchedCount / ca.length >= 0.85);
    }
  }

  // Kiểm tra đối xứng cả 2 chiều để ngăn chặn tuyệt đối tình huống 1 tuyến có đoạn rẽ tách rời
  if (!checkDirection(c1, c2)) return false;
  return checkDirection(c2, c1);
}

/**
 * Loại bỏ các tuyến trùng lặp thông minh dựa trên Geometry Signature & Sai số dung sai
 */
function _deduplicateRoutes(routes) {
  if (!Array.isArray(routes) || routes.length <= 1) return routes || [];
  const unique = [];
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    let isDup = false;
    for (let j = 0; j < unique.length; j++) {
      if (_areRoutesDuplicate(unique[j], r)) {
        isDup = true;
        break;
      }
    }
    if (!isDup) unique.push(r);
  }
  return unique;
}

/**
 * Tính điểm xếp hạng (Ranking Score) cho waypoint ứng viên tránh sự cố:
 * Phản ánh mức độ hữu ích của waypoint trong việc dẫn đường tránh vùng nguy hiểm.
 * Yếu tố đánh giá:
 * 1. Mức độ nghiêm trọng tổng hợp của cụm sự cố (severity, count)
 * 2. Mức độ đe dọa trực tiếp tới tuyến đường chính (khoảng cách cụm sự cố tới route)
 * 3. Độ an toàn cự ly né tránh (clearance factor từ waypoint tới tâm cụm)
 * 4. Hiệu quả lệch trục sơ cấp (primary offset) so với thứ cấp (secondary offset)
 */
function _scoreAvoidanceWaypoint(wp, primaryRouteCoords) {
  if (!wp) return 0;

  // Điểm cơ sở cho lệch trục giữa hành trình (Midpoint deflection)
  if (wp.type === 'midpoint_deflection' || !wp.cluster) {
    return 0.30;
  }

  const cluster = wp.cluster;
  const cSeverity = (typeof cluster.severity === 'number' && Number.isFinite(cluster.severity)) ? cluster.severity : 0.2;
  const cCount = (typeof cluster.count === 'number' && Number.isFinite(cluster.count)) ? cluster.count : 1;

  // 1. Điểm mức độ nghiêm trọng & quy mô của cụm sự cố
  const impactScore = Math.min(1.0, 0.35 * cSeverity + 0.1 * Math.min(cCount, 5));

  // 2. Mức độ đe dọa trực tiếp tới tuyến đường chính
  const minDistFn = (typeof window !== 'undefined' && window.minDistanceToPolyline) 
    ? window.minDistanceToPolyline 
    : (typeof minDistanceToPolyline === 'function' ? minDistanceToPolyline : _minDistanceToPolyline);

  let routeThreatFactor = 0.5;
  if (primaryRouteCoords && primaryRouteCoords.length >= 2) {
    const distToRoute = minDistFn(cluster.lat, cluster.lng, primaryRouteCoords);
    const strongThresh = (typeof CONFIG !== 'undefined' && CONFIG.risk_impact?.STRONG_THRESHOLD_M) ? CONFIG.risk_impact.STRONG_THRESHOLD_M : 100;
    const medThresh = (typeof CONFIG !== 'undefined' && CONFIG.risk_impact?.MEDIUM_THRESHOLD_M) ? CONFIG.risk_impact.MEDIUM_THRESHOLD_M : 300;

    if (distToRoute < strongThresh) {
      routeThreatFactor = 1.0;
    } else if (distToRoute < medThresh) {
      routeThreatFactor = 0.75;
    }
  }

  // 3. Khả năng né tránh (clearance): khoảng cách từ waypoint tới tâm cụm sự cố
  const distToClusterM = haversineKm(wp.lat, wp.lng, cluster.lat, cluster.lng) * 1000;
  const clearanceFactor = Math.min(1.0, distToClusterM / Math.max(wp.offset || 400, 200));

  // 4. Ưu tiên độ lệch sơ cấp (primary offset) hơn độ lệch thứ cấp
  const offsetEfficiency = wp.isPrimaryOffset ? 1.0 : 0.85;

  // Tổng hợp điểm số trong đoạn [0, 1]
  const totalScore = (impactScore * 0.45) + (routeThreatFactor * 0.30) + (clearanceFactor * 0.15) + (offsetEfficiency * 0.10);
  return Math.round(totalScore * 10000) / 10000;
}

/**
 * Tạo các tuyến tránh sự cố tối ưu:
 * 1. Thu thập sự cố ảnh hưởng (< 350m từ các tuyến cơ sở)
 * 2. Gom cụm sự cố (Clustering) và chọn tối đa 2 cụm nghiêm trọng nhất
 * 3. Sinh waypoint lệch trục (vuông góc & midpoint deflection)
 * 4. Xếp hạng waypoint (Waypoint Ranking) dựa trên mức độ nguy hiểm cần tránh
 * 5. Sắp xếp giảm dần theo điểm số + tie-breaker tất định (deterministic)
 * 6. Khử trùng waypoint (< 250m) và chọn lọc tối đa OSRM_MAX_WAYPOINTS tốt nhất
 * 7. Truy vấn OSRM qua bộ điều phối tải Concurrency Limiter
 */
async function _generateAvoidanceRoutes(start, end, baseRoutes, signal = null, metrics = null, incidentSnapshot = null) {
  if (!baseRoutes.length) return [];

  const now = Date.now();
  const incSnapshot = incidentSnapshot || createActiveIncidentSnapshot(null, now);
  const minDistFn = (typeof window !== 'undefined' && window.minDistanceToPolyline) ? window.minDistanceToPolyline : (typeof minDistanceToPolyline === 'function' ? minDistanceToPolyline : _minDistanceToPolyline);

  // Tìm tất cả sự cố có hiệu lực nằm gần các tuyến đường cơ bản
  const activeIncidents = [];
  const baseMetas = baseRoutes.map(r => getRouteMetadata(r));
  for (let i = 0; i < incSnapshot.length; i++) {
    const item = incSnapshot[i];
    const c = item.confidence;
    if (c <= 0.1) continue;

    const rawInc = item.incident || item;

    // Spatial prefilter: Bỏ qua nếu sự cố nằm hoàn toàn ngoài vùng đệm 600m của TẤT CẢ các baseRoutes
    const incBbox = getIncidentBbox(rawInc);
    let couldBeNearAny = false;
    for (let k = 0; k < baseMetas.length; k++) {
      const m = baseMetas[k];
      if (!m || !m.bufferedBbox || isIncidentNearRouteBbox(incBbox, m.bufferedBbox)) {
        couldBeNearAny = true;
        break;
      }
    }
    if (!couldBeNearAny) continue;

    // Fast reject bằng sample points
    let couldBeClose = false;
    for (const m of baseMetas) {
      if (!m || !m.samplePoints) { couldBeClose = true; break; }
      const dSample = minDistFn(item.lat, item.lng, m.samplePoints);
      if (dSample < 500) { couldBeClose = true; break; }
    }
    if (!couldBeClose) continue; // chắc chắn > 350m

    // Chỉ khi qua prefilter mới chạy full polyline
    let minD = Infinity;
    for (const r of baseRoutes) {
      const d = minDistFn(item.lat, item.lng, r.coords);
      if (d < minD) minD = d;
    }
    if (minD < 350) {
      activeIncidents.push({
        incident: rawInc,
        distanceM: Math.round(minD),
        confidence: c,
        level: item.level || 'thap'
      });
    }
  }

  if (activeIncidents.length === 0) return [];

  // Gom cụm sự cố
  const clusters = _clusterIncidents(activeIncidents);
  const directDistM = haversineKm(start.lat, start.lng, end.lat, end.lng) * 1000;

  // Tính khoảng cách offset thích ứng theo cự ly
  const primaryOffset = Math.max(400, Math.min(1500, Math.round(directDistM * 0.35)));
  const secondaryOffset = Math.max(700, Math.min(2500, Math.round(directDistM * 0.60)));
  const offsets = [primaryOffset, secondaryOffset].filter((v, i, a) => a.indexOf(v) === i);

  const candidateWaypoints = [];
  const primaryRouteCoords = baseRoutes[0].coords;

  // 1. Tạo waypoints từ 2 cụm sự cố nghiêm trọng nhất (mỗi bên trái & phải)
  for (const cluster of clusters.slice(0, 2)) {
    for (const offset of offsets) {
      const pair = _computeAvoidanceWaypoints(primaryRouteCoords, cluster.lat, cluster.lng, offset);
      for (const wp of pair) {
        if (wp && isPointInVietnam(wp.lat, wp.lng)) {
          const dStart = haversineKm(start.lat, start.lng, wp.lat, wp.lng) * 1000;
          const dEnd = haversineKm(end.lat, end.lng, wp.lat, wp.lng) * 1000;
          if (dStart > 200 && dEnd > 200) {
            candidateWaypoints.push({
              lat: wp.lat,
              lng: wp.lng,
              cluster: cluster,
              offset: offset,
              isPrimaryOffset: (offset === primaryOffset),
              type: 'cluster_avoidance'
            });
          }
        }
      }
    }
  }

  // 2. Tạo waypoint lệch sườn giữa hành trình (Midpoint deflection)
  const midBearing = _bearingRad(start.lat, start.lng, end.lat, end.lng);
  const midPoint = _destinationPoint(start.lat, start.lng, midBearing, directDistM / 2);
  const leftMid = _destinationPoint(midPoint.lat, midPoint.lng, midBearing + Math.PI / 2, primaryOffset);
  const rightMid = _destinationPoint(midPoint.lat, midPoint.lng, midBearing - Math.PI / 2, primaryOffset);
  if (isPointInVietnam(leftMid.lat, leftMid.lng)) {
    candidateWaypoints.push({
      lat: leftMid.lat,
      lng: leftMid.lng,
      cluster: null,
      offset: primaryOffset,
      isPrimaryOffset: true,
      type: 'midpoint_deflection'
    });
  }
  if (isPointInVietnam(rightMid.lat, rightMid.lng)) {
    candidateWaypoints.push({
      lat: rightMid.lat,
      lng: rightMid.lng,
      cluster: null,
      offset: primaryOffset,
      isPrimaryOffset: true,
      type: 'midpoint_deflection'
    });
  }

  if (candidateWaypoints.length === 0) return [];

  // 3. Tính điểm xếp hạng (Ranking Score) cho từng ứng viên waypoint
  for (const wp of candidateWaypoints) {
    wp.score = _scoreAvoidanceWaypoint(wp, primaryRouteCoords);
  }

  // 4. Sắp xếp giảm dần theo điểm số (với deterministic tie-breaker theo tọa độ để đảm bảo tính tất định)
  candidateWaypoints.sort((a, b) => {
    // 4.1 Điểm số cao hơn đứng trước
    if (Math.abs(b.score - a.score) > 1e-5) {
      return b.score - a.score;
    }
    // 4.2 Deterministic tie-breaker 1: Vĩ độ (chống random)
    if (Math.abs(b.lat - a.lat) > 1e-6) {
      return b.lat - a.lat;
    }
    // 4.3 Deterministic tie-breaker 2: Kinh độ
    return b.lng - a.lng;
  });

  // 5. Khử bớt waypoint trùng hoặc quá gần nhau (< 250m), giữ lại ứng viên có điểm cao hơn
  const uniqueWps = [];
  for (const wp of candidateWaypoints) {
    const isClose = uniqueWps.some(u => haversineKm(u.lat, u.lng, wp.lat, wp.lng) * 1000 < 250);
    if (!isClose) uniqueWps.push(wp);
  }

  // 6. Giới hạn số lượng waypoint tối đa theo cấu hình (mặc định 4)
  const maxWps = (typeof window !== 'undefined' && window.OSRM_MAX_WAYPOINTS)
    ? window.OSRM_MAX_WAYPOINTS
    : ((typeof CONFIG !== 'undefined' && CONFIG.osrm_max_waypoints) ? CONFIG.osrm_max_waypoints : 4);
  const targetWps = uniqueWps.slice(0, maxWps);

  if (_isDebugRouting()) {
    console.log(`[OSRM] waypoint ranking: ${candidateWaypoints.length} candidates -> ${uniqueWps.length} unique -> selected top ${targetWps.length} (scores: ${targetWps.map(w => w.score).join(', ')})`);
  }

  // 7. Concurrency Limiter: Truy vấn OSRM có kiểm soát tốc độ (mặc định tối đa 3 đồng thời)
  const concurrentLimit = (typeof window !== 'undefined' && window.OSRM_MAX_CONCURRENT_REQUESTS)
    ? window.OSRM_MAX_CONCURRENT_REQUESTS
    : ((typeof CONFIG !== 'undefined' && CONFIG.osrm_max_concurrent_requests) ? CONFIG.osrm_max_concurrent_requests : 3);

  const results = await mapConcurrent(targetWps, concurrentLimit, async wp => {
    if (signal && signal.aborted) return [];
    const segRoutes = await fetchOsrmRoute(
      [start, wp, end],
      { overview: 'full', steps: false, alternatives: false },
      signal,
      metrics
    );
    return segRoutes.filter(r => isRouteInsideVietnam(r));
  });

  const avoidanceRoutes = [];
  for (const res of results) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      avoidanceRoutes.push(...res.value);
    }
  }

  return avoidanceRoutes;
}

/**
 * Sắp xếp các tuyến đường ứng viên theo chế độ người dùng lựa chọn:
 * - 'fastest': Ưu tiên tuyệt đối thời gian nhanh nhất, bỏ qua rủi ro.
 * - 'safest': Ưu tiên tuyệt đối an toàn (rủi ro thấp nhất), chấp nhận đi xa hoặc chậm hơn.
 * - 'balanced': Cân bằng đa tiêu chí theo hàm chi phí w = duration * (1 + alpha * riskScore / 100).
 */
function sortRoutesByMode(routes, mode) {
  if (mode === 'fastest') {
    return [...routes].sort((a, b) => {
      if (Math.abs(a.duration - b.duration) > 0.05) {
        return a.duration - b.duration;
      }
      return a.distance - b.distance;
    });
  }

  if (mode === 'safest') {
    // CHẾ ĐỘ AN TOÀN NHẤT:
    // Đảm bảo TUYỆT ĐỐI đường an toàn nhất lên đầu (rủi ro thấp nhất),
    // chấp nhận đi xa hoặc chậm hơn.
    return [...routes].sort((a, b) => {
      // 1. Tuyến có mức độ rủi ro thấp hơn chắc chắn đứng trước
      if (a.riskScore !== b.riskScore) {
        return a.riskScore - b.riskScore;
      }
      // 2. Khi rủi ro bằng nhau (ví dụ cả hai đều hoàn toàn an toàn = 0),
      // ưu tiên tuyến thời gian ngắn hơn
      if (Math.abs(a.duration - b.duration) > 0.1) {
        return a.duration - b.duration;
      }
      return a.distance - b.distance;
    });
  }

  // Chế độ CÂN BẰNG (balanced):
  // Hàm mục tiêu đa tiêu chí: w = duration * (1 + alpha * (riskScore / 100))
  const alpha = CONFIG.mode_alpha[mode] ?? 1;
  return [...routes].sort((a, b) => {
    const wA = a.duration * (1 + alpha * (a.riskScore / 100));
    const wB = b.duration * (1 + alpha * (b.riskScore / 100));
    if (Math.abs(wA - wB) > 0.05) return wA - wB;
    return a.riskScore - b.riskScore;
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
   5b. CẢNH BÁO SỰ CỐ TRÊN TUYẾN ĐƯỜNG ĐÃ CHỌN
--------------------------------------------------------------- */

/**
 * Xây dựng HTML cảnh báo các sự cố nằm trên/gần tuyến đường đang chọn.
 * Nếu có sự cố và người dùng chưa ở chế độ "An toàn nhất",
 * hiển thị nút đề xuất chuyển sang chế độ an toàn hơn.
 */
function buildRouteWarningsHtml(route, mode) {
  const warnings = findIncidentsAlongRoute(route);
  if (warnings.length === 0) return '';

  const typesMeta = (typeof window !== 'undefined' && window.INCIDENT_TYPES) ? window.INCIDENT_TYPES : {};
  const esc = (typeof window !== 'undefined' && window.escapeHtml) ? window.escapeHtml : (s => s);
  const confColorFn = (typeof window !== 'undefined' && window.getConfidenceColor) ? window.getConfidenceColor : (() => 'var(--risk-mid)');

  const directHits = warnings.filter(w => w.zone === 'direct');
  const nearbyHits = warnings.filter(w => w.zone === 'nearby');

  // Header severity
  const severity = directHits.length > 0 ? 'high' : 'medium';
  const sevLabel = severity === 'high'
    ? `⚠️ ${directHits.length} sự cố trực tiếp trên tuyến đường`
    : `⚡ ${nearbyHits.length} sự cố gần tuyến đường`;

  // Build incident list
  const itemsHtml = warnings.map(w => {
    const inc = w.incident;
    const meta = typesMeta[inc.type] || { emoji: '⚠️', label: 'Sự cố', color: '#e3492c' };
    const zoneLabel = w.zone === 'direct'
      ? `<span class="rw-zone rw-zone-direct">Trên tuyến (${w.distanceM}m)</span>`
      : `<span class="rw-zone rw-zone-nearby">Lân cận (${w.distanceM}m)</span>`;
    const confColor = confColorFn(w.confidence);

    return `<div class="rw-item">
      <div class="rw-item-head">
        <span class="rw-item-type">${meta.emoji} ${esc(meta.label)}</span>
        ${zoneLabel}
      </div>
      <div class="rw-item-desc">${esc(inc.desc)}</div>
      <div class="rw-item-meta">
        <span>Độ tin cậy: <b style="color:${confColor}">${w.confidence}%</b></span>
        <span>Mức độ: <b>${inc.level === 'cao' ? '🔴 Cao' : inc.level === 'trungbinh' ? '🟡 Trung bình' : '🟢 Thấp'}</b></span>
      </div>
    </div>`;
  }).join('');

  // Suggest safer mode button
  let suggestHtml = '';
  if (mode !== 'safest' && directHits.length > 0) {
    const saferMode = mode === 'fastest' ? 'balanced' : 'safest';
    const saferLabel = saferMode === 'balanced' ? 'Cân bằng' : 'An toàn nhất';
    suggestHtml = `<div class="rw-suggest">
      <div class="rw-suggest-text">
        <i class="fa-solid fa-shield-halved"></i>
        Tuyến đường này đi qua ${directHits.length} khu vực có sự cố. Chuyển sang chế độ <b>${saferLabel}</b> để ưu tiên tuyến tránh xa các điểm nguy hiểm.
      </div>
      <button class="rw-suggest-btn" onclick="switchToSaferMode('${saferMode}')">
        <i class="fa-solid fa-route"></i> Tìm đường ${saferLabel.toLowerCase()}
      </button>
    </div>`;
  } else if (mode === 'safest' && directHits.length > 0) {
    suggestHtml = `<div class="rw-suggest rw-suggest-info">
      <i class="fa-solid fa-circle-info"></i>
      Bạn đang ở chế độ <b>An toàn nhất</b>. Đây là tuyến tối ưu nhất có thể — một số sự cố không thể tránh hoàn toàn do hạn chế về đường đi.
    </div>`;
  }

  return `<div class="route-warnings ${severity === 'high' ? 'rw-high' : 'rw-medium'}">
    <div class="rw-header">
      <span class="rw-header-label">${sevLabel}</span>
      <span class="rw-header-count">${warnings.length} cảnh báo</span>
    </div>
    <div class="rw-list">${itemsHtml}</div>
    ${suggestHtml}
  </div>`;
}

/**
 * Chuyển sang chế độ an toàn hơn và tự động tìm lại đường
 */
function switchToSaferMode(targetMode) {
  // Cập nhật radio button UI
  const radio = document.querySelector(`input[name="mode"][value="${targetMode}"]`);
  if (radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (typeof window !== 'undefined') {
    window.selectedMode = targetMode;
    window.manualRouteSelection = false;
  }
  // Gọi tìm đường lại
  if (typeof window !== 'undefined' && typeof window.onFindRouteClick === 'function') {
    window.onFindRouteClick();
  }
}

/* ---------------------------------------------------------------
   6. VẼ CÁC TUYẾN LÊN BẢN ĐỒ & HIỂN THỊ KẾT QUẢ
--------------------------------------------------------------- */
function renderRoutes(routes, mode) {
  if (transportFallbackLayerGroup) transportFallbackLayerGroup.clearLayers();
  if (!routeLayerGroup) return;
  const maxSuggestedRoutes = (typeof window !== 'undefined' && window.MAX_SUGGESTED_ROUTES) 
    ? window.MAX_SUGGESTED_ROUTES 
    : ((typeof CONFIG !== 'undefined' && CONFIG.max_suggested_routes) ? CONFIG.max_suggested_routes : 3);

  const sorted = sortRoutesByMode(routes, mode).slice(0, maxSuggestedRoutes);
  const bounds = [];

  // Tự động chuyển tuyến được chọn sang tuyến tối ưu của chế độ mới (sorted[0])
  // trừ khi người dùng vừa trực tiếp click chọn một tuyến cụ thể trong chế độ này.
  let selectedRouteId = (typeof window !== 'undefined') ? window.selectedRouteId : null;
  const lastMode = (typeof window !== 'undefined') ? window._lastRenderedMode : null;

  if (lastMode !== mode || !window.manualRouteSelection || !sorted.some(r => r.id === selectedRouteId)) {
    selectedRouteId = sorted[0]?.id || null;
    if (typeof window !== 'undefined') {
      window.selectedRouteId = selectedRouteId;
      window.manualRouteSelection = false;
    }
  }
  if (typeof window !== 'undefined') window._lastRenderedMode = mode;

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
      // Chỉ hiển thị cảnh báo chi tiết cho tuyến đang chọn
      const warningsHtml = isSelected ? buildRouteWarningsHtml(route, mode) : '';
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
        ${warningsHtml}
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
    window.manualRouteSelection = true;

    // Tải turn-by-turn steps theo yêu cầu nếu tuyến này chưa có
    const finalStepsEnabled = (typeof window !== 'undefined' && window.OSRM_FINAL_STEPS != null) 
      ? window.OSRM_FINAL_STEPS === true
      : (typeof CONFIG !== 'undefined' && CONFIG.osrm_final_steps !== false);

    if (finalStepsEnabled && target.waypoints && (!target.legs || !target.legs[0]?.steps?.length)) {
      fetchOsrmRoute(target.waypoints, { overview: 'full', steps: true, alternatives: false })
        .then(stepRoutes => {
          if (stepRoutes && stepRoutes.length > 0 && stepRoutes[0].legs) {
            target.legs = Array.isArray(stepRoutes[0].legs) ? [...stepRoutes[0].legs] : [];
            if (window.selectedRouteId === id) {
              renderRoutes(currentRoutes, window.selectedMode || 'balanced');
            }
          }
        })
        .catch(() => {});
    }

    renderRoutes(currentRoutes, window.selectedMode || 'balanced');
    if (typeof window.showToast === 'function') window.showToast(`Đã chọn Tuyến ${id}. Bắt đầu chỉ đường...`);
  }
}

// Gắn lên window để truy cập từ script truyền thống trên trình duyệt
if (typeof window !== 'undefined') {
  window.findSafeRoutes = findSafeRoutes;
  window.calculateRouteRisk = calculateRouteRisk;
  window.findIncidentsAlongRoute = findIncidentsAlongRoute;
  window.sortRoutesByMode = sortRoutesByMode;
  window.renderRoutes = renderRoutes;
  window.chooseRoute = chooseRoute;
  window.renderTransportFallback = renderTransportFallback;
  window.planMultimodalFallback = planMultimodalFallback;
  window.showMultimodalOption = showMultimodalOption;
  window.backToRoadRoutes = backToRoadRoutes;
  window.switchToSaferMode = switchToSaferMode;

  // Exports phục vụ OSRM Optimization, Cache & Testing
  window.RouteCache = RouteCache;
  window.osrmRouteCache = osrmRouteCache;
  window.inFlightRequests = inFlightRequests;
  window.fetchOsrmRoute = fetchOsrmRoute;
  window.fetchOsrmRawRoute = fetchOsrmRawRoute;
  window.mapConcurrent = mapConcurrent;
  window._scoreAvoidanceWaypoint = _scoreAvoidanceWaypoint;
  window.clearRouteCache = () => osrmRouteCache.clear();

  // Exports phục vụ Geometry, Risk & Deduplication Optimization
  window._routeMetadataCache = _routeMetadataCache;
  window._incidentBboxCache = _incidentBboxCache;
  window._routeIncidentAnalysisCache = _routeIncidentAnalysisCache;
  window.getRouteMetadata = getRouteMetadata;
  window.getIncidentBbox = getIncidentBbox;
  window.isIncidentNearRouteBbox = isIncidentNearRouteBbox;
  window._getRouteGeometrySignature = _getRouteGeometrySignature;
  window._getRouteSamplePoints = _getRouteSamplePoints;
  window._areRoutesDuplicate = _areRoutesDuplicate;
  window._deduplicateRoutes = _deduplicateRoutes;
  window._fastSampleMatch = _fastSampleMatch;
  window._clusterIncidents = _clusterIncidents;
  window.createActiveIncidentSnapshot = createActiveIncidentSnapshot;
  window.getNearestPointOnPolyline = getNearestPointOnPolyline;
  window.minDistanceToPolyline = minDistanceToPolyline;
  window.analyzeRouteIncidents = analyzeRouteIncidents;
  window._routeInVNCache = _routeInVNCache;
  window.isRouteInsideVietnam = isRouteInsideVietnam;
  window._incidentSnapshotVersion = _incidentSnapshotVersion;
  window.incrementIncidentSnapshotVersion = () => ++_incidentSnapshotVersion;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    findSafeRoutes,
    calculateRouteRisk,
    findIncidentsAlongRoute,
    sortRoutesByMode,
    renderRoutes,
    chooseRoute,
    renderTransportFallback,
    planMultimodalFallback,
    showMultimodalOption,
    backToRoadRoutes,
    switchToSaferMode,
    RouteCache,
    osrmRouteCache,
    inFlightRequests,
    fetchOsrmRoute,
    fetchOsrmRawRoute,
    mapConcurrent,
    _scoreAvoidanceWaypoint,
    clearRouteCache: () => osrmRouteCache.clear(),
    _routeMetadataCache,
    _incidentBboxCache,
    _routeIncidentAnalysisCache,
    _routeInVNCache,
    isRouteInsideVietnam,
    getRouteMetadata,
    getIncidentBbox,
    isIncidentNearRouteBbox,
    _getRouteGeometrySignature,
    _getRouteSamplePoints,
    _areRoutesDuplicate,
    _fastSampleMatch,
    _freezeRouteNestedArrays,
    _deduplicateRoutes,
    _clusterIncidents,
    createActiveIncidentSnapshot,
    getNearestPointOnPolyline,
    minDistanceToPolyline,
    analyzeRouteIncidents,
    get _incidentSnapshotVersion() { return _incidentSnapshotVersion; },
    incrementIncidentSnapshotVersion: () => ++_incidentSnapshotVersion
  };
}