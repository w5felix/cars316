// Leaflet basemap for NYC with simple crash dots
// Exports: renderLeafletNYC(containerId, points = [], options = {})

let maps = new Map(); // containerId -> L.Map
let dotLayers = new Map(); // containerId -> L.LayerGroup

export function renderLeafletNYC(containerId, points = [], options = {}) {
  const id = containerId.replace('#','');
  const el = document.getElementById(id) || document.querySelector(containerId);
  if (!el) throw new Error(`Leaflet container ${containerId} not found`);

  const {
    dotRadiusPx = 1, // 1/3 of previous default (3px)
    dotColor = '#e60026', // red dots by default
    dotOpacity = 0.75,
  } = options;

  // Ensure the container has some height; fallback if CSS not applied
  if (!el.style.height) {
    el.style.height = '50vh';
  }

  // Create or reuse map
  let map = maps.get(id);
  if (!map) {
    // NYC center and zoom
    const nyc = [40.7128, -74.0060];
    map = L.map(el, {
      center: nyc,
      zoom: 11,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    maps.set(id, map);

    // Slight delay to fix initial sizing if in a reveal animation
    setTimeout(() => map.invalidateSize(), 200);
  } else {
    // On re-render (e.g., resize), just invalidate size
    map.invalidateSize();
  }

  // Remove previous dots layer if present
  const prev = dotLayers.get(id);
  if (prev) {
    map.removeLayer(prev);
  }

  if (!points || points.length === 0) {
    dotLayers.set(id, null);
    return;
  }

  // Use canvas renderer for performance
  const canvas = L.canvas({ padding: 0.2 });
  const group = L.layerGroup([], { renderer: canvas });

  points.forEach(p => {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
    L.circleMarker([p.lat, p.lon], {
      radius: dotRadiusPx,
      renderer: canvas,
      color: dotColor,
      fillColor: dotColor,
      fillOpacity: dotOpacity,
      opacity: dotOpacity,
      weight: 0.5,
    }).addTo(group);
  });

  group.addTo(map);
  dotLayers.set(id, group);
}
