/**
 * ============================================================================
 * SafeRoute Research Project: Map Architecture (Leaflet + OpenStreetMap)
 * File: js/map.js
 * 
 * Mục đích nghiên cứu:
 * Điều khiển tầng hiển thị bản đồ trực quan bằng Leaflet và OpenStreetMap (OSM).
 * Quản lý các lớp Layer (Tile Layer, Incident Markers, Polyline Routes, Fallback Transit)
 * và tương tác địa lý (Geocoding, Reverse Geocoding, GPS Snapping, Map Click/Tap).
 * ============================================================================
 */

const _escapeHtml = (typeof window !== 'undefined' && window.escapeHtml) ? window.escapeHtml : (str => str);
const _shortenDisplayName = (typeof window !== 'undefined' && window.shortenDisplayName) ? window.shortenDisplayName : (str => str);
const _isValidCoordinate = (typeof window !== 'undefined' && window.isValidCoordinate) ? window.isValidCoordinate : ((lat, lng) => true);
const _haversineMeters = (typeof window !== 'undefined' && window.haversineMeters) ? window.haversineMeters : ((lat1, lng1, lat2, lng2) => 0);
const _INCIDENT_TYPES = (typeof window !== 'undefined' && window.INCIDENT_TYPES) ? window.INCIDENT_TYPES : {};
const _LEVEL_LABEL = (typeof window !== 'undefined' && window.LEVEL_LABEL) ? window.LEVEL_LABEL : {};

/* ---------------------------------------------------------------
   TRẠNG THÁI BẢN ĐỒ VÀ CÁC LAYER GROUPS
--------------------------------------------------------------- */
let map = null;
let tileLayers = {};
let currentTileStyle = 'osm';
let incidentLayerGroup = null;
let routeLayerGroup = null;
let transportFallbackLayerGroup = null;

let startLocation = { lat: 10.7725, lng: 106.6980, label: 'Chợ Bến Thành', source: 'default' };
let endLocation = null;
let startMarker = null;
let endMarker = null;

/**
 * Khởi tạo bản đồ chính Leaflet với các lớp tile OpenStreetMap
 */
