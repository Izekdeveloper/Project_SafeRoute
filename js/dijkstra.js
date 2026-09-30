/**
 * ============================================================================
 * SafeRoute Research Project: Independent Dijkstra & K-Shortest Paths Engine
 * File: js/dijkstra.js
 * 
 * Mục đích kiến trúc:
 * - Cung cấp thuật toán tìm đường ngắn nhất Dijkstra thuần túy (pure algorithm).
 * - Cung cấp thuật toán tìm K đường ngắn nhất (Yen's K-Shortest Paths Algorithm).
 * - Cung cấp thuật toán tìm kiếm hai chiều (Bidirectional Dijkstra) khi đồ thị hỗ trợ.
 * - Cấu trúc dữ liệu hàng đợi ưu tiên Binary Min-Heap & Max-Heap (PriorityQueue) tối ưu O((V + E) log V).
 * - Cơ chế Visited / Finalized Set ngăn chặn duyệt lại node đã chốt khoảng cách tối ưu.
 * - Bỏ qua stale heap entries tức thì trong O(1).
 * - Tối ưu hóa truy cập đồ thị (Adjacency List Fast Path) loại bỏ hàm gián tiếp trong inner loop.
 * - Tối ưu hóa bộ nhớ: Triệt tiêu cấp phát object trung gian trong quá trình Edge Relaxation.
 * - Candidate pool trong Yen sử dụng Bounded Max-Heap cho phép Early Pruning O(1) peek.
 * - Tách biệt hoàn toàn `cost` (chi phí tối ưu) và `distance` (chiều dài vật lý).
 * - Hỗ trợ `edge.id` cho đồ thị có đa cạnh (parallel edges), fallback `from->to`.
 * - Tách biệt STATIC BASE COST và DYNAMIC SAFETY COST, tích hợp mô hình suy giảm Bayesian (Half-Life Decay).
 * - Cơ chế bảo vệ và xử lý an toàn cạnh âm / NaN / Infinity ({ onInvalidEdge: 'clamp' | 'skip' | 'throw' }).
 * - Hỗ trợ bộ nhớ đệm (DijkstraCache) với cơ chế vô hiệu hóa (invalidation) an toàn.
 * - Hỗ trợ giới hạn an toàn (maxVisitedNodes, maxExpandedEdges, maxSearchCost).
 * - Hoàn toàn độc lập (stateless, generic, immutable):
 *   + KHÔNG phụ thuộc vào UI, DOM, Leaflet hay Map.
 *   + KHÔNG phụ thuộc vào OSRM hay network fetch.
 *   + KHÔNG làm biến đổi (mutate) hay clone graph đầu vào.
 *   + KHÔNG có tác dụng phụ (no side effects), không console spam trong production.
 * ============================================================================
 */

