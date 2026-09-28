/**
 * ============================================================================
 * SafeRoute Research Project: UI Components, Gestures & Incident Reporting
 * File: js/ui.js
 * 
 * Mục đích nghiên cứu:
 * Điều khiển các tương tác giao diện người dùng:
 * - Hệ thống Toast thông báo thời gian thực
 * - Bottom Sheet responsive cử chỉ vuốt chạm (Pointer/Touch Gesture Dragging)
 * - Modal báo cáo sự cố cộng đồng kèm Mini-Map Leaflet độc lập
 * ============================================================================
 */

// Helper functions — dùng function declaration với tên riêng (_ui_ prefix)
// để tránh xung đột với config.js (cùng global scope, const/function không được khai báo lại)
function _ui_escapeHtml(s) { return (window.escapeHtml || ((x) => x))(s); }
function _ui_shortenDisplayName(s) { return (window.shortenDisplayName || ((x) => x))(s); }
function _ui_isValidCoordinate(lat, lng) { return (window.isValidCoordinate || (() => true))(lat, lng); }

function _addOrConfirmIncident(data) {
  if (typeof window !== 'undefined' && typeof window.addOrConfirmIncident === 'function') {
    return window.addOrConfirmIncident(data);
  }
}

function _getMainMap() {
  return (typeof window !== 'undefined') ? window.map : null;
}

/* ---------------------------------------------------------------
   1. TOAST NOTIFICATION
--------------------------------------------------------------- */
let toastTimer = null;
function showToast(text) {
  const t = document.getElementById('toast');
  const span = document.getElementById('toast-text');
  if (!t || !span) return;
  span.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ---------------------------------------------------------------
   2. BOTTOM SHEET MOBILE GESTURES
--------------------------------------------------------------- */
function toggleSheet() {
  const s = document.getElementById('sidebar');
  if (s) s.classList.toggle('expanded');
}

function openSheet() {
  const s = document.getElementById('sidebar');
  if (s) s.classList.add('expanded');
}

function closeSheet() {
  const s = document.getElementById('sidebar');
  if (s) s.classList.remove('expanded');
}

function isHandleOrTopZone(e, sidebar) {
  if (e.target.closest('.sheet-handle')) return true;
  const rect = sidebar.getBoundingClientRect();
  return (e.clientY - rect.top) <= 44;
}

function initBottomSheetGestures() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  let startY = 0;
  let startX = 0;
  let startExpanded = false;
  let baseTranslate = 0;
  let maxTranslate = 0;
  let isDragging = false;
  let activePointerId = null;
  let didDrag = false;

  function onPointerDown(e) {
    if (window.innerWidth > 820) return;
    if (!isHandleOrTopZone(e, sidebar)) return;

    activePointerId = e.pointerId;
    startY = e.clientY;
    startX = e.clientX;
    startExpanded = sidebar.classList.contains('expanded');
    const sidebarHeight = sidebar.offsetHeight;
    maxTranslate = Math.max(0, sidebarHeight - 128);
    baseTranslate = startExpanded ? 0 : maxTranslate;
    isDragging = false;
  }

  function onPointerMove(e) {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const deltaY = e.clientY - startY;
    const deltaX = e.clientX - startX;

    if (!isDragging) {
      if (Math.abs(deltaY) > 6 && Math.abs(deltaY) > Math.abs(deltaX)) {
        isDragging = true;
        sidebar.classList.add('sheet-dragging');
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch (_) {}
      } else {
        return;
      }
    }

    if (e.cancelable) e.preventDefault();

    let currentTranslate = baseTranslate + deltaY;
    if (currentTranslate < 0) {
      currentTranslate = currentTranslate * 0.2;
    } else if (currentTranslate > maxTranslate) {
      currentTranslate = maxTranslate + (currentTranslate - maxTranslate) * 0.2;
    }
    sidebar.style.transform = `translateY(${currentTranslate}px)`;
  }

  function onPointerUp(e) {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    activePointerId = null;
    sidebar.classList.remove('sheet-dragging');
    sidebar.style.transform = '';

    if (isDragging) {
      const deltaY = e.clientY - startY;
      didDrag = true;
      setTimeout(() => { didDrag = false; }, 250);

      const SHEET_DRAG_THRESHOLD = 60;
      if (startExpanded) {
        if (deltaY > SHEET_DRAG_THRESHOLD) {
          closeSheet();
        } else {
          openSheet();
        }
      } else {
        if (deltaY < -SHEET_DRAG_THRESHOLD) {
          openSheet();
        } else {
          closeSheet();
        }
      }
      isDragging = false;
    }
  }

  sidebar.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

/* ---------------------------------------------------------------
   3. MODAL BÁO CÁO SỰ CỐ & MINI MAP ĐỘC LẬP
--------------------------------------------------------------- */
let reportMap = null;
let reportMarker = null;
let reportMapInitialized = false;
let reportSelectedLatLng = null;
let reportSearchTimer = null;
let reportSearchToken = 0;

function openReportModal() {
  const modal = document.getElementById('report-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  setTimeout(() => {
    initReportMap();
    if (!reportSelectedLatLng) {
      const startLoc = (typeof window !== 'undefined') ? window.startLocation : null;
      const center = (startLoc && _ui_isValidCoordinate(startLoc.lat, startLoc.lng))
        ? { lat: startLoc.lat, lng: startLoc.lng }
        : { lat: 10.7769, lng: 106.7009 };
      selectReportLocation(center, startLoc?.label);
      if (reportMap) reportMap.setView([center.lat, center.lng], 15);
    }
  }, 100);
}

