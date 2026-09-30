/**
 * ============================================================================
 * SafeRoute Research Project: Dynamic Weighted Graph Architecture
 * File: js/graph.js
 * 
 * Mục đích nghiên cứu:
 * Module này định nghĩa cấu trúc dữ liệu đồ thị có hướng G = (V, E) làm nền tảng
 * cho bài toán tìm đường đa mục tiêu (Multi-Objective Shortest Path). Thay vì phụ
 * thuộc vào các tập polyline định tuyến đóng gói sẵn từ Google Routes API hoặc OSRM,
 * cấu trúc đồ thị tường minh cho phép can thiệp trực tiếp vào từng cạnh (edge)
 * để gán trọng số động theo rủi ro thời gian thực (real-time dynamic risk weight)
 * và đảm bảo tính chứng minh được (provable optimality) của thuật toán Dijkstra.
 * 
 * Tài liệu tham khảo:
 * - Dijkstra, E. W. (1959). "A note on two problems in connexion with graphs".
 * - OpenStreetMap Overpass API Documentation (Overpass QL specification).
 * - Boeing, G. (2017). "OSMnx: New methods for acquiring, constructing, analyzing,
 *   and visualizing complex street networks". Computers, Environment and Urban Systems.
 * ============================================================================
 */

/**
 * Bảng quy đổi tốc độ lưu thông tự do mặc định (Free-flow speed profile) theo phân loại đường OSM.
 * Đơn vị: km/h (sẽ được đổi sang m/s khi tính freeflow_time).
 * Ghi chú nghiên cứu: Các giá trị này phản ánh vận tốc thiết kế và thực tế đô thị tại Việt Nam,
 * sẽ được hiệu chỉnh chính xác hơn khi có dữ liệu GPS probe / Floating Car Data thực nghiệm.
 */
const DEFAULT_SPEED_PROFILE_KMH = {
  motorway: 80,
  motorway_link: 50,
  trunk: 60,
  trunk_link: 40,
  primary: 45,
  primary_link: 35,
  secondary: 35,
  secondary_link: 25,
  tertiary: 30,
  tertiary_link: 20,
  unclassified: 25,
  residential: 20,
  living_street: 15,
  service: 15,
  default: 25
};

/**
 * Tính khoảng cách trắc địa đường tròn lớn (Great-Circle Distance) theo công thức Haversine.
 * 
 * @param {number} lat1 - Vĩ độ điểm 1 (degrees)
 * @param {number} lng1 - Kinh độ điểm 1 (degrees)
 * @param {number} lat2 - Vĩ độ điểm 2 (degrees)
 * @param {number} lng2 - Kinh độ điểm 2 (degrees)
 * @returns {number} Khoảng cách tính bằng mét (m)
 * @complexity O(1) thời gian, O(1) bộ nhớ
 */
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Bán kính trung bình Trái Đất (WGS84 spherical approximation)
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Sinh định danh thống nhất cho node từ tọa độ WGS84 làm tròn 5 chữ số thập phân.
 * Độ chính xác 5 chữ số thập phân tương đương sai số ~1.1m ở xích đạo.
 * 
 * @param {number} lat - Vĩ độ
 * @param {number} lng - Kinh độ
 * @param {Object} [options={}] - Tuỳ chọn { layer, osmWayId, roadId }
 * @returns {string} Chuỗi ID duy nhất dạng "vĩ độ,kinh độ"
 */
function coordToNodeId(lat, lng, options = {}) {
  const base = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
  if (options.layer != null && Number(options.layer) !== 0) {
    return `${base}:L${options.layer}`;
  }
  return base;
}

/**
 * Kiểm tra chế độ debug routing
 */
function _isDebugRouting() {
  return (typeof window !== 'undefined' && window.DEBUG_ROUTING != null)
    ? window.DEBUG_ROUTING === true
    : (typeof CONFIG !== 'undefined' && CONFIG.debug_routing === true);
}

/**
 * Trích xuất và chuẩn hóa tên đường (bỏ tiền tố Đường, Phố, dấu tiếng Việt)
 */
function extractStreetName(rawName) {
  if (!rawName) return '';
  const s = String(rawName).trim();
  if (/^[\d\s.,;:\-+]+$/.test(s) && /\d/.test(s)) return '';
  const clean = s.split(',')[0].trim().replace(/^(đường|phố|hẻm|ngõ|đoạn\s+đường|street|avenue|road)\s+/i, '');
  return (/^[\d\s.,;:\-+]+$/.test(clean) && /\d/.test(clean)) ? '' : clean.trim();
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
 * Chiếu một điểm p = [lat, lng] vuông góc lên đoạn thẳng [p1, p2]
 * Trả về { pt: [lat, lng], t: number } với t in [0, 1]
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
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return {
    pt: [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])],
    t: t
  };
}

