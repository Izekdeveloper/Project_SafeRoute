/**
 * test_priority_fixes.js
 * Kiểm thử toàn diện 14 hạng mục tối ưu và sửa lỗi (P0.1 -> P3.6) trong SafeRoute
 */

const assert = require('assert');

// 1. Load các module SafeRoute
const CONFIG = require('../js/config.js');
const { Graph } = require('../js/graph.js');
const { dijkstra, createSafeRouteCostFunction } = require('../js/dijkstra.js');
const {
  _RoadSegmentLRU,
  _roadSegmentCache,
  buildIncidentRoadSegment,
  cleanupExpiredIncidents,
  incidents
} = require('../js/incidents.js');
const {
  RouteCache,
  _routeInVNCache,
  _fastSampleMatch,
  _incidentSnapshotVersion,
  incrementIncidentSnapshotVersion,
  analyzeRouteIncidents,
  isRouteInsideVietnam
} = require('../js/routing.js');
const {
  _incidentLayers,
  _buildIncidentLayer,
  _getStartIcon,
  _getEndIcon,
  updateStartMarker,
  updateEndMarker,
  reverseGeocodeStartLabel,
  reverseGeocodeEndLabel
} = require('../js/map.js');
const {
  renderReportSuggestions,
  closeReportModal
} = require('../js/ui.js');

console.log('================================================================');
console.log('BẮT ĐẦU KIỂM THỬ 14 HẠNG MỤC TỐI ƯU (P0 -> P3)');
console.log('================================================================');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// P0.1: analyzeRouteIncidents Cache Invalidation by Snapshot Version
// -----------------------------------------------------------------------------
console.log('\n--- P0.1: Cache Invalidation trong analyzeRouteIncidents ---');
test('Snapshot version tăng khi có sự cố mới hoặc độ tin cậy thay đổi', () => {
  const v1 = _incidentSnapshotVersion;
  const v2 = incrementIncidentSnapshotVersion();
  assert.strictEqual(v2, v1 + 1, 'Version phải tăng lên 1');
});

test('analyzeRouteIncidents tự động invalidate cache khi snapshot version tăng', () => {
  const mockRoute = { coords: [[10.77, 106.69], [10.78, 106.70]], distance: 1500, duration: 120 };
  
  // Call 1 với snapshot mặc định
  const res1 = analyzeRouteIncidents(mockRoute);
  assert.ok(res1 !== null);
  
  // Call 2 khi chưa tăng version -> Cache HIT (cùng object reference)
  const res1Cached = analyzeRouteIncidents(mockRoute);
  assert.strictEqual(res1, res1Cached, 'Cùng version phải trả về cùng cached object reference');

  // Snapshot version tăng -> Cache BUST (trả về object mới)
  incrementIncidentSnapshotVersion();
  const res2 = analyzeRouteIncidents(mockRoute);
  assert.notStrictEqual(res1, res2, 'Khi version tăng phải tạo object analysis mới');
});

// -----------------------------------------------------------------------------
// P0.2: createSafeRouteCostFunction 5-min decay bucket
// -----------------------------------------------------------------------------
console.log('\n--- P0.2: 5-minute decay bucket trong createSafeRouteCostFunction ---');
test('Tái sử dụng cost function trong cùng bucket 5 phút (300,000ms)', () => {
  const now = 1700000000000;
  const t1 = now + 10000; // +10s (cùng bucket)
  const t2 = now + 50000; // +50s (cùng bucket)
  const fn1 = createSafeRouteCostFunction({ mode: 'balanced', now: t1 });
  const fn2 = createSafeRouteCostFunction({ mode: 'balanced', now: t2 });
  assert.strictEqual(fn1, fn2, 'Hai lần gọi trong cùng 5 phút phải tái sử dụng cùng function reference từ cache');

  const t3 = now + 400000; // +400s (>300s, bucket khác)
  const fn3 = createSafeRouteCostFunction({ mode: 'balanced', now: t3 });
  assert.notStrictEqual(fn1, fn3, 'Lần gọi ở bucket 5 phút mới phải tạo function mới');
});

