import { TAU, clamp, lerp, smoothstep, noise2, fbm, ridged, random, hexToLinear } from './math.js';

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
// Distant summits, each with its own height, width and shape, so the horizon reads as separate
// mountains rather than one repeating fence. Placed by bearing and distance from the massif, away from
// the diagonals, where the square rings of the mesh have their largest cells.
const FAR_PEAKS = [
  { angle: .35, d: 132, h: 28, r: 32, faces: [1, .8, 1.15, .9], rot: .2, pyramid: .65, profile: 1.2 },
  { angle: 1.25, d: 110, h: 15, r: 30, faces: [1, 1.2, .9], rot: 1.1, pyramid: .45, profile: 1.6 },
  { angle: 2.0, d: 142, h: 24, r: 30, faces: [.9, 1.1, 1, 1.05], rot: .7, pyramid: .6, profile: 1.3 },
  { angle: 3.05, d: 102, h: 11, r: 26, faces: [1, .9, 1.1, 1, .95], rot: 2.2, pyramid: .35, profile: 1.8 },
  { angle: 3.62, d: 146, h: 32, r: 36, faces: [1.15, .85, 1, .95], rot: 1.6, pyramid: .7, profile: 1.15 },
  { angle: 3.36, d: 128, h: 23, r: 22, faces: [1, 1.1, .9], rot: .9, pyramid: .7, profile: 1.2 },
  { angle: 4.8, d: 116, h: 19, r: 27, faces: [1, 1.1, .85], rot: .4, pyramid: .55, profile: 1.4 },
  { angle: 5.85, d: 148, h: 22, r: 30, faces: [.95, 1.05, 1.1, .9], rot: 2.7, pyramid: .6, profile: 1.25 }
].map(peak => ({ ...peak, x: Math.cos(peak.angle) * peak.d, z: Math.sin(peak.angle) * peak.d }));
for (const peak of [...PEAKS, ...FAR_PEAKS]) peak.normals = peak.faces.map((weight, i) => {
  const a = peak.rot + i * TAU / peak.faces.length;
  return [Math.cos(a) * weight / Math.cos(Math.PI / peak.faces.length), Math.sin(a) * weight / Math.cos(Math.PI / peak.faces.length)];
});
function peakHeight(peak, x, z) {
  const qx = x - peak.x, qz = z - peak.z;
  let faceted = -1e9;
  for (const n of peak.normals) faceted = Math.max(faceted, qx * n[0] + qz * n[1]);
  const d = lerp(Math.hypot(qx, qz), faceted, peak.pyramid) / peak.r;
  return peak.h * Math.pow(Math.max(0, 1 - d), peak.profile);
}
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * .25; };

