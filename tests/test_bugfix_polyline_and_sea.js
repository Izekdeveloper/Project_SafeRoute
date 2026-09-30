/**
 * test_bugfix_polyline_and_sea.js
 * Kiểm thử hồi quy cho 2 bug UI/routing:
 *
 *  BUG 1 - Polyline không clear khi đổi tuyến (routing.js::renderRoutes)
 *    - routeLayerGroup phải được clear trước mỗi lần vẽ lại
 *    - Số layer phải luôn = số tuyến, không tăng dồn theo số lần chuyển tuyến
 *    - Tuyến được chọn luôn vẽ sau cùng (z-order trên cùng), không được chọn luôn dashed
 *
 *  BUG 2 - Chọn điểm đến trên biển vẫn tìm được đường
 *    - 2.1: isPointInVietnam + polygons được export ra public API
 *    - 2.2: map.js::selectEndFromMap chặn sớm điểm ngoài lãnh thổ VN
 *    - 2.3: app.js::onFindRouteClick chặn ở tầng cuối (defense in depth)
 *
 * Chạy: node tests/test_bugfix_polyline_and_sea.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

/* =========================================================
   HẠ TẦNG GIẢ LẬP MÔI TRƯỜNG TRÌNH DUYỆT (Node friendly)
   ========================================================= */

// --- DOM tối giản ---
function makeElement(value) {
  return { value: value || '', innerHTML: '', classList: { add() {}, remove() {} } };
}
const domElements = {};
['start-input', 'end-input'].forEach(id => { domElements[id] = makeElement(''); });
global.document = {
  readyState: 'complete',
  getElementById(id) {
    if (domElements[id]) return domElements[id];
    return null; // 'route-results', 'find-btn', ... -> khiến renderRoutes return sớm
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}
};

// --- window tối giảu ---
const toasts = [];
global.window = {
  DEBUG_ROUTING: false,
  selectedMode: 'fastest',
  currentRoutes: [],
  selectedRouteId: null,
  showToast(text) { toasts.push(text); },
  openSheet() {}
};
global.window.addEventListener = () => {};

// --- Leaflet giả: chỉ cần layerGroup/polyline cho renderRoutes ---
function makeLayerGroup() {
  return {
    layers: [],
    addLayer(l) { this.layers.push(l); return this; },
    clearLayers() { this.layers.length = 0; return this; },
    getLayers() { return this.layers; }
  };
}

const routeLayerGroupFake = makeLayerGroup();
const transportFallbackLayerGroupFake = makeLayerGroup();
const polylineCalls = [];   // lưu thứ tự add để kiểm tra z-order

global.routeLayerGroup = routeLayerGroupFake;
global.transportFallbackLayerGroup = transportFallbackLayerGroupFake;
global.map = null; // null để bỏ qua fitBounds
global.ROUTE_COLORS = ['#2f7ee0', '#f08a1c', '#12b76a', '#8a4fe0', '#e3492c'];
global.escapeHtml = (s) => String(s == null ? '' : s);
global.fetch = () => Promise.reject(new Error('network disabled in test'));
// map.js::reverseGeocodeEndLabel dùng setTimeout 500ms rồi mới gọi fetch;
// vô hiệu hoá timer để test không phụ thuộc mạng và không giữ event loop.
global.setTimeout = () => 0;
global.clearTimeout = () => {};

global.L = {
  layerGroup() { return makeLayerGroup(); },
  polyline(coords, opts) {
    const self = {
      coords,
      opts,
      clickHandler: null,
      tooltip: null,
      broughtToFront: false,
      addTo(group) { group.addLayer(self); polylineCalls.push(self); return self; },
      on(evt, handler) { if (evt === 'click') self.clickHandler = handler; return self; },
      bindTooltip(t) { self.tooltip = t; return self; },
      bringToFront() { self.broughtToFront = true; return self; }
    };
    return self;
  }
};

