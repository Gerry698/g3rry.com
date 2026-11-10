import { TAU, clamp, lerp, smoothstep, random, hexToLinear, add, sub, scale, normalize, cross, dot } from './math.js';

// Two chapters off the trail. Below it, the Heart: a door of standing stones in the cliff beside the waterfall leads
// into a chamber inside the massif, where a cluster of crystals hangs over still water and lights the rock in slow
// beats; one seam of light runs round the walls for every earlier version of the site the mountain keeps. Above it,
// Moonward: past the summit the camera keeps rising and the moon, a faceted body like the mountain, comes close.
// This file is their geometry, built in the scene worker with everything else; beyond-renderer.js draws it.

// The chamber, in world units. It lies inside the massif, but nothing outside ever shows it and nothing inside shows
// the outside: the camera goes in and out through black (main.js), so the two never have to meet.
export const HEART = { at: [0, 3.4, 0], water: 2.48, period: 2.6, orbit: 2.55 };
// The moon stands far off in the direction the night's palette gives it, and comes near for the chapter above.
export const MOON = { distance: 300, radius: 11, near: { ahead: 66, lift: 16, aside: 24, radius: 14 } };

const paint = hex => hexToLinear(hex).map(c => Math.round(Math.sqrt(c) * 255));
const mixBytes = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));

// Smooth value noise on a lattice, in [-1, 1].
function noise3(seed) {
  const next = random(seed), table = new Float32Array(4096);
  for (let i = 0; i < table.length; i++) table[i] = next() * 2 - 1;
  const at = (x, y, z) => table[(Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & 4095];
  const fade = t => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const row = (dy, dz) => lerp(at(xi, yi + dy, zi + dz), at(xi + 1, yi + dy, zi + dz), u);
    return lerp(lerp(row(0, 0), row(1, 0), v), lerp(row(0, 1), row(1, 1), v), w);
  };
}

// A sphere of near-equal triangles: an icosahedron with every face split in four, `level` times over.
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(normalize);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let pass = 0; pass < level; pass++) {
    const cache = new Map(), split = [];
    const middle = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      if (!cache.has(key)) { cache.set(key, vertices.length); vertices.push(normalize(add(vertices[a], vertices[b]))); }
      return cache.get(key);
    };
    for (const [a, b, c] of faces) {
      const ab = middle(a, b), bc = middle(b, c), ca = middle(c, a);
      split.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = split;
  }
  return { vertices, faces };
}

// ---- The door ------------------------------------------------------------------------------------------------------

// Where the door stands: in the cliff round the plunge pool, to the side of the fall that faces the trailhead.
export function placeCave(water, surface) {
  const { pool, stream } = water, lip = stream.at(-1);
  const theta = Math.atan2(lip.z - pool.z, lip.x - pool.x) + .82, c = Math.cos(theta), s = Math.sin(theta);
  let d = pool.edge(theta).r + .12;
  while (d < 2.2 && surface(pool.x + c * d, pool.z + s * d) < pool.level + .4) d += .02;
  const x = pool.x + c * d, z = pool.z + s * d, y = surface(x, z);
  // out: level, from the door towards the water. glow: the shard of the heart that hangs in the doorway.
  return { x, y, z, out: [-c, 0, -s], glow: [x + c * .02, y + .27, z + s * .02] };
}