export function createTerrain(seed = 11) {
  const warpX = noise2(seed), warpZ = noise2(seed + 1), ground = noise2(seed + 2), detail = noise2(seed + 3);
  const spurs = noise2(seed + 4), ranges = noise2(seed + 5), strata = noise2(seed + 6);
  let ledges = [];

  function base(x, z) {
    const r = Math.hypot(x, z);
    const wx = x + fbm(warpX, x * .085, z * .085, 3) * 1.7, wz = z + fbm(warpZ, x * .085 + 4.1, z * .085, 3) * 1.7;
    let massif = -10;
    for (const peak of PEAKS) massif = smax(massif, peakHeight(peak, wx, wz), 1.4);
    const plain = .45 + fbm(ground, x * .03, z * .03, 4) * 1.15 + (fbm(ground, x * .075 + 9, z * .075, 3) * .9 + .25) * smoothstep(7, 16, r) * (1 - smoothstep(40, 70, r) * .5);
    let h = smax(plain, massif, 1.1);
    const lift = Math.max(0, h - plain);
    const e = smoothstep(.4, 10, h);
    if (lift > .01) {
      // Radial spurs and gullies running down the fall line; the seam behind the peak is cross-faded.
      const a = Math.atan2(z, x), w = smoothstep(Math.PI - .7, Math.PI, a);
      const spur = s => ridged(spurs, s * 2.7, r * .22, 4);
      const radial = lerp(spur(a), spur(a - TAU), w);
      // Spurs converge on the summit axis; fade them there or they leave a needle thinner than a mesh cell.
      h += (radial - .42) * smoothstep(.2, 2.2, lift) * smoothstep(.5, 2.4, r) * (.6 + 1.25 * e * (1 - .45 * e));
      h += (ridged(detail, wx * .26, wz * .26, 4) - .45) * smoothstep(.1, 1.6, lift) * (.15 + .8 * e);
      // Faint strata: stepped cliffs in the upper rock.
      const band = h / .62 + strata(x * .2, z * .2) * .8, f = band - Math.floor(band);
      h += (Math.floor(band) + smoothstep(.25, .75, f) - band) * .62 * .22 * smoothstep(3, 6.5, h);
    }
    // Far ranges: a ridged ring that swells, sinks and moves nearer or farther around the horizon,
    // broken up by the distant summits. Kept low enough in view that the hero peak always dominates.
    if (r > 40) {
      const ca = x / r, sa = z / r;
      const inner = 78 + fbm(ranges, ca * 1.3 + 3, sa * 1.3 + 3, 2) * 30;
      const ring = smoothstep(inner, inner + 45, r);
      if (ring > 0) {
        const swell = smoothstep(-.35, .35, fbm(ranges, ca * 1.7 + 11, sa * 1.7 + 11, 2));
        let far = Math.max(0, ridged(ranges, x * .013, z * .013, 3) * lerp(6, 20, swell) - lerp(4, 7, swell));
        // Face weights are at least .8, so nothing beyond 1.4 radii of a peak can be part of it.
        for (const peak of FAR_PEAKS) if (Math.hypot(x - peak.x, z - peak.z) < peak.r * 1.4) far = smax(far, peakHeight(peak, x, z), 7);
        // Out here a mesh cell is about four units wide; anything finer than a few cells would alias into spikes.
        far += (ridged(detail, x * .03, z * .03, 2) - .45) * 1.8 * smoothstep(3, 14, far);
        h += ring * Math.max(0, far) * (1 - smoothstep(160, 188, r) * .6);
      }
    }
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

// Height of the drawn surface. The facets cut straight across ridges that the analytic height rounds
// over, so anything resting on the ground samples this instead, or it would float above the crests.
export function meshSurface(mesh, terrain, extent = 26, cell = .5) {
  const { positions } = mesh, size = Math.ceil(2 * extent / cell), triangles = mesh.count / 3;
  const slot = v => Math.floor((v + extent) / cell);
  // Buckets of triangle indices per grid cell, packed as offsets into one list.
  const bounds = t => {
    const o = t * 9;
    return [slot(Math.min(positions[o], positions[o + 3], positions[o + 6])), slot(Math.max(positions[o], positions[o + 3], positions[o + 6])),
      slot(Math.min(positions[o + 2], positions[o + 5], positions[o + 8])), slot(Math.max(positions[o + 2], positions[o + 5], positions[o + 8]))];
  };
  const start = new Uint32Array(size * size + 1);
  const visit = callback => {
    for (let t = 0; t < triangles; t++) {
      const [i0, i1, j0, j1] = bounds(t);
      if (i1 < 0 || j1 < 0 || i0 >= size || j0 >= size) continue;
      for (let j = Math.max(0, j0); j <= Math.min(size - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(size - 1, i1); i++) callback(j * size + i, t);
    }
  };
  visit(k => start[k + 1]++);
  for (let k = 0; k < size * size; k++) start[k + 1] += start[k];
  const fill = start.slice(0, -1), list = new Uint32Array(start[size * size]);
  visit((k, t) => { list[fill[k]++] = t; });
  return (x, z) => {
    const i = slot(x), j = slot(z);
    if (i >= 0 && j >= 0 && i < size && j < size) for (let k = start[j * size + i]; k < start[j * size + i + 1]; k++) {
      const o = list[k] * 9;
      const ax = positions[o], az = positions[o + 2], bx = positions[o + 3], bz = positions[o + 5], cx = positions[o + 6], cz = positions[o + 8];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * positions[o + 1] + l2 * positions[o + 4] + l3 * positions[o + 7];
    }
    return terrain.height(x, z);
  };
}

// The trail is the cheapest walk over the drawn surface from camp to camp. Steep grades cost far more
// than distance, so it follows contours and switchbacks up steep ground instead of taking the fall line.
export function buildTrail(camps, surface, spacing = .11) {
  const step = .15, extent = 14, n = Math.round(2 * extent / step) + 1, coord = i => -extent + i * step;
  const ground = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ground[j * n + i] = surface(coord(i), coord(j));
  // Cliffs cost extra even when the path runs level across them.
  const rough = new Float32Array(n * n).fill(1);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const k = j * n + i, s = Math.hypot(ground[k + 1] - ground[k - 1], ground[k + n] - ground[k - n]) / (2 * step);
    rough[k] = 1 + .5 * Math.max(0, s - 1) ** 2;
  }
  const MOVES = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]]
    .map(([di, dj]) => ({ di, dj, d: Math.hypot(di, dj) * step }));
  const nodeAt = p => Math.round((p.z + extent) / step) * n + Math.round((p.x + extent) / step);
  // Multiplies the cost of every cell within radius of a point; used to keep legs apart and off other camps.
  const stamp = (field, x, z, radius, factor) => {
    const reach = Math.ceil(radius / step), ci = Math.round((x + extent) / step), cj = Math.round((z + extent) / step);
    for (let j = Math.max(0, cj - reach); j <= Math.min(n - 1, cj + reach); j++) for (let i = Math.max(0, ci - reach); i <= Math.min(n - 1, ci + reach); i++)
      if (Math.hypot(coord(i) - x, coord(j) - z) < radius) field[j * n + i] = Math.max(field[j * n + i], factor);
  };
  const walked = new Float32Array(n * n).fill(1), cost = new Float32Array(n * n), from = new Int32Array(n * n);

  function search(start, goal, penalty) {
    cost.fill(Infinity); from.fill(-1);
    const gi = goal % n, gj = (goal - gi) / n;
    const guess = k => Math.hypot(k % n - gi, Math.floor(k / n) - gj) * step;
    const heap = [];
    const push = (k, f) => {
      heap.push([f, k]);
      for (let c = heap.length - 1; c > 0;) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let c = 0; ;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
        }
      }
      return top;
    };
    cost[start] = 0;
    push(start, guess(start));
    while (heap.length) {
      const [f, k] = pop();
      if (k === goal) break;
      if (f - guess(k) > cost[k] + 1e-6) continue;
      const i = k % n, j = (k - i) / n;
      for (const move of MOVES) {
        const ii = i + move.di, jj = j + move.dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const q = jj * n + ii, rise = ground[q] - ground[k], grade = Math.abs(rise) / move.d;
        const c = cost[k] + move.d * (1 + 16 * Math.max(0, grade - .3) ** 2 + (rise < 0 ? .5 * grade : 0)) * rough[q] * penalty[q];
        if (c < cost[q]) { cost[q] = c; from[q] = k; push(q, c + guess(q)); }
      }
    }
    const path = [];
    for (let k = goal; k >= 0; k = from[k]) path.push(k);
    return path.reverse();
  }

  const points = [];
  for (let leg = 0; leg < camps.length - 1; leg++) {
    const a = camps[leg], b = camps[leg + 1];
    const penalty = walked.slice();
    camps.forEach((camp, i) => { if (i !== leg && i !== leg + 1) stamp(penalty, camp.x, camp.z, .7, 12); });
    const nodes = search(nodeAt(a), nodeAt(b), penalty);
    let line = [[a.x, a.z], ...nodes.slice(1, -1).map(k => [coord(k % n), coord(Math.floor(k / n))]), [b.x, b.z]];
    for (let pass = 0; pass < 3; pass++) line = chaikin(line);
    // Resample at even spacing measured along the ground.
    const ground3 = line.map(([x, z]) => [x, surface(x, z), z]);
    const lengths = [0];
    for (let i = 1; i < ground3.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...[0, 1, 2].map(c => ground3[i][c] - ground3[i - 1][c])));
    const total = lengths.at(-1), count = Math.max(1, Math.round(total / spacing));
    for (let s = leg ? 1 : 0, i = 0; s <= count; s++) {
      const target = s / count * total;
      while (i < lengths.length - 2 && lengths[i + 1] < target) i++;
      const t = (target - lengths[i]) / (lengths[i + 1] - lengths[i] || 1);
      const x = lerp(line[i][0], line[i + 1][0], t), z = lerp(line[i][1], line[i + 1][1], t);
      points.push([x, surface(x, z) + .035, z, leg + s / count]);
    }
    for (const [x, z] of line) stamp(walked, x, z, .45, 4);
  }
  return points;
}
// Corner cutting: each pass replaces every segment by its quarter points, keeping the ends.
function chaikin(line) {
  const out = [line[0]];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    out.push([ax * .75 + bx * .25, az * .75 + bz * .25], [ax * .25 + bx * .75, az * .25 + bz * .75]);
  }
  out.push(line.at(-1));
  return out;
}

