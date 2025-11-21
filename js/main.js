// Main orchestrator module
// Loads data, processes it, renders the heatmap, point map, and factor chart, and handles resize.

import { loadCollisions, loadLocations, loadAnalysis } from './dataLoader.js';
import { buildGrid } from './dataProcessor.js';
import { renderHeatmap } from './heatmapChart.js';
// import { renderPointMap } from './pointMap.js';
import { renderLeafletNYC } from './leafletMap.js';
import { analyzeFactors } from './analysis.js';
import { renderFactorChart } from './factorViz.js';

const CSV_PATH = 'data/original/collisions_severity.csv';

function formatHour(h) {
  if (h == null || !Number.isFinite(h)) return 'All';
  const hh = String(h).padStart(2, '0');
  return `${hh}:00`;
}

function getSelectedHour() {
  const slider = document.getElementById('hour-slider');
  if (!slider) return null;
  const v = +slider.value;
  return Number.isFinite(v) ? v : null;
}

function updateHourLabel() {
  const label = document.getElementById('hour-label');
  const slider = document.getElementById('hour-slider');
  if (!label || !slider) return;
  const hour = getSelectedHour();
  label.textContent = formatHour(hour);
  // keep ARIA attributes in sync
  slider.setAttribute('aria-valuenow', String(hour ?? ''));
}

function filterPointsByHour(arr, hour) {
  if (!arr || !arr.length) return [];
  if (hour == null || !Number.isFinite(hour)) return arr;
  return arr.filter(p => p && Number.isFinite(p.hour) && p.hour === hour);
}

function renderMapForCurrentHour(allPoints) {
  const hour = getSelectedHour();
  const filtered = filterPointsByHour(allPoints || [], hour);
  renderLeafletNYC(LEAFLET_CONTAINER_ID, filtered, { dotColor: '#e60026' });
}
const HEATMAP_CONTAINER_ID = 'chart';
const MAP_CONTAINER_ID = 'map';
const FACTOR_CONTAINER_ID = 'factors';
const LEAFLET_CONTAINER_ID = 'leaflet-map';

let model = null;
let points = null;
let factors = null;
let collisions = null; // raw collision rows with dates and hours
let analysisData = null; // rows for factor analysis and smart estimator
let marginalsCache = null; // cached marginal EB stats for estimator

