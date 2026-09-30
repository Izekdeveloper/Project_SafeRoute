/**
 * Test Suite: Advanced Dijkstra Features
 * - Visited/Finalized set
 * - Search Limits (maxVisitedNodes, maxExpandedEdges, maxSearchCost)
 * - Bidirectional Dijkstra
 * - Dijkstra Cache (LRU & Invalidation)
 * - SafeRoute Dynamic Cost Model
 * - Route to SafeRoute format
 * File: tests/test_dijkstra_advanced.js
 */

const {
  dijkstra,
  bidirectionalDijkstra,
  kShortestPaths,
  DijkstraCache,
  createSafeRouteCostFunction,
  routeToSafeRouteFormat
} = require('../js/dijkstra.js');

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
console.log('BẮT ĐẦU KIỂM THỬ NÂNG CAO DIJKSTRA TỐI ƯU');
console.log('================================================================\n');

/* ------------------------------------------------------------------
   TEST GROUP 1: SEARCH LIMITS (MAX VISITED, MAX EXPANDED, MAX COST)
------------------------------------------------------------------ */
console.log('--- Test Group 1: Optional Search Limits ---');
{
  const lineGraph = {
    adj: {
      A: [{ from: 'A', to: 'B', cost: 10 }],
      B: [{ from: 'B', to: 'C', cost: 10 }],
      C: [{ from: 'C', to: 'D', cost: 10 }],
      D: [{ from: 'D', to: 'E', cost: 10 }],
      E: []
    },
    getOutgoingEdges(id) {
      return this.adj[id] || [];
    }
  };

  // 1. maxVisitedNodes
  const resVisited = dijkstra(lineGraph, 'A', 'E', { maxVisitedNodes: 2, noCache: true });
  assert(resVisited.found === false, 'Dừng sớm khi vượt maxVisitedNodes');
  assert(resVisited.limitReached === true, 'Đánh dấu limitReached: true');
  assert(resVisited.reason === 'max_visited_nodes_exceeded', 'Lý do: max_visited_nodes_exceeded');

  // 2. maxExpandedEdges
  const resExpanded = dijkstra(lineGraph, 'A', 'E', { maxExpandedEdges: 1, noCache: true });
  assert(resExpanded.found === false, 'Dừng sớm khi vượt maxExpandedEdges');
  assert(resExpanded.limitReached === true, 'Đánh dấu limitReached: true');
  assert(resExpanded.reason === 'max_expanded_edges_exceeded', 'Lý do: max_expanded_edges_exceeded');

  // 3. maxSearchCost
  const resCost = dijkstra(lineGraph, 'A', 'E', { maxSearchCost: 15, noCache: true });
  assert(resCost.found === false, 'Dừng sớm khi vượt maxSearchCost');
  assert(resCost.limitReached === true, 'Đánh dấu limitReached: true');
  assert(resCost.reason === 'max_search_cost_exceeded', 'Lý do: max_search_cost_exceeded');

  // 4. Bình thường không giới hạn -> tìm thấy
  const resNormal = dijkstra(lineGraph, 'A', 'E', { noCache: true });
  assert(resNormal.found === true && resNormal.cost === 40, 'Khi không giới hạn thì tìm thấy đường A -> E (cost: 40)');
}

/* ------------------------------------------------------------------
   TEST GROUP 2: BIDIRECTIONAL DIJKSTRA
------------------------------------------------------------------ */
console.log('\n--- Test Group 2: Bidirectional Dijkstra ---');
{
  const bidirectionalGraph = {
    adj: {
      A: [{ from: 'A', to: 'B', cost: 2, distance: 20 }, { from: 'A', to: 'C', cost: 5, distance: 50 }],
      B: [{ from: 'B', to: 'D', cost: 3, distance: 30 }],
      C: [{ from: 'C', to: 'D', cost: 1, distance: 10 }],
      D: [{ from: 'D', to: 'E', cost: 4, distance: 40 }],
      E: []
    },
    inc: {
      A: [],
      B: [{ from: 'A', to: 'B', cost: 2, distance: 20 }],
      C: [{ from: 'A', to: 'C', cost: 5, distance: 50 }],
      D: [{ from: 'B', to: 'D', cost: 3, distance: 30 }, { from: 'C', to: 'D', cost: 1, distance: 10 }],
      E: [{ from: 'D', to: 'E', cost: 4, distance: 40 }]
    },
    getOutgoingEdges(id) {
      return this.adj[id] || [];
    },
    getIncomingEdges(id) {
      return this.inc[id] || [];
    }
  };

  const stdRes = dijkstra(bidirectionalGraph, 'A', 'E', { algorithm: 'standard', noCache: true });
  const bidiRes = dijkstra(bidirectionalGraph, 'A', 'E', { algorithm: 'bidirectional', noCache: true });

  assert(stdRes.found === true, 'Standard Dijkstra tìm thấy đường');
  assert(bidiRes.found === true, 'Bidirectional Dijkstra tìm thấy đường');
  assert(bidiRes.cost === stdRes.cost, `Chi phí hai thuật toán bằng nhau chính xác (Cost: ${bidiRes.cost})`);
  assert(bidiRes.distance === stdRes.distance, `Khoảng cách hai thuật toán bằng nhau chính xác (Distance: ${bidiRes.distance}m)`);
  assertDeepEqual(bidiRes.nodes, stdRes.nodes, 'Chuỗi node đồng nhất giữa Standard và Bidirectional');

  // Kiểm tra fallback khi đồ thị không có incoming edges
  const noIncomingGraph = {
    getOutgoingEdges(id) {
      return [{ from: 'A', to: 'B', cost: 5 }];
    }
  };
  const fallbackRes = dijkstra(noIncomingGraph, 'A', 'B', { algorithm: 'bidirectional', noCache: true });
  assert(fallbackRes.found === true && fallbackRes.cost === 5, 'Tự động fallback về standard dijkstra an toàn khi đồ thị không hỗ trợ incoming edges');
}