// A dolmen set into the cliff: two slabs and a capstone round a dark doorway, a shard of the heart hanging in it and
// a few pale crystals at its foot. Drawn with the camps' props (props.js hands over its tools).
export function drawCave({ box, frustum, next }, cave) {
  const out = cave.out, side = [-out[2], 0, out[0]], base = [cave.x, cave.y - .07, cave.z];
  const at = (ahead, across, up) => [base[0] + out[0] * ahead + side[0] * across, base[1] + up, base[2] + out[2] * ahead + side[2] * across];
  const rock = paint('#6a6670'), light = paint('#8f8a86'), shade = paint('#4a4852'), dark = paint('#040508');
  box(at(-.2, -.28, 0), out, .64, .66, .15, light, rock);
  box(at(-.2, .28, 0), out, .64, .61, .17, rock, shade);
  box(at(-.24, 0, .6), side, .9, .15, .76, light, rock);
  box(at(-.34, 0, 0), side, .44, .62, .5, dark, dark);
  // Rubble at the foot of the slabs.
  for (const [ahead, across, size] of [[.2, -.4, .07], [.13, .42, .09], [.26, .3, .05], [.22, -.2, .04]]) {
    const foot = at(ahead, across, -.02);
    frustum(foot, add(foot, [0, size * .8, 0]), size, size * .5, 5, next() < .5 ? rock : shade, 0, next() * TAU);
  }
  // Crystals growing out of the threshold: the first sign of what is inside.
  const ice = paint('#bcd3ff'), aqua = paint('#9fe3e0');
  [[.14, -.3, .16, .5, -.3], [.18, -.24, .1, .2, .5], [.12, .33, .19, -.4, .2], [.2, .25, .11, .1, -.6], [.08, .38, .08, -.7, -.2]].forEach(([ahead, across, height, leanSide, leanOut], i) => {
    const foot = at(ahead, across, -.03);
    frustum(foot, add(foot, add([0, height, 0], add(scale(side, leanSide * height * .35), scale(out, leanOut * height * .35)))), .028 + height * .08, 0, 5, i % 2 ? aqua : ice, .5, next() * TAU);
  });
  // The shard: two cones base to base, lit from within.
  const gold = paint('#ffcf7d'), middle = at(-.02, 0, .34);
  frustum(middle, add(middle, [0, .13, 0]), .036, 0, 6, gold, .88, .3);
  frustum(middle, add(middle, [0, -.1, 0]), .036, 0, 6, gold, .88, .3);
}

// ---- The chamber ---------------------------------------------------------------------------------------------------

// A pointed prism from a to b. tipA and tipB are the shares of its length that taper to a point at each end (0 leaves
// that end open, for crystals that grow out of something). attribute(p) gives each vertex its record for the shader.
function crystal(mesh, a, b, radius, { sides = 6, tipA = 0, tipB = .3, color, tipColor = color, attribute, next }) {
  const axis = sub(b, a), length = Math.hypot(...axis), unit = scale(axis, 1 / length);
  const u = normalize(cross(unit, Math.abs(unit[1]) > .9 ? [1, 0, 0] : [0, 1, 0])), v = cross(unit, u);
  const spin = next() * TAU, widths = Array.from({ length: sides }, () => 1 + (next() - .5) * .3);
  const ring = share => Array.from({ length: sides }, (_, i) => {
    const t = i / sides * TAU + spin, r = radius * widths[i];
    return add(add(a, scale(unit, length * share)), add(scale(u, Math.cos(t) * r), scale(v, Math.sin(t) * r)));
  });
  const lower = ring(tipA), upper = ring(1 - tipB);
  const push = (points, tones) => points.forEach((p, i) => { mesh.positions.push(...p); mesh.colors.push(...tones[i], 255); mesh.data.push(...attribute(p)); });
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    if (tipA > 0) push([a, lower[j], lower[i]], [tipColor, color, color]);
    push([lower[i], lower[j], upper[j], lower[i], upper[j], upper[i]], [color, color, color, color, color, color]);
    push([upper[i], upper[j], b], [color, color, tipColor]);
  }
}