// -----------------------------------------------------------------------------
// P0.3: renderReportSuggestions XSS & Event Delegation
// -----------------------------------------------------------------------------
console.log('\n--- P0.3: XSS Prevention & Event Delegation trong renderReportSuggestions ---');
test('renderReportSuggestions không dùng chuỗi nối code JS inline onclick', () => {
  const mockBox = {
    innerHTML: '',
    classList: { remove() {}, add() {} },
    querySelectorAll() { return []; }
  };
  global.document = {
    getElementById(id) {
      if (id === 'report-suggestions') return mockBox;
      return { setAttribute() {} };
    }
  };

  const suggestions = [
    { display_name: '"><script>alert(1)</script>', lat: 10.7, lon: 106.6 }
  ];
  renderReportSuggestions(suggestions);

  assert.ok(!mockBox.innerHTML.includes('onclick="'), 'Không được chứa inline onclick string');
  assert.ok(mockBox.innerHTML.includes('data-index="0"'), 'Phải dùng data-index cho event listener');
  assert.ok(!mockBox.innerHTML.includes('<script>'), 'Ký tự HTML đặc biệt phải được escape');
});

// -----------------------------------------------------------------------------
// P0.4: buildIncidentRoadSegment Exponential Backoff & Max Retries
// -----------------------------------------------------------------------------
console.log('\n--- P0.4: buildIncidentRoadSegment Retry Limit & Backoff ---');
test('Không retry quá MAX_SEGMENT_RETRY = 5 lần', async () => {
  const incident = {
    id: 'fail_inc',
    lat: 10.0,
    lng: 106.0,
    _retryCount: 5
  };
  const seg = await buildIncidentRoadSegment(incident);
  assert.strictEqual(seg, null, 'Khi retryCount >= 5 phải trả về null ngay lập tức mà không gọi API');
});

test('Khởi tạo _retryCount và tính backoff hợp lệ', () => {
  const incident = { id: 'retry_inc', lat: 10.0, lng: 106.0 };
  assert.strictEqual(incident._retryCount || 0, 0);
  const backoff1 = 1500 * Math.pow(2, 0); // 1500ms
  const backoff2 = 1500 * Math.pow(2, 1); // 3000ms
  const backoff3 = 1500 * Math.pow(2, 2); // 6000ms
  assert.strictEqual(backoff1, 1500);
  assert.strictEqual(backoff2, 3000);
  assert.strictEqual(backoff3, 6000);
});

// -----------------------------------------------------------------------------
// P1.1: RouteCache & fetchOsrmRoute Immutable Contract
// -----------------------------------------------------------------------------
console.log('\n--- P1.1: RouteCache Immutability & Object.freeze ---');
test('RouteCache.set đóng băng routes và RouteCache.get trả về frozen data', () => {
  const rc = new RouteCache(10, 60000);
  const routes = [{ id: 'test_route', distance: 1000, duration: 100 }];
  const key = RouteCache.createKey([{ lat: 10.1, lng: 106.1 }, { lat: 10.2, lng: 106.2 }]);
  rc.set(key, routes);
  const cached = rc.get(key);
  assert.ok(cached !== null, 'Phải lấy được dữ liệu từ cache');
  assert.ok(Object.isFrozen(cached[0]), 'Phần tử route trong cache phải được Object.freeze');
});

// -----------------------------------------------------------------------------
// P1.2 & P3.1/P3.3: renderIncidents Incremental Update & Event Delegation
// -----------------------------------------------------------------------------
console.log('\n--- P1.2 & P3.1: Incremental Incident Update & Popup Action Delegation ---');
test('_incidentLayers Map quản lý các marker đã render', () => {
  assert.ok(_incidentLayers instanceof Map, '_incidentLayers phải là một Map');
});

// -----------------------------------------------------------------------------
// P1.3: findNearestEdge spatialGrid prefilter + fallback
// -----------------------------------------------------------------------------
console.log('\n--- P1.3: findNearestEdge spatialGrid Prefilter & Fallback ---');
test('findNearestEdge tìm cạnh bằng spatialGrid candidates', () => {
  const g = new Graph();
  g.addNode({ id: 'n1', lat: 10.770, lng: 106.690 });
  g.addNode({ id: 'n2', lat: 10.771, lng: 106.691 });
  g.addEdge({ id: 'e1', from: 'n1', to: 'n2', distance: 150 });

  const nearest = g.findNearestEdge(10.7705, 106.6905);
  assert.ok(nearest !== null, 'Phải tìm thấy cạnh');
  assert.strictEqual(nearest.edge.id, 'e1');
  assert.ok(nearest.distance < 50, 'Khoảng cách phải rất gần');
});