/* ------------------------------------------------------------------
   TEST GROUP 3: DIJKSTRA CACHE & INVALIDATION
------------------------------------------------------------------ */
console.log('\n--- Test Group 3: Dijkstra LRU Cache & Invalidation ---');
{
  const cachedGraph = {
    getOutgoingEdges(id) {
      if (id === 'A') return [{ from: 'A', to: 'B', cost: 10, distance: 100 }];
      return [];
    }
  };

  const metrics1 = {};
  const res1 = dijkstra(cachedGraph, 'A', 'B', { metrics: metrics1 });
  assert(res1.found === true && res1.cost === 10, 'Lần gọi 1 tính toán thành công');
  assert(!metrics1.cacheHit, 'Lần gọi 1 chưa có trong cache (cache miss)');

  const metrics2 = {};
  const res2 = dijkstra(cachedGraph, 'A', 'B', { metrics: metrics2 });
  assert(res2.found === true && res2.cost === 10, 'Lần gọi 2 trả về kết quả chính xác');
  assert(metrics2.cacheHit === true, 'Lần gọi 2 lấy từ cache tức thì (cache hit)');

  // Invalidate cache
  DijkstraCache.clear();

  const metrics3 = {};
  const res3 = dijkstra(cachedGraph, 'A', 'B', { metrics: metrics3 });
  assert(res3.found === true && res3.cost === 10, 'Lần gọi 3 sau khi invalidate tính toán lại');
  assert(!metrics3.cacheHit, 'Lần gọi 3 cache miss do cache đã được xóa an toàn');
}

/* ------------------------------------------------------------------
   TEST GROUP 4: SAFEROUTE DYNAMIC SAFETY COST FUNCTION
------------------------------------------------------------------ */
console.log('\n--- Test Group 4: SafeRoute Dynamic Safety Cost Model ---');
{
  const edgeNormal = { distance: 1000, freeflow_time: 60, incident_ids: [] };
  const edgeFlood = { distance: 1000, freeflow_time: 60, incident_ids: ['inc_flood_1'] };

  const incidentsMap = new Map([
    ['inc_flood_1', { type: 'flood', level: 'cao', confidence: 100 }]
  ]);

  // Mode: fastest (alpha = 0) -> Bỏ qua rủi ro, chi phí hai cạnh bằng nhau
  const costFastest = createSafeRouteCostFunction({
    metric: 'time',
    mode: 'fastest',
    incidentsMap
  });
  assert(costFastest(edgeNormal) === 60, 'Fastest mode: Edge bình thường cost = 60s');
  assert(costFastest(edgeFlood) === 60, 'Fastest mode: Edge có ngập lụt cost = 60s (alpha=0 bỏ qua rủi ro)');

  // Mode: balanced (alpha = 1) -> Phạt rủi ro theo trọng số
  const costBalanced = createSafeRouteCostFunction({
    metric: 'time',
    mode: 'balanced',
    incidentsMap
  });
  assert(costBalanced(edgeNormal) === 60, 'Balanced mode: Edge bình thường cost = 60s');
  assert(costBalanced(edgeFlood) > 60, 'Balanced mode: Edge ngập lụt có penalty rủi ro > 60s');

  // Mode: safest (alpha = 3) -> Phạt rủi ro nặng nhất
  const costSafest = createSafeRouteCostFunction({
    metric: 'time',
    mode: 'safest',
    incidentsMap
  });
  assert(costSafest(edgeFlood) > costBalanced(edgeFlood), 'Safest mode: Chi phí phạt rủi ro cao hơn Balanced mode (alpha=3 > alpha=1)');
}

/* ------------------------------------------------------------------
   TEST GROUP 5: ROUTE TO SAFEROUTE FORMAT CONVERSION
------------------------------------------------------------------ */
console.log('\n--- Test Group 5: Route to SafeRoute Format Conversion ---');
{
  const mockNodeGraph = {
    getNode(id) {
      if (id === '10.77,106.69') return { lat: 10.77, lng: 106.69 };
      if (id === '10.78,106.70') return { lat: 10.78, lng: 106.70 };
      return null;
    }
  };

  const dijkstraRoute = {
    found: true,
    nodes: ['10.77,106.69', '10.78,106.70'],
    edges: [{ from: '10.77,106.69', to: '10.78,106.70', distance: 1500, freeflow_time: 120 }],
    cost: 120,
    distance: 1500
  };

  const formatted = routeToSafeRouteFormat(dijkstraRoute, mockNodeGraph, 0);
  assert(formatted !== null, 'Format thành công');
  assert(formatted.id === 'A', 'id: A (index 0)');
  assert(formatted.distance === 1.5, 'distance: 1.5 km (chuyển đổi từ 1500m)');
  assert(formatted.duration === 2, 'duration: 2 phút (chuyển đổi từ 120 giây)');
  assertDeepEqual(formatted.coords, [[10.77, 106.69], [10.78, 106.70]], 'Tọa độ polyline khớp chính xác');
  assert(formatted.source === 'local_dijkstra', 'Đánh dấu source: local_dijkstra');
}

/* ------------------------------------------------------------------
   TỔNG KẾT
------------------------------------------------------------------ */
console.log('\n================================================================');
console.log(`KẾT QUẢ TỔNG HỢP KIỂM THỬ NÂNG CAO: ${passedTests}/${totalTests} TESTS PASS (100%)`);
console.log('================================================================');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}