// eras: how many shards circle the heart and how many seams of light run round the walls (one per kept version).
export function buildChamber(eras = 4, seed = 19) {
  const next = random(seed), field = noise3(seed + 1), [cx, cy, cz] = HEART.at, water = HEART.water;
  // An egg of rock: wide at the water, a tall dome over it, three shallow bays round it and a chimney at the very top.
  const radius = d => {
    const up = d[1], level = Math.hypot(d[0], d[2]), bearing = Math.atan2(d[2], d[0]);
    const egg = 1 / Math.hypot(level / 4.5, up / (up > 0 ? 3.8 : 1.9));
    const bays = 1 + .1 * Math.sin(3 * bearing + .6) * (1 - up * up) + .05 * Math.sin(5 * bearing - 1.1) * (1 - Math.abs(up));
    const rough = .08 * field(d[0] * 1.7, d[1] * 1.7, d[2] * 1.7) + .04 * field(d[0] * 4.3 + 9, d[1] * 4.3, d[2] * 4.3);
    return { r: egg * bays * (1 + rough) * (1 + 1.5 * smoothstep(.972, .998, up)), rough };
  };
  const wall = d => { const { r } = radius(d); return [cx + d[0] * r, cy + d[1] * r, cz + d[2] * r]; };

  // Rock: bands of tone by height, like the strata outside; alpha is how open each facet is (recesses are darker).
  const TONES = ['#4a4f7e', '#575c8f', '#434874', '#62639a', '#4f5486'].map(paint), DEEP = paint('#2c5a68'), ROOF = paint('#2b3058'), PALE = paint('#8f92bd');
  const shell = { positions: [], colors: [] };
  const sphere = icosphere(4);
  const points = sphere.vertices.map(d => {
    const jitter = normalize([d[0] + (next() - .5) * .05, d[1] + (next() - .5) * .05, d[2] + (next() - .5) * .05]);
    return { p: wall(jitter), rough: radius(jitter).rough };
  });
  const tone = y => {
    const band = Math.floor((y - water) / .62 + field(y * .4, 3.1, 7.7) * .6);
    let color = TONES[((band % TONES.length) + TONES.length) % TONES.length];
    color = mixBytes(color, DEEP, smoothstep(water + .9, water, y) * .8);
    return mixBytes(color, ROOF, smoothstep(5.2, 7, y) * .7);
  };
  for (const [a, b, c] of sphere.faces) {
    const A = points[a], B = points[b], C = points[c], y = (A.p[1] + B.p[1] + C.p[1]) / 3;
    const open = clamp(1 - (A.rough + B.rough + C.rough) / 3 * 3.2, .55, 1) * (.9 + next() * .1);
    const color = tone(y);
    for (const vertex of [A, B, C]) { shell.positions.push(...vertex.p); shell.colors.push(...color, Math.round(open * 255)); }
  }
  // Stalactites and stalagmites share the rock's mesh: cones that pale towards their points.
  const cone = (base, tip, r, sides, color) => {
    const axis = normalize(sub(tip, base)), u = normalize(cross(axis, [1, 0, .3])), v = cross(axis, u), spin = next() * TAU;
    const ring = Array.from({ length: sides }, (_, i) => { const t = i / sides * TAU + spin, w = r * (.8 + next() * .4); return add(base, add(scale(u, Math.cos(t) * w), scale(v, Math.sin(t) * w))); });
    const point = mixBytes(color, PALE, .4);
    for (let i = 0; i < sides; i++) {
      shell.positions.push(...ring[i], ...tip, ...ring[(i + 1) % sides]);
      shell.colors.push(...color, 235, ...point, 255, ...color, 235);
    }
  };
  // The lens circles the heart at HEART.orbit; nothing hangs or stands in its way, and nothing crowds the heart.
  const lane = r => r > HEART.orbit - .55 && r < HEART.orbit + .5;
  const drips = [];
  for (let tries = 0, made = 0; made < 44 && tries < 400; tries++) {
    const bearing = next() * TAU, up = .3 + next() * .66, level = Math.sqrt(1 - up * up);
    const root = wall([Math.cos(bearing) * level, up, Math.sin(bearing) * level]), r = Math.hypot(root[0] - cx, root[2] - cz);
    const floor = r < 1.9 ? 5 : lane(r) ? 4.7 : 3.5;
    const length = Math.min(.45 + next() * next() * 2.2, root[1] - floor);
    if (length < .3) continue;
    const tip = [root[0] + (next() - .5) * .12 * length, root[1] - length, root[2] + (next() - .5) * .12 * length];
    cone(add(root, [0, .12, 0]), tip, .07 + length * .09, 5, tone(root[1] - length * .4));
    if (length > .8 && drips.length < 9) drips.push([tip[0], tip[2], tip[1]]);
    made++;
  }
  for (let tries = 0, made = 0; made < 26 && tries < 400; tries++) {
    const bearing = next() * TAU, r = 1.3 + next() * 2.7;
    if (lane(r)) continue;
    const x = cx + Math.cos(bearing) * r, z = cz + Math.sin(bearing) * r;
    // Low between the lens and the heart, so they never stand in front of it; taller along the walls.
    const height = r < HEART.orbit ? .08 + next() * .22 : .25 + next() * next() * 1.3;
    cone([x, water - .5, z], [x + (next() - .5) * .08, water + height, z + (next() - .5) * .08], .1 + height * .12, 5, tone(water + height * .3));
    made++;
  }

  // Crystals. Each vertex's record: group (0 the heart, 1 a shard circling it, 2 grown on the rock), how far out along
  // the light's way it is (0 at the source, 1 at the tip), the shard's number or a seed, and how much it glows itself.
  const crystals = { positions: [], colors: [], data: [] };
  const gold = paint('#ffb85e'), cream = paint('#ffe9c4');
  const far = p => clamp(Math.hypot(...p) / .82, 0, 1);
  // The heart, about its own centre: one long crystal pointed at both ends, smaller ones budding from its waist.
  crystal(crystals, [.04, -.72, .02], [-.03, .78, -.02], .24, { tipA: .3, tipB: .36, color: gold, tipColor: cream, attribute: p => [0, far(p), 0, 1], next });
  for (let i = 0; i < 7; i++) {
    const bearing = i / 7 * TAU + (next() - .5) * .5, rise = lerp(-.55, .95, next()), level = Math.cos(rise);
    const dir = [Math.cos(bearing) * level, Math.sin(rise), Math.sin(bearing) * level], root = [0, lerp(-.2, .2, next()), 0], length = .4 + next() * .4;
    crystal(crystals, add(root, scale(dir, .05)), add(root, scale(dir, length)), .07 + next() * .065, { tipB: .42, color: gold, tipColor: cream, attribute: p => [0, far(p), i + 1, 1], next });
  }
  // The shards that circle it, one per era, each about its own centre and of its own tint.
  const TINTS = ['#ffcf7d', '#9fe3e0', '#c9b6ff', '#ffb9a6', '#bcd3ff', '#d5f0a8', '#f2c4e6', '#f7f3ec'].map(paint);
  for (let i = 0; i < eras; i++) {
    const lean = [(next() - .5) * .16, 0, (next() - .5) * .16], half = .15 + next() * .05;
    crystal(crystals, sub([0, -half, 0], lean), add([0, half * 1.1, 0], lean), .045 + next() * .02,
      { tipA: .42, tipB: .42, color: TINTS[i % TINTS.length], tipColor: mixBytes(TINTS[i % TINTS.length], cream, .6), attribute: p => [1, clamp(Math.abs(p[1]) / half, 0, 1), i, .8], next });
  }
  // Clusters grown on the walls and by the water, pale and cold; they catch the heart's light.
  const ice = paint('#bcd3ff'), aqua = paint('#9fe3e0'), frost = paint('#eef4ff');
  for (let k = 0; k < 18; k++) {
    const bearing = next() * TAU, up = lerp(-.25, .78, next() * next()), level = Math.sqrt(1 - up * up);
    const d = [Math.cos(bearing) * level, up, Math.sin(bearing) * level], root = wall(d);
    if (root[1] < water - .1) continue;
    const inward = scale(d, -1), tint = next() < .5 ? aqua : ice, seedOf = next() * 6.28;
    for (let j = 0, count = 3 + Math.floor(next() * 4); j < count; j++) {
      const dir = normalize([inward[0] + (next() - .5) * 1.1, inward[1] + (next() - .2) * 1.1, inward[2] + (next() - .5) * 1.1]);
      const from = add(root, scale(d, .08)), length = .22 + next() * next() * .75, to = add(from, scale(dir, length + .08));
      crystal(crystals, from, to, .028 + length * .07, { sides: 5 + (j % 2), tipB: .5, color: tint, tipColor: frost,
        attribute: p => [2, clamp(Math.hypot(...sub(p, from)) / (length + .08), 0, 1), seedOf + j, tint === gold ? .32 : .12], next });
    }
  }
  return {
    eras,
    shell: { positions: new Float32Array(shell.positions), colors: new Uint8Array(shell.colors), count: shell.positions.length / 3 },
    crystals: { positions: new Float32Array(crystals.positions), colors: new Uint8Array(crystals.colors), data: new Float32Array(crystals.data), count: crystals.positions.length / 3 },
    // Where water drops from the longer stalactites: x, z and the height it falls from.
    drips: new Float32Array(drips.flat())
  };
}

