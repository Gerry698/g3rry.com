import { createTerrain, placeCamps, buildTerrainMesh, meshSurface, buildTrail, scatterTrees, scatterClouds, snapCamps, QUALITY } from './terrain.js';
import { buildProps } from './props.js';
import { scatterDetail } from './detail.js';
import { buildWater } from './water.js';

// Everything drawn that depends only on the camps and the quality tier. It is a few hundred milliseconds of work,
// so the page runs it in a worker (worker.js) and falls back to the main thread when a module worker is unavailable.
export function buildScene({ tier, camps: details }) {
  const quality = QUALITY[tier], terrain = createTerrain();
  const camps = placeCamps(terrain, details.length).map((camp, i) => ({ ...camp, ...details[i] }));
  const mesh = buildTerrainMesh(terrain, quality);
  const surface = meshSurface(mesh, terrain);
  snapCamps(camps, mesh, surface);
  // The sampling grid stays behind; the page needs the ledges so its own copy of the terrain matches for the camera.
  const { grid, ...drawn } = mesh;
  // The trail and everything standing on the ground keep out of the water (water.js).
  const wet = (x, z, margin) => terrain.water.wet(x, z, margin);
  const trees = scatterTrees(terrain, camps, quality, surface), trail = buildTrail(camps, surface, undefined, (x, z) => wet(x, z, .45));
  return {
    camps, ledges: terrain.ledges, mesh: drawn, trees, trail,
    props: buildProps(surface, camps), clouds: scatterClouds(terrain, quality), water: buildWater(terrain.water, surface, quality),
    // Spruces, broadleaves, shrubs and boulders around the pines (detail.js).
    detail: scatterDetail(camps, quality.detail, surface, trail, trees, wet)
  };
}

// The typed arrays a finished scene can hand over without copying.
export const transferables = scene => [scene.mesh, scene.props, scene.detail, scene.water, { trees: scene.trees, clouds: scene.clouds }]
  .flatMap(group => Object.values(group)).filter(value => ArrayBuffer.isView(value)).map(view => view.buffer);
