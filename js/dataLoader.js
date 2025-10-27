// Data loader module
// Exports: loadCollisions(csvPath), loadLocations(csvPath)

export async function loadCollisions(csvPath) {
  const parseDate = d3.timeParse('%m/%d/%Y');
  let raw = await d3.csv(csvPath, d => {
    const date = parseDate(d.CRASH_DATE);
    let hour = null;
    if (d.CRASH_TIME) {
      const m = /^(\d{1,2}):(\d{1,2})/.exec(d.CRASH_TIME.trim());
      if (m) hour = +m[1];
    }
    return (date && hour != null && hour >= 0 && hour <= 23) ? { date, hour } : null;
  });
  return raw.filter(Boolean);
}

// Parse LOCATION column into {lat, lon}
export async function loadLocations(csvPath) {
  // Accept coordinates in forms like "(40.85664, -73.9247)" or "40.85664, -73.9247"
  const pointRe = /^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/;
  let raw = await d3.csv(csvPath, d => {
    const loc = (d.LOCATION || '').trim();
    if (!loc) return null;
    const m = pointRe.exec(loc);
    if (!m) return null;
    const lat = +m[1];
    const lon = +m[2];
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return { lat, lon };
  });
  return raw.filter(Boolean);
}
