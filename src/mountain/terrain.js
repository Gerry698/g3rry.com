import { TAU, clamp, lerp, smoothstep, noise2, fbm, ridged, random, hexToLinear, wrapAngle } from './math.js';

// The massif is a smooth union of faceted peaks. Each peak blends a round cone with a k-sided pyramid,
// so arêtes run out from the summit along the pyramid's corners; uneven face weights keep it asymmetric.
const PEAKS = [
  { x: 0, z: 0, h: 11, r: 11.2, faces: [1.12, .86, 1.04, .93], rot: .45, pyramid: .6, profile: 1.3 },
  { x: 5.1, z: -2.5, h: 7.5, r: 5.6, faces: [1, .8, 1.15], rot: 1.25, pyramid: .55, profile: 1.22 },
  { x: -4.7, z: 3.3, h: 6.2, r: 5.8, faces: [.95, 1.1, .9, 1.05], rot: .15, pyramid: .5, profile: 1.25 },
  { x: -1.2, z: -4.4, h: 4.9, r: 6, faces: [1.1, .9, 1], rot: 2.1, pyramid: .4, profile: 1.55 },
  { x: 2.6, z: 3.9, h: 4.2, r: 5.6, faces: [1, 1, .9, 1.1, 1], rot: .7, pyramid: .35, profile: 1.6 },
  // A gendarme just below the summit breaks the cone's symmetry.
  { x: 1.05, z: .55, h: 9.9, r: 2.6, faces: [1, 1.2, .9], rot: 2.6, pyramid: .7, profile: 1.2 }
];
for (const peak of PEAKS) peak.normals = peak.faces.map((weight, i) => {
  const a = peak.rot + i * TAU / peak.faces.length;
  return [Math.cos(a) * weight / Math.cos(Math.PI / peak.faces.length), Math.sin(a) * weight / Math.cos(Math.PI / peak.faces.length)];
});
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * .25; };

export function createTerrain(seed = 11) {
  const warpX = noise2(seed), warpZ = noise2(seed + 1), ground = noise2(seed + 2), detail = noise2(seed + 3);
  const spurs = noise2(seed + 4), ranges = noise2(seed + 5), strata = noise2(seed + 6);
  let ledges = [];

  function base(x, z) {
    const r = Math.hypot(x, z);
    const wx = x + fbm(warpX, x * .085, z * .085, 3) * 1.7, wz = z + fbm(warpZ, x * .085 + 4.1, z * .085, 3) * 1.7;
    let massif = -10;
    for (const peak of PEAKS) {
      const qx = wx - peak.x, qz = wz - peak.z, round = Math.hypot(qx, qz);
      let faceted = -1e9;
      for (const n of peak.normals) faceted = Math.max(faceted, qx * n[0] + qz * n[1]);
      const d = lerp(round, faceted, peak.pyramid) / peak.r;
      massif = smax(massif, peak.h * Math.pow(Math.max(0, 1 - d), peak.profile), 1.4);
    }
    const plain = .45 + fbm(ground, x * .03, z * .03, 4) * 1.15 + (fbm(ground, x * .075 + 9, z * .075, 3) * .9 + .25) * smoothstep(7, 16, r) * (1 - smoothstep(40, 70, r) * .5);
    let h = smax(plain, massif, 1.1);
    const lift = Math.max(0, h - plain);
    const e = smoothstep(.4, 10, h);
    if (lift > .01) {
      // Radial spurs and gullies running down the fall line; the seam behind the peak is cross-faded.
      const a = Math.atan2(z, x), w = smoothstep(Math.PI - .7, Math.PI, a);
      const spur = s => ridged(spurs, s * 2.7, r * .22, 4);
      const radial = lerp(spur(a), spur(a - TAU), w);
      h += (radial - .42) * smoothstep(.2, 2.2, lift) * (.6 + 1.25 * e * (1 - .45 * e));
      h += (ridged(detail, wx * .26, wz * .26, 4) - .45) * smoothstep(.1, 1.6, lift) * (.15 + .8 * e);
      // Faint strata: stepped cliffs in the upper rock.
      const band = h / .62 + strata(x * .2, z * .2) * .8, f = band - Math.floor(band);
      h += (Math.floor(band) + smoothstep(.25, .75, f) - band) * .62 * .22 * smoothstep(3, 6.5, h);
    }
    // A ring of far ranges, kept low enough that the hero peak always dominates.
    const ring = smoothstep(75, 125, r);
    if (ring > 0) h += ring * Math.max(0, ridged(ranges, x * .012, z * .012, 5) * 30 - 7) * (1 - smoothstep(160, 188, r) * .6);
    return h;
  }

  function height(x, z) {
    let h = base(x, z);
    for (const ledge of ledges) {
      const d = Math.hypot(x - ledge.x, z - ledge.z);
      if (d < ledge.r) h = lerp(h, ledge.y, smoothstep(ledge.r, ledge.r * .35, d) * .9);
    }
    return h;
  }

  // Walks outward from the summit axis along an azimuth until the massif drops below altitude y.
  function radiusAt(angle, y, sample = height) {
    const c = Math.cos(angle), s = Math.sin(angle);
    let inner = 0, r = 0;
    while (r < 30 && sample(r * c, r * s) >= y) { inner = r; r += .3; }
    let outer = r;
    for (let i = 0; i < 10; i++) { const mid = (inner + outer) / 2; if (sample(mid * c, mid * s) < y) outer = mid; else inner = mid; }
    return (inner + outer) / 2;
  }

  function slope(x, z, sample = height) {
    const e = .12;
    return Math.hypot(sample(x + e, z) - sample(x - e, z), sample(x, z + e) - sample(x, z - e)) / (2 * e);
  }

  return { base, height, radiusAt, slope, setLedges(list) { ledges = list; } };
}