const COLORS = Object.fromEntries(Object.entries({
  snow: '#eef2f8', snowShade: '#dfe5ef', patchy: '#aeb5c2', rockHigh: '#76736f', rockMid: '#67615f', rockWarm: '#75695d',
  rockLow: '#4c4b52', scree: '#857f7a', tundra: '#7b7a58', meadow: '#5b7a43', meadowDry: '#7f8150', forest: '#2e4a35', moss: '#3f5c3c'
}).map(([name, hex]) => [name, hexToLinear(hex)]));

export const QUALITY = {
  high: { cell: .19, trees: 4200, shadow: 2048, samples: 4, snow: 1800, clouds: 260, dpr: 1.5 },
  low: { cell: .27, trees: 1600, shadow: 1024, samples: 0, snow: 700, clouds: 140, dpr: 1.5 }
};

// Builds non-indexed triangles so every facet carries its own colour; alpha holds ambient occlusion.
export function buildTerrainMesh(terrain, quality, seed = 3) {
  const next = random(seed);
  // Grid in rings: uniform cells over the massif, then every ring of cells grows by the same factor
  // in both directions out to the horizon, so far triangles stay roughly square instead of slivers.
  const L = 15.5, extent = 190, stretch = 2.6;
  const m = Math.round(L / quality.cell), s0 = 1 / (1 + Math.log(extent / L) / stretch), M = Math.round(m / s0), n = 2 * M + 1;
  const tau = s0 / stretch;
  const radius = s => s <= s0 ? s * L / s0 : L * Math.exp((s - s0) / tau);
  const px = new Float32Array(n * n), pz = new Float32Array(n * n), py = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, qx = (i - M) / M, qz = (j - M) / M, s = Math.max(Math.abs(qx), Math.abs(qz));
    const scale = s > 0 ? radius(s) / s : L / s0;
    const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
    // Jitter breaks up the grid near the massif; far out the cells are large and the slopes steep, where it
    // would pull vertices up and down the flanks into spikes, so it fades away.
    const spacing = edge ? 0 : Math.min(scale, s <= s0 ? L / s0 : radius(s) / tau) / M * (1 - .8 * smoothstep(30, 90, radius(s)));
    px[k] = qx * scale + (next() - .5) * .62 * spacing;
    pz[k] = qz * scale + (next() - .5) * .62 * spacing;
    py[k] = terrain.height(px[k], pz[k]);
  }
  // Tangents along the two grid directions, spanning ±s vertices.
  const tangents = (i, j, s) => {
    const i0 = Math.max(0, i - s), i1 = Math.min(n - 1, i + s), j0 = Math.max(0, j - s), j1 = Math.min(n - 1, j + s);
    const a = j * n + i0, b = j * n + i1, c = j0 * n + i, d = j1 * n + i;
    return { u: [px[b] - px[a], py[b] - py[a], pz[b] - pz[a]], v: [px[d] - px[c], py[d] - py[c], pz[d] - pz[c]], mean: (py[a] + py[b] + py[c] + py[d]) / 4 };
  };
  // Cavity term from the height grid at several scales: creases darken, crests stay bright.
  const ao = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    let cavity = 0;
    for (const s of [1, 3, 7]) {
      const { u, v, mean } = tangents(i, j, s);
      const span = Math.max(.05, (Math.hypot(u[0], u[2]) + Math.hypot(v[0], v[2])) / 4);
      cavity += clamp((mean - py[k]) / span, -1, 1) / s ** .35;
    }
    ao[k] = clamp(1 - cavity * .55, .5, 1.12);
  }
  // Materials follow a smoothed slope so snowfields and rock bands read as areas, not speckles.
  const smooth = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const { u, v } = tangents(i, j, 2);
    let nx = v[1] * u[2] - v[2] * u[1], ny = v[2] * u[0] - v[0] * u[2], nz = v[0] * u[1] - v[1] * u[0];
    const l = (ny < 0 ? -1 : 1) * (Math.hypot(nx, ny, nz) || 1);
    smooth.set([nx / l, ny / l, nz / l], (j * n + i) * 3);
  }
  // Far out a facet is several units across, and one colour per facet turns the snow line into teeth.
  // There each vertex gets its own colour and the GPU blends them across the facet.
  const far = new Float32Array(n * n * 3).fill(-1);
  const vertexColor = k => {
    if (far[k * 3] < 0) far.set(surfaceColor(px[k], py[k], pz[k], smooth[k * 3], smooth[k * 3 + 1], smooth[k * 3 + 2], (Math.imul(k, 2654435761) >>> 0) / 4294967296), k * 3);
    return far.subarray(k * 3, k * 3 + 3);
  };
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
    const blend = mx * mx + mz * mz > 70 * 70;
    [a, b, c].forEach((k, v) => {
      const own = blend ? vertexColor(k) : color;
      colors.set([toByte(own[0]), toByte(own[1]), toByte(own[2]), Math.round(occlusion / 1.12 * 255)], t * 12 + v * 4);
    });
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
  const far = smoothstep(60, 120, Math.hypot(x, z));
  const snowLine = 5.1 + (m * 1.1 - north * 1.1) * (1 - far * .8) + far * 9;
  const treeLine = 2.5 + m * .7;
  let color;
  // Far cells span several cycles of the near-field noise, which would streak the snow facet by facet;
  // out there the snow edge wanders on a broad scale and clings to steeper ground.
  const wander = lerp(drift * .6, MOTTLE(x * .03 + 7, z * .03) * 3, far);
  const snowiness = smoothstep(snowLine - .6, snowLine + .4, y + wander) * smoothstep(lerp(.46, .2, far), lerp(.66, .36, far), ny + (y - snowLine) * .03 + drift * .05 * (1 - far));
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
export function scatterTrees(terrain, camps, quality, surface, seed = 9) {
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
    out.push(x, surface(x, z) - .02, z, size, next() * TAU, next());
  }
  return new Float32Array(out);
}

