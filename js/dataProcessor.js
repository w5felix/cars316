// Data processing module
// Exports: buildGrid(raw)

export function buildGrid(raw) {
  if (!raw || !raw.length) {
    return { months: [], hours: [], grid: [], globalMax: 0 };
  }
  const timeMonth = d3.timeMonth;
  const minDate = d3.min(raw, d => d.date);
  const maxDate = d3.max(raw, d => d.date);
  const months = d3.timeMonth.range(timeMonth.floor(minDate), d3.timeMonth.offset(timeMonth.ceil(maxDate), 1));
  const hours = d3.range(0, 24);

  // Aggregate counts by month x hour
  const counts = d3.rollup(raw, v => v.length, d => timeMonth.floor(d.date), d => d.hour);

  const grid = [];
  let globalMax = 0;
  for (const month of months) {
    for (const h of hours) {
      const c = counts.get(month)?.get(h) || 0;
      grid.push({ month, hour: h, count: c });
      if (c > globalMax) globalMax = c;
    }
  }
  return { months, hours, grid, globalMax };
}
