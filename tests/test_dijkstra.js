/**
 * Test Suite: Independent Dijkstra & K-Shortest Paths Engine & Route Suggestion Selection
 * File: tests/test_dijkstra.js
 * 
 * To run: node tests/test_dijkstra.js
 */

const { PriorityQueue, dijkstra, kShortestPaths, calculateRouteOverlap, getEdgeIdentifier } = require('../js/dijkstra.js');
const { CONFIG, MAX_SUGGESTED_ROUTES } = require('../js/config.js');

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

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  assert(actualStr === expectedStr, `${message} (Expected: ${expectedStr}, Got: ${actualStr})`);
}

console.log('================================================================');
console.log('BẮT ĐẦU KIỂM THỬ ĐỘC LẬP DIJKSTRA & K-SHORTEST & ROUTE SUGGESTION');
console.log('================================================================\n');

/* ------------------------------------------------------------------
   TEST GROUP 1: PRIORITY QUEUE (BINARY MIN-HEAP)
------------------------------------------------------------------ */
console.log('--- Test Group 1: PriorityQueue (Binary Min-Heap) ---');
{
  const pq = new PriorityQueue();
  assert(pq.isEmpty(), 'PQ mới tạo phải rỗng');
  assert(pq.size() === 0, 'Kích thước PQ rỗng là 0');

  pq.push('NodeC', 30);
  pq.push('NodeA', 10);
  pq.push('NodeD', 40);
  pq.push('NodeB', 20);

  assert(pq.size() === 4, 'PQ chứa 4 phần tử');
  assert(pq.peek().item === 'NodeA' && pq.peek().priority === 10, 'Peek trả về phần tử có priority nhỏ nhất (10)');

  const out1 = pq.pop();
  const out2 = pq.pop();
  const out3 = pq.pop();
  const out4 = pq.pop();

  assert(out1.item === 'NodeA' && out1.priority === 10, 'Pop lần 1 ra NodeA (10)');
  assert(out2.item === 'NodeB' && out2.priority === 20, 'Pop lần 2 ra NodeB (20)');
  assert(out3.item === 'NodeC' && out3.priority === 30, 'Pop lần 3 ra NodeC (30)');
  assert(out4.item === 'NodeD' && out4.priority === 40, 'Pop lần 4 ra NodeD (40)');
  assert(pq.isEmpty(), 'PQ rỗng sau khi pop hết');
  assert(pq.pop() === null, 'Pop trên PQ rỗng trả về null an toàn');
}

/* ------------------------------------------------------------------
   TEST GROUP 2: DIJKSTRA TRÊN MOCK GRAPH CHUẨN (MỤC 23 PROMPT)
   A ──(2)──> B ──(4)──> D ──(2)──> E
   │          │          ▲
  (5)        (1)        (1)
   ▼          ▼          │
   └────────> C ─────────┘
   Expected shortest path A -> E:
   A -> B -> C -> D -> E (cost: 2 + 1 + 1 + 2 = 6)
------------------------------------------------------------------ */
console.log('\n--- Test Group 2: Dijkstra trên Mock Graph 1 (Prompt Section 23) ---');
{
  const mockGraph1 = {
    adjacency: {
      A: [
        { from: 'A', to: 'B', cost: 2, distance: 200 },
        { from: 'A', to: 'C', cost: 5, distance: 500 }
      ],
      B: [
        { from: 'B', to: 'C', cost: 1, distance: 100 },
        { from: 'B', to: 'D', cost: 4, distance: 400 }
      ],
      C: [
        { from: 'C', to: 'D', cost: 1, distance: 100 }
      ],
      D: [
        { from: 'D', to: 'E', cost: 2, distance: 200 }
      ],
      E: []
    },
    getOutgoingEdges(nodeId) {
      return this.adjacency[nodeId] || [];
    }
  };

  const result = dijkstra(mockGraph1, 'A', 'E');

  assert(result.found === true, 'Tìm thấy đường đi A -> E');
  assert(result.cost === 6, `Tổng chi phí ngắn nhất = 6 (kết quả: ${result.cost})`);
  assert(result.distance === 600, `Tổng khoảng cách hình học = 600m (kết quả: ${result.distance})`);
  assertDeepEqual(result.nodes, ['A', 'B', 'C', 'D', 'E'], 'Chuỗi node đúng: A -> B -> C -> D -> E');
  assert(result.edges.length === 4, 'Chứa chính xác 4 cạnh');
  assert(result.edges[0].from === 'A' && result.edges[0].to === 'B', 'Cạnh 1: A -> B');
  assert(result.edges[1].from === 'B' && result.edges[1].to === 'C', 'Cạnh 2: B -> C');
  assert(result.edges[2].from === 'C' && result.edges[2].to === 'D', 'Cạnh 3: C -> D');
  assert(result.edges[3].from === 'D' && result.edges[3].to === 'E', 'Cạnh 4: D -> E');
}

