/**
 * ============================================================================
 * SafeRoute Research Project: Nominatim Geocoding & Autocomplete
 * File: js/autocomplete.js
 * 
 * Mục đích nghiên cứu:
 * Cung cấp khả năng tìm kiếm địa danh và chuyển đổi địa chỉ thành tọa độ WGS84
 * thông qua OpenStreetMap Nominatim API, có chống nghẽn (debounce 400ms).
 * ============================================================================
 */

const _escapeHtml = (typeof window !== 'undefined' && window.escapeHtml) ? window.escapeHtml : (s => s);
const _shortenDisplayName = (typeof window !== 'undefined' && window.shortenDisplayName) ? window.shortenDisplayName : (s => s);


let startSearchTimer = null;
let endSearchTimer = null;
let startSearchToken = 0;
let endSearchToken = 0;

/* ---------------------------------------------------------------
   ĐIỂM BẮT ĐẦU (START LOCATION AUTOCOMPLETE)
--------------------------------------------------------------- */

function initStartLocationControls() {
  const input = document.getElementById('start-input');
  const gpsBtn = document.getElementById('gps-btn');
  if (gpsBtn) gpsBtn.addEventListener('click', handleGpsClick);
  if (!input) return;

  input.addEventListener('focus', () => {
    if (input.value.trim().length < 2) showStartQuickOptions();
  });

  input.addEventListener('input', () => {
    if (typeof window !== 'undefined') window.startLocation = null;
    if (typeof window.renderNearbyPanel === 'function') window.renderNearbyPanel();
    clearTimeout(startSearchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      showStartQuickOptions();
      return;
    }
    startSearchTimer = setTimeout(() => searchStartLocation(q), 400);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#start-field')) hideStartSuggestions();
    if (!e.target.closest('#end-field')) hideEndSuggestions();
    if (!e.target.closest('.report-location-wrap') && typeof window.hideReportSuggestions === 'function') {
      window.hideReportSuggestions();
    }
  });
}

function showStartQuickOptions() {
  const box = document.getElementById('start-suggestions');
  if (!box) return;
  box.innerHTML = `<li class="suggestion-item pick-map-option" role="option">
    <i class="fa-solid fa-location-crosshairs" style="color:var(--primary)"></i>
    <div><div class="s-main">Sử dụng định vị GPS hiện tại</div></div></li>`;
  box.classList.remove('hidden');
  document.getElementById('start-input')?.setAttribute('aria-expanded', 'true');
  box.querySelector('.pick-map-option')?.addEventListener('click', () => {
    hideStartSuggestions();
    handleGpsClick();
  });
}

function hideStartSuggestions() {
  const box = document.getElementById('start-suggestions');
  if (!box) return;
  box.classList.add('hidden');
  box.innerHTML = '';
  document.getElementById('start-input')?.setAttribute('aria-expanded', 'false');
}

async function searchStartLocation(query) {
  const token = ++startSearchToken;
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      format: 'json', q: query, limit: '5', countrycodes: 'vn', addressdetails: '1'
    }), { headers: { 'Accept-Language': 'vi' } });
    if (token !== startSearchToken) return;
    if (!res.ok) throw new Error();
    const results = await res.json();
    if (token !== startSearchToken) return;
    renderStartSuggestions(results);
  } catch {
    if (token !== startSearchToken) return;
    if (typeof window.showToast === 'function') window.showToast('Không thể tìm địa điểm.');
  }
}

function renderStartSuggestions(results) {
  const box = document.getElementById('start-suggestions');
  if (!box) return;
  if (!results?.length) {
    box.innerHTML = '<li class="suggestion-empty">Không tìm thấy địa điểm phù hợp.</li>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = results.map((r, i) => {
    const s = _shortenDisplayName(r.display_name);
    const m = s.split(',')[0], sub = s.split(',').slice(1).join(',').trim();
    return `<li class="suggestion-item" role="option" data-index="${i}">
      <i class="fa-solid fa-location-dot"></i>
      <div><div class="s-main">${_escapeHtml(m)}</div>${sub ? `<div class="s-sub">${_escapeHtml(sub)}</div>` : ''}</div>
    </li>`;
  }).join('');
  box.classList.remove('hidden');
  document.getElementById('start-input')?.setAttribute('aria-expanded', 'true');

  box.querySelectorAll('.suggestion-item[data-index]').forEach(item => {
    item.addEventListener('click', () => {
      const r = results[+item.dataset.index];
      const lbl = _shortenDisplayName(r.display_name);
      if (typeof window.setStartLocation === 'function') {
        window.setStartLocation(+r.lat, +r.lon, lbl, 'search');
      }
      if (window.map) window.map.setView([+r.lat, +r.lon], 16);
      hideStartSuggestions();
      if (typeof window.showToast === 'function') window.showToast('Đã chọn điểm bắt đầu.');
    });
  });
}