const configModule = require(path.join(__dirname, '..', 'js', 'config.js'));
// routing.js / dijkstra.js đọc CONFIG như một global (script cổ điển trên trình duyệt)
global.CONFIG = configModule.CONFIG;
global.DEMO_USER_ID = configModule.DEMO_USER_ID;
global.ROUTE_COLORS = configModule.ROUTE_COLORS;
global.INCIDENT_TYPES = configModule.INCIDENT_TYPES;
global.LEVEL_LABEL = configModule.LEVEL_LABEL;
global.getConfidenceColor = configModule.getConfidenceColor || (() => '#888');

const routing = require(path.join(__dirname, '..', 'js', 'routing.js'));

/* =========================================================
   TIỆN ÍCH KIỂM THỬ
   ========================================================= */
let passed = 0;
let failed = 0;
const tests = [];

// Đăng ký test (hỗ trợ cả hàm sync và hàm trả về Promise)
// `section` dùng để in tiêu đề nhóm ngay trước khi kết quả của nhóm đó chạy.
function test(section, name, fn) {
  tests.push({ section, name, fn });
}

async function runAll() {
  let currentSection = null;
  for (const { section, name, fn } of tests) {
    if (section !== currentSection) {
      currentSection = section;
      console.log(`\n--- ${section} ---`);
    }
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error('    ' + (err && err.message ? err.message : err));
      failed++;
    }
  }
  console.log('\n================================================================');
  console.log(`BUG 1 + BUG 2: ${passed} passed, ${failed} failed`);
  console.log('================================================================');
  if (failed > 0) process.exitCode = 1;
}

function makeRoutes(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: String(i + 1),
      routeIndex: i,
      coords: [[10.0 + i * 0.5, 105.0], [11.0 + i * 0.5, 106.0]],
      distance: 100 + i * 10,
      duration: 60 + i * 10,
      riskScore: 10 * i
    });
  }
  return out;
}

/* =========================================================
   BUG 1 - POLYLINE KHÔNG CLEAR KHI ĐỔI TUYẾN
   ========================================================= */

test('BUG 1: renderRoutes clear layer + z-order (routing.js)',
     'BUG1.1: render lần đầu tạo đúng số polyline bằng số tuyến', () => {
  const routes = makeRoutes(3);
  routing.renderRoutes(routes, 'fastest');
  assert.strictEqual(routeLayerGroupFake.getLayers().length, 3,
    'Phải có đúng 3 polyline sau lần render đầu');
});

test('BUG 1: renderRoutes clear layer + z-order (routing.js)',
     'BUG1.2: Chuyển A -> B -> A 5 lần KHÔNG làm tăng số layer (Bug 1 root cause)', () => {
  const routes = makeRoutes(2);
  routeLayerGroupFake.clearLayers();
  polylineCalls.length = 0;

  // Lần 1: tuyến A (id '1') được chọn
  window.selectedRouteId = '1';
  window.manualRouteSelection = true;
  window._lastRenderedMode = 'fastest';
  routing.renderRoutes(routes, 'fastest');
  assert.strictEqual(routeLayerGroupFake.getLayers().length, 2);

  // Chuyển qua lại 5 lần A <-> B
  for (let i = 0; i < 5; i++) {
    window.selectedRouteId = '2';
    window.manualRouteSelection = true;
    routing.renderRoutes(routes, 'fastest');
    assert.strictEqual(routeLayerGroupFake.getLayers().length, 2,
      `Lần chuyển sang tuyến B #${i + 1}: số layer phải luôn = 2`);

    window.selectedRouteId = '1';
    window.manualRouteSelection = true;
    routing.renderRoutes(routes, 'fastest');
    assert.strictEqual(routeLayerGroupFake.getLayers().length, 2,
      `Lần chuyển về tuyến A #${i + 1}: số layer phải luôn = 2`);
  }
});