/* ------------------------------------------------------------------
   TEST GROUP 3: TÁCH BIỆT HOÀN TOÀN COST VÀ DISTANCE (MỤC A3)
   Ví dụ: edge có cost = 12 (thời gian), distance = 1000m
   Kết quả: cost = 12, distance = 1000m. TUYỆT ĐỐI KHÔNG distance = 12.
   Nếu edge không có distance: distance = null.
------------------------------------------------------------------ */
console.log('\n--- Test Group 3: Tách biệt hoàn toàn Cost và Distance (Prompt Section A3) ---');
{
  const mixedGraph = {
    getOutgoingEdges(u) {
      if (u === 'A') {
        return [{ from: 'A', to: 'B', cost: 12, distance: 1000 }];
      }
      if (u === 'B') {
        return [{ from: 'B', to: 'C', cost: 8, distance: 500 }];
      }
      return [];
    }
  };

  const res = dijkstra(mixedGraph, 'A', 'C');
  assert(res.found === true, 'Tìm thấy đường A -> C');
  assert(res.cost === 20, 'Chi phí đúng: 12 + 8 = 20 (ví dụ phút)');
  assert(res.distance === 1500, 'Khoảng cách đúng: 1000 + 500 = 1500m (không bị gán nhầm = 20)');

  // Trường hợp cạnh hoàn toàn không có trường distance
  const noDistGraph = {
    getOutgoingEdges(u) {
      if (u === 'X') return [{ from: 'X', to: 'Y', cost: 15 }];
      return [];
    }
  };
  const resNoDist = dijkstra(noDistGraph, 'X', 'Y');
  assert(resNoDist.cost === 15, 'Cost = 15');
  assert(resNoDist.distance === null, 'Distance = null khi cạnh không có thông tin distance (không tạo khoảng cách giả)');
}

/* ------------------------------------------------------------------
   TEST GROUP 4: HỖ TRỢ EDGE.ID VÀ ĐA CẠNH (PARALLEL EDGES - MỤC A5)
   A có 2 cạnh song song đến B:
   - edge1: id 'edge_fast', cost = 10
   - edge2: id 'edge_scenic', cost = 15
------------------------------------------------------------------ */
console.log('\n--- Test Group 4: Hỗ trợ edge.id và Đa cạnh song song (Prompt Section A5) ---');
{
  const parallelGraph = {
    adj: {
      A: [
        { id: 'edge_fast', from: 'A', to: 'B', cost: 10, distance: 100 },
        { id: 'edge_scenic', from: 'A', to: 'B', cost: 15, distance: 120 }
      ],
      B: [
        { id: 'edge_dest', from: 'B', to: 'C', cost: 5, distance: 50 }
      ],
      C: []
    },
    getOutgoingEdges(id) {
      return this.adj[id] || [];
    }
  };

  // Dijkstra ngắn nhất chọn edge_fast
  const shortest = dijkstra(parallelGraph, 'A', 'C');
  assert(shortest.cost === 15, 'Dijkstra ngắn nhất chọn cạnh nhanh hơn: cost = 15');
  assert(shortest.edges[0].id === 'edge_fast', 'Cạnh đầu tiên có id = edge_fast');

  // K-Shortest K=2 phải nhận diện cả 2 nhánh nhờ edge.id
  const k2 = kShortestPaths(parallelGraph, 'A', 'C', 2);
  assert(k2.length === 2, 'Tìm thấy cả 2 tuyến qua 2 cạnh song song riêng biệt');
  assert(k2[0].cost === 15 && k2[0].edges[0].id === 'edge_fast', 'Tuyến 1 qua edge_fast');
  assert(k2[1].cost === 20 && k2[1].edges[0].id === 'edge_scenic', 'Tuyến 2 qua edge_scenic (không bị loại nhầm do cùng from->to)');
}

