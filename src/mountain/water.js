import { TAU, lerp, clamp, smoothstep, random } from './math.js';

// Water at the foot of the massif: snowmelt runs down a gully on the lower slopes, leaps off a cliff into a plunge pool,
// and leaves as a river that winds round the foot of the mountain and away across the plain to the horizon.
// The water is a function of position. createWater() gives the carving that terrain.height() applies, so any mesh that
// samples the height gets the gully, the cliff, the pool and the channel, plus a test for standing in water that keeps
// the trail and the trees out of it. buildWater() makes the meshes that water-renderer.js draws.

// Control points as [bearing in radians from +x towards +z, distance from the summit axis]. The fall and its pool are in
// the quarter the trail never visits (it leaves the trailhead the other way round the mountain); the river passes just in
// front of the trailhead, then keeps outside the trail's first leg as it winds round the foot and away to the horizon.
const STREAM = [[1.68, 4], [1.645, 4.5], [1.615, 5], [1.602, 5.42], [1.6, 5.8]];
const POOL = { bearing: 1.6, r: 7.2, radius: .75, level: 1, depth: .42 };
const RIVER = [[1.62, 8.75], [1.74, 9.35], [1.9, 9.45], [2.05, 9.6], [2.2, 10.05], [2.36, 10.85], [2.53, 11.4], [2.73, 11.6], [2.95, 12.2], [3.16, 13.4],
  [3.29, 15.6], [3.26, 19], [3.08, 23.5], [2.88, 31], [2.68, 44], [2.57, 62], [2.52, 90], [2.5, 130], [2.5, 180], [2.5, 240]];
const NONE = 1e3;
const polar = ([a, r]) => [Math.cos(a) * r, Math.sin(a) * r];

// A channel's cross-section: a rounded bed below the water line out to the half-width, then a short steep bank and a
// gentler valley side (step, slope) that only matters where the plain stands well above the water.
const profile = (d, w, hw, depth, bank, step, slope) => {
  if (d < hw) { const u = d / hw; return w - depth * (1 - u * u); }
  const e = d - hw;
  return w + Math.min(bank * e, step + slope * e);
};