test('BUG 1: renderRoutes clear layer + z-order (routing.js)',
     'BUG1.3: Tuyến được chọn luôn vẽ cuối cùng (z-order trên cùng), tuyến khác luôn dashed', () => {
  const routes = makeRoutes(2);
  routeLayerGroupFake.clearLayers();
  polylineCalls.length = 0;

  window.selectedRouteId = '1';
  window.manualRouteSelection = true;
  window._lastRenderedMode = 'fastest';
  routing.renderRoutes(routes, 'fastest');

  const added = polylineCalls.slice(-2); // 2 polyline vừa thêm
  const last = added[added.length - 1];
  const first = added[0];

  assert.strictEqual(last.opts.dashArray, null, 'Tuyến được chọn phải vẽ liền (dashArray = null)');
  assert.strictEqual(first.opts.dashArray, '3 7', 'Tuyến không được chọn phải vẽ chấm chấm (3 7)');
  assert.ok(first !== last, 'Phải là 2 polyline khác nhau');

  // routeLayerGroup dùng chung overlayPane với lớp sự cố nên cần bringToFront()
  assert.strictEqual(last.broughtToFront, true, 'Tuyến được chọn phải được đưa lên trên cùng');
  assert.strictEqual(first.broughtToFront, false, 'Tuyến không được chọn không cần bringToFront');
});

test('BUG 1: renderRoutes clear layer + z-order (routing.js)',
     'BUG1.4: Đổi mode (fastest -> balanced -> safest) không làm chồng layer', () => {
  const routes = makeRoutes(3);
  routeLayerGroupFake.clearLayers();
  window.selectedRouteId = '1';
  window.manualRouteSelection = true;

  ['fastest', 'balanced', 'safest', 'fastest'].forEach(mode => {
    routing.renderRoutes(routes, mode);
    assert.strictEqual(routeLayerGroupFake.getLayers().length, 3,
      `Mode ${mode}: số layer phải luôn = 3`);
  });
});

/* =========================================================
   BUG 2.1 - EXPORT isPointInVietnam + POLYGONS
   ========================================================= */

test('BUG 2.1: Export isPointInVietnam & polygons (routing.js)',
     'BUG2.1.1: isPointInVietnam, pointInPolygon và polygons được export từ module', () => {
  assert.strictEqual(typeof routing.isPointInVietnam, 'function', 'thiếu export isPointInVietnam');
  assert.strictEqual(typeof routing.pointInPolygon, 'function', 'thiếu export pointInPolygon');
  assert.ok(Array.isArray(routing.VIETNAM_MAINLAND_POLYGON) && routing.VIETNAM_MAINLAND_POLYGON.length > 50,
    'thiếu polygon đất liền hợp lệ');
  assert.ok(Array.isArray(routing.PHU_QUOC_POLYGON) && routing.PHU_QUOC_POLYGON.length === 4,
    'thiếu polygon Phú Quốc');
});

test('BUG 2.1: Export isPointInVietnam & polygons (routing.js)',
  'BUG2.1.2: Phân loại đúng đất liền / biển / Phú Quốc', () => {
  assert.strictEqual(routing.isPointInVietnam(10.77, 106.70), true, 'Sài Gòn phải true');
  assert.strictEqual(routing.isPointInVietnam(21.03, 105.85), true, 'Hà Nội phải true');
  assert.strictEqual(routing.isPointInVietnam(20.95, 106.70), true, 'Cần Giờ phải true');
  assert.strictEqual(routing.isPointInVietnam(10.20, 103.95), true, 'Phú Quốc phải true');
  assert.strictEqual(routing.isPointInVietnam(15.00, 110.00), false, 'biển Biển Đông phải false');
  // Đảo ngoài đa giác: Lý Sơn (15.15,112.90) và Phú Quý (10.53,109.22) -> chặn oan (đã biết).
  assert.strictEqual(routing.isPointInVietnam(15.15, 112.90), false, 'Lý Sơn ngoài polygon -> false');
  assert.strictEqual(routing.isPointInVietnam(10.53, 109.22), false, 'Phú Quý ngoài polygon -> false');
  // Côn Đảo (10.68,107.12) nằm trong đa giác đất liền -> true (không phải hạn chế).
  assert.strictEqual(routing.isPointInVietnam(10.68, 107.12), true, 'Côn Đảo nằm trong đa giác -> true');
  // (8.68,106.61) là biển khơi ~55km đông Mũi Cà Mau, KHÔNG phải Côn Đảo.
  assert.strictEqual(routing.isPointInVietnam(8.68, 106.61), false, 'biển khơi Cà Mau -> false');
});

