/* ═══════════════════════════════════════════════════════
   SehatBengkulu — app.js
   WebGIS Fasilitas Kesehatan Kota Bengkulu
════════════════════════════════════════════════════════ */

'use strict';

// ── CONFIG ────────────────────────────────────────────
const CONFIG = {
  center: [-3.8004, 102.2655],   // Bengkulu city center
  zoom: 14,
  minZoom: 11,
  maxZoom: 19,
  geojsonPath: 'data/facilities.geojson',
  nearbyCount: 5,
  emergencyCount: 5,
};

// ── TYPE META ─────────────────────────────────────────
const TYPE_META = {
  hospital:  { label: 'Rumah Sakit', icon: '🏨', emoji: '🏨' },
  puskesmas: { label: 'Puskesmas',   icon: '🏥', emoji: '🏥' },
  clinic:    { label: 'Klinik',      icon: '🩺', emoji: '🩺' },
  pharmacy:  { label: 'Apotek',      icon: '💊', emoji: '💊' },
  dental:    { label: 'Klinik Gigi', icon: '🦷', emoji: '🦷' },
  optic:     { label: 'Optik',       icon: '👓', emoji: '👓' },
};

// ── STATE ─────────────────────────────────────────────
const state = {
  facilities: [],       // all features from GeoJSON
  filtered: [],         // currently visible features
  activeCategory: 'all',
  activeFilters: new Set(),
  searchQuery: '',
  userLocation: null,   // { lat, lng }
  userMarker: null,
  activeMarkerId: null,
  sidebarOpen: true,
  markers: {},          // id → Leaflet marker
};

// ── DOM REFS ──────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dom = {
  searchInput:     $('searchInput'),
  searchClear:     $('searchClear'),
  btnLocate:       $('btnLocate'),
  btnEmergency:    $('btnEmergency'),
  btnToggleSidebar:$('btnToggleSidebar'),
  btnClearLocation:$('btnClearLocation'),
  btnZoomIn:       $('btnZoomIn'),
  btnZoomOut:      $('btnZoomOut'),
  btnResetView:    $('btnResetView'),
  sidebar:         $('sidebar'),
  facilityList:    $('facilityList'),
  nearbySection:   $('nearbySection'),
  nearbyList:      $('nearbyList'),
  resultsCount:    $('resultsCount'),
  // Stats
  statTotal:       $('statTotal'),
  statHospital:    $('statHospital'),
  statPuskesmas:   $('statPuskesmas'),
  statClinic:      $('statClinic'),
  statPharmacy:    $('statPharmacy'),
  statOther:       $('statOther'),
  // Detail panel
  detailPanel:     $('detailPanel'),
  detailOverlay:   $('detailOverlay'),
  detailClose:     $('detailClose'),
  detailContent:   $('detailContent'),
  // Emergency modal
  emergencyModal:  $('emergencyModal'),
  emergencyOverlay:$('emergencyOverlay'),
  emergencyClose:  $('emergencyClose'),
  emergencyList:   $('emergencyList'),
  // Toast
  toast:           $('toast'),
  // Toggle icon
  toggleIcon:      $('toggleIcon'),
};

// ── MAP INIT ──────────────────────────────────────────
const map = L.map('map', {
  center: CONFIG.center,
  zoom: CONFIG.zoom,
  minZoom: CONFIG.minZoom,
  maxZoom: CONFIG.maxZoom,
  zoomControl: false,
  attributionControl: true,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: CONFIG.maxZoom,
}).addTo(map);

// Marker cluster group
const clusterGroup = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  iconCreateFunction(cluster) {
    const count = cluster.getChildCount();
    return L.divIcon({
      html: `<div class="cluster-icon">${count}</div>`,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  },
});
map.addLayer(clusterGroup);

// Inject cluster icon style dynamically
const clusterStyle = document.createElement('style');
clusterStyle.textContent = `
  .cluster-icon {
    width:40px; height:40px;
    background: linear-gradient(135deg,#22c55e,#14b8a6);
    border: 3px solid white;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 800; color: white;
    box-shadow: 0 4px 12px rgba(34,197,94,0.4);
  }
`;
document.head.appendChild(clusterStyle);

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

/**
 * Haversine distance in km between two lat/lng pairs.
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toRad(deg) { return (deg * Math.PI) / 180; }

/**
 * Format distance: "1.2 km" or "850 m"
 */