// Centripetal Catmull-Rom through the points, then resampled along its length at a spacing that grows with distance from
// the massif, like the terrain's own cells.
function trace(points, spacing) {
  const ends = [[2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]], [2 * points.at(-1)[0] - points.at(-2)[0], 2 * points.at(-1)[1] - points.at(-2)[1]]];
  const all = [ends[0], ...points, ends[1]], dense = [];
  for (let i = 1; i < all.length - 2; i++) {
    const [p0, p1, p2, p3] = all.slice(i - 1, i + 3);
    const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const steps = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / .05));
    for (let k = i > 1 ? 1 : 0; k <= steps; k++) {
      const t = t1 + (t2 - t1) * k / steps;
      const mix = (a, b, ta, tb) => [0, 1].map(c => (a[c] * (tb - t) + b[c] * (t - ta)) / (tb - ta));
      const a1 = mix(p0, p1, 0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
      const b1 = mix(a1, a2, 0, t2), b2 = mix(a2, a3, t1, t3);
      dense.push(mix(b1, b2, t1, t2));
    }
  }
  const lengths = [0];
  for (let i = 1; i < dense.length; i++) lengths.push(lengths[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const nodes = [];
  for (let s = 0, i = 0; ;) {
    while (i < dense.length - 2 && lengths[i + 1] < s) i++;
    const t = clamp((s - lengths[i]) / (lengths[i + 1] - lengths[i] || 1), 0, 1);
    const x = lerp(dense[i][0], dense[i + 1][0], t), z = lerp(dense[i][1], dense[i + 1][1], t);
    nodes.push({ x, z, s });
    if (s >= lengths.at(-1)) break;
    s = Math.min(lengths.at(-1), s + spacing(Math.hypot(x, z)));
  }
  return nodes;
}
// Unit tangents from the neighbours.
function orient(nodes) {
  nodes.forEach((node, i) => {
    const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(nodes.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    node.tx = (b.x - a.x) / l; node.tz = (b.z - a.z) / l;
  });
}

// ground: the terrain's height before any water, which the levels are fitted under.
export function createWater(ground) {
  const pool = { ...POOL, x: polar([POOL.bearing, POOL.r])[0], z: polar([POOL.bearing, POOL.r])[1] };

  // The stream runs in a shallow gully that deepens on the way down; its surface follows the slope.
  const stream = trace(STREAM.map(polar), () => .16);
  orient(stream);
  const length = stream.at(-1).s;
  let level = Infinity;
  for (const node of stream) {
    const t = node.s / length;
    level = Math.min(level - .002, ground(node.x, node.z) - lerp(.03, .2, t));
    Object.assign(node, { w: level, hw: lerp(.07, .13, t), depth: .1, bank: 1.4, step: NONE, slope: 0, deep: NONE, wide: 1.5 });
  }
  // The lip of the fall is the end of the stream. The pool's wall rises from the water's edge steeply enough to meet the
  // stream bed there, so the cliff is exactly as tall as the drop.
  const lip = stream.at(-1), lipDistance = Math.hypot(lip.x - pool.x, lip.z - pool.z);
  pool.wall = Math.max(1.5, (lip.w - lip.depth - pool.level) / (lipDistance - pool.radius));
  pool.reach = pool.radius + 3.2;
  // The cliffs round the pool are a rough amphitheatre rather than a turned bowl: the rim wanders in and out and the walls
  // steepen and ease by bearing. Straight under the lip they are exactly as computed, so the cliff still meets the stream.
  const lipBearing = Math.atan2(lip.z - pool.z, lip.x - pool.x);
  pool.edge = theta => {
    const gap = Math.abs(((theta - lipBearing) % TAU + TAU * 1.5) % TAU - Math.PI), k = smoothstep(.35, 1.1, gap);
    return {
      r: pool.radius * (1 + k * (.13 * Math.sin(3 * theta + 1.3) + .08 * Math.sin(5 * theta + .4) + .05 * Math.sin(8 * theta + 2.1))),
      wall: pool.wall * (1 + k * .24 * Math.sin(4 * theta + .7))
    };
  };
  const out = [(pool.x - lip.x) / lipDistance, (pool.z - lip.z) / lipDistance];
  // Where the falling water meets the pool, a little short of the centre.
  pool.foot = [pool.x - out[0] * pool.radius * .3, pool.level, pool.z - out[1] * pool.radius * .3];

  // The river begins as a row of sections across the pool (so the pool's surface is part of the same mesh), then follows
  // its spline out of the pool's mouth. Its level only ever falls, and is fitted under the lowest ground it crosses.
  const rim = [pool.x + out[0] * pool.radius, pool.z + out[1] * pool.radius];
  const river = [-.93, -.62, -.3, 0, .33, .66].map(u => ({ x: pool.x + out[0] * u * pool.radius, z: pool.z + out[1] * u * pool.radius, hw: Math.max(.26, pool.radius * Math.sqrt(1 - u * u)) }));
  const head = river.length;
  river.push(...trace([rim, ...RIVER.map(polar)], r => clamp(r * .028, .16, 6)));
  orient(river);
  river.forEach((node, i) => { node.s = i ? river[i - 1].s + Math.hypot(node.x - river[i - 1].x, node.z - river[i - 1].z) : 0; });
  const mouth = river[head].s;
  river.forEach((node, i) => {
    const r = Math.hypot(node.x, node.z), after = Math.max(0, node.s - mouth);
    if (i < head) { Object.assign(node, { w: pool.level, depth: pool.depth, bank: pool.wall, step: NONE, slope: 0, deep: NONE, wide: 2 }); return; }
    const hw = .16 + .034 * r, near = smoothstep(.4, 2.2, after);
    let low = Infinity;
    for (const o of [-1.6, -.8, 0, .8, 1.6]) low = Math.min(low, ground(node.x - node.tz * o * hw, node.z + node.tx * o * hw));
    // A short run of rapids out of the pool's mouth, then the plain. Out on the plain the river lies in a broad, shallow
    // hollow (wide), so low views still see the water over the near bank; by the mountain, where it passes just in front of
    // the trailhead, its banks stay tight so the camp's ground is untouched. The hollow only reshapes ground lying within
    // about deep of the water, so it leaves the mountain's foot alone; out in the far ranges it opens a gorge through them.
    const w = Math.min(river[i - 1].w - .0025 * (node.s - river[i - 1].s), low - .1, pool.level - .015 - .1 * smoothstep(0, 1.3, after));
    const far = smoothstep(60, 100, r);
    Object.assign(node, { w, hw, depth: .13 + .12 * hw, bank: 2.5, step: lerp(.6, .03, near), slope: lerp(4, lerp(.07, .6, far), near), deep: lerp(lerp(2.5, .5, near), 30, far), wide: lerp(lerp(.4, 1.5, smoothstep(11, 16, r)), 14, far) });
  });
  for (const nodes of [stream, river]) nodes.forEach((node, i) => {
    const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(nodes.length - 1, i + 1)];
    node.speed = Math.max(0, (a.w - b.w) / Math.max(1e-3, b.s - a.s));
    // How far out the carving can still reach: where the valley side climbs above the ground on both banks, or its width.
    let reach = node.hw + .5;
    for (const e of [.25, .5, 1, 1.5, 2, 3, 4, 6, 8, 11, 14].filter(e => e <= node.wide)) {
      const d = node.hw + e, bed = profile(d, node.w, node.hw, node.depth, node.bank, node.step, node.slope);
      reach = d + .8;
      if (ground(node.x - node.tz * d, node.z + node.tx * d) < bed && ground(node.x + node.tz * d, node.z - node.tx * d) < bed) break;
    }
    node.reach = reach;
  });

  // Every segment of both courses, bucketed on a coarse grid so a height sample only looks at the few nearby.
  const nodes = [...stream, ...river], last = new Set([stream.length - 1, nodes.length - 1]);
  const field = name => Float32Array.from(nodes, node => node[name]);
  const X = field('x'), Z = field('z'), W = field('w'), HW = field('hw'), DEPTH = field('depth'), BANK = field('bank'), STEP = field('step'), SLOPE = field('slope'), REACH = field('reach'), DEEP = field('deep');
  const segments = nodes.map((_, i) => i).filter(i => !last.has(i));
  const CELL = 2, HALF = 250, SIZE = 2 * HALF / CELL, slot = v => Math.floor((v + HALF) / CELL);
  const start = new Uint32Array(SIZE * SIZE + 1);
  const visit = callback => {
    for (const j of segments) {
      const reach = Math.max(REACH[j], REACH[j + 1]);
      const i0 = slot(Math.min(X[j], X[j + 1]) - reach), i1 = slot(Math.max(X[j], X[j + 1]) + reach);
      const k0 = slot(Math.min(Z[j], Z[j + 1]) - reach), k1 = slot(Math.max(Z[j], Z[j + 1]) + reach);
      for (let k = Math.max(0, k0); k <= Math.min(SIZE - 1, k1); k++) for (let i = Math.max(0, i0); i <= Math.min(SIZE - 1, i1); i++) callback(k * SIZE + i, j);
    }
  };
  visit(cell => start[cell + 1]++);
  for (let k = 0; k < SIZE * SIZE; k++) start[k + 1] += start[k];
  const fill = start.slice(0, -1), list = new Uint32Array(start[SIZE * SIZE]);
  visit((cell, j) => { list[fill[cell]++] = j; });

  // The first and end index into list of the segments near (x, z); both 0 off the grid.
  const bucket = (x, z) => {
    const i = slot(x), k = slot(z);
    return i < 0 || k < 0 || i >= SIZE || k >= SIZE ? 0 : k * SIZE + i;
  };

  // The terrain height h at (x, z) with the water's courses cut into it. It only ever lowers the ground; each cut fades out
  // over its last stretch so it never leaves a step where it ends, and beside the channel the river's hollow eases off on
  // ground standing more than about its node's deep above the water. Runs for every height sample, so it is kept lean.
  function carve(x, z, h) {
    let out = h;
    const p = Math.hypot(x - pool.x, z - pool.z);
    if (p < pool.reach) {
      const { r, wall } = pool.edge(Math.atan2(z - pool.z, x - pool.x));
      const floor = p < r ? pool.level - pool.depth * (1 - (p / r) ** 2) : pool.level + wall * (p - r);
      out = Math.min(out, floor + 40 * (1 - smoothstep(pool.reach, pool.reach - .8, p)) ** 2);
    }
    const cell = bucket(x, z);
    for (let n = start[cell], end = cell ? start[cell + 1] : 0; n < end; n++) {
      const j = list[n], ax = X[j], az = Z[j], dx = X[j + 1] - ax, dz = Z[j + 1] - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1), u = 1 - t;
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z), reach = REACH[j] * u + REACH[j + 1] * t;
      if (d >= reach) continue;
      const w = W[j] * u + W[j + 1] * t, hw = HW[j] * u + HW[j + 1] * t;
      const floor = profile(d, w, hw, DEPTH[j] * u + DEPTH[j + 1] * t, BANK[j] * u + BANK[j + 1] * t, STEP[j] * u + STEP[j + 1] * t, SLOPE[j] * u + SLOPE[j + 1] * t);
      const cut = h - floor - 40 * (1 - smoothstep(reach, reach - .8, d)) ** 2;
      if (cut <= 0) continue;
      const deep = DEEP[j] * u + DEEP[j + 1] * t, keep = Math.max(1 - smoothstep(deep * .5, deep * 1.5, h - w), clamp((hw + .6 - d) * 3, 0, 1));
      out = Math.min(out, h - cut * keep);
    }
    return out;
  }

  // Whether (x, z) is in the water or within margin of its edge.
  function wet(x, z, margin = 0) {
    if (Math.hypot(x - pool.x, z - pool.z) < pool.edge(Math.atan2(z - pool.z, x - pool.x)).r + margin) return true;
    const cell = bucket(x, z);
    for (let n = start[cell], end = cell ? start[cell + 1] : 0; n < end; n++) {
      const j = list[n], ax = X[j], az = Z[j], dx = X[j + 1] - ax, dz = Z[j + 1] - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < HW[j] + (HW[j + 1] - HW[j]) * t + margin) return true;
    }
    return false;
  }

  return { carve, wet, pool, stream, river };
}