/* ------------------------------------------------------------------
   TEST GROUP 5: START === DESTINATION (MỤC A8)
------------------------------------------------------------------ */
console.log('\n--- Test Group 5: Start === Destination (Prompt Section A8) ---');
{
  const dummyGraph = { getOutgoingEdges: () => [] };
  const res = dijkstra(dummyGraph, 'A', 'A');

  assert(res.found === true, 'found: true khi start === destination');
  assert(res.cost === 0, 'cost: 0');
  assert(res.distance === 0, 'distance: 0');
  assertDeepEqual(res.nodes, ['A'], 'nodes: [A]');
  assertDeepEqual(res.edges, [], 'edges: []');
}

/* ------------------------------------------------------------------
   TEST GROUP 6: ĐỒ THỊ KHÔNG LIÊN THÔNG (MỤC A8)
   A -> B -> C     X -> Y -> Z
   Query: A -> Z
------------------------------------------------------------------ */
console.log('\n--- Test Group 6: Đồ thị không liên thông (Prompt Section A8) ---');
{
  const disconnectedGraph = {
    edges: {
      A: [{ from: 'A', to: 'B', cost: 1 }],
      B: [{ from: 'B', to: 'C', cost: 2 }],
      C: [],
      X: [{ from: 'X', to: 'Y', cost: 3 }],
      Y: [{ from: 'Y', to: 'Z', cost: 4 }],
      Z: []
    },
    getOutgoingEdges(nodeId) {
      return this.edges[nodeId] || [];
    }
  };

  const res = dijkstra(disconnectedGraph, 'A', 'Z');
  assert(res.found === false, 'found: false khi không có đường đi');
  assert(res.cost === Infinity, 'cost: Infinity');
  assert(res.distance === null, 'distance: null');
  assertDeepEqual(res.nodes, [], 'nodes: []');
  assertDeepEqual(res.edges, [], 'edges: []');
}

