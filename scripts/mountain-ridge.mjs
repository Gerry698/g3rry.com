// The skyline of the mountain as the page first frames it (the idle orbit at time 0), traced once at build time so
// the loading line can be drawn exactly where the ridge will appear. Coordinates are clip space at aspect 1 with y
// pointing down: x spans ±aspect across the window and y spans ±1 down its height, so an SVG with this viewBox and
// preserveAspectRatio="xMidYMid slice" lands on the canvas pixel for pixel.
import { createTerrain } from '../src/mountain/terrain.js';
import { perspective, lookAt, multiply, transform } from '../src/mountain/math.js';
import { eyeOf, idlePose, clampToGround } from '../src/mountain/camera.js';

// fovDegrees: the page's vertical field of view (camera.js FOV); halfWidth: how far across, in units of the window's
// height, the line runs either side of the centre (a screen's half-aspect at most).
export function traceRidge(fovDegrees, halfWidth, columns = Math.round(170 * halfWidth)) {
  const terrain = createTerrain();
  const pose = idlePose(0);
  const eye = clampToGround(eyeOf(pose), terrain);
  const viewProj = multiply(perspective(fovDegrees * Math.PI / 180, 1, .05, 600), lookAt(eye, pose.target));
  const top = new Float64Array(columns + 1).fill(Infinity);
  const heading = Math.atan2(pose.target[2] - eye[2], pose.target[0] - eye[0]);
  const spread = Math.atan(halfWidth * Math.tan(fovDegrees * Math.PI / 360)) * 1.08;
  // March outward along rays fanned across the view; every terrain sample is projected and keeps the highest
  // point of its screen column.
  for (let ray = 0; ray <= columns * 2; ray++) {
    const angle = heading - spread + 2 * spread * ray / (columns * 2);
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let distance = .4; distance < 260; distance += distance < 40 ? .05 : .35) {
      const x = eye[0] + c * distance, z = eye[2] + s * distance;
      const p = transform(viewProj, [x, terrain.height(x, z), z]);
      if (p[3] <= 0) continue;
      const u = p[0], v = -p[1];
      const column = Math.round((u + halfWidth) / (2 * halfWidth) * columns);
      if (column >= 0 && column <= columns && v < top[column]) top[column] = v;
    }
  }
  const points = [...top].map((v, i) => [-halfWidth + 2 * halfWidth * i / columns, Math.min(v, 1.2)]);
  return simplify(points, .0015);
}

// Ramer–Douglas–Peucker, so the path keeps its corners and drops the straight runs.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points.at(-1)];
  let index = 0, distance = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const d = Math.abs((b[1] - a[1]) * x - (b[0] - a[0]) * y + b[0] * a[1] - b[1] * a[0]) / Math.hypot(b[1] - a[1], b[0] - a[0]);
    if (d > distance) { distance = d; index = i; }
  }
  if (distance <= tolerance) return [a, b];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

// The ridge split at its summit into two strokes that start at the window's edges, so the line can climb from both
// sides and meet at the top. Returns SVG path data and the summit.
export function ridgePaths(fovDegrees, halfWidth) {
  const points = traceRidge(fovDegrees, halfWidth);
  let summit = 0;
  points.forEach((point, i) => { if (point[1] < points[summit][1]) summit = i; });
  const path = list => 'M' + list.map(([x, y]) => x.toFixed(3) + ' ' + y.toFixed(3)).join('L');
  return { left: path(points.slice(0, summit + 1)), right: path(points.slice(summit).reverse()), summit: points[summit].map(value => +value.toFixed(3)) };
}
