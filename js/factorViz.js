// Factor visualization module
// Exports: renderFactorChart(containerId, results)
// results: array from analyzeFactors, each with { factor, value, n, injured, rate, otherN, otherInjured, otherRate, rr, chi2, baseRate }

export function renderFactorChart(containerId, results) {
  const container = document.getElementById(containerId.replace('#','')) || document.querySelector(containerId);
  if (!container) throw new Error(`Container ${containerId} not found`);

  container.innerHTML = '';

  const width = container.clientWidth;
  const height = container.clientHeight;

  if (!results || !results.length) {
    const p = document.createElement('p');
    p.textContent = 'No significant factors found in dataset.';
    container.appendChild(p);
    return;
  }

  const margin = { top: 24, right: 24, bottom: 72, left: 200 };
  const innerW = Math.max(200, width - margin.left - margin.right);
  const innerH = Math.max(200, height - margin.top - margin.bottom);

  const svg = d3.select(container).append('svg')
    .attr('width', width)
    .attr('height', height);

  // Fun glow filter for hover effects on bars
  const defs = svg.append('defs');
  const barGlow = defs.append('filter')
    .attr('id', 'bar-glow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%');
  barGlow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 2).attr('result', 'blur');
  barGlow.append('feMerge')
    .selectAll('feMergeNode')
    .data(['blur','SourceGraphic'])
    .join('feMergeNode')
    .attr('in', d => d);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Build labels like "Factor: Value"
  const items = results.map(r => ({
    label: `${r.factor}: ${r.value}`,
    chi2: r.chi2,
    rr: r.rr,
    n: r.n,
    injured: r.injured,
    rate: r.rate,
    otherRate: r.otherRate,
    baseRate: r.baseRate
  }));

  // Scales
  const x = d3.scaleLinear()
    .domain([0, d3.max(items, d => d.chi2) || 1])
    .nice()
    .range([0, innerW]);

  const y = d3.scaleBand()
    .domain(items.map(d => d.label))
    .range([0, innerH])
    .padding(0.2);

  // Color by risk ratio: >1 red, ~1 yellow, <1 green using RdYlGn inverted appropriately
  const color = d => d3.interpolateRdYlGn(Math.max(0, Math.min(1, 1 - ((d.rr - 0.5) / 1.5))));

  // Bars
  const bars = g.selectAll('rect.bar')
    .data(items)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', 0)
    .attr('y', d => y(d.label))
    .attr('width', d => x(d.chi2))
    .attr('height', y.bandwidth())
    .attr('fill', d => color(d))
    .attr('stroke', '#334155')
    .style('cursor', 'pointer');

  // Axes
  const xAxis = d3.axisBottom(x).ticks(5).tickSizeOuter(0);
  const yAxis = d3.axisLeft(y).tickSizeOuter(0);

  g.append('g')
    .attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(xAxis);

  g.append('g')
    .attr('class', 'axis y-axis')
    .call(yAxis);

  // Axis labels
  svg.append('text')
    .attr('x', margin.left + innerW / 2)
    .attr('y', margin.top + innerH + 32)
    .attr('fill', 'var(--muted)')
    .attr('text-anchor', 'middle')
    .text('Chi-square score (higher = more explanatory)');

  // Tooltip
  const tooltip = d3.select('#tooltip');
  const fmtPct = d3.format('.1%');
  const fmt = d3.format(',.0f');
  const fmt2 = d3.format('.2f');

  bars.on('mousemove', function(event, d) {
      tooltip
        .style('left', (event.pageX) + 'px')
        .style('top', (event.pageY - 8) + 'px')
        .style('opacity', 1)
        .html(`
          <strong>${d.label}</strong><br>
          Chi-square: ${fmt2(d.chi2)}<br>
          Risk ratio: ${fmt2(d.rr)}<br>
          Group size: ${fmt(d.n)} | Injured: ${fmt(d.injured)}<br>
          Group rate: ${fmtPct(d.rate)} | Others: ${fmtPct(d.otherRate)}
        `);
      d3.select(this)
        .attr('stroke', '#19e3ff')
        .attr('filter', 'url(#bar-glow)');
    })
    .on('mouseout', function() {
      tooltip.style('opacity', 0);
      d3.select(this)
        .attr('stroke', '#334155')
        .attr('filter', null);
    });

  // Legend for color meaning rendered into external container
  const legendHost = document.getElementById((containerId.replace('#','')) + '-legend');
  if (legendHost) {
    legendHost.innerHTML = '';
    const hostW = Math.max(180, Math.min(420, legendHost.clientWidth || width));
    const hostH = 40;
    const padX = 10;
    const barW = hostW - padX * 2;

    const lsvg = d3.select(legendHost).append('svg')
      .attr('width', hostW)
      .attr('height', hostH);

    const lg = lsvg.append('defs').append('linearGradient')
      .attr('id', 'rr-lg')
      .attr('x1', '0%').attr('x2', '100%')
      .attr('y1', '0%').attr('y2', '0%');

    const rrMin = 0.5, rrMax = 2.0;
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const rr = rrMin + t * (rrMax - rrMin);
      lg.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', d3.interpolateRdYlGn(1 - ((rr - rrMin) / (rrMax - rrMin))));
    }

    lsvg.append('rect')
      .attr('x', padX)
      .attr('y', 6)
      .attr('width', barW)
      .attr('height', 10)
      .attr('fill', 'url(#rr-lg)')
      .attr('stroke', '#334155');

    const scale = d3.scaleLinear().domain([rrMin, rrMax]).range([padX, padX + barW]);
    const axis = d3.axisBottom(scale).ticks(4).tickSize(4);
    lsvg.append('g').attr('transform', 'translate(0,16)').call(axis);
    lsvg.append('text')
      .attr('x', hostW / 2)
      .attr('y', 34)
      .attr('text-anchor', 'middle')
      .text('Risk ratio (group vs others)');
  }
}