/**
 * Kiểm tra xem 2 node có đủ điều kiện để gộp (merge) hay không dựa trên cả hình học và topology:
 * QUY TẮC BẮT BUỘC:
 * 1. Khoảng cách (distance) chỉ là điều kiện cần để tìm candidate, KHÔNG PHẢI điều kiện đủ.
 * 2. ƯU TIÊN: TOPOLOGY > ROAD/SEGMENT ID > EDGE RELATIONSHIP > LAYER/ELEVATION > GEOMETRY > DISTANCE.
 * 3. Nếu không chứng minh được hai node thuộc cùng topology: -> TUYỆT ĐỐI KHÔNG MERGE.
 * 4. Thà tạo dư một node riêng biệt còn hơn gộp nhầm 2 con đường khác nhau.
 * 
 * @param {Object} nodeA - Node thứ nhất { id, lat, lng, roadId, osmWayId, roadName, edgeId, segmentId, layer, elevation, bridge, tunnel, bearing, isIntersection }
 * @param {Object} nodeB - Node thứ hai
 * @param {Object} [context={}] - Ngữ cảnh { maxDistance, isIntersection, debug }
 * @returns {boolean} true nếu an toàn và hợp lệ để gộp, false nếu khác topology
 */
function canMergeNodes(nodeA, nodeB, context = {}) {
  if (!nodeA || !nodeB) return false;
  if (nodeA === nodeB || nodeA.id === nodeB.id) return false;

  const isDebug = (typeof context.debug === 'boolean')
    ? context.debug
    : _isDebugRouting();

  const logDecision = (result, reason, details = {}) => {
    if (isDebug && typeof console !== 'undefined' && console.debug) {
      console.debug('[Graph Merge]', {
        candidate: `${nodeA.id} -> ${nodeB.id}`,
        distance: details.distance != null ? `${Number(details.distance).toFixed(1)}m` : 'N/A',
        sameRoad: Boolean(details.sameRoad),
        sameSegment: Boolean(details.sameSegment),
        sameEdge: Boolean(details.sameEdge),
        sameLayer: details.sameLayer !== false,
        result: result ? 'MERGE' : 'REJECT',
        reason: reason
      });
    }
  };

  // 1. KIỂM TRA HÌNH HỌC KHOẢNG CÁCH (DISTANCE CHECK - Điều kiện cần)
  const dist = haversineDistanceMeters(nodeA.lat, nodeA.lng, nodeB.lat, nodeB.lng);
  const maxDistance = (typeof context.maxDistance === 'number') ? context.maxDistance : 15; // mặc định 15m
  if (dist > maxDistance) {
    logDecision(false, 'DISTANCE_EXCEEDED', { distance: dist });
    return false;
  }

  // 2. KIỂM TRA TẦNG / CAO ĐỘ (LAYER / ELEVATION / BRIDGE / TUNNEL CHECK)
  // Hai đường khác tầng (cầu vượt, hầm chui, layer) TUYỆT ĐỐI KHÔNG MERGE
  const layerA = nodeA.layer != null ? Number(nodeA.layer) : (context.layerA != null ? Number(context.layerA) : 0);
  const layerB = nodeB.layer != null ? Number(nodeB.layer) : (context.layerB != null ? Number(context.layerB) : 0);
  if (layerA !== layerB) {
    logDecision(false, 'DIFFERENT_LAYER', { distance: dist, sameLayer: false });
    return false;
  }

  if (nodeA.elevation != null && nodeB.elevation != null) {
    if (Math.abs(nodeA.elevation - nodeB.elevation) > 3) {
      logDecision(false, 'DIFFERENT_ELEVATION', { distance: dist, sameLayer: false });
      return false;
    }
  }

  if ((nodeA.bridge || nodeB.bridge) && nodeA.bridge !== nodeB.bridge) {
    logDecision(false, 'BRIDGE_MISMATCH', { distance: dist, sameLayer: false });
    return false;
  }
  if ((nodeA.tunnel || nodeB.tunnel) && nodeA.tunnel !== nodeB.tunnel) {
    logDecision(false, 'TUNNEL_MISMATCH', { distance: dist, sameLayer: false });
    return false;
  }

  // 3. KIỂM TRA GIAO LỘ HỢP LỆ (INTERSECTION VALIDATION)
  // Nếu road network xác định rõ ràng đây là giao điểm (intersection) giữa 2 tuyến đường
  const isIntersection = Boolean(
    context.isIntersection ||
    nodeA.isIntersection ||
    nodeB.isIntersection ||
    (nodeA.intersectionNodeId && nodeB.intersectionNodeId && nodeA.intersectionNodeId === nodeB.intersectionNodeId)
  );

  // 4. KIỂM TRA ĐỒNG NHẤT TOPOLOGY (ROAD / SEGMENT / EDGE CHECK)
  const normA = nodeA.normalizedStreet || (nodeA.roadName ? normalizeStreetName(nodeA.roadName) : '');
  const normB = nodeB.normalizedStreet || (nodeB.roadName ? normalizeStreetName(nodeB.roadName) : '');

  const hasWayA = Boolean(nodeA.osmWayId);
  const hasWayB = Boolean(nodeB.osmWayId);
  const sameOsmWay = hasWayA && hasWayB && String(nodeA.osmWayId) === String(nodeB.osmWayId);

  const hasRoadIdA = Boolean(nodeA.roadId);
  const hasRoadIdB = Boolean(nodeB.roadId);
  const sameRoadId = hasRoadIdA && hasRoadIdB && String(nodeA.roadId) === String(nodeB.roadId);

  const hasEdgeA = Boolean(nodeA.edgeId);
  const hasEdgeB = Boolean(nodeB.edgeId);
  const sameEdge = hasEdgeA && hasEdgeB && String(nodeA.edgeId) === String(nodeB.edgeId);

  const hasSegA = nodeA.segmentId != null;
  const hasSegB = nodeB.segmentId != null;
  const sameSegment = hasSegA && hasSegB && String(nodeA.segmentId) === String(nodeB.segmentId);

  const bothHaveNames = Boolean(normA && normB);
  const sameRoadName = bothHaveNames && (normA === normB);

  // Nếu khác tên đường và không phải là giao lộ được chỉ định -> TUYỆT ĐỐI KHÔNG MERGE
  if (bothHaveNames && normA !== normB && !isIntersection) {
    logDecision(false, 'DIFFERENT_ROAD_NAME', { distance: dist, sameRoad: false, sameSegment, sameEdge });
    return false;
  }

  // Nếu khác osmWayId và không phải giao lộ -> TUYỆT ĐỐI KHÔNG MERGE
  if (hasWayA && hasWayB && !sameOsmWay && !isIntersection) {
    // Nếu cùng tên đường: chỉ cho phép merge nếu là 2 way liên tiếp cùng hướng (angleDiff <= 35)
    if (sameRoadName) {
      if (nodeA.bearing != null && nodeB.bearing != null) {
        const angleDiff = bearingAngleDiff(nodeA.bearing, nodeB.bearing);
        if (angleDiff > 35) {
          logDecision(false, 'DIFFERENT_WAY_ANGLE_MISMATCH', { distance: dist, sameRoad: true, sameSegment, sameEdge });
          return false;
        }
      }
    } else {
      logDecision(false, 'DIFFERENT_OSM_WAY', { distance: dist, sameRoad: false, sameSegment, sameEdge });
      return false;
    }
  }

  // Nếu khác roadId và không phải giao lộ -> TUYỆT ĐỐI KHÔNG MERGE
  if (hasRoadIdA && hasRoadIdB && !sameRoadId && !isIntersection) {
    logDecision(false, 'DIFFERENT_ROAD_ID', { distance: dist, sameRoad: false, sameSegment, sameEdge });
    return false;
  }

  // 5. KIỂM TRA HƯỚNG / BEARING NẾU CÓ (DIRECTION / GEOMETRY CHECK)
  if (nodeA.bearing != null && nodeB.bearing != null && !isIntersection) {
    const angleDiff = bearingAngleDiff(nodeA.bearing, nodeB.bearing);
    // Nếu góc lệch > 45° (ví dụ 2 đường cắt nhau góc 90° hoặc đường rẽ nhánh) -> KHÔNG MERGE
    if (angleDiff > 45) {
      logDecision(false, 'ANGLE_MISMATCH', { distance: dist, sameRoad: sameRoadName || sameOsmWay, sameSegment, sameEdge });
      return false;
    }
  }

  // 6. NGUYÊN TẮC CHỨNG MINH TÍCH CỰC (POSITIVE PROOF REQUIREMENT)
  // Nếu không có bất kỳ thông tin nào để chứng minh thuộc cùng 1 topology:
  const isProvenSameTopology = sameOsmWay || sameRoadId || sameEdge || sameSegment || sameRoadName || isIntersection;
  if (!isProvenSameTopology) {
    // Thà tạo dư một node còn hơn gộp nhầm 2 road khác nhau!
    if (dist > 0.5) {
      logDecision(false, 'UNPROVEN_TOPOLOGY', { distance: dist, sameRoad: false, sameSegment: false, sameEdge: false });
      return false;
    }
  }

  // ĐÃ THỎA MÃN ĐẦY ĐỦ CÁC ĐIỀU KIỆN AN TOÀN VÀ TOPOLOGY
  logDecision(true, 'SAFE_TO_MERGE', {
    distance: dist,
    sameRoad: sameRoadName || sameOsmWay || sameRoadId,
    sameSegment,
    sameEdge
  });
  return true;
}