// Meshes for the renderer, built in the scene worker. surface: the drawn terrain's height, so each vertex knows how deep
// the water over it is (shallows, foam along the banks).
// The water is non-indexed triangles; all three corners of a facet carry the same facet record (along, across, depth,
// speed) so the shader can light and foam each facet as one flat piece. Positions carry their own depth in w.
export function buildWater(water, surface, quality, seed = 5) {
  const next = random(seed), positions = [], facets = [];
  // The stream tumbles: its corners are pushed up and down so the facets break into a cascade. It is narrower than the
  // coarse tier's terrain cells, which cannot follow its gully exactly, so it rides a little high (lift) to stay on top.
  const STREAM_LIFT = .08;
  const courses = [{ nodes: water.stream, across: 5, margin: () => .1, rough: .018, lift: STREAM_LIFT }, { nodes: water.river, across: 7, margin: node => Math.max(.2, node.hw * .45), rough: 0, lift: 0 }];
  for (const { nodes, across, margin, rough, lift } of courses) {
    const rows = nodes.map((node, i) => {
      const extent = node.hw + margin(node), nx = -node.tz, nz = node.tx;
      const spacing = (nodes[Math.min(nodes.length - 1, i + 1)].s - nodes[Math.max(0, i - 1)].s) / 2;
      return Array.from({ length: across }, (_, k) => {
        const inner = k > 0 && k < across - 1 && i > 0 && i < nodes.length - 1;
        const a = k / (across - 1) * 2 - 1 + (inner ? (next() - .5) * .6 / (across - 1) : 0), along = inner ? (next() - .5) * .5 * spacing : 0;
        const x = node.x + nx * a * extent + node.tx * along, z = node.z + nz * a * extent + node.tz * along;
        const y = node.w + lift + (inner ? (next() - .3) * rough : 0);
        return { p: [x, y, z, y - surface(x, z)], a, s: node.s, speed: node.speed };
      });
    });
    const facet = (a, b, c) => {
      positions.push(...a.p, ...b.p, ...c.p);
      const record = [(a.s + b.s + c.s) / 3, (a.a + b.a + c.a) / 3, (a.p[3] + b.p[3] + c.p[3]) / 3, (a.speed + b.speed + c.speed) / 3];
      facets.push(...record, ...record, ...record);
    };
    for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < across - 1; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
      if (next() < .5) { facet(a, c, b); facet(b, c, d); } else { facet(a, c, d); facet(a, d, b); }
    }
  }

  // The fall: one closed, faceted body of water from the lip to the pool. It leaves the lip level and drops on a parabola
  // (ahead ∝ √drop), widening and thickening as it falls. Each row is a cross-section square to the fall's path (level off
  // the lip, upright lower down): an oval that bulges forward and lies flatter behind, so from any side, above included, the
  // fall shows a face and a flank, never the edge of a card, and the top and bottom of the first, nearly level stretch stay a
  // real thickness apart. Corners are jittered so the facets break up like the rock around it. At the foot a ring of foam
  // facets stands up round the plunge. Non-indexed like the river: all three corners of a facet carry the same record,
  // stride 4: how far down (0 at the lip, 1 at the pool; 2 marks the foam ring), position across (−1 to 1), column, row.
  const { pool, stream } = water, lip = stream.at(-1);
  const toward = [pool.foot[0] - lip.x, pool.foot[2] - lip.z], throwLength = Math.hypot(...toward);
  const out = [toward[0] / throwLength, toward[1] / throwLength], side = [-out[1], out[0]], drop = lip.w - pool.level;
  const fallPositions = [], fallData = [];
  const ROWS = 18, ARC = 10, fallDrop = drop + STREAM_LIFT + .055;
  const width = g => lerp(.34, .68, g ** .8), thick = g => lerp(.045, .2, g);
  // The path in the vertical plane through the lip, as (ahead, height), and the unit normal to it that points forward
  // (up off the lip, out from the cliff lower down). The top starts a little upstream of the lip, under the end of the
  // stream, so the two meet without a seam; the bottom is a little under the pool's surface.
  const path = g => [throwLength * Math.sqrt(g) - .06 * (1 - g), lip.w + STREAM_LIFT + .005 - fallDrop * g];
  const front = g => { const da = throwLength / (2 * Math.sqrt(Math.max(g, 1e-4))) + .06, dy = -fallDrop, l = Math.hypot(da, dy); return [-dy / l, da / l]; };
  const grid = [];
  for (let j = 0; j <= ROWS; j++) {
    const f = j / ROWS, inner = j > 0 && j < ROWS;
    const ring = Array.from({ length: ARC }, (_, k) => {
      const theta = k / ARC * TAU - Math.PI / 2, bulge = inner ? 1 + (next() - .5) * .34 : 1, slip = inner ? (next() - .5) * .4 : 0;
      const g = clamp(f + slip / ROWS, 0, 1), [ahead, height] = path(g), [na, ny] = front(g);
      const depth = Math.cos(theta) * thick(g) * bulge * (Math.cos(theta) < 0 ? .35 : 1), across = Math.sin(theta) * width(g) / 2 * (inner ? 1 + (next() - .5) * .12 : 1);
      const a = ahead + na * depth;
      return [lip.x + out[0] * a + side[0] * across, height + ny * depth, lip.z + out[1] * a + side[1] * across];
    });
    grid.push([...ring, ring[0]]);
  }
  const facet = (a, b, c, record) => { fallPositions.push(...a, ...b, ...c); fallData.push(...record, ...record, ...record); };
  for (let j = 0; j < ROWS; j++) for (let k = 0; k < ARC; k++) {
    const a = grid[j][k], b = grid[j][k + 1], c = grid[j + 1][k], d = grid[j + 1][k + 1];
    // Across: −1 and 1 on the flanks, 0 down the middle of the face and of the back.
    const record = [(j + .5) / ROWS, Math.sin((k + .5) / ARC * TAU - Math.PI / 2), k, j];
    if ((j + k) % 2) { facet(a, c, b, record); facet(b, c, d, record); } else { facet(a, c, d, record); facet(a, d, b, record); }
  }
  // The foam ring: jagged peaks round the plunge, low on the outside, standing up where the water hits.
  const RING = 11, [fx, , fz] = pool.foot, base = pool.level - .02;
  const ring = Array.from({ length: RING }, (_, i) => {
    const angle = i / RING * Math.PI * 2 + (next() - .5) * .3, c = Math.cos(angle), sn = Math.sin(angle);
    const at = (r, y) => [fx + (side[0] * c * (width(1) / 2 + r) + out[0] * sn * (thick(1) + r * .8)), y, fz + (side[1] * c * (width(1) / 2 + r) + out[1] * sn * (thick(1) + r * .8))];
    return { inner: at(.01, pool.level + .05 + next() * .09), outer: at(.13 + next() * .12, base) };
  });
  for (let i = 0; i < RING; i++) {
    const a = ring[i], b = ring[(i + 1) % RING], record = [2, 0, i, 0];
    facet(a.inner, a.outer, b.outer, record);
    facet(a.inner, b.outer, b.inner, [2, 0, i + .5, 0]);
  }

  return {
    positions: new Float32Array(positions), facets: new Float32Array(facets), count: positions.length / 4,
    fallPositions: new Float32Array(fallPositions), fallData: new Float32Array(fallData), fallCount: fallPositions.length / 3,
    foot: pool.foot, lip: [lip.x, lip.w, lip.z, drop], mist: quality.trees > 2000 ? 16 : 10
  };
}