function closeReportModal() {
  const modal = document.getElementById('report-modal');
  if (modal) modal.classList.add('hidden');
  hideReportSuggestions();

  // Reset form để lần báo cáo sau bắt đầu sạch
  const desc = document.getElementById('report-desc');
  if (desc) desc.value = '';
  reportSelectedLatLng = null;
  if (reportMarker && reportMap) {
    reportMap.removeLayer(reportMarker);
    reportMarker = null;
  }
  const locInput = document.getElementById('report-location');
  if (locInput) locInput.value = '';
  document.querySelectorAll('.level-pill').forEach(p => p.classList.remove('checked'));
  document.querySelector('.level-pill.low')?.classList.add('checked');
  const lowRadio = document.querySelector('input[name="level"][value="thap"]');
  if (lowRadio) lowRadio.checked = true;
}

function initReportMap() {
  if (reportMapInitialized) {
    setTimeout(() => reportMap?.invalidateSize(), 100);
    return;
  }

  reportMap = L.map('report-mini-map', {
    zoomControl: true,
    attributionControl: true
  }).setView([10.7769, 106.7009], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(reportMap);

  reportMap.on('click', e => {
    hideReportSuggestions();
    selectReportLocation(e.latlng);
  });

  reportMapInitialized = true;
  setTimeout(() => reportMap?.invalidateSize(), 100);
}

function selectReportLocation(latlng, customLabel) {
  reportSelectedLatLng = { lat: latlng.lat, lng: latlng.lng };

  if (reportMarker) {
    reportMap.removeLayer(reportMarker);
    reportMarker = null;
  }

  const icon = L.divIcon({
    className: '',
    html: '<div class="report-location-marker"><i class="fa-solid fa-location-dot"></i></div>',
    iconSize: [36, 36],
    iconAnchor: [18, 34]
  });

  reportMarker = L.marker([latlng.lat, latlng.lng], { icon, draggable: true }).addTo(reportMap);

  reportMarker.on('dragend', e => {
    const pos = e.target.getLatLng();
    reportSelectedLatLng = { lat: pos.lat, lng: pos.lng };
    updateReportLocationText(pos.lat, pos.lng);
  });

  if (customLabel) {
    const input = document.getElementById('report-location');
    if (input) input.value = customLabel;
  } else {
    updateReportLocationText(latlng.lat, latlng.lng);
  }
}

let reportSelectedOsmId = null;

async function updateReportLocationText(lat, lng) {
  const input = document.getElementById('report-location');
  if (!input) return;
  input.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({
      format: 'json', lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '1', 'accept-language': 'vi'
    }));
    if (!res.ok) return;
    const data = await res.json();
    if (data?.display_name) input.value = _ui_shortenDisplayName(data.display_name);
    if (data?.osm_type === 'way' && data?.osm_id) {
      reportSelectedOsmId = String(data.osm_id);
    }
  } catch (_) {}
}

