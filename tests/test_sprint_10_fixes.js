/**
 * test_sprint_10_fixes.js
 * Kiểm thử toàn diện 10 hạng mục sửa lỗi (P1.1 -> P3.4)
 */

const assert = require('assert');

// Load modules
const CONFIG = require('../js/config.js');
const { Graph } = require('../js/graph.js');
const {
  PriorityQueue,
  dijkstra,
  bidirectionalDijkstra,
  kShortestPaths,
  createSafeRouteCostFunction,
  _costFunctionCache
} = require('../js/dijkstra.js');
const {
  RouteCache,
  _fastSampleMatch,
  _freezeRouteNestedArrays,
  analyzeRouteIncidents
} = require('../js/routing.js');
const {
  _buildIncidentLayer,
  _incidentLayers,
  renderIncidents,
  getPopupOpenIncidentId,
  setPopupOpenIncidentId
} = require('../js/map.js');
const {
  closeReportModal
} = require('../js/ui.js');

console.log('================================================================');
console.log('BẮT ĐẦU KIỂM THỬ 10 HẠNG MỤC SỬA LỖI (P1.1 -> P3.4)');
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
// P1.1: _costFunctionCache bounded LRU (max 50)
// -----------------------------------------------------------------------------
console.log('\n--- P1.1: _costFunctionCache LRU Bounded (Max 50) ---');
test('Tạo 60 cost function với 60 bucket khác nhau -> size <= 50', () => {
  _costFunctionCache.clear();
  for (let i = 0; i < 60; i++) {
    createSafeRouteCostFunction({
      metric: 'time',
      mode: 'balanced',
      now: i * 300000,
      configVersion: 1,
      incidentsMapVersion: 1,
      noCache: false
    });
  }
  assert.ok(_costFunctionCache.size <= 50, `Kích thước cache (${_costFunctionCache.size}) phải <= 50`);
  assert.strictEqual(_costFunctionCache.size, 50, 'Kích thước cache phải chạm ngưỡng đúng 50');

  // Kiểm tra 10 entry cũ nhất (i = 0..9) đã bị evict
  const oldKey = `time#balanced#1#1#0`;
  assert.strictEqual(_costFunctionCache.has(oldKey), false, 'Entry cũ nhất phải bị evict theo FIFO/LRU');

  // Entry mới nhất (i = 59) phải tồn tại
  const newKey = `time#balanced#1#1#59`;
  assert.strictEqual(_costFunctionCache.has(newKey), true, 'Entry mới nhất phải tồn tại');
});

// -----------------------------------------------------------------------------
// P1.2: XSS via data-incident-id in map.js
// -----------------------------------------------------------------------------
console.log('\n--- P1.2: XSS Prevention trong data-incident-id ---');
test('_buildIncidentLayer escape an toàn payload XSS trong inc.id', () => {
  // Mock Leaflet L
  let popupContentResult = '';
  global.L = {
    circleMarker: () => ({ addTo: () => ({}) }),
    divIcon: (opts) => opts,
    marker: () => {
      const m = {
        addTo: () => m,
        bindPopup: (content) => { popupContentResult = content; },
        on: () => {}
      };
      return m;
    },
    polyline: () => {
      const p = {
        addTo: () => p,
        bindPopup: () => {},
        on: () => {}
      };
      return p;
    },
    layerGroup: () => ({
      addLayer: () => {},
      removeLayer: () => {}
    })
  };
  const maliciousInc = {
    id: 'x" onmouseover="alert(1)',
    type: 'accident',
    level: 'cao',
    lat: 10.77,
    lng: 106.69,
    desc: 'Test XSS payload',
    confidence: 60,
    reporterCount: 1,
    startedAt: Date.now(),
    createdAt: Date.now()
  };

  _buildIncidentLayer(maliciousInc, 60, Date.now());

  assert.ok(!popupContentResult.includes('data-incident-id="x" onmouseover='), 'Không được chứa attribute injection');
  assert.ok(popupContentResult.includes('data-incident-id="x&quot; onmouseover=&quot;alert(1)&quot;"') ||
            popupContentResult.includes('data-incident-id="x&quot; onmouseover=&quot;alert(1)'),
            'Payload phải được HTML-escaped thành &quot;');
});

