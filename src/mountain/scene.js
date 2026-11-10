import { createTerrain, placeCamps, buildTerrainMesh, meshSurface, buildTrail, scatterTrees, scatterClouds, snapCamps, QUALITY } from './terrain.js';
import { buildProps } from './props.js';
import { scatterDetail } from './detail.js';
import { buildWater } from './water.js';
import { placeCave, drawCave, buildChamber, buildMoon } from './beyond.js';

// Everything drawn that depends only on the camps and the quality tier. It is a few hundred milliseconds of work,
// so the page runs it in a worker (worker.js) and falls back to the main thread when a module worker is unavailable.
// beyond: the chapters off the trail the page has, { below: { eras }, above: {} } (beyond.js).
export function buildScene({ tier, camps: details, beyond = {} }) {
  const quality = QUALITY[tier], terrain = createTerrain();
  const camps = placeCamps(terrain, details.length).map((camp, i) => ({ ...camp, ...details[i] }));
  const mesh = buildTerrainMesh(terrain, quality);
  const surface = meshSurface(mesh, terrain);
  snapCamps(camps, mesh, surface);
  // The sampling grid stays behind; the page needs the ledges so its own copy of the terrain matches for the camera.
  const { grid, ...drawn } = mesh;
  // The trail and everything standing on the ground keep out of the water (water.js).
  const wet = (x, z, margin) => terrain.water.wet(x, z, margin);
  // The door to the Heart stands in the cliff by the waterfall. Whatever was scattered on its doorstep is taken away
  // afterwards, so the rest of the forest stands exactly where it did without the door.
  const cave = beyond.below ? placeCave(terrain.water, surface) : null;
  const cleared = list => {
    if (!cave) return list;
    const kept = [];
    for (let i = 0; i < list.length; i += 6) if (Math.hypot(list[i] - cave.x, list[i + 2] - cave.z) > .95) kept.push(...list.subarray(i, i + 6));
    return new Float32Array(kept);
  };
  const pines = scatterTrees(terrain, camps, quality, surface), trail = buildTrail(camps, surface, undefined, (x, z) => wet(x, z, .45));
  const detail = scatterDetail(camps, quality.detail, surface, trail, pines, wet), trees = cleared(pines);
  for (const kind in detail) detail[kind] = cleared(detail[kind]);
  return {
    camps, ledges: terrain.ledges, mesh: drawn, trees, trail, cave,
    props: buildProps(surface, camps, cave && (tools => drawCave(tools, cave))), clouds: scatterClouds(terrain, quality), water: buildWater(terrain.water, surface, quality),
    // Spruces, broadleaves, shrubs and boulders around the pines (detail.js).
    detail,
    chamber: beyond.below ? buildChamber(beyond.below.eras ?? 4) : null,
    moon: beyond.above ? buildMoon() : null
  };
}

// The typed arrays a finished scene can hand over without copying.
export const transferables = scene => [scene.mesh, scene.props, scene.detail, scene.water, scene.moon || {}, scene.chamber?.shell || {}, scene.chamber?.crystals || {}, { trees: scene.trees, clouds: scene.clouds, drips: scene.chamber?.drips }]
  .flatMap(group => Object.values(group)).filter(value => ArrayBuffer.isView(value)).map(view => view.buffer);
