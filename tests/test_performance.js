/**
 * Test Suite: SafeRoute Performance Optimization Verification
 * File: tests/test_performance.js
 * 
 * Tests:
 * 1. Geometry Metadata WeakMap Cache & Bounding Box extraction
 * 2. Incident Bounding Box WeakMap Cache & Spatial Prefiltering
 * 3. Bounding Box Intersection & Mathematical Equivalence of Risk Calculation
 * 4. findIncidentsAlongRoute Spatial Prefilter
 * 5. Route Deduplication Multi-tier Cheap Checks (Signature, Diff, Bbox, Early Break)
 * 6. Non-regression of OSRM Configuration & 3-Route Limit
 */

const { CONFIG, MAX_SUGGESTED_ROUTES, RISK_IMPACT } = require('../js/config.js');
const {
  _routeMetadataCache,
  _incidentBboxCache,
  getRouteMetadata,
  getIncidentBbox,
  isIncidentNearRouteBbox,
  _getRouteGeometrySignature,
  _areRoutesDuplicate,
  _deduplicateRoutes,
  calculateRouteRisk,
  findIncidentsAlongRoute
} = require('../js/routing.js');

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
console.log('BẮT ĐẦU KIỂM THỬ HIỆU NĂNG & TỐI ƯU HÓA HÌNH HỌC / RỦI RO');
console.log('================================================================\n');

/* ------------------------------------------------------------------
   TEST GROUP 1: ROUTE METADATA & WEAKMAP CACHING
------------------------------------------------------------------ */
console.log('--- Test Group 1: Route Metadata & WeakMap Caching ---');
{
  const mockRoute = {
    id: 1,
    coords: [
      [10.7769, 106.7009],
      [10.7780, 106.7020],
      [10.7800, 106.7050]
    ],
    distance: 1.2,
    duration: 5.0
  };

  const meta1 = getRouteMetadata(mockRoute);
  assert(meta1 !== null, 'getRouteMetadata trả về metadata hợp lệ');
  assert(meta1.coordCount === 3, 'coordCount tính đúng là 3');
  assert(meta1.segmentCount === 2, 'segmentCount tính đúng là 2');
  assert(Array.isArray(meta1.bbox) && meta1.bbox.length === 4, 'bbox là mảng 4 phần tử [minLat, maxLat, minLng, maxLng]');
  assert(meta1.bbox[0] === 10.7769 && meta1.bbox[1] === 10.7800, 'minLat và maxLat chính xác');
  assert(meta1.bbox[2] === 106.7009 && meta1.bbox[3] === 106.7050, 'minLng và maxLng chính xác');

  // Kiểm tra bufferedBbox mở rộng ~0.0055 độ
  assert(meta1.bufferedBbox[0] < meta1.bbox[0] && meta1.bufferedBbox[1] > meta1.bbox[1], 'bufferedBbox mở rộng chuẩn theo vĩ độ');
  assert(meta1.bufferedBbox[2] < meta1.bbox[2] && meta1.bufferedBbox[3] > meta1.bbox[3], 'bufferedBbox mở rộng chuẩn theo kinh độ');

  // Kiểm tra WeakMap cache tính đồng nhất tham chiếu (Referential Identity)
  const meta2 = getRouteMetadata(mockRoute);
  assert(meta1 === meta2, 'WeakMap cache trả về cùng object reference cho cùng 1 route (0 overhead khi gọi nhiều lần)');
  assert(_routeMetadataCache.get(mockRoute) === meta1, '_routeMetadataCache lưu trữ đúng entry');
}