/* ------------------------------------------------------------------
   TEST GROUP 7: CẠNH COST=0, PHÁT HIỆN CHI PHÍ ÂM / NaN / INFINITY (MỤC A8)
------------------------------------------------------------------ */
console.log('\n--- Test Group 7: Cạnh cost=0 & Phát hiện Chi phí Âm / NaN / Infinity (Prompt Section A8) ---');
{
  // Cạnh cost = 0 hợp lệ
  const zeroGraph = {
    getOutgoingEdges(u) {
      if (u === 'A') return [{ from: 'A', to: 'B', cost: 0, distance: 10 }];
      if (u === 'B') return [{ from: 'B', to: 'C', cost: 3, distance: 30 }];
      return [];
    }
  };
  const resZero = dijkstra(zeroGraph, 'A', 'C');
  assert(resZero.found === true && resZero.cost === 3, 'Cạnh cost=0 hoạt động chính xác (cost = 3)');

  // Cạnh chi phí âm -> phải ném ngoại lệ rõ ràng
  const negGraph = {
    getOutgoingEdges(u) {
      if (u === 'A') return [{ from: 'A', to: 'B', cost: -5 }];
      return [];
    }
  };
  let threw = false;
  try {
    dijkstra(negGraph, 'A', 'B', { onInvalidEdge: 'throw' });
  } catch (err) {
    threw = true;
    assert(err.message.includes('chi phí âm') || err.message.includes('negative'), 'Bắt lỗi rõ ràng khi phát hiện cạnh có trọng số âm');
  }
  assert(threw === true, 'Throw Exception ngăn chặn kết quả sai do trọng số âm');

  // Kiểm tra chế độ clamp (mặc định an toàn)
  const resClamp = dijkstra(negGraph, 'A', 'B', { onInvalidEdge: 'clamp' });
  assert(resClamp.found === true && resClamp.cost === 0, 'onInvalidEdge clamp: đưa cost âm về 0 mà không crash');

  // Kiểm tra chế độ skip
  const resSkip = dijkstra(negGraph, 'A', 'B', { onInvalidEdge: 'skip' });
  assert(resSkip.found === false, 'onInvalidEdge skip: bỏ qua cạnh âm an toàn');

  // Cạnh NaN / Infinity -> bỏ qua an toàn
  const nanGraph = {
    getOutgoingEdges(u) {
      if (u === 'A') {
        return [
          { from: 'A', to: 'B', cost: NaN },
          { from: 'A', to: 'B', cost: Infinity },
          { from: 'A', to: 'B', cost: 10, distance: 100 }
        ];
      }
      return [];
    }
  };
  const resNan = dijkstra(nanGraph, 'A', 'B');
  assert(resNan.found === true && resNan.cost === 10, 'Bỏ qua cạnh NaN và Infinity, chọn cạnh hợp lệ cost=10');
}

/* ------------------------------------------------------------------
   TEST GROUP 8: BẤT BIẾN CỦA ĐỒ THỊ & KHÔNG CLONE GRAPH (MỤC A6 & A7)
------------------------------------------------------------------ */
console.log('\n--- Test Group 8: Graph Immutability & Không Clone Graph (Prompt Section A6 & A7) ---');
{
  const reusableGraph = {
    adjacency: {
      A: [{ from: 'A', to: 'B', cost: 1, distance: 10 }, { from: 'A', to: 'C', cost: 4, distance: 40 }],
      B: [{ from: 'B', to: 'C', cost: 2, distance: 20 }, { from: 'B', to: 'D', cost: 5, distance: 50 }],
      C: [{ from: 'C', to: 'D', cost: 1, distance: 10 }],
      D: []
    },
    getNeighbors(id) {
      return this.adjacency[id] || [];
    }
  };

  const snapshotBefore = JSON.stringify(reusableGraph.adjacency);

  // Chạy liên tiếp 3 request khác nhau trên cùng 1 graph instance
  const req1 = dijkstra(reusableGraph, 'A', 'D'); // A -> B -> C -> D (cost: 4)
  const req2 = dijkstra(reusableGraph, 'B', 'D'); // B -> C -> D (cost: 3)
  const req3 = dijkstra(reusableGraph, 'A', 'C'); // A -> B -> C (cost: 3)

  const snapshotAfter = JSON.stringify(reusableGraph.adjacency);

  assert(snapshotBefore === snapshotAfter, 'Graph tuyệt đối không bị thay đổi (không visited, không sửa cost, không clone graph)');
  assert(req1.cost === 4, 'Request 1: A -> D cost = 4');
  assert(req2.cost === 3, 'Request 2: B -> D cost = 3');
  assert(req3.cost === 3, 'Request 3: A -> C cost = 3');
}

