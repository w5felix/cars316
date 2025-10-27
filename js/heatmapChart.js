// Heatmap rendering module
// Exports: renderHeatmap(containerId, model)
// model: { months, hours, grid, globalMax }

export function renderHeatmap(containerId, model) {
  const { months, hours, grid, globalMax } = model;
  const container = document.getElementById(containerId.replace('#','')) || document.querySelector(containerId);
  if (!container) throw new Error(`Container ${containerId} not found`);

  // Clear container
  container.innerHTML = '';

  if (!grid || !grid.length) {
    const p = document.createElement('p');
    p.textContent = 'No valid records found in CSV.';
    container.appendChild(p);
    return;
  }

  const width = container.clientWidth;
  const height = container.clientHeight;

  const margin = { top: 24, right: 28, bottom: 60, left: 60 };
  const legendHeight = 12;
  const legendWidth = Math.min(320, Math.max(180, width * 0.4));

  const innerW = Math.max(200, width - margin.left - margin.right);
  const innerH = Math.max(200, height - margin.top - margin.bottom - 40);

  const svg = d3.select(container).append('svg')
    .attr('width', width)
    .attr('height', height);

  // Neon glow filter for goofy hover effects on cells
  const defs = svg.append('defs');
  const heatGlow = defs.append('filter')
    .attr('id', 'heat-glow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%');
  heatGlow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 2.5).attr('result', 'blur');
  heatGlow.append('feMerge')
    .selectAll('feMergeNode')
    .data(['blur','SourceGraphic'])
    .join('feMergeNode')
    .attr('in', d => d);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // X: time scale for zooming/panning
  const xTime0 = d3.scaleTime()
    .domain([months[0], months[months.length - 1]])
    .range([0, innerW]);
  let xTime = xTime0.copy();

  // Maintain an orderable hours array for cyclic vertical scrolling
  const hoursOrder = hours.slice();
  const y = d3.scaleBand()
    .domain(hoursOrder)
    .range([0, innerH])
    .paddingInner(0)
    .paddingOuter(0);

  // Color scale helpers: build a scale from a set of counts using percentile normalization with linear fallback
  // Use a green → yellow → red palette (low = green, high = red)
  const allCounts = grid.map(d => d.count);
  const greenToRed = t => d3.interpolateRdYlGn(1 - t);
  function buildColorScale(countsArr) {
    const arr = (countsArr && countsArr.length) ? countsArr : allCounts;
    const allZeroLocal = arr.every(c => c === 0);
    if (!allZeroLocal && d3.scaleSequentialQuantile) {
      return d3.scaleSequentialQuantile(arr, greenToRed);
    }
    const maxLocal = Math.max(1, d3.max(arr) || globalMax || 1);
    return d3.scaleSequential().domain([0, maxLocal]).interpolator(greenToRed);
  }
  let color = buildColorScale(allCounts);

  // Clip path to keep drawing within chart area during panning
  const clipId = 'clip-' + Math.random().toString(36).slice(2);
  svg.append('defs').append('clipPath')
    .attr('id', clipId)
    .append('rect')
    .attr('x', margin.left)
    .attr('y', margin.top)
    .attr('width', innerW)
    .attr('height', innerH);

  // Grid background lines (horizontal)
  const gridlinesG = g.append('g');
  function drawGridlines() {
    const sel = gridlinesG.selectAll('line.gridline')
      .data(hoursOrder, d => d);
    sel.join(
      enter => enter.append('line')
        .attr('class', 'gridline')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', h => y(h) + y.bandwidth())
        .attr('y2', h => y(h) + y.bandwidth()),
      update => update
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', h => y(h) + y.bandwidth())
        .attr('y2', h => y(h) + y.bandwidth())
    );
  }
  drawGridlines();

  // Cells
  const cellG = g.append('g').attr('clip-path', `url(#${clipId})`);
  const cell = cellG
    .selectAll('rect')
    .data(grid)
    .join('rect')
    .attr('y', d => y(d.hour))
    .attr('height', y.bandwidth())
    .attr('fill', d => color(d.count));

  function cellWidth() {
    const w = xTime(d3.timeMonth.offset(months[0], 1)) - xTime(months[0]);
    return Math.max(1, Math.floor(w));
  }
  function positionCells() {
    const w = cellWidth();
    cell
      .attr('x', d => xTime(d.month))
      .attr('width', w);
  }
  positionCells();

  const tooltip = d3.select('#tooltip');
  const fmtMonth = d3.timeFormat('%b %Y');
  const svgNode = svg.node();

  cell
    .style('cursor', 'pointer')
    .on('mousemove', function(event, d) {
      tooltip
        .style('left', (event.pageX) + 'px')
        .style('top', (event.pageY - 8) + 'px')
        .style('opacity', 1)
        .html(`
          <strong>${fmtMonth(new Date(+d.month))}</strong><br>
          Hour: ${String(d.hour).padStart(2, '0')}:00<br>
          Accidents: ${d.count}
        `);
      d3.select(this)
        .attr('stroke', '#19e3ff')
        .attr('stroke-width', 1.5)
        .attr('filter', 'url(#heat-glow)');
    })
    .on('mouseout', function() {
      tooltip.style('opacity', 0);
      d3.select(this)
        .attr('stroke', 'none')
        .attr('filter', null);
    });

  // Axes
  const xAxisScale = xTime.copy();
  const xAxis = d3.axisBottom(xAxisScale)
    .ticks(Math.min(12, months.length))
    .tickSizeOuter(0);

  const yAxis = d3.axisLeft(y)
    .tickValues(hoursOrder.filter(h => h % 2 === 0))
    .tickFormat(d => `${String(d).padStart(2, '0')}:00`)
    .tickSizeOuter(0);

  const xAxisG = g.append('g')
    .attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(xAxis);
  xAxisG.selectAll('text')
    .attr('transform', 'rotate(0)')
    .style('text-anchor', 'middle');

  const yAxisG = g.append('g')
    .attr('class', 'axis y-axis')
    .call(yAxis);

  // Axis labels
  svg.append('text')
    .attr('x', margin.left + innerW / 2)
    .attr('y', margin.top + innerH + 40)
    .attr('fill', 'var(--muted)')
    .attr('text-anchor', 'middle')
    .text('Month');

  svg.append('text')
    .attr('transform', `translate(16, ${margin.top + innerH / 2}) rotate(-90)`) 
    .attr('fill', 'var(--muted)')
    .attr('text-anchor', 'middle')
    .text('Hour of day');

  // Legend (dynamic: updates when color scale changes)
  // External legend container just below the chart container
  const baseId = containerId.replace('#','');
  const legendHost = document.getElementById(baseId + '-legend');
  if (legendHost) legendHost.innerHTML = '';

  function renderLegendFor(countsArr, clr) {
    if (!legendHost) return;
    legendHost.innerHTML = '';
    const hostW = Math.max(180, Math.min(400, legendHost.clientWidth || width));
    const hostH = 36;

    const lsvg = d3.select(legendHost).append('svg')
      .attr('width', hostW)
      .attr('height', hostH);

    const lgdefs = lsvg.append('defs').append('linearGradient')
      .attr('id', 'heat-lg')
      .attr('x1', '0%').attr('x2', '100%')
      .attr('y1', '0%').attr('y2', '0%');

    const steps = 10;
    const arr = (countsArr && countsArr.length) ? countsArr : allCounts;
    const allZeroLocal = arr.every(c => c === 0);
    const useQuantileLocal = !allZeroLocal && !!d3.scaleSequentialQuantile;
    const sortedLocal = arr.slice().sort(d3.ascending);
    if (useQuantileLocal) {
      d3.range(0, steps + 1).forEach(i => {
        const t = i / steps;
        const q = d3.quantileSorted(sortedLocal, t);
        lgdefs.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', clr(q));
      });
    } else {
      const maxLocal = Math.max(1, d3.max(arr) || globalMax || 1);
      d3.range(0, steps + 1).forEach(i => {
        const t = i / steps;
        lgdefs.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', clr(t * maxLocal));
      });
    }

    const padX = 10;
    const legendW2 = hostW - padX * 2;
    const legendH2 = 10;

    lsvg.append('rect')
      .attr('x', padX)
      .attr('y', 4)
      .attr('width', legendW2)
      .attr('height', legendH2)
      .attr('fill', 'url(#heat-lg)')
      .attr('stroke', '#334155');

    const legendScale = useQuantileLocal
      ? d3.scaleLinear().domain([0, 1]).range([padX, padX + legendW2])
      : d3.scaleLinear().domain([0, Math.max(1, d3.max(arr) || globalMax || 1)]).range([padX, padX + legendW2]);

    let legendAxis;
    if (useQuantileLocal) {
      const ticksP = [0, 0.25, 0.5, 0.75, 0.9, 1];
      const fmt = d3.format('~s');
      legendAxis = d3.axisBottom(legendScale)
        .tickValues(ticksP)
        .tickSize(4)
        .tickFormat(p => fmt(d3.quantileSorted(sortedLocal, p) || 0));
    } else {
      legendAxis = d3.axisBottom(legendScale)
        .ticks(5)
        .tickSize(4)
        .tickFormat(d3.format('~s'));
    }

    lsvg.append('g')
      .attr('transform', `translate(0, ${4 + legendH2})`)
      .call(legendAxis);

    lsvg.append('text')
      .attr('x', hostW / 2)
      .attr('y', 32)
      .attr('text-anchor', 'middle')
      .text(useQuantileLocal ? 'Accident frequency (percentiles)' : 'Accident frequency');
  }

  renderLegendFor(allCounts, color);

  // --- Interactions ---
  // Horizontal zoom/pan on date axis
  const zoom = d3.zoom()
    .scaleExtent([1, 20])
    .translateExtent([[0, 0], [innerW, innerH]])
    .extent([[0, 0], [innerW, innerH]])
    // Only zoom with ctrl+wheel, touch, and drag; plain wheel reserved for vertical cycling
    .filter(event => (
      event.type === 'wheel' ? event.ctrlKey : true
    ))
    .on('zoom', (event) => {
      xTime = event.transform.rescaleX(xTime0);
      xAxis.scale(xTime);
      g.select('.x-axis').call(xAxis);
      positionCells();
      // Re-normalize colors based on visible month window
      const [d0, d1] = xTime.domain();
      const visibleCounts = grid.filter(c => c.month >= d0 && c.month <= d1).map(c => c.count);
      color = buildColorScale(visibleCounts);
      cell.attr('fill', d => color(d.count));
      renderLegendFor(visibleCounts, color);
    });

  // Attach zoom to the SVG so dragging over cells still works
  svg.call(zoom);

  // Vertical wheel to cycle hours order
  let wheelAccum = 0;
  const stepPx = 60; // pixels per row step
  function onWheel(e) {
    // If ctrlKey used, let zoom handler handle it
    if (e.ctrlKey) return;
    e.preventDefault();
    wheelAccum += e.deltaY;
    let steps = 0;
    while (Math.abs(wheelAccum) >= stepPx) {
      steps += wheelAccum > 0 ? 1 : -1;
      wheelAccum += wheelAccum > 0 ? -stepPx : stepPx;
    }
    if (steps !== 0) {
      // Normalize steps to within 0..hoursOrder.length-1
      const n = hoursOrder.length;
      const k = ((steps % n) + n) % n;
      if (k !== 0) {
        // Rotate hoursOrder by k (positive = scroll down -> move top to bottom)
        for (let i = 0; i < k; i++) {
          const first = hoursOrder.shift();
          hoursOrder.push(first);
        }
        y.domain(hoursOrder);
        // Update y-dependent elements
        cell
          .attr('y', d => y(d.hour))
          .attr('height', y.bandwidth());
        drawGridlines();
        yAxis.tickValues(hoursOrder.filter(h => h % 2 === 0));
        yAxisG.call(yAxis);
      }
    }
  }
  // Use native listener to guarantee passive:false
  svg.node().addEventListener('wheel', onWheel, { passive: false });
}