function useCurrentLocationForReport() {
  if (!navigator.geolocation) {
    showToast('Trình duyệt không hỗ trợ định vị.');
    return;
  }
  const btn = document.getElementById('report-current-location');
  if (btn) btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    pos => {
      if (btn) btn.disabled = false;
      const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hideReportSuggestions();
      selectReportLocation(latlng);
      if (reportMap) reportMap.setView([latlng.lat, latlng.lng], 17);
    },
    () => {
      if (btn) btn.disabled = false;
      showToast('Không thể lấy vị trí hiện tại. Hãy chọn trực tiếp trên bản đồ.');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function initReportLocationControls() {
  const input = document.getElementById('report-location');
  if (!input) return;

  input.addEventListener('input', () => {
    reportSelectedLatLng = null;
    clearTimeout(reportSearchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      hideReportSuggestions();
      return;
    }
    reportSearchTimer = setTimeout(() => searchReportLocation(q), 400);
  });
}

function hideReportSuggestions() {
  const box = document.getElementById('report-suggestions');
  if (!box) return;
  box.classList.add('hidden');
  box.innerHTML = '';
  document.getElementById('report-location')?.setAttribute('aria-expanded', 'false');
}

async function searchReportLocation(query) {
  const token = ++reportSearchToken;
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      format: 'json', q: query, limit: '5', countrycodes: 'vn', addressdetails: '1', 'accept-language': 'vi'
    }));
    if (token !== reportSearchToken) return;
    if (!res.ok) throw new Error();
    const results = await res.json();
    if (token !== reportSearchToken) return;
    renderReportSuggestions(results);
  } catch (_) {
    if (token !== reportSearchToken) return;
    showToast('Không thể tìm địa điểm.');
  }
}