/**
 * Cấu trúc dữ liệu Đồ thị có hướng (Directed Graph) G = (V, E)
 * sử dụng danh sách kề (Adjacency List) để tối ưu hiệu năng duyệt cạnh.
 */
class Graph {
  /**
   * Khởi tạo đồ thị rỗng hoặc nhận danh sách nodes và edges ban đầu.
   * 
   * @param {Array<Object>} [nodes=[]] - Danh sách node ban đầu
   * @param {Array<Object>} [edges=[]] - Danh sách cạnh ban đầu
   */
  constructor(nodes = [], edges = []) {
    /** @type {Map<string, Object>} */
    this.nodes = new Map();

    /** @type {Map<string, Array<Object>>} */
    this.adjacency = new Map();

    /** @type {Map<string, Array<Object>>} */
    this.incoming = new Map();

    /** @type {Map<string, Object>} */
    this.edges = new Map();

    /** @type {Map<string, Set<string>>} Spatial Grid (cellSize = 0.0005° ~55m) */
    this.spatialGrid = new Map();

    /** @type {number} */
    this.edgeCount = 0;

    // Nạp dữ liệu ban đầu nếu có
    for (const node of nodes) {
      this.addNode(node);
    }
    for (const edge of edges) {
      this.addEdge(edge);
    }
  }

  _getGridKey(lat, lng, cellSize = 0.0005) {
    const gx = Math.floor(lng / cellSize);
    const gy = Math.floor(lat / cellSize);
    return `${gx},${gy}`;
  }