(function () {
  'use strict';

  /* ==========================================================================
     PHASE 1: PRIORITY QUEUE (OPTIMIZED BINARY HEAP)
     ========================================================================== */

  /**
   * Cấu trúc dữ liệu Binary Heap phục vụ hàng đợi ưu tiên cho Dijkstra & Yen.
   * Hỗ trợ cả Min-Heap (mặc định) và Max-Heap (thông qua comparator tùy biến).
   * 
   * Tối ưu hóa:
   * - Sift-up và Sift-down sử dụng cơ chế dịch chuyển phần tử đơn (Single-assignment displacement)
   *   thay vì hoán đổi 3 bước (_swap), giảm 66% phép gán trong mảng heap.
   * - Fast-path so sánh trực tiếp `.priority` khi dùng comparator mặc định (tránh gọi hàm con).
   * - Dùng toán tử dịch bit (>> 1, << 1) thay cho Math.floor.
   * - Đạt độ phức tạp thời gian:
   *   + push: O(log N)
   *   + pop: O(log N)
   *   + peek: O(1)
   *   + size: O(1)
   */
  class PriorityQueue {
    /**
     * @param {Function} [comparator=null] Hàm so sánh tùy chọn (a, b) => number.
     *                                      Mặc định null để kích hoạt fast-path so sánh priority.
     */
    constructor(comparator = null) {
      this.heap = [];
      this.comparator = comparator;
      this.isDefault = (comparator === null || typeof comparator !== 'function');
    }

    /**
     * Thêm một phần tử vào hàng đợi ưu tiên
     * @param {any} item Dữ liệu (ví dụ nodeId hoặc candidate path)
     * @param {number} priority Độ ưu tiên (chi phí / khoảng cách)
     * @complexity O(log N)
     */
    push(item, priority) {
      const entry = { item, priority: Number(priority) };
      this.heap.push(entry);
      this._siftUp(this.heap.length - 1);
    }

    /**
     * Lấy và loại bỏ phần tử có độ ưu tiên cao nhất (đỉnh heap)
     * @returns {{ item: any, priority: number }|null}
     * @complexity O(log N)
     */
    pop() {
      const length = this.heap.length;
      if (length === 0) return null;
      const top = this.heap[0];
      const bottom = this.heap.pop();
      if (this.heap.length > 0) {
        this.heap[0] = bottom;
        this._siftDown(0);
      }
      return top;
    }

    /**
     * Xem phần tử đỉnh heap mà không loại bỏ
     * @returns {{ item: any, priority: number }|null}
     * @complexity O(1)
     */
    peek() {
      return this.heap.length > 0 ? this.heap[0] : null;
    }

    /**
     * Số lượng phần tử trong heap
     * @returns {number}
     * @complexity O(1)
     */
    size() {
      return this.heap.length;
    }

    /**
     * Kiểm tra heap có rỗng hay không
     * @returns {boolean}
     * @complexity O(1)
     */
    isEmpty() {
      return this.heap.length === 0;
    }

    /**
     * Xóa sạch heap
     * @complexity O(1)
     */
    clear() {
      this.heap.length = 0;
    }

    /**
     * Chuyển các phần tử trong heap thành mảng (phục vụ inspection/pruning)
     * @returns {Array<{ item: any, priority: number }>}
     */
    toArray() {
      return this.heap.slice();
    }

    /**
     * Dịch chuyển phần tử lên trên bằng phương pháp displacement
     * @private
     */
    _siftUp(index) {
      let curr = index;
      const heap = this.heap;
      const entry = heap[curr];
      const isDef = this.isDefault;
      const comp = this.comparator;

      while (curr > 0) {
        const parentIdx = (curr - 1) >> 1;
        const parent = heap[parentIdx];
        const smaller = isDef
          ? (entry.priority < parent.priority)
          : (comp(entry, parent) < 0);

        if (smaller) {
          heap[curr] = parent;
          curr = parentIdx;
        } else {
          break;
        }
      }
      heap[curr] = entry;
    }

    /**
     * Dịch chuyển phần tử xuống dưới bằng phương pháp displacement
     * @private
     */
    _siftDown(index) {
      let curr = index;
      const heap = this.heap;
      const length = heap.length;
      const entry = heap[curr];
      const isDef = this.isDefault;
      const comp = this.comparator;
      const half = length >> 1;

      while (curr < half) {
        let left = (curr << 1) + 1;
        const right = left + 1;
        let bestIdx = left;
        let bestItem = heap[left];

        if (right < length) {
          const rightItem = heap[right];
          const rightSmaller = isDef
            ? (rightItem.priority < bestItem.priority)
            : (comp(rightItem, bestItem) < 0);

          if (rightSmaller) {
            bestIdx = right;
            bestItem = rightItem;
          }
        }

        const childSmaller = isDef
          ? (bestItem.priority < entry.priority)
          : (comp(bestItem, entry) < 0);

        if (childSmaller) {
          heap[curr] = bestItem;
          curr = bestIdx;
        } else {
          break;
        }
      }
      heap[curr] = entry;
    }
  }

  /* ==========================================================================
     PHASE 2: BỘ NHỚ ĐỆM DIJKSTRA (SCOPED LRU QUERY CACHE VIA WEAKMAP)
     ========================================================================== */

  /**
   * Quản lý bộ nhớ đệm kết quả tìm đường Dijkstra:
   * - Sử dụng WeakMap<graph, DijkstraLRUCache>: Mỗi đồ thị có vùng nhớ cache riêng biệt.
   *   Tuyệt đối không gây va chạm (collision) giữa các đồ thị khác nhau.
   *   Tự động giải phóng bộ nhớ khi đồ thị bị Garbage Collection (zero memory leak).
   * - Hỗ trợ cache cho cả Standard Dijkstra và Bidirectional Dijkstra.
   * - Khóa cache đa chiều tích hợp metric ('time' / 'distance') và profileKey.
   * - Giới hạn kích thước tối đa (maxEntries = 100) để chống phình to bộ nhớ.
   * - Tự động vô hiệu hóa (invalidation) khi có sự cố mới hoặc cấu hình thay đổi.
   * - TUYỆT ĐỐI KHÔNG cache khi có bộ lọc động (edgeFilter, nodeFilter trong Yen).
   */
  class DijkstraLRUCache {
    constructor(maxEntries = 100) {
      this.maxEntries = maxEntries;
      this.cache = new Map();
      this.version = 1;
    }

    _makeKey(startId, destId, profileKey, algorithm = 'standard', metric = 'time', onInvalidEdge = 'clamp') {
      return `${startId}->${destId}#${algorithm}#${metric}#${onInvalidEdge}#${profileKey}#v${this.version}#g${_globalCacheVersion}`;
    }

    get(startId, destId, profileKey = 'default', algorithm = 'standard', metric = 'time', onInvalidEdge = 'clamp') {
      const key = this._makeKey(startId, destId, profileKey, algorithm, metric, onInvalidEdge);
      if (!this.cache.has(key)) return null;

      const entry = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, entry);

      return {
        ...entry,
        nodes: entry.nodes.slice(),
        edges: entry.edges.slice()
      };
    }

    set(startId, destId, result, profileKey = 'default', algorithm = 'standard', metric = 'time', onInvalidEdge = 'clamp') {
      if (!result || !result.found) return;

      const key = this._makeKey(startId, destId, profileKey, algorithm, metric, onInvalidEdge);
      if (this.cache.has(key)) {
        this.cache.delete(key);
      } else if (this.cache.size >= this.maxEntries) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }

      this.cache.set(key, {
        found: result.found,
        cost: result.cost,
        distance: result.distance,
        nodes: result.nodes.slice(),
        edges: result.edges.slice(),
        algorithm: result.algorithm || algorithm
      });
    }

    clear() {
      this.cache.clear();
      this.version++;
    }

    size() {
      return this.cache.size;
    }
  }

  const _graphDijkstraCaches = new WeakMap();
  const _costFunctionCache = new Map();
  const _COST_FN_CACHE_MAX = 50;
  let _globalCacheVersion = 1;

  function _setCostFunctionCacheLRU(key, fn) {
    if (_costFunctionCache.size >= _COST_FN_CACHE_MAX && !_costFunctionCache.has(key)) {
      const oldestKey = _costFunctionCache.keys().next().value;
      if (oldestKey !== undefined) _costFunctionCache.delete(oldestKey);
    }
    _costFunctionCache.set(key, fn);
  }

  function _getCostFunctionCacheLRU(key) {
    if (!_costFunctionCache.has(key)) return null;
    const cached = _costFunctionCache.get(key);
    _costFunctionCache.delete(key);
    _costFunctionCache.set(key, cached);
    return cached;
  }

  function getGraphCache(graph) {
    if (!graph || typeof graph !== 'object') return null;
    let cache = _graphDijkstraCaches.get(graph);
    if (!cache) {
      cache = new DijkstraLRUCache(100);
      _graphDijkstraCaches.set(graph, cache);
    }
    return cache;
  }

  function clearAllDijkstraCaches() {
    _globalCacheVersion++;
    _costFunctionCache.clear();
  }

  // Lắng nghe sự kiện dữ liệu thay đổi trên trình duyệt để tự động invalidate cache
  if (typeof window !== 'undefined') {
    window.addEventListener('incidents-changed', () => clearAllDijkstraCaches());
  }

  /* ==========================================================================
     PHASE 3: GRAPH ADAPTER & EDGE IDENTIFIER HELPERS
     ========================================================================== */

  /**
   * Lấy định danh duy nhất của một cạnh mà KHÔNG làm thay đổi (mutate) edge
   * Ưu tiên: edge.id -> edge._id -> fallback: from->to
   * @param {Object} edge
   * @returns {string}
   */
  function getEdgeIdentifier(edge) {
    if (!edge) return '';
    if (edge.id != null) return String(edge.id);
    if (edge._id != null) return String(edge._id);
    return `${edge.from}->${edge.to}`;
  }

  /**
   * Helper trích xuất danh sách các cạnh đi ra (outgoing edges) từ một node bất kỳ
   * @param {Object} graph Đối tượng đồ thị
   * @param {string|number} nodeId ID nút cần lấy cạnh đi ra
   * @returns {Array<Object>} Danh sách các cạnh đi ra
   */
  function getGraphOutgoingEdges(graph, nodeId) {
    if (!graph || nodeId == null) return [];
    const idStr = String(nodeId);

    if (typeof graph.getOutgoingEdges === 'function') {
      const edges = graph.getOutgoingEdges(idStr);
      if (Array.isArray(edges)) return edges;
    }

    if (typeof graph.getNeighbors === 'function') {
      const neighbors = graph.getNeighbors(idStr);
      if (Array.isArray(neighbors)) return neighbors;
    }

    if (graph.adjacency && typeof graph.adjacency.get === 'function') {
      const list = graph.adjacency.get(idStr);
      if (Array.isArray(list)) return list;
    }

    if (graph.adjacencyList) {
      if (typeof graph.adjacencyList.get === 'function') {
        const list = graph.adjacencyList.get(idStr);
        if (Array.isArray(list)) return list;
      } else if (Array.isArray(graph.adjacencyList[idStr])) {
        return graph.adjacencyList[idStr];
      }
    }

    if (typeof graph.getNode === 'function') {
      const node = graph.getNode(idStr);
      if (node) {
        if (Array.isArray(node.edges)) return node.edges;
        if (Array.isArray(node.neighbors)) return node.neighbors;
      }
    }

    if (graph.edges && Array.isArray(graph.edges[idStr])) {
      return graph.edges[idStr];
    }

    return [];
  }

  /**
   * Helper trích xuất danh sách các cạnh đi vào (incoming edges) từ một node bất kỳ
   * @param {Object} graph Đối tượng đồ thị
   * @param {string|number} nodeId ID nút cần lấy cạnh đi vào
   * @returns {Array<Object>} Danh sách các cạnh đi vào
   */
  function getGraphIncomingEdges(graph, nodeId) {
    if (!graph || nodeId == null) return [];
    const idStr = String(nodeId);

    if (typeof graph.getIncomingEdges === 'function') {
      const edges = graph.getIncomingEdges(idStr);
      if (Array.isArray(edges)) return edges;
    }

    if (graph.incoming && typeof graph.incoming.get === 'function') {
      const list = graph.incoming.get(idStr);
      if (Array.isArray(list)) return list;
    }

    if (typeof graph.getNode === 'function') {
      const node = graph.getNode(idStr);
      if (node && Array.isArray(node.incomingEdges)) {
        return node.incomingEdges;
      }
    }

    return [];
  }

  /**
   * Kiểm tra xem một node có tồn tại trong đồ thị hay không
   * @param {Object} graph
   * @param {string} nodeId
   * @returns {boolean|null} true/false nếu xác định được, null nếu đồ thị không có method kiểm tra
   */
  function checkNodeExistsInGraph(graph, nodeId) {
    if (!graph || nodeId == null) return false;
    const idStr = String(nodeId);

    if (typeof graph.hasNode === 'function') {
      return Boolean(graph.hasNode(idStr));
    }
    if (typeof graph.getNode === 'function') {
      return graph.getNode(idStr) !== null && graph.getNode(idStr) !== undefined;
    }
    if (graph.nodes) {
      if (typeof graph.nodes.has === 'function') {
        return Boolean(graph.nodes.has(idStr));
      }
      if (typeof graph.nodes === 'object') {
        return graph.nodes[idStr] !== undefined;
      }
    }
    return null;
  }

  /**
   * Trích xuất chi phí mặc định của một cạnh có xem xét tiêu chí (metric):
   * - metric = 'time': Ưu tiên edge.cost -> edge.freeflow_time -> edge.distance/10 -> edge.weight
   * - metric = 'distance': Ưu tiên edge.cost -> edge.distance -> edge.weight -> edge.freeflow_time
   * 
   * @param {Object} edge
   * @param {'time'|'distance'} [metric='time']
   * @returns {number}
   * @complexity O(1)
   */
  function defaultGetEdgeCost(edge, metric = 'time') {
    if (!edge) return Infinity;
    const c = edge.cost;
    if (typeof c === 'number' && Number.isFinite(c)) return c;

    if (metric === 'time') {
      const ft = edge.freeflow_time;
      if (typeof ft === 'number' && Number.isFinite(ft) && ft > 0) return ft;
      const d = edge.distance;
      if (typeof d === 'number' && Number.isFinite(d)) return d / 10;
      const w = edge.weight;
      if (typeof w === 'number' && Number.isFinite(w)) return w;
    } else {
      const d = edge.distance;
      if (typeof d === 'number' && Number.isFinite(d)) return d;
      const w = edge.weight;
      if (typeof w === 'number' && Number.isFinite(w)) return w;
      const ft = edge.freeflow_time;
      if (typeof ft === 'number' && Number.isFinite(ft)) return ft;
    }
    return Infinity;
  }

  /* ==========================================================================
     PHASE 4: TÍNH TOÁN CHI PHÍ AN TOÀN ĐỘNG (SAFEROUTE DYNAMIC SAFETY COST)
     ========================================================================== */

  /**
   * Tạo hàm tính chi phí cạnh động cho SafeRoute:
   * Kết hợp chi phí cơ sở (quãng đường / thời gian) và chi phí rủi ro / sự cố thời gian thực.
   * 
   * Hạng mục nâng cấp:
   * 1. Hỗ trợ caching cost function theo (metric, mode, configVersion, incidentsMapVersion).
   * 2. Áp dụng mô hình suy giảm Bayesian (Half-Life Exponential Decay) theo thời gian:
   *    C(t) = C_0 * (0.5)^(elapsedHours / halfLifeHours)
   * 3. Precompute decayed confidence một lần duy nhất trước vòng lặp (Map tra cứu O(1)).
   * 4. Giới hạn phạt tối đa (penalty clamping) với MAX_PENALTY_RATIO để tránh méo mó đường đi.
   * 
   * @param {Object} [options={}]
   * @param {'time'|'distance'} [options.metric='time'] Tiêu chí cơ sở ('time' hoặc 'distance')
   * @param {'fastest'|'balanced'|'safest'} [options.mode='balanced'] Chế độ an toàn
   * @param {number} [options.now] Mốc thời gian đánh giá (mặc định Date.now())
   * @param {Object} [options.config] Cấu hình hệ thống (mặc định lấy từ CONFIG toàn cục)
   * @param {number} [options.configVersion=1] Phiên bản cấu hình (phục vụ cache invalidation)
   * @param {Map<string, Object>|Object} [options.incidentsMap] Danh sách/Map sự cố
   * @param {number} [options.incidentsMapVersion=1] Phiên bản dữ liệu sự cố
   * @param {Function} [options.getIncidentConfidence] Hàm tính confidence tùy chọn
   * @param {number} [options.decayPrecisionMs=300000] Độ phân giải thời gian bucket cho cache (mặc định 5 phút = 300.000ms)
   * @returns {Function} Hàm thuần túy (edge) => number (hợp lệ trong cửa sổ thời gian bucket của cache)
   * @complexity O(I) chuẩn bị, O(1) mỗi lần gọi trên cạnh
   */
  function createSafeRouteCostFunction(options = {}) {
    const metric = options.metric || 'time';
    const mode = options.mode || 'balanced';
    const cfgVersion = options.configVersion || 1;
    const incVersion = options.incidentsMapVersion || 1;
    const nowTimestamp = (typeof options.now === 'number') ? options.now : null;

    // Bucket thời gian theo chu kỳ decayPrecisionMs (mặc định 5 phút = 300.000ms) để cache không bị đóng băng decay
    const decayPrecisionMs = (typeof options.decayPrecisionMs === 'number' && options.decayPrecisionMs > 0)
      ? options.decayPrecisionMs
      : (5 * 60 * 1000);
    const bucket = (nowTimestamp != null)
      ? Math.floor(nowTimestamp / decayPrecisionMs)
      : Math.floor(Date.now() / decayPrecisionMs);

    // Cache key kiểm tra tái sử dụng cost function theo bucket thời gian
    const cacheKey = `${metric}#${mode}#${cfgVersion}#${incVersion}#${bucket}`;
    if (options.noCache !== true) {
      const cached = _getCostFunctionCacheLRU(cacheKey);
      if (cached) return cached;
    }

    const globalCfg = (typeof window !== 'undefined' && window.CONFIG)
      ? window.CONFIG
      : ((typeof CONFIG !== 'undefined') ? CONFIG : {});
    const cfg = options.config || globalCfg;

    const modeAlpha = (cfg.mode_alpha && cfg.mode_alpha[mode] != null)
      ? cfg.mode_alpha[mode]
      : (mode === 'fastest' ? 0 : mode === 'safest' ? 3 : 1);

    const typeWeights = cfg.incident_type_weight || {
      accident: 0.30, flood: 0.25, danger: 0.20,
      construction: 0.15, traffic: 0.12, damaged_road: 0.10, obstacle: 0.08
    };

    const levelWeights = cfg.incident_level_weight || {
      cao: 1.0, trungbinh: 0.5, thap: 0.2
    };

    const maxPenaltyRatio = (typeof cfg.max_penalty_ratio === 'number') ? cfg.max_penalty_ratio : 5.0;
    const incMap = options.incidentsMap || null;
    const evalNow = nowTimestamp || Date.now();

    // PRECOMPUTATION: Tính toán trước decayed confidence cho toàn bộ incidents
    // Lưu vào Map để tra cứu O(1) trong inner loop mà không gọi Math.pow lặp lại
    const decayedConfidenceMap = new Map();
    if (incMap) {
      const decayConfig = (typeof window !== 'undefined' && window.INCIDENT_DECAY_CONFIG)
        ? window.INCIDENT_DECAY_CONFIG
        : (cfg.decay || {});

      const entries = (typeof incMap.entries === 'function')
        ? incMap.entries()
        : Object.entries(incMap);

      for (const [id, inc] of entries) {
        if (!inc) continue;
        let conf;
        if (typeof options.getIncidentConfidence === 'function') {
          conf = options.getIncidentConfidence(inc, evalNow);
        } else {
          const baseConf = (typeof inc.confidence === 'number') ? inc.confidence : 50;
          const lastActivity = inc.lastConfirmedAt || inc.createdAt || inc.startedAt || evalNow;
          const elapsedHours = Math.max(0, (evalNow - lastActivity) / 3600000);
          const typeDecay = decayConfig[inc.type] || { halfLifeHours: 24 };
          const halfLife = typeDecay.halfLifeHours || 24;
          conf = baseConf * Math.pow(0.5, elapsedHours / halfLife);
          conf = Math.max(0, Math.min(100, conf));
        }
        decayedConfidenceMap.set(String(id), conf / 100);
      }
    }

    const costFunction = function getSafeRouteCost(edge) {
      if (!edge) return Infinity;

      // 1. BASE STATIC COST: Phân biệt theo metric ('time' vs 'distance')
      let baseCost;
      if (metric === 'time') {
        const ft = edge.freeflow_time;
        if (typeof ft === 'number' && ft > 0) {
          baseCost = ft;
        } else {
          const ed = edge.distance;
          baseCost = (typeof ed === 'number') ? (ed / 10) : (edge.cost || 0);
        }
      } else {
        const ed = edge.distance;
        baseCost = (typeof ed === 'number')
          ? ed
          : (typeof edge.cost === 'number' ? edge.cost : 0);
      }

      if (baseCost <= 0) baseCost = 0.1;

      // Chế độ 'fastest' (alpha = 0) hoặc cạnh không có sự cố: chỉ lấy baseCost
      if (modeAlpha === 0 || !edge.incident_ids || edge.incident_ids.length === 0) {
        return baseCost;
      }

      // 2. DYNAMIC SAFETY PENALTY: Dựa trên sự cố thực tế với decayed confidence
      let totalIncidentWeight = 0;
      if (incMap && Array.isArray(edge.incident_ids)) {
        for (let i = 0; i < edge.incident_ids.length; i++) {
          const incId = String(edge.incident_ids[i]);
          const inc = (typeof incMap.get === 'function') ? incMap.get(incId) : incMap[incId];
          if (inc) {
            const tw = typeWeights[inc.type] || 0.1;
            const lw = levelWeights[inc.level] || 0.2;
            const confRatio = decayedConfidenceMap.has(incId)
              ? decayedConfidenceMap.get(incId)
              : ((typeof inc.confidence === 'number') ? (inc.confidence / 100) : 0.5);
            totalIncidentWeight += tw * lw * confRatio;
          }
        }
      } else {
        // Fallback ước tính nếu chỉ có ID mà chưa nạp incMap
        totalIncidentWeight = edge.incident_ids.length * 0.25;
      }

      // 3. PENALTY CLAMPING: Ngăn chặn penalty kéo dài vô tận ở mode 'safest'
      const rawPenalty = baseCost * modeAlpha * totalIncidentWeight;
      const maxPenalty = baseCost * maxPenaltyRatio;
      const penalty = Math.min(rawPenalty, maxPenalty);

      return baseCost + penalty;
    };

    if (options.noCache !== true) {
      _setCostFunctionCacheLRU(cacheKey, costFunction);
    }

    return costFunction;
  }

  /* ==========================================================================
     PHASE 5: DIJKSTRA SHORTEST PATH ENGINE (TỐI ƯU HÓA HOÀN TOÀN)
     ========================================================================== */

  /**
   * Thuật toán Dijkstra tìm đường ngắn nhất giữa 2 node trên đồ thị.
   * 
   * Tối ưu hóa:
   * - Bổ sung `finalized` (Visited Set) ngăn chặn duyệt lại node đã chốt shortest distance.
   * - Sửa triệt để lỗi off-by-one: Kiểm tra search limits (maxCost, maxVisitedNodes) trước khi finalized.add(u).
   * - Loại bỏ stale heap entries tức thì trong O(1).
   * - Fast-path truy cập Adjacency List trực tiếp (bỏ hàm gián tiếp trong inner loop).
   * - Triệt tiêu cấp phát object `{ node, edge }` trong quá trình Edge Relaxation.
   * - Hỗ trợ an toàn khi gặp cạnh âm / không hợp lệ ({ onInvalidEdge: 'clamp' | 'skip' | 'throw' }).
   * - Gộp kiểm tra finite & NaN tối ưu hiệu năng V8.
   * - Hỗ trợ tùy chọn assumeStringIds để bỏ qua ép kiểu string không cần thiết.
   * - Tách biệt hoàn toàn cost và distance.
   * 
   * @param {Object} graph Đối tượng đồ thị cung cấp giao diện truy vấn
   * @param {string|number} startNodeId Node xuất phát
   * @param {string|number} destinationNodeId Node đích
   * @param {Object} [options={}] Cấu hình tùy chọn
   * @param {'time'|'distance'} [options.metric='time'] Tiêu chí mặc định ('time' hoặc 'distance')
   * @param {Function} [options.getEdgeCost] Hàm tính chi phí cạnh (edge) => number
   * @param {'clamp'|'skip'|'throw'} [options.onInvalidEdge='clamp'] Cơ chế xử lý cạnh âm / không hợp lệ
   * @param {boolean} [options.assumeStringIds=false] Cờ báo trước node IDs luôn là string
   * @param {Function} [options.edgeFilter] Hàm lọc cạnh (edge) => boolean
   * @param {Function} [options.nodeFilter] Hàm lọc node (nodeId) => boolean
   * @param {'standard'|'bidirectional'} [options.algorithm='standard'] Thuật toán ('standard' hoặc 'bidirectional')
   * @param {number} [options.maxVisitedNodes=Infinity] Giới hạn số node mở rộng tối đa
   * @param {number} [options.maxExpandedEdges=Infinity] Giới hạn số cạnh mở rộng tối đa
   * @param {number} [options.maxSearchCost=Infinity] Giới hạn chi phí tìm kiếm tối đa
   * @param {boolean} [options.noCache=false] Tắt truy vấn cache
   * @param {string} [options.costProfileKey='default'] Khóa phân biệt cấu hình chi phí trong cache
   * @param {Object} [options.metrics] Đối tượng ghi nhận số liệu benchmark
   * @param {boolean} [options.debug=false] Bật log debug
   * @returns {{ found: boolean, cost: number, distance: number|null, nodes: Array<string>, edges: Array<Object>, limitReached?: boolean, reason?: string, algorithm?: string }}
   * @complexity O((V + E) log V)
   */
  function dijkstra(graph, startNodeId, destinationNodeId, options = {}) {
    const isDebug = options.debug === true;

    // 1. Kiểm tra tham số đầu vào
    if (!graph || startNodeId == null || destinationNodeId == null) {
      if (isDebug && typeof console !== 'undefined') {
        console.warn('[Dijkstra] Invalid graph or start/dest parameters.');
      }
      return { found: false, cost: Infinity, distance: null, nodes: [], edges: [] };
    }

    const startId = String(startNodeId);
    const destId = String(destinationNodeId);

    // 2. Chuyển sang Bidirectional Dijkstra nếu được yêu cầu
    if (options.algorithm === 'bidirectional') {
      return bidirectionalDijkstra(graph, startId, destId, options);
    }

    // 3. Kiểm tra xem node có tồn tại trong graph hay không
    const startExists = checkNodeExistsInGraph(graph, startId);
    const destExists = checkNodeExistsInGraph(graph, destId);

    if (startExists === false || destExists === false) {
      if (isDebug && typeof console !== 'undefined') {
        console.warn(`[Dijkstra] Start node (${startId}) or destination node (${destId}) does not exist in graph.`);
      }
      return { found: false, cost: Infinity, distance: null, nodes: [], edges: [] };
    }

    const edgeFilter = typeof options.edgeFilter === 'function' ? options.edgeFilter : null;
    const nodeFilter = typeof options.nodeFilter === 'function' ? options.nodeFilter : null;

    if (nodeFilter) {
      if (!nodeFilter(startId) || !nodeFilter(destId)) {
        return { found: false, cost: Infinity, distance: null, nodes: [], edges: [] };
      }
    }

    // 4. Trường hợp đặc biệt: Điểm xuất phát trùng với điểm đích
    if (startId === destId) {
      return {
        found: true,
        cost: 0,
        distance: 0,
        nodes: [startId],
        edges: [],
        algorithm: 'standard'
      };
    }

    const metric = options.metric || 'time';
    const onInvalidEdge = options.onInvalidEdge || 'clamp';
    const hasCustomCost = typeof options.getEdgeCost === 'function';
    const isCacheable = !edgeFilter && !nodeFilter && options.noCache !== true && (!hasCustomCost || Boolean(options.costProfileKey));
    const profileKey = options.costProfileKey || 'default';
    const graphCache = isCacheable ? (options.cache || getGraphCache(graph)) : null;

    if (graphCache) {
      const cached = graphCache.get(startId, destId, profileKey, 'standard', metric, onInvalidEdge);
      if (cached) {
        if (options.metrics) {
          options.metrics.cacheHit = true;
          options.metrics.visitedNodes = 0;
          options.metrics.expandedEdges = 0;
        }
        return cached;
      }
    }
    if (options.metrics) {
      options.metrics.cacheHit = false;
    }

    // 5. Cấu hình chi phí cạnh & Giới hạn tìm kiếm
    const getCost = hasCustomCost ? options.getEdgeCost : ((edge) => defaultGetEdgeCost(edge, metric));
    const assumeString = options.assumeStringIds === true;

    const maxVisited = (typeof options.maxVisitedNodes === 'number' && options.maxVisitedNodes > 0)
      ? options.maxVisitedNodes
      : Infinity;
    const maxExpanded = (typeof options.maxExpandedEdges === 'number' && options.maxExpandedEdges > 0)
      ? options.maxExpandedEdges
      : Infinity;
    const maxCost = (typeof options.maxSearchCost === 'number' && options.maxSearchCost > 0)
      ? options.maxSearchCost
      : Infinity;

    // Fast-path phân giải Adjacency Accessor một lần trước vòng lặp
    const adjMap = (graph.adjacency instanceof Map) ? graph.adjacency : null;
    const adjObj = (graph.adjacency && typeof graph.adjacency === 'object' && !(graph.adjacency instanceof Map)) ? graph.adjacency : null;
    const getOutMethod = typeof graph.getOutgoingEdges === 'function'
      ? (id) => graph.getOutgoingEdges(id)
      : (typeof graph.getNeighbors === 'function' ? (id) => graph.getNeighbors(id) : null);

    // 6. Khởi tạo trạng thái thuật toán (State hoàn toàn nằm ngoài graph)
    const distances = new Map();
    const prevNode = new Map(); // v -> u
    const prevEdge = new Map(); // v -> edge
    const finalized = new Set();
    const pq = new PriorityQueue();

    distances.set(startId, 0);
    pq.push(startId, 0);

    let destinationFound = false;
    let expandedEdgesCount = 0;
    let limitReached = false;
    let limitReason = '';

    const metrics = options.metrics || null;
    let heapPops = 0;
    let heapPushes = 1;

    // 7. Vòng lặp chính của Dijkstra
    while (!pq.isEmpty()) {
      const entry = pq.pop();
      heapPops++;
      const u = entry.item;
      const currentDist = entry.priority;

      // STALE HEAP ENTRY CHECK (O(1)):
      if (finalized.has(u)) {
        continue;
      }

      // EARLY TERMINATION: Destination đã được pop khỏi Min-Heap với khoảng cách tối ưu
      if (u === destId) {
        destinationFound = true;
        finalized.add(u);
        break;
      }

      // KIỂM TRA GIỚI HẠN AN TOÀN TRƯỚC KHI FINALIZE: maxSearchCost
      if (currentDist > maxCost) {
        limitReached = true;
        limitReason = 'max_search_cost_exceeded';
        break;
      }

      // KIỂM TRA GIỚI HẠN AN TOÀN TRƯỚC KHI FINALIZE: maxVisitedNodes (>= sửa lỗi off-by-one)
      if (finalized.size >= maxVisited) {
        limitReached = true;
        limitReason = 'max_visited_nodes_exceeded';
        break;
      }

      // Chốt khoảng cách tối ưu cho node u
      finalized.add(u);

      // Lấy danh sách các cạnh đi ra từ u qua Fast Path
      let outgoingEdges;
      if (adjMap) {
        outgoingEdges = adjMap.get(u) || [];
      } else if (adjObj) {
        outgoingEdges = adjObj[u] || [];
      } else if (getOutMethod) {
        outgoingEdges = getOutMethod(u) || [];
      } else {
        outgoingEdges = getGraphOutgoingEdges(graph, u);
      }

      const numOutEdges = outgoingEdges.length;
      for (let i = 0; i < numOutEdges; i++) {
        const edge = outgoingEdges[i];
        if (!edge || edge.to == null) continue;

        const v = assumeString ? edge.to : (typeof edge.to === 'string' ? edge.to : String(edge.to));

        // TỐI ƯU HÓA: Node v đã được finalized -> không thể cải thiện thêm
        if (finalized.has(v)) {
          continue;
        }

        if (nodeFilter && !nodeFilter(v)) {
          continue;
        }

        if (edgeFilter && !edgeFilter(edge)) {
          continue;
        }

        expandedEdgesCount++;
        if (expandedEdgesCount > maxExpanded) {
          limitReached = true;
          limitReason = 'max_expanded_edges_exceeded';
          break;
        }

        // Tính chi phí cạnh
        let edgeCost;
        if (!hasCustomCost) {
          edgeCost = defaultGetEdgeCost(edge, metric);
        } else {
          edgeCost = getCost(edge);
        }

        // MICRO-OPTIMIZATION: Gộp finite check & NaN check
        if (typeof edgeCost !== 'number' || !Number.isFinite(edgeCost)) {
          if (metrics) metrics.invalidEdges = (metrics.invalidEdges || 0) + 1;
          if (isDebug && typeof console !== 'undefined') {
            console.warn(`[Dijkstra] Cạnh không hợp lệ (NaN/Infinity): cost=${edgeCost} trên (${edge.from}->${edge.to})`);
          }
          continue;
        }

        // XỬ LÝ AN TOÀN TRỌNG SỐ CẠNH ÂM (Negative Edge Handling)
        if (edgeCost < 0) {
          if (metrics) {
            metrics.negativeEdges = (metrics.negativeEdges || 0) + 1;
            metrics.invalidEdges = (metrics.invalidEdges || 0) + 1;
          }
          if (isDebug && typeof console !== 'undefined') {
            console.warn(`[Dijkstra] Phát hiện cạnh có chi phí âm: cost=${edgeCost} trên (${edge.from || u}->${v})`);
          }
          if (onInvalidEdge === 'throw') {
            throw new Error(`[Dijkstra] Phát hiện trọng số cạnh âm: cost = ${edgeCost} trên cạnh (${edge.from || u} -> ${v}). Thuật toán Dijkstra không hỗ trợ chi phí âm.`);
          } else if (onInvalidEdge === 'skip') {
            continue;
          } else {
            // 'clamp' mode: kẹp về 0 để tiếp tục tìm kiếm mà không crash
            edgeCost = 0;
          }
        }

        const altDist = currentDist + edgeCost;
        const recordedV = distances.get(v);
        const currentBestV = (recordedV !== undefined) ? recordedV : Infinity;

        // Thả lỏng cạnh (Edge Relaxation)
        if (altDist < currentBestV) {
          distances.set(v, altDist);
          prevNode.set(v, u);
          prevEdge.set(v, edge);
          pq.push(v, altDist);
          heapPushes++;
        }
      }

      if (limitReached) break;
    }

    // Ghi nhận metrics
    if (metrics) {
      metrics.visitedNodes = finalized.size;
      metrics.expandedEdges = expandedEdgesCount;
      metrics.heapPops = heapPops;
      metrics.heapPushes = heapPushes;
      metrics.limitReached = limitReached;
    }

    // 8. Xử lý khi vượt giới hạn an toàn
    if (limitReached && !destinationFound) {
      return {
        found: false,
        limitReached: true,
        reason: limitReason,
        cost: Infinity,
        distance: null,
        nodes: [],
        edges: [],
        algorithm: 'standard'
      };
    }

    // 9. Không tới được điểm đích (unreachable / disconnected)
    if (!destinationFound && (!distances.has(destId) || distances.get(destId) === Infinity)) {
      return {
        found: false,
        cost: Infinity,
        distance: null,
        nodes: [],
        edges: [],
        algorithm: 'standard'
      };
    }

    // 10. Tái tạo đường đi (Path Reconstruction)
    const pathNodes = [];
    const pathEdges = [];
    let curr = destId;

    while (curr !== startId) {
      pathNodes.push(curr);
      const edge = prevEdge.get(curr);
      const node = prevNode.get(curr);
      if (!edge || node === undefined) {
        return {
          found: false,
          cost: Infinity,
          distance: null,
          nodes: [],
          edges: [],
          algorithm: 'standard'
        };
      }
      pathEdges.push(edge);
      curr = node;
    }

    pathNodes.push(startId);
    pathNodes.reverse();
    pathEdges.reverse();

    const totalCost = distances.get(destId) || 0;

    // Tính toán chiều dài vật lý (distance)
    let totalDistance = 0;
    let hasValidDistance = pathEdges.length > 0;

    for (let i = 0; i < pathEdges.length; i++) {
      const e = pathEdges[i];
      if (typeof e.distance === 'number' && Number.isFinite(e.distance) && e.distance >= 0) {
        totalDistance += e.distance;
      } else {
        hasValidDistance = false;
        break;
      }
    }

    const finalResult = {
      found: true,
      cost: totalCost,
      distance: hasValidDistance ? totalDistance : null,
      nodes: pathNodes,
      edges: pathEdges,
      algorithm: 'standard'
    };

    // Lưu vào Cache
    if (graphCache) {
      graphCache.set(startId, destId, finalResult, profileKey, 'standard', metric, onInvalidEdge);
    }

    return finalResult;
  }

  /* ==========================================================================
     PHASE 6: BIDIRECTIONAL DIJKSTRA (TÌM ĐƯỜNG HAI CHIỀU)
     ========================================================================== */

  /**
   * Thuật toán Bidirectional Dijkstra tìm đường ngắn nhất hai chiều đồng thời.
   * 
   * Tối ưu hóa:
   * - Fast-path truy cập Adjacency và Incoming Lists trực tiếp.
   * - Triệt tiêu cấp phát object { node, edge } trong cả 2 hướng.
   * - Fallback logic chuẩn: Chỉ fallback về Standard Dijkstra khi đồ thị KHÔNG hỗ trợ incoming edges.
   *   Nếu đồ thị hỗ trợ incoming nhưng không có đường nối, trả về found: false trực tiếp (không chạy lại Standard).
   * - Áp dụng cơ chế an toàn cạnh âm ({ onInvalidEdge: 'clamp' | 'skip' | 'throw' }).
   * - Tích hợp đầy đủ bộ nhớ đệm DijkstraLRUCache và metrics.
   * 
   * @param {Object} graph Đối tượng đồ thị
   * @param {string|number} startNodeId Node xuất phát
   * @param {string|number} destinationNodeId Node đích
   * @param {Object} [options={}] Cấu hình tùy chọn
   * @returns {Object}
   * @complexity O((V + E) log V), thực nghiệm giảm 30-50% số node duyệt so với Standard
   */
  function bidirectionalDijkstra(graph, startNodeId, destinationNodeId, options = {}) {
    const isDebug = options.debug === true;
    const startId = String(startNodeId);
    const destId = String(destinationNodeId);

    if (startId === destId) {
      return { found: true, cost: 0, distance: 0, nodes: [startId], edges: [], algorithm: 'bidirectional' };
    }

    // FALLBACK LOGIC CHUẨN: Chỉ fallback khi graph THỰC SỰ không hỗ trợ incoming edges
    const supportsIncoming = typeof graph.getIncomingEdges === 'function' ||
                             (graph.incoming instanceof Map) ||
                             (graph.incoming && typeof graph.incoming === 'object');

    if (!supportsIncoming) {
      const fallbackOpts = { ...options, algorithm: 'standard' };
      return dijkstra(graph, startId, destId, fallbackOpts);
    }

    const metric = options.metric || 'time';
    const onInvalidEdge = options.onInvalidEdge || 'clamp';
    const edgeFilter = typeof options.edgeFilter === 'function' ? options.edgeFilter : null;
    const nodeFilter = typeof options.nodeFilter === 'function' ? options.nodeFilter : null;
    const hasCustomCost = typeof options.getEdgeCost === 'function';
    const isCacheable = !edgeFilter && !nodeFilter && options.noCache !== true && (!hasCustomCost || Boolean(options.costProfileKey));
    const profileKey = options.costProfileKey || 'default';
    const graphCache = isCacheable ? (options.cache || getGraphCache(graph)) : null;

    if (graphCache) {
      const cached = graphCache.get(startId, destId, profileKey, 'bidirectional', metric, onInvalidEdge);
      if (cached) {
        if (options.metrics) {
          options.metrics.cacheHit = true;
          options.metrics.visitedNodes = 0;
          options.metrics.expandedEdges = 0;
        }
        return cached;
      }
    }
    if (options.metrics) {
      options.metrics.cacheHit = false;
    }

    const getCost = hasCustomCost ? options.getEdgeCost : ((edge) => defaultGetEdgeCost(edge, metric));
    const assumeString = options.assumeStringIds === true;

    // Fast-path truy cập Adjacency và Incoming
    const adjMap = (graph.adjacency instanceof Map) ? graph.adjacency : null;
    const adjObj = (graph.adjacency && typeof graph.adjacency === 'object' && !(graph.adjacency instanceof Map)) ? graph.adjacency : null;
    const getOutMethod = typeof graph.getOutgoingEdges === 'function'
      ? (id) => graph.getOutgoingEdges(id)
      : (typeof graph.getNeighbors === 'function' ? (id) => graph.getNeighbors(id) : null);

    const inMap = (graph.incoming instanceof Map) ? graph.incoming : null;
    const inObj = (graph.incoming && typeof graph.incoming === 'object' && !(graph.incoming instanceof Map)) ? graph.incoming : null;
    const getInMethod = typeof graph.getIncomingEdges === 'function'
      ? (id) => graph.getIncomingEdges(id)
      : null;

    // Hàng đợi và khoảng cách cho chiều thuận (Forward: start ->)
    const pqF = new PriorityQueue();
    const distF = new Map();
    const prevNodeF = new Map();
    const prevEdgeF = new Map();
    const finalizedF = new Set();

    // Hàng đợi và khoảng cách cho chiều nghịch (Backward: -> dest)
    const pqB = new PriorityQueue();
    const distB = new Map();
    const nextNodeB = new Map();
    const nextEdgeB = new Map();
    const finalizedB = new Set();

    distF.set(startId, 0);
    pqF.push(startId, 0);

    distB.set(destId, 0);
    pqB.push(destId, 0);

    let bestCost = Infinity;
    let bestMeetingNode = null;
    let expandedEdgesCount = 0;
    let heapPops = 0;
    let heapPushes = 2;

    const metrics = options.metrics || null;

    while (!pqF.isEmpty() && !pqB.isEmpty()) {
      const topF = pqF.peek();
      const topB = pqB.peek();
      const minF = topF ? topF.priority : Infinity;
      const minB = topB ? topB.priority : Infinity;
      if (minF + minB >= bestCost) {
        break;
      }

      if (minF <= minB) {
        // --- FORWARD STEP ---
        const entryF = pqF.pop();
        heapPops++;
        const u = entryF.item;
        const dU = entryF.priority;

        if (finalizedF.has(u)) continue;
        finalizedF.add(u);

        let outEdges;
        if (adjMap) outEdges = adjMap.get(u) || [];
        else if (adjObj) outEdges = adjObj[u] || [];
        else if (getOutMethod) outEdges = getOutMethod(u) || [];
        else outEdges = getGraphOutgoingEdges(graph, u);

        const nOut = outEdges.length;
        for (let i = 0; i < nOut; i++) {
          const edge = outEdges[i];
          if (!edge || edge.to == null) continue;
          const v = assumeString ? edge.to : (typeof edge.to === 'string' ? edge.to : String(edge.to));

          if (finalizedF.has(v)) continue;
          if (nodeFilter && !nodeFilter(v)) continue;
          if (edgeFilter && !edgeFilter(edge)) continue;

          expandedEdgesCount++;

          let cost;
          if (!hasCustomCost) {
            cost = defaultGetEdgeCost(edge, metric);
          } else {
            cost = getCost(edge);
          }

          if (typeof cost !== 'number' || !Number.isFinite(cost)) {
            if (metrics) metrics.invalidEdges = (metrics.invalidEdges || 0) + 1;
            continue;
          }

          if (cost < 0) {
            if (metrics) {
              metrics.negativeEdges = (metrics.negativeEdges || 0) + 1;
              metrics.invalidEdges = (metrics.invalidEdges || 0) + 1;
            }
            if (isDebug && typeof console !== 'undefined') {
              console.warn(`[Bidirectional] Cạnh có chi phí âm: cost=${cost} trên (${edge.from}->${edge.to})`);
            }
            if (onInvalidEdge === 'throw') {
              throw new Error(`[Dijkstra] Phát hiện trọng số cạnh âm: cost = ${cost} trên cạnh (${edge.from}->${edge.to}).`);
            } else if (onInvalidEdge === 'skip') {
              continue;
            } else {
              cost = 0;
            }
          }

          const alt = dU + cost;
          const curBestV = distF.get(v);
          const bestV = (curBestV !== undefined) ? curBestV : Infinity;

          if (alt < bestV) {
            distF.set(v, alt);
            prevNodeF.set(v, u);
            prevEdgeF.set(v, edge);
            pqF.push(v, alt);
            heapPushes++;

            // Kiểm tra điểm giao cắt với chiều nghịch
            const curDistB = distB.get(v);
            if (curDistB !== undefined) {
              const total = alt + curDistB;
              if (total < bestCost) {
                bestCost = total;
                bestMeetingNode = v;
              }
            }
          }
        }
      } else {
        // --- BACKWARD STEP ---
        const entryB = pqB.pop();
        heapPops++;
        const v = entryB.item;
        const dV = entryB.priority;

        if (finalizedB.has(v)) continue;
        finalizedB.add(v);

        let inEdges;
        if (inMap) inEdges = inMap.get(v) || [];
        else if (inObj) inEdges = inObj[v] || [];
        else if (getInMethod) inEdges = getInMethod(v) || [];
        else inEdges = getGraphIncomingEdges(graph, v);

        const nIn = inEdges.length;
        for (let i = 0; i < nIn; i++) {
          const edge = inEdges[i];
          if (!edge || edge.from == null) continue;
          const u = assumeString ? edge.from : (typeof edge.from === 'string' ? edge.from : String(edge.from));

          if (finalizedB.has(u)) continue;
          if (nodeFilter && !nodeFilter(u)) continue;
          if (edgeFilter && !edgeFilter(edge)) continue;

          expandedEdgesCount++;

          let cost;
          if (!hasCustomCost) {
            cost = defaultGetEdgeCost(edge, metric);
          } else {
            cost = getCost(edge);
          }

          if (typeof cost !== 'number' || !Number.isFinite(cost)) {
            if (metrics) metrics.invalidEdges = (metrics.invalidEdges || 0) + 1;
            continue;
          }

          if (cost < 0) {
            if (metrics) {
              metrics.negativeEdges = (metrics.negativeEdges || 0) + 1;
              metrics.invalidEdges = (metrics.invalidEdges || 0) + 1;
            }
            if (isDebug && typeof console !== 'undefined') {
              console.warn(`[Bidirectional] Cạnh có chi phí âm: cost=${cost} trên (${edge.from}->${edge.to})`);
            }
            if (onInvalidEdge === 'throw') {
              throw new Error(`[Dijkstra] Phát hiện trọng số cạnh âm: cost = ${cost} trên cạnh (${edge.from}->${edge.to}).`);
            } else if (onInvalidEdge === 'skip') {
              continue;
            } else {
              cost = 0;
            }
          }

          const alt = dV + cost;
          const curBestU = distB.get(u);
          const bestU = (curBestU !== undefined) ? curBestU : Infinity;

          if (alt < bestU) {
            distB.set(u, alt);
            nextNodeB.set(u, v);
            nextEdgeB.set(u, edge);
            pqB.push(u, alt);
            heapPushes++;

            // Kiểm tra điểm giao cắt với chiều thuận
            const curDistF = distF.get(u);
            if (curDistF !== undefined) {
              const total = curDistF + alt;
              if (total < bestCost) {
                bestCost = total;
                bestMeetingNode = u;
              }
            }
          }
        }
      }
    }

    if (metrics) {
      metrics.visitedNodes = finalizedF.size + finalizedB.size;
      metrics.expandedEdges = expandedEdgesCount;
      metrics.heapPops = heapPops;
      metrics.heapPushes = heapPushes;
    }

    // Đã duyệt toàn bộ frontier mà không tìm thấy meeting node -> đồ thị không liên thông
    if (!bestMeetingNode || !Number.isFinite(bestCost)) {
      return {
        found: false,
        cost: Infinity,
        distance: null,
        nodes: [],
        edges: [],
        algorithm: 'bidirectional'
      };
    }

    // Tái tạo đường đi từ Start -> MeetingNode -> Dest
    const nodesF = [];
    const edgesF = [];
    let currF = bestMeetingNode;
    while (currF !== startId) {
      nodesF.push(currF);
      const edge = prevEdgeF.get(currF);
      const node = prevNodeF.get(currF);
      if (!edge || node === undefined) break;
      edgesF.push(edge);
      currF = node;
    }
    nodesF.push(startId);
    nodesF.reverse();
    edgesF.reverse();

    const nodesB = [];
    const edgesB = [];
    let currB = bestMeetingNode;
    while (currB !== destId) {
      const edge = nextEdgeB.get(currB);
      const node = nextNodeB.get(currB);
      if (!edge || node === undefined) break;
      edgesB.push(edge);
      currB = node;
      nodesB.push(currB);
    }

    const fullNodes = [...nodesF, ...nodesB];
    const fullEdges = [...edgesF, ...edgesB];

    let totalDist = 0;
    let hasDist = fullEdges.length > 0;
    for (let i = 0; i < fullEdges.length; i++) {
      const d = fullEdges[i].distance;
      if (typeof d === 'number' && Number.isFinite(d) && d >= 0) {
        totalDist += d;
      } else {
        hasDist = false;
        break;
      }
    }

    const bidiResult = {
      found: true,
      cost: bestCost,
      distance: hasDist ? totalDist : null,
      nodes: fullNodes,
      edges: fullEdges,
      algorithm: 'bidirectional'
    };

    if (graphCache) {
      graphCache.set(startId, destId, bidiResult, profileKey, 'bidirectional', metric, onInvalidEdge);
    }

    return bidiResult;
  }

  /* ==========================================================================
     PHASE 7: YEN'S K-SHORTEST PATHS ENGINE (BOUNDED MAX-HEAP PRUNING)
     ========================================================================== */

  /**
   * Tạo chuỗi chữ ký (signature) nhận diện tuyến đường:
   * Bao gồm cả node sequence và edge IDs để hỗ trợ hoàn hảo đồ thị có cạnh song song (parallel edges).
   * 
   * @param {Array<string>} nodes
   * @param {Array<Object>} [edges=[]]
   * @returns {string}
   */
  function _getRouteSignature(nodes, edges = []) {
    const nodePart = (nodes || []).join('->');
    if (!edges || edges.length === 0) return nodePart;
    const edgePart = edges.map(e => getEdgeIdentifier(e)).join(',');
    return `${nodePart}|${edgePart}`;
  }

  /**
   * Tính tỷ lệ trùng lặp giữa 2 tuyến đường dựa trên các cạnh chung
   * @param {Object} routeA
   * @param {Object} routeB
   * @returns {number} Tỷ lệ trong đoạn [0, 1]
   */
  function calculateRouteOverlap(routeA, routeB) {
    if (!routeA || !routeB || !routeA.edges || !routeB.edges) return 0;
    if (routeA.edges.length === 0 || routeB.edges.length === 0) return 0;

    const setA = new Set(routeA.edges.map(e => getEdgeIdentifier(e)));
    let common = 0;
    for (let i = 0; i < routeB.edges.length; i++) {
      const e = routeB.edges[i];
      if (setA.has(getEdgeIdentifier(e))) {
        common++;
      }
    }
    const maxEdges = Math.max(routeA.edges.length, routeB.edges.length);
    return maxEdges > 0 ? (common / maxEdges) : 0;
  }

  /**
   * Thuật toán Yen's K-Shortest Paths tối ưu hóa:
   * - Tìm K tuyến đường ngắn nhất không có chu trình (loopless).
   * - Sử dụng Binary Min-Heap cho Candidate Pool B (O(log |B|)).
   * - Bounded Max-Heap kích thước (K - |A|) quản lý threshold pruning:
   *   Cho phép kiểm tra cắt tỉa spur node (Early Pruning) trong O(1) peek thay vì O(B log B).
   * - Tiền tính toán Prefix Cost và Prefix Distance O(N).
   * - Reachability Check: Bỏ qua các spur node không còn cạnh khả dụng.
   * - Hỗ trợ toàn diện parallel edges với edge.id.
   * - Tách biệt cost và distance hoàn toàn.
   * - Tuyệt đối không clone hay mutate đồ thị gốc.
   * 
   * @param {Object} graph Đối tượng đồ thị
   * @param {string|number} startNodeId Node xuất phát
   * @param {string|number} destinationNodeId Node đích
   * @param {number} [K=3] Số lượng tuyến đường ngắn nhất cần tìm (mặc định 3)
   * @param {Object} [options={}] Cấu hình tùy chọn
   * @param {'time'|'distance'} [options.metric='time'] Tiêu chí cơ sở
   * @param {Function} [options.getEdgeCost] Hàm tính chi phí cạnh
   * @param {number} [options.routeOverlapThreshold] Ngưỡng lọc trùng lặp tùy chọn [0, 1]
   * @param {Object} [options.metrics] Ghi nhận số liệu benchmark
   * @param {boolean} [options.debug=false] Bật ghi log debug
   * @returns {Array<{ nodes: Array<string>, edges: Array<Object>, cost: number, distance: number|null }>}
   * @complexity O(K · (V log V + E) + K · N · log K)
   */
  function kShortestPaths(graph, startNodeId, destinationNodeId, K = 3, options = {}) {
    const kTarget = Math.max(1, Number(K) || 3);
    const metrics = options.metrics || null;

    let dijkstraCalls = 0;
    let prunedSpurNodes = 0;

    // 1. Tìm tuyến ngắn nhất đầu tiên A[0]
    const initialRoute = dijkstra(graph, startNodeId, destinationNodeId, options);
    dijkstraCalls++;

    if (!initialRoute.found || initialRoute.nodes.length === 0) {
      if (metrics) {
        metrics.dijkstraCalls = dijkstraCalls;
        metrics.prunedSpurNodes = 0;
      }
      return [];
    }

    /** @type {Array<{ nodes: Array<string>, edges: Array<Object>, cost: number, distance: number|null }>} */
    const A = [initialRoute];
    const initialSig = _getRouteSignature(initialRoute.nodes, initialRoute.edges);
    const seenSignatures = new Set([initialSig]);
    const seenInA = new Set([initialSig]);

    // Comparator chuẩn cho Candidate Min-Heap:
    const candidateComparator = (a, b) => {
      if (Math.abs(a.priority - b.priority) > 1e-9) {
        return a.priority - b.priority;
      }
      const distA = (a.item && a.item.distance != null) ? a.item.distance : Infinity;
      const distB = (b.item && b.item.distance != null) ? b.item.distance : Infinity;
      if (Math.abs(distA - distB) > 1e-9) {
        return distA - distB;
      }
      const sigA = (a.item && a.item._sig) || '';
      const sigB = (b.item && b.item._sig) || '';
      return sigA.localeCompare(sigB);
    };

    /** Candidate Pool B quản lý bằng Min-Heap (O(log |B|)) */
    const candidateHeap = new PriorityQueue(candidateComparator);

    /** Bounded Max-Heap kích thước (K - |A|) quản lý threshold pruning với O(1) peek */
    const maxCandidateComparator = (a, b) => candidateComparator(b, a);
    const maxCandidatesHeap = new PriorityQueue(maxCandidateComparator);

    const metric = options.metric || 'time';
    const getCost = typeof options.getEdgeCost === 'function' ? options.getEdgeCost : ((edge) => defaultGetEdgeCost(edge, metric));
    const overlapThreshold = (typeof options.routeOverlapThreshold === 'number' && options.routeOverlapThreshold > 0 && options.routeOverlapThreshold <= 1)
      ? options.routeOverlapThreshold
      : null;

    // 2. Vòng lặp tìm K - 1 tuyến ngắn tiếp theo
    for (let k = 1; k < kTarget; k++) {
      const prevPath = A[k - 1];
      if (!prevPath || prevPath.nodes.length < 2) break;

      const neededCandidates = kTarget - A.length;

      // ĐỒNG BỘ BOUNDED MAX-HEAP TRƯỚC VÒNG SPUR (O(B log B) 1 lần mỗi vòng k)
      maxCandidatesHeap.clear();
      const activeCandidates = candidateHeap.toArray().filter(
        entry => !seenInA.has(entry.item._sig || _getRouteSignature(entry.item.nodes, entry.item.edges))
      );
      activeCandidates.sort(candidateComparator);
      for (let cIdx = 0; cIdx < Math.min(neededCandidates, activeCandidates.length); cIdx++) {
        maxCandidatesHeap.push(activeCandidates[cIdx].item, activeCandidates[cIdx].priority);
      }

      // Tiền tính toán mảng cộng dồn Prefix Cost và Prefix Distance (O(N))
      const numEdges = prevPath.edges.length;
      const prefixCost = new Float64Array(numEdges + 1);
      const prefixDistance = new Array(numEdges + 1);
      prefixCost[0] = 0;
      prefixDistance[0] = 0;

      let allDistancesValid = true;
      for (let eIdx = 0; eIdx < numEdges; eIdx++) {
        const edge = prevPath.edges[eIdx];
        prefixCost[eIdx + 1] = prefixCost[eIdx] + getCost(edge);

        if (allDistancesValid && typeof edge.distance === 'number' && Number.isFinite(edge.distance) && edge.distance >= 0) {
          prefixDistance[eIdx + 1] = prefixDistance[eIdx] + edge.distance;
        } else {
          allDistancesValid = false;
          prefixDistance[eIdx + 1] = null;
        }
      }

      // Duyệt qua từng node trên prevPath làm spurNode
      for (let i = 0; i < prevPath.nodes.length - 1; i++) {
        const spurNode = prevPath.nodes[i];
        const rootCost = prefixCost[i];

        // TỐI ƯU HÓA: EARLY PRUNING SPUR NODE VỚI BOUNDED MAX-HEAP PEEK O(1)
        if (maxCandidatesHeap.size() >= neededCandidates) {
          const worstCandidate = maxCandidatesHeap.peek();
          if (worstCandidate && rootCost >= worstCandidate.priority) {
            prunedSpurNodes++;
            continue; // Bỏ qua spur node này trong O(1)!
          }
        }

        const rootPathNodes = prevPath.nodes.slice(0, i + 1);
        const rootPathEdges = prevPath.edges.slice(0, i);
        const rootDistance = prefixDistance[i];
        const rootDistanceValid = (rootDistance !== null);

        // Tập các cạnh bị loại trừ khỏi spurNode
        const disabledEdges = new Set();
        const rootSig = rootPathNodes.join('->');

        for (let aIdx = 0; aIdx < A.length; aIdx++) {
          const p = A[aIdx];
          if (p.nodes.length > i && p.nodes.slice(0, i + 1).join('->') === rootSig) {
            const nextEdge = p.edges[i];
            if (nextEdge) {
              const edgeId = getEdgeIdentifier(nextEdge);
              disabledEdges.add(edgeId);
              if (!nextEdge.id && !nextEdge._id) {
                disabledEdges.add(`${nextEdge.from}->${nextEdge.to}`);
              }
            }
          }
        }

        // TỐI ƯU HÓA: REACHABILITY CHECK
        const rawOutgoing = getGraphOutgoingEdges(graph, spurNode);
        let hasAnyUsableEdge = false;
        for (let oIdx = 0; oIdx < rawOutgoing.length; oIdx++) {
          const oe = rawOutgoing[oIdx];
          if (!oe) continue;
          const eid = getEdgeIdentifier(oe);
          if (!disabledEdges.has(eid) && (oe.id || oe._id || !disabledEdges.has(`${oe.from}->${oe.to}`))) {
            hasAnyUsableEdge = true;
            break;
          }
        }
        if (!hasAnyUsableEdge) {
          prunedSpurNodes++;
          continue;
        }

        const disabledNodes = new Set(rootPathNodes.slice(0, i));

        const spurEdgeFilter = (edge) => {
          if (!edge) return false;
          const id = getEdgeIdentifier(edge);
          if (disabledEdges.has(id)) return false;
          if (!edge.id && !edge._id && disabledEdges.has(`${edge.from}->${edge.to}`)) return false;
          if (options.edgeFilter && !options.edgeFilter(edge)) return false;
          return true;
        };

        const spurNodeFilter = (nodeId) => {
          if (disabledNodes.has(String(nodeId))) return false;
          if (options.nodeFilter && !options.nodeFilter(nodeId)) return false;
          return true;
        };

        // Chạy Dijkstra từ spurNode đến đích
        const spurPath = dijkstra(graph, spurNode, destinationNodeId, {
          metric: metric,
          getEdgeCost: getCost,
          onInvalidEdge: options.onInvalidEdge || 'clamp',
          assumeStringIds: options.assumeStringIds === true,
          edgeFilter: spurEdgeFilter,
          nodeFilter: spurNodeFilter,
          noCache: true,
          debug: false
        });
        dijkstraCalls++;

        if (spurPath.found && spurPath.nodes.length > 0) {
          const totalNodes = [...rootPathNodes.slice(0, -1), ...spurPath.nodes];
          const totalEdges = [...rootPathEdges, ...spurPath.edges];
          const totalCost = rootCost + spurPath.cost;

          let totalDistance = null;
          if (rootDistanceValid && spurPath.distance != null) {
            totalDistance = rootDistance + spurPath.distance;
          }

          const signature = _getRouteSignature(totalNodes, totalEdges);

          if (!seenSignatures.has(signature)) {
            let skipDueToOverlap = false;
            if (overlapThreshold !== null) {
              const tempCandidate = { nodes: totalNodes, edges: totalEdges };
              for (let aIdx = 0; aIdx < A.length; aIdx++) {
                if (calculateRouteOverlap(A[aIdx], tempCandidate) >= overlapThreshold) {
                  skipDueToOverlap = true;
                  break;
                }
              }
            }

            if (!skipDueToOverlap) {
              seenSignatures.add(signature);
              const candidate = {
                nodes: totalNodes,
                edges: totalEdges,
                cost: totalCost,
                distance: totalDistance,
                _sig: signature
              };

              // Thêm vào Min-Heap chính
              candidateHeap.push(candidate, totalCost);

              // Cập nhật Bounded Max-Heap trong O(log K)
              if (maxCandidatesHeap.size() < neededCandidates) {
                maxCandidatesHeap.push(candidate, totalCost);
              } else {
                const worst = maxCandidatesHeap.peek();
                if (candidateComparator({ priority: totalCost, item: candidate }, worst) < 0) {
                  maxCandidatesHeap.pop();
                  maxCandidatesHeap.push(candidate, totalCost);
                }
              }
            }
          }
        }
      }

      // Lấy ứng viên có chi phí tối ưu nhất từ Min-Heap
      let bestCandidate = null;
      while (!candidateHeap.isEmpty()) {
        const top = candidateHeap.pop();
        if (!top || !top.item) continue;
        const sig = top.item._sig || _getRouteSignature(top.item.nodes, top.item.edges);
        if (seenInA.has(sig)) continue;

        bestCandidate = top.item;
        seenInA.add(sig);
        break;
      }

      if (!bestCandidate) {
        break;
      }

      delete bestCandidate._sig;
      A.push(bestCandidate);
    }

    if (metrics) {
      metrics.dijkstraCalls = dijkstraCalls;
      metrics.prunedSpurNodes = prunedSpurNodes;
      metrics.totalCandidatesConsidered = seenSignatures.size;
    }

    return A;
  }

  /* ==========================================================================
     PHASE 8: SAFEROUTE ROUTE ADAPTER (LOCAL DIJKSTRA FALLBACK HELPER)
     ========================================================================== */

  /**
   * Chuyển đổi kết quả đường đi từ Dijkstra thành định dạng Route chuẩn của SafeRoute UI
   * @param {Object} dijkstraRoute Kết quả từ dijkstra hoặc kShortestPaths
   * @param {Object} graph Đồ thị nguồn
   * @param {number} [index=0] Chỉ số tuyến
   * @returns {Object} Đối tượng route tương thích với renderRoutes của SafeRoute
   */
  function routeToSafeRouteFormat(dijkstraRoute, graph, index = 0) {
    if (!dijkstraRoute || !dijkstraRoute.found || !dijkstraRoute.nodes) {
      return null;
    }

    const coords = [];
    const nodes = dijkstraRoute.nodes;

    for (let i = 0; i < nodes.length; i++) {
      const nId = nodes[i];
      let lat = null, lng = null;
      if (graph && typeof graph.getNode === 'function') {
        const n = graph.getNode(nId);
        if (n && typeof n.lat === 'number' && typeof n.lng === 'number') {
          lat = n.lat;
          lng = n.lng;
        }
      }
      if (lat === null && nId.includes(',')) {
        const parts = nId.split(':L')[0].split(',');
        lat = parseFloat(parts[0]);
        lng = parseFloat(parts[1]);
      }
      if (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng)) {
        coords.push([lat, lng]);
      }
    }

    const distKm = (typeof dijkstraRoute.distance === 'number')
      ? (dijkstraRoute.distance / 1000)
      : ((dijkstraRoute.cost || 0) / 1000);

    const durationMin = (typeof dijkstraRoute.cost === 'number')
      ? Math.max(1, Math.round(dijkstraRoute.cost / 60))
      : Math.max(1, Math.round((distKm / 35) * 60));

    return {
      id: String.fromCharCode(65 + index),
      routeIndex: index,
      coords: coords,
      distance: Math.max(0.1, distKm),
      duration: durationMin,
      riskScore: 0,
      legs: [],
      source: 'local_dijkstra'
    };
  }

  /* ==========================================================================
     EXPORTS & GLOBAL REGISTRATION
     ========================================================================== */

  const DijkstraCache = {
    clear: clearAllDijkstraCaches,
    getGraphCache: getGraphCache,
    LRU: DijkstraLRUCache,
    _costFunctionCache: _costFunctionCache
  };

  const DijkstraEngine = {
    PriorityQueue,
    DijkstraCache,
    dijkstra,
    bidirectionalDijkstra,
    kShortestPaths,
    createSafeRouteCostFunction,
    routeToSafeRouteFormat,
    getGraphOutgoingEdges,
    getGraphIncomingEdges,
    getEdgeIdentifier,
    calculateRouteOverlap,
    _costFunctionCache
  };

  if (typeof window !== 'undefined') {
    window.PriorityQueue = PriorityQueue;
    window.DijkstraCache = DijkstraCache;
    window.dijkstra = dijkstra;
    window.bidirectionalDijkstra = bidirectionalDijkstra;
    window.kShortestPaths = kShortestPaths;
    window.createSafeRouteCostFunction = createSafeRouteCostFunction;
    window.routeToSafeRouteFormat = routeToSafeRouteFormat;
    window.Dijkstra = DijkstraEngine;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DijkstraEngine;
  }

})();