test('BUG 2.1: Export isPointInVietnam & polygons (routing.js)',
  'BUG2.1.4: Dải đệm 40km KHÔNG chặn oan các thành phố ven biển bị đa giác loại nhầm', () => {
  // Đây là test chống hồi quy cho chính lỗi chặn-nhầm: những điểm này nằm NGOÀI đa giác
  // nhưng là đất liền thật, phải được phép qua cổng chặn.
  const landPoints = [
    ['Quảng Ngãi', 13.78, 107.39],
    ['Cửa Lò (Thanh Hóa)', 19.75, 106.80],
    ['Móng Cái (Quảng Ninh)', 21.85, 107.30],
    ['Cô Tô', 20.36, 107.08],
    ['Quy Nhơn', 13.76, 109.22]
  ];
  landPoints.forEach(([label, lat, lng]) => {
    assert.strictEqual(routing.isPointClearlyAtSea(lat, lng), false,
      `${label} là đất liền, không được chặn`);
  });
});

test('BUG 2.1: Export isPointInVietnam & polygons (routing.js)',
  'BUG2.1.5: Dải đệm 40km VẪN chặn biển khơi (case user báo) và toạ độ hỏng', () => {
  // Trả lời đúng mục tiêu ban đầu: điểm giữa biển bị chặn, OSRM không được gọi.
  const seaPoints = [
    ['Biển Đông', 15.00, 110.00],
    ['Biển Đông (xa bờ)', 13.00, 110.50],
    ['ngoài khơi Quảng Ninh', 20.50, 108.50],
    ['phía Đông Nha Trang', 12.24, 110.00],
    ['phía Đông Nam Bộ', 9.90, 107.90]
  ];
  seaPoints.forEach(([label, lat, lng]) => {
    assert.strictEqual(routing.isPointClearlyAtSea(lat, lng), true,
      `${label} phải bị chặn`);
  });

  // Toạ độ hỏng phải fail-closed (không gọi OSRM), không được ném lỗi.
  [NaN, undefined, null, Infinity, 'abc', {}].forEach(bad => {
    assert.strictEqual(routing.isPointClearlyAtSea(bad, 106.7), true,
      'Toạ độ không hợp lệ phải bị chặn (fail-closed)');
    assert.strictEqual(routing.isPointClearlyAtSea(10.77, bad), true,
      'Toạ độ không hợp lệ phải bị chặn (fail-closed)');
  });
});

/* =========================================================
   BUG 2.2 - CHẶN TAP BIỂN TẠI map.js::selectEndFromMap
   ========================================================= */

// map.js tự gắn hàm lên window khi có môi trường trình duyệt
require(path.join(__dirname, '..', 'js', 'map.js'));
const selectEndFromMap = window.selectEndFromMap;
window.isPointInVietnam = routing.isPointInVietnam;
window.isPointClearlyAtSea = routing.isPointClearlyAtSea;
window.map = null;

test('BUG 2.2: selectEndFromMap chặn điểm trên biển (map.js)',
     'BUG2.2.0: map.js expose selectEndFromMap lên window', () => {
  assert.strictEqual(typeof selectEndFromMap, 'function', 'thiếu window.selectEndFromMap');
});

test('BUG 2.2: selectEndFromMap chặn điểm trên biển (map.js)',
     'BUG2.2.1: Tap điểm trên biển (xa bờ) -> toast cảnh báo, KHÔNG set marker', () => {
  window.endLocation = null;
  toasts.length = 0;

  selectEndFromMap({ lat: 15.00, lng: 110.00 });

  assert.strictEqual(window.endLocation, null, 'Không được tạo endLocation cho điểm trên biển');
  assert.strictEqual(toasts.length, 1, 'Phải hiện đúng 1 toast cảnh báo');
  assert.ok(/ngoài lãnh thổ Việt Nam/.test(toasts[0]), `Toast sai nội dung: ${toasts[0]}`);
});

