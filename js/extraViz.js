// Extra visualizations module
// Exports:
//  - renderEventSankey(containerId, rows)
//  - renderCalendarMultiples(containerId, collisions)
//  - renderRiskGrid(containerId, locations)

// Utility: safe text color
function textColor() { return getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#e5edff'; }
function mutedColor() { return getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#94a3b8'; }

// 1) Simple 3-stage flow (Sankey-like) without external deps
export function renderEventSankey(containerId, rows) {
  const el = document.getElementById(containerId.replace('#','')) || document.querySelector(containerId);
  if (!el) return;
  el.innerHTML = '';
  const width = el.clientWidth || 320;
  const height = el.clientHeight || 300;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const margin = { top: 18, right: 10, bottom: 28, left: 10 };
  const innerW = Math.max(200, width - margin.left - margin.right);
  const innerH = Math.max(160, height - margin.top - margin.bottom);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  if (!rows || !rows.length) {
    g.append('text').attr('x', innerW/2).attr('y', innerH/2).attr('text-anchor','middle').attr('fill', mutedColor()).text('No data');
    return;
  }

  // Build stages and links: stage0=preCrash, stage1=factor1, stage2=injured Yes/No
  const clean = s => { if (s==null) return null; const t=String(s).trim(); if (!t || t==='Unspecified' || t==='Unknown' || t==='NA') return null; return t; };
  const stage0Vals = new Map();
  const stage1Vals = new Map();
  const stage2Vals = new Map();
  const links = new Map(); // key "a\t b\t c" -> count

  rows.forEach(r => {
    const a = clean(r.preCrash) || 'Other';
    const b = clean(r.factor1) || 'Other';
    const c = r.injured ? 'Injured' : 'Not injured';
    stage0Vals.set(a, (stage0Vals.get(a)||0)+1);
    stage1Vals.set(b, (stage1Vals.get(b)||0)+1);
    stage2Vals.set(c, (stage2Vals.get(c)||0)+1);
    const key = `${a}\t${b}\t${c}`;
    links.set(key, (links.get(key)||0)+1);
  });

  // Keep top categories to avoid clutter
  function topN(map, n) { return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,n).map(d=>d[0]); }
  const leftCats = topN(stage0Vals, 6);
  const midCats = topN(stage1Vals, 8);
  const rightCats = Array.from(stage2Vals.keys()); // only two

  // Aggregate links but only among kept categories, others collapse to 'Other'
  const LEFT_X = 0, MID_X = innerW*0.5, RIGHT_X = innerW;
  const colYs = (cats) => {
    const total = cats.length;
    const pad = 8;
    const block = (innerH - pad*(total-1)) / total;
    const res = new Map();
    cats.forEach((c,i)=>{ res.set(c, { y0: i*(block+pad), y1: i*(block+pad)+block, h: block }); });
    return res;
  };

  const leftMap = colYs(leftCats);
  const midMap = colYs(midCats);
  const rightMap = colYs(rightCats);

  // Compute node totals restricted to shown links
  const nodeTotals = { left: new Map(), mid: new Map(), right: new Map() };

  function add(map, k, v) { map.set(k, (map.get(k)||0)+v); }

  const linkArr = [];
  links.forEach((cnt, key) => {
    let [a,b,c] = key.split('\t');
    if (!leftCats.includes(a)) a = 'Other';
    if (!midCats.includes(b)) b = 'Other';
    if (!rightCats.includes(c)) c = rightCats.includes(c) ? c : 'Not injured';
    if (!leftMap.has(a)) { leftMap.set(a, { y0: innerH-20, y1: innerH, h: 20 }); }
    if (!midMap.has(b)) { midMap.set(b, { y0: innerH-20, y1: innerH, h: 20 }); }
    if (!rightMap.has(c)) { rightMap.set(c, { y0: innerH-20, y1: innerH, h: 20 }); }
    linkArr.push({ a, b, c, count: cnt });
    add(nodeTotals.left, a, cnt);
    add(nodeTotals.mid, b, cnt);
    add(nodeTotals.right, c, cnt);
  });

  const total = d3.sum(linkArr, d=>d.count) || 1;
  const pxPer = innerH / total * 0.9; // scale thickness

  // Sort within bands for smoother stacking
  linkArr.sort((x,y)=> d3.ascending(x.a,y.a) || d3.ascending(x.b,y.b) || d3.ascending(x.c,y.c));

  // Prepare running offsets per (column, category)
  const run = { left: new Map(), mid: new Map(), right: new Map() };
  function take(map, key, h) {
    const cur = map.get(key)||0; map.set(key, cur + h); return cur;
  }

  const color = d => d.c === 'Injured' ? '#e11d48' : '#14b8a6';
  const opacity = 0.85;
  const curve = d3.line().curve(d3.curveBasis);

  // Draw links as single smooth paths with stroke-width proportional to count (decluttered)
  const tooltip = d3.select('#tooltip');
  linkArr.forEach(link => {
    const h = Math.max(1, pxPer * link.count);

    const l = leftMap.get(link.a); const m = midMap.get(link.b); const r = rightMap.get(link.c);
    const y0 = l.y0 + take(run.left, link.a, h) + h/2;
    const y1 = m.y0 + take(run.mid, link.b, h) + h/2;
    const y2 = r.y0 + take(run.right, link.c, h) + h/2;

    const col = color(link);
    const path1 = [
      [LEFT_X, y0],
      [LEFT_X + (MID_X-LEFT_X)*0.4, y0],
      [MID_X - (MID_X-LEFT_X)*0.12, y1],
      [MID_X, y1],
    ];
    const p1 = g.append('path')
      .attr('d', curve(path1))
      .attr('fill','none')
      .attr('stroke', col)
      .attr('stroke-width', h)
      .attr('stroke-linecap','round')
      .attr('stroke-opacity', opacity)
      .style('cursor','pointer');

    const path2 = [
      [MID_X, y1],
      [MID_X + (RIGHT_X-MID_X)*0.12, y1],
      [RIGHT_X - (RIGHT_X-MID_X)*0.4, y2],
      [RIGHT_X, y2]
    ];
    const p2 = g.append('path')
      .attr('d', curve(path2))
      .attr('fill','none')
      .attr('stroke', col)
      .attr('stroke-width', h)
      .attr('stroke-linecap','round')
      .attr('stroke-opacity', opacity)
      .style('cursor','pointer');

    // Hover interactions for both segments
    const fmt = d3.format(',');
    function onMove(event) {
      tooltip
        .style('left', (event.pageX) + 'px')
        .style('top', (event.pageY - 10) + 'px')
        .style('opacity', 1)
        .html(`<strong>${link.a}</strong> → <strong>${link.b}</strong> → <strong>${link.c}</strong><br>Count: ${fmt(link.count)}`);
    }
    function onOut() { tooltip.style('opacity', 0); }
    function onOver() {
      p1.attr('stroke-opacity', 1).raise();
      p2.attr('stroke-opacity', 1).raise();
    }
    function onLeave() {
      p1.attr('stroke-opacity', opacity);
      p2.attr('stroke-opacity', opacity);
    }
    [p1, p2].forEach(p => p
      .on('mousemove', onMove)
      .on('mouseover', onOver)
      .on('mouseout', () => { onOut(); onLeave(); })
    );
  });

  // Node labels
  function drawLabels(map, cats, x, side) {
    const fmt = d3.format(',.0f');
    cats.forEach(c => {
      const box = map.get(c); if (!box) return;
      const n = (nodeTotals[side].get(c) || 0);
      const y = box.y0 + box.h/2;
      const anchor = side==='left' ? 'start' : (side==='right' ? 'end' : 'middle');
      const dx = side==='left' ? 6 : (side==='right' ? -6 : 0);
      g.append('text')
        .attr('x', x + dx)
        .attr('y', y)
        .attr('dy', '0.32em')
        .attr('text-anchor', anchor)
        .attr('fill', textColor())
        .text(`${c} (${fmt(n)})`);
    });
  }

  drawLabels(leftMap, leftCats.concat(leftMap.has('Other')?['Other']:[]), LEFT_X, 'left');
  drawLabels(midMap, midCats.concat(midMap.has('Other')?['Other']:[]), MID_X, 'mid');
  drawLabels(rightMap, rightCats, RIGHT_X, 'right');

  // Legend
  const legendHost = document.getElementById('sankey-legend');
  if (legendHost) {
    legendHost.innerHTML = '';
    const lsvg = d3.select(legendHost).append('svg').attr('width', 240).attr('height', 28);
    const items = [ {lbl:'Injured', color:'#e11d48'}, {lbl:'Not injured', color:'#14b8a6'} ];
    items.forEach((it,i)=>{
      const x0 = 20 + i*110;
      lsvg.append('rect').attr('x', x0).attr('y', 8).attr('width', 16).attr('height', 8).attr('fill', it.color);
      lsvg.append('text').attr('x', x0+22).attr('y', 15).attr('dy','0.32em').attr('fill', textColor()).text(it.lbl);
    });
  }
}

// 2) Calendar small multiples for latest full year
export function renderCalendarMultiples(containerId, rows) {
  const el = document.getElementById(containerId.replace('#','')) || document.querySelector(containerId);
  if (!el) return; el.innerHTML = '';
  if (!rows || !rows.length) { el.textContent='No data'; return; }

  // Find latest year present
  const years = d3.rollup(rows, v=>v.length, r=>r.date.getFullYear());
  const latest = d3.max(Array.from(years.keys()));
  const rowsYear = rows.filter(r => r.date.getFullYear() === latest);

  // Aggregate counts per day
  const byDay = d3.rollup(rowsYear, v=>v.length, r=>d3.timeDay.floor(r.date).getTime());

  const width = el.clientWidth || 320; const height = el.clientHeight || 320;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const margin = { top: 24, right: 16, bottom: 28, left: 16 };
  const innerW = Math.max(260, width - margin.left - margin.right);
  const innerH = Math.max(220, height - margin.top - margin.bottom);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Layout: 3 columns x 4 rows of months
  const cols = 3, rowsGrid = 4;
  const cellW = innerW / cols; const cellH = innerH / rowsGrid;

  // Color scale over all days of the selected year
  const values = Array.from(byDay.values());
  const allZero = values.length===0 || values.every(v=>v===0);
  const greenToRed = t => d3.interpolateRdYlGn(1 - t);
  const color = allZero ? d3.scaleSequential().domain([0,1]).interpolator(greenToRed)
                        : d3.scaleSequentialQuantile(values, greenToRed);
  const fmt = d3.format('~s');

  const months = d3.range(0,12).map(m => new Date(latest, m, 1));
  const tooltip = d3.select('#tooltip');
  const fmtDate = d3.timeFormat('%b %d, %Y');

  months.forEach((mDate, i) => {
    const cx = i % cols; const cy = Math.floor(i / cols);
    const x0 = cx * cellW; const y0 = cy * cellH;

    // month title
    g.append('text').attr('x', x0 + 4).attr('y', y0 + 12).attr('fill', textColor()).text(d3.timeFormat('%b')(mDate));

    // Calendar grid: weeks as columns
    const monthEnd = d3.timeMonth.offset(mDate, 1);
    const firstDay = d3.timeWeek.floor(mDate);
    const weeks = d3.timeWeeks(firstDay, monthEnd).length + 1;
    const daySize = Math.min((cellW - 40)/weeks, (cellH - 24)/7);
    const gx = x0 + 24; const gy = y0 + 18;

    for (let d = new Date(firstDay); d < monthEnd; d = d3.timeDay.offset(d,1)) {
      const wk = d3.timeWeek.count(firstDay, d);
      const wd = d.getDay();
      const inMonth = d.getMonth() === mDate.getMonth();
      const key = d3.timeDay.floor(d).getTime();
      const v = byDay.get(key) || 0;
      g.append('rect')
        .attr('x', gx + wk * daySize)
        .attr('y', gy + wd * daySize)
        .attr('width', daySize - 1)
        .attr('height', daySize - 1)
        .attr('rx', 2).attr('ry', 2)
        .attr('fill', inMonth ? color(v) : 'rgba(148,163,184,0.15)')
        .attr('stroke', 'rgba(148,163,184,0.25)')
        .style('cursor', inMonth ? 'pointer' : 'default')
        .on('mousemove', (event)=>{
          if (!inMonth) return;
          tooltip.style('left', event.pageX+'px').style('top', (event.pageY-8)+'px').style('opacity', 1)
            .html(`<strong>${fmtDate(d)}</strong><br>Crashes: ${v}`);
        })
        .on('mouseout', ()=> tooltip.style('opacity', 0));
    }
  });

  // Legend in external container
  const host = document.getElementById('calendars-legend');
  if (host) {
    host.innerHTML = '';
    const hostW = Math.max(200, Math.min(host.clientWidth||260, 420));
    const hostH = 36; const padX = 10; const barW = hostW - padX*2;
    const lsvg = d3.select(host).append('svg').attr('width', hostW).attr('height', hostH);
    const grad = lsvg.append('defs').append('linearGradient').attr('id','cal-lg').attr('x1','0%').attr('x2','100%');
    const steps = 10; const sorted = values.slice().sort(d3.ascending);
    for (let i=0;i<=steps;i++) {
      const t = i/steps; const q = sorted.length? d3.quantileSorted(sorted, t): t;
      grad.append('stop').attr('offset', `${t*100}%`).attr('stop-color', color(q||0));
    }
    lsvg.append('rect').attr('x', padX).attr('y', 4).attr('width', barW).attr('height', 10).attr('fill','url(#cal-lg)').attr('stroke','#334155');
    const scale = d3.scaleLinear().domain([0,1]).range([padX, padX+barW]);
    const axis = d3.axisBottom(scale).ticks(4).tickSize(4).tickFormat(p=> fmt(d3.quantileSorted(sorted, p)||0));
    lsvg.append('g').attr('transform', `translate(0, ${4+10})`).call(axis);
    lsvg.append('text').attr('x', hostW/2).attr('y', 32).attr('text-anchor','middle').text('Daily crashes (latest year)');
  }
}

// 3) Risk terrain: grid density over Mercator-fit of points
export function renderRiskGrid(containerId, locations) {
  const el = document.getElementById(containerId.replace('#','')) || document.querySelector(containerId);
  if (!el) return; el.innerHTML = '';
  const width = el.clientWidth || 320; const height = el.clientHeight || 320;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const margin = { top: 18, right: 10, bottom: 28, left: 10 };
  const innerW = Math.max(200, width - margin.left - margin.right);
  const innerH = Math.max(200, height - margin.top - margin.bottom);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const pts = (locations||[]).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  if (!pts.length) { g.append('text').attr('x', innerW/2).attr('y', innerH/2).attr('text-anchor','middle').attr('fill', mutedColor()).text('No locations'); return; }

  // Fit Mercator projection to points
  const projection = d3.geoMercator();
  const padding = 6;
  try {
    projection.fitExtent([[padding, padding],[innerW-padding, innerH-padding]], {
      type:'FeatureCollection', features: pts.map(p=>({type:'Feature', geometry:{type:'Point', coordinates:[p.lon,p.lat]}}))
    });
  } catch(e) { projection.scale(100000).translate([innerW/2, innerH/2]); }

  const project = p => projection([p.lon, p.lat]);

  // Grid size proportional to viewport (higher res is slower)
  const cols = Math.max(40, Math.floor(innerW/10));
  const rows = Math.max(30, Math.floor(innerH/10));
  const binW = innerW / cols; const binH = innerH / rows;
  const grid = new Array(rows); for (let r=0;r<rows;r++){ grid[r]=new Array(cols).fill(0); }

  pts.forEach(p => { const xy = project(p); const x = xy[0], y = xy[1]; if (x<0||x>=innerW||y<0||y>=innerH) return; const ci = Math.floor(x/binW); const ri = Math.floor(y/binH); grid[ri][ci] += 1; });

  // Percentile color normalization over non-zero bins
  const values = [];
  for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ const v=grid[r][c]; if (v>0) values.push(v); }}
  const greenToRed = t => d3.interpolateRdYlGn(1 - t);
  const color = (values.length ? d3.scaleSequentialQuantile(values, greenToRed) : d3.scaleSequential().domain([0,1]).interpolator(greenToRed));

  // Draw rects
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const v = grid[r][c];
      if (v<=0) continue;
      g.append('rect')
        .attr('x', c*binW)
        .attr('y', r*binH)
        .attr('width', binW+0.5)
        .attr('height', binH+0.5)
        .attr('fill', color(v))
        .attr('opacity', 0.9);
    }
  }

  // Legend
  const host = document.getElementById('risk-legend');
  if (host) {
    host.innerHTML = '';
    const hostW = Math.max(200, Math.min(host.clientWidth||260, 420));
    const hostH = 36; const padX = 10; const barW = hostW - padX*2;
    const lsvg = d3.select(host).append('svg').attr('width', hostW).attr('height', hostH);
    const grad = lsvg.append('defs').append('linearGradient').attr('id','risk-lg').attr('x1','0%').attr('x2','100%');
    const steps = 10; const sorted = values.slice().sort(d3.ascending);
    for (let i=0;i<=steps;i++) { const t=i/steps; const q = sorted.length? d3.quantileSorted(sorted, t): t; grad.append('stop').attr('offset', `${t*100}%`).attr('stop-color', color(q||0)); }
    lsvg.append('rect').attr('x', padX).attr('y', 4).attr('width', barW).attr('height', 10).attr('fill','url(#risk-lg)').attr('stroke','#334155');
    const scale = d3.scaleLinear().domain([0,1]).range([padX, padX+barW]);
    const axis = d3.axisBottom(scale).ticks(4).tickSize(4).tickFormat(p=> d3.format('~s')(d3.quantileSorted(sorted, p)||0));
    lsvg.append('g').attr('transform', `translate(0, ${4+10})`).call(axis);
    lsvg.append('text').attr('x', hostW/2).attr('y', 32).attr('text-anchor','middle').text('Density (percentile normalized)');
  }
}
