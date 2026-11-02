import { perspective, lookAt, multiply, invert, spring, sub, add, normalize } from './math.js';

// A full-frame camera: 36 x 24 mm sensor, real focal lengths and f-numbers, thin-lens depth of field.
export const SENSOR_LONG = 36;

export class Camera {
  constructor() {
    this.channels = {};
    this.value = null;
  }

  // Every channel follows its target through a critically damped spring; focal length and f-number move in log space like zoom rings and stops.
  follow(target, dt, omega) {
    const plain = { px: target.pos[0], py: target.pos[1], pz: target.pos[2], lx: target.look[0], ly: target.look[1], lz: target.look[2],
      focal: Math.log(target.focal), aperture: Math.log(target.aperture), focus: Math.log(target.focus), shiftX: target.shift[0], shiftY: target.shift[1] };
    if (!this.value) for (const [key, x] of Object.entries(plain)) this.channels[key] = { x, v: 0 };
    for (const [key, x] of Object.entries(plain)) spring(this.channels[key], x, key === 'focus' ? omega * 1.6 : omega, dt);
    const c = this.channels;
    this.value = {
      pos: [c.px.x, c.py.x, c.pz.x], look: [c.lx.x, c.ly.x, c.lz.x], focal: Math.exp(c.focal.x), aperture: Math.exp(c.aperture.x),
      focus: Math.exp(c.focus.x), shift: [c.shiftX.x, c.shiftY.x], metersPerUnit: target.metersPerUnit
    };
    return this.value;
  }

  jump() { this.value = null; }

  matrices(width, height) {
    const { pos, look, focal, aperture, focus, shift, metersPerUnit } = this.value;
    const aspect = width / height;
    const tanLong = SENSOR_LONG / 2 / focal;
    // The sensor's long side follows the screen's long side, as if the camera were turned for a portrait frame.
    const tanY = aspect >= 1 ? tanLong / aspect : tanLong;
    // Points are blended without a depth buffer, so the near plane costs no precision: it sits close enough for a beach
    // 3 m from the lens to survive at the atlas's 100 m per unit.
    const projection = perspective(2 * Math.atan(tanY), aspect, .001, 4000);
    // Lens shift (as on a tilt-shift lens) moves the subject off centre without turning the camera, so verticals stay parallel.
    projection[8] = -shift[0];
    projection[9] = -shift[1];
    const view = lookAt(pos, look);
    const viewProjection = multiply(projection, view);
    const longPx = Math.max(width, height);
    const f = focal / 1000, sharp = focus * metersPerUnit;
    // Blur-circle diameter on the sensor for a point at infinity, then converted to pixels; scaled per point by |z - s| / z.
    const coc = sharp > f ? (f / aperture) * f / (sharp - f) / (SENSOR_LONG / 1000) * longPx : 0;
    const tanCorner = tanLong * Math.hypot(1, Math.min(aspect, 1 / aspect));
    return { view, projection, viewProjection, inverse: invert(viewProjection), coc, tanCorner };
  }

  // World-space ray through a point given in normalised device coordinates.
  ray(inverse, x, y) {
    const unproject = z => {
      const m = inverse;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    const near = unproject(-1), far = unproject(1);
    return { origin: near, dir: normalize(sub(far, near)) };
  }
}

// Places a camera at azimuth/elevation around a point, `distance` away.
export function orbit(look, azimuth, elevation, distance) {
  return add(look, [Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance]);
}

// Distance that keeps a subject of `width` filling the same share of the frame at a given focal length: the dolly zoom.
export const framingDistance = (width, focal) => width * focal / SENSOR_LONG;
