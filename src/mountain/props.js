import { hexToLinear, random, TAU } from './math.js';

// Small hand-built pieces for each camp: a tent, a cairn and a pennant on a pole; the summit gets a taller flag.
// Colours are stored as sqrt(linear) bytes, like the terrain. Alpha below 1 marks flag vertices (see propVertex).
const paint = hex => hexToLinear(hex).map(c => Math.round(Math.sqrt(c) * 255));
const COLORS = { canvas: paint('#e2703a'), canvasDark: paint('#b44f2a'), pole: paint('#3b2b22'), stone: paint('#8b8780'), stoneDark: paint('#6c6964'), flag: paint('#ffd27a'), summitFlag: paint('#f2f0ea') };

export function buildProps(terrain, camps) {
  const positions = [], colors = [];
  const next = random(41);
  const push = (points, color, alpha = 255) => {
    for (const p of points) { positions.push(...p); colors.push(...color, alpha); }
  };
  for (const camp of camps) {
    const out = [Math.cos(camp.angle), 0, Math.sin(camp.angle)], along = [-out[2], 0, out[0]];
    const at = (radial, tangent, lift = 0) => {
      const x = camp.x + out[0] * radial + along[0] * tangent, z = camp.z + out[2] * radial + along[2] * tangent;
      return [x, terrain.height(x, z) + lift, z];
    };
    const local = (origin, radial, tangent, up) => [origin[0] + out[0] * radial + along[0] * tangent, origin[1] + up, origin[2] + out[2] * radial + along[2] * tangent];
    if (!camp.summit) {
      // Tent: a ridge along the slope's contour, door facing out.
      const base = at(-.08, .02, -.01), w = .11, l = .15, h = .17;
      const a = local(base, -w, -l, 0), b = local(base, -w, l, 0), c = local(base, w, l, 0), d = local(base, w, -l, 0);
      const r0 = local(base, 0, -l * 1.08, h), r1 = local(base, 0, l * 1.08, h);
      push([a, b, r1, a, r1, r0], COLORS.canvasDark);
      push([d, r0, r1, d, r1, c], COLORS.canvas);
      push([a, r0, d], COLORS.canvas);
      push([b, c, r1], COLORS.canvasDark);
      cairn(at(.02, -.3, -.02), .07);
    }
    // Pole and pennant.
    const height = camp.summit ? .75 : .46, foot = at(camp.summit ? 0 : .14, camp.summit ? 0 : .2, -.02), t = .012;
    const top = [foot[0], foot[1] + height, foot[2]];
    for (let i = 0; i < 4; i++) {
      const a0 = i / 4 * TAU, a1 = (i + 1) / 4 * TAU;
      const p0 = [Math.cos(a0) * t, 0, Math.sin(a0) * t], p1 = [Math.cos(a1) * t, 0, Math.sin(a1) * t];
      push([[foot[0] + p0[0], foot[1], foot[2] + p0[2]], [top[0] + p0[0], top[1], top[2] + p0[2]], [top[0] + p1[0], top[1], top[2] + p1[2]],
        [foot[0] + p0[0], foot[1], foot[2] + p0[2]], [top[0] + p1[0], top[1], top[2] + p1[2]], [foot[0] + p1[0], foot[1], foot[2] + p1[2]]], COLORS.pole);
    }
    const length = camp.summit ? .34 : .22, drop = camp.summit ? .16 : .1, segments = 6;
    const flag = camp.summit ? COLORS.summitFlag : COLORS.flag;
    for (let s = 0; s < segments; s++) {
      const u0 = s / segments, u1 = (s + 1) / segments;
      const edge = u => [top[0] + along[0] * length * u, top[1] - drop * u * .5, top[2] + along[2] * length * u];
      const low = u => [top[0] + along[0] * length * u, top[1] - drop + drop * u * .5, top[2] + along[2] * length * u];
      const alpha = u => Math.round(u * .99 * 255);
      for (const [p, u] of [[edge(u0), u0], [low(u0), u0], [edge(u1), u1], [edge(u1), u1], [low(u0), u0], [low(u1), u1]]) {
        positions.push(...p); colors.push(...flag, alpha(u));
      }
    }
    if (camp.summit) cairn(at(.05, .12, -.02), .09);
  }
  function cairn(base, size) {
    let y = base[1];
    for (let i = 0; i < 3; i++) {
      const s = size * (1 - i * .24), h = s * .55, spin = next() * TAU;
      const ring = [0, 1, 2, 3].map(k => [base[0] + Math.cos(spin + k * TAU / 4) * s, y + h * .5, base[2] + Math.sin(spin + k * TAU / 4) * s]);
      const top = [base[0], y + h, base[2]], bottom = [base[0], y, base[2]];
      for (let k = 0; k < 4; k++) {
        const p = ring[k], q = ring[(k + 1) % 4];
        push([p, top, q], k % 2 ? COLORS.stone : COLORS.stoneDark);
        push([p, q, bottom], COLORS.stoneDark);
      }
      y += h * .9;
    }
  }
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), count: positions.length / 3 };
}