// Camps spiral upward, one revolution from trailhead to the last camp below the summit.
export function placeCamps(terrain, count, startAngle = 1.95) {
  let summit = { x: 0, z: 0, y: -1 };
  for (let x = -2; x <= 2; x += .05) for (let z = -2; z <= 2; z += .05) {
    const y = terrain.base(x, z);
    if (y > summit.y) summit = { x, z, y };
  }
  const camps = [];
  const step = TAU / Math.max(1, count - 1);
  for (let i = 0; i < count - 1; i++) {
    const f = .055 + .66 * Math.pow(i / Math.max(1, count - 2), 1.12);
    const angle = startAngle + i * step;
    // The surrounding plain rolls; keep the lowest camps a little above wherever the massif's foot is.
    const foot = terrain.base(11 * Math.cos(angle), 11 * Math.sin(angle));
    const targetY = Math.max(f * summit.y, foot + .5 + i * .4);
    // Look around the nominal spot for the gentlest ground at about the right altitude.
    let best = null;
    for (let da = -.14; da <= .14; da += .035) for (let dy = -.35; dy <= .35; dy += .175) {
      const a = angle + da, r = terrain.radiusAt(a, targetY + dy, terrain.base);
      const x = r * Math.cos(a), z = r * Math.sin(a), score = terrain.slope(x, z, terrain.base) + Math.abs(da) * 1.5;
      if (!best || score < best.score) best = { x, z, score, angle: a };
    }
    camps.push({ x: best.x, z: best.z, y: terrain.base(best.x, best.z), angle: best.angle, r: Math.hypot(best.x, best.z) });
  }
  camps.push({ x: summit.x, z: summit.z, y: summit.y, angle: startAngle + (count - 1) * step, r: Math.hypot(summit.x, summit.z), summit: true });
  terrain.setLedges(camps.filter(camp => !camp.summit).map(camp => ({ x: camp.x, z: camp.z, y: camp.y + .02, r: .85 })));
  for (const camp of camps) camp.y = terrain.height(camp.x, camp.z);
  return camps;
}

// A dotted trail: spiral between camps at interpolated altitude, then straight up the last ridge.
export function buildTrail(terrain, camps, spacing = .11) {
  const raw = [];
  for (let i = 0; i < camps.length - 1; i++) {
    const a = camps[i], b = camps[i + 1];
    const steps = 160;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      let x, z;
      if (b.summit) { x = lerp(a.x, b.x, t); z = lerp(a.z, b.z, t); }
      else {
        const angle = lerp(a.angle, a.angle + wrapPositive(b.angle - a.angle), t);
        const y = lerp(a.y, b.y, smoothstep(0, 1, t));
        const r = terrain.radiusAt(angle, y);
        x = r * Math.cos(angle); z = r * Math.sin(angle);
      }
      raw.push({ x, z, segment: i + t });
    }
  }
  raw.push({ x: camps.at(-1).x, z: camps.at(-1).z, segment: camps.length - 1 });
  // Resample at even spacing along the ground.
  const points = [];
  let carry = 0, previous = null;
  for (const p of raw) {
    const y = terrain.height(p.x, p.z) + .035;
    const current = [p.x, y, p.z, p.segment];
    if (!previous) { points.push(current); previous = current; continue; }
    const d = Math.hypot(current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]);
    carry += d;
    while (carry >= spacing) {
      carry -= spacing;
      const t = 1 - carry / d;
      const x = lerp(previous[0], current[0], t), z = lerp(previous[2], current[2], t);
      points.push([x, terrain.height(x, z) + .035, z, lerp(previous[3], current[3], t)]);
    }
    previous = current;
  }
  return points;
}
const wrapPositive = a => { a = wrapAngle(a); return a < 0 ? a + TAU : a; };

