import { random, clamp } from './math.js';

// Adaptive refinement of the terrain grid: one level of quadtree splitting wherever a cell's facets miss the height
// function (crests, arêtes, cliff bands, the summit) or the cell is too coarse for how close the cameras come.
// Everything else keeps its two big facets, so the faceted look stays and the extra triangles go where they show.
//
// A refined cell gains a vertex at its centre and at the middle of each edge and is drawn as four small quads. An edge
// whose middle vertex exists is "active"; a cell that is not refined but has active edges is drawn as a fan around its
// centre, so it shares those middle vertices and no cracks open between coarse and fine cells.
//
// grid: { n, px, py, pz, ao, smooth } with vertex k = j * n + i. Returns the grid's arrays extended with the new
// vertices, and per cell: its centre vertex (-1 if none), whether it is refined, which diagonal its two facets take
// when it stays whole (0 either, 1 b–c, 2 a–d), and the sign of the surface's curvature at its centre.
export function refineGrid(terrain, grid, { reach, tolerance, coarse, coarseReach, gully = .4, seed = 5 }) {
  const { n } = grid, cells = (n - 1) * (n - 1), next = random(seed);
  let size = n * n, capacity = Math.ceil(size * 1.25);
  const grow = (array, stride = 1) => { const out = new Float32Array(capacity * stride); out.set(array.subarray(0, size * stride)); return out; };
  let px = grow(grid.px), py = grow(grid.py), pz = grow(grid.pz), ao = grow(grid.ao), smooth = grow(grid.smooth, 3);
  // A new vertex: its height comes from the terrain, its occlusion and smoothed normal from the vertices it lies between.
  const vertex = (x, z, parents) => {
    if (size === capacity) { capacity = Math.ceil(capacity * 1.3); px = grow(px); py = grow(py); pz = grow(pz); ao = grow(ao); smooth = grow(smooth, 3); }
    let a = 0, nx = 0, ny = 0, nz = 0;
    for (const k of parents) { a += ao[k]; nx += smooth[k * 3]; ny += smooth[k * 3 + 1]; nz += smooth[k * 3 + 2]; }
    const l = Math.hypot(nx, ny, nz) || 1;
    px[size] = x; pz[size] = z; py[size] = terrain.height(x, z); ao[size] = a / parents.length;
    smooth[size * 3] = nx / l; smooth[size * 3 + 1] = ny / l; smooth[size * 3 + 2] = nz / l;
    return size++;
  };
  const centre = new Int32Array(cells).fill(-1), diagonal = new Int8Array(cells), curve = new Int8Array(cells), refined = new Uint8Array(cells);
  // Middle vertices of the edges (i, j)–(i + 1, j) at j * (n - 1) + i, and (i, j)–(i, j + 1) at j * n + i.
  const across = new Int32Array((n - 1) * n).fill(-1), down = new Int32Array(n * (n - 1)).fill(-1);
  const candidate = new Uint8Array(cells);
  const addCentre = c => {
    if (centre[c] >= 0) return centre[c];
    const i = c % (n - 1), j = (c - i) / (n - 1), a = j * n + i, b = a + 1, d0 = a + n, d = d0 + 1;
    const sx = Math.abs(px[b] - px[a] + px[d] - px[d0]) / 2, sz = Math.abs(pz[d0] - pz[a] + pz[d] - pz[b]) / 2;
    // A little jitter, well inside the cell, so the small facets are as irregular as the big ones.
    const x = (px[a] + px[b] + px[d0] + px[d]) / 4 + (next() - .5) * .22 * sx, z = (pz[a] + pz[b] + pz[d0] + pz[d]) / 4 + (next() - .5) * .22 * sz;
    return (centre[c] = vertex(x, z, [a, b, d0, d]));
  };
  // Cells whose edges gained a middle vertex, checked for balance at the end.
  const touched = [];
  // Adds the middle vertex of an edge and returns how far the straight edge misses the surface there (-1 if it existed).
  const edgeVertex = (list, index, p, q) => {
    if (list[index] >= 0) return -1;
    const length = Math.hypot(px[q] - px[p], pz[q] - pz[p]), t = .5 + (next() - .5) * .16;
    const ex = px[p] + (px[q] - px[p]) * t + (next() - .5) * .08 * length, ez = pz[p] + (pz[q] - pz[p]) * t + (next() - .5) * .08 * length;
    const k = list[index] = vertex(ex, ez, [p, q]);
    if (list === across) { const j = Math.floor(index / (n - 1)); if (j > 0) touched.push(index - (n - 1)); if (j < n - 1) touched.push(index); }
    else { const i = index % n, j = (index - i) / n; if (i > 0) touched.push(j * (n - 1) + i - 1); if (i < n - 1) touched.push(j * (n - 1) + i); }
    // Above the straight edge counts in full (a crest); below it (a gully) counts for less, see the first pass.
    const miss = py[k] - (py[p] + (py[q] - py[p]) * t);
    return miss > 0 ? miss : -miss * gully;
  };
  // Splits a cell: its four edge vertices, and queues the cell across any edge that misses the surface by more than
  // the tolerance, so refinement follows a crest even where it runs along the grid.
  const split = (c, spread) => {
    refined[c] = 1;
    addCentre(c);
    const i = c % (n - 1), j = (c - i) / (n - 1), a = j * n + i;
    const sides = [[across, j * (n - 1) + i, a, a + 1, j > 0 ? c - (n - 1) : -1], [across, (j + 1) * (n - 1) + i, a + n, a + n + 1, j < n - 2 ? c + (n - 1) : -1],
      [down, j * n + i, a, a + n, i > 0 ? c - 1 : -1], [down, j * n + i + 1, a + 1, a + n + 1, i < n - 2 ? c + 1 : -1]];
    for (const [list, index, p, q, other] of sides) if (edgeVertex(list, index, p, q) > tolerance && other >= 0 && candidate[other] && !refined[other]) spread.push(other);
  };

  // First pass: a cell near enough whose corners say it may bend (the two diagonals disagree, or the slope changes
  // across it) gets a centre; how far the two possible facet pairs miss it there picks the diagonal (along a crest or
  // a gully, not across it) and decides whether the cell is split. A crest the facets cut under counts in full, a gully
  // only in part (`gully`): crests make the outline, while sharpened gullies mostly darken the faces they cut into.
  // The test on the corners is cheap and lets about seven cells in ten keep their two facets without evaluating the
  // terrain again; it misses almost none that matter.
  let queue = [];
  for (let c = 0; c < cells; c++) {
    const i = c % (n - 1), j = (c - i) / (n - 1), a = j * n + i, b = a + 1, d0 = a + n, d = d0 + 1;
    const r = Math.hypot((px[a] + px[d]) / 2, (pz[a] + pz[d]) / 2);
    if (r > reach || i < 1 || j < 1 || i > n - 3 || j > n - 3) continue;
    candidate[c] = 1;
    const span = (Math.hypot(px[b] - px[a], pz[b] - pz[a]) + Math.hypot(px[d0] - px[a], pz[d0] - pz[a])) / 2;
    const coarseHere = span > coarse && r < coarseReach;
    const twist = Math.abs(py[a] + py[d] - py[b] - py[d0]) / 2;
    const bend = Math.max(Math.abs(py[b + 1] - py[b] - py[a] + py[a - 1]), Math.abs(py[d + 1] - py[d] - py[d0] + py[d0 - 1]),
      Math.abs(py[d0 + n] - py[d0] - py[a] + py[a - n]), Math.abs(py[d + n] - py[d] - py[b] + py[b - n])) / 4;
    if (!coarseHere && Math.max(twist, bend) < tolerance * .4) continue;
    const h = py[addCentre(c)];
    const viaBC = h - (py[b] + py[d0]) / 2, viaAD = h - (py[a] + py[d]) / 2;
    const best = Math.min(Math.abs(viaBC), Math.abs(viaAD));
    if (Math.abs(Math.abs(viaBC) - Math.abs(viaAD)) > .004) diagonal[c] = Math.abs(viaBC) < Math.abs(viaAD) ? 1 : 2;
    curve[c] = Math.abs(viaBC + viaAD) > .01 ? Math.sign(viaBC + viaAD) : 0;
    if ((viaBC + viaAD > 0 ? best : best * gully) > tolerance || coarseHere) queue.push(c);
  }
  while (queue.length) {
    const spread = [];
    for (const c of queue) if (!refined[c]) split(c, spread);
    queue = spread;
  }
  // A whole cell with three or four active edges is split too; every cell with an active edge needs its centre.
  while (touched.length) {
    const c = touched.pop();
    if (refined[c]) continue;
    const i = c % (n - 1), j = (c - i) / (n - 1);
    const active = (across[j * (n - 1) + i] >= 0) + (across[(j + 1) * (n - 1) + i] >= 0) + (down[j * n + i] >= 0) + (down[j * n + i + 1] >= 0);
    addCentre(c);
    if (active >= 3) split(c, []);
  }
  return {
    size, px: px.subarray(0, size), py: py.subarray(0, size), pz: pz.subarray(0, size), ao: ao.subarray(0, size), smooth: smooth.subarray(0, size * 3),
    centre, refined, diagonal, curve, across, down
  };
}