/* ---------------------------------------------------------------
   ĐIỂM ĐẾN (END LOCATION AUTOCOMPLETE)
--------------------------------------------------------------- */

function initEndLocationControls() {
  const input = document.getElementById('end-input');
  if (!input) return;

  input.addEventListener('focus', () => {
    if (input.value.trim().length < 2) showEndQuickOptions();
  });

  input.addEventListener('input', () => {
    if (typeof window !== 'undefined') window.endLocation = null;
    clearTimeout(endSearchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      showEndQuickOptions();
      return;
    }
    endSearchTimer = setTimeout(() => searchEndLocation(q), 400);
  });
}

function showEndQuickOptions() {
  const box = document.getElementById('end-suggestions');
  if (!box) return;
  box.innerHTML = `<li class="suggestion-item pick-map-option" role="option">
    <i class="fa-solid fa-map-location-dot" style="color:var(--c-accident)"></i>
    <div><div class="s-main">Chạm trực tiếp vào bản đồ để chọn vị trí muốn đến</div></div></li>`;
  box.classList.remove('hidden');
  document.getElementById('end-input')?.setAttribute('aria-expanded', 'true');
  box.querySelector('.pick-map-option')?.addEventListener('click', () => {
    hideEndSuggestions();
    if (typeof window.showToast === 'function') window.showToast('Chạm vào bản đồ để chọn vị trí muốn đến.');
    if (window.innerWidth <= 820 && typeof window.closeSheet === 'function') {
      window.closeSheet();
    }
  });
}

function hideEndSuggestions() {
  const box = document.getElementById('end-suggestions');
  if (!box) return;
  box.classList.add('hidden');
  box.innerHTML = '';
  document.getElementById('end-input')?.setAttribute('aria-expanded', 'false');
}

async function searchEndLocation(query) {
  const token = ++endSearchToken;
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      format: 'json', q: query, limit: '5', countrycodes: 'vn', addressdetails: '1'
    }), { headers: { 'Accept-Language': 'vi' } });
    if (token !== endSearchToken) return;
    if (!res.ok) throw new Error();
    const results = await res.json();
    if (token !== endSearchToken) return;
    renderEndSuggestions(results);
  } catch {
    if (token !== endSearchToken) return;
    if (typeof window.showToast === 'function') window.showToast('Không thể tìm địa điểm.');
  }
}

function renderEndSuggestions(results) {
  const box = document.getElementById('end-suggestions');
  if (!box) return;
  if (!results?.length) {
    box.innerHTML = '<li class="suggestion-empty">Không tìm thấy địa điểm phù hợp.</li>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = results.map((r, i) => {
    const s = _shortenDisplayName(r.display_name);
    const m = s.split(',')[0], sub = s.split(',').slice(1).join(',').trim();
    return `<li class="suggestion-item" role="option" data-index="${i}">
      <i class="fa-solid fa-flag-checkered"></i>
      <div><div class="s-main">${_escapeHtml(m)}</div>${sub ? `<div class="s-sub">${_escapeHtml(sub)}</div>` : ''}</div>
    </li>`;
  }).join('');
  box.classList.remove('hidden');
  document.getElementById('end-input')?.setAttribute('aria-expanded', 'true');

  box.querySelectorAll('.suggestion-item[data-index]').forEach(item => {
    item.addEventListener('click', () => {
      const r = results[+item.dataset.index];
      const label = _shortenDisplayName(r.display_name);
      if (typeof window.setEndLocation === 'function') {
        window.setEndLocation(+r.lat, +r.lon, label, 'search');
      }
      if (window.map) window.map.setView([+r.lat, +r.lon], 16);
      hideEndSuggestions();
      if (typeof window.showToast === 'function') window.showToast('Đã chọn điểm đến.');
    });
  });
}

// Gắn lên window
if (typeof window !== 'undefined') {
  window.initStartLocationControls = initStartLocationControls;
  window.showStartQuickOptions = showStartQuickOptions;
  window.hideStartSuggestions = hideStartSuggestions;
  window.searchStartLocation = searchStartLocation;
  window.renderStartSuggestions = renderStartSuggestions;
  window.initEndLocationControls = initEndLocationControls;
  window.showEndQuickOptions = showEndQuickOptions;
  window.hideEndSuggestions = hideEndSuggestions;
  window.searchEndLocation = searchEndLocation;
  window.renderEndSuggestions = renderEndSuggestions;
}
