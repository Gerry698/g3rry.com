import { TAU, random, smoothstep, noise2, fbm } from './math.js';
import { treeLineAt, forestAt } from './terrain.js';

// Low-altitude detail around the pines: slender spruces along the forest edges, round broadleaf groves out on the
// meadows, dark shrubs in clumps and boulders (erratics on the meadows, fields of them on the talus under cliffs). All
// are drawn like the pines, one instanced low-poly shape per kind with the trees' shader; aPart in the shapes picks
// the material (0 bark, 1 needles, 2 leaves, 3 stone). Instances are stride 6, as the pines: x, y, z, size, turn, seed.

const GROVES = noise2(31), CLUMPS = noise2(32);

// Where nothing may stand: the camps, the trail and anything already there. Everything placed below goes through
// open(), so a later feature that keeps ground clear (a stream, say) only has to be added here.
function clearance(camps, trail, pines) {
  // Footprints in buckets a quarter unit wide; none is wider than 0.3, so a search reaches r + 0.3 around a spot.
  const cell = .25, size = Math.ceil(56 / cell), slots = new Array(size * size);
  const slot = v => Math.min(size - 1, Math.max(0, Math.floor((v + 28) / cell)));
  const add = (x, z, r) => { const k = slot(z) * size + slot(x); (slots[k] ||= []).push(x, z, r); };
  for (let i = 0; i < trail.length; i++) add(trail[i][0], trail[i][2], .16);
  for (let i = 0; i < pines.length; i += 6) add(pines[i], pines[i + 2], pines[i + 3] * .32);
  return {
    open(x, z, r) {
      for (const camp of camps) if (Math.hypot(camp.x - x, camp.z - z) < (camp.summit ? 1.4 : 1.15)) return false;
      const i0 = slot(x - r - .3), i1 = slot(x + r + .3), j0 = slot(z - r - .3), j1 = slot(z + r + .3);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const list = slots[j * size + i];
        if (list) for (let k = 0; k < list.length; k += 3) {
          const dx = list[k] - x, dz = list[k + 1] - z, gap = r + list[k + 2];
          if (dx * dx + dz * dz < gap * gap) return false;
        }
      }
      return true;
    },
    add
  };
}

// counts: { spruce, broadleaf, shrub, boulder }; trail: points [x, y, z, s]; pines: the pine instances.
export function scatterDetail(camps, counts, surface, trail, pines, seed = 13) {
  const next = random(seed), space = clearance(camps, trail, pines), out = { spruce: [], broadleaf: [], shrub: [], boulder: [] };
  // Heights and slopes come from the drawn surface: cheaper than the terrain function, and what things stand on.
  const slope = (x, z, y) => Math.hypot(surface(x + .15, z) - y, surface(x, z + .15) - y) / .15;
  const place = (kind, x, z, size, sink, footprint) => {
    if (!space.open(x, z, footprint)) return false;
    out[kind].push(x, surface(x, z) - sink, z, size, next() * TAU, next());
    space.add(x, z, footprint);
    return true;
  };
  // Each kind gets a number of tries in proportion to its count; rare spots (talus, groves) may leave it short.
  let kinds = Object.keys(out).filter(kind => counts[kind] > 0);
  const tries = Object.fromEntries(kinds.map(kind => [kind, counts[kind] * (kind === 'boulder' ? 50 : 16)]));
  while (kinds.length) {
    const x = (next() - .5) * 52, z = (next() - .5) * 52, r = Math.hypot(x, z), kind = kinds[Math.floor(next() * kinds.length)];
    if (r > 26 || r < 2) continue;
    if (out[kind].length / 6 >= counts[kind] || tries[kind]-- <= 0) { kinds = kinds.filter(other => other !== kind); continue; }
    // Cheap tests first: how well this spot suits the kind, from the noise fields alone.
    const forest = forestAt(x, z), edge = 4 * forest * (1 - forest);
    const grove = kind === 'broadleaf' ? smoothstep(.12, .42, fbm(GROVES, x * .13, z * .13, 3)) : 0;
    const clump = kind === 'shrub' || kind === 'boulder' ? smoothstep(.1, .5, CLUMPS(x * .55 + 3, z * .55)) : 0;
    const chance = kind === 'spruce' ? .06 + .7 * edge : kind === 'broadleaf' ? grove * (1 - forest) * .9 + .006 : kind === 'shrub' ? (.05 + .5 * edge + .25 * (1 - forest)) * clump : 1;
    if (next() > chance) continue;
    const y = surface(x, z), line = treeLineAt(x, z);
    if (y < .04) continue;
    if (kind === 'boulder') {
      // Boulders gather on the talus below cliffs and thin out across the meadows, where a few big ones lie alone.
      if (y > line + 1.1) continue;
      const steep = slope(x, z, y);
      if (steep > .85) continue;
      const talus = smoothstep(.3, .7, steep) * smoothstep(line - 1.6, line - .3, y);
      if (next() > .006 + .6 * talus + .1 * clump * clump * (1 - forest)) continue;
      const big = next() < .05 * (1 - talus), size = big ? .32 + next() * .2 : .07 + next() ** 2 * .16 + talus * .04;
      place('boulder', x, z, size, size * .22, size * .42);
      continue;
    }
    if (kind === 'shrub') {
      if (y > line + .45 || slope(x, z, y) > .75) continue;
      // A clump: the first bush and up to three more around it.
      const size = .14 + next() * .12;
      if (!place('shrub', x, z, size, .02, size * .3)) continue;
      for (let k = Math.floor(next() * 4); k > 0; k--) {
        const a = next() * TAU, d = .12 + next() * .2, sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d, s = size * (.6 + next() * .5);
        if (surface(sx, sz) < line + .45) place('shrub', sx, sz, s, .02, s * .3);
      }
      continue;
    }
    if (kind === 'spruce') {
      if (y > line - .05 || slope(x, z, y) > .65) continue;
      // Spruces climb a little higher than the broadleaves and stand a little taller near the treeline.
      const size = .15 + next() * .13 + smoothstep(line - 1.5, line, y) * .03;
      place('spruce', x, z, size, .02, size * .2);
      continue;
    }
    // Broadleaves keep to the lower meadows, in groves that grow larger towards their middle.
    if (y > line - .7 || slope(x, z, y) > .45) continue;
    const size = .15 + next() * .1 + grove * .08;
    place('broadleaf', x, z, size, .02, size * .3);
  }
  return Object.fromEntries(Object.entries(out).map(([kind, list]) => [kind, new Float32Array(list)]));
}