// Moves grid vertices onto the crests and peaks they sit next to, before anything else reads the grid. The facets
// either side of an arête then meet on the arête itself instead of cutting under it in a sawtooth, and summits and
// lesser peaks get a vertex on their tip, so the drawn skyline follows the height function (and the traced loading line).
// A vertex moves less than half way to its neighbours, so the grid never folds, and only the vertex nearest a crest
// moves onto it. Vertices beyond `reach` or below `floor` stay where they are; `bend` is how sharply the surface must
// fold over a vertex's neighbours to count as a crest.
export function snapToCrests(terrain, { n, px, py, pz }, { reach, floor, bend }) {
  const from = Float32Array.from(py), inside = k => from[k] >= floor && px[k] * px[k] + pz[k] * pz[k] <= reach * reach;
  // Grid lines through a vertex: along i, along j, and the two diagonals, as index offsets and as grid steps (u, v).
  const lines = [1, n, n + 1, n - 1], steps = { 1: [1, 0], [n]: [0, 1], [n + 1]: [1, 1], [n - 1]: [-1, 1] };
  for (let j = 2; j < n - 2; j++) for (let i = 2; i < n - 2; i++) {
    const k = j * n + i;
    if (!inside(k)) continue;
    // The line across which the surface bends most sharply downwards on both sides marks a crest along the other way.
    let line = 0, sharpest = 0;
    for (const d of lines) {
      const curvature = from[k - d] + from[k + d] - 2 * from[k];
      if (curvature < sharpest) { sharpest = curvature; line = d; }
    }
    const peak = lines.every(d => from[k] >= from[k - d] && from[k] >= from[k + d]);
    if (!peak && -sharpest < bend) continue;
    // Offsets are in grid steps along i (u) and j (v), so a box of ±0.45 stays inside the vertex's own cells.
    const ux = (px[k + 1] - px[k - 1]) / 2, uz = (pz[k + 1] - pz[k - 1]) / 2, vx = (px[k + n] - px[k - n]) / 2, vz = (pz[k + n] - pz[k - n]) / 2;
    const at = (u, v) => terrain.height(px[k] + ux * u + vx * v, pz[k] + uz * u + vz * v);
    const move = (u, v, y) => { px[k] += ux * u + vx * v; pz[k] += uz * u + vz * v; py[k] = y; };
    // Climbs from (u, v) by pattern search inside a box of ±0.45; returns the highest point found.
    const climb = (u, v, y, size) => {
      for (; size > .02; size /= 2) for (let moved = true; moved;) {
        moved = false;
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const tu = clamp(u + du * size, -.45, .45), tv = clamp(v + dv * size, -.45, .45), h = at(tu, tv);
          if (h > y + 1e-4) { u = tu; v = tv; y = h; moved = true; }
        }
      }
      return [u, v, y];
    };
    // A summit: higher than all eight neighbours. It climbs in two dimensions instead.
    if (peak) {
      const [u, v, y] = climb(0, 0, from[k], .22);
      if (u || v) move(u, v, y);
      continue;
    }
    // Along the chosen line, the highest of a few samples within ±0.45 of the way to each neighbour.
    const [du, dv] = steps[line];
    let best = 0, by = from[k];
    for (const t of [-.45, -.3, -.15, .15, .3, .45]) { const h = at(du * t, dv * t); if (h > by) { by = h; best = t; } }
    // Of the two vertices either side of a crest, the higher one is the nearer; it alone moves.
    if (!best || from[best > 0 ? k + line : k - line] > from[k]) continue;
    // One refinement step around the best sample.
    for (const t of [best - .075, best + .075]) if (Math.abs(t) <= .45) { const h = at(du * t, dv * t); if (h > by) { by = h; best = t; } }
    move(du * best, dv * best, by);
  }
}

