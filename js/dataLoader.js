// Data loader module
// Exports: loadCollisions(csvPath), loadLocations(csvPath), loadAnalysis(csvPath)

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

    // parse hour from CRASH_TIME (HH:MM)
    let hour = null;
    if (d.CRASH_TIME) {
      const tm = /^(\d{1,2}):(\d{1,2})/.exec(d.CRASH_TIME.trim());
      if (tm) hour = +tm[1];
    }

    return { lat, lon, hour };
  });
  return raw.filter(Boolean);
}

// Analysis loader: parse fields for factor analysis
export async function loadAnalysis(csvPath) {
  const parseDate = d3.timeParse('%m/%d/%Y');
  return (await d3.csv(csvPath, d => {
    // injury indicator: use NUMBER OF PERSONS INJURED or Severity > 0
    const numInj = parseFloat(d['NUMBER OF PERSONS INJURED']);
    const sev = parseFloat(d['Severity']);
    const injured = (isFinite(numInj) && numInj > 0) || (isFinite(sev) && sev > 0);

    // date and hour
    const date = parseDate(d.CRASH_DATE);
    let hour = null;
    if (d.CRASH_TIME) {
      const m = /^(\d{1,2}):(\d{1,2})/.exec(d.CRASH_TIME.trim());
      if (m) hour = +m[1];
    }
    const dow = date ? date.getDay() : null; // 0=Sun..6=Sat

    // categorical fields
    const borough = (d.BOROUGH || '').trim();
    const factor1 = (d.CONTRIBUTING_FACTOR_1 || '').trim();
    const factor2 = (d.CONTRIBUTING_FACTOR_2 || '').trim();
    const vehicleType = (d['VEHICLE TYPE CODE 1'] || d.VEHICLE_TYPE || '').trim();
    const preCrash = (d.PRE_CRASH || '').trim();
    const driverSex = (d.DRIVER_SEX || '').trim();

    return { injured, date, dow, hour, borough, factor1, factor2, vehicleType, preCrash, driverSex };
  })).filter(r => r); // keep all rows, even if some fields missing
}