// ---- The moon ------------------------------------------------------------------------------------------------------

// A unit sphere with craters pressed into it, their rims raised, and dark plains over part of one side. Colours are
// per vertex and blend across the facets; the facets' own normals do the shading, as on the mountain.
export function buildMoon(level = 5, seed = 77) {
  const next = random(seed), field = noise3(seed + 1);
  const anywhere = () => { const y = next() * 2 - 1, a = next() * TAU, l = Math.sqrt(1 - y * y); return [Math.cos(a) * l, y, Math.sin(a) * l]; };
  const craters = [];
  const add_ = (count, low, high, fresh) => { for (let i = 0; i < count; i++) { const r = lerp(low, high, next() * next()); craters.push({ dir: anywhere(), r, depth: r * lerp(.13, .2, next()), reach: Math.cos(Math.min(3, r * 2.6)), fresh: next() < fresh ? .5 + next() * .5 : 0, peak: r > .17 }); } };
  add_(5, .18, .3, .2); add_(13, .1, .16, .3); add_(12, .075, .1, .15);
  const plains = normalize([.5, .25, -.8]);
  const HIGH = hexToLinear('#d9d4c7'), LOW = hexToLinear('#74757c'), RAY = hexToLinear('#f7f3ec'), FLOOR = hexToLinear('#b3ae9f');
  const sphere = icosphere(level);
  const vertices = sphere.vertices.map(d => {
    let height = .012 * field(d[0] * 3.1, d[1] * 3.1, d[2] * 3.1) + .005 * field(d[0] * 9 + 4, d[1] * 9, d[2] * 9), bright = 0, floor = 0;
    for (const crater of craters) {
      const cosine = dot(d, crater.dir);
      if (cosine < crater.reach) continue;
      const a = Math.acos(Math.min(1, cosine)) / crater.r;
      // A bowl with a flat floor, a raised rim that falls away outside, and a peak in the middle of the largest.
      const inside = 1 - smoothstep(.5, 1, a);
      height += crater.depth * (-inside + .42 * Math.exp(-(((a - 1) / .2) ** 2)) + (crater.peak ? .35 * Math.exp(-((a / .16) ** 2)) : 0));
      floor = Math.max(floor, inside * .6);
      // Young craters throw bright rays outward, broken into streaks.
      if (crater.fresh && a < 2.6) bright = Math.max(bright, crater.fresh * Math.exp(-Math.max(a - .9, 0) * 1.5) * (.55 + .45 * field(d[0] * 14, d[1] * 14, d[2] * 14)));
    }
    const mare = smoothstep(.06, .3, field(d[0] * 1.5 + 2, d[1] * 1.5, d[2] * 1.5)) * smoothstep(-.9, .1, dot(d, plains));
    let color = HIGH.map((v, i) => lerp(v, LOW[i], mare * .9));
    color = color.map((v, i) => lerp(v, FLOOR[i], floor * (1 - mare) * .5));
    color = color.map((v, i) => lerp(v, RAY[i], clamp(bright, 0, 1) * .8) * (.94 + .12 * field(d[0] * 21, d[1] * 21 + 5, d[2] * 21)));
    return { p: scale(d, 1 + height * (1 - mare * .5)), color: color.map(v => Math.round(Math.sqrt(clamp(v, 0, 1)) * 255)) };
  });
  const positions = new Float32Array(sphere.faces.length * 9), colors = new Uint8Array(sphere.faces.length * 12);
  sphere.faces.forEach((face, f) => face.forEach((index, k) => {
    positions.set(vertices[index].p, f * 9 + k * 3);
    colors.set([...vertices[index].color, 255], f * 12 + k * 4);
  }));
  return { positions, colors, count: sphere.faces.length * 3 };
}

// Where the moon hangs for the chapter above: ahead of the summit along the night's bearing to it, well above, and a
// little to one side so the summit and the moon share the frame. summit: [x, y, z]; bearing: radians from +x to +z.
export function nearMoon(summit, bearing) {
  const { ahead, lift, aside, radius } = MOON.near, c = Math.cos(bearing), s = Math.sin(bearing);
  return [summit[0] + c * ahead - s * aside, summit[1] + lift, summit[2] + s * ahead + c * aside, radius];
}