// How many facets cellFacets() will emit for a cell: eight when split, a fan of four plus one per active edge, or two.
export function facetCount(c, n, { refined, across, down }) {
  if (refined[c]) return 8;
  const i = c % (n - 1), j = (c - i) / (n - 1);
  const active = (across[j * (n - 1) + i] >= 0) + (across[(j + 1) * (n - 1) + i] >= 0) + (down[j * n + i] >= 0) + (down[j * n + i + 1] >= 0);
  return active ? 4 + active : 2;
}

// The facets of one cell, as vertex triples passed to emit(), given the refinement. pick() is the grid's coin for
// the diagonal of a quad when nothing else decides it.
export function cellFacets(c, n, plan, pick, emit) {
  const i = c % (n - 1), j = (c - i) / (n - 1), a = j * n + i, b = a + 1, d0 = a + n, d = d0 + 1;
  const { centre, refined, diagonal, across, down } = plan;
  const top = across[j * (n - 1) + i], bottom = across[(j + 1) * (n - 1) + i], left = down[j * n + i], right = down[j * n + i + 1];
  if (refined[c]) {
    const m = centre[c];
    quad(plan, c, a, top, left, m, 0, pick, emit); quad(plan, c, top, b, m, right, 0, pick, emit);
    quad(plan, c, left, m, d0, bottom, 0, pick, emit); quad(plan, c, m, right, bottom, d, 0, pick, emit);
  } else if (top >= 0 || bottom >= 0 || left >= 0 || right >= 0) {
    // The cell's outline in order, with the middle vertices of its active edges, fanned around the centre.
    const ring = [a, top, b, right, d, bottom, d0, left].filter(k => k >= 0), m = centre[c];
    for (let k = 0; k < ring.length; k++) emit(m, ring[k], ring[(k + 1) % ring.length]);
  } else quad(plan, c, a, b, d0, d, diagonal[c] || (pick() < .5 ? 1 : 2), pick, emit);
}
// A quad (tl, tr, bl, br) of cell c as two facets: on a crest the diagonal with the higher middle, in a gully the
// lower one; choice 1 takes tr–bl, 2 takes tl–br, 0 decides.
function quad({ curve, py }, c, tl, tr, bl, br, choice, pick, emit) {
  if (!choice) {
    const viaAD = (py[tl] + py[br]) / 2, viaBC = (py[tr] + py[bl]) / 2;
    choice = curve[c] && Math.abs(viaAD - viaBC) > .003 ? ((viaAD > viaBC) === (curve[c] > 0) ? 2 : 1) : pick() < .5 ? 1 : 2;
  }
  if (choice === 1) { emit(tl, bl, tr); emit(tr, bl, br); } else { emit(tl, bl, br); emit(tl, br, tr); }
}
