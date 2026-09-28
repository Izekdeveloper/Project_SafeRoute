/**
 * ============================================================================
 * SafeRoute Research Project: Independent Dijkstra & K-Shortest Paths Engine
 * File: js/dijkstra.js
 * 
 * Mục đích kiến trúc:
 * - Cung cấp thuật toán tìm đường ngắn nhất Dijkstra thuần túy (pure algorithm).
 * - Cung cấp thuật toán tìm K đường ngắn nhất (Yen's K-Shortest Paths Algorithm).
 * - Cấu trúc dữ liệu hàng đợi ưu tiên Binary Min-Heap (PriorityQueue) tối ưu O((V + E) log V).
 * - Candidate pool trong Yen sử dụng Binary Min-Heap (O(log |B|)) thay vì sort toàn bộ mảng.
 * - Tách biệt hoàn toàn `cost` (chi phí tối ưu) và `distance` (chiều dài vật lý thực).
 * - Hỗ trợ `edge.id` cho đồ thị có đa cạnh (parallel edges), fallback `from->to`.
 * - Hoàn toàn độc lập (stateless, generic, immutable):
 *   + KHÔNG phụ thuộc vào UI, DOM, Leaflet hay Map.
 *   + KHÔNG phụ thuộc vào OSRM hay network fetch.
 *   + KHÔNG phụ thuộc vào incidents, risk model hay safety scores.
 *   + KHÔNG phụ thuộc vào vehicle types (xe máy, ô tô, xe đạp).
 *   + KHÔNG làm biến đổi (mutate) hay clone graph đầu vào.
 *   + KHÔNG có tác dụng phụ (no side effects), không console spam trong production.
 * ============================================================================
 */