function formatDist(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/**
 * Get distance from user to a feature (or null if no user location).
 */
function getDistToUser(feature) {
  if (!state.userLocation) return null;
  const [lng, lat] = feature.geometry.coordinates;
  return haversine(state.userLocation.lat, state.userLocation.lng, lat, lng);
}

/**
 * Return Google Maps navigation URL for a feature.
 */
function getRouteUrl(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  if (state.userLocation) {
    return `https://www.google.com/maps/dir/${state.userLocation.lat},${state.userLocation.lng}/${lat},${lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Human-readable type label.
 */
function typeLabel(type) {
  return TYPE_META[type]?.label ?? type;
}
function typeIcon(type) {
  return TYPE_META[type]?.emoji ?? '📍';
}

/**
 * Show toast notification.
 */
let toastTimer;
function showToast(msg, variant = '', duration = 3000) {
  clearTimeout(toastTimer);
  dom.toast.textContent = msg;
  dom.toast.className = `toast show ${variant}`;
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('show');
  }, duration);
}

// ═══════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════

async function loadData() {
  try {
    const res = await fetch(CONFIG.geojsonPath);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();
    state.facilities = geojson.features;
    state.filtered = [...state.facilities];
    buildMarkers();
    renderFacilityList();
    updateStats();
    showToast(`${state.facilities.length} fasilitas berhasil dimuat`, 'success');
  } catch (err) {
    console.error('Failed to load GeoJSON:', err);
    showToast('Gagal memuat data fasilitas', 'error', 5000);
  }
}

// ═══════════════════════════════════════════════════════
// MARKERS
// ═══════════════════════════════════════════════════════

function createMarkerIcon(type) {
  const emoji = typeIcon(type);
  return L.divIcon({
    html: `
      <div class="custom-marker marker-${type}">
        <div class="marker-pin"><span>${emoji}</span></div>
      </div>`,
    className: '',
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -44],
  });
}

function buildMarkers() {
  clusterGroup.clearLayers();
  state.markers = {};

  state.facilities.forEach((feature) => {
    const p = feature.properties;
    const [lng, lat] = feature.geometry.coordinates;

    const marker = L.marker([lat, lng], {
      icon: createMarkerIcon(p.type),
      title: p.name,
    });

    marker.bindPopup(buildPopupHtml(feature), {
      maxWidth: 280,
      minWidth: 240,
      closeButton: false,
      className: '',
    });

    marker.on('click', () => {
      state.activeMarkerId = p.id;
      highlightListItem(p.id);
    });

    state.markers[p.id] = marker;
    clusterGroup.addLayer(marker);
  });
}

function buildPopupHtml(feature) {
  const p = feature.properties;
  const dist = getDistToUser(feature);
  const distBadge = dist
    ? `<span class="badge" style="background:#dcfce7;color:#166534;">📍 ${formatDist(dist)}</span>`
    : '';

  const bpjsBadge = p.bpjs
    ? `<span class="badge badge-bpjs">BPJS</span>` : '';
  const igdBadge = p.emergency
    ? `<span class="badge badge-igd">IGD</span>` : '';
  const h24Badge = p.opening_hours === '24 Jam'
    ? `<span class="badge badge-24h">24 Jam</span>` : '';

  return `
    <div class="popup-box type-${p.type}">
      <div class="popup-type-badge">${typeIcon(p.type)} ${typeLabel(p.type)}</div>
      <div class="popup-name">${p.name}</div>
      <div class="popup-address">📍 ${p.address}</div>
      <div class="popup-meta">
        ${bpjsBadge}${igdBadge}${h24Badge}${distBadge}
      </div>
      <div class="popup-actions">
        <button class="popup-btn popup-btn-detail" onclick="openDetail(${p.id})">
          ℹ️ Detail
        </button>
        <a class="popup-btn popup-btn-route"
           href="${getRouteUrl(feature)}" target="_blank" rel="noopener">
          🧭 Rute
        </a>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════
// FILTERING & SEARCH
// ═══════════════════════════════════════════════════════

function applyFilters() {
  const q = state.searchQuery.toLowerCase().trim();

  state.filtered = state.facilities.filter((feature) => {
    const p = feature.properties;

    // Category
    if (state.activeCategory !== 'all' && p.type !== state.activeCategory) {
      return false;
    }

    // Feature filters
    for (const f of state.activeFilters) {
      if (!p[f]) return false;
    }

    // Search
    if (q) {
      const searchable = [p.name, p.address, typeLabel(p.type)].join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }

    return true;
  });

  syncMarkerVisibility();
  renderFacilityList();
  updateStats();
}

function syncMarkerVisibility() {
  const visibleIds = new Set(state.filtered.map((f) => f.properties.id));

  // Remove all layers first, re-add visible ones
  clusterGroup.clearLayers();
  state.facilities.forEach((feature) => {
    const id = feature.properties.id;
    if (visibleIds.has(id)) {
      clusterGroup.addLayer(state.markers[id]);
    }
  });
}

// ═══════════════════════════════════════════════════════
// SIDEBAR LIST RENDERING
// ═══════════════════════════════════════════════════════

function renderFacilityList() {
  const list = dom.facilityList;
  dom.resultsCount.textContent = `${state.filtered.length} fasilitas`;

  if (state.filtered.length === 0) {
    list.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-text">Tidak ditemukan</div>
        <div class="no-results-sub">Coba ubah filter atau kata kunci pencarian</div>
      </div>`;
    return;
  }

  // Sort by distance if user location is available
  let sorted = [...state.filtered];
  if (state.userLocation) {
    sorted.sort((a, b) => (getDistToUser(a) ?? 999) - (getDistToUser(b) ?? 999));
  }

  list.innerHTML = sorted.map((feature) => {
    const p = feature.properties;
    const dist = getDistToUser(feature);
    const isActive = p.id === state.activeMarkerId;

    const badges = [
      p.bpjs      ? '<span class="badge badge-bpjs">BPJS</span>'  : '',
      p.emergency ? '<span class="badge badge-igd">IGD</span>'    : '',
      p.opening_hours === '24 Jam' ? '<span class="badge badge-24h">24J</span>' : '',
    ].join('');

    return `
      <div class="facility-item ${isActive ? 'active' : ''}"
           data-id="${p.id}"
           data-type="${p.type}"
           onclick="focusOnFacility(${p.id})">
        <div class="facility-item-icon">
          ${typeIcon(p.type)}
        </div>
        <div class="facility-item-body">
          <div class="facility-item-name">${p.name}</div>
          <div class="facility-item-meta">
            <span class="facility-item-type">${typeLabel(p.type)}</span>
            <div class="facility-item-badges">${badges}</div>
          </div>
        </div>
        ${dist !== null ? `<div class="facility-item-dist">${formatDist(dist)}</div>` : ''}
      </div>`;
  }).join('');
}

function highlightListItem(id) {
  document.querySelectorAll('.facility-item').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.id) === id);
  });
  // Scroll to item
  const el = document.querySelector(`.facility-item[data-id="${id}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════
// NEARBY LIST
// ═══════════════════════════════════════════════════════

function renderNearbyList() {
  if (!state.userLocation) {
    dom.nearbySection.style.display = 'none';
    return;
  }
  dom.nearbySection.style.display = 'block';

  const sorted = [...state.facilities]
    .map((f) => ({ feature: f, dist: getDistToUser(f) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, CONFIG.nearbyCount);

  dom.nearbyList.innerHTML = sorted.map(({ feature, dist }, i) => {
    const p = feature.properties;
    const rankClass = i < 3 ? `rank-${i + 1}` : '';
    return `
      <div class="nearby-item" onclick="focusOnFacility(${p.id})">
        <div class="nearby-rank ${rankClass}">${i + 1}</div>
        <div class="nearby-info">
          <div class="nearby-name">${p.name}</div>
          <div class="nearby-type">${typeLabel(p.type)}</div>
        </div>
        <div class="nearby-dist">${formatDist(dist)}</div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════

function updateStats() {
  const all = state.filtered;
  const count = (type) => all.filter((f) => f.properties.type === type).length;

  dom.statTotal.textContent    = all.length;
  dom.statHospital.textContent = count('hospital');
  dom.statPuskesmas.textContent= count('puskesmas');
  dom.statClinic.textContent   = count('clinic');
  dom.statPharmacy.textContent = count('pharmacy');
  dom.statOther.textContent    = count('dental') + count('optic');
}

// ═══════════════════════════════════════════════════════
// FOCUS & NAVIGATE TO FACILITY
// ═══════════════════════════════════════════════════════

function focusOnFacility(id) {
  const feature = state.facilities.find((f) => f.properties.id === id);
  if (!feature) return;

  const [lng, lat] = feature.geometry.coordinates;
  state.activeMarkerId = id;
  highlightListItem(id);

  map.flyTo([lat, lng], 17, { duration: 0.8 });

  // Open popup after fly
  setTimeout(() => {
    const marker = state.markers[id];
    if (marker) {
      clusterGroup.zoomToShowLayer(marker, () => {
        marker.openPopup();
      });
    }
  }, 900);
}

// ═══════════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════════

window.openDetail = function (id) {
  const feature = state.facilities.find((f) => f.properties.id === id);
  if (!feature) return;

  const p = feature.properties;
  const dist = getDistToUser(feature);

  const facilityItems = [
    { key: 'emergency',  label: 'IGD',            emoji: '🚨' },
    { key: 'inpatient',  label: 'Rawat Inap',     emoji: '🛏️' },
    { key: 'laboratory', label: 'Laboratorium',   emoji: '🔬' },
    { key: 'pharmacy',   label: 'Apotek/Farmasi', emoji: '💊' },
    { key: 'dental',     label: 'Layanan Gigi',   emoji: '🦷' },
    { key: 'bpjs',       label: 'Menerima BPJS',  emoji: '🪪' },
  ];

  const tagsHtml = facilityItems.map(({ key, label, emoji }) => `
    <span class="facility-tag ${p[key] ? 'tag-available' : 'tag-unavailable'}">
      ${emoji} ${label}
    </span>`).join('');

  const websiteRow = p.website
    ? `<div class="detail-info-row">
        <div class="detail-info-icon">🌐</div>
        <div class="detail-info-body">
          <div class="detail-info-label">Website</div>
          <div class="detail-info-value">
            <a href="${p.website}" target="_blank" rel="noopener">${p.website}</a>
          </div>
        </div>
      </div>` : '';

  const distHtml = dist !== null
    ? `<div class="detail-distance">📍 ${formatDist(dist)} dari lokasi Anda</div>` : '';

  const phoneLink = p.phone
    ? `<a href="tel:${p.phone.replace(/\D/g, '')}">${p.phone}</a>` : '-';

  dom.detailContent.innerHTML = `
    <div class="type-${p.type}">
      <div class="detail-header">
        <div class="detail-icon">${typeIcon(p.type)}</div>
        <div class="detail-header-text">
          <div class="detail-type-badge">${typeIcon(p.type)} ${typeLabel(p.type)}</div>
          <div class="detail-name">${p.name}</div>
          <div class="detail-status ${p.operational_status === 'open' ? 'status-open' : 'status-closed'}">
            <span class="status-dot"></span>
            ${p.operational_status === 'open' ? 'Beroperasi' : 'Tutup'}
          </div>
        </div>
      </div>

      ${distHtml}

      <div class="detail-info">
        <div class="detail-info-row">
          <div class="detail-info-icon">📍</div>
          <div class="detail-info-body">
            <div class="detail-info-label">Alamat</div>
            <div class="detail-info-value">${p.address}</div>
          </div>
        </div>
        <div class="detail-info-row">
          <div class="detail-info-icon">☎️</div>
          <div class="detail-info-body">
            <div class="detail-info-label">Telepon</div>
            <div class="detail-info-value">${phoneLink}</div>
          </div>
        </div>
        <div class="detail-info-row">
          <div class="detail-info-icon">🕐</div>
          <div class="detail-info-body">
            <div class="detail-info-label">Jam Operasional</div>
            <div class="detail-info-value">${p.opening_hours}</div>
          </div>
        </div>
        ${websiteRow}
        <div class="detail-info-row">
          <div class="detail-info-icon">ℹ️</div>
          <div class="detail-info-body">
            <div class="detail-info-label">Deskripsi</div>
            <div class="detail-info-value">${p.description}</div>
          </div>
        </div>
      </div>

      <div class="detail-facilities">
        <div class="detail-facilities-title">Fasilitas & Layanan</div>
        <div class="facility-tags">${tagsHtml}</div>
      </div>

      <div class="detail-actions">
        <a class="detail-btn detail-btn-route"
           href="${getRouteUrl(feature)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="3 11 22 2 13 21 11 13 3 11"/>
          </svg>
          Lihat Rute Navigasi
        </a>
        ${p.phone ? `
        <a class="detail-btn detail-btn-phone"
           href="tel:${p.phone.replace(/\D/g, '')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          Hubungi ${p.phone}
        </a>` : ''}
      </div>
    </div>`;

  dom.detailPanel.classList.add('open');
  dom.detailOverlay.classList.add('visible');
};

function closeDetail() {
  dom.detailPanel.classList.remove('open');
  dom.detailOverlay.classList.remove('visible');
}

// ═══════════════════════════════════════════════════════
// GEOLOCATION
// ═══════════════════════════════════════════════════════

function locateUser() {
  if (!navigator.geolocation) {
    showToast('Browser tidak mendukung geolokasi', 'error');
    return;
  }

  dom.btnLocate.classList.add('loading');
  dom.btnLocate.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      state.userLocation = { lat, lng };

      // Remove old user marker
      if (state.userMarker) map.removeLayer(state.userMarker);

      // Add user marker
      const userIcon = L.divIcon({
        html: '<div class="marker-user"></div>',
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      state.userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup('<b>📍 Lokasi Anda</b>', { closeButton: false })
        .openPopup();

      map.flyTo([lat, lng], 15, { duration: 1 });

      dom.btnLocate.classList.add('active');
      dom.btnLocate.classList.remove('loading');
      dom.btnLocate.disabled = false;

      // Rebuild popups with distance info
      rebuildPopups();
      renderNearbyList();
      renderFacilityList();

      showToast('Lokasi ditemukan!', 'success');
    },
    (err) => {
      dom.btnLocate.classList.remove('loading');
      dom.btnLocate.disabled = false;
      const msgs = {
        1: 'Akses lokasi ditolak. Izinkan akses lokasi di browser Anda.',
        2: 'Lokasi tidak tersedia saat ini.',
        3: 'Waktu habis. Coba lagi.',
      };
      showToast(msgs[err.code] ?? 'Gagal mendapatkan lokasi', 'error', 4000);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function clearUserLocation() {
  state.userLocation = null;
  if (state.userMarker) {
    map.removeLayer(state.userMarker);
    state.userMarker = null;
  }
  dom.btnLocate.classList.remove('active');
  dom.nearbySection.style.display = 'none';
  rebuildPopups();
  renderFacilityList();
  showToast('Lokasi dihapus');
}

function rebuildPopups() {
  state.facilities.forEach((feature) => {
    const marker = state.markers[feature.properties.id];
    if (marker) {
      marker.setPopupContent(buildPopupHtml(feature));
    }
  });
}

// ═══════════════════════════════════════════════════════
// EMERGENCY MODE
// ═══════════════════════════════════════════════════════

function openEmergencyModal() {
  const igdFacilities = state.facilities.filter((f) => f.properties.emergency);

  let sorted = [...igdFacilities];
  if (state.userLocation) {
    sorted.sort((a, b) => (getDistToUser(a) ?? 999) - (getDistToUser(b) ?? 999));
  }
  sorted = sorted.slice(0, CONFIG.emergencyCount);

  dom.emergencyList.innerHTML = sorted.length === 0
    ? '<p style="text-align:center;color:#94a3b8;padding:16px;">Tidak ada fasilitas IGD tersedia</p>'
    : sorted.map(({ properties: p, geometry: g }, i) => {
        const [lng, lat] = g.coordinates;
        const dist = getDistToUser({ geometry: g });
        const rankClass = i < 3 ? `rank-${i + 1}` : '';
        const routeUrl = state.userLocation
          ? `https://www.google.com/maps/dir/${state.userLocation.lat},${state.userLocation.lng}/${lat},${lng}`
          : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        return `
          <div class="emergency-item" onclick="focusOnFacility(${p.id}); closeEmergencyModal();">
            <div class="emergency-rank ${rankClass}">${i + 1}</div>
            <div class="emergency-info">
              <div class="emergency-name">${p.name}</div>
              <div class="emergency-addr">${p.address}</div>
            </div>
            <div class="emergency-right">
              ${dist !== null ? `<div class="emergency-dist">${formatDist(dist)}</div>` : ''}
              <a class="emergency-route" href="${routeUrl}" target="_blank"
                 rel="noopener" onclick="event.stopPropagation()">🧭 Rute</a>
            </div>
          </div>`;
      }).join('');

  dom.emergencyModal.classList.add('open');
  dom.emergencyOverlay.classList.add('visible');
}

window.closeEmergencyModal = function () {
  dom.emergencyModal.classList.remove('open');
  dom.emergencyOverlay.classList.remove('visible');
};

// ═══════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════

let searchDebounce;
dom.searchInput.addEventListener('input', () => {
  state.searchQuery = dom.searchInput.value;
  dom.searchClear.classList.toggle('visible', state.searchQuery.length > 0);
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(applyFilters, 280);
});

dom.searchClear.addEventListener('click', () => {
  dom.searchInput.value = '';
  state.searchQuery = '';
  dom.searchClear.classList.remove('visible');
  applyFilters();
  dom.searchInput.focus();
});

// ═══════════════════════════════════════════════════════
// CATEGORY BUTTONS
// ═══════════════════════════════════════════════════════

document.querySelectorAll('.cat-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeCategory = btn.dataset.type;
    applyFilters();
  });
});

// ═══════════════════════════════════════════════════════
// FEATURE FILTER CHECKBOXES
// ═══════════════════════════════════════════════════════

document.querySelectorAll('.filter-check').forEach((cb) => {
  cb.addEventListener('change', () => {
    if (cb.checked) {
      state.activeFilters.add(cb.dataset.filter);
      cb.closest('.filter-item').classList.add('checked');
    } else {
      state.activeFilters.delete(cb.dataset.filter);
      cb.closest('.filter-item').classList.remove('checked');
    }
    applyFilters();
  });
});

// ═══════════════════════════════════════════════════════
// SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════════

dom.btnToggleSidebar.addEventListener('click', () => {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    dom.sidebar.classList.toggle('mobile-open');
  } else {
    state.sidebarOpen = !state.sidebarOpen;
    dom.sidebar.classList.toggle('collapsed', !state.sidebarOpen);
    // Flip toggle arrow
    dom.toggleIcon.setAttribute('d',
      state.sidebarOpen ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6');
    setTimeout(() => map.invalidateSize(), 280);
  }
});

// ═══════════════════════════════════════════════════════
// MAP CONTROLS
// ═══════════════════════════════════════════════════════

dom.btnZoomIn.addEventListener('click',  () => map.zoomIn());
dom.btnZoomOut.addEventListener('click', () => map.zoomOut());
dom.btnResetView.addEventListener('click', () => {
  map.flyTo(CONFIG.center, CONFIG.zoom, { duration: 0.8 });
});

// ═══════════════════════════════════════════════════════
// LOCATE BUTTON
// ═══════════════════════════════════════════════════════

dom.btnLocate.addEventListener('click', () => {
  if (state.userLocation) {
    // If already located, fly back to user
    map.flyTo([state.userLocation.lat, state.userLocation.lng], 15, { duration: 0.8 });
  } else {
    locateUser();
  }
});

dom.btnClearLocation.addEventListener('click', clearUserLocation);

// ═══════════════════════════════════════════════════════
// EMERGENCY BUTTON
// ═══════════════════════════════════════════════════════

dom.btnEmergency.addEventListener('click', openEmergencyModal);
dom.emergencyClose.addEventListener('click', () => closeEmergencyModal());
dom.emergencyOverlay.addEventListener('click', () => closeEmergencyModal());

// ═══════════════════════════════════════════════════════
// DETAIL PANEL CLOSE
// ═══════════════════════════════════════════════════════

dom.detailClose.addEventListener('click', closeDetail);
dom.detailOverlay.addEventListener('click', closeDetail);

// Close detail with Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDetail();
    closeEmergencyModal();
  }
});

// ═══════════════════════════════════════════════════════
// MAP CLICK — close popups when clicking empty area
// ═══════════════════════════════════════════════════════

map.on('click', () => {
  state.activeMarkerId = null;
  document.querySelectorAll('.facility-item.active').forEach((el) => {
    el.classList.remove('active');
  });
});

// ═══════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════

window.addEventListener('resize', () => {
  map.invalidateSize();
  if (window.innerWidth > 768) {
    dom.sidebar.classList.remove('mobile-open');
  }
});

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════

loadData();