  /**
   * Thêm một node vào đồ thị với đầy đủ thuộc tính topology.
   * 
   * @param {Object} node - Thông tin nút giao
   * @param {string} node.id - Định danh nút
   * @param {number} node.lat - Vĩ độ WGS84
   * @param {number} node.lng - Kinh độ WGS84
   * @complexity O(1) amortized
   */
  addNode(node) {
    if (!node || typeof node.id === 'undefined') return;
    const id = String(node.id);
    if (!this.nodes.has(id)) {
      const cleanNode = {
        id: id,
        lat: Number(node.lat),
        lng: Number(node.lng),
        roadId: node.roadId || null,
        osmWayId: node.osmWayId || null,
        roadName: node.roadName || '',
        normalizedStreet: node.normalizedStreet || (node.roadName ? normalizeStreetName(node.roadName) : ''),
        edgeId: node.edgeId || null,
        segmentId: node.segmentId != null ? node.segmentId : null,
        layer: node.layer != null ? Number(node.layer) : 0,
        elevation: node.elevation != null ? Number(node.elevation) : null,
        bridge: Boolean(node.bridge),
        tunnel: Boolean(node.tunnel),
        bearing: node.bearing != null ? Number(node.bearing) : null,
        isIntersection: Boolean(node.isIntersection),
        metadata: node.metadata || {}
      };
      this.nodes.set(id, cleanNode);
      if (!this.adjacency.has(id)) {
        this.adjacency.set(id, []);
      }
      if (!this.incoming.has(id)) {
        this.incoming.set(id, []);
      }

      const gKey = this._getGridKey(cleanNode.lat, cleanNode.lng);
      if (!this.spatialGrid.has(gKey)) {
        this.spatialGrid.set(gKey, new Set());
      }
      this.spatialGrid.get(gKey).add(id);
    }
  }

  /**
   * Thêm một cạnh có hướng từ node `from` đến node `to`.
   * 
   * @param {Object} edge - Thông tin đoạn đường
   * @param {string} edge.from - Node xuất phát
   * @param {string} edge.to - Node đích đến
   * @param {number} edge.distance - Chiều dài hình học (mét)
   * @param {number} [edge.freeflow_time] - Thời gian tự do (giây)
   * @param {string} [edge.road_class='residential'] - Loại đường OSM
   * @param {Array<string>} [edge.incident_ids=[]] - Danh sách ID các sự cố liên quan
   * @complexity O(1) amortized
   */
  addEdge(edge) {
    if (!edge || !edge.from || !edge.to) return;
    const fromId = String(edge.from);
    const toId = String(edge.to);

    if (!this.adjacency.has(fromId)) {
      this.adjacency.set(fromId, []);
    }
    if (!this.incoming.has(toId)) {
      this.incoming.set(toId, []);
    }

    const roadClass = edge.road_class || 'default';
    const distance = Number(edge.distance) || 0;
    
    let freeflowTime = edge.freeflow_time;
    if (typeof freeflowTime !== 'number' || freeflowTime <= 0) {
      const speedKmh = DEFAULT_SPEED_PROFILE_KMH[roadClass] || DEFAULT_SPEED_PROFILE_KMH.default;
      const speedMs = speedKmh / 3.6;
      freeflowTime = distance > 0 ? (distance / speedMs) : 1;
    }

    const edgeId = edge.id ? String(edge.id) : `${fromId}->${toId}#${this.edgeCount}`;

    const cleanEdge = {
      id: edgeId,
      from: fromId,
      to: toId,
      distance: distance,
      freeflow_time: Math.max(0.1, Number(freeflowTime)),
      road_class: roadClass,
      roadName: edge.roadName || '',
      osmWayId: edge.osmWayId || null,
      roadId: edge.roadId || null,
      layer: edge.layer != null ? Number(edge.layer) : 0,
      bearing: edge.bearing != null ? Number(edge.bearing) : null,
      geometry: Array.isArray(edge.geometry) ? edge.geometry : null,
      incident_ids: Array.isArray(edge.incident_ids) ? [...edge.incident_ids] : []
    };

    this.edges.set(edgeId, cleanEdge);
    this.adjacency.get(fromId).push(cleanEdge);
    this.incoming.get(toId).push(cleanEdge);
    this.edgeCount++;
    return cleanEdge;
  }

  /**
   * Kiểm tra sự tồn tại của một node
   */
  hasNode(nodeId) {
    return this.nodes.has(String(nodeId));
  }

  /**
   * Lấy thông tin chi tiết của một node.
   */
  getNode(nodeId) {
    return this.nodes.get(String(nodeId)) || null;
  }

  /**
   * Lấy thông tin chi tiết của một cạnh.
   */
  getEdge(edgeId) {
    return this.edges.get(String(edgeId)) || null;
  }

  /**
   * Lấy danh sách các cạnh đi ra từ một nút giao (Outgoing Edges).
   */
  getNeighbors(nodeId) {
    return this.adjacency.get(String(nodeId)) || [];
  }

  getOutgoingEdges(nodeId) {
    return this.getNeighbors(nodeId);
  }

  /**
   * Lấy danh sách các cạnh đi vào một nút giao (Incoming Edges).
   */
  getIncomingEdges(nodeId) {
    return this.incoming.get(String(nodeId)) || [];
  }