(function () {
  'use strict';

  /* ==========================================================================
     PHASE 1: PRIORITY QUEUE (BINARY MIN-HEAP)
     ========================================================================== */

  /**
   * Cấu trúc dữ liệu Binary Min-Heap phục vụ hàng đợi ưu tiên cho Dijkstra & Yen
   * Đạt độ phức tạp thời gian:
   * - push: O(log N)
   * - pop: O(log N)
   * - peek: O(1)
   * - size: O(1)
   */
  class PriorityQueue {
    /**
     * @param {Function} [comparator] Hàm so sánh 2 phần tử heap, mặc định so sánh .priority tăng dần
     */
    constructor(comparator = (a, b) => a.priority - b.priority) {
      this.heap = [];
      this.comparator = comparator;
    }

    /**
     * Thêm một phần tử vào hàng đợi ưu tiên
     * @param {any} item Dữ liệu (ví dụ nodeId hoặc candidate path)
     * @param {number} priority Độ ưu tiên (chi phí / khoảng cách, nhỏ hơn = ưu tiên hơn)
     */
    push(item, priority) {
      const entry = { item, priority };
      this.heap.push(entry);
      this._heapifyUp(this.heap.length - 1);
    }

    /**
     * Lấy và loại bỏ phần tử có độ ưu tiên nhỏ nhất (đỉnh min-heap)
     * @returns {{ item: any, priority: number }|null}
     */
    pop() {
      if (this.heap.length === 0) return null;
      const top = this.heap[0];
      const bottom = this.heap.pop();
      if (this.heap.length > 0) {
        this.heap[0] = bottom;
        this._heapifyDown(0);
      }
      return top;
    }

    /**
     * Xem phần tử đỉnh min-heap mà không loại bỏ
     * @returns {{ item: any, priority: number }|null}
     */
    peek() {
      return this.heap.length > 0 ? this.heap[0] : null;
    }

    /**
     * Số lượng phần tử trong heap
     * @returns {number}
     */
    size() {
      return this.heap.length;
    }

    /**
     * Kiểm tra heap có rỗng hay không
     * @returns {boolean}
     */
    isEmpty() {
      return this.heap.length === 0;
    }

    /**
     * Xóa sạch heap
     */
    clear() {
      this.heap.length = 0;
    }

    /**
     * Đẩy phần tử lên trên để duy trì thuộc tính min-heap
     * @private
     */
    _heapifyUp(index) {
      let currentIndex = index;
      while (currentIndex > 0) {
        const parentIndex = Math.floor((currentIndex - 1) / 2);
        if (this.comparator(this.heap[currentIndex], this.heap[parentIndex]) < 0) {
          this._swap(currentIndex, parentIndex);
          currentIndex = parentIndex;
        } else {
          break;
        }
      }
    }

    /**
     * Đẩy phần tử xuống dưới để duy trì thuộc tính min-heap
     * @private
     */
    _heapifyDown(index) {
      let currentIndex = index;
      const length = this.heap.length;

      while (true) {
        let smallest = currentIndex;
        const leftChild = 2 * currentIndex + 1;
        const rightChild = 2 * currentIndex + 2;

        if (leftChild < length && this.comparator(this.heap[leftChild], this.heap[smallest]) < 0) {
          smallest = leftChild;
        }
        if (rightChild < length && this.comparator(this.heap[rightChild], this.heap[smallest]) < 0) {
          smallest = rightChild;
        }

        if (smallest !== currentIndex) {
          this._swap(currentIndex, smallest);
          currentIndex = smallest;
        } else {
          break;
        }
      }
    }

    /**
     * Hoán đổi 2 vị trí trong mảng heap
     * @private
     */
    _swap(i, j) {
      const temp = this.heap[i];
      this.heap[i] = this.heap[j];
      this.heap[j] = temp;
    }
  }

  /* ==========================================================================
     PHASE 2 & 3: GRAPH ADAPTER & DIJKSTRA SHORTEST PATH ENGINE
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
   * Hỗ trợ đa dạng interface đồ thị:
   * - graph.getOutgoingEdges(nodeId)
   * - graph.getNeighbors(nodeId)
   * - graph.getNode(nodeId).edges / .neighbors
   * - graph.adjacencyList.get(nodeId)
   * - graph.edges[nodeId]
   * - graph.nodes[nodeId].edges / .neighbors
   * 
   * @param {Object} graph Đối tượng đồ thị
   * @param {string|number} nodeId ID nút cần lấy cạnh đi ra
   * @returns {Array<Object>} Danh sách các cạnh đi ra
   */
  function getGraphOutgoingEdges(graph, nodeId) {
    if (!graph || nodeId == null) return [];

    const idStr = String(nodeId);

    // 1. Interface getOutgoingEdges
    if (typeof graph.getOutgoingEdges === 'function') {
      const edges = graph.getOutgoingEdges(idStr);
      if (Array.isArray(edges)) return edges;
    }

    // 2. Interface getNeighbors (như trong Graph hiện tại của SafeRoute)
    if (typeof graph.getNeighbors === 'function') {
      const neighbors = graph.getNeighbors(idStr);
      if (Array.isArray(neighbors)) return neighbors;
    }

    // 3. Interface adjacency (Map hoặc Object)
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

    // 4. Interface getNode
    if (typeof graph.getNode === 'function') {
      const node = graph.getNode(idStr);
      if (node) {
        if (Array.isArray(node.edges)) return node.edges;
        if (Array.isArray(node.neighbors)) return node.neighbors;
      }
    }

    // 5. Direct dictionary access
    if (graph.edges && Array.isArray(graph.edges[idStr])) {
      return graph.edges[idStr];
    }
    if (graph.nodes && graph.nodes[idStr]) {
      const node = graph.nodes[idStr];
      if (Array.isArray(node.edges)) return node.edges;
      if (Array.isArray(node.neighbors)) return node.neighbors;
    }

    return [];
  }

  /**
   * Kiểm tra xem một node có tồn tại trong đồ thị hay không (nếu đồ thị hỗ trợ kiểm tra)
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
    // Nếu đồ thị không lưu node map rõ ràng, trả về null để kiểm tra qua outgoing edges
    return null;
  }

  /**
   * Trích xuất chi phí mặc định của một cạnh
   * Ưu tiên: edge.cost -> edge.distance -> edge.weight
   * @param {Object} edge
   * @returns {number}
   */
  function defaultGetEdgeCost(edge) {
    if (!edge) return Infinity;
    if (typeof edge.cost === 'number' && Number.isFinite(edge.cost)) return edge.cost;
    if (typeof edge.distance === 'number' && Number.isFinite(edge.distance)) return edge.distance;
    if (typeof edge.weight === 'number' && Number.isFinite(edge.weight)) return edge.weight;
    return Infinity;
  }

  /**
   * Thuật toán Dijkstra tìm đường ngắn nhất giữa 2 node trên đồ thị
   * Đảm bảo:
   * - O((V + E) log V) với Binary Min-Heap
   * - Tuyệt đối không làm thay đổi (mutate) graph hay edge
   * - Hoàn toàn stateless giữa các lần gọi
   * - Bắt lỗi chi phí âm (negative cost detection)
   * - Tách biệt rõ ràng cost và distance (distance = null nếu không có trường distance)
   * - Tái tạo chính xác đường đi: nodes, edges, cost, distance
   * 
   * @param {Object} graph Đối tượng đồ thị cung cấp giao diện truy vấn
   * @param {string|number} startNodeId Node xuất phát
   * @param {string|number} destinationNodeId Node đích
   * @param {Object} [options={}] Cấu hình tùy chọn
   * @param {Function} [options.getEdgeCost] Hàm tính chi phí cạnh (edge) => number
   * @param {Function} [options.edgeFilter] Hàm lọc cạnh (edge) => boolean (cho phép bỏ qua cạnh mà không mutate graph)
   * @param {Function} [options.nodeFilter] Hàm lọc node (nodeId) => boolean (cho phép bỏ qua node mà không mutate graph)
   * @param {boolean} [options.debug=false] Bật ghi log debug (mặc định false)
   * @returns {{ found: boolean, cost: number, distance: number|null, nodes: Array<string>, edges: Array<Object> }}
   */
  function dijkstra(graph, startNodeId, destinationNodeId, options = {}) {
    const isDebug = options.debug === true;

    // 1. Kiểm tra tính hợp lệ của tham số đầu vào
    if (!graph || startNodeId == null || destinationNodeId == null) {
      if (isDebug && typeof console !== 'undefined') {
        console.warn('[Dijkstra] Invalid graph or start/dest parameters.');
      }
      return {
        found: false,
        cost: Infinity,
        distance: null,
        nodes: [],
        edges: []
      };
    }

    const startId = String(startNodeId);
    const destId = String(destinationNodeId);

    // Kiểm tra xem node có tồn tại trong graph hay không (nếu đồ thị có metadata node)
    const startExists = checkNodeExistsInGraph(graph, startId);
    const destExists = checkNodeExistsInGraph(graph, destId);

    if (startExists === false || destExists === false) {
      if (isDebug && typeof console !== 'undefined') {
        console.warn(`[Dijkstra] Start node (${startId}) or destination node (${destId}) does not exist in graph.`);
      }
      return {
        found: false,
        cost: Infinity,
        distance: null,
        nodes: [],
        edges: []
      };
    }

    const getCost = typeof options.getEdgeCost === 'function' ? options.getEdgeCost : defaultGetEdgeCost;
    const edgeFilter = typeof options.edgeFilter === 'function' ? options.edgeFilter : null;
    const nodeFilter = typeof options.nodeFilter === 'function' ? options.nodeFilter : null;

    // Kiểm tra nodeFilter nếu có cho start hoặc dest
    if (nodeFilter) {
      if (!nodeFilter(startId) || !nodeFilter(destId)) {
        return {
          found: false,
          cost: Infinity,
          distance: null,
          nodes: [],
          edges: []
        };
      }
    }

    // 2. Trường hợp đặc biệt: Điểm xuất phát trùng với điểm đích
    if (startId === destId) {
      return {
        found: true,
        cost: 0,
        distance: 0,
        nodes: [startId],
        edges: []
      };
    }

    // 3. Khởi tạo trạng thái thuật toán (State hoàn toàn nằm ngoài graph)
    const distances = new Map();
    const previous = new Map();    // nodeId -> { node: prevNodeId, edge: edgeObj }
    const pq = new PriorityQueue();

    distances.set(startId, 0);
    pq.push(startId, 0);

    let destinationFound = false;

    // 4. Vòng lặp chính của Dijkstra
    while (!pq.isEmpty()) {
      const entry = pq.pop();
      const u = entry.item;
      const currentDist = entry.priority;

      // Stale entry check: Nếu khoảng cách lấy ra từ heap lớn hơn khoảng cách ngắn nhất đã ghi nhận -> bỏ qua
      const recordedDist = distances.get(u);
      if (recordedDist != null && currentDist > recordedDist) {
        continue;
      }

      // Đã chạm đến đích -> dừng sớm (early termination) vì đây chắc chắn là đường đi ngắn nhất
      if (u === destId) {
        destinationFound = true;
        break;
      }

      // Lấy danh sách cạnh đi ra từ node u
      const outgoingEdges = getGraphOutgoingEdges(graph, u);

      for (let i = 0; i < outgoingEdges.length; i++) {
        const edge = outgoingEdges[i];
        if (!edge || edge.to == null) continue;

        const v = String(edge.to);

        // Áp dụng bộ lọc node (cho thuật toán Yen hoặc ràng buộc khác)
        if (nodeFilter && !nodeFilter(v)) {
          continue;
        }

        // Áp dụng bộ lọc edge (cho thuật toán Yen hoặc tạm vô hiệu hóa cạnh)
        if (edgeFilter && !edgeFilter(edge)) {
          continue;
        }

        // Tính chi phí cạnh
        const edgeCost = getCost(edge);

        // Bắt lỗi chi phí không hợp lệ
        if (typeof edgeCost !== 'number' || Number.isNaN(edgeCost)) {
          continue;
        }
        if (edgeCost < 0) {
          throw new Error(`[Dijkstra] Phát hiện trọng số cạnh âm: cost = ${edgeCost} trên cạnh (${edge.from || u} -> ${v}). Thuật toán Dijkstra không hỗ trợ chi phí âm.`);
        }
        if (!Number.isFinite(edgeCost)) {
          // Bỏ qua cạnh có chi phí vô cực (Infinity)
          continue;
        }

        const altDist = currentDist + edgeCost;
        const currentBestV = distances.has(v) ? distances.get(v) : Infinity;

        // Thả lỏng cạnh (Edge Relaxation)
        if (altDist < currentBestV) {
          distances.set(v, altDist);
          previous.set(v, { node: u, edge: edge });
          pq.push(v, altDist);
        }
      }
    }

    // 5. Nếu không tới được điểm đích (unreachable / disconnected)
    if (!destinationFound && (!distances.has(destId) || distances.get(destId) === Infinity)) {
      return {
        found: false,
        cost: Infinity,
        distance: null,
        nodes: [],
        edges: []
      };
    }

    // 6. Tái tạo đường đi (Path Reconstruction)
    const pathNodes = [];
    const pathEdges = [];
    let curr = destId;

    while (curr !== startId) {
      pathNodes.push(curr);
      const step = previous.get(curr);
      if (!step) {
        // Phòng hộ: Không thể lần ngược về start (đồ thị không liên thông)
        return {
          found: false,
          cost: Infinity,
          distance: null,
          nodes: [],
          edges: []
        };
      }
      pathEdges.push(step.edge);
      curr = step.node;
    }

    pathNodes.push(startId);

    // Đảo chiều mảng để có thứ tự từ start -> destination
    pathNodes.reverse();
    pathEdges.reverse();

    const totalCost = distances.get(destId) || 0;

    // Tách riêng tính toán chiều dài vật lý (distance)
    // Nếu TẤT CẢ các cạnh đều có trường distance hợp lệ -> tính tổng distance
    // Nếu có cạnh thiếu distance -> đánh dấu distance = null (không giả mạo distance = cost)
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

    return {
      found: true,
      cost: totalCost,
      distance: hasValidDistance ? totalDistance : null,
      nodes: pathNodes,
      edges: pathEdges
    };
  }

  /* ==========================================================================
     PHASE 4 & 5: K-SHORTEST PATHS ENGINE (YEN'S ALGORITHM VỚI MIN-HEAP)
     ========================================================================== */

  /**
   * Tạo chuỗi chữ ký (signature) cho một chuỗi node để kiểm tra trùng lặp đường đi
   * @param {Array<string>} nodes
   * @returns {string}
   */
  function _getNodeSequenceKey(nodes) {
    return (nodes || []).join('->');
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
   * Thuật toán Yen's K-Shortest Paths:
   * Tìm K tuyến đường ngắn nhất không có chu trình (loopless) giữa 2 node trên đồ thị.
   * 
   * Tối ưu hóa:
   * - Sử dụng Binary Min-Heap cho Candidate Pool B (O(log |B|)) thay vì sort toàn bộ mảng.
   * - Hỗ trợ edge.id để nhận diện chính xác cạnh cần vô hiệu hóa, hỗ trợ đa cạnh (parallel edges).
   * - Tách biệt cost và distance hoàn toàn.
   * - Tuyệt đối không clone hay mutate đồ thị gốc.
   * 
   * @param {Object} graph Đối tượng đồ thị
   * @param {string|number} startNodeId Node xuất phát
   * @param {string|number} destinationNodeId Node đích
   * @param {number} [K=3] Số lượng tuyến đường ngắn nhất cần tìm (mặc định 3)
   * @param {Object} [options={}] Cấu hình tùy chọn
   * @param {Function} [options.getEdgeCost] Hàm tính chi phí cạnh
   * @param {number} [options.routeOverlapThreshold] Ngưỡng lọc trùng lặp tùy chọn [0, 1] (mặc định null = không lọc loại bỏ)
   * @param {boolean} [options.debug=false] Bật ghi log debug
   * @returns {Array<{ nodes: Array<string>, edges: Array<Object>, cost: number, distance: number|null }>}
   */
  function kShortestPaths(graph, startNodeId, destinationNodeId, K = 3, options = {}) {
    const kTarget = Math.max(1, Number(K) || 3);

    // 1. Tìm tuyến ngắn nhất đầu tiên A[0]
    const initialRoute = dijkstra(graph, startNodeId, destinationNodeId, options);

    if (!initialRoute.found || initialRoute.nodes.length === 0) {
      return [];
    }

    /** @type {Array<{ nodes: Array<string>, edges: Array<Object>, cost: number, distance: number|null }>} */
    const A = [initialRoute];
    const initialSig = _getNodeSequenceKey(initialRoute.nodes);
    const seenSignatures = new Set([initialSig]);
    const seenInA = new Set([initialSig]);

    // Comparator cho Candidate Min-Heap:
    // 1. Ưu tiên chi phí nhỏ hơn (cost)
    // 2. Tie-breaker 1: Chiều dài vật lý (distance) nếu có
    // 3. Tie-breaker 2: Chuỗi chữ ký node (tính tất định, deterministic)
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

    /**
     * Candidate Pool B được quản lý bằng Binary Min-Heap (O(log |B|))
     */
    const candidateHeap = new PriorityQueue(candidateComparator);

    const getCost = typeof options.getEdgeCost === 'function' ? options.getEdgeCost : defaultGetEdgeCost;
    const overlapThreshold = (typeof options.routeOverlapThreshold === 'number' && options.routeOverlapThreshold > 0 && options.routeOverlapThreshold <= 1)
      ? options.routeOverlapThreshold
      : null;

    // 2. Vòng lặp tìm K - 1 tuyến ngắn tiếp theo
    for (let k = 1; k < kTarget; k++) {
      const prevPath = A[k - 1];
      if (!prevPath || prevPath.nodes.length < 2) break;

      // Tiền tính toán mảng cộng dồn Prefix Cost và Prefix Distance (O(N) một lần thay vì O(N^2) mỗi spur node)
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

      // Duyệt qua từng node trên prevPath làm spurNode (từ đầu đến kế cuối)
      for (let i = 0; i < prevPath.nodes.length - 1; i++) {
        const spurNode = prevPath.nodes[i];
        const rootPathNodes = prevPath.nodes.slice(0, i + 1);
        const rootPathEdges = prevPath.edges.slice(0, i);

        // Truy xuất chi phí và khoảng cách của rootPath trong O(1)
        const rootCost = prefixCost[i];
        const rootDistance = prefixDistance[i];
        const rootDistanceValid = (rootDistance !== null);

        // Tập các cạnh bị loại trừ khỏi spurNode để không lặp lại tuyến đã có trong A
        // Hỗ trợ cả edge.id và fallback from->to
        const disabledEdges = new Set();
        const rootSig = _getNodeSequenceKey(rootPathNodes);

        for (let aIdx = 0; aIdx < A.length; aIdx++) {
          const p = A[aIdx];
          if (p.nodes.length > i && _getNodeSequenceKey(p.nodes.slice(0, i + 1)) === rootSig) {
            const nextEdge = p.edges[i];
            if (nextEdge) {
              disabledEdges.add(getEdgeIdentifier(nextEdge));
              disabledEdges.add(`${nextEdge.from}->${nextEdge.to}`);
            }
          }
        }

        // Tập các node bị loại trừ (tất cả các node trong rootPath ngoại trừ spurNode để chống loop)
        const disabledNodes = new Set(rootPathNodes.slice(0, i));

        // Hàm lọc cạnh và node cho Dijkstra tại chặng spur mà không mutate graph
        const spurEdgeFilter = (edge) => {
          if (!edge) return false;
          const id = getEdgeIdentifier(edge);
          if (disabledEdges.has(id)) return false;
          if (disabledEdges.has(`${edge.from}->${edge.to}`)) return false;
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
          getEdgeCost: getCost,
          edgeFilter: spurEdgeFilter,
          nodeFilter: spurNodeFilter,
          debug: false
        });

        // Nếu tìm thấy spurPath hợp lệ -> Ghép rootPath + spurPath thành candidatePath
        if (spurPath.found && spurPath.nodes.length > 0) {
          const totalNodes = [...rootPathNodes.slice(0, -1), ...spurPath.nodes];
          const totalEdges = [...rootPathEdges, ...spurPath.edges];
          const totalCost = rootCost + spurPath.cost;

          let totalDistance = null;
          if (rootDistanceValid && spurPath.distance != null) {
            totalDistance = rootDistance + spurPath.distance;
          }

          const signature = _getNodeSequenceKey(totalNodes);

          // Chỉ thêm vào pool B nếu chưa từng xuất hiện
          if (!seenSignatures.has(signature)) {
            // Kiểm tra tùy chọn overlap threshold nếu được cấu hình
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
              // Thêm ứng viên vào Min-Heap với độ phức tạp O(log |B|)
              candidateHeap.push(candidate, totalCost);
            }
          }
        }
      }

      // Lấy ứng viên có chi phí tối ưu nhất từ Min-Heap
      let bestCandidate = null;
      while (!candidateHeap.isEmpty()) {
        const top = candidateHeap.pop();
        if (!top || !top.item) continue;
        const sig = top.item._sig || _getNodeSequenceKey(top.item.nodes);
        if (seenInA.has(sig)) continue;

        bestCandidate = top.item;
        seenInA.add(sig);
        break;
      }

      // Nếu không còn tuyến ứng viên nào trong Heap -> dừng sớm
      if (!bestCandidate) {
        break;
      }

      // Loại bỏ thuộc tính tạm _sig trước khi đưa vào A
      delete bestCandidate._sig;
      A.push(bestCandidate);
    }

    return A;
  }

  /* ==========================================================================
     EXPORTS & GLOBAL REGISTRATION
     ========================================================================== */

  const DijkstraEngine = {
    PriorityQueue,
    dijkstra,
    kShortestPaths,
    getGraphOutgoingEdges,
    getEdgeIdentifier,
    calculateRouteOverlap
  };

  // Môi trường trình duyệt (Browser)
  if (typeof window !== 'undefined') {
    window.PriorityQueue = PriorityQueue;
    window.dijkstra = dijkstra;
    window.kShortestPaths = kShortestPaths;
    window.Dijkstra = DijkstraEngine;
  }

  // Môi trường Node.js / CommonJS
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DijkstraEngine;
  }

})();

