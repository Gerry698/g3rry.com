// Camera resection for the atlas: the east, north, height, azimuth, pitch and roll that best reproject known 3D points
// (a site's local frame, metres: e.g. tower tops from the LiDAR) onto where they appear in a photograph (x right, y down,
// 0..1). Used for the Golden Gate stations (p16, p17); import it from a small per-photograph script:
//   import { resect } from './resect.mjs';
//   resect({ focal: 142, observations: [{ p: [e, n, z], at: [x, y] }, ...], starts: [[e, n, z, az, pitch, 0]], fixed: [null, null, null, null, null, 0] })
// It returns the camera and the residuals in millimetres on the sensor; check the solved height against the LiDAR ground.
const rad = Math.PI / 180;
export function basis(az, pitch, roll) {
  const a = az * rad, p = pitch * rad, r = roll * rad;
  const f = [Math.sin(a) * Math.cos(p), Math.cos(a) * Math.cos(p), Math.sin(p)];
  const r0 = [Math.cos(a), -Math.sin(a), 0];
  const u0 = [r0[1] * f[2] - r0[2] * f[1], r0[2] * f[0] - r0[0] * f[2], r0[0] * f[1] - r0[1] * f[0]];
  const right = r0.map((v, k) => v * Math.cos(r) + u0[k] * Math.sin(r));
  const up = u0.map((v, k) => v * Math.cos(r) - r0[k] * Math.sin(r));
  return { f, right, up };
}
export function project(cam, point, focal, portrait) {
  const [e, n, h, az, pitch, roll] = cam;
  const { f, right, up } = basis(az, pitch, roll);
  const d = [point[0] - e, point[1] - n, point[2] - h];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  const X = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / z, Y = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / z;
  const [w, hgt] = portrait ? [24, 36] : [36, 24];
  return [.5 + X * focal / w, .5 - Y * focal / hgt, z];
}
function nelderMead(fn, start, steps, iterations = 6000) {
  let simplex = [start, ...start.map((_, i) => start.map((v, k) => k === i ? v + steps[i] : v))].map(p => [p, fn(p)]);
  for (let it = 0; it < iterations; it++) {
    simplex.sort((a, b) => a[1] - b[1]);
    const n = start.length, centroid = start.map((_, k) => simplex.slice(0, n).reduce((s, p) => s + p[0][k], 0) / n);
    const worst = simplex[n];
    const at = t => centroid.map((c, k) => c + t * (worst[0][k] - c));
    const reflected = at(-1), fr = fn(reflected);
    if (fr < simplex[0][1]) { const expanded = at(-2), fe = fn(expanded); simplex[n] = fe < fr ? [expanded, fe] : [reflected, fr]; }
    else if (fr < simplex[n - 1][1]) simplex[n] = [reflected, fr];
    else {
      const contracted = at(.5), fc = fn(contracted);
      if (fc < worst[1]) simplex[n] = [contracted, fc];
      else simplex = simplex.map((p, i) => i === 0 ? p : (q => [q, fn(q)])(p[0].map((v, k) => simplex[0][0][k] + .5 * (v - simplex[0][0][k]))));
    }
  }
  simplex.sort((a, b) => a[1] - b[1]);
  return simplex[0];
}
// observations: [{ p: [e, n, z], at: [x, y], w }]; fixed: values for parameters to hold (null = free)
export function resect({ observations, focal, portrait = false, starts, fixed: given = [], prior = () => 0 }) {
  const fixed = Array.from({ length: 6 }, (_, i) => given[i] ?? null);
  const [w, h] = portrait ? [24, 36] : [36, 24];
  const cost = free => {
    const cam = fixed.map((v, i) => v ?? free[i]);
    let c = 0;
    for (const o of observations) {
      const [x, y, z] = project(cam, o.p, focal, portrait);
      if (z <= 0) return 1e9;
      // Squared error in millimetres on the sensor.
      c += (o.w ?? 1) * (((x - o.at[0]) * w) ** 2 + ((y - o.at[1]) * h) ** 2);
    }
    return c + prior(cam);
  };
  let best = null;
  for (const start of starts) {
    let result = nelderMead(cost, start, [60, 60, 20, 2, 1, .5]);
    for (let k = 0; k < 4; k++) result = nelderMead(cost, result[0], [5, 5, 2, .2, .1, .05]);
    if (!best || result[1] < best[1]) best = result;
  }
  const cam = fixed.map((v, i) => v ?? best[0][i]);
  const residuals = observations.map(o => { const [x, y] = project(cam, o.p, focal, portrait); return [((x - o.at[0]) * w).toFixed(3), ((y - o.at[1]) * h).toFixed(3)].join('/'); });
  return { cam, rms: Math.sqrt(best[1] / observations.length), residualsMm: residuals };
}