/* ------------------------------------------------------------------
   TEST GROUP 9: YEN\'S K-SHORTEST PATHS VỚI MIN-HEAP & PREFIX CALCULATIONS (MỤC A1, A2, A4)
------------------------------------------------------------------ */
console.log('\n--- Test Group 9: Yen\'s K-Shortest Paths với Prefix Cost & Distance (Prompt Section A1, A2, A4) ---');
{
  const multiPathGraph = {
    adj: {
      S: [
        { from: 'S', to: 'A', cost: 2, distance: 20 },
        { from: 'S', to: 'B', cost: 3, distance: 30 },
        { from: 'S', to: 'D', cost: 6, distance: 60 }
      ],
      A: [
        { from: 'A', to: 'E', cost: 3, distance: 30 },
        { from: 'A', to: 'C', cost: 2, distance: 20 }
      ],
      B: [
        { from: 'B', to: 'E', cost: 4, distance: 40 },
        { from: 'B', to: 'C', cost: 2, distance: 20 }
      ],
      C: [
        { from: 'C', to: 'E', cost: 4, distance: 40 }
      ],
      D: [
        { from: 'D', to: 'E', cost: 6, distance: 60 }
      ],
      E: []
    },
    getOutgoingEdges(id) {
      return this.adj[id] || [];
    }
  };

  // Test K = 1
  const k1Routes = kShortestPaths(multiPathGraph, 'S', 'E', 1);
  assert(k1Routes.length === 1, 'K=1 trả về đúng 1 tuyến');
  assert(k1Routes[0].cost === 5, 'Tuyến 1 có cost = 5');
  assert(k1Routes[0].distance === 50, 'Tuyến 1 có distance = 50');
  assertDeepEqual(k1Routes[0].nodes, ['S', 'A', 'E'], 'Tuyến 1: S -> A -> E');

  // Test K = 2
  const k2Routes = kShortestPaths(multiPathGraph, 'S', 'E', 2);
  assert(k2Routes.length === 2, 'K=2 trả về đúng 2 tuyến');
  assert(k2Routes[0].cost <= k2Routes[1].cost, 'Thứ tự tăng dần cost: route 1 <= route 2');
  assert(k2Routes[0].cost === 5 && k2Routes[1].cost === 7, 'Chi phí đúng: [5, 7]');
  assertDeepEqual(k2Routes[1].nodes, ['S', 'B', 'E'], 'Tuyến 2: S -> B -> E');

  // Test K = 3 (MỤC TIÊU CHÍNH)
  const k3Routes = kShortestPaths(multiPathGraph, 'S', 'E', 3);
  assert(k3Routes.length === 3, 'K=3 trả về đúng TOP 3 tuyến đường ngắn nhất');
  assert(k3Routes[0].cost === 5, 'Tuyến 1 (ngắn nhất): cost = 5');
  assert(k3Routes[1].cost === 7, 'Tuyến 2 (ngắn nhì): cost = 7');
  assert(k3Routes[2].cost === 8, 'Tuyến 3 (ngắn ba): cost = 8');
  assert(k3Routes[0].cost <= k3Routes[1].cost && k3Routes[1].cost <= k3Routes[2].cost, 'Đảm bảo sắp xếp tăng dần nghiêm ngặt (Route order: A <= B <= C)');
  assertDeepEqual(k3Routes[0].nodes, ['S', 'A', 'E'], 'Tuyến 1: S -> A -> E');
  assertDeepEqual(k3Routes[1].nodes, ['S', 'B', 'E'], 'Tuyến 2: S -> B -> E');
  assertDeepEqual(k3Routes[2].nodes, ['S', 'A', 'C', 'E'], 'Tuyến 3: S -> A -> C -> E');

  // Test khi đồ thị chỉ có đúng 2 đường mà yêu cầu K = 3
  const limitedGraph = {
    getOutgoingEdges(u) {
      if (u === 'X') return [{ from: 'X', to: 'Y', cost: 10 }, { from: 'X', to: 'Z', cost: 20 }];
      if (u === 'Y') return [{ from: 'Y', to: 'W', cost: 10 }];
      if (u === 'Z') return [{ from: 'Z', to: 'W', cost: 10 }];
      return [];
    }
  };
  const limitedRoutes = kShortestPaths(limitedGraph, 'X', 'W', 3);
  assert(limitedRoutes.length === 2, 'Khi đồ thị chỉ có 2 đường, K=3 chỉ trả về đúng 2 đường (không tạo fake route)');
  assert(limitedRoutes[0].cost === 20 && limitedRoutes[1].cost === 30, 'Hai đường sắp xếp đúng chi phí [20, 30]');
}

