// Main orchestrator module
// Loads data, processes it, renders the heatmap and the point map, and handles resize.

import { loadCollisions, loadLocations } from './dataLoader.js';
import { buildGrid } from './dataProcessor.js';
import { renderHeatmap } from './heatmapChart.js';
import { renderPointMap } from './pointMap.js';

const CSV_PATH = 'data/sample/collisions_severity_sample_5.csv';
const HEATMAP_CONTAINER_ID = 'chart';
const MAP_CONTAINER_ID = 'map';

let model = null;
let points = null;

async function init() {
  try {
    const [raw, locs] = await Promise.all([
      loadCollisions(CSV_PATH),
      loadLocations(CSV_PATH)
    ]);
    model = buildGrid(raw);
    points = locs;
    renderHeatmap(HEATMAP_CONTAINER_ID, model);
    renderPointMap(MAP_CONTAINER_ID, points);
  } catch (err) {
    console.error(err);
    const heatEl = document.getElementById(HEATMAP_CONTAINER_ID);
    const mapEl = document.getElementById(MAP_CONTAINER_ID);
    if (heatEl) heatEl.innerHTML = '<p>Failed to load or render heatmap.</p>';
    if (mapEl) mapEl.innerHTML = '<p>Failed to load or render map.</p>';
  }
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}

const onResize = debounce(() => {
  if (model) {
    renderHeatmap(HEATMAP_CONTAINER_ID, model);
  }
  if (points) {
    renderPointMap(MAP_CONTAINER_ID, points);
  }
}, 150);

window.addEventListener('resize', onResize);

// Kick off
init();