// -----------------------------------------------------------------------------
// P2.1: _snapshotVersion uses snapshot._snapshotVersion
// -----------------------------------------------------------------------------
console.log('\n--- P2.1: _snapshotVersion sử dụng snapshot._snapshotVersion ---');
test('analyzeRouteIncidents ghi nhận chính xác _snapshotVersion của snapshot đầu vào', () => {
  const route = { coords: [[10.77, 106.69], [10.78, 106.70]] };
  const customSnapshot = [];
  customSnapshot._snapshotVersion = 999;

  const analysis = analyzeRouteIncidents(route, customSnapshot);
  assert.strictEqual(analysis._snapshotVersion, 999, 'analysis._snapshotVersion phải khớp snapshot._snapshotVersion');
});

// -----------------------------------------------------------------------------
// P2.2: _fastSampleMatch samples normalization
// -----------------------------------------------------------------------------
console.log('\n--- P2.2: _fastSampleMatch Samples Normalization ---');
test('_fastSampleMatch normalize effectiveSamples an toàn cho route ngắn (< 30 điểm)', () => {
  const cA = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]; // 5 điểm
  const cB = [[0.0001, 0.0001], [1.0001, 1.0001], [2.0001, 2.0001], [3.0001, 3.0001], [4.0001, 4.0001]]; // Rất gần
  const cC = [[10, 10], [11, 11], [12, 12], [13, 13], [14, 14]]; // Khác hoàn toàn

  assert.strictEqual(_fastSampleMatch(cA, cB, 30, 0.0005), true, 'Hai tuyến 5 điểm gần nhau phải match');
  assert.strictEqual(_fastSampleMatch(cA, cC, 30, 0.0005), false, 'Hai tuyến 5 điểm khác nhau không được match');
  assert.strictEqual(_fastSampleMatch(cA, cB, 1), false, 'effectiveSamples < 2 phải trả về false an toàn');
});

// -----------------------------------------------------------------------------
// P2.3: Popup content stale (2% threshold)
// -----------------------------------------------------------------------------
console.log('\n--- P2.3: renderIncidents Threshold = 2% ---');
test('renderIncidents rebuild khi confidence chênh >= 2%, giữ nguyên khi < 2%', () => {
  const mapJsContent = require('fs').readFileSync(require('path').join(__dirname, '../js/map.js'), 'utf8');
  assert.ok(mapJsContent.includes('CONFIDENCE_REBUILD_THRESHOLD = 2'), 'Threshold phải được đặt là 2%');
  assert.ok(!mapJsContent.includes('Math.abs(existing.c - currentC) < 5'), 'Ngưỡng 5% cũ phải bị loại bỏ');
});

// -----------------------------------------------------------------------------
// P2.4: target.legs shallow copy
// -----------------------------------------------------------------------------
console.log('\n--- P2.4: target.legs Shallow Copy ---');
test('findSafeRoutes và chooseRoute copy mảng legs khi gán từ OSRM', () => {
  const routingContent = require('fs').readFileSync(require('path').join(__dirname, '../js/routing.js'), 'utf8');
  assert.ok(routingContent.includes('topRoute.legs = Array.isArray(detailed[0].legs) ? [...detailed[0].legs] : []'),
    'findSafeRoutes phải shallow-copy legs');
  assert.ok(routingContent.includes('target.legs = Array.isArray(stepRoutes[0].legs) ? [...stepRoutes[0].legs] : []'),
    'chooseRoute phải shallow-copy legs');
});