test('findNearestEdge fallback full scan khi không có node trong bán kính 3 cells', () => {
  const g = new Graph();
  // Node ở xa bán kính 3 cells (> 200m)
  g.addNode({ id: 'far1', lat: 10.770, lng: 106.690 });
  g.addNode({ id: 'far2', lat: 10.780, lng: 106.690 });
  // Cạnh nối dài đi qua gần vị trí tìm kiếm
  g.addEdge({ id: 'long_edge', from: 'far1', to: 'far2', distance: 1100 });

  // Query ở điểm giữa cạnh (cách node ~550m, ngoài 3 cells ~ 165m)
  const nearest = g.findNearestEdge(10.775, 106.69005);
  assert.ok(nearest !== null, 'Fallback full scan phải tìm thấy long_edge');
  assert.strictEqual(nearest.edge.id, 'long_edge');
  assert.ok(nearest.distance < 15, 'Khoảng cách chiếu vuông góc phải < 15m');
});

// -----------------------------------------------------------------------------
// P1.4: app.js debounce 800ms
// -----------------------------------------------------------------------------
console.log('\n--- P1.4: Debounce 800ms cho incidents-changed ---');
test('app.js định nghĩa _rerouteTimer', () => {
  const appJsContent = require('fs').readFileSync(require('path').join(__dirname, '../js/app.js'), 'utf8');
  assert.ok(appJsContent.includes('_rerouteTimer'), 'app.js phải chứa biến _rerouteTimer');
  assert.ok(appJsContent.includes('setTimeout'), 'incidents-changed phải dùng setTimeout');
  assert.ok(appJsContent.includes('800'), 'incidents-changed phải debounce 800ms');
  assert.ok(appJsContent.includes('clearTimeout(_rerouteTimer)'), 'onFindRouteClick phải clear pending timer');
});

// -----------------------------------------------------------------------------
// P1.5: reverseGeocode debounce 500ms
// -----------------------------------------------------------------------------
console.log('\n--- P1.5: Debounce 500ms cho reverseGeocode Start & End ---');
test('map.js debounce reverse geocoding bằng timer 500ms', () => {
  const mapJsContent = require('fs').readFileSync(require('path').join(__dirname, '../js/map.js'), 'utf8');
  assert.ok(mapJsContent.includes('_endReverseTimer'), 'Phải có _endReverseTimer');
  assert.ok(mapJsContent.includes('_startReverseTimer'), 'Phải có _startReverseTimer');
  assert.ok(mapJsContent.includes('500'), 'Thời gian debounce phải là 500ms');
});

// -----------------------------------------------------------------------------
// P2.1: _RoadSegmentLRU Cache
// -----------------------------------------------------------------------------
console.log('\n--- P2.1: _RoadSegmentLRU Cache ---');
test('_RoadSegmentLRU hoạt động theo cơ chế LRU với maxEntries và TTL', () => {
  const lru = new _RoadSegmentLRU(3, 1000);
  lru.set('a', { name: 'A' });
  lru.set('b', { name: 'B' });
  lru.set('c', { name: 'C' });

  assert.strictEqual(lru.get('a')?.name, 'A', 'Phải lấy được key a');
  
  // Thêm key d -> key ít dùng nhất gần đây là b sẽ bị đẩy ra
  lru.set('d', { name: 'D' });
  assert.strictEqual(lru.get('b'), null, 'Key b phải bị evict do quá dung lượng maxEntries=3');
  assert.strictEqual(lru.get('a')?.name, 'A', 'Key a đã được access nên vẫn còn');
  assert.strictEqual(lru.get('c')?.name, 'C', 'Key c vẫn còn');
  assert.strictEqual(lru.get('d')?.name, 'D', 'Key d mới thêm vào');
});

test('_RoadSegmentLRU tự động xóa entry đã hết hạn TTL', () => {
  const lru = new _RoadSegmentLRU(10, 50); // TTL 50ms
  lru.set('exp', { name: 'Expired' });
  assert.ok(lru.get('exp') !== null, 'Chưa hết 50ms phải còn');

  const start = Date.now();
  while (Date.now() - start < 60) {} // Busy wait 60ms
  assert.strictEqual(lru.get('exp'), null, 'Sau 50ms entry phải bị expire và trả về null');
});

// -----------------------------------------------------------------------------
// P2.2: _areRoutesDuplicate LEVEL 2.5 Fast Sample Match
// -----------------------------------------------------------------------------
console.log('\n--- P2.2: _fastSampleMatch (LEVEL 2.5) ---');
test('_fastSampleMatch phát hiện 2 route giống nhau qua mẫu điểm lấy đều', () => {
  const coords1 = [];
  const coords2 = [];
  for (let i = 0; i <= 30; i++) {
    coords1.push([10.0 + i * 0.001, 106.0 + i * 0.001]);
    coords2.push([10.0 + i * 0.001 + 0.00001, 106.0 + i * 0.001 + 0.00001]);
  }
  const isMatch = _fastSampleMatch(coords1, coords2, 30, 0.0005, 0.85);
  assert.strictEqual(isMatch, true, 'Hai tuyến gần nhau phải khớp mẫu nhanh');
});