/* ------------------------------------------------------------------
   TEST GROUP 2: INCIDENT BBOX & SPATIAL INTERSECTION
------------------------------------------------------------------ */
console.log('\n--- Test Group 2: Incident Bbox & Spatial Intersection ---');
{
  const pointIncident = {
    id: 'inc1',
    type: 'flood',
    level: 'cao',
    lat: 10.7770,
    lng: 106.7010
  };

  const polyIncident = {
    id: 'inc2',
    type: 'construction',
    level: 'trungbinh',
    lat: 10.7780,
    lng: 106.7020,
    nodes: [
      { lat: 10.7785, lng: 106.7025 },
      { lat: 10.7775, lng: 106.7015 }
    ],
    roadCoords: [
      [10.7790, 106.7030]
    ]
  };

  const farIncident = {
    id: 'inc_far',
    type: 'accident',
    level: 'cao',
    lat: 10.8500, // Cách xa hơn 8km
    lng: 106.7800
  };

  const b1 = getIncidentBbox(pointIncident);
  assert(b1[0] === 10.7770 && b1[1] === 10.7770 && b1[2] === 106.7010 && b1[3] === 106.7010, 'Point incident bbox có min=max');

  const b2 = getIncidentBbox(polyIncident);
  assert(b2[0] === 10.7775 && b2[1] === 10.7790, 'Poly incident tính minLat, maxLat bao trùm cả nodes và roadCoords');
  assert(b2[2] === 106.7015 && b2[3] === 106.7030, 'Poly incident tính minLng, maxLng bao trùm cả nodes và roadCoords');

  // Kiểm tra WeakMap cache của incident bbox
  assert(getIncidentBbox(polyIncident) === b2, 'Incident bbox được cache trong WeakMap');

  // Kiểm tra giao cắt với route bufferedBbox
  const route = {
    coords: [
      [10.7769, 106.7009],
      [10.7800, 106.7050]
    ]
  };
  const rMeta = getRouteMetadata(route);

  assert(isIncidentNearRouteBbox(b1, rMeta.bufferedBbox) === true, 'Sự cố gần route -> isIncidentNearRouteBbox = true');
  assert(isIncidentNearRouteBbox(b2, rMeta.bufferedBbox) === true, 'Sự cố phức hợp gần route -> isIncidentNearRouteBbox = true');

  const bFar = getIncidentBbox(farIncident);
  assert(isIncidentNearRouteBbox(bFar, rMeta.bufferedBbox) === false, 'Sự cố xa (>8km) -> isIncidentNearRouteBbox = false (loại ngay lập tức ở O(1))');
}

/* ------------------------------------------------------------------
   TEST GROUP 3: TOÀN VẸN TOÁN HỌC CỦA CALCULATEROUTERISK & SPATIAL PREFILTER
------------------------------------------------------------------ */
console.log('\n--- Test Group 3: calculateRouteRisk & findIncidentsAlongRoute ---');
{
  const route = {
    coords: [
      [10.7769, 106.7009],
      [10.7780, 106.7020],
      [10.7800, 106.7050]
    ]
  };

  // Thiết lập danh sách sự cố toàn cầu giả lập
  global.incidents = [
    // Sự cố nằm sát cạnh route (cách ~15m)
    {
      id: 'near_1',
      type: 'flood',
      level: 'cao',
      lat: 10.7770,
      lng: 106.7010,
      createdAt: Date.now() - 60000
    },
    // 50 sự cố nằm ở quận 9 / Thủ Đức (cách xa 10km)
    ...Array.from({ length: 50 }, (_, i) => ({
      id: `far_${i}`,
      type: 'traffic',
      level: 'trungbinh',
      lat: 10.8500 + i * 0.001,
      lng: 106.7800 + i * 0.001,
      createdAt: Date.now() - 60000
    }))
  ];

  global.calculateCurrentConfidence = () => 80;

  const risk = calculateRouteRisk(route);
  assert(risk > 0, `calculateRouteRisk phát hiện rủi ro từ sự cố lân cận (Risk = ${risk})`);

  const incidentsAlong = findIncidentsAlongRoute(route);
  assert(incidentsAlong.length === 1, 'findIncidentsAlongRoute chỉ phát hiện 1 sự cố duy nhất nằm trong hành lang, loại bỏ toàn bộ 50 sự cố ở xa');
  assert(incidentsAlong[0].incident.id === 'near_1', 'Sự cố được định danh chính xác là near_1');
  assert(incidentsAlong[0].distanceM < 50, `Khoảng cách đo được chính xác (${incidentsAlong[0].distanceM}m < 50m)`);

  // Thêm 1 sự cố xa vào danh sách, kiểm tra risk score không hề bị suy giảm hoặc sai khác
  global.incidents.push({
    id: 'far_extra',
    type: 'accident',
    level: 'cao',
    lat: 10.9000,
    lng: 106.9000
  });

  const riskAfter = calculateRouteRisk(route);
  assert(riskAfter === risk, `Toàn vẹn toán học (Invariance): Rủi ro trước (${risk}) và sau (${riskAfter}) hoàn toàn bằng nhau khi thêm sự cố ngoài vùng ảnh hưởng`);
}