function initMap() {
  const mapElement = document.getElementById('map');
  if (!mapElement) return;

  if (map) {
    try { map.remove(); } catch (_) {}
    map = null;
  }

  // Khởi tạo bản đồ Leaflet OpenStreetMap
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true
  }).setView([10.7769, 106.7009], 13);
  if (typeof window !== 'undefined') window.map = map;

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // 1. Cấu hình Tile Layers phong phú
  tileLayers = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">mapdata from OpenStreetMap</a>'
    }),
    osmHot: L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; IzekNguyen bult saferoute, Humanitarian style'
    }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '&copy; OpenTopoMap (OSM)'
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: '&copy; Esri World Imagery'
    })
  };
  if (typeof window !== 'undefined') window.tileLayers = tileLayers;

  currentTileStyle = 'osm';
  tileLayers.osm.addTo(map);

  incidentLayerGroup = L.layerGroup().addTo(map);
  routeLayerGroup = L.layerGroup().addTo(map);
  transportFallbackLayerGroup = L.layerGroup().addTo(map);
  if (typeof window !== 'undefined') {
    window.incidentLayerGroup = incidentLayerGroup;
    window.routeLayerGroup = routeLayerGroup;
    window.transportFallbackLayerGroup = transportFallbackLayerGroup;
  }

  // Phân biệt chính xác giữa kéo/pan bản đồ và click/tap chọn điểm
  let mapWasDragged = false;
  let pointerDownPos = null;

  mapElement.addEventListener('pointerdown', e => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
    mapWasDragged = false;
  }, { passive: true });

  mapElement.addEventListener('pointermove', e => {
    if (!pointerDownPos) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (Math.hypot(dx, dy) > 8) {
      mapWasDragged = true;
    }
  }, { passive: true });

  const clearPointer = () => {
    setTimeout(() => {
      pointerDownPos = null;
      mapWasDragged = false;
    }, 150);
  };
  mapElement.addEventListener('pointerup', clearPointer, { passive: true });
  mapElement.addEventListener('pointercancel', clearPointer, { passive: true });

  map.on('movestart zoomstart dragstart', () => {
    mapWasDragged = true;
  });
  map.on('moveend zoomend dragend', () => {
    setTimeout(() => {
      mapWasDragged = false;
    }, 150);
  });

  // CLICK/TAP TRỰC TIẾP VÙNG TRỐNG BẢN ĐỒ = CHỌN VỊ TRÍ MUỐN ĐẾN (ĐIỂM ĐÍCH)
  map.on('click', function (e) {
    if (mapWasDragged || !e.latlng) return;

    // Tránh kích hoạt khi bấm vào marker, popup, control hoặc nút FAB
    const target = e.originalEvent?.target;
    if (target && target.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control, .transport-hub-combo, #report-fab')) {
      return;
    }

    selectEndFromMap(e.latlng);
  });

  renderIncidents();
  renderNearbyPanel();

  if (startLocation) updateStartMarker(startLocation.lat, startLocation.lng, startLocation.label);
  if (endLocation) updateEndMarker(endLocation.lat, endLocation.lng, endLocation.label);

  if (typeof window !== 'undefined') {
    if (typeof window.initStartLocationControls === 'function') window.initStartLocationControls();
    if (typeof window.initEndLocationControls === 'function') window.initEndLocationControls();
    if (typeof window.initReportLocationControls === 'function') window.initReportLocationControls();
    if (typeof window.initBottomSheetGestures === 'function') window.initBottomSheetGestures();
  }

  // Cập nhật lại kích thước hiển thị bản đồ sau khi DOM render xong
  setTimeout(() => { if (map) map.invalidateSize(); }, 150);
  setTimeout(() => { if (map) map.invalidateSize(); }, 500);
}

/**
 * Chuyển đổi phong cách hiển thị bản đồ (Chuẩn, Nhân đạo, Địa hình, Vệ tinh)
 * @param {string} styleKey 
 */
function switchMapStyle(styleKey) {
  if (!tileLayers[styleKey] || currentTileStyle === styleKey) return;
  map.removeLayer(tileLayers[currentTileStyle]);
  tileLayers[styleKey].addTo(map);
  tileLayers[styleKey].bringToBack();
  currentTileStyle = styleKey;

  document.querySelectorAll('.map-style-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`btn-style-${styleKey}`)?.classList.add('active');
}

/* ---------------------------------------------------------------
   QUẢN LÝ MARKER ĐIỂM BẮT ĐẦU VÀ ĐIỂM ĐẾN
--------------------------------------------------------------- */

function setStartLocation(lat, lng, label, source) {
  startLocation = { lat, lng, label, source };
  if (typeof window !== 'undefined') window.startLocation = startLocation;
  const input = document.getElementById('start-input');
  if (input) input.value = label;
  updateStartMarker(lat, lng, label);
  renderNearbyPanel();
}

function updateStartMarker(lat, lng, label) {
  if (!map) return;
  if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
  const icon = L.divIcon({
    className: '',
    html: '<div class="start-marker-icon"><i class="fa-solid fa-person-walking"></i></div>',
    iconSize: [34, 34],
    iconAnchor: [17, 32]
  });
  startMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
  if (typeof window !== 'undefined') window.startMarker = startMarker;
  startMarker.bindPopup(`
    <div class="popup-box">
      <div class="p-head"><i class="fa-solid fa-location-dot" style="color:var(--primary)"></i> Điểm bắt đầu</div>
      <div class="p-row"><b>${escapeHtml(label)}</b></div>
    </div>`);
}

function setEndLocation(lat, lng, label, source) {
  endLocation = { lat, lng, label, source };
  if (typeof window !== 'undefined') window.endLocation = endLocation;
  const input = document.getElementById('end-input');
  if (input) input.value = label;
  updateEndMarker(lat, lng, label);
}

function updateEndMarker(lat, lng, label) {
  if (!map) return;
  if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
  const icon = L.divIcon({
    className: '',
    html: '<div class="end-marker-icon"><i class="fa-solid fa-flag-checkered"></i></div>',
    iconSize: [36, 36],
    iconAnchor: [18, 34]
  });
  endMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
  if (typeof window !== 'undefined') window.endMarker = endMarker;
  endMarker.bindPopup(`
    <div class="popup-box">
      <div class="p-head"><i class="fa-solid fa-flag-checkered" style="color:#dc2626"></i> Điểm đến</div>
      <div class="p-row"><b>${escapeHtml(label)}</b></div>
    </div>`);
}

/**
 * Chọn điểm đến bằng cách chạm trực tiếp lên bản đồ
 * @param {{ lat: number, lng: number }} latlng 
 */
function selectEndFromMap(latlng) {
  const { lat, lng } = latlng;
  const fallback = lat.toFixed(5) + ', ' + lng.toFixed(5);
  setEndLocation(lat, lng, fallback, 'map');
  reverseGeocodeEndLabel(lat, lng);
  if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
    window.showToast('Đã chọn vị trí muốn đến trên bản đồ.');
  }
  if (window.innerWidth <= 820 && typeof window.openSheet === 'function') {
    window.openSheet();
  }
}