const COLORS = Object.fromEntries(Object.entries({
  snow: '#eef2f8', snowShade: '#dfe5ef', patchy: '#aeb5c2', rockHigh: '#76736f', rockMid: '#67615f', rockWarm: '#75695d',
  rockLow: '#4c4b52', scree: '#857f7a', tundra: '#7b7a58', meadow: '#5b7a43', meadowDry: '#7f8150', forest: '#2e4a35', moss: '#3f5c3c'
}).map(([name, hex]) => [name, hexToLinear(hex)]));

export const QUALITY = {
  high: { cell: .19, growth: 1.075, trees: 4200, shadow: 2048, samples: 4, snow: 1800, clouds: 260, dpr: 1.5 },
  low: { cell: .27, growth: 1.1, trees: 1600, shadow: 1024, samples: 0, snow: 700, clouds: 140, dpr: 1.5 }
};

// Builds non-indexed triangles so every facet carries its own colour; alpha holds ambient occlusion.
export function buildTerrainMesh(terrain, quality, seed = 3) {
  const next = random(seed);
  const half = [];
  let x = 0;
  for (; x < 15.5; x += quality.cell) half.push(x);
  let cell = quality.cell;
  while (x < 190) { cell *= quality.growth; x += cell; half.push(x); }
  const axis = [...half.slice(1).reverse().map(v => -v), ...half];
  const n = axis.length;
  const px = new Float32Array(n * n), pz = new Float32Array(n * n), py = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
    const sx = edge ? 0 : (axis[i + 1] - axis[i - 1]) * .5, sz = edge ? 0 : (axis[j + 1] - axis[j - 1]) * .5;
    px[k] = axis[i] + (next() - .5) * .62 * sx;
    pz[k] = axis[j] + (next() - .5) * .62 * sz;
    py[k] = terrain.height(px[k], pz[k]);
  }
  // Cavity term from the height grid at several scales: creases darken, crests stay bright.
  const ao = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    let cavity = 0;
    for (const s of [1, 3, 7]) {
      const i0 = Math.max(0, i - s), i1 = Math.min(n - 1, i + s), j0 = Math.max(0, j - s), j1 = Math.min(n - 1, j + s);
      const mean = (py[j * n + i0] + py[j * n + i1] + py[j0 * n + i] + py[j1 * n + i]) / 4;
      const span = Math.max(.05, (axis[i1] - axis[i0] + axis[j1] - axis[j0]) / 4);
      cavity += clamp((mean - py[k]) / span, -1, 1) / s ** .35;
    }
    ao[k] = clamp(1 - cavity * .55, .5, 1.12);
  }
  // Materials follow a smoothed slope so snowfields and rock bands read as areas, not speckles.
  const smooth = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 2), i1 = Math.min(n - 1, i + 2), j0 = Math.max(0, j - 2), j1 = Math.min(n - 1, j + 2);
    const gx = (py[j * n + i1] - py[j * n + i0]) / (px[j * n + i1] - px[j * n + i0]);
    const gz = (py[j1 * n + i] - py[j0 * n + i]) / (pz[j1 * n + i] - pz[j0 * n + i]);
    const l = Math.hypot(1, gx, gz);
    smooth.set([-gx / l, 1 / l, -gz / l], (j * n + i) * 3);
  }
  const triangles = (n - 1) * (n - 1) * 2;
  const positions = new Float32Array(triangles * 9), colors = new Uint8Array(triangles * 12);
  let t = 0;
  const face = (a, b, c) => {
    const ax = px[a], ay = py[a], az = pz[a], bx = px[b], by = py[b], bz = pz[b], cx = px[c], cy = py[c], cz = pz[c];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nx /= length; ny /= length; nz /= length;
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    const sm = i => (smooth[a * 3 + i] + smooth[b * 3 + i] + smooth[c * 3 + i]) / 3;
    const color = surfaceColor(mx, my, mz, lerp(sm(0), nx, .25), lerp(sm(1), ny, .25), lerp(sm(2), nz, .25), next());
    const occlusion = (ao[a] + ao[b] + ao[c]) / 3;
    positions.set([ax, ay, az, bx, by, bz, cx, cy, cz], t * 9);
    for (let v = 0; v < 3; v++) colors.set([toByte(color[0]), toByte(color[1]), toByte(color[2]), Math.round(occlusion / 1.12 * 255)], t * 12 + v * 4);
    t++;
  };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if (next() < .5) { face(a, c, b); face(b, c, d); } else { face(a, c, d); face(a, d, b); }
  }
  return { positions, colors, count: triangles * 3, grid: { n, px, py, pz } };
}
const toByte = v => Math.round(clamp(Math.sqrt(v), 0, 1) * 255);

