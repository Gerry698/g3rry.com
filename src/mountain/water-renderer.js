import { program, precompile, vertexArray } from './gl.js';
import * as sources from './water-shaders.js';

// Draws the water that water.js built: the river and pool, the falling water, and the spray at its foot.
const PROGRAMS = { water: ['waterVertex', 'waterFragment'], fall: ['fallVertex', 'fallFragment'], mist: ['mistVertex', 'mistFragment'] };
export const warmUpWater = gl => precompile(gl, Object.values(PROGRAMS).map(([vertex, fragment]) => [sources[vertex], sources[fragment]]));

export function createWaterRenderer(gl, water) {
  const programs = Object.fromEntries(Object.entries(PROGRAMS).map(([name, [vertex, fragment]]) => [name, program(gl, sources[vertex], sources[fragment], name)]));
  const surface = vertexArray(gl, [{ data: water.positions, size: 4 }, { data: water.facets, size: 4 }]);
  const fall = vertexArray(gl, [{ data: water.fallPositions, size: 3 }, { data: water.fallData, size: 4 }]);
  const empty = gl.createVertexArray();
  return {
    // With the opaque passes: the water mesh runs a little under the banks on both sides and the depth test hides
    // that part, so the shoreline is wherever the drawn ground meets the water.
    drawOpaque(common) {
      programs.water.use().set(common).set({ uFoot: water.foot });
      gl.bindVertexArray(surface.vao);
      gl.drawArrays(gl.TRIANGLES, 0, water.count);
      programs.fall.use().set(common).set({ uLip: water.lip, uFoot: water.foot });
      gl.bindVertexArray(fall.vao);
      gl.drawArrays(gl.TRIANGLES, 0, water.fallCount);
    },
    // With the transparent sprites (premultiplied alpha, no depth writes).
    drawMist(common) {
      programs.mist.use().set(common).set({ uFoot: water.foot });
      gl.bindVertexArray(empty);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, water.mist);
    }
  };
}
