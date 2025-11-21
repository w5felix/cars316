// Statistical analysis module
// Exports: analyzeFactors(rows)
// rows: array of { injured:boolean, hour:number|null, borough?:string, factor1?:string, factor2?:string, vehicleType?:string, preCrash?:string, driverSex?:string }

export function analyzeFactors(rows) {
  if (!rows || !rows.length) return [];

  // Candidate factor extractors: name -> function(row) -> value or null
  const factors = [
    { name: 'Borough', key: 'borough', get: r => val(r.borough) },
    { name: 'Contributing factor', key: 'factor1', get: r => val(r.factor1) },
    { name: 'Contributing factor (2)', key: 'factor2', get: r => val(r.factor2) },
    { name: 'Vehicle type', key: 'vehicleType', get: r => val(r.vehicleType) },
    { name: 'Pre-crash action', key: 'preCrash', get: r => val(r.preCrash) },
    { name: 'Driver sex', key: 'driverSex', get: r => normalizeDriverSex(val(r.driverSex)) },
    { name: 'Hour of day', key: 'hour', get: r => (Number.isFinite(r.hour) ? String(r.hour).padStart(2,'0')+':00' : null) }
  ];

  const minGroupSize = 30; // guard against tiny groups

  const N = rows.length;
  const injuredTotal = rows.reduce((a, r) => a + (r.injured ? 1 : 0), 0);
  const baseRate = injuredTotal / Math.max(1, N);

  const results = [];

  for (const f of factors) {
    // Build counts per category for this factor
    const counts = new Map(); // value -> { n, injured }
    for (const r of rows) {
      const v = f.get(r);
      if (v == null || v === '' || v === 'Unspecified') continue;
      let c = counts.get(v);
      if (!c) { c = { n: 0, injured: 0 }; counts.set(v, c); }
      c.n += 1;
      if (r.injured) c.injured += 1;
    }

    counts.forEach((c, v) => {
      if (c.n < minGroupSize) return; // skip small groups
      const otherN = N - c.n;
      const otherInj = injuredTotal - c.injured;
      if (otherN <= 0) return;

      const a = c.injured;              // Injured in group
      const b = c.n - c.injured;        // Not injured in group
      const c2 = otherInj;              // Injured in others
      const d = otherN - otherInj;      // Not injured in others

      // Compute Chi-square for 2x2 table with Yates correction optional (omit for simplicity)
      const total = a + b + c2 + d;
      const row1 = a + b;
      const row2 = c2 + d;
      const col1 = a + c2;
      const col2 = b + d;
      // Expected counts
      const Ea = row1 * col1 / total;
      const Eb = row1 * col2 / total;
      const Ec = row2 * col1 / total;
      const Ed = row2 * col2 / total;
      // Chi-square sum
      const chi2 = safeChi(a, Ea) + safeChi(b, Eb) + safeChi(c2, Ec) + safeChi(d, Ed);

      const rate = c.n ? (a / c.n) : 0;
      const otherRate = otherN ? (otherInj / otherN) : 0;
      const rr = otherRate > 0 ? (rate / otherRate) : (rate > 0 ? Infinity : 1);

      results.push({
        factor: f.name,
        value: String(v),
        n: c.n,
        injured: a,
        rate,
        otherN,
        otherInjured: otherInj,
        otherRate,
        rr,
        chi2,
        baseRate
      });
    });
  }

  // Rank by chi-square desc, tie-break by n desc
  results.sort((x, y) => d3.descending(x.chi2, y.chi2) || d3.descending(x.n, y.n));

  // Return top 15 entries
  return results.slice(0, 15);
}

function val(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t || t === 'NA' || t === 'Unknown') return null;
  return t;
}

// Normalize driver sex values: "M" -> "Male", "F" -> "Female"
function normalizeDriverSex(s) {
  if (s == null) return null;
  const t = String(s).trim().toUpperCase();
  if (t === 'M') return 'Male';
  if (t === 'F') return 'Female';
  return s; // pass through other values
}

function safeChi(obs, exp) {
  if (exp <= 0) return 0;
  const diff = obs - exp;
  return (diff * diff) / exp;
}
