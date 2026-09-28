/**
 * Test Suite: Graph Topology, Node Snapping & Merging, and Incident Topology Validation
 * File: tests/test_graph.js
 * 
 * To run: node tests/test_graph.js
 */

const {
  Graph,
  canMergeNodes,
  normalizeStreetName,
  bearingAngleDiff,
  computeBearingDegrees,
  projectPointToSegment,
  haversineDistanceMeters
} = require('../js/graph.js');

const {
  canMergeIncidentNodes,
  isSameRoadAndDirection
} = require('../js/incidents.js');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAILED: ${message}`);
  }
}

console.log('================================================================');
console.log('BẮT ĐẦU KIỂM THỬ TOPOLOGY GRAPH & NODE MERGING THEO CHECKLIST');
console.log('================================================================\n');

/* ------------------------------------------------------------------
   TEST 1: Same road, near coordinates (< threshold) -> MERGE
------------------------------------------------------------------ */
console.log('--- Test 1: Hai node trên cùng 1 road segment, khoảng cách gần (< 15m) ---');
{
  const nodeA = {
    id: 'node_1A',
    lat: 10.77250,
    lng: 106.69800,
    roadName: 'Đường Lê Lợi',
    normalizedStreet: 'le loi',
    osmWayId: 'way_1001',
    roadId: 'road_le_loi',
    layer: 0,
    bearing: 45
  };

  const nodeB = {
    id: 'node_1B',
    lat: 10.77255,
    lng: 106.69805,
    roadName: 'Lê Lợi',
    normalizedStreet: 'le loi',
    osmWayId: 'way_1001',
    roadId: 'road_le_loi',
    layer: 0,
    bearing: 45
  };

  const dist = haversineDistanceMeters(nodeA.lat, nodeA.lng, nodeB.lat, nodeB.lng);
  assert(dist < 15, `Khoảng cách giữa 2 node là ${dist.toFixed(2)}m (< 15m)`);

  const allowed = canMergeNodes(nodeA, nodeB);
  assert(allowed === true, 'Test 1 - canMergeNodes: Cùng đường, cùng OSM Way, cùng layer, bearing trùng khớp -> ĐƯỢC PHÉP MERGE');

  // Kiểm tra merge trên cấu trúc Graph thực tế
  const graph = new Graph();
  graph.addNode(nodeA);
  graph.addNode(nodeB);
  graph.addEdge({ id: 'e1', from: 'start', to: 'node_1A', distance: 100, roadId: 'road_le_loi' });
  graph.addEdge({ id: 'e2', from: 'node_1B', to: 'dest', distance: 150, roadId: 'road_le_loi' });

  const mergedNode = graph.mergeNodes(nodeA, nodeB);
  assert(mergedNode !== null, 'Graph.mergeNodes thành công và trả về node hợp nhất');
  assert(mergedNode.id === 'node_1A', 'Deterministic merge: Giữ node có ID nhỏ hơn theo thứ tự từ điển (node_1A < node_1B)');
  assert(!graph.hasNode('node_1B'), 'Node B đã được xóa sạch khỏi đồ thị');
  assert(graph.hasNode('node_1A'), 'Node A tồn tại trên đồ thị');

  const outEdges = graph.getOutgoingEdges('node_1A');
  assert(outEdges.some(e => e.to === 'dest'), 'Cạnh từ node_1B đã được chuyển trỏ từ node_1A -> dest');
}

/* ------------------------------------------------------------------
   TEST 2: Two parallel roads, very close coordinates -> DO NOT MERGE
------------------------------------------------------------------ */
console.log('\n--- Test 2: Hai node nằm trên 2 đường song song, tọa độ rất gần (< 6m) ---');
{
  const nodeNguyenHue = {
    id: 'node_nh',
    lat: 10.77250,
    lng: 106.69800,
    roadName: 'Đường Nguyễn Huệ',
    normalizedStreet: 'nguyen hue',
    osmWayId: 'way_nguyen_hue',
    roadId: 'road_nguyen_hue',
    layer: 0,
    bearing: 135
  };

  const nodeDongKhoi = {
    id: 'node_dk',
    lat: 10.77254,
    lng: 106.69804,
    roadName: 'Đường Đồng Khởi',
    normalizedStreet: 'dong khoi',
    osmWayId: 'way_dong_khoi',
    roadId: 'road_dong_khoi',
    layer: 0,
    bearing: 135 // Cùng hướng song song nhưng khác đường!
  };

  const dist = haversineDistanceMeters(nodeNguyenHue.lat, nodeNguyenHue.lng, nodeDongKhoi.lat, nodeDongKhoi.lng);
  assert(dist < 10, `Khoảng cách giữa 2 đường là ${dist.toFixed(2)}m (< 10m)`);

  const allowedGraph = canMergeNodes(nodeNguyenHue, nodeDongKhoi);
  assert(allowedGraph === false, 'Test 2 - canMergeNodes: 2 đường song song khác tên và khác OSM Way -> TUYỆT ĐỐI KHÔNG MERGE');

  // Kiểm tra với incident node merging
  const incA = {
    type: 'flood',
    lat: nodeNguyenHue.lat,
    lng: nodeNguyenHue.lng,
    roadName: nodeNguyenHue.roadName,
    normalizedStreet: nodeNguyenHue.normalizedStreet,
    osmWayId: nodeNguyenHue.osmWayId,
    roadBearing: 135,
    layer: 0
  };

  const incB = {
    type: 'flood',
    lat: nodeDongKhoi.lat,
    lng: nodeDongKhoi.lng,
    roadName: nodeDongKhoi.roadName,
    normalizedStreet: nodeDongKhoi.normalizedStreet,
    osmWayId: nodeDongKhoi.osmWayId,
    roadBearing: 135,
    layer: 0
  };

  const allowedInc = canMergeIncidentNodes(incA, incB);
  assert(allowedInc === false, 'Test 2 - canMergeIncidentNodes: 2 sự cố trên 2 đường song song cạnh nhau -> TUYỆT ĐỐI KHÔNG GỘP');
}

/* ------------------------------------------------------------------
   TEST 3: Real intersection in road network -> MERGE / SAME INTERSECTION
------------------------------------------------------------------ */
console.log('\n--- Test 3: Hai node thuộc 2 edge khác nhau gặp nhau tại intersection thực sự ---');
{
  const nodeIntersectionStreet1 = {
    id: 'node_int_1',
    lat: 10.77200,
    lng: 106.69800,
    roadName: 'Lê Lợi',
    osmWayId: 'way_le_loi',
    isIntersection: true,
    layer: 0,
    bearing: 45
  };

  const nodeIntersectionStreet2 = {
    id: 'node_int_2',
    lat: 10.77202,
    lng: 106.69801,
    roadName: 'Pasteur',
    osmWayId: 'way_pasteur',
    isIntersection: true,
    layer: 0,
    bearing: 135
  };

  const dist = haversineDistanceMeters(nodeIntersectionStreet1.lat, nodeIntersectionStreet1.lng, nodeIntersectionStreet2.lat, nodeIntersectionStreet2.lng);
  assert(dist < 5, `Khoảng cách giữa 2 điểm giao cắt là ${dist.toFixed(2)}m (< 5m)`);

  const allowed = canMergeNodes(nodeIntersectionStreet1, nodeIntersectionStreet2, { isIntersection: true });
  assert(allowed === true, 'Test 3 - canMergeNodes: Giao lộ thực sự (isIntersection: true) cùng layer -> HỢP NHẤT THÀNH ĐÚNG 1 INTERSECTION NODE');

  const graph = new Graph();
  graph.addNode(nodeIntersectionStreet1);
  graph.addNode(nodeIntersectionStreet2);
  graph.addEdge({ id: 'e_leloi', from: 'start_leloi', to: 'node_int_1', distance: 100 });
  graph.addEdge({ id: 'e_pasteur', from: 'start_pasteur', to: 'node_int_2', distance: 80 });

  const merged = graph.mergeNodes(nodeIntersectionStreet1, nodeIntersectionStreet2, { isIntersection: true });
  assert(merged !== null, 'Merge giao lộ thành công');
  assert(merged.isIntersection === true, 'Node hợp nhất được đánh dấu isIntersection = true');
  assert(graph.size().nodes === 1, 'Sau khi hợp nhất chỉ còn đúng 1 node giao lộ duy nhất');
}

/* ------------------------------------------------------------------
   TEST 4: Overpass vs surface road (Different layer / elevation) -> DO NOT MERGE
------------------------------------------------------------------ */
console.log('\n--- Test 4: Điểm giao nhau nhưng khác layer / elevation (Cầu vượt vs Đường bên dưới) ---');
{
  const nodeGround = {
    id: 'node_ground_dienbienphu',
    lat: 10.79500,
    lng: 106.71500,
    roadName: 'Đường Điện Biên Phủ (mặt đất)',
    normalizedStreet: 'dien bien phu',
    osmWayId: 'way_ground_dbp',
    layer: 0,
    bridge: false,
    bearing: 60
  };

  const nodeOverpass = {
    id: 'node_overpass_hangxanh',
    lat: 10.79501,
    lng: 106.71501,
    roadName: 'Cầu vượt Hàng Xanh',
    normalizedStreet: 'cau vuot hang xanh',
    osmWayId: 'way_bridge_hangxanh',
    layer: 1, // Cầu vượt tầng +1
    bridge: true,
    bearing: 60
  };

  const dist = haversineDistanceMeters(nodeGround.lat, nodeGround.lng, nodeOverpass.lat, nodeOverpass.lng);
  assert(dist < 2, `Khoảng cách tọa độ giữa cầu vượt và đường dưới là ${dist.toFixed(2)}m (< 2m)`);

  const allowedGraph = canMergeNodes(nodeGround, nodeOverpass);
  assert(allowedGraph === false, 'Test 4 - canMergeNodes: Khác layer (0 vs 1) và bridge (false vs true) -> TUYỆT ĐỐI KHÔNG MERGE');

  const incGround = {
    type: 'traffic',
    lat: nodeGround.lat,
    lng: nodeGround.lng,
    roadName: nodeGround.roadName,
    layer: 0,
    bridge: false
  };

  const incBridge = {
    type: 'traffic',
    lat: nodeOverpass.lat,
    lng: nodeOverpass.lng,
    roadName: nodeOverpass.roadName,
    layer: 1,
    bridge: true
  };

  const allowedInc = canMergeIncidentNodes(incGround, incBridge);
  assert(allowedInc === false, 'Test 4 - canMergeIncidentNodes: Sự cố trên cầu vượt không gộp với sự cố đường dưới -> TUYỆT ĐỐI KHÔNG GỘP');
}

/* ------------------------------------------------------------------
   TEST 5: Consecutive edges on same way, redundant node -> MERGE
------------------------------------------------------------------ */
console.log('\n--- Test 5: Hai node liên tiếp trên cùng một way, một node dư thừa do phân mảnh ---');
{
  const nodeSeg1End = {
    id: 'node_frag_A',
    lat: 10.75000,
    lng: 106.68000,
    roadName: 'Võ Văn Kiệt',
    normalizedStreet: 'vo van kiet',
    osmWayId: 'way_vvk_east',
    layer: 0,
    bearing: 90
  };

  const nodeSeg2Start = {
    id: 'node_frag_B',
    lat: 10.75001,
    lng: 106.68002,
    roadName: 'Võ Văn Kiệt',
    normalizedStreet: 'vo van kiet',
    osmWayId: 'way_vvk_east',
    layer: 0,
    bearing: 90
  };

  const allowed = canMergeNodes(nodeSeg1End, nodeSeg2Start);
  assert(allowed === true, 'Test 5 - canMergeNodes: Cùng way, cùng tên đường, cùng hướng, khoảng cách 2m -> MERGE HỢP LỆ');

  const graph = new Graph();
  graph.addNode({ id: 'node_start', lat: 10.75000, lng: 106.67500 });
  graph.addNode(nodeSeg1End);
  graph.addNode(nodeSeg2Start);
  graph.addNode({ id: 'node_end', lat: 10.75000, lng: 106.68500 });

  graph.addEdge({ id: 'e1', from: 'node_start', to: 'node_frag_A', distance: 500, roadName: 'Võ Văn Kiệt' });
  graph.addEdge({ id: 'e2', from: 'node_frag_B', to: 'node_end', distance: 500, roadName: 'Võ Văn Kiệt' });

  const merged = graph.mergeNodes(nodeSeg1End, nodeSeg2Start);
  assert(merged !== null && merged.id === 'node_frag_A', 'Merge thành công giữ lại node_frag_A');
  assert(graph.hasNode('node_frag_A'), 'node_frag_A tồn tại');
  assert(!graph.hasNode('node_frag_B'), 'node_frag_B đã loại bỏ');

  const inEdges = graph.getIncomingEdges('node_frag_A');
  const outEdges = graph.getOutgoingEdges('node_frag_A');
  assert(inEdges.some(e => e.from === 'node_start'), 'Cạnh vào từ node_start kết nối thông suốt');
  assert(outEdges.some(e => e.to === 'node_end'), 'Cạnh ra tới node_end kết nối thông suốt');
  assert(graph.size().nodes === 3, 'Graph giữ nguyên tính liên thông, tổng số node là 3 (start, merged, end)');
}

/* ------------------------------------------------------------------
   TEST 6: The exact error in the image: 2 nodes near "4 người" on different segments
------------------------------------------------------------------ */
console.log('\n--- Test 6: Trường hợp lỗi trong ảnh: 2 node gần node "4 người" nhưng thuộc road segment khác ---');
{
  // Cluster hiện hữu trên đường chính (Đinh Bộ Lĩnh) có 4 người báo cáo
  const cluster4People = {
    id: 'inc_cluster_4_people',
    type: 'traffic',
    lat: 10.80350,
    lng: 106.70920,
    roadName: 'Đường Đinh Bộ Lĩnh',
    normalizedStreet: 'dinh bo linh',
    osmWayId: 'way_dinh_bo_linh_main',
    roadId: 'road_dinh_bo_linh',
    layer: 0,
    roadBearing: 15, // Hướng chạy dọc Bắc - Nam
    reporterCount: 4,
    nodes: [
      { lat: 10.80350, lng: 106.70920, osmWayId: 'way_dinh_bo_linh_main', roadBearing: 15 }
    ],
    segmentCoords: [
      [10.80320, 106.70912],
      [10.80350, 106.70920],
      [10.80380, 106.70928]
    ]
  };

  // Node đỏ thứ nhất: Nằm trên đường cắt ngang (Đường Bạch Đằng), cách chỉ 18m
  const nodeRed1 = {
    id: 'node_red_1',
    type: 'traffic',
    lat: 10.80352,
    lng: 106.70936, // Cách 18m về phía Đông trên đường Bạch Đằng
    roadName: 'Đường Bạch Đằng',
    normalizedStreet: 'bach dang',
    osmWayId: 'way_bach_dang_cross',
    roadId: 'road_bach_dang',
    layer: 0,
    roadBearing: 105, // Hướng vuông góc ~90 độ so với Đinh Bộ Lĩnh
    bearing: 105
  };

  // Node đỏ thứ hai: Nằm trong hẻm nhánh, cách chỉ 22m
  const nodeRed2 = {
    id: 'node_red_2',
    type: 'traffic',
    lat: 10.80365,
    lng: 106.70910,
    roadName: 'Hẻm 123 Đinh Bộ Lĩnh',
    normalizedStreet: '123 dinh bo linh',
    osmWayId: 'way_hem_123',
    roadId: 'road_hem_123',
    layer: 0,
    roadBearing: 105,
    bearing: 105
  };

  const d1 = haversineDistanceMeters(cluster4People.lat, cluster4People.lng, nodeRed1.lat, nodeRed1.lng);
  const d2 = haversineDistanceMeters(cluster4People.lat, cluster4People.lng, nodeRed2.lat, nodeRed2.lng);
  assert(d1 < 25, `Node đỏ 1 cách node 4 người ${d1.toFixed(1)}m (rất gần)`);
  assert(d2 < 25, `Node đỏ 2 cách node 4 người ${d2.toFixed(1)}m (rất gần)`);

  // Kiểm tra canMergeIncidentNodes với node đỏ 1
  const canMergeRed1 = canMergeIncidentNodes(cluster4People, nodeRed1);
  assert(canMergeRed1 === false, 'Test 6A - canMergeIncidentNodes: Node đỏ 1 trên đường Bạch Đằng KHÔNG được phép gộp vào node 4 người trên Đinh Bộ Lĩnh (khác tên đường, khác OSM way, bearing lệch 90 độ)');

  // Kiểm tra canMergeIncidentNodes với node đỏ 2
  const canMergeRed2 = canMergeIncidentNodes(cluster4People, nodeRed2);
  assert(canMergeRed2 === false, 'Test 6B - canMergeIncidentNodes: Node đỏ 2 trong hẻm nhánh KHÔNG được phép gộp vào node 4 người (khác roadId, khác wayId, bearing lệch > 45 độ)');

  // Kiểm tra canMergeIncidentNodes giữa 2 node đỏ với nhau
  const canMergeBetweenReds = canMergeIncidentNodes(nodeRed1, nodeRed2);
  assert(canMergeBetweenReds === false, 'Test 6C - Hai node đỏ thuộc 2 đường khác nhau (Bạch Đằng vs Hẻm 123) cũng KHÔNG được phép gộp với nhau');

  // Kiểm tra canMergeNodes trên Graph
  const canMergeGraph1 = canMergeNodes(cluster4People, nodeRed1);
  assert(canMergeGraph1 === false, 'Test 6D - canMergeNodes (Graph): Không cho phép gộp node đỏ 1 vào cluster 4 người');

  const canMergeGraph2 = canMergeNodes(cluster4People, nodeRed2);
  assert(canMergeGraph2 === false, 'Test 6E - canMergeNodes (Graph): Không cho phép gộp node đỏ 2 vào cluster 4 người');

  // Kết luận: Cả 3 điểm tồn tại độc lập
  const totalDistinctNodes = [cluster4People, nodeRed1, nodeRed2].length;
  assert(totalDistinctNodes === 3, 'Test 6 - Kết quả: TÁCH BIỆT THÀNH ĐÚNG 3 NODE ĐỘC LẬP, KHÔNG BỊ GỘP VÀO 1 NODE "4 NGƯỜI"');
}

/* ------------------------------------------------------------------
   TỔNG KẾT
------------------------------------------------------------------ */
console.log('\n================================================================');
console.log(`KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} TESTS ĐẠT (${Math.round(passedTests/totalTests*100)}%)`);
console.log('================================================================');

if (passedTests === totalTests) {
  console.log('TẤT CẢ 6 TEST CASES BẮT BUỘC ĐÃ ĐẠT 100% VỚI TOPOLOGY VALIDATION!');
  process.exit(0);
} else {
  console.error('CÓ TEST THẤT BẠI!');
  process.exit(1);
}