function renderTimeInsight(rows) {
  try {
    const el = document.getElementById('time-insight');
    if (!el || !rows || !rows.length) return;
    el.style.color = '#ffffff'; // Set text color to white

    // Group by year and month
    const byMonth = new Map(); // key: YYYY-MM -> count
    rows.forEach(r => {
      if (!r || !r.date) return;
      const y = r.date.getFullYear();
      const m = r.date.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2,'0')}`;
      byMonth.set(key, (byMonth.get(key) || 0) + 1);
    });

    // Split into pre-2020 and 2020+
    let preSum = 0, preN = 0, postSum = 0, postN = 0;
    for (const [key, cnt] of byMonth.entries()) {
      const y = +key.slice(0,4);
      if (y < 2020) { preSum += cnt; preN++; }
      else { postSum += cnt; postN++; }
    }

    const preAvg = preN ? preSum / preN : 0;
    const postAvg = postN ? postSum / postN : 0;
    const diffPct = (preAvg && postAvg) ? ((preAvg - postAvg) / preAvg) * 100 : 0;

    // Compose explanation
    const parts = [];
    if (preN && postN) {
      parts.push(`Avg monthly collisions before 2020: ${preAvg.toFixed(1)}; since 2020: ${postAvg.toFixed(1)}.`);
      parts.push(`${diffPct >= 0 ? 'That\'s' : 'That\'s about a'} ${Math.abs(diffPct).toFixed(0)}% ${diffPct >= 0 ? 'lower' : 'higher'} since 2020 in this dataset.`);
    }
    parts.push('Reason: 2020 brought pandemic shutdowns and lasting traffic shifts, so counts dropped after 2020. Also note the heatmap uses a percentile-based color scale within the shown window, so “more red” reflects relatively higher counts, not an absolute unit scale.');

    el.textContent = parts.join(' ');
  } catch (e) {
    // ignore insight errors
  }
}

function buildMarginals(rows) {
  const N = rows.length;
  const injuredTotal = rows.reduce((a, r) => a + (r.injured ? 1 : 0), 0);
  const baseRate = injuredTotal / Math.max(1, N);
  const priorK = 50;
  function ebRate(a, n) {
    return (a + priorK * baseRate) / (n + priorK);
  }
  // factors to index
  const keys = ['preCrash','vehicleType','driverSex','borough','hour','factor1'];
  const maps = {};
  for (const key of keys) {
    const m = new Map();
    rows.forEach(r => {
      let v = r[key];
      if (key === 'hour') v = Number.isFinite(r.hour) ? r.hour : null;
      v = cleanCat(v);
      if (v == null) return;
      let entry = m.get(v);
      if (!entry) { entry = { n: 0, a: 0 }; m.set(v, entry); }
      entry.n += 1;
      if (r.injured) entry.a += 1;
    });
    // compute EB rate and OR vs baseline
    const out = new Map();
    m.forEach((c, v) => {
      const rate = ebRate(c.a, c.n);
      const odds = rate / Math.max(1e-9, 1 - rate);
      const baseOdds = baseRate / Math.max(1e-9, 1 - baseRate);
      const or = odds / Math.max(1e-9, baseOdds);
      out.set(v, { n: c.n, a: c.a, rate, or });
    });
    maps[key] = out;
  }
  return { baseRate, maps };
}

async function init() {
  try {
    const [raw, locs, analysisRows] = await Promise.all([
      loadCollisions(CSV_PATH),
      loadLocations(CSV_PATH),
      loadAnalysis(CSV_PATH)
    ]);
    collisions = raw;
    model = buildGrid(raw);
    points = locs;
    analysisData = analysisRows;
    marginalsCache = buildMarginals(analysisRows);
    factors = analyzeFactors(analysisRows);

    // Setup slider interactions
    const slider = document.getElementById('hour-slider');
    if (slider) {
      slider.addEventListener('input', () => {
        updateHourLabel();
        renderMapForCurrentHour(points);
      });
      updateHourLabel();
    }

    renderHeatmap(HEATMAP_CONTAINER_ID, model);
    renderTimeInsight(collisions);
    // Render Leaflet map filtered to selected hour with red dots
    renderMapForCurrentHour(points);
    renderFactorChart(FACTOR_CONTAINER_ID, factors);

    // Render quick snapshot charts
    try {
      renderQuickCharts(analysisData);
    } catch (e) { /* ignore */ }

    // Initialize smart estimator UI
    initSmartEstimator();
  } catch (err) {
    console.error(err);
    const heatEl = document.getElementById(HEATMAP_CONTAINER_ID);
    const leafletEl = document.getElementById(LEAFLET_CONTAINER_ID);
    const facEl = document.getElementById(FACTOR_CONTAINER_ID);
    if (heatEl) heatEl.innerHTML = '<p>Failed to load or render heatmap.</p>';
    if (leafletEl) leafletEl.innerHTML = '<p>Failed to load or render map.</p>';
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
  // Re-render combined Leaflet map with current hour filter
  renderMapForCurrentHour(points || []);
  if (factors) {
    renderFactorChart(FACTOR_CONTAINER_ID, factors);
  }
  // Re-render quick snapshot charts
  try { if (analysisData) renderQuickCharts(analysisData); } catch (e) { /* ignore */ }
  // Re-render the smart comparison chart, preserving current selection
  try {
    const out = document.getElementById('smart-results');
    if (analysisData && out) {
      const choice = getCurrentChoice();
      const est = estimateRisk(choice, analysisData);
      renderEstimate(out, est, choice); // this will internally call renderSmartChart
    }
  } catch (e) { /* ignore */ }
}, 150);

window.addEventListener('resize', onResize);

// ---- Quick simple visualizations (intro) ----
function renderQuickCharts(rows) {
  try { renderDoWChart('viz-dow', rows); } catch(e) { /* ignore */ }
  try { renderVehicleChart('viz-vehicle', rows); } catch(e) { /* ignore */ }
  try { renderGenderChart('viz-gender', rows); } catch(e) { /* ignore */ }
}

function ebShrink(a, n, baseRate, k = 50) {
  return (a + k * baseRate) / (n + k);
}

function renderDoWChart(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!el) return; el.innerHTML = '';
  const width = el.clientWidth || 320; const height = el.clientHeight || 240;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const margin = { top: 20, right: 24, bottom: 48, left: 48 };
  const innerW = Math.max(160, width - margin.left - margin.right);
  const innerH = Math.max(100, height - margin.top - margin.bottom);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const data = (rows||[]).filter(r=>r && r.dow!=null);
  if (!data.length) { g.append('text').attr('x', innerW/2).attr('y', innerH/2).attr('text-anchor','middle').attr('fill','var(--muted)').text('No data'); return; }
  const N = data.length; const inj = d3.sum(data, r=>r.injured?1:0); const base = inj/Math.max(1,N);
  const by = d3.rollups(data, v=>({ n:v.length, a:d3.sum(v,r=>r.injured?1:0) }), r=>r.dow);
  const order = [0,1,2,3,4,5,6];
  const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const items = order.map(dow=>{
    const rec = by.find(d=>d[0]===dow)?.[1] || {n:0,a:0};
    const rate = ebShrink(rec.a, rec.n, base);
    return { key: dow, label: labels[dow], n: rec.n, a: rec.a, rate };
  });
  items.sort((a,b)=> d3.descending(a.rate,b.rate));

  const x = d3.scaleBand().domain(items.map(d=>d.label)).range([0, innerW]).padding(0.25);
  const y = d3.scaleLinear().domain([0, d3.max(items,d=>d.rate)||0.01]).nice().range([innerH, 0]);

  const bars = g.selectAll('rect').data(items).join('rect')
    .attr('x', d=>x(d.label)).attr('y', d=>y(d.rate)).attr('width', x.bandwidth()).attr('height', d=>innerH - y(d.rate))
    .attr('fill', '#e11d48').attr('opacity', 0.9).attr('rx', 3);

  const xAxis = d3.axisBottom(x);
  const yAxis = d3.axisLeft(y).ticks(4).tickFormat(d3.format('.0%'));
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis);
  g.append('g').call(yAxis);

  // baseline
  const baseY = y(base);
  g.append('line').attr('x1',0).attr('x2',innerW).attr('y1',baseY).attr('y2',baseY).attr('stroke','#94a3b8').attr('stroke-dasharray','4,4');
  g.append('text').attr('x', innerW).attr('y', baseY-6).attr('text-anchor','end').attr('fill','var(--muted)').text('Baseline');

  const tooltip = d3.select('#tooltip'); const fmtPct = d3.format('.1%');
  bars.on('mousemove', (event,d)=>{
    tooltip.style('left', event.pageX+'px').style('top',(event.pageY-8)+'px').style('opacity',1)
      .html(`<strong>${d.label}</strong><br>EB rate: ${fmtPct(d.rate)}<br>n = ${d.n.toLocaleString()}`);
  }).on('mouseout', ()=> tooltip.style('opacity',0));
}

function renderVehicleChart(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!el) return; el.innerHTML = '';
  const width = el.clientWidth || 320; const height = el.clientHeight || 240;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const margin = { top: 20, right: 24, bottom: 72, left: 140 };
  const innerW = Math.max(160, width - margin.left - margin.right);
  const innerH = Math.max(100, height - margin.top - margin.bottom);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const data = (rows||[]).filter(r=>r);
  if (!data.length) { g.append('text').attr('x', innerW/2).attr('y', innerH/2).attr('text-anchor','middle').attr('fill','var(--muted)').text('No data'); return; }
  const N = data.length; const inj = d3.sum(data, r=>r.injured?1:0); const base = inj/Math.max(1,N);
  // Build groups and keep top 8 by n
  // Group by normalized vehicle label so variants aggregate (e.g., station wagon / sport utility -> 'SUV')
  const map = d3.rollups(data, v=>({ n:v.length, a:d3.sum(v,r=>r.injured?1:0) }), r=>normalizeVehicleLabel(cleanCat(r.vehicleType))||'Other');
  let items = map.map(([label, c])=> ({ label, n:c.n, a:c.a, rate: ebShrink(c.a, c.n, base) }));
  // Exclude certain noisy/undesired vehicle type categories (compare lower-case normalized labels)
  const vehExclude = new Set(['4 dr sedan', 'taxi', 'tractor truck diesel']);
  items = items.filter(d => !vehExclude.has(String(d.label).toLowerCase()));
  items.sort((a,b)=> d3.descending(a.n,b.n));
  const top = items.slice(0, 8);
  top.sort((a,b)=> d3.descending(a.rate,b.rate));

  const y = d3.scaleBand().domain(top.map(d=>d.label)).range([0, innerH]).padding(0.25);
  const x = d3.scaleLinear().domain([0, d3.max(top,d=>d.rate)||0.01]).nice().range([0, innerW]);

  const bars = g.selectAll('rect').data(top).join('rect')
    .attr('y', d=>y(d.label)).attr('x', 0).attr('height', y.bandwidth()).attr('width', d=>x(d.rate))
    .attr('fill', '#e11d48').attr('opacity', 0.9).attr('rx', 3);

  const xAxis = d3.axisBottom(x).ticks(4).tickFormat(d3.format('.0%'));
  const yAxis = d3.axisLeft(y).tickSizeOuter(0);
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis);
  g.append('g').call(yAxis);

  const baseX = x(base);
  g.append('line').attr('x1', baseX).attr('x2', baseX).attr('y1',0).attr('y2',innerH).attr('stroke','#94a3b8').attr('stroke-dasharray','4,4');
  g.append('text').attr('x', baseX+4).attr('y', 12).attr('fill','var(--muted)').text('Baseline');

  const tooltip = d3.select('#tooltip'); const fmtPct = d3.format('.1%');
  bars.on('mousemove', (event,d)=>{
    tooltip.style('left', event.pageX+'px').style('top',(event.pageY-8)+'px').style('opacity',1)
      .html(`<strong>${d.label}</strong><br>EB rate: ${fmtPct(d.rate)}<br>n = ${d.n.toLocaleString()}`);
  }).on('mouseout', ()=> tooltip.style('opacity',0));
}

function renderGenderChart(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!el) return; el.innerHTML = '';
  const width = el.clientWidth || 320; const height = el.clientHeight || 240;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const margin = { top: 20, right: 24, bottom: 48, left: 120 };
  const innerW = Math.max(160, width - margin.left - margin.right);
  const innerH = Math.max(100, height - margin.top - margin.bottom);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const data = (rows||[]).filter(r=>r);
  if (!data.length) { g.append('text').attr('x', innerW/2).attr('y', innerH/2).attr('text-anchor','middle').attr('fill','var(--muted)').text('No data'); return; }
  const N = data.length; const inj = d3.sum(data, r=>r.injured?1:0); const base = inj/Math.max(1,N);
  const map = d3.rollups(data, v=>({ n:v.length, a:d3.sum(v,r=>r.injured?1:0) }), r=>{
    const s = cleanCat(r.driverSex);
    // Treat missing/unspecified driver sex as part of the broader 'Other/Unknown'
    if (s === null) return 'Other/Unknown';
    if (/^m/i.test(s)) return 'Male';
    if (/^f/i.test(s)) return 'Female';
    return 'Other/Unknown';
  });
  const items = map.map(([label, c])=> ({ label, n:c.n, a:c.a, rate: ebShrink(c.a, c.n, base) }));
  // Order Male, Female, Other/Unknown if present
  const desired = ['Male','Female','Other/Unknown','Unknown'];
  items.sort((a,b)=> desired.indexOf(a.label) - desired.indexOf(b.label));

  const x = d3.scaleBand().domain(items.map(d=>d.label)).range([0, innerW]).padding(0.35);
  const y = d3.scaleLinear().domain([0, d3.max(items,d=>d.rate)||0.01]).nice().range([innerH, 0]);

  const color = d => (d.label==='Male' ? '#ef4444' : d.label==='Female' ? '#10b981' : '#94a3b8');

  const bars = g.selectAll('rect').data(items).join('rect')
    .attr('x', d=>x(d.label)).attr('y', d=>y(d.rate)).attr('width', x.bandwidth()).attr('height', d=>innerH - y(d.rate))
    .attr('fill', d=>color(d)).attr('opacity', 0.9).attr('rx', 3);

  const xAxis = d3.axisBottom(x);
  const yAxis = d3.axisLeft(y).ticks(4).tickFormat(d3.format('.0%'));
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis);
  g.append('g').call(yAxis);

  const baseY = y(base);
  g.append('line').attr('x1',0).attr('x2',innerW).attr('y1',baseY).attr('y2',baseY).attr('stroke','#94a3b8').attr('stroke-dasharray','4,4');
  g.append('text').attr('x', innerW).attr('y', baseY-6).attr('text-anchor','end').attr('fill','var(--muted)').text('Baseline');

  const tooltip = d3.select('#tooltip'); const fmtPct = d3.format('.1%');
  bars.on('mousemove', (event,d)=>{
    tooltip.style('left', event.pageX+'px').style('top',(event.pageY-8)+'px').style('opacity',1)
      .html(`<strong>${d.label}</strong><br>EB rate: ${fmtPct(d.rate)}<br>n = ${d.n.toLocaleString()}`);
  }).on('mouseout', ()=> tooltip.style('opacity',0));
}

// Smart estimator (Chapter 3)
function initSmartEstimator() {
  try {
    if (!analysisData || !analysisData.length) return;
    const actionSel = document.getElementById('sf-action');
    const vehSel = document.getElementById('sf-vehicle');
    const genSel = document.getElementById('sf-gender');
    const borSel = document.getElementById('sf-borough');
    const hourSel = document.getElementById('sf-hour');
    const fac1Sel = document.getElementById('sf-factor1');
    const out = document.getElementById('smart-results');
    if (!actionSel || !vehSel || !genSel || !out) return;

    // Populate options from data (sorted by frequency)
    populateSelect(actionSel, distinctByFreq(analysisData.map(r => cleanCat(r.preCrash))));
    // Exclude a few noisy vehicle-type categories from the dropdown and normalize labels
    const vehExclude = new Set(['4 dr sedan', 'taxi', 'tractor truck diesel']);
    const vehList = distinctByFreq(analysisData.map(r => normalizeVehicleLabel(cleanCat(r.vehicleType)))).filter(v => v && !vehExclude.has(v.toLowerCase()));
    populateSelect(vehSel, vehList);
    populateSelect(genSel, distinctByFreq(analysisData.map(r => cleanCat(r.driverSex))));
    if (borSel) populateSelect(borSel, distinctByFreq(analysisData.map(r => cleanCat(r.borough))));
    if (fac1Sel) populateSelect(fac1Sel, distinctByFreq(analysisData.map(r => cleanCat(r.factor1))));
    if (hourSel) populateHourSelect(hourSel, analysisData);

    const onChange = () => {
      const choice = {
        preCrash: valueOrNull(actionSel.value),
        vehicleType: valueOrNull(vehSel.value),
        driverSex: valueOrNull(genSel.value),
        borough: borSel ? valueOrNull(borSel.value) : null,
        hour: hourSel ? parseHourSelect(hourSel.value) : null,
        factor1: fac1Sel ? valueOrNull(fac1Sel.value) : null,
      };
      const est = estimateRisk(choice, analysisData);
      renderEstimate(out, est, choice);
    };

    actionSel.addEventListener('change', onChange);
    vehSel.addEventListener('change', onChange);
    genSel.addEventListener('change', onChange);
    if (borSel) borSel.addEventListener('change', onChange);
    if (hourSel) hourSel.addEventListener('change', onChange);
    if (fac1Sel) fac1Sel.addEventListener('change', onChange);

    // Initial
    onChange();
  } catch (e) {
    // ignore
  }
}

function cleanCat(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t || t === 'Unspecified' || t === 'NA' || t === 'Unknown') return null;
  return t;
}

// Normalize vehicle-type labels for display and grouping
function normalizeVehicleLabel(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  const l = t.toLowerCase();
  // Map station wagon / sport utility variants to a concise 'SUV' label
  if (l.includes('station wagon') || l.includes('sport utility') || l.includes('sport-utility') || l.includes('sport') && l.includes('utility') || l.includes('suv')) return 'SUV';
  return t;
}

function valueOrNull(v) {
  return v && v !== '' ? v : null;
}

function distinctByFreq(arr) {
  const counts = new Map();
  for (const v of arr) {
    if (v == null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
    .map(d => d[0])
    .slice(0, 50); // cap options
}

function populateSelect(sel, values) {
  if (!sel) return;
  // keep first option (Any)
  while (sel.options.length > 1) sel.remove(1);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

function populateHourSelect(sel, rows) {
  if (!sel) return;
  const hours = new Set();
  (rows || []).forEach(r => { if (Number.isFinite(r.hour)) hours.add(r.hour); });
  const list = Array.from(hours).sort((a,b)=>a-b);
  while (sel.options.length > 1) sel.remove(1);
  list.forEach(h => {
    const opt = document.createElement('option');
    opt.value = String(h);
    opt.textContent = formatHour(h);
    sel.appendChild(opt);
  });
}

function parseHourSelect(v) {
  if (v == null || v === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

function estimateRisk(choice, rows) {
  const N = rows.length;
  const injuredTotal = rows.reduce((a, r) => a + (r.injured ? 1 : 0), 0);
  const baseRate = injuredTotal / Math.max(1, N);

  // Filter rows by chosen attributes (exact match on all selected fields)
  const matches = rows.filter(r =>
    (choice.preCrash ? cleanCat(r.preCrash) === choice.preCrash : true) &&
    (choice.vehicleType ? cleanCat(r.vehicleType) === choice.vehicleType : true) &&
    (choice.driverSex ? cleanCat(r.driverSex) === choice.driverSex : true) &&
    (choice.borough ? cleanCat(r.borough) === choice.borough : true) &&
    (Number.isFinite(choice.hour) ? (Number.isFinite(r.hour) && r.hour === choice.hour) : true) &&
    (choice.factor1 ? cleanCat(r.factor1) === choice.factor1 : true)
  );

  const n = matches.length;
  const inj = matches.reduce((a, r) => a + (r.injured ? 1 : 0), 0);

  // Empirical Bayes shrinkage toward global mean for the exact-match group
  const k = 50; // prior strength (pseudo-counts)
  const prior = baseRate;
  const exactRate = (inj + k * prior) / (n + k);

  // Compute a backoff estimate from marginal EB odds ratios when exact n is small or zero
  let backoffRate = baseRate;
  let usedComponents = [];
  if (marginalsCache) {
    const baseOdds = baseRate / Math.max(1e-9, 1 - baseRate);
    let orProduct = 1;
    const caps = { min: 0.25, max: 4.0 }; // cap per-factor OR to avoid extremes

    const apply = (key, val) => {
      if (val == null) return;
      const v = key === 'hour' ? val : cleanCat(val);
      if (v == null) return;
      const m = marginalsCache.maps[key];
      if (!m) return;
      const rec = m.get(v);
      if (!rec) return;
      const orCapped = Math.max(caps.min, Math.min(caps.max, rec.or));
      orProduct *= orCapped;
      usedComponents.push({ key, value: v, or: rec.or, n: rec.n });
    };

    apply('preCrash', choice.preCrash);
    apply('vehicleType', choice.vehicleType);
    apply('driverSex', choice.driverSex);
    apply('borough', choice.borough);
    if (Number.isFinite(choice.hour)) apply('hour', choice.hour);
    apply('factor1', choice.factor1);

    const combinedOdds = baseOdds * orProduct;
    backoffRate = combinedOdds / (1 + combinedOdds);
  }

  // Blend exact and backoff based on sample size
  const minExact = 30;
  let rate, method, nEff;
  if (n >= minExact) {
    rate = exactRate;
    method = 'exact';
    nEff = n;
  } else if (n > 0 && isFinite(backoffRate)) {
    const kBlend = 50; // how strongly to pull toward backoff when n is small
    const w = n / (n + kBlend);
    rate = w * exactRate + (1 - w) * backoffRate;
    method = 'blend';
    nEff = Math.round(n + (1 - w) * kBlend);
  } else {
    rate = isFinite(backoffRate) ? backoffRate : baseRate;
    method = 'backoff';
    nEff = usedComponents.reduce((s, c) => s + (c.n || 0), 0) || 0;
  }

  // Relative risk vs baseline (use baseline for comparison to keep definition consistent)
  const rr = baseRate > 0 ? rate / baseRate : 1;

  return { n, inj, rate, baseRate, rr, method, components: usedComponents, exactRate, backoffRate, nEff };
}

function renderSmartChart(containerId, est) {
  const id = containerId.replace('#','');
  const container = document.getElementById(id) || document.querySelector(containerId);
  if (!container) return;
  container.innerHTML = '';
  const width = container.clientWidth || 320;
  const height = container.clientHeight || 140;
  const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
  const margin = { top: 20, right: 24, bottom: 28, left: 120 };
  const innerW = Math.max(160, width - margin.left - margin.right);
  const innerH = Math.max(60, height - margin.top - margin.bottom);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  if (!est || !isFinite(est.rate) || !isFinite(est.baseRate)) {
    g.append('text').attr('x', innerW/2).attr('y', innerH/2).attr('text-anchor','middle').attr('fill','var(--muted)').text('No estimate yet');
    return;
  }

  const data = [
    { label: 'Baseline', value: Math.max(0, est.baseRate), color: '#94a3b8' },
    { label: 'Your estimate', value: Math.max(0, est.rate), color: est.rr >= 1 ? '#e11d48' : '#059669', rr: est.rr }
  ];

  const maxVal = Math.max(0.001, d3.max(data, d => d.value) || 0.001);
  const x = d3.scaleLinear().domain([0, maxVal * 1.1]).range([0, innerW]);
  const y = d3.scaleBand().domain(data.map(d => d.label)).range([0, innerH]).padding(0.35);
  const fmtPct = d3.format('.1%');
  const fmt2 = d3.format('.2f');

  g.append('g').selectAll('rect').data(data).join('rect')
    .attr('x', 0)
    .attr('y', d => y(d.label))
    .attr('width', d => x(d.value))
    .attr('height', y.bandwidth())
    .attr('fill', d => d.color)
    .attr('rx', 3).attr('ry', 3)
    .attr('opacity', 0.9);

  // Labels on left
  g.append('g').selectAll('text.lbl').data(data).join('text')
    .attr('class','lbl')
    .attr('x', -8)
    .attr('y', d => y(d.label) + y.bandwidth()/2)
    .attr('dy', '0.32em')
    .attr('text-anchor','end')
    .attr('fill', '#ffffff')
    .text(d => d.label);

  // Values on bars
  g.append('g').selectAll('text.val').data(data).join('text')
    .attr('class','val')
    .attr('x', d => x(d.value) + 6)
    .attr('y', d => y(d.label) + y.bandwidth()/2)
    .attr('dy', '0.32em')
    .attr('fill', '#ffffff')
    .text(d => fmtPct(d.value));

  // RR annotation
  const rrText = `Relative risk: ${fmt2(est.rr)}× (vs baseline)`;
  svg.append('text')
    .attr('x', margin.left + innerW / 2)
    .attr('y', margin.top + innerH + 22)
    .attr('text-anchor','middle')
    .attr('fill', est.rr >= 1 ? '#b91c1c' : '#065f46')
    .text(rrText);
}

function getCurrentChoice() {
  const actionSel = document.getElementById('sf-action');
  const vehSel = document.getElementById('sf-vehicle');
  const genSel = document.getElementById('sf-gender');
  const borSel = document.getElementById('sf-borough');
  const hourSel = document.getElementById('sf-hour');
  const fac1Sel = document.getElementById('sf-factor1');
  return {
    preCrash: actionSel ? valueOrNull(actionSel.value) : null,
    vehicleType: vehSel ? valueOrNull(vehSel.value) : null,
    driverSex: genSel ? valueOrNull(genSel.value) : null,
    borough: borSel ? valueOrNull(borSel.value) : null,
    hour: hourSel ? parseHourSelect(hourSel.value) : null,
    factor1: fac1Sel ? valueOrNull(fac1Sel.value) : null,
  };
}

function renderEstimate(out, est, choice) {
  if (!out || !est) return;
  const fmtPct = d3.format('.1%');
  const parts = [];
  const picks = [
    choice.preCrash && `action: ${choice.preCrash}`,
    choice.vehicleType && `vehicle: ${choice.vehicleType}`,
    choice.driverSex && `gender: ${choice.driverSex}`,
    choice.borough && `borough: ${choice.borough}`,
    (Number.isFinite(choice.hour)) && `hour: ${formatHour(choice.hour)}`,
    choice.factor1 && `factor: ${choice.factor1}`
  ].filter(Boolean);
  const pickStr = picks.length ? picks.join(', ') : 'any action, any vehicle, any gender, any borough, any hour, any factor';

  // Method note
  let methodNote = '';
  if (est.method === 'exact') methodNote = 'exact-match estimate';
  else if (est.method === 'blend') methodNote = 'blend of exact-match and backoff estimate';
  else if (est.method === 'backoff') methodNote = 'backoff estimate from marginal patterns';

  parts.push(`For ${pickStr}, the estimated injury likelihood is ${fmtPct(est.rate)} (${methodNote}).`);
  parts.push(`Baseline across the dataset is ${fmtPct(est.baseRate)}; your relative risk is ${est.rr.toFixed(2)}× baseline.`);
  if (est.method !== 'exact') {
    const nDisp = (est.n || 0).toLocaleString();
    const nEff = (est.nEff || 0).toLocaleString();
    parts.push(`Matched records: ${nDisp}. Effective sample used: ${nEff}. Estimates are stabilized with empirical‑Bayes shrinkage.`);
  }
  out.classList.remove('alert-danger','alert-success','alert-info');
  out.classList.add('alert-info');
  out.textContent = parts.join(' ');

  // Render comparison chart
  renderSmartChart('smart-chart', est);
}

// Kick off
init();