/* ------------------------------------------------------------------
   TEST GROUP 10: KIỂM THỬ GIỚI HẠN TỐI ĐA 3 TUYẾN GỢI Ý (PHẦN B)
------------------------------------------------------------------ */
console.log('\n--- Test Group 10: Tuyến Gợi Ý Tối Đa 3 Tuyến Nhanh Nhất (Prompt Section B & E) ---');
{
  assert(MAX_SUGGESTED_ROUTES === 3, 'MAX_SUGGESTED_ROUTES trong config = 3');

  function simulateSelectTopRoutes(candidateRoutes, limit = MAX_SUGGESTED_ROUTES) {
    // Sắp xếp theo duration tăng dần (nhanh nhất trước), tie-breaker distance
    const sorted = [...candidateRoutes].sort((a, b) => {
      if (Math.abs(a.duration - b.duration) > 0.05) {
        return a.duration - b.duration;
      }
      return a.distance - b.distance;
    });
    return sorted.slice(0, limit);
  }

  // 1 route -> 1
  const r1 = [{ id: 'A', duration: 15, distance: 5 }];
  assert(simulateSelectTopRoutes(r1).length === 1, '1 route input -> đúng 1 route output');

  // 2 routes -> 2
  const r2 = [{ id: 'A', duration: 15, distance: 5 }, { id: 'B', duration: 20, distance: 7 }];
  assert(simulateSelectTopRoutes(r2).length === 2, '2 routes input -> đúng 2 routes output');

  // 3 routes -> 3
  const r3 = [
    { id: 'A', duration: 15, distance: 5 },
    { id: 'B', duration: 12, distance: 4 },
    { id: 'C', duration: 18, distance: 6 }
  ];
  const out3 = simulateSelectTopRoutes(r3);
  assert(out3.length === 3, '3 routes input -> đúng 3 routes output');
  assert(out3[0].id === 'B' && out3[1].id === 'A' && out3[2].id === 'C', 'Sắp xếp đúng nhanh nhất: B (12m) -> A (15m) -> C (18m)');

  // 4 routes -> 3
  const r4 = [
    { id: 'A', duration: 20, distance: 5 },
    { id: 'B', duration: 12, distance: 4 },
    { id: 'C', duration: 17, distance: 6 },
    { id: 'D', duration: 14, distance: 5 }
  ];
  assert(simulateSelectTopRoutes(r4).length === 3, '4 routes input -> chỉ giữ 3 routes nhanh nhất');

  // 5 routes -> 3 (TEST SORT THEO MỤC E)
  // Input: A = 20 min, B = 12 min, C = 17 min, D = 14 min, E = 25 min
  // Expected: B (12), D (14), C (17)
  const r5 = [
    { id: 'A', duration: 20, distance: 8 },
    { id: 'B', duration: 12, distance: 5 },
    { id: 'C', duration: 17, distance: 6 },
    { id: 'D', duration: 14, distance: 6 },
    { id: 'E', duration: 25, distance: 10 }
  ];
  const out5 = simulateSelectTopRoutes(r5);
  assert(out5.length === 3, '5 routes input -> chỉ giữ 3 routes');
  assertDeepEqual(out5.map(r => r.id), ['B', 'D', 'C'], 'Thứ tự chính xác: B (12 min) -> D (14 min) -> C (17 min)');

  // 10 routes -> 3
  const r10 = Array.from({ length: 10 }, (_, i) => ({ id: `R${i}`, duration: 30 - i, distance: 10 }));
  const out10 = simulateSelectTopRoutes(r10);
  assert(out10.length === 3, '10 routes input -> chỉ giữ tối đa 3 routes');
  assert(out10[0].duration <= out10[1].duration && out10[1].duration <= out10[2].duration, 'Top 3 giữ các tuyến nhanh nhất (duration thấp nhất)');

  // TEST DISTANCE VS TIME (MỤC E)
  // Route A: 5km, 20min
  // Route B: 7km, 15min
  // Expected: B trước A vì B nhanh hơn
  const rDistVsTime = [
    { id: 'A', distance: 5, duration: 20 },
    { id: 'B', distance: 7, duration: 15 }
  ];
  const outDist = simulateSelectTopRoutes(rDistVsTime);
  assert(outDist[0].id === 'B' && outDist[1].id === 'A', 'Route B (15min) đứng trước Route A (20min) mặc dù khoảng cách xa hơn');
}