function renderReportSuggestions(results) {
  const box = document.getElementById('report-suggestions');
  if (!box) return;
  if (!results?.length) {
    box.innerHTML = '<li class="suggestion-empty">Không tìm thấy địa điểm phù hợp.</li>';
    box.classList.remove('hidden');
    return;
  }

  box.innerHTML = results.map(r => {
    const s = _ui_shortenDisplayName(r.display_name);
    const m = s.split(',')[0], sub = s.split(',').slice(1).join(',').trim();
    const safeDisplay = _ui_escapeHtml(r.display_name).replace(/'/g, '&#39;');
    return `<li class="suggestion-item" role="option" onclick="selectReportSuggestion(${+r.lat}, ${+r.lon}, '${safeDisplay}')">
      <i class="fa-solid fa-location-dot"></i>
      <div><div class="s-main">${_ui_escapeHtml(m)}</div>${sub ? `<div class="s-sub">${_ui_escapeHtml(sub)}</div>` : ''}</div>
    </li>`;
  }).join('');
  box.classList.remove('hidden');
  document.getElementById('report-location')?.setAttribute('aria-expanded', 'true');
}

function selectReportSuggestion(lat, lon, rawDisplayName) {
  const label = _ui_shortenDisplayName(rawDisplayName);
  const input = document.getElementById('report-location');
  if (input) {
    input.value = label;
    input.setAttribute('aria-expanded', 'false');
  }
  hideReportSuggestions();
  const latlng = { lat: +lat, lng: +lon };
  selectReportLocation(latlng, label);
  if (reportMap) reportMap.setView([latlng.lat, latlng.lng], 16);
}

async function submitReport() {
  const type = document.getElementById('report-type')?.value;
  const level = document.querySelector('input[name="level"]:checked')?.value || 'thap';
  const desc = document.getElementById('report-desc')?.value.trim();

  if (!reportSelectedLatLng || !_ui_isValidCoordinate(reportSelectedLatLng.lat, reportSelectedLatLng.lng)) {
    showToast('Vui lòng chọn vị trí xảy ra sự cố trên bản đồ hoặc từ danh sách gợi ý.');
    return;
  }
  if (!desc) {
    showToast('Vui lòng nhập mô tả sự cố.');
    return;
  }

  const reportedLat = reportSelectedLatLng.lat;
  const reportedLng = reportSelectedLatLng.lng;
  const locationLabel = document.getElementById('report-location')?.value?.trim() || '';

  closeReportModal();

  try {
    await _addOrConfirmIncident({
      type,
      level,
      lat: reportedLat,
      lng: reportedLng,
      desc: desc,
      locationLabel: locationLabel,
      osmWayId: reportSelectedOsmId
    });
  } catch (err) {
    console.error('[SafeRoute] Lỗi khi thêm sự cố:', err);
  } finally {
    reportSelectedOsmId = null;
  }

  showToast('Đã gửi báo cáo sự cố. Cảm ơn bạn đã đóng góp cho cộng đồng!');

  // Di chuyển camera bản đồ chính tới vị trí sự cố vừa báo
  const mainMap = _getMainMap();
  if (mainMap) {
    mainMap.setView([reportedLat, reportedLng], 16);
  }
}

/* ---------------------------------------------------------------
   4. GẮN SỰ KIỆN CHO NÚT BÁO CÁO (#report-fab) & CHỌN MỨC ĐỘ
--------------------------------------------------------------- */
let reportUiBound = false;
function initReportModalControls() {
  if (reportUiBound) return;
  reportUiBound = true;

  const fab = document.getElementById('report-fab');
  if (fab) {
    fab.addEventListener('click', e => {
      e.stopPropagation();
      try {
        openReportModal();
      } catch (err) {
        console.error('[SafeRoute] Không mở được modal báo cáo:', err);
      }
    });
  } else {
    console.warn('[SafeRoute] Không tìm thấy #report-fab trong DOM.');
  }

  // Đổi trạng thái "checked" của các pill mức độ (Thấp / Trung bình / Cao)
  const levelGroup = document.getElementById('level-group');
  if (levelGroup) {
    levelGroup.addEventListener('change', e => {
      document.querySelectorAll('.level-pill').forEach(p => p.classList.remove('checked'));
      e.target.closest('.level-pill')?.classList.add('checked');
    });
  }

  // Bấm nền tối ngoài hộp thoại hoặc nhấn Esc để đóng
  const overlay = document.getElementById('report-modal');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeReportModal();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) closeReportModal();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReportModalControls);
  } else {
    initReportModalControls();
  }
}

// Gắn lên window
if (typeof window !== 'undefined') {
  window.showToast = showToast;
  window.toggleSheet = toggleSheet;
  window.openSheet = openSheet;
  window.closeSheet = closeSheet;
  window.initBottomSheetGestures = initBottomSheetGestures;
  window.openReportModal = openReportModal;
  window.closeReportModal = closeReportModal;
  window.initReportMap = initReportMap;
  window.selectReportLocation = selectReportLocation;
  window.updateReportLocationText = updateReportLocationText;
  window.useCurrentLocationForReport = useCurrentLocationForReport;
  window.initReportLocationControls = initReportLocationControls;
  window.hideReportSuggestions = hideReportSuggestions;
  window.searchReportLocation = searchReportLocation;
  window.renderReportSuggestions = renderReportSuggestions;
  window.selectReportSuggestion = selectReportSuggestion;
  window.submitReport = submitReport;
  window.initReportModalControls = initReportModalControls;
}