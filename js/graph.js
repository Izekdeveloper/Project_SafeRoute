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
 * Độ chính xác 5 chữ số thập phân tương đương sai số ~1.1m ở xích đạo, đủ phân biệt
 * các giao lộ liền kề nhưng đảm bảo gộp các điểm đầu mút trùng nhau giữa các đoạn đường.
 * 
 * @param {number} lat - Vĩ độ
 * @param {number} lng - Kinh độ
 * @returns {string} Chuỗi ID duy nhất dạng "vĩ độ,kinh độ"
 */
function coordToNodeId(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
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
    /** @type {Map<string, { id: string, lat: number, lng: number }>} */
    this.nodes = new Map();

    /** @type {Map<string, Array<{ from: string, to: string, distance: number, freeflow_time: number, road_class: string, incident_ids: Array<string> }>>} */
    this.adjacency = new Map();

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

  /**
   * Thêm một node vào đồ thị.
   * 
   * @param {Object} node - Thông tin nút giao
   * @param {string} node.id - Định danh nút
   * @param {number} node.lat - Vĩ độ WGS84
   * @param {number} node.lng - Kinh độ WGS84
   * @complexity O(1) amortized
   */
  addNode(node) {
    if (!node || typeof node.id === 'undefined') return;
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, {
        id: String(node.id),
        lat: Number(node.lat),
        lng: Number(node.lng)
      });
      if (!this.adjacency.has(node.id)) {
        this.adjacency.set(node.id, []);
      }
    }
  }

  /**
   * Thêm một cạnh có hướng từ node `from` đến node `to`.
   * Quyết định thiết kế: Nếu node `from` hoặc `to` chưa có trong đồ thị,
   * đồ thị sẽ tự động đăng ký node với tọa độ mặc định để tránh rơi vào trạng thái cô lập.
   * 
   * @param {Object} edge - Thông tin đoạn đường
   * @param {string} edge.from - Node xuất phát
   * @param {string} edge.to - Node đích đến
   * @param {number} edge.distance - Chiều dài hình học (mét)
   * @param {number} [edge.freeflow_time] - Thời gian tự do (giây). Nếu thiếu sẽ tự tính theo road_class.
   * @param {string} [edge.road_class='residential'] - Loại đường OSM (highway tag)
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

    const roadClass = edge.road_class || 'default';
    const distance = Number(edge.distance) || 0;
    
    // Tính freeflow_time nếu chưa được cung cấp: t = s / v (m / (km/h / 3.6))
    let freeflowTime = edge.freeflow_time;
    if (typeof freeflowTime !== 'number' || freeflowTime <= 0) {
      const speedKmh = DEFAULT_SPEED_PROFILE_KMH[roadClass] || DEFAULT_SPEED_PROFILE_KMH.default;
      const speedMs = speedKmh / 3.6;
      freeflowTime = distance > 0 ? (distance / speedMs) : 1;
    }

    const cleanEdge = {
      from: fromId,
      to: toId,
      distance: distance,
      freeflow_time: Math.max(0.1, Number(freeflowTime)),
      road_class: roadClass,
      incident_ids: Array.isArray(edge.incident_ids) ? [...edge.incident_ids] : []
    };

    this.adjacency.get(fromId).push(cleanEdge);
    this.edgeCount++;
  }

  /**
   * Lấy danh sách các cạnh đi ra từ một nút giao (Outgoing Edges).
   * 
   * @param {string} nodeId - ID nút giao cần truy vấn
   * @returns {Array<Object>} Mảng các cạnh xuất phát từ nodeId
   * @complexity O(1)
   */
  getNeighbors(nodeId) {
    return this.adjacency.get(String(nodeId)) || [];
  }

  /**
   * Lấy thông tin chi tiết của một node.
   * 
   * @param {string} nodeId - ID nút cần lấy
   * @returns {Object|null} Node object hoặc null nếu không tồn tại
   * @complexity O(1)
   */
  getNode(nodeId) {
    return this.nodes.get(String(nodeId)) || null;
  }

  /**
   * Tìm nút giao trên đồ thị gần một tọa độ bất kỳ nhất (Nearest Node Snapping).
   * Quyết định thiết kế: Cần thiết để chiếu (snap) điểm GPS thực tế (origin/destination)
   * vào mạng lưới giao thông trước khi thực thi Dijkstra.
   * 
   * @param {number} lat - Vĩ độ cần chiếu
   * @param {number} lng - Kinh độ cần chiếu
   * @returns {{ node: Object, distance: number }|null} Nút gần nhất và khoảng cách (m)
   * @complexity O(|V|)
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

        // Đảm bảo cả hai node được ghi nhận vào đồ thị
        graph.addNode({ id: idA, lat: latA, lng: lngA });
        graph.addNode({ id: idB, lat: latB, lng: lngB });

        const dist = haversineDistanceMeters(latA, lngA, latB, lngB);
        if (dist <= 0) continue; // Bỏ qua đoạn tự lặp không có chiều dài

        // Chiều thuận
        graph.addEdge({
          from: idA,
          to: idB,
          distance: dist,
          road_class: roadClass,
          incident_ids: []
        });

        // Chiều nghịch (nếu đường hai chiều)
        if (!isOneWay) {
          graph.addEdge({
            from: idB,
            to: idA,
            distance: dist,
            road_class: roadClass,
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
      const roadClass = way.tags?.highway || 'residential';
      const isOneWay = way.tags?.oneway === 'yes' || way.tags?.oneway === '1';
      const nodeRefs = way.nodes || [];

      for (let i = 0; i < nodeRefs.length - 1; i++) {
        const nA = rawNodes.get(nodeRefs[i]);
        const nB = rawNodes.get(nodeRefs[i + 1]);
        if (!nA || !nB) continue;

        const idA = coordToNodeId(nA.lat, nA.lng);
        const idB = coordToNodeId(nB.lat, nB.lng);

        graph.addNode({ id: idA, lat: nA.lat, lng: nA.lng });
        graph.addNode({ id: idB, lat: nB.lat, lng: nB.lng });

        const dist = haversineDistanceMeters(nA.lat, nA.lng, nB.lat, nB.lng);
        if (dist <= 0) continue;

        graph.addEdge({
          from: idA,
          to: idB,
          distance: dist,
          road_class: roadClass,
          incident_ids: []
        });

        if (!isOneWay) {
          graph.addEdge({
            from: idB,
            to: idA,
            distance: dist,
            road_class: roadClass,
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
  window.Graph = Graph;
  window.buildGraphFromGeoJSON = buildGraphFromGeoJSON;
  window.buildGraphFromOverpass = buildGraphFromOverpass;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SPEED_PROFILE_KMH,
    haversineDistanceMeters,
    coordToNodeId,
    Graph,
    buildGraphFromGeoJSON,
    buildGraphFromOverpass
  };
}