// The shapes, in the pines' model units (about one unit tall), as non-indexed triangles with a material per vertex.
export function detailShapes() {
  const shape = () => ({ positions: [], parts: [] });
  const tri = (s, part, ...points) => { for (const p of points) { s.positions.push(...p); s.parts.push(part); } };
  // A cone or frustum around the y axis, closed underneath.
  const cone = (s, y0, y1, r0, r1, sides, part, spin = 0) => {
    for (let i = 0; i < sides; i++) {
      const a0 = i / sides * TAU + spin, a1 = (i + 1) / sides * TAU + spin;
      const p0 = [Math.cos(a0) * r0, y0, Math.sin(a0) * r0], p1 = [Math.cos(a1) * r0, y0, Math.sin(a1) * r0];
      const q0 = [Math.cos(a0) * r1, y1, Math.sin(a0) * r1], q1 = [Math.cos(a1) * r1, y1, Math.sin(a1) * r1];
      tri(s, part, p0, q0, p1);
      if (r1 > 0) tri(s, part, p1, q0, q1);
      tri(s, part, [0, y0, 0], p0, p1);
    }
  };
  // An icosahedron with its corners pushed in and out a little: a lumpy, faceted blob.
  const blob = (s, centre, radii, part, seed) => {
    const next = random(seed), t = (1 + Math.sqrt(5)) / 2;
    const corners = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .map(v => { const l = Math.hypot(...v), k = (.82 + next() * .36) / l; return v.map((c, i) => centre[i] + c * k * radii[i]); });
    const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (const [a, b, c] of faces) tri(s, part, corners[a], corners[b], corners[c]);
  };
  const spruce = shape();
  cone(spruce, 0, .26, .04, .03, 5, 0);
  [[.12, .5, .25], [.34, .74, .2], [.56, .96, .155], [.78, 1.18, .11], [.98, 1.42, .07]].forEach(([y0, y1, r], i) => cone(spruce, y0, y1, r, 0, 5, 1, i * .6));
  const broadleaf = shape();
  cone(broadleaf, 0, .44, .05, .032, 5, 0);
  blob(broadleaf, [0, .7, 0], [.42, .34, .42], 2, 5);
  blob(broadleaf, [.14, .9, -.07], [.26, .22, .26], 2, 9);
  const shrub = shape();
  blob(shrub, [0, .2, 0], [.5, .3, .45], 1, 3);
  const boulder = shape();
  blob(boulder, [0, .18, 0], [.5, .34, .44], 3, 7);
  return Object.fromEntries(Object.entries({ spruce, broadleaf, shrub, boulder }).map(([kind, s]) =>
    [kind, { positions: new Float32Array(s.positions), parts: new Float32Array(s.parts), count: s.positions.length / 3 }]));
}
