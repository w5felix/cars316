// Point map rendering module
// Exports: renderPointMap(containerId, points)
// points: array of { lat, lon }

export function renderPointMap(containerId, points) {
  const container = document.getElementById(containerId.replace('#','')) || document.querySelector(containerId);
  if (!container) throw new Error(`Container ${containerId} not found`);

  // Clear container
  container.innerHTML = '';

  const width = container.clientWidth;
  const height = container.clientHeight;

  const margin = { top: 16, right: 16, bottom: 48, left: 16 };
  const innerW = Math.max(100, width - margin.left - margin.right);
  const innerH = Math.max(100, height - margin.top - margin.bottom);

  const svg = d3.select(container).append('svg')
    .attr('width', width)
    .attr('height', height);

  // Fun neon glow filter for hover effects
  const defs = svg.append('defs');
  const glow = defs.append('filter')
    .attr('id', 'map-glow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%');
  glow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 3).attr('result', 'blur');
  glow.append('feMerge')
    .selectAll('feMergeNode')
    .data(['blur','SourceGraphic'])
    .join('feMergeNode')
    .attr('in', d => d);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  if (!points || points.length === 0) {
    g.append('text')
      .attr('x', innerW/2)
      .attr('y', innerH/2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--muted)')
      .text('No location data');
    return;
  }

  // Remove geographic outliers using robust quantiles
  const lonsAll = points.map(p => p.lon).filter(Number.isFinite);
  const latsAll = points.map(p => p.lat).filter(Number.isFinite);
  const lonSorted = lonsAll.slice().sort(d3.ascending);
  const latSorted = latsAll.slice().sort(d3.ascending);
  const qLo = 0.005, qHi = 0.995; // trim 0.5% tails
  const lonMinQ = d3.quantileSorted(lonSorted, qLo);
  const lonMaxQ = d3.quantileSorted(lonSorted, qHi);
  const latMinQ = d3.quantileSorted(latSorted, qLo);
  const latMaxQ = d3.quantileSorted(latSorted, qHi);
  let inliers = points.filter(p => (
    p.lon >= lonMinQ && p.lon <= lonMaxQ && p.lat >= latMinQ && p.lat <= latMaxQ
  ));
  if (!inliers.length) inliers = points.slice(); // fallback if filtering removed all

  // Compute bounds in [lon, lat]
  const coords = inliers.map(p => [p.lon, p.lat]);

  // Projection: blank map (no basemap), fit to points with padding
  // Determine point radius based on count and account for jitter in padding so all dots are visible
  const baseR = Math.max(1, Math.min(4, Math.floor(Math.sqrt(4000 / inliers.length))));
  const maxJitter = 4; // increased to space points more; must match jitterFor usage

  const projection = d3.geoMercator();
  const padding = 8 + baseR + maxJitter + 1; // include dot radius and jitter
  try {
    projection.fitExtent([[padding, padding], [innerW - padding, innerH - padding]], {
      type: 'FeatureCollection',
      features: coords.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } }))
    });
  } catch (e) {
    // Fallback: set scale and translate using bounds of coordinates
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const lonMin = d3.min(lons), lonMax = d3.max(lons);
    const latMin = d3.min(lats), latMax = d3.max(lats);
    const kx = innerW / Math.max(1e-6, lonMax - lonMin);
    const ky = innerH / Math.max(1e-6, latMax - latMin);
    const k = 0.95 * Math.min(kx, ky);
    projection.scale(k * 150).translate([innerW/2, innerH/2]);
  }

  const project = d => projection([d.lon, d.lat]);

  // Define a clip-path to confine drawing to the inner viewport
  const clipId = 'map-clip-' + Math.random().toString(36).slice(2);
  svg.append('defs').append('clipPath')
    .attr('id', clipId)
    .append('rect')
    .attr('x', margin.left)
    .attr('y', margin.top)
    .attr('width', innerW)
    .attr('height', innerH);

  // A group that will be clipped and transformed by zoom/pan
  const viewport = g.append('g').attr('clip-path', `url(#${clipId})`);
  const mapG = viewport.append('g');

  // Deterministic small jitter to separate points sharing identical coordinates
  function hash(str) {
    let h = 2166136261 >>> 0; // FNV-1a
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function jitterFor(d, max = 4) {
    const key = `${d.lat.toFixed(6)},${d.lon.toFixed(6)}`; // stabilize identical coords
    const h = hash(key);
    const t = (h % 10000) / 10000; // 0..1
    const angle = t * Math.PI * 2;
    const radius = (0.3 + 0.7 * ((Math.floor(h / 10000) % 10000) / 10000)) * max; // 0.3..max
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }

  // Density overlay (regional accident frequency) computed in screen space and placed under points
  const projected = inliers.map(d => ({ d, p: project(d) }));
  // Heuristic bandwidth based on area and point count
  const bandwidth = Math.max(12, Math.min(60, Math.sqrt((innerW * innerH) / Math.max(1, inliers.length)) / 2));
  const density = d3.contourDensity()
    .x(o => o.p[0])
    .y(o => o.p[1])
    .size([innerW, innerH])
    .bandwidth(bandwidth)
    .thresholds(20)(projected);

  // Build color scale for density values with percentile normalization
  const densityVals = density.map(c => c.value);
  const allZeroDensity = densityVals.every(v => v === 0);
  function buildDensityColor(arr) {
    const a = (arr && arr.length) ? arr : densityVals;
    if (!a.every(v => v === 0) && d3.scaleSequentialQuantile) {
      return d3.scaleSequentialQuantile(a, d3.interpolateYlOrRd);
    }
    const maxV = Math.max(1e-6, d3.max(a) || 1e-6);
    return d3.scaleSequential().domain([0, maxV]).interpolator(d3.interpolateYlOrRd);
  }
  const densityColor = buildDensityColor(densityVals);

  // Group for density contours under points
  const densityG = mapG.append('g').attr('class', 'density');
  densityG.selectAll('path')
    .data(density)
    .join('path')
    .attr('d', d3.geoPath())
    .attr('fill', d => densityColor(d.value))
    .attr('fill-opacity', 0.35)
    .attr('stroke', 'none');

  // Draw points (above density)
  const circles = mapG.selectAll('circle.point')
    .data(inliers)
    .join('circle')
    .attr('class', 'point')
    .attr('cx', d => {
      const [x, y] = project(d);
      const [dx] = jitterFor(d, maxJitter);
      return x + dx;
    })
    .attr('cy', d => {
      const [x, y] = project(d);
      const [, dy] = jitterFor(d, maxJitter);
      return y + dy;
    })
    .attr('r', baseR)
    .attr('fill', '#ef4444')
    .attr('fill-opacity', 0.7)
    .attr('stroke', '#ffd8f0')
    .attr('stroke-opacity', 0.9)
    .attr('stroke-width', 0.6)
    .attr('vector-effect', 'non-scaling-stroke')
    .style('cursor', 'pointer')
    .on('mousemove', function(event, d) {
      d3.select(this)
        .attr('filter', 'url(#map-glow)')
        .attr('fill-opacity', 1);
    })
    .on('mouseout', function() {
      d3.select(this)
        .attr('filter', null)
        .attr('fill-opacity', 0.7);
    });

  // Density legend rendered into external container below the map
  const legendHost = document.getElementById((containerId.replace('#','')) + '-legend');
  if (legendHost) {
    legendHost.innerHTML = '';
    const hostW = Math.max(180, Math.min(400, legendHost.clientWidth || width));
    const hostH = 36;
    const legendW = hostW - 20;
    const legendH = 10;
    const padX = 10;

    const lsvg = d3.select(legendHost).append('svg')
      .attr('width', hostW)
      .attr('height', hostH);

    const lg = lsvg.append('defs').append('linearGradient')
      .attr('id', 'density-lg')
      .attr('x1', '0%').attr('x2', '100%')
      .attr('y1', '0%').attr('y2', '0%');

    const steps = 10;
    const sortedVals = densityVals.slice().sort(d3.ascending);
    const useQ = !allZeroDensity && !!d3.scaleSequentialQuantile;
    if (useQ) {
      d3.range(0, steps + 1).forEach(i => {
        const t = i / steps;
        const q = d3.quantileSorted(sortedVals, t);
        lg.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', densityColor(q));
      });
    } else {
      const maxV = Math.max(1e-6, d3.max(densityVals) || 1e-6);
      d3.range(0, steps + 1).forEach(i => {
        const t = i / steps;
        lg.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', densityColor(t * maxV));
      });
    }

    lsvg.append('rect')
      .attr('x', padX)
      .attr('y', 4)
      .attr('width', legendW)
      .attr('height', legendH)
      .attr('fill', 'url(#density-lg)')
      .attr('stroke', '#334155');

    const legendScale = useQ
      ? d3.scaleLinear().domain([0, 1]).range([padX, padX + legendW])
      : d3.scaleLinear().domain([0, Math.max(1e-6, d3.max(densityVals) || 1e-6)]).range([padX, padX + legendW]);

    let legendAxis;
    if (useQ) {
      const ticksP = [0, 0.25, 0.5, 0.75, 1];
      const fmt = d3.format('.2f');
      legendAxis = d3.axisBottom(legendScale)
        .tickValues(ticksP)
        .tickSize(4)
        .tickFormat(p => fmt(d3.quantileSorted(sortedVals, p) || 0));
    } else {
      legendAxis = d3.axisBottom(legendScale)
        .ticks(4)
        .tickSize(4)
        .tickFormat(d3.format('.2f'));
    }

    lsvg.append('g')
      .attr('transform', `translate(0, ${4 + legendH})`)
      .call(legendAxis);
    lsvg.append('text')
      .attr('x', hostW / 2)
      .attr('y', 32)
      .attr('text-anchor', 'middle')
      .text('Regional accident density');
  }

  // Optional outline box as the "blank map" frame (not zoomed)
  g.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', innerW)
    .attr('height', innerH)
    .attr('fill', 'none')
    .attr('stroke', '#334155');

  // Add an invisible overlay to capture zoom/pan interactions
  const overlay = g.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', innerW)
    .attr('height', innerH)
    .attr('fill', 'transparent')
    .style('pointer-events', 'none');

  const zoom = d3.zoom()
    .scaleExtent([1, 40])
    .translateExtent([[0, 0], [innerW, innerH]])
    .extent([[0, 0], [innerW, innerH]])
    .on('start', () => svg.style('cursor', 'grabbing'))
    .on('end', () => svg.style('cursor', 'default'))
    .on('zoom', (event) => {
      mapG.attr('transform', event.transform);
      const k = event.transform.k;
      circles.attr('r', baseR / k);
    });

  svg.call(zoom);
}
