/**
 * ============================================================================
 * SafeRoute Research Project: Main Application Orchestrator
 * File: js/app.js
 * 
 * Mục đích nghiên cứu:
 * Điều phối luồng làm việc chính của ứng dụng:
 * 1. Khởi động ứng dụng và liên kết các module (Graph, Map, Routing, UI)
 * 2. Lắng nghe các sự kiện tìm đường (onFindRouteClick) và đảo chiều (swapLocations)
 * 3. Chuyển đổi linh hoạt giữa các chế độ: Nhanh nhất (alpha=0), Cân bằng (alpha=1), An toàn nhất (alpha=3)
 * 4. Tự động phản ứng và vẽ lại tuyến đường khi dữ liệu sự cố thay đổi ('incidents-changed')
 * ============================================================================
 */

(function () {
  'use strict';

  const _shortenDisplayName = (typeof window !== 'undefined' && window.shortenDisplayName) ? window.shortenDisplayName : (s => s);
  const _isValidCoordinate = (typeof window !== 'undefined' && window.isValidCoordinate) ? window.isValidCoordinate : ((lat, lng) => true);
  const _haversineMeters = (typeof window !== 'undefined' && window.haversineMeters) ? window.haversineMeters : ((lat1, lng1, lat2, lng2) => 0);

  function _cleanupExpiredIncidents() {
    if (typeof window !== 'undefined' && typeof window.cleanupExpiredIncidents === 'function') {
      window.cleanupExpiredIncidents();
    }
  }

  function _initMap() {
    if (typeof window !== 'undefined' && typeof window.initMap === 'function') {
      window.initMap();
    }
  }

  function _updateStartMarker(...args) {
    if (typeof window !== 'undefined' && typeof window.updateStartMarker === 'function') {
      window.updateStartMarker(...args);
    }
  }

  function _updateEndMarker(...args) {
    if (typeof window !== 'undefined' && typeof window.updateEndMarker === 'function') {
      window.updateEndMarker(...args);
    }
  }

  async function _findSafeRoutes(...args) {
    if (typeof window !== 'undefined' && typeof window.findSafeRoutes === 'function') {
      return await window.findSafeRoutes(...args);
    }
    return [];
  }

  function _calculateRouteRisk(...args) {
    if (typeof window !== 'undefined' && typeof window.calculateRouteRisk === 'function') {
      return window.calculateRouteRisk(...args);
    }
    return 0;
  }

  function _sortRoutesByMode(...args) {
    if (typeof window !== 'undefined' && typeof window.sortRoutesByMode === 'function') {
      return window.sortRoutesByMode(...args);
    }
    return args[0] || [];
  }

  function _renderRoutes(...args) {
    if (typeof window !== 'undefined' && typeof window.renderRoutes === 'function') {
      window.renderRoutes(...args);
    }
  }

  function _renderTransportFallback(...args) {
    if (typeof window !== 'undefined' && typeof window.renderTransportFallback === 'function') {
      window.renderTransportFallback(...args);
    }
  }

  function _showToast(text) {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(text);
    }
  }

  function _openSheet() {
    if (typeof window !== 'undefined' && typeof window.openSheet === 'function') {
      window.openSheet();
    }
  }

  /* ---------------------------------------------------------------
     TRẠNG THÁI TÌM ĐƯỜNG HIỆN HÀNH
  --------------------------------------------------------------- */
  let selectedMode = 'balanced';
  let isFindingRoute = false;
  let currentRoutes = [];
  let selectedRouteId = null;
  let transportFallback = null;
  let _rerouteTimer = null;

  /**
   * Xử lý khi người dùng nhấn nút "Tìm đường an toàn"
   */
  async function onFindRouteClick() {
    if (_rerouteTimer) {
      clearTimeout(_rerouteTimer);
      _rerouteTimer = null;
    }
    if (isFindingRoute) return;

    const currentStart = (typeof window !== 'undefined') ? window.startLocation : null;
    const currentEnd = (typeof window !== 'undefined') ? window.endLocation : null;
    const endText = document.getElementById('end-input')?.value.trim();

    if (!currentStart || !_isValidCoordinate(currentStart.lat, currentStart.lng)) {
      _showToast('Vui lòng chọn điểm bắt đầu hợp lệ.');
      return;
    }
    if (!endText) {
      _showToast('Vui lòng nhập hoặc chọn điểm đến trên bản đồ.');
      return;
    }

    // Reset kết quả trước đó
    if (typeof window !== 'undefined') {
      if (window.transportFallbackLayerGroup) window.transportFallbackLayerGroup.clearLayers();
      if (window.routeLayerGroup) window.routeLayerGroup.clearLayers();
      window.transportFallback = null;
    }
    transportFallback = null;

    isFindingRoute = true;
    setFindButtonLoading(true, 'Đang tìm tuyến đường...');

    try {
      let activeEnd = currentEnd;

      // Nếu người dùng chỉ gõ chữ vào ô điểm đến mà chưa click chọn gợi ý
      if (!activeEnd) {
        setFindButtonLoading(true, 'Đang xác định địa điểm...');
        const res = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
          format: 'json', q: endText, limit: '1', countrycodes: 'vn', addressdetails: '1'
        }), { headers: { 'Accept-Language': 'vi' } });
        if (!res.ok) throw new Error('Nominatim error');
        const results = await res.json();
        if (!results?.length) {
          _showToast('Không tìm thấy địa điểm. Vui lòng chọn từ gợi ý hoặc chạm bản đồ.');
          return;
        }
        const r = results[0];
        if (!_isValidCoordinate(+r.lat, +r.lon)) {
          _showToast('Tọa độ điểm đến không hợp lệ.');
          return;
        }
        activeEnd = {
          lat: +r.lat,
          lng: +r.lon,
          label: _shortenDisplayName(r.display_name),
          source: 'fallback'
        };
        if (typeof window !== 'undefined') window.endLocation = activeEnd;
        const endInput = document.getElementById('end-input');
        if (endInput) endInput.value = activeEnd.label;
        _updateEndMarker(activeEnd.lat, activeEnd.lng, activeEnd.label);
        setFindButtonLoading(true, 'Đang tìm tuyến đường...');
      }

      const dist = _haversineMeters(currentStart.lat, currentStart.lng, activeEnd.lat, activeEnd.lng);
      if (dist < 50) {
        _showToast('Điểm bắt đầu và điểm đến quá gần nhau (cùng 1 vị trí).');
        return;
      }

      _cleanupExpiredIncidents();
      const routes = await _findSafeRoutes(currentStart, activeEnd);

      // Đảm bảo không bị race condition nếu người dùng đã đổi điểm đi/đến trong khi đang tìm kiếm
      const latestStart = (typeof window !== 'undefined') ? window.startLocation : null;
      const latestEnd = (typeof window !== 'undefined') ? window.endLocation : null;
      if (latestStart && latestEnd && 
          (latestStart.lat !== currentStart.lat || latestStart.lng !== currentStart.lng || 
           latestEnd.lat !== activeEnd.lat || latestEnd.lng !== activeEnd.lng)) {
        return;
      }

      if (routes.length === 0) {
        const fallbackResult = (typeof window !== 'undefined') ? window.transportFallback : transportFallback;
        if (fallbackResult) {
          _renderTransportFallback(fallbackResult);
          _showToast('Đang đề xuất phương án kết hợp trung chuyển.');
          if (window.innerWidth <= 820) _openSheet();
          return;
        }
        _showToast('Không tìm thấy tuyến đường hợp lệ.');
        return;
      }

      routes.forEach(r => {
        r.riskScore = _calculateRouteRisk(r);
      });

      currentRoutes = routes;
      if (typeof window !== 'undefined') window.currentRoutes = routes;

      const sorted = _sortRoutesByMode(routes, selectedMode);
      selectedRouteId = sorted[0]?.id || null;
      if (typeof window !== 'undefined') window.selectedRouteId = selectedRouteId;

      _renderRoutes(routes, selectedMode);

      if (window.innerWidth <= 820) _openSheet();

    } catch (err) {
      console.error('[SafeRoute] Lỗi tìm tuyến:', err);
      _showToast('Không thể tìm tuyến đường. Vui lòng thử lại.');
    } finally {
      isFindingRoute = false;
      setFindButtonLoading(false, 'Tìm đường an toàn');
    }
  }

  function setFindButtonLoading(isLoading, label) {
    const btn = document.getElementById('find-btn');
    const lbl = document.getElementById('find-btn-label');
    if (btn) btn.disabled = isLoading;
    if (lbl) lbl.textContent = label || (isLoading ? 'Đang tìm...' : 'Tìm đường an toàn');
  }

  /**
   * Đảo vị trí giữa điểm bắt đầu và điểm đến
   */
  function swapLocations() {
    if (typeof window !== 'undefined') {
      if (window.transportFallbackLayerGroup) window.transportFallbackLayerGroup.clearLayers();
      if (window.routeLayerGroup) window.routeLayerGroup.clearLayers();
      window.transportFallback = null;
      window.currentRoutes = [];
      window.selectedRouteId = null;
    }
    transportFallback = null;
    currentRoutes = [];
    selectedRouteId = null;

    const resultsEl = document.getElementById('route-results');
    if (resultsEl) resultsEl.classList.remove('show');

    const si = document.getElementById('start-input');
    const ei = document.getElementById('end-input');
    if (si && ei) {
      const tmpText = si.value;
      si.value = ei.value;
      ei.value = tmpText;
    }

    const curStart = (typeof window !== 'undefined') ? window.startLocation : null;
    const curEnd = (typeof window !== 'undefined') ? window.endLocation : null;

    const tmpLoc = curStart;
    if (typeof window !== 'undefined') {
      window.startLocation = curEnd;
      window.endLocation = tmpLoc;
    }

    const newStart = (typeof window !== 'undefined') ? window.startLocation : null;
    const newEnd = (typeof window !== 'undefined') ? window.endLocation : null;

    if (newStart && _isValidCoordinate(newStart.lat, newStart.lng)) {
      _updateStartMarker(newStart.lat, newStart.lng, newStart.label);
    } else {
      if (typeof window !== 'undefined' && window.startMarker && window.map) {
        window.map.removeLayer(window.startMarker);
      }
      _showToast('Vui lòng chọn lại điểm bắt đầu.');
    }

    if (newEnd && _isValidCoordinate(newEnd.lat, newEnd.lng)) {
      _updateEndMarker(newEnd.lat, newEnd.lng, newEnd.label);
    } else {
      if (typeof window !== 'undefined' && window.endMarker && window.map) {
        window.map.removeLayer(window.endMarker);
      }
    }

    if (typeof window !== 'undefined' && typeof window.renderNearbyPanel === 'function') {
      window.renderNearbyPanel();
    }
  }

  /**
   * Khởi động ứng dụng
   */
  function startApp() {
    _initMap();

    // Đăng ký sự kiện chuyển đổi chế độ Nhanh nhất / Cân bằng / An toàn nhất
    const modeGroup = document.getElementById('mode-group');
    if (modeGroup) {
      modeGroup.addEventListener('change', e => {
        selectedMode = e.target.value;
        if (typeof window !== 'undefined') window.selectedMode = selectedMode;
        document.querySelectorAll('.mode-option').forEach(opt => {
          opt.classList.toggle('checked', opt.dataset.mode === selectedMode);
        });
        if (transportFallback) return;
        if (currentRoutes.length > 0) {
          _renderRoutes(currentRoutes, selectedMode);
        }
      });
    }

    // Tự động tính toán lại tuyến đường khi có sự cố mới hoặc độ tin cậy thay đổi (debounced 800ms)
    window.addEventListener('incidents-changed', () => {
      const curStart = window.startLocation;
      const curEnd = window.endLocation;
      if (currentRoutes.length > 0 && curStart && curEnd) {
        if (_rerouteTimer) clearTimeout(_rerouteTimer);
        _rerouteTimer = setTimeout(() => {
          _rerouteTimer = null;
          onFindRouteClick();
        }, 800);
      }
    });

    window.addEventListener('resize', () => {
      if (typeof window !== 'undefined' && window.map) window.map.invalidateSize();
    });
  }

  // Gắn lên window để truy cập từ HTML onclick
  if (typeof window !== 'undefined') {
    window.selectedMode = selectedMode;
    window.isFindingRoute = isFindingRoute;
    window.currentRoutes = currentRoutes;
    window.selectedRouteId = selectedRouteId;
    window.transportFallback = transportFallback;
    window.onFindRouteClick = onFindRouteClick;
    window.setFindButtonLoading = setFindButtonLoading;
    window.swapLocations = swapLocations;
    window.startApp = startApp;
  }

  // Khởi chạy khi DOM sẵn sàng
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startApp);
    } else {
      startApp();
    }
  }
})();