// Cloud puffs gathered into banks: low cloud around the foot of the massif and a few wisps higher up.
// Stride 5: x, y, z, size, seed.
export function scatterClouds(terrain, quality, seed = 17) {
  const next = random(seed), out = [], banks = [];
  for (let i = 0; i < 24; i++) banks.push({ angle: next() * TAU, r: 9 + next() * 24, spread: 1.6 + next() * 2.6 });
  for (let i = 0; i < 5; i++) banks.push({ angle: next() * TAU, r: 9 + next() * 5, spread: 1 + next() * .8, y: 5 + next() * 2.5 });
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

// Camps sit on the drawn surface; the summit flag goes on the highest point the mesh actually has,
// which can be a little off the analytic summit.
export function snapCamps(camps, mesh, surface) {
  const { n, px, py, pz } = mesh.grid, summit = camps.at(-1);
  let best = -1;
  for (let k = 0; k < n * n; k++) if (Math.hypot(px[k] - summit.x, pz[k] - summit.z) < 2 && (best < 0 || py[k] > py[best])) best = k;
  if (best >= 0) Object.assign(summit, { x: px[best], y: py[best], z: pz[best], r: Math.hypot(px[best], pz[best]) });
  for (const camp of camps) if (!camp.summit) camp.y = surface(camp.x, camp.z);
}