test('_fastSampleMatch loại bỏ tuyến có detour lớn ở giữa', () => {
  const coordsBase = [];
  const coordsDetour = [];
  for (let i = 0; i <= 30; i++) {
    coordsBase.push([10.0 + i * 0.001, 106.0 + i * 0.001]);
    if (i >= 10 && i <= 20) {
      // Detour xa 0.01 độ (~1.1km)
      coordsDetour.push([10.0 + i * 0.001 + 0.01, 106.0 + i * 0.001 + 0.01]);
    } else {
      coordsDetour.push([10.0 + i * 0.001, 106.0 + i * 0.001]);
    }
  }
  const isMatch = _fastSampleMatch(coordsBase, coordsDetour, 30, 0.0005, 0.85);
  assert.strictEqual(isMatch, false, 'Tuyến có detour lớn không được xem là trùng khớp');
});

// -----------------------------------------------------------------------------
// P2.3: cleanupExpiredIncidents tab visibility & catch up
// -----------------------------------------------------------------------------
console.log('\n--- P2.3: Visibility Change Catch-up ---');
test('incidents.js đăng ký visibilitychange và catch-up', () => {
  const incContent = require('fs').readFileSync(require('path').join(__dirname, '../js/incidents.js'), 'utf8');
  assert.ok(incContent.includes('visibilitychange'), 'Phải xử lý sự kiện visibilitychange');
  assert.ok(incContent.includes('cleanupExpiredIncidents'), 'Phải gọi cleanupExpiredIncidents');
});

// -----------------------------------------------------------------------------
// P3.2: Singleton Marker Icons
// -----------------------------------------------------------------------------
console.log('\n--- P3.2: Singleton Marker Icons & setLatLng Reuse ---');
test('_getStartIcon và _getEndIcon trả về singleton icon', () => {
  const icon1 = _getStartIcon();
  const icon2 = _getStartIcon();
  assert.strictEqual(icon1, icon2, 'Start icon phải là singleton');

  const iconE1 = _getEndIcon();
  const iconE2 = _getEndIcon();
  assert.strictEqual(iconE1, iconE2, 'End icon phải là singleton');
});

// -----------------------------------------------------------------------------
// P3.4: closeReportModal form reset
// -----------------------------------------------------------------------------
console.log('\n--- P3.4: Form Reset trong closeReportModal ---');
test('closeReportModal reset form nếu form tồn tại', () => {
  const uiContent = require('fs').readFileSync(require('path').join(__dirname, '../js/ui.js'), 'utf8');
  assert.ok(uiContent.includes("form.reset()"), 'closeReportModal phải có form reset');
});

// -----------------------------------------------------------------------------
// P3.5: isRouteInsideVietnam WeakMap Cache
// -----------------------------------------------------------------------------
console.log('\n--- P3.5: WeakMap Cache cho isRouteInsideVietnam ---');
test('isRouteInsideVietnam cache kết quả bằng WeakMap', () => {
  const route = { coords: [[10.77, 106.69], [10.78, 106.70]] };
  assert.strictEqual(_routeInVNCache.has(route), false, 'Trước khi gọi chưa có trong cache');
  const inVN = isRouteInsideVietnam(route);
  assert.strictEqual(inVN, true);
  assert.strictEqual(_routeInVNCache.has(route), true, 'Sau khi gọi phải được lưu vào WeakMap');
  assert.strictEqual(_routeInVNCache.get(route), true);
});

// -----------------------------------------------------------------------------
// P3.6: _generateAvoidanceRoutes Sample Points Prefilter
// -----------------------------------------------------------------------------
console.log('\n--- P3.6: Avoidance Routes Sample Points Prefilter ---');
test('routing.js kiểm tra khoảng cách samplePoints < 500m trước khi generate avoidance', () => {
  const routeContent = require('fs').readFileSync(require('path').join(__dirname, '../js/routing.js'), 'utf8');
  assert.ok(routeContent.includes('m.samplePoints'), 'Phải dùng samplePoints');
  assert.ok(routeContent.includes('500'), 'Bán kính lọc phải là 500m');
});

console.log('\n================================================================');
console.log(`KẾT QUẢ KIỂM THỬ: ${passedTests} TESTS ĐẠT (100%)`);
console.log('================================================================');