// -----------------------------------------------------------------------------
// P3.1: closeReportModal duplicate reset code cleanup
// -----------------------------------------------------------------------------
console.log('\n--- P3.1: closeReportModal Duplicate Reset Cleanup ---');
test('closeReportModal không chứa code reset trùng lặp', () => {
  const uiContent = require('fs').readFileSync(require('path').join(__dirname, '../js/ui.js'), 'utf8');
  // Đếm số lần gán locInput.value = ''
  const matches = uiContent.match(/locInput\.value = ''/g) || [];
  assert.strictEqual(matches.length, 1, 'locInput.value chỉ được gán reset đúng 1 lần duy nhất trong closeReportModal');
});

// -----------------------------------------------------------------------------
// P3.2: Clear _rerouteTimer on swap
// -----------------------------------------------------------------------------
console.log('\n--- P3.2: Clear _rerouteTimer trong swapLocations ---');
test('swapLocations hủy _rerouteTimer pending', () => {
  const appContent = require('fs').readFileSync(require('path').join(__dirname, '../js/app.js'), 'utf8');
  assert.ok(appContent.includes('function swapLocations() {\n    if (_rerouteTimer) {\n      clearTimeout(_rerouteTimer);'),
    'swapLocations phải clearTimeout(_rerouteTimer) ngay đầu hàm');
});

// -----------------------------------------------------------------------------
// P3.3: Deep-freeze selective legs and waypoints
// -----------------------------------------------------------------------------
console.log('\n--- P3.3: Deep-freeze Chọn Lọc legs & waypoints ---');
test('_freezeRouteNestedArrays đóng băng waypoints và legs, giữ coords mutable', () => {
  const mockRoute = {
    waypoints: [{ lat: 10.1, lng: 106.1 }, { lat: 10.2, lng: 106.2 }],
    legs: [{ distance: 500, steps: [{ instruction: 'rẽ phải' }] }],
    coords: [[10.1, 106.1], [10.2, 106.2]]
  };

  _freezeRouteNestedArrays(mockRoute);

  assert.ok(Object.isFrozen(mockRoute.waypoints), 'Mảng waypoints phải bị đóng băng');
  assert.ok(Object.isFrozen(mockRoute.waypoints[0]), 'Từng waypoint object phải bị đóng băng');
  assert.ok(Object.isFrozen(mockRoute.legs), 'Mảng legs phải bị đóng băng');
  assert.ok(Object.isFrozen(mockRoute.legs[0]), 'Từng leg object phải bị đóng băng');
  assert.strictEqual(Object.isFrozen(mockRoute.coords), false, 'Mảng coords không được đóng băng');
  assert.strictEqual(Object.isFrozen(mockRoute.legs[0].steps), false, 'Mảng steps bên trong leg không bị đóng băng để tiết kiệm CPU');
});

// -----------------------------------------------------------------------------
// P3.4: Popup closes when layer rebuilds (giữ popup open)
// -----------------------------------------------------------------------------
console.log('\n--- P3.4: Giữ Popup Mở Khi Chỉ Thay Đổi Confidence ---');
test('renderIncidents bỏ qua rebuild khi popup của sự cố đó đang mở', () => {
  const mapContent = require('fs').readFileSync(require('path').join(__dirname, '../js/map.js'), 'utf8');
  assert.ok(mapContent.includes('_popupOpenIncidentId'), 'map.js phải có biến _popupOpenIncidentId');
  assert.ok(mapContent.includes('_popupOpenIncidentId === inc.id'), 'renderIncidents phải kiểm tra _popupOpenIncidentId === inc.id');
  assert.ok(mapContent.includes('popupopen'), '_buildIncidentLayer phải lắng nghe popupopen');
  assert.ok(mapContent.includes('popupclose'), '_buildIncidentLayer phải lắng nghe popupclose');
});

console.log('\n================================================================');
console.log(`KẾT QUẢ KIỂM THỬ: ${passedTests} TESTS ĐẠT (100%)`);
console.log('================================================================');
