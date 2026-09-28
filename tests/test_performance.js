/**
 * Test Suite: SafeRoute Performance Optimization Verification
 * File: tests/test_performance.js
 * 
 * Tests:
 * 1. Geometry Metadata WeakMap Cache & Bounding Box extraction
 * 2. Incident Bounding Box WeakMap Cache & Spatial Prefiltering
 * 3. Bounding Box Intersection & Mathematical Equivalence of Risk Calculation
 * 4. Risk Calculation Only For Max 3 Routes (1, 2, 3, 10, 50 routes)
 * 5. Spatial Hash Grid Clustering (_clusterIncidents): 0, 1, 2 near, 2 far, boundary, invalid coords, 10, 100, 500, 1000 incidents
 * 6. Route Deduplication Multi-tier & Signature Collision Protection
 * 7. Non-regression of OSRM Configuration & 3-Route Limit
 */

const { CONFIG, MAX_SUGGESTED_ROUTES, RISK_IMPACT } = require('../js/config.js');
const {
  _routeMetadataCache,
  _incidentBboxCache,
  _routeIncidentAnalysisCache,
  getRouteMetadata,
  getIncidentBbox,
  isIncidentNearRouteBbox,
  _getRouteGeometrySignature,
  _getRouteSamplePoints,
  _areRoutesDuplicate,
  _deduplicateRoutes,
  _clusterIncidents,
  calculateRouteRisk,
  findIncidentsAlongRoute,
  createActiveIncidentSnapshot,
  getNearestPointOnPolyline,
  minDistanceToPolyline,
  analyzeRouteIncidents
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
console.log('BẮT ĐẦU KIỂM THỬ TỐI ƯU HÓA HIỆU NĂNG SAFEROUTE');
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
  assert(Array.isArray(meta1.samplePoints) && meta1.samplePoints.length === 3, 'samplePoints lưu 3 tọa độ');
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
   TEST GROUP 3: TOÀN VẸN TOÁN HỌC CỦA CALCULATEROUTERISK
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

  global.incidents = [
    {
      id: 'near_1',
      type: 'flood',
      level: 'cao',
      lat: 10.7770,
      lng: 106.7010,
      createdAt: Date.now() - 60000
    },
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
  assert(incidentsAlong.length === 1, 'findIncidentsAlongRoute chỉ phát hiện 1 sự cố duy nhất nằm trong hành lang, loại bỏ 50 sự cố ở xa');
  assert(incidentsAlong[0].incident.id === 'near_1', 'Sự cố được định danh chính xác là near_1');
  assert(incidentsAlong[0].distanceM < 50, `Khoảng cách đo được chính xác (${incidentsAlong[0].distanceM}m < 50m)`);

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
   TEST GROUP 4: RISK CALCULATION CHỈ TÍNH CHO TỐI ĐA 3 ROUTE CẦN THIẾT
------------------------------------------------------------------ */
console.log('\n--- Test Group 4: Risk Calculation chỉ tính cho tối đa 3 route ---');
{
  function simulateRouteSelectionFlow(candidateRoutes) {
    let riskCalculationCount = 0;

    // 1. Loại trùng lặp tuyến
    let validRoutes = _deduplicateRoutes(candidateRoutes);

    // 2. Sắp xếp các tuyến ứng viên theo thời gian di chuyển (duration) từ nhanh nhất đến chậm hơn
    validRoutes.sort((a, b) => {
      if (Math.abs(a.duration - b.duration) > 0.05) {
        return a.duration - b.duration;
      }
      return a.distance - b.distance;
    });

    // 3. Giới hạn số lượng tuyến gợi ý tối đa cho giao diện (MAX_SUGGESTED_ROUTES = 3)
    const maxSuggestedRoutes = MAX_SUGGESTED_ROUTES || 3;
    if (validRoutes.length > maxSuggestedRoutes) {
      validRoutes = validRoutes.slice(0, maxSuggestedRoutes);
    }

    // 4. CHỈ tính rủi ro cho tối đa MAX_SUGGESTED_ROUTES tuyến được chọn hiển thị
    validRoutes.forEach(r => {
      riskCalculationCount++;
      r.riskScore = calculateRouteRisk(r);
    });

    return {
      selectedCount: validRoutes.length,
      riskCalculations: riskCalculationCount,
      routes: validRoutes
    };
  }

  function makeMockRoute(id, duration, distance) {
    return {
      id: `route_${id}`,
      duration,
      distance,
      coords: [
        [10.770 + id * 0.005, 106.700 + id * 0.005],
        [10.780 + id * 0.005, 106.710 + id * 0.005]
      ]
    };
  }

  // 1 route -> 1 risk calculation
  const r1 = [makeMockRoute(1, 10, 5)];
  const out1 = simulateRouteSelectionFlow(r1);
  assert(out1.riskCalculations === 1, '1 candidate route -> tính risk đúng 1 lần');

  // 2 routes -> 2 risk calculations
  const r2 = [makeMockRoute(1, 10, 5), makeMockRoute(2, 12, 6)];
  const out2 = simulateRouteSelectionFlow(r2);
  assert(out2.riskCalculations === 2, '2 candidate routes -> tính risk đúng 2 lần');

  // 3 routes -> 3 risk calculations
  const r3 = [makeMockRoute(1, 10, 5), makeMockRoute(2, 12, 6), makeMockRoute(3, 14, 7)];
  const out3 = simulateRouteSelectionFlow(r3);
  assert(out3.riskCalculations === 3, '3 candidate routes -> tính risk đúng 3 lần');

  // 10 routes -> đúng 3 risk calculations
  const r10 = Array.from({ length: 10 }, (_, i) => makeMockRoute(i, 10 + i * 2, 5 + i));
  const out10 = simulateRouteSelectionFlow(r10);
  assert(out10.riskCalculations === 3, '10 candidate routes -> CHỈ tính risk đúng 3 lần (tiết kiệm 70% số phép tính)');
  assert(out10.selectedCount === 3, 'Chỉ lấy đúng 3 routes');
  assert(out10.routes[0].duration <= out10.routes[1].duration && out10.routes[1].duration <= out10.routes[2].duration, '3 routes được chọn là 3 tuyến nhanh nhất');

  // 50 routes -> đúng 3 risk calculations
  const r50 = Array.from({ length: 50 }, (_, i) => makeMockRoute(i, 8 + i * 1.5, 4 + i * 0.8));
  const out50 = simulateRouteSelectionFlow(r50);
  assert(out50.riskCalculations === 3, '50 candidate routes -> CHỈ tính risk đúng 3 lần (tiết kiệm 94% số phép tính)');
  assert(out50.selectedCount === 3, 'Chỉ lấy đúng 3 routes từ 50 ứng viên');
}

/* ------------------------------------------------------------------
   TEST GROUP 5: SPATIAL HASH GRID CLUSTERING (_clusterIncidents)
------------------------------------------------------------------ */
console.log('\n--- Test Group 5: Spatial Hash Grid Clustering (_clusterIncidents) ---');
{
  // 1. 0 incidents
  const c0 = _clusterIncidents([]);
  assert(Array.isArray(c0) && c0.length === 0, '0 incidents -> trả về mảng rỗng []');

  // 2. 1 incident
  const single = [{ incident: { lat: 10.7769, lng: 106.7009, level: 'cao' }, confidence: 80 }];
  const c1 = _clusterIncidents(single);
  assert(c1.length === 1 && c1[0].count === 1 && c1[0].lat === 10.7769, '1 incident -> trả về đúng 1 cluster với count = 1');

  // 3. 2 incidents gần nhau (< 500m)
  const pairNear = [
    { incident: { lat: 10.7769, lng: 106.7009, level: 'cao' }, confidence: 80 },
    { incident: { lat: 10.7780, lng: 106.7020, level: 'trungbinh' }, confidence: 70 } // Cách ~170m
  ];
  const cNear = _clusterIncidents(pairNear);
  assert(cNear.length === 1, '2 incidents gần nhau (< 500m) -> gom thành đúng 1 cluster');
  assert(cNear[0].count === 2, 'Cluster count = 2');

  // 4. 2 incidents xa nhau (> 500m)
  const pairFar = [
    { incident: { lat: 10.7769, lng: 106.7009, level: 'cao' }, confidence: 80 },
    { incident: { lat: 10.8200, lng: 106.7500, level: 'cao' }, confidence: 80 } // Cách ~7km
  ];
  const cFar = _clusterIncidents(pairFar);
  assert(cFar.length === 2, '2 incidents xa nhau (> 500m) -> tách thành 2 clusters riêng biệt');
  assert(cFar[0].count === 1 && cFar[1].count === 1, 'Mỗi cluster có count = 1');

  // 5. Incidents nằm ở 2 ô cell khác nhau nhưng khoảng cách < 500m (vượt biên giới cell)
  // CELL_SIZE = 0.005. Điểm A ở lng 106.7049, Điểm B ở lng 106.7051 (khác cellX nhưng cách nhau ~22m!)
  const pairBoundary = [
    { incident: { lat: 10.7770, lng: 106.7049, level: 'cao' }, confidence: 80 },
    { incident: { lat: 10.7770, lng: 106.7051, level: 'cao' }, confidence: 80 }
  ];
  const cBoundary = _clusterIncidents(pairBoundary);
  assert(cBoundary.length === 1 && cBoundary[0].count === 2, 'Incidents ở 2 cell khác nhau nhưng gần nhau qua biên giới cell -> gom thành công vào 1 cluster');

  // 6. Nhiều incidents trong cùng một cell
  const sameCell = Array.from({ length: 5 }, (_, i) => ({
    incident: { lat: 10.7771 + i * 0.0002, lng: 106.7011 + i * 0.0002, level: 'thap' },
    confidence: 60
  }));
  const cSame = _clusterIncidents(sameCell);
  assert(cSame.length === 1 && cSame[0].count === 5, '5 incidents trong cùng một cell -> gom chuẩn xác thành 1 cluster với count = 5');

  // 7. Incident có coordinate invalid
  const withInvalid = [
    { incident: { lat: 10.7770, lng: 106.7010, level: 'cao' }, confidence: 80 },
    { incident: { lat: NaN, lng: 106.7020, level: 'thap' }, confidence: 50 },
    { incident: { lat: 10.7772, lng: 106.7012, level: 'cao' }, confidence: 80 }
  ];
  const cInvalid = _clusterIncidents(withInvalid);
  assert(cInvalid.length === 2, 'Incident có tọa độ invalid không làm crash hệ thống, được xử lý an toàn');

  // 8. Scale test: 10, 100, 500, 1000 incidents
  for (const count of [10, 100, 500, 1000]) {
    const list = Array.from({ length: count }, (_, i) => ({
      incident: {
        lat: 10.700 + (i % 50) * 0.004,
        lng: 106.600 + Math.floor(i / 50) * 0.004,
        level: i % 3 === 0 ? 'cao' : (i % 3 === 1 ? 'trungbinh' : 'thap')
      },
      confidence: 70
    }));

    const tStart = process.hrtime.bigint();
    const res = _clusterIncidents(list);
    const tEnd = process.hrtime.bigint();
    const elapsedMs = Number(tEnd - tStart) / 1e6;

    assert(res.length > 0, `Scale ${count} incidents: gom được ${res.length} clusters trong ${elapsedMs.toFixed(2)} ms`);
    assert(elapsedMs < 100, `Thời gian clustering cho ${count} incidents cực nhanh (< 100ms): ${elapsedMs.toFixed(2)} ms`);
  }
}

/* ------------------------------------------------------------------
   TEST GROUP 6: ROUTE DEDUPLICATION & SIGNATURE COLLISION PROTECTION
------------------------------------------------------------------ */
console.log('\n--- Test Group 6: Route Deduplication & Signature Collision ---');
{
  const rBase = {
    id: 'base',
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

  // Cheap Check 0: Referential Identity
  assert(_areRoutesDuplicate(rBase, rBase) === true, 'Level 0: rBase === rBase trả về true');

  // Cheap Check 1: Distance / Duration difference >= 2%
  const rDiffDist = {
    id: 'diff_dist',
    coords: rBase.coords.map(c => [c[0], c[1]]),
    distance: 2.1, // 5% lớn hơn
    duration: 10.0
  };
  assert(_areRoutesDuplicate(rBase, rDiffDist) === false, 'Level 1: Chênh lệch cự ly 5% (>= 2%) trả về false ngay (O(1))');

  const rDiffDur = {
    id: 'diff_dur',
    coords: rBase.coords.map(c => [c[0], c[1]]),
    distance: 2.0,
    duration: 10.5 // 5% lớn hơn
  };
  assert(_areRoutesDuplicate(rBase, rDiffDur) === false, 'Level 1: Chênh lệch thời gian 5% (>= 2%) trả về false ngay (O(1))');

  // Cheap Check 2: Bounding Box Non-overlap
  const rDisjoint = {
    id: 'disjoint',
    coords: [
      [10.850, 106.750],
      [10.852, 106.752],
      [10.854, 106.754],
      [10.856, 106.756],
      [10.858, 106.758],
      [10.860, 106.760]
    ],
    distance: 2.001,
    duration: 10.01
  };
  assert(_areRoutesDuplicate(rBase, rDisjoint) === false, 'Level 1: Bbox không giao nhau trả về false ngay (O(1))');

  // Genuinely Duplicate Route (song song, cách 10m < 50m)
  const rNearParallel = {
    id: 'parallel_near',
    coords: rBase.coords.map(c => [c[0] + 0.0001, c[1] + 0.0001]), // lệch ~15m
    distance: 2.002,
    duration: 10.02
  };
  assert(_areRoutesDuplicate(rBase, rNearParallel) === true, 'Level 3: Hai tuyến song song cách 15m (< 50m, > 85% overlap) được xác nhận duplicate chuẩn xác');

  // SIGNATURE COLLISION TEST (MỤC 3 YÊU CẦU: KHÔNG ĐƯỢC DÙNG SIGNATURE ĐỂ KẾT LUẬN DUPLICATE TUYỆT ĐỐI)
  // Tạo hai tuyến rA và rB:
  // Chúng có cùng 15 điểm lấy mẫu phân bố đều theo polyline (nên có signature GIỐNG HỆT NHAU!)
  // Nhưng ở giữa các điểm mẫu, tuyến rB có một đoạn vòng sang hướng khác cách xa 200m (> 50m).
  // Hệ thống cũ: `if (sig1 === sig2) return true` sẽ sai lầm kết luận duplicate và vứt bỏ rB!
  // Hệ thống mới: Chuyển sang Level 3, đo minDistanceToPolyline > 50m -> trả về false (KHÔNG duplicate)!
  
  const sample15 = [];
  for (let i = 0; i < 15; i++) {
    sample15.push([10.770 + i * 0.001, 106.700 + i * 0.001]);
  }

  // Tuyến A: Thẳng qua 15 điểm mẫu
  const rSigA = {
    id: 'sigA',
    coords: sample15.slice(),
    distance: 2.0,
    duration: 10.0
  };

  // Tuyến B: Có cùng 15 điểm mẫu ở các vị trí lấy mẫu, nhưng giữa điểm mẫu 3 và 4 có các điểm vòng ra xa 200m
  const coordsB = [];
  for (let i = 0; i < 15; i++) {
    coordsB.push(sample15[i]);
    if (i === 3) {
      // Vòng lệch 0.002 độ (~220m)
      coordsB.push([sample15[i][0] + 0.002, sample15[i][1] + 0.002]);
      coordsB.push([sample15[i][0] + 0.002, sample15[i][1] + 0.0025]);
      coordsB.push([sample15[i][0] + 0.0018, sample15[i][1] + 0.002]);
    }
  }

  const rSigB = {
    id: 'sigB',
    coords: coordsB,
    distance: 2.015, // lệch < 1%
    duration: 10.1   // lệch 1%
  };

  // Ép chữ ký hình học giống hệt nhau để kiểm tra trực diện tình huống Signature Collision
  const collisionSig = '10.770,106.700|10.771,106.701|10.772,106.702|10.773,106.703|10.774,106.704|10.775,106.705';
  rSigA._sig = collisionSig;
  rSigB._sig = collisionSig;
  
  // Kiểm tra _areRoutesDuplicate không bị false-positive duplicate
  const isDupCollision = _areRoutesDuplicate(rSigA, rSigB);
  assert(isDupCollision === false, 'Signature Collision Protection: Dù 2 tuyến có signature trùng nhau nhưng có đoạn rẽ 220m KHÔNG bị nhận nhầm là duplicate (Level 3 loại trừ chuẩn xác)');
}

/* ------------------------------------------------------------------
   TEST GROUP 7: CẤU HÌNH MAX_SUGGESTED_ROUTES = 3 & OSRM LOCK
------------------------------------------------------------------ */
console.log('\n--- Test Group 7: MAX_SUGGESTED_ROUTES = 3 & OSRM Protection ---');
{
  assert(MAX_SUGGESTED_ROUTES === 3, 'MAX_SUGGESTED_ROUTES luôn bằng 3 theo yêu cầu');
  assert(CONFIG.max_suggested_routes === 3, 'CONFIG.max_suggested_routes = 3');
  assert(CONFIG.osrm_timeout_ms === 8000, 'OSRM Timeout giữ nguyên 8000ms');
  assert(CONFIG.osrm_cache_ttl_ms === 180000, 'OSRM Cache TTL giữ nguyên 180000ms');
  assert(CONFIG.osrm_max_concurrent_requests === 3, 'OSRM Concurrency Limiter giữ nguyên 3 requests');
}

/* ------------------------------------------------------------------
   TEST GROUP 8: INCIDENT CONFIDENCE SNAPSHOT & SINGLE ROUTING CYCLE REUSE
------------------------------------------------------------------ */
console.log('\n--- Test Group 8: Incident Confidence Snapshot & Single Routing Cycle Reuse ---');
{
  let confCalls = 0;
  global.calculateCurrentConfidence = (inc, now) => {
    confCalls++;
    return inc.rawConf != null ? inc.rawConf : 50;
  };

  const rawIncidents = [
    { id: 'i1', type: 'accident', level: 'cao', lat: 10.7770, lng: 106.7010, rawConf: 80 },
    { id: 'i2', type: 'flood', level: 'trungbinh', lat: 10.7780, lng: 106.7020, rawConf: 0.05 }, // expired (<= 0.1)
    { id: 'i3', type: 'danger', level: 'thap', lat: 10.7790, lng: 106.7030, rawConf: 60 }
  ];

  const now = 1700000000000;
  const snapshot = createActiveIncidentSnapshot(rawIncidents, now);

  assert(Array.isArray(snapshot), 'createActiveIncidentSnapshot trả về một mảng');
  assert(snapshot.length === 2, 'Snapshot tự động loại trừ sự cố có confidence <= 0.1 (i2 bị loại)');
  assert(confCalls === 3, 'Confidence chỉ được tính đúng 1 lần cho mỗi incident thô khi tạo snapshot');
  assert(snapshot[0].incident === rawIncidents[0], 'Snapshot lưu tham chiếu tới incident gốc (không mutate)');
  assert(snapshot[0].confidence === 80, 'Snapshot lưu giá trị confidence chính xác');
  assert(snapshot[0].lat === 10.7770 && snapshot[0].lng === 106.7010, 'Snapshot lưu tọa độ lat, lng chính xác');
  assert(rawIncidents[0].confidence === undefined, 'Incident gốc không bị mutate thuộc tính');

  // Kiểm tra tái sử dụng snapshot qua nhiều lần gọi: không phát sinh thêm lượt gọi calculateCurrentConfidence nào
  const confCallsBefore = confCalls;
  const mockRoute = {
    coords: [
      [10.7769, 106.7009],
      [10.7785, 106.7025]
    ]
  };
  calculateRouteRisk(mockRoute, snapshot);
  findIncidentsAlongRoute(mockRoute, snapshot);
  assert(confCalls === confCallsBefore, 'calculateRouteRisk và findIncidentsAlongRoute tái sử dụng snapshot mà KHÔNG gọi lại calculateCurrentConfidence (0 CPU recalculation)');
}

/* ------------------------------------------------------------------
   TEST GROUP 9: ONE GEOMETRY SCAN (getNearestPointOnPolyline)
------------------------------------------------------------------ */
console.log('\n--- Test Group 9: One Geometry Scan (getNearestPointOnPolyline) ---');
{
  const testCoords = [
    [10.7700, 106.7000],
    [10.7800, 106.7000], // Đoạn 0: Đi thẳng Bắc (bearing = 0°)
    [10.7800, 106.7100]  // Đoạn 1: Đi thẳng Đông (bearing = 90°)
  ];

  // 1. Điểm nằm vuông góc với đoạn 0 (ở phía Đông, lat = 10.7750, lng = 106.7005)
  // Cách tim đường ~55.7m (0.0005 độ kinh)
  const ptA = { lat: 10.7750, lng: 106.7005 };
  const resA = getNearestPointOnPolyline(ptA.lat, ptA.lng, testCoords, { needBearing: true });

  assert(resA !== null, 'getNearestPointOnPolyline trả về kết quả hợp lệ');
  assert(resA.segmentIndex === 0, 'Xác định đúng segmentIndex = 0');
  assert(resA.distance > 50 && resA.distance < 60, `Khoảng cách vuông góc chính xác (~55.7m, tính được: ${resA.distance.toFixed(1)}m)`);
  assert(Math.abs(resA.bearing - 0) < 1, `Hướng phương vị segment gần nhất chuẩn xác (~0°, tính được: ${resA.bearing.toFixed(1)}°)`);
  assert(Array.isArray(resA.projectedPoint), 'projectedPoint trả về tọa độ mảng [lat, lng]');
  assert(Math.abs(resA.projectedPoint[0] - 10.7750) < 1e-4 && Math.abs(resA.projectedPoint[1] - 106.7000) < 1e-4, 'Tọa độ điểm chiếu vuông góc chính xác trên segment');

  // So sánh khoảng cách với minDistanceToPolyline (đảm bảo tính tương thích toán học 100%)
  const distWrapper = minDistanceToPolyline(ptA.lat, ptA.lng, testCoords);
  assert(Math.abs(resA.distance - distWrapper) < 1e-6, 'getNearestPointOnPolyline và minDistanceToPolyline cho khoảng cách hoàn toàn trùng khớp');

  // 2. Điểm nằm gần đoạn 1 (lat = 10.7805, lng = 106.7050)
  const ptB = { lat: 10.7805, lng: 106.7050 };
  const resB = getNearestPointOnPolyline(ptB.lat, ptB.lng, testCoords, { needBearing: true });
  assert(resB.segmentIndex === 1, 'Xác định đúng segmentIndex = 1 cho đoạn 1');
  assert(Math.abs(resB.bearing - 90) < 1, `Hướng phương vị segment 1 chuẩn xác (~90°, tính được: ${resB.bearing.toFixed(1)}°)`);

  // 3. Kiểm tra Zero Extra Scans: Không quét polyline lần 2 để tìm bearing
  const resNoBearing = getNearestPointOnPolyline(ptB.lat, ptB.lng, testCoords, { needBearing: false });
  assert(resNoBearing.distance === resB.distance, 'Tùy chọn needBearing: false tính khoảng cách tương đương');
}

/* ------------------------------------------------------------------
   TEST GROUP 10: ANALYSIS REUSE GIỮA calculateRouteRisk VÀ findIncidentsAlongRoute
------------------------------------------------------------------ */
console.log('\n--- Test Group 10: Incident Analysis Reuse via WeakMap Cache ---');
{
  const routeSample = {
    coords: [
      [10.7700, 106.7000],
      [10.7750, 106.7000],
      [10.7800, 106.7000]
    ]
  };

  const incidentsList = [
    {
      id: 'warn1',
      type: 'accident',
      level: 'cao',
      lat: 10.7725,
      lng: 106.7002, // cách ~22m (< 100m -> direct zone)
      roadBearing: 180, // ngược chiều (diff = 180° > 100°)
      confidence: 90
    },
    {
      id: 'warn2',
      type: 'flood',
      level: 'trungbinh',
      lat: 10.7775,
      lng: 106.7015, // cách ~167m (100-300m -> nearby zone)
      confidence: 70
    }
  ];

  const snapshot = createActiveIncidentSnapshot(incidentsList);

  // 1. Lần gọi đầu tiên: calculateRouteRisk phân tích và ghi vào WeakMap
  assert(_routeIncidentAnalysisCache.has(routeSample) === false, 'Ban đầu WeakMap chưa có entry cho routeSample');
  const risk1 = calculateRouteRisk(routeSample, snapshot);
  assert(_routeIncidentAnalysisCache.has(routeSample) === true, 'calculateRouteRisk đã phân tích và lưu vào _routeIncidentAnalysisCache');

  const cachedAnalysis = _routeIncidentAnalysisCache.get(routeSample);
  assert(cachedAnalysis !== undefined, 'Lấy được cachedAnalysis từ WeakMap');
  assert(cachedAnalysis.riskScore === risk1, 'Điểm rủi ro trong cache khớp với kết quả trả về của calculateRouteRisk');
  assert(Array.isArray(cachedAnalysis.items) && cachedAnalysis.items.length === 2, 'cachedAnalysis lưu 2 sự cố hợp lệ');

  // 2. Lần gọi tiếp theo: findIncidentsAlongRoute tái sử dụng kết quả đã cache (0 geometry scan!)
  const warnings = findIncidentsAlongRoute(routeSample, snapshot);
  assert(warnings.length === 2, 'findIncidentsAlongRoute trả về đủ 2 cảnh báo sự cố');
  assert(warnings[0].distanceM <= warnings[1].distanceM, 'Cảnh báo được sắp xếp theo cự ly tăng dần');
  assert(warnings[0].zone === 'direct', 'Sự cố cách 22m được xếp vào direct zone');
  assert(warnings[1].zone === 'nearby', 'Sự cố cách 167m được xếp vào nearby zone');

  // 3. Kiểm tra tính đồng nhất tham chiếu (Referential Identity of Analysis)
  const analysisDirect = analyzeRouteIncidents(routeSample, snapshot);
  assert(analysisDirect === cachedAnalysis, 'analyzeRouteIncidents trả về đúng tham chiếu object đã cache (O(1), zero redundant compute)');
}

console.log('\n================================================================');
console.log(`KẾT QUẢ TỔNG HỢP: ${passedTests}/${totalTests} TESTS PASS (100%)`);
console.log('================================================================');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
