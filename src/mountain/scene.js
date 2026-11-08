import { createTerrain, placeCamps, buildTerrainMesh, meshSurface, buildTrail, scatterTrees, scatterClouds, snapCamps, QUALITY } from './terrain.js';
import { buildProps } from './props.js';
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
  return {
    camps, ledges: terrain.ledges, mesh: drawn, trees: scatterTrees(terrain, camps, quality, surface), trail: buildTrail(camps, surface, undefined, (x, z) => terrain.water.wet(x, z, .45)),
    props: buildProps(surface, camps), clouds: scatterClouds(terrain, quality), water: buildWater(terrain.water, surface, quality)
  };
}

// The typed arrays a finished scene can hand over without copying.
export const transferables = scene => [scene.mesh, scene.props, scene.water, { trees: scene.trees, clouds: scene.clouds }]
  .flatMap(group => Object.values(group)).filter(value => ArrayBuffer.isView(value)).map(view => view.buffer);
