// Main orchestrator module
// Loads data, processes it, renders the heatmap, point map, and factor chart, and handles resize.

import { loadCollisions, loadLocations, loadAnalysis } from './dataLoader.js';
import { buildGrid } from './dataProcessor.js';
import { renderHeatmap } from './heatmapChart.js';
import { renderPointMap } from './pointMap.js';
import { analyzeFactors } from './analysis.js';
import { renderFactorChart } from './factorViz.js';

const CSV_PATH = 'data/sample/collisions_severity_sample_5.csv';
const HEATMAP_CONTAINER_ID = 'chart';
const MAP_CONTAINER_ID = 'map';
const FACTOR_CONTAINER_ID = 'factors';

let model = null;
let points = null;
let factors = null;

async function init() {
  try {
    const [raw, locs, analysisRows] = await Promise.all([
      loadCollisions(CSV_PATH),
      loadLocations(CSV_PATH),
      loadAnalysis(CSV_PATH)
    ]);
    model = buildGrid(raw);
    points = locs;
    factors = analyzeFactors(analysisRows);
    renderHeatmap(HEATMAP_CONTAINER_ID, model);
    renderPointMap(MAP_CONTAINER_ID, points);
    renderFactorChart(FACTOR_CONTAINER_ID, factors);
  } catch (err) {
    console.error(err);
    const heatEl = document.getElementById(HEATMAP_CONTAINER_ID);
    const mapEl = document.getElementById(MAP_CONTAINER_ID);
    const facEl = document.getElementById(FACTOR_CONTAINER_ID);
    if (heatEl) heatEl.innerHTML = '<p>Failed to load or render heatmap.</p>';
    if (mapEl) mapEl.innerHTML = '<p>Failed to load or render map.</p>';
    if (facEl) facEl.innerHTML = '<p>Failed to load or render factors.</p>';
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
  if (factors) {
    renderFactorChart(FACTOR_CONTAINER_ID, factors);
  }
}, 150);

window.addEventListener('resize', onResize);

// Kick off
init();