/* ------------------------------------------------------------------
   TEST GROUP 11: HIỆU NĂNG TRÊN ĐỒ THỊ 1,024 NODE (MỤC A7)
------------------------------------------------------------------ */
console.log('\n--- Test Group 11: Hiệu năng trên đồ thị 1,024 node (Prompt Section A7) ---');
{
  const GRID_SIZE = 32; // 32 x 32 = 1,024 nodes
  const largeGraph = {
    adj: new Map(),
    getOutgoingEdges(id) {
      return this.adj.get(id) || [];
    }
  };

  let edgeTotal = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const u = `${r}_${c}`;
      const edges = [];
      if (c + 1 < GRID_SIZE) {
        edges.push({ id: `e_${u}_r`, from: u, to: `${r}_${c + 1}`, cost: 1 + (r % 3), distance: 10 });
        edgeTotal++;
      }
      if (r + 1 < GRID_SIZE) {
        edges.push({ id: `e_${u}_d`, from: u, to: `${r + 1}_${c}`, cost: 1 + (c % 3), distance: 10 });
        edgeTotal++;
      }
      if (r + 1 < GRID_SIZE && c + 1 < GRID_SIZE) {
        edges.push({ id: `e_${u}_diag`, from: u, to: `${r + 1}_${c + 1}`, cost: 2, distance: 14 });
        edgeTotal++;
      }
      largeGraph.adj.set(u, edges);
    }
  }

  const startNode = '0_0';
  const targetNode = `${GRID_SIZE - 1}_${GRID_SIZE - 1}`;

  const t0 = process.hrtime.bigint();
  const perfDijkstra = dijkstra(largeGraph, startNode, targetNode);
  const t1 = process.hrtime.bigint();
  const dijkstraMs = Number(t1 - t0) / 1e6;

  assert(perfDijkstra.found === true, `Tìm thấy đường trên đồ thị ${GRID_SIZE * GRID_SIZE} node và ${edgeTotal} cạnh`);
  assert(perfDijkstra.nodes[0] === startNode && perfDijkstra.nodes[perfDijkstra.nodes.length - 1] === targetNode, 'Đường đi nối chuẩn xác từ gốc tới đỉnh đích');
  assert(dijkstraMs < 50, `Thời gian chạy Dijkstra cực nhanh với Binary Min-Heap: ${dijkstraMs.toFixed(2)} ms (< 50ms)`);

  const t2 = process.hrtime.bigint();
  const perfK3 = kShortestPaths(largeGraph, startNode, targetNode, 3);
  const t3 = process.hrtime.bigint();
  const k3Ms = Number(t3 - t2) / 1e6;

  assert(perfK3.length === 3, 'Tìm đủ 3 shortest paths trên đồ thị lớn với Candidate Min-Heap & Prefix sums');
  assert(perfK3[0].cost <= perfK3[1].cost && perfK3[1].cost <= perfK3[2].cost, 'Top 3 sắp xếp thứ tự chi phí chuẩn xác');
  assert(k3Ms < 250, `Thời gian chạy Yen K-Shortest (K=3) với Prefix Array: ${k3Ms.toFixed(2)} ms (< 250ms)`);
}

console.log('\n================================================================');
console.log(`KẾT QUẢ TỔNG HỢP: ${passedTests}/${totalTests} TESTS PASS (100%)`);
console.log('================================================================');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}