test('BUG 2.2: selectEndFromMap chặn điểm trên biển (map.js)',
  'BUG2.2.2: Tap giữa Biển Đông -> bị chặn', () => {
  window.endLocation = null;
  toasts.length = 0;

  selectEndFromMap({ lat: 13.00, lng: 110.50 }); // giữa Biển Đông

  assert.strictEqual(window.endLocation, null, 'Điểm biển khơi không được làm endLocation');
  assert.ok(toasts.some(t => /trên biển/.test(t)), 'Phải có toast cảnh báo điểm trên biển');
});

test('BUG 2.2: selectEndFromMap chặn điểm trên biển (map.js)',
  'BUG2.2.3: Tap Cửa Lò / Móng Cái (đất liền bị đa giác loại nhầm) -> KHÔNG bị chặn', () => {
  [['Cửa Lò', 19.75, 106.80], ['Móng Cái', 21.85, 107.30]].forEach(([label, lat, lng]) => {
    window.endLocation = null;
    toasts.length = 0;

    selectEndFromMap({ lat, lng });

    assert.ok(window.endLocation, `${label} là đất liền, không được chặn`);
    assert.ok(/Đã chọn vị trí muốn đến/.test(toasts.join('|')), `${label} phải toast thành công`);
  });
});

test('BUG 2.2: selectEndFromMap chặn điểm trên biển (map.js)',
     'BUG2.2.4: Điểm hợp lệ trên đất liền -> vẫn đặt marker & toast thành công (regression)', () => {
  window.endLocation = null;
  toasts.length = 0;

  selectEndFromMap({ lat: 20.95, lng: 106.70 }); // Cần Giờ

  assert.ok(window.endLocation, 'Phải tạo endLocation cho điểm trên đất liền');
  assert.strictEqual(window.endLocation.lat, 20.95);
  assert.strictEqual(window.endLocation.lng, 106.70);
  assert.ok(/Đã chọn vị trí muốn đến/.test(toasts.join('|')), 'Phải toast thành công');
});

/* =========================================================
   BUG 2.3 - CHẶN TẦNG CUỐI TRƯỚC KHI GỌI OSRM (app.js)
   ========================================================= */

const { haversineMeters, isValidCoordinate, shortenDisplayName } = require(path.join(__dirname, '..', 'js', 'config.js'));

let findSafeRoutesCalls = 0;
window.isValidCoordinate = isValidCoordinate;
window.haversineMeters = haversineMeters;
window.shortenDisplayName = shortenDisplayName;
window.calculateCurrentConfidence = () => 50;
window.findSafeRoutes = async () => { findSafeRoutesCalls++; return []; };
window.setFindButtonLoading = () => {};
window.cleanupExpiredIncidents = () => {};
window.transportFallbackLayerGroup = transportFallbackLayerGroupFake;
window.routeLayerGroup = routeLayerGroupFake;
window.innerWidth = 1400;
window.addEventListener = () => {};

delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'app.js'))];
const appLoaded = (() => {
  require(path.join(__dirname, '..', 'js', 'app.js'));
  return true;
})();

test('BUG 2.3: onFindRouteClick chặn điểm trên biển (app.js)',
     'BUG2.3.0: app.js load được trong môi trường test và expose onFindRouteClick', () => {
  assert.strictEqual(appLoaded, true);
  assert.strictEqual(typeof window.onFindRouteClick, 'function', 'thiếu window.onFindRouteClick');
});

test('BUG 2.3: onFindRouteClick chặn điểm trên biển (app.js)',
     'BUG2.3.1: Bấm "Tìm đường" với điểm đến trên biển -> KHÔNG gọi OSRM, có toast', async () => {
  findSafeRoutesCalls = 0;
  toasts.length = 0;
  window.startLocation = { lat: 10.7769, lng: 106.7009, label: 'Sài Gòn', source: 'gps' };
  window.endLocation = { lat: 15.0, lng: 110.0, label: 'biển', source: 'map' };
  domElements['end-input'].value = '15.00000, 110.00000';

  await window.onFindRouteClick();

  assert.strictEqual(findSafeRoutesCalls, 0, 'KHÔNG được gọi findSafeRoutes (OSRM) cho điểm trên biển');
  assert.ok(toasts.some(t => /Điểm đến nằm ngoài lãnh thổ Việt Nam/.test(t)),
    `Phải toast cảnh báo điểm đến trên biển, thực tế: ${JSON.stringify(toasts)}`);
});