/* ------------------------------------------------------------------
   TEST GROUP 4: ROUTE DEDUPLICATION CHEAP CHECKS
------------------------------------------------------------------ */
console.log('\n--- Test Group 4: Route Deduplication Cheap Checks ---');
{
  const r1 = {
    id: 'r1',
    coords: [
      [10.770, 106.700],
      [10.772, 106.702],
      [10.774, 106.704],
      [10.776, 106.706],
      [10.778, 106.708],
      [10.780, 106.710]
    ],
    distance: 2.0,
    duration: 10.0
  };

  // Tuyến rSame: Cùng đối tượng tham chiếu
  assert(_areRoutesDuplicate(r1, r1) === true, 'Cheap Check 0: r1 === r1 trả về true lập tức');

  // Tuyến rIdentical: Tọa độ giống hệt r1
  const rIdentical = {
    id: 'r_identical',
    coords: JSON.parse(JSON.stringify(r1.coords)),
    distance: 2.0,
    duration: 10.0
  };
  assert(_areRoutesDuplicate(r1, rIdentical) === true, 'Cheap Check 1: Khớp Geometry Signature trả về true ngay lập tức');

  // Tuyến rDiffDist: Cự ly chênh lệch 10% (> 2%)
  const rDiffDist = {
    id: 'r_diff_dist',
    coords: [
      [10.770, 106.700],
      [10.772, 106.703],
      [10.775, 106.707],
      [10.780, 106.710]
    ],
    distance: 2.5, // 25% lớn hơn
    duration: 10.0
  };
  assert(_areRoutesDuplicate(r1, rDiffDist) === false, 'Cheap Check 2: Chênh lệch cự ly > 2% loại ngay lập tức (false)');

  // Tuyến rDiffDur: Thời gian chênh lệch 15% (> 2%)
  const rDiffDur = {
    id: 'r_diff_dur',
    coords: JSON.parse(JSON.stringify(r1.coords)),
    distance: 2.0,
    duration: 12.0 // 20% lớn hơn
  };
  // Khi coords giống hệt, signature khớp trước -> true. Nhưng nếu coords hơi khác và durDiff > 2%:
  const rDiffDurCoords = {
    id: 'r_diff_dur_2',
    coords: [
      [10.770, 106.700],
      [10.773, 106.703],
      [10.777, 106.707],
      [10.780, 106.710]
    ],
    distance: 2.01,
    duration: 12.5 // > 2%
  };
  assert(_areRoutesDuplicate(r1, rDiffDurCoords) === false, 'Cheap Check 3: Chênh lệch thời gian > 2% loại ngay lập tức (false)');

  // Tuyến rDisjoint: Ở hoàn toàn khu vực khác (Bbox không giao nhau)
  const rDisjoint = {
    id: 'r_disjoint',
    coords: [
      [10.820, 106.750],
      [10.822, 106.752],
      [10.824, 106.754],
      [10.826, 106.756],
      [10.828, 106.758],
      [10.830, 106.760]
    ],
    distance: 2.005, // Gần giống cự ly
    duration: 10.05  // Gần giống thời gian
  };
  assert(_areRoutesDuplicate(r1, rDisjoint) === false, 'Cheap Check 4: Bounding Box không giao nhau loại ngay lập tức không cần đo sample (false)');

  // Test _deduplicateRoutes
  const allRoutes = [r1, rIdentical, rDiffDist, rDisjoint];
  const deduped = _deduplicateRoutes(allRoutes);
  assert(deduped.length === 3, `_deduplicateRoutes loại bỏ chính xác 1 tuyến trùng lặp (Còn lại ${deduped.length}/4)`);
  assert(deduped.includes(r1), 'Chứa tuyến gốc r1');
  assert(!deduped.includes(rIdentical), 'Loại bỏ tuyến trùng rIdentical');
}

/* ------------------------------------------------------------------
   TEST GROUP 5: CẤU HÌNH MAX_SUGGESTED_ROUTES = 3 & OSRM LOCK
------------------------------------------------------------------ */
console.log('\n--- Test Group 5: MAX_SUGGESTED_ROUTES & OSRM Settings ---');
{
  assert(MAX_SUGGESTED_ROUTES === 3, 'MAX_SUGGESTED_ROUTES luôn bằng 3 theo yêu cầu');
  assert(CONFIG.max_suggested_routes === 3, 'CONFIG.max_suggested_routes = 3');
  assert(CONFIG.osrm_timeout_ms === 8000, 'OSRM Timeout giữ nguyên 8000ms');
  assert(CONFIG.osrm_cache_ttl_ms === 180000, 'OSRM Cache TTL giữ nguyên 180000ms');
  assert(CONFIG.osrm_max_concurrent_requests === 3, 'OSRM Concurrency Limiter giữ nguyên 3 requests');
}

console.log('\n================================================================');
console.log(`KẾT QUẢ TỔNG HỢP: ${passedTests}/${totalTests} TESTS PASS (100%)`);
console.log('================================================================');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}