  /**
   * Tìm nút giao trên đồ thị gần một tọa độ bất kỳ nhất.
   */
  findNearestNode(lat, lng) {
    let nearest = null;
    let minDistance = Infinity;

    for (const node of this.nodes.values()) {
      const d = haversineDistanceMeters(lat, lng, node.lat, node.lng);
      if (d < minDistance) {
        minDistance = d;
        nearest = node;
      }
    }

    return nearest ? { node: nearest, distance: minDistance } : null;
  }

  /**
   * Kiểm tra khả năng gộp 2 node qua hàm canMergeNodes chuẩn.
   */
  canMergeNodes(nodeA, nodeB, context = {}) {
    return canMergeNodes(nodeA, nodeB, context);
  }

  /**
   * Tìm các node candidate lân cận đủ điều kiện topology để gộp (sử dụng Spatial Grid O(1)).
   */
  findCandidateNodesToMerge(node, maxDistance = 15, context = {}) {
    if (!node || typeof node.lat !== 'number' || typeof node.lng !== 'number') return [];
    const cellSize = 0.0005;
    const gx = Math.floor(node.lng / cellSize);
    const gy = Math.floor(node.lat / cellSize);

    const candidates = [];
    const checked = new Set();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gx + dx},${gy + dy}`;
        const nodeIds = this.spatialGrid.get(key);
        if (!nodeIds) continue;

        for (const candId of nodeIds) {
          if (candId === String(node.id) || checked.has(candId)) continue;
          checked.add(candId);
          const cand = this.nodes.get(candId);
          if (!cand) continue;

          if (canMergeNodes(node, cand, { ...context, maxDistance })) {
            candidates.push(cand);
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Gộp 2 node an toàn theo topology với quy tắc deterministic (Section 12):
   * - Giữ node có ID nhỏ hơn theo thứ tự từ điển (keepNode = id nhỏ hơn).
   * - Cập nhật toàn bộ incoming edges, outgoing edges, adjacency, edges map, spatial grid.
   * - Loại bỏ removeNode sạch sẽ, ngăn chặn dangling references.
   * 
   * @param {Object} nodeA
   * @param {Object} nodeB
   * @param {Object} [context={}]
   * @returns {Object|null} Node được giữ lại sau gộp, hoặc null nếu không đủ điều kiện gộp
   */
  mergeNodes(nodeA, nodeB, context = {}) {
    if (!canMergeNodes(nodeA, nodeB, context)) {
      return null;
    }

    // Deterministic selection: keep node with smaller string ID
    const keepNode = (String(nodeA.id) <= String(nodeB.id)) ? nodeA : nodeB;
    const removeNode = (keepNode === nodeA) ? nodeB : nodeA;

    const keepId = String(keepNode.id);
    const removeId = String(removeNode.id);

    // 1. Cập nhật các cạnh đi ra từ removeNode
    const outEdges = this.adjacency.get(removeId) || [];
    const keepOut = this.adjacency.get(keepId) || [];
    for (const edge of outEdges) {
      if (edge.to === keepId) {
        this.edgeCount = Math.max(0, this.edgeCount - 1);
        if (edge.id) this.edges.delete(edge.id);
        continue;
      }
      edge.from = keepId;
      keepOut.push(edge);
    }

    // 2. Cập nhật các cạnh đi vào removeNode
    const inEdges = this.incoming.get(removeId) || [];
    const keepIn = this.incoming.get(keepId) || [];
    for (const edge of inEdges) {
      if (edge.from === keepId) {
        this.edgeCount = Math.max(0, this.edgeCount - 1);
        if (edge.id) this.edges.delete(edge.id);
        continue;
      }
      edge.to = keepId;
      keepIn.push(edge);
    }

    // 3. Xóa removeNode khỏi danh sách kề
    this.adjacency.delete(removeId);
    this.incoming.delete(removeId);

    // 4. Xóa removeNode khỏi spatialGrid
    const oldKey = this._getGridKey(removeNode.lat, removeNode.lng);
    const cell = this.spatialGrid.get(oldKey);
    if (cell) {
      cell.delete(removeId);
      if (cell.size === 0) this.spatialGrid.delete(oldKey);
    }

    // 5. Xóa removeNode khỏi nodes map
    this.nodes.delete(removeId);

    // 6. Cập nhật thông tin giao lộ cho keepNode
    keepNode.isIntersection = Boolean(
      keepNode.isIntersection ||
      removeNode.isIntersection ||
      context.isIntersection ||
      (keepNode.osmWayId && removeNode.osmWayId && keepNode.osmWayId !== removeNode.osmWayId) ||
      (keepNode.roadId && removeNode.roadId && keepNode.roadId !== removeNode.roadId)
    );

    if (!keepNode.mergedNodes) keepNode.mergedNodes = [];
    keepNode.mergedNodes.push(removeId);

    return keepNode;
  }

  /**
   * Tìm cạnh gần tọa độ nhất phù hợp với topology (Section 8: nearest edge candidates)
   * Sử dụng spatialGrid prefilter trong bán kính 3 cells (~165m) để giảm độ phức tạp từ O(E) xuống O(1) amortized,
   * có fallback duyệt toàn bộ đồ thị nếu không tìm thấy candidate phù hợp.
   */
  findNearestEdge(lat, lng, context = {}) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      return null;
    }

    const _searchEdges = (edgeIterable) => {
      let nearestEdge = null;
      let minDistance = Infinity;
      let bestProjPoint = null;
      let bestT = 0;
      let bestBearing = 0;

      for (const edge of edgeIterable) {
        if (context.roadId && edge.roadId && context.roadId !== edge.roadId) continue;
        if (context.osmWayId && edge.osmWayId && context.osmWayId !== edge.osmWayId) continue;
        if (context.layer != null && edge.layer != null && Number(context.layer) !== Number(edge.layer)) continue;

        let segs = [];
        if (Array.isArray(edge.geometry) && edge.geometry.length >= 2) {
          segs = edge.geometry;
        } else {
          const nFrom = this.nodes.get(edge.from);
          const nTo = this.nodes.get(edge.to);
          if (nFrom && nTo) {
            segs = [[nFrom.lat, nFrom.lng], [nTo.lat, nTo.lng]];
          }
        }

        if (segs.length < 2) continue;

        for (let i = 0; i < segs.length - 1; i++) {
          const p1 = segs[i];
          const p2 = segs[i + 1];
          const proj = projectPointToSegment([lat, lng], p1, p2);
          const d = haversineDistanceMeters(lat, lng, proj.pt[0], proj.pt[1]);

          if (d < minDistance) {
            minDistance = d;
            nearestEdge = edge;
            bestProjPoint = proj.pt;
            bestT = proj.t;
            bestBearing = computeBearingDegrees(p1[0], p1[1], p2[0], p2[1]);
          }
        }
      }

      if (!nearestEdge) return null;

      return {
        edge: nearestEdge,
        projectedPoint: bestProjPoint,
        distance: minDistance,
        t: bestT,
        bearing: bestBearing
      };
    };

    // 1. Spatial Grid prefilter: lấy candidate nodes trong bán kính 3 cells (~165m)
    if (this.spatialGrid && this.spatialGrid.size > 0) {
      const cellSize = 0.0005;
      const gx = Math.floor(lng / cellSize);
      const gy = Math.floor(lat / cellSize);
      const radiusCells = context.searchRadiusCells || 3;
      const candidateEdges = new Map();

      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        for (let dy = -radiusCells; dy <= radiusCells; dy++) {
          const key = `${gx + dx},${gy + dy}`;
          const nodeIds = this.spatialGrid.get(key);
          if (!nodeIds) continue;

          for (const nodeId of nodeIds) {
            const outEdges = this.adjacency.get(nodeId);
            if (outEdges) {
              for (const e of outEdges) candidateEdges.set(e.id, e);
            }
            const inEdges = this.incoming.get(nodeId);
            if (inEdges) {
              for (const e of inEdges) candidateEdges.set(e.id, e);
            }
          }
        }
      }

      if (candidateEdges.size > 0) {
        const candidateResult = _searchEdges(candidateEdges.values());
        if (candidateResult) {
          return candidateResult;
        }
      }
    }

    // 2. Fallback: Nếu không tìm thấy edge nào trong candidate set (hoặc set rỗng), fallback duyệt toàn bộ edges
    return _searchEdges(this.edges.values());
  }

  /**
   * Chiếu điểm vào đồ thị theo đúng quy trình phân tách Snap & Merge (Section 8):
   * point -> find nearest edge -> topology filtering -> geometry projection -> pick suitable edge -> create/reuse node
   */
  snapPointToGraph(lat, lng, context = {}) {
    const nearest = this.findNearestEdge(lat, lng, context);

    if (!nearest || nearest.distance > (context.maxSnapDistance || 100)) {
      const nearNode = this.findNearestNode(lat, lng);
      return nearNode ? nearNode.node : null;
    }

    const projLat = nearest.projectedPoint[0];
    const projLng = nearest.projectedPoint[1];
    const edge = nearest.edge;

    const edgeContext = {
      roadId: edge.roadId,
      osmWayId: edge.osmWayId,
      roadName: edge.roadName,
      layer: edge.layer,
      bearing: nearest.bearing,
      isIntersection: context.isIntersection
    };

    const nFrom = this.getNode(edge.from);
    const nTo = this.getNode(edge.to);

    if (nFrom) {
      const dFrom = haversineDistanceMeters(projLat, projLng, nFrom.lat, nFrom.lng);
      if (dFrom < 3 && canMergeNodes(nFrom, { lat: projLat, lng: projLng, ...edgeContext }, context)) {
        return nFrom;
      }
    }

    if (nTo) {
      const dTo = haversineDistanceMeters(projLat, projLng, nTo.lat, nTo.lng);
      if (dTo < 3 && canMergeNodes(nTo, { lat: projLat, lng: projLng, ...edgeContext }, context)) {
        return nTo;
      }
    }

    const newNodeId = context.nodeId || `snap_${Number(projLat).toFixed(5)},${Number(projLng).toFixed(5)}`;
    let node = this.getNode(newNodeId);
    if (!node) {
      node = {
        id: newNodeId,
        lat: projLat,
        lng: projLng,
        edgeId: edge.id,
        roadId: edge.roadId,
        osmWayId: edge.osmWayId,
        roadName: edge.roadName,
        layer: edge.layer,
        bearing: nearest.bearing,
        isIntersection: false
      };
      this.addNode(node);
    }

    return node;
  }

  /**
   * Trả về kích thước hiện tại của đồ thị.
   * 
   * @returns {{ nodes: number, edges: number }}
   */
  size() {
    return {
      nodes: this.nodes.size,
      edges: this.edgeCount
    };
  }

  /**
   * Xóa toàn bộ dữ liệu đồ thị để giải phóng bộ nhớ RAM.
   */
  clear() {
    this.nodes.clear();
    this.adjacency.clear();
    this.incoming.clear();
    this.edges.clear();
    this.spatialGrid.clear();
    this.edgeCount = 0;
  }
}

/**
 * Xây dựng đồ thị từ tập tin GeoJSON (FeatureCollection gồm các đối tượng LineString/MultiLineString).
 * Quyết định thiết kế: Tách LineString thành các cạnh đơn giữa các cặp điểm liên tiếp. Tọa độ được làm tròn
 * 5 chữ số thập phân để đảm bảo các cạnh gặp nhau tại giao lộ sẽ dùng chung một Node ID, biến tập đường rời rạc
 * thành đồ thị liên thông hoàn chỉnh.
 * 
 * @param {string|Object} source - Đường dẫn URL tải file GeoJSON hoặc đối tượng JSON đã nạp sẵn
 * @returns {Promise<Graph>} Thể hiện Graph đã nạp toàn bộ cấu trúc mạng lưới
 */
async function buildGraphFromGeoJSON(source) {
  let geojsonData = null;

  if (typeof source === 'string') {
    const isBrowser = typeof window !== 'undefined';
    const isHttpUrl = source.startsWith('http://') || source.startsWith('https://');

    if (isBrowser || isHttpUrl) {
      const res = await fetch(source);
      if (!res.ok) {
        throw new Error(`[buildGraphFromGeoJSON] Không thể tải dữ liệu từ URL: ${source} (Status: ${res.status})`);
      }
      geojsonData = await res.json();
    } else {
      // Môi trường Node.js tải đường dẫn file cục bộ
      try {
        const fs = await import('fs/promises');
        const raw = await fs.readFile(source, 'utf-8');
        geojsonData = JSON.parse(raw);
      } catch (fsErr) {
        throw new Error(`[buildGraphFromGeoJSON] Lỗi khi đọc file cục bộ: ${source} (${fsErr.message})`);
      }
    }
  } else if (typeof source === 'object' && source !== null) {
    geojsonData = source;
  } else {
    throw new Error('[buildGraphFromGeoJSON] Nguồn dữ liệu GeoJSON không hợp lệ.');
  }

  const graph = new Graph();
  const features = geojsonData.features || (geojsonData.type === 'Feature' ? [geojsonData] : []);

  for (const feature of features) {
    if (!feature || !feature.geometry) continue;

    const props = feature.properties || {};
    const roadClass = props.highway || props.road_class || 'residential';
    const isOneWay = props.oneway === 'yes' || props.oneway === true || props.oneway === '1';
    const roadName = props.name || props.street || '';
    const osmWayId = props.id || props.osm_id || props.osmWayId || null;
    const layer = props.layer != null ? Number(props.layer) : 0;
    const bridge = props.bridge === 'yes' || props.bridge === true;
    const tunnel = props.tunnel === 'yes' || props.tunnel === true;

    let lineStrings = [];
    if (feature.geometry.type === 'LineString') {
      lineStrings.push(feature.geometry.coordinates);
    } else if (feature.geometry.type === 'MultiLineString') {
      lineStrings = feature.geometry.coordinates;
    }

    for (const coords of lineStrings) {
      if (!Array.isArray(coords) || coords.length < 2) continue;

      for (let i = 0; i < coords.length - 1; i++) {
        const [lngA, latA] = coords[i];
        const [lngB, latB] = coords[i + 1];

        const idA = coordToNodeId(latA, lngA);
        const idB = coordToNodeId(latB, lngB);

        // Đảm bảo cả hai node được ghi nhận vào đồ thị với topology attributes
        graph.addNode({
          id: idA,
          lat: latA,
          lng: lngA,
          roadName,
          osmWayId: osmWayId ? String(osmWayId) : null,
          layer,
          bridge,
          tunnel
        });
        graph.addNode({
          id: idB,
          lat: latB,
          lng: lngB,
          roadName,
          osmWayId: osmWayId ? String(osmWayId) : null,
          layer,
          bridge,
          tunnel
        });

        const dist = haversineDistanceMeters(latA, lngA, latB, lngB);
        if (dist <= 0) continue; // Bỏ qua đoạn tự lặp không có chiều dài

        const segBearing = computeBearingDegrees(latA, lngA, latB, lngB);

        // Chiều thuận
        graph.addEdge({
          id: `edge_${idA}_${idB}`,
          from: idA,
          to: idB,
          distance: dist,
          road_class: roadClass,
          roadName,
          osmWayId: osmWayId ? String(osmWayId) : null,
          layer,
          bridge,
          tunnel,
          bearing: segBearing,
          incident_ids: []
        });

        // Chiều nghịch (nếu đường hai chiều)
        if (!isOneWay) {
          const revBearing = (segBearing + 180) % 360;
          graph.addEdge({
            id: `edge_${idB}_${idA}`,
            from: idB,
            to: idA,
            distance: dist,
            road_class: roadClass,
            roadName,
            osmWayId: osmWayId ? String(osmWayId) : null,
            layer,
            bridge,
            tunnel,
            bearing: revBearing,
            incident_ids: []
          });
        }
      }
    }
  }

  return graph;
}

/**
 * Xây dựng đồ thị trực tiếp từ máy chủ OpenStreetMap thông qua Overpass API.
 * 
 * @param {Object} bbox - Giới hạn địa lý hành trình
 * @param {number} bbox.minLat - Vĩ độ cực nam
 * @param {number} bbox.minLng - Kinh độ cực tây
 * @param {number} bbox.maxLat - Vĩ độ cực bắc
 * @param {number} bbox.maxLng - Kinh độ cực đông
 * @param {Object} [options={}] - Các tùy chọn bổ sung
 * @param {number} [options.timeoutSeconds=25] - Thời gian chờ tối đa (giây)
 * @param {string} [options.endpoint='https://overpass-api.de/api/interpreter'] - Máy chủ Overpass
 * @returns {Promise<Graph>}
 */
async function buildGraphFromOverpass(bbox, options = {}) {
  const timeoutSec = options.timeoutSeconds || 25;
  const endpoint = options.endpoint || 'https://overpass-api.de/api/interpreter';

  const query = `
    [out:json][timeout:${timeoutSec}];
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)"]
      (${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
    );
    out body;
    >;
    out skel qt;
  `.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), (timeoutSec + 5) * 1000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`[buildGraphFromOverpass] Overpass server trả về mã lỗi HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawNodes = new Map();
    const ways = [];

    for (const elem of data.elements || []) {
      if (elem.type === 'node') {
        rawNodes.set(elem.id, { lat: elem.lat, lng: elem.lon });
      } else if (elem.type === 'way') {
        ways.push(elem);
      }
    }

    const graph = new Graph();

    for (const way of ways) {
      const tags = way.tags || {};
      const roadClass = tags.highway || 'residential';
      const isOneWay = tags.oneway === 'yes' || tags.oneway === '1';
      const roadName = tags.name || '';
      const osmWayId = way.id ? String(way.id) : null;
      const layer = tags.layer != null ? Number(tags.layer) : 0;
      const bridge = tags.bridge === 'yes';
      const tunnel = tags.tunnel === 'yes';
      const nodeRefs = way.nodes || [];

      for (let i = 0; i < nodeRefs.length - 1; i++) {
        const nA = rawNodes.get(nodeRefs[i]);
        const nB = rawNodes.get(nodeRefs[i + 1]);
        if (!nA || !nB) continue;

        const idA = coordToNodeId(nA.lat, nA.lng);
        const idB = coordToNodeId(nB.lat, nB.lng);

        graph.addNode({
          id: idA,
          lat: nA.lat,
          lng: nA.lng,
          roadName,
          osmWayId,
          layer,
          bridge,
          tunnel
        });
        graph.addNode({
          id: idB,
          lat: nB.lat,
          lng: nB.lng,
          roadName,
          osmWayId,
          layer,
          bridge,
          tunnel
        });

        const dist = haversineDistanceMeters(nA.lat, nA.lng, nB.lat, nB.lng);
        if (dist <= 0) continue;

        const segBearing = computeBearingDegrees(nA.lat, nA.lng, nB.lat, nB.lng);

        graph.addEdge({
          id: `edge_${idA}_${idB}`,
          from: idA,
          to: idB,
          distance: dist,
          road_class: roadClass,
          roadName,
          osmWayId,
          layer,
          bridge,
          tunnel,
          bearing: segBearing,
          incident_ids: []
        });

        if (!isOneWay) {
          const revBearing = (segBearing + 180) % 360;
          graph.addEdge({
            id: `edge_${idB}_${idA}`,
            from: idB,
            to: idA,
            distance: dist,
            road_class: roadClass,
            roadName,
            osmWayId,
            layer,
            bridge,
            tunnel,
            bearing: revBearing,
            incident_ids: []
          });
        }
      }
    }

    return graph;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`[buildGraphFromOverpass] Quá thời gian chờ (${timeoutSec}s) khi kết nối Overpass API.`);
    }
    throw err;
  }
}

// Gắn lên window và module.exports
if (typeof window !== 'undefined') {
  window.DEFAULT_SPEED_PROFILE_KMH = DEFAULT_SPEED_PROFILE_KMH;
  window.haversineDistanceMeters = haversineDistanceMeters;
  window.coordToNodeId = coordToNodeId;
  window.extractStreetName = extractStreetName;
  window.normalizeStreetName = normalizeStreetName;
  window.computeBearingDegrees = computeBearingDegrees;
  window.bearingAngleDiff = bearingAngleDiff;
  window.projectPointToSegment = projectPointToSegment;
  window.canMergeNodes = canMergeNodes;
  window.Graph = Graph;
  window.buildGraphFromGeoJSON = buildGraphFromGeoJSON;
  window.buildGraphFromOverpass = buildGraphFromOverpass;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SPEED_PROFILE_KMH,
    haversineDistanceMeters,
    coordToNodeId,
    extractStreetName,
    normalizeStreetName,
    computeBearingDegrees,
    bearingAngleDiff,
    projectPointToSegment,
    canMergeNodes,
    Graph,
    buildGraphFromGeoJSON,
    buildGraphFromOverpass
  };
}