test('BUG 2.3: onFindRouteClick chặn điểm trên biển (app.js)',
     'BUG2.3.2: Điểm BẮT ĐẦU trên biển cũng bị chặn', async () => {
  findSafeRoutesCalls = 0;
  toasts.length = 0;
  window.startLocation = { lat: 15.0, lng: 110.0, label: 'biển', source: 'gps' };
  window.endLocation = { lat: 10.7769, lng: 106.7009, label: 'Sài Gòn', source: 'map' };
  domElements['end-input'].value = 'Sài Gòn';

  await window.onFindRouteClick();

  assert.strictEqual(findSafeRoutesCalls, 0, 'KHÔNG được gọi findSafeRoutes khi điểm bắt đầu trên biển');
  assert.ok(toasts.some(t => /Điểm bắt đầu nằm ngoài lãnh thổ Việt Nam/.test(t)),
    `Phải toast cảnh báo điểm bắt đầu trên biển, thực tế: ${JSON.stringify(toasts)}`);
});

test('BUG 2.3: onFindRouteClick chặn điểm trên biển (app.js)',
     'BUG2.3.3: Regression - cả 2 điểm hợp lệ thì vẫn tìm đường bình thường', async () => {
  findSafeRoutesCalls = 0;
  toasts.length = 0;
  window.startLocation = { lat: 10.7769, lng: 106.7009, label: 'Sài Gòn', source: 'gps' };
  window.endLocation = { lat: 10.20, lng: 103.95, label: 'Phú Quốc', source: 'map' };
  domElements['end-input'].value = 'Phú Quốc';

  await window.onFindRouteClick();

  assert.strictEqual(findSafeRoutesCalls, 1, 'Phải gọi findSafeRoutes 1 lần cho cặp điểm hợp lệ');
});

test('BUG 2.3: onFindRouteClick chặn điểm trên biển (app.js)',
  'BUG2.3.4: Regression - thành phố ven biển bị đa giác loại nhầm vẫn tìm được đường', async () => {
  findSafeRoutesCalls = 0;
  toasts.length = 0;
  window.startLocation = { lat: 10.7769, lng: 106.7009, label: 'Sài Gòn', source: 'gps' };
  window.endLocation = { lat: 19.75, lng: 106.80, label: 'Cửa Lò', source: 'map' };
  domElements['end-input'].value = 'Cửa Lò';

  await window.onFindRouteClick();

  assert.strictEqual(findSafeRoutesCalls, 1, 'Cửa Lò là đất liền, phải tìm được đường');
  assert.ok(!toasts.some(t => /trên biển/.test(t)),
    `Không được báo nhầm "trên biển", thực tế: ${JSON.stringify(toasts)}`);
});

test('BUG 2.3: onFindRouteClick chặn điểm trên biển (app.js)',
  'BUG2.3.5: Toạ độ điểm đến hỏng -> báo lỗi toạ độ, KHÔNG báo nhầm "trên biển"', async () => {
  findSafeRoutesCalls = 0;
  toasts.length = 0;
  window.startLocation = { lat: 10.7769, lng: 106.7009, label: 'Sài Gòn', source: 'gps' };
  window.endLocation = { lat: undefined, lng: undefined, label: 'x', source: 'map' };
  domElements['end-input'].value = 'x';

  await window.onFindRouteClick();

  assert.strictEqual(findSafeRoutesCalls, 0, 'Không được gọi OSRM với toạ độ hỏng');
  assert.ok(toasts.some(t => /Tọa độ điểm đến không hợp lệ/.test(t)),
    `Phải báo lỗi toạ độ, thực tế: ${JSON.stringify(toasts)}`);
  assert.ok(!toasts.some(t => /trên biển/.test(t)), 'Không được báo nhầm "trên biển"');
});

/* =========================================================
   TỔNG KẾT
   ========================================================= */
runAll();