// Shared by the ground colours and the tree scatter so forests sit on forest floor.
const MOTTLE = noise2(23), PATCHES = noise2(24);
const treeLineAt = (x, z) => 2.5 + fbm(MOTTLE, x * .22, z * .22, 3) * .7;
const forestAt = (x, z) => smoothstep(-.1, .25, fbm(PATCHES, x * .16, z * .16, 3));

function surfaceColor(x, y, z, nx, ny, nz, jitter) {
  const m = fbm(MOTTLE, x * .22, z * .22, 3), local = MOTTLE(x * 1.9 + 40, z * 1.9), drift = MOTTLE(x * .6 - 13, z * .6);
  const north = -nz * .5 + nx * .25;
  // Far ranges keep snow only on their crests so they recede instead of glaring.
  const snowLine = 5.1 + m * 1.1 - north * 1.1 + smoothstep(60, 120, Math.hypot(x, z)) * 9;
  const treeLine = 2.5 + m * .7;
  let color;
  const snowiness = smoothstep(snowLine - .6, snowLine + .4, y + drift * .6) * smoothstep(.46, .66, ny + (y - snowLine) * .03 + drift * .05);
  if (snowiness > .5) color = mixColor(COLORS.snow, COLORS.snowShade, clamp(.5 - local, 0, 1));
  else if (snowiness > .42) color = COLORS.patchy;
  else if (ny < .64 || (y > treeLine + .9 && ny < .8)) {
    const band = Math.floor(y * 1.55 + m * 2.2 + x * .07 - z * .05);
    const tone = [COLORS.rockMid, COLORS.rockHigh, COLORS.rockWarm][((band % 3) + 3) % 3];
    color = mixColor(COLORS.rockLow, tone, smoothstep(.5, 4.5, y));
  } else if (y > treeLine) color = ny > .86 ? mixColor(COLORS.tundra, COLORS.meadowDry, clamp(local + .5, 0, 1)) : COLORS.scree;
  else {
    const forest = forestAt(x, z);
    color = mixColor(mixColor(COLORS.meadow, COLORS.meadowDry, clamp(local * .8 + .3, 0, 1)), ny > .8 ? COLORS.forest : COLORS.moss, forest);
  }
  const v = .9 + jitter * .2;
  return [color[0] * v, color[1] * v, color[2] * v];
}
const mixColor = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Pines on gentle ground below the treeline, clustered like the forest floor beneath them.
export function scatterTrees(terrain, camps, quality, seed = 9) {
  const next = random(seed), out = [];
  let attempts = 0;
  while (out.length < quality.trees * 6 && attempts++ < quality.trees * 40) {
    const x = (next() - .5) * 52, z = (next() - .5) * 52;
    if (Math.hypot(x, z) > 26) continue;
    const y = terrain.height(x, z), treeLine = treeLineAt(x, z);
    if (y > treeLine - .15 || y < .05 || terrain.slope(x, z) > .6) continue;
    if (next() > forestAt(x, z) ** 1.5 * .95 + .012) continue;
    if (camps.some(camp => Math.hypot(camp.x - x, camp.z - z) < 1.1)) continue;
    const size = .17 + next() * .17 + (1 - smoothstep(0, treeLine, y)) * .06;
    out.push(x, y - .02, z, size, next() * TAU, next());
  }
  return new Float32Array(out);
}

// Cloud puffs gathered into banks: low cloud around the foot of the massif and a few wisps higher up.
// Stride 5: x, y, z, size, seed.
export function scatterClouds(terrain, quality, seed = 17) {
  const next = random(seed), out = [], banks = [];
  for (let i = 0; i < 24; i++) banks.push({ angle: next() * TAU, r: 9 + next() * 24, spread: 1.6 + next() * 2.6 });
  for (let i = 0; i < 7; i++) banks.push({ angle: next() * TAU, r: 8.5 + next() * 5, spread: 1.1 + next(), y: 5 + next() * 2.5 });
  const per = Math.ceil(quality.clouds / banks.length);
  for (const bank of banks) {
    const cx = Math.cos(bank.angle) * bank.r, cz = Math.sin(bank.angle) * bank.r;
    for (let k = 0; k < per; k++) {
      const x = cx + (next() - .5) * bank.spread * 2, z = cz + (next() - .5) * bank.spread * 2;
      const ground = terrain.height(x, z);
      const y = bank.y ? bank.y + (next() - .5) * .6 : Math.max(ground + .45, 1.05) + next() * .6;
      if (bank.y && ground > y - .5) continue;
      out.push(x, y, z, (bank.y ? .65 : 1) + next() * 1.2, next());
    }
  }
  return new Float32Array(out);
}
