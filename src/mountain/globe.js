import { TAU, clamp, normalize, cross, dot, sub } from './math.js';
import { ORBIT } from './camera.js';
import { DECK } from './weather.js';

// The free camera's globe: the sphere the lens moves on, seen from a little above and behind the lens, so it turns as
// the view turns and dragging it feels like dragging the scene. Inside: the mountain as a low-poly cone with its camps,
// the cloud deck as a dashed ring (below it, the valley's own weather), and the lens as a lantern with its line of sight.
const PAPER = '247, 243, 236', LANTERN = '255, 207, 125';

export function createGlobe(canvas, camps) {
  const context = canvas.getContext('2d');
  const summit = camps.at(-1), center = [0, ORBIT.center, 0];
  const foot = Array.from({ length: 7 }, (_, i) => { const a = i / 7 * TAU + .5, r = 7.4 + Math.sin(i * 2.4) * 1.2; return [Math.cos(a) * r, 1, Math.sin(a) * r]; });
  const ring = (count, point) => Array.from({ length: count + 1 }, (_, i) => point(i / count * TAU));
  const parallels = [-.5, .5, 1.05].map(lat => ring(72, a => [Math.cos(lat) * Math.cos(a), Math.sin(lat), Math.cos(lat) * Math.sin(a)]));
  const meridians = [0, 1, 2, 3, 4, 5].map(k => ring(72, a => [Math.cos(a) * Math.cos(k / 6 * Math.PI), Math.sin(a), Math.cos(a) * Math.sin(k / 6 * Math.PI)]));

  return function draw({ az, el, dist }) {
    const css = canvas.clientWidth;
    if (!css) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), size = Math.round(css * dpr);
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const c = size / 2, R = size * .42;
    const lift = clamp(el + .5, .25, 1.45);
    const view = [Math.cos(lift) * Math.cos(az), Math.sin(lift), Math.cos(lift) * Math.sin(az)], forward = view.map(v => -v);
    const right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward);
    // Screen position and depth (positive towards the viewer) of a point in globe units.
    const project = p => [c + dot(p, right) * R, c - dot(p, up) * R, dot(p, view)];
    const local = p => sub(p, center).map(v => v / dist);
    context.clearRect(0, 0, size, size);
    context.lineWidth = dpr;
    context.lineJoin = context.lineCap = 'round';
    // A polyline in two passes, the far side faint.
    const trace = (points, near, far, dash = []) => {
      context.setLineDash(dash.map(v => v * dpr));
      for (const [front, alpha] of [[false, far], [true, near]]) {
        context.beginPath();
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i];
          if (a[2] + b[2] > 0 !== front) continue;
          context.moveTo(a[0], a[1]);
          context.lineTo(b[0], b[1]);
        }
        context.strokeStyle = `rgba(${PAPER}, ${alpha})`;
        context.stroke();
      }
      context.setLineDash([]);
    };

    context.beginPath();
    context.arc(c, c, R, 0, TAU);
    context.strokeStyle = `rgba(${PAPER}, .34)`;
    context.stroke();
    for (const line of [...parallels, ...meridians]) trace(line.map(project), .24, .07);

    // The cloud deck, a level ring where its plane cuts the sphere.
    const h = (DECK - ORBIT.center) / dist;
    if (Math.abs(h) < .98) {
      const r = Math.sqrt(1 - h * h), deck = ring(72, a => [Math.cos(a) * r, h, Math.sin(a) * r]).map(project);
      context.beginPath();
      deck.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
      context.fillStyle = `rgba(${PAPER}, .045)`;
      context.fill();
      trace(deck, .5, .16, [2, 3]);
    }

    // The mountain: ribs from the summit to its foot, the foot itself, and the camps.
    const apex = project(local([summit.x, summit.y, summit.z])), base = foot.map(p => project(local(p)));
    context.beginPath();
    for (const [x, y] of base) { context.moveTo(apex[0], apex[1]); context.lineTo(x, y); }
    base.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
    context.closePath();
    context.strokeStyle = `rgba(${PAPER}, .6)`;
    context.stroke();
    context.fillStyle = `rgba(${PAPER}, .9)`;
    for (const camp of camps) {
      const [x, y] = project(local([camp.x, camp.y, camp.z]));
      context.beginPath();
      context.arc(x, y, 1.25 * dpr, 0, TAU);
      context.fill();
    }

    // The lens and its line of sight to the centre of the orbit.
    const [ex, ey] = project([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]);
    context.setLineDash([1.5 * dpr, 2.5 * dpr]);
    context.beginPath();
    context.moveTo(ex, ey);
    context.lineTo(c, c);
    context.strokeStyle = `rgba(${LANTERN}, .7)`;
    context.stroke();
    context.setLineDash([]);
    const halo = context.createRadialGradient(ex, ey, 0, ex, ey, 11 * dpr);
    halo.addColorStop(0, `rgba(${LANTERN}, .5)`);
    halo.addColorStop(1, `rgba(${LANTERN}, 0)`);
    context.fillStyle = halo;
    context.fillRect(ex - 11 * dpr, ey - 11 * dpr, 22 * dpr, 22 * dpr);
    context.beginPath();
    context.arc(ex, ey, 3.2 * dpr, 0, TAU);
    context.fillStyle = `rgb(${LANTERN})`;
    context.fill();
  };
}