function reverseGeocodeEndLabel(lat, lng) {
  fetch('https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({
    format: 'json', lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '1'
  }), { headers: { 'Accept-Language': 'vi' } })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!endLocation || Math.abs(endLocation.lat - lat) > 0.0001 || Math.abs(endLocation.lng - lng) > 0.0001) return;
      if (d?.display_name) {
        const lbl = shortenDisplayName(d.display_name);
        endLocation.label = lbl;
        const input = document.getElementById('end-input');
        if (input) input.value = lbl;
        if (endMarker) {
          endMarker.bindPopup(`
            <div class="popup-box">
              <div class="p-head"><i class="fa-solid fa-flag-checkered" style="color:#dc2626"></i> Điểm đến</div>
              <div class="p-row"><b>${escapeHtml(lbl)}</b></div>
            </div>`);
        }
      }
    }).catch(() => {});
}

/**
 * Chọn điểm bắt đầu bằng chạm trực tiếp
 * @param {{ lat: number, lng: number }} latlng 
 */
function selectStartFromMap(latlng) {
  const { lat, lng } = latlng;
  const fallback = lat.toFixed(5) + ', ' + lng.toFixed(5);
  setStartLocation(lat, lng, fallback, 'map');
  reverseGeocodeStartLabel(lat, lng);
  if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
    window.showToast('Đã chọn điểm bắt đầu trên bản đồ.');
  }
  if (window.innerWidth <= 820 && typeof window.openSheet === 'function') {
    window.openSheet();
  }
}

function reverseGeocodeStartLabel(lat, lng) {
  fetch('https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({
    format: 'json', lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '1'
  }), { headers: { 'Accept-Language': 'vi' } })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!startLocation || startLocation.lat !== lat || startLocation.lng !== lng) return;
      if (d?.display_name) {
        const lbl = shortenDisplayName(d.display_name);
        startLocation.label = lbl;
        const input = document.getElementById('start-input');
        if (input) input.value = lbl;
        if (startMarker) {
          startMarker.bindPopup(`
            <div class="popup-box">
              <div class="p-head"><i class="fa-solid fa-location-dot" style="color:var(--primary)"></i> Điểm bắt đầu</div>
              <div class="p-row"><b>${escapeHtml(lbl)}</b></div>
            </div>`);
        }
      }
    }).catch(() => {});
}

/**
 * Xử lý định vị vị trí hiện tại của thiết bị qua Geolocation API
 */
function handleGpsClick(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const gpsBtnEl = document.getElementById('gps-btn');
  if (gpsBtnEl && gpsBtnEl.classList.contains('loading')) return; // tránh gọi trùng (onclick + addEventListener)
  if (!navigator.geolocation) {
    if (typeof window.showToast === 'function') window.showToast('Trình duyệt không hỗ trợ định vị.');
    return;
  }
  const btn = document.getElementById('gps-btn');
  if (btn) btn.classList.add('loading');

  navigator.geolocation.getCurrentPosition(
    pos => {
      if (btn) btn.classList.remove('loading');
      setStartLocation(pos.coords.latitude, pos.coords.longitude, 'Vị trí hiện tại', 'gps');
      if (map) map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      if (typeof window.showToast === 'function') window.showToast('Đã lấy vị trí hiện tại.');
    },
    err => {
      if (btn) btn.classList.remove('loading');
      const msgs = {
        [err.PERMISSION_DENIED]: 'Bạn chưa cho phép truy cập vị trí.',
        [err.POSITION_UNAVAILABLE]: 'Không thể xác định vị trí hiện tại.',
        [err.TIMEOUT]: 'Lấy vị trí quá lâu, vui lòng thử lại.',
      };
      if (typeof window.showToast === 'function') {
        window.showToast(msgs[err.code] || 'Không thể lấy vị trí hiện tại.');
      }
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
  );
}

/**
 * Vẽ các điểm sự cố giao thông lên LayerGroup trên bản đồ
 */
function renderIncidents() {
  if (!incidentLayerGroup) return;
  incidentLayerGroup.clearLayers();

  const now = Date.now();
  const incList = (typeof window !== 'undefined' && window.incidents) ? window.incidents : [];
  const confFn = (typeof window !== 'undefined' && window.calculateCurrentConfidence) ? window.calculateCurrentConfidence : () => 50;
  const colorFn = (typeof window !== 'undefined' && window.getConfidenceColor) ? window.getConfidenceColor : () => 'var(--risk-mid)';
  const typesMeta = (typeof window !== 'undefined' && window.INCIDENT_TYPES) ? window.INCIDENT_TYPES : _INCIDENT_TYPES;
  const levelsMeta = (typeof window !== 'undefined' && window.LEVEL_LABEL) ? window.LEVEL_LABEL : _LEVEL_LABEL;
  const esc = (typeof window !== 'undefined' && window.escapeHtml) ? window.escapeHtml : _escapeHtml;

  for (const inc of incList) {
    const currentC = confFn(inc, now);
    if (currentC <= 0.1) continue;

    const meta = typesMeta[inc.type] || { emoji: '⚠️', label: 'Sự cố', color: '#e3492c' };
    const markerOpacity = Math.min(1.0, Math.max(0.85, 0.75 + (currentC / 100) * 0.25));
    const confColor = colorFn(currentC);
    const levelColor = inc.level === 'cao' ? 'var(--risk-high)' : inc.level === 'trungbinh' ? 'var(--risk-mid)' : 'var(--risk-low)';

    const icon = L.divIcon({
      className: '',
      html: `<div class="incident-marker" style="border-color:${meta.color};opacity:${markerOpacity};box-shadow:0 4px 12px ${meta.color}66, 0 3px 8px rgba(0,0,0,0.38);"><span>${meta.emoji}</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 30]
    });

    const marker = L.marker([inc.lat, inc.lng], { icon }).addTo(incidentLayerGroup);
    const popupContent = `
      <div class="popup-box">
        <div class="p-head">${meta.emoji} ${meta.label}</div>
        <div class="confidence-bar"><div class="confidence-fill" style="width:${Math.round(currentC)}%;background:${confColor}"></div></div>
        <div class="p-row"><span>Độ tin cậy</span><b style="color:${confColor}">${Math.round(currentC)}%</b></div>
        <div class="p-row"><span>Báo cáo</span><b>${inc.reporterCount || 1} người</b></div>
        <div class="p-row"><span>Mô tả</span><b>${esc(inc.desc)}</b></div>
        <div class="p-row"><span>Cập nhật</span><b>${(typeof window.formatRelativeTime === 'function') ? window.formatRelativeTime(inc.lastConfirmedAt || inc.createdAt) : ''}</b></div>
        <span class="p-level" style="background:${levelColor}22;color:${levelColor}">
          Mức độ: ${levelsMeta[inc.level] || inc.level}
        </span>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e5e7eb;display:flex;gap:6px;">
          <button style="flex:1;background:var(--primary-light);color:var(--primary-dark);border:1px solid var(--primary);border-radius:6px;padding:5px 4px;font-size:11px;font-weight:700;cursor:pointer;" onclick="voteConfirmIncident('${inc.id}')">
            👍 Xác nhận (+50%)
          </button>
          <button style="flex:1;background:#fef2f2;color:#ef4444;border:1px solid #fca5a5;border-radius:6px;padding:5px 4px;font-size:11px;font-weight:700;cursor:pointer;" onclick="dismissIncident('${inc.id}')">
            ❌ Hết sự cố
          </button>
        </div>
      </div>`;
    marker.bindPopup(popupContent);
  }
}

/**
 * Hiển thị panel danh sách "Cảnh báo gần bạn" (bán kính <= 3000m)
 */
function renderNearbyPanel() {
  const listEl = document.getElementById('nearby-list');
  if (!listEl) return;

  if (!startLocation || !isValidCoordinate(startLocation.lat, startLocation.lng)) {
    listEl.innerHTML = '<div class="np-empty" style="font-size:12px;color:var(--text-muted);padding:4px 0;">Chưa xác định vị trí.</div>';
    return;
  }

  const now = Date.now();
  const validNearby = [];

  for (const inc of incidents) {
    const currentC = calculateCurrentConfidence(inc, now);
    if (currentC <= 0.1) continue;

    const distM = haversineMeters(startLocation.lat, startLocation.lng, inc.lat, inc.lng);
    if (distM <= 3000) {
      validNearby.push({ incident: inc, distance: distM });
    }
  }

  if (validNearby.length === 0) {
    listEl.innerHTML = '<div class="np-empty" style="font-size:12px;color:var(--text-muted);padding:4px 0;">Không có cảnh báo gần bạn.</div>';
    return;
  }

  validNearby.sort((a, b) => a.distance - b.distance);
  const topNearby = validNearby.slice(0, 5);

  listEl.innerHTML = topNearby.map(item => {
    const inc = item.incident;
    const meta = INCIDENT_TYPES[inc.type] || { emoji: '⚠️', label: 'Sự cố' };
    const distText = item.distance < 1000 ? `${Math.round(item.distance)}m` : `${(item.distance / 1000).toFixed(1)}km`;
    return `<div class="np-item">
      <span class="np-label">${meta.emoji} ${escapeHtml(meta.label)}</span>
      <span class="np-dist">${distText}</span>
    </div>`;
  }).join('');
}

// Gắn lên window để truy cập từ UI
if (typeof window !== 'undefined') {
  window.map = map;
  window.tileLayers = tileLayers;
  window.currentTileStyle = currentTileStyle;
  window.incidentLayerGroup = incidentLayerGroup;
  window.routeLayerGroup = routeLayerGroup;
  window.transportFallbackLayerGroup = transportFallbackLayerGroup;
  window.startLocation = startLocation;
  window.endLocation = endLocation;
  window.startMarker = startMarker;
  window.endMarker = endMarker;
  window.initMap = initMap;
  window.switchMapStyle = switchMapStyle;
  window.setStartLocation = setStartLocation;
  window.updateStartMarker = updateStartMarker;
  window.setEndLocation = setEndLocation;
  window.updateEndMarker = updateEndMarker;
  window.selectEndFromMap = selectEndFromMap;
  window.reverseGeocodeEndLabel = reverseGeocodeEndLabel;
  window.selectStartFromMap = selectStartFromMap;
  window.reverseGeocodeStartLabel = reverseGeocodeStartLabel;
  window.handleGpsClick = handleGpsClick;
  window.renderIncidents = renderIncidents;
  window.renderNearbyPanel = renderNearbyPanel;
}