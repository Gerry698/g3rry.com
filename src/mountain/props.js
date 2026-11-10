import { hexToLinear, random, TAU, add, sub, scale, normalize, cross } from './math.js';

// Small hand-built pieces for each camp: a tent and a pennant on a pole everywhere, plus one scene that says what
// the camp is about (camp.model). Colours are stored as sqrt(linear) bytes, like the terrain; the alpha byte marks
// emissive faces (255 is plain, lower glows more), which the shader lights on its own and flickers when fully lit.
const paint = hex => hexToLinear(hex).map(c => Math.round(Math.sqrt(c) * 255));
const COLORS = {
  canvas: paint('#e2703a'), canvasDark: paint('#b44f2a'), pole: paint('#3b2b22'), summitPole: paint('#9a9389'), flag: paint('#ffd27a'), summitFlag: paint('#f2f0ea'),
  wood: paint('#a7794b'), woodDark: paint('#5d4330'), stone: paint('#9c968c'), stoneLight: paint('#c4beb2'), stoneDark: paint('#7d786f'),
  ember: paint('#ff7a2a'), flame: paint('#ffc35a'), pack: paint('#a8452f'), packLight: paint('#c45f3f'), mat: paint('#3f6f8a'),
  camera: paint('#26272b'), cameraTop: paint('#8e8a84'), glass: paint('#7fa8c9'), paper: paint('#f4efe4'), line: paint('#d8d2c4'),
  metal: paint('#8d97a0'), metalDark: paint('#5f6870'), lamp: paint('#ffd08a'), mailFlag: paint('#d23c2c')
};
const MAILBOXES = ['#b8483a', '#3f6f8f', '#d9b44a', '#5e8c5a', '#e8e2d6', '#7a5c8e'].map(paint);
const PENNANTS = ['#ffd27a', '#f2f0ea', '#c8553d', '#4f9a94', '#4a6fa5'].map(paint);
export const MAX_PENNANTS = 12;

// Every vertex also carries a cloth attribute: how far along the cloth it is (0 on anything rigid), a wave phase whose
// whole part numbers a summit pennant (0 for everything else), and the sideways direction the shader waves it.
// extra(tools): draws whatever else stands on the mountain with the same tools (the door to the Heart, beyond.js).
export function buildProps(surface, camps, extra = null) {
  const positions = [], colors = [], flags = [], lights = [];
  let spark = null;
  const next = random(41);
  const push = (points, color, glow = 0, cloth = null) => {
    for (const p of points) {
      positions.push(...p); colors.push(...color, Math.round((1 - glow) * 255));
      flags.push(...(cloth ? cloth(p) : [0, 0, 0, 0]));
    }
  };
  const ground = (x, z, lift = 0) => [x, surface(x, z) + lift, z];
  // A tapered prism between two points; r1 = 0 makes a cone.
  const frustum = (a, b, r0, r1, sides, color, glow = 0, spin = 0) => {
    const axis = normalize(sub(b, a)), helper = Math.abs(axis[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
    const u = normalize(cross(axis, helper)), v = cross(axis, u);
    const ring = (center, r) => Array.from({ length: sides }, (_, i) => {
      const t = i / sides * TAU + spin;
      return add(center, add(scale(u, Math.cos(t) * r), scale(v, Math.sin(t) * r)));
    });
    const lower = ring(a, r0), upper = ring(b, r1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      push(r1 > 0 ? [lower[i], upper[i], upper[j], lower[i], upper[j], lower[j]] : [lower[i], b, lower[j]], color, glow);
      push([a, lower[j], lower[i]], color, glow);
      if (r1 > 0) push([b, upper[i], upper[j]], color, glow);
    }
  };
  // A box in a horizontal frame: x along axis, z across it, y up from base.
  const box = (base, axis, length, height, depth, color, side = color, glow = 0) => {
    const across = [-axis[2], 0, axis[0]];
    const corner = (sx, sy, sz) => add(base, add(scale(axis, sx * length / 2), add([0, sy * height, 0], scale(across, sz * depth / 2))));
    const c = [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]].map(([x, y, z]) => corner(x, y, z));
    push([c[4], c[5], c[6], c[4], c[6], c[7]], color, glow);
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) push([c[a], c[b], c[b + 4], c[a], c[b + 4], c[a + 4]], side, glow);
  };
  const light = (p, color, size, flicker) => lights.push(...p, size, ...color, flicker);

  camps.forEach((camp, index) => {
    const out = [Math.cos(camp.angle), 0, Math.sin(camp.angle)], along = [-out[2], 0, out[0]];
    const offset = (radial, tangent) => [camp.x + out[0] * radial + along[0] * tangent, camp.z + out[2] * radial + along[2] * tangent];
    const at = (radial, tangent, lift = 0) => { const [x, z] = offset(radial, tangent); return ground(x, z, lift); };
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
    }
    // Pole and flag. The summit pole is pale so it reads against the night sky instead of as a dark stub.
    const height = camp.summit ? .75 : .46, foot = at(camp.summit ? 0 : .14, camp.summit ? 0 : .2, -.04);
    const top = [foot[0], foot[1] + height + .04, foot[2]];
    frustum(foot, top, camp.summit ? .014 : .012, camp.summit ? .014 : .012, 4, camp.summit ? COLORS.summitPole : COLORS.pole);
    // Camps fly a tapering pennant; the summit flies a square-ended flag.
    const length = camp.summit ? .34 : .22, drop = camp.summit ? .18 : .11, taper = camp.summit ? .12 : .9, segments = 12;
    // v runs from the bottom edge (0) to the top edge (1); the bottom edge rises towards the tip by the taper.
    const cloth = (u, v) => [top[0] + along[0] * length * u, top[1] - .01 - drop * (1 - v) * (1 - taper * u), top[2] + along[2] * length * u];
    for (let s = 0; s < segments; s++) {
      const u0 = s / segments, u1 = (s + 1) / segments;
      for (const [u, v] of [[u0, 1], [u0, 0], [u1, 1], [u1, 1], [u0, 0], [u1, 0]]) {
        positions.push(...cloth(u, v)); colors.push(...(camp.summit ? COLORS.summitFlag : COLORS.flag), 255); flags.push(u, v, out[0] * length, out[2] * length);
      }
    }

    const toward = camps[index + 1] ? normalize([camps[index + 1].x - camp.x, 0, camps[index + 1].z - camp.z]) : along;
    if (camp.model === 'trailhead') {
      // A signpost pointing up the trail and back down to the valley, a pack against it, and a small fire.
      // The post stands on the side of the tent the trail leaves from, so its board points away from the flagpole.
      const side = Math.sign(toward[0] * along[0] + toward[2] * along[2]) || 1, post = at(.12, side * .46, -.03);
      frustum(post, add(post, [0, .52, 0]), .017, .015, 4, COLORS.woodDark, 0, TAU / 8);
      // Two boards on the same side of the post, a quarter turn apart: one up the trail, one along the valley.
      const aside = normalize(add(scale(toward, -.3), scale(out, .95)));
      [[toward, .45], [aside, .37]].forEach(([direction, y], i) => {
        const start = add(add(post, [0, y, 0]), scale(direction, .012)), end = add(start, scale(direction, .14));
        box(add(start, scale(direction, .07)), direction, .14, .045, .014, COLORS.wood, COLORS.woodDark);
        frustum(end, add(end, scale(direction, .045)), .034, 0, 4, COLORS.wood, 0, TAU / 8);
        if (i === 0) box(add(add(start, scale(direction, .06)), [0, .047, 0]), direction, .05, .004, .016, COLORS.flag);
      });
      const pack = at(.08, side * .32, -.01);
      box(pack, along, .1, .12, .07, COLORS.pack, COLORS.packLight);
      box(add(pack, [0, .12, 0]), along, .1, .025, .075, COLORS.packLight);
      frustum(add(pack, add(scale(along, -.06), [0, .15, 0])), add(pack, add(scale(along, .06), [0, .15, 0])), .022, .022, 6, COLORS.mat);
      const fire = at(.27, -.06, -.01);
      for (let i = 0; i < 7; i++) {
        const t = i / 7 * TAU, stone = add(fire, [Math.cos(t) * .075, 0, Math.sin(t) * .075]);
        frustum(stone, add(stone, [0, .025 + next() * .015, 0]), .022, .009, 5, i % 2 ? COLORS.stone : COLORS.stoneDark, 0, next());
      }
      for (let i = 0; i < 3; i++) {
        const t = i / 3 * TAU + .4, foot = add(fire, [Math.cos(t) * .06, .005, Math.sin(t) * .06]);
        frustum(foot, add(fire, [0, .1, 0]), .011, .006, 5, COLORS.woodDark);
      }
      frustum(add(fire, [0, .005, 0]), add(fire, [0, .02, 0]), .05, .04, 7, COLORS.ember, .85);
      [[0, 0, .14, .032], [.022, .012, .1, .024], [-.018, -.015, .085, .022]].forEach(([dx, dz, h, r]) => {
        const base = add(fire, [dx, .015, dz]);
        frustum(base, add(base, [0, h, 0]), r, 0, 5, h > .12 ? COLORS.flame : COLORS.ember, 1, next() * TAU);
      });
      light(add(fire, [0, .1, 0]), [1, .5, .18], .16, 1);
    }
    if (camp.model === 'photography') {
      // A camera on a tripod facing the view, and three prints drying on a line, each in a featured photograph's colour.
      const feet = at(.24, -.28, -.02), apex = add(feet, [0, .3, 0]);
      for (let i = 0; i < 3; i++) {
        const t = camp.angle + i / 3 * TAU + .5, [x, z] = [feet[0] + Math.cos(t) * .1, feet[2] + Math.sin(t) * .1];
        frustum(ground(x, z, -.02), apex, .008, .006, 4, COLORS.camera);
      }
      const facing = normalize(add(out, scale(along, .35)));
      box(add(apex, [0, .005, 0]), facing, .07, .062, .1, COLORS.camera);
      box(add(apex, [0, .067, 0]), facing, .03, .014, .035, COLORS.cameraTop);
      const lens = add(apex, add(scale(facing, .035), [0, .032, 0]));
      frustum(lens, add(lens, scale(facing, .05)), .026, .03, 8, COLORS.camera);
      frustum(add(lens, scale(facing, .05)), add(lens, scale(facing, .052)), .024, .024, 8, COLORS.glass, .35);
      const left = at(-.02, -.4, -.03), right = at(-.02, -.78, -.03);
      for (const stick of [left, right]) frustum(stick, add(stick, [0, .32, 0]), .01, .008, 4, COLORS.woodDark);
      const a = add(left, [0, .3, 0]), b = add(right, [0, .3, 0]);
      const rope = s => add(add(scale(a, 1 - s), scale(b, s)), [0, -.035 * 4 * s * (1 - s), 0]);
      for (let s = 0; s < 6; s++) frustum(rope(s / 6), rope((s + 1) / 6), .003, .003, 3, COLORS.line);
      const prints = camp.prints?.length ? camp.prints : ['#d9a35b', '#b8483a', '#e07b39'];
      prints.slice(0, 3).forEach((hex, i) => {
        const s = .28 + i * .22, hang = rope(s), w = .04, h = .1, inner = paint(hex);
        const corner = (t, down, lift = 0) => add(add(hang, scale(along, t)), add([0, -down, 0], scale(out, lift)));
        const cloth = p => [Math.min(1, (hang[1] - p[1]) / h), i * .3, out[0] * .1, out[2] * .1];
        push([corner(-w, 0), corner(w, 0), corner(w, h), corner(-w, 0), corner(w, h), corner(-w, h)], COLORS.paper, 0, cloth);
        push([corner(-w * .8, .012, .002), corner(w * .8, .012, .002), corner(w * .8, h * .78, .002), corner(-w * .8, .012, .002), corner(w * .8, h * .78, .002), corner(-w * .8, h * .78, .002)], inner, 0, cloth);
        box(add(hang, [0, -.012, 0]), along, .012, .022, .012, COLORS.wood);
      });
    }
    if (camp.model === 'phantom') {
      // A ring of standing stones; the points of light gather above it (drawn by the renderer's spark pass).
      const center = at(.16, -.4, -.02);
      for (let i = 0; i < 5; i++) {
        const t = i / 5 * TAU + .3, stone = ground(center[0] + Math.cos(t) * .17, center[2] + Math.sin(t) * .17, -.02);
        frustum(stone, add(stone, [0, .1 + next() * .1, 0]), .032, .018, 4, i % 2 ? COLORS.stoneLight : COLORS.stone, 0, next() * TAU);
      }
      frustum(center, add(center, [0, .03, 0]), .07, .06, 6, COLORS.stoneDark);
      spark = [center[0], center[1] + 1.15, center[2], .75];
      light(add(center, [0, .06, 0]), [.55, .6, 1], .12, .3);
    }
    if (camp.model === 'mailboxes') {
      // A row of mailboxes on their own posts, in different colours, two with their flags up, and a lamp.
      MAILBOXES.forEach((color, i) => {
        const t = -.2 - i * .1, foot = at(.14 + (i % 2) * .03, t, -.03), base = add(foot, [0, .2 + (i % 3) * .015, 0]);
        frustum(foot, base, .011, .01, 4, COLORS.woodDark, 0, TAU / 8);
        // A touch of the lamp's light on each box, so the colours still read once the sun is down.
        box(base, along, .072, .056, .088, color, color.map(c => Math.round(c * .82)), .12);
        const face = color.map(c => Math.round(c * .62));
        box(local(base, .046, 0, .006), along, .05, .036, .004, face, face, .1);
        const flagBase = local(base, .015, .038, .02);
        if (i === 1 || i === 4) box(flagBase, out, .012, .055, .006, COLORS.mailFlag);
        else box(flagBase, out, .05, .01, .006, COLORS.mailFlag);
      });
      const lampFoot = at(.2, -.12, -.03), lamp = add(lampFoot, [0, .3, 0]);
      frustum(lampFoot, lamp, .013, .011, 4, COLORS.woodDark, 0, TAU / 8);
      box(lamp, along, .045, .055, .045, COLORS.lamp, COLORS.lamp, .8);
      box(add(lamp, [0, .055, 0]), along, .06, .012, .06, COLORS.metalDark);
      light(add(lamp, [0, .03, 0]), [1, .62, .3], .12, .15);
    }
    if (camp.model === 'summit') {
      // The summit register: a pale cairn with a tin box, its lid open and lit from inside.
      let y = at(.2, .16)[1] - .015;
      const [cx, cz] = offset(.2, .16);
      for (let i = 0; i < 3; i++) {
        const s = .075 * (1 - i * .2), h = s * .55, spin = next() * TAU;
        frustum([cx, y, cz], [cx, y + h, cz], s, s * .55, 5, [COLORS.stoneLight, COLORS.stone, COLORS.stoneLight][i], 0, spin);
        y += h * .9;
      }
      const tin = [cx, y, cz];
      box(tin, along, .085, .045, .06, COLORS.metal, COLORS.metalDark);
      box(add(tin, [0, .044, 0]), along, .07, .002, .045, COLORS.lamp, COLORS.lamp, .9);
      const hinge = add(tin, add(scale(out, -.03), [0, .045, 0]));
      const lid = (t, lift) => add(hinge, add(scale(along, t), add(scale(out, -.012), [0, lift, 0])));
      push([lid(-.0425, 0), lid(.0425, 0), lid(.0425, .058), lid(-.0425, 0), lid(.0425, .058), lid(-.0425, .058)], COLORS.metal);
      light(add(tin, [0, .07, 0]), [1, .7, .38], .1, .2);
      // A string of pennants from the flagpole down to a stake; the renderer shows one per guestbook note.
      const from = add(top, [0, -.07, 0]), to = at(.75, -.5, .12);
      frustum(at(.75, -.5, -.03), to, .009, .007, 4, COLORS.woodDark);
      const string = s => add(add(scale(from, 1 - s), scale(to, s)), [0, -.07 * 4 * s * (1 - s), 0]);
      for (let s = 0; s < 8; s++) frustum(string(s / 8), string((s + 1) / 8), .0025, .0025, 3, COLORS.line);
      const side = normalize(cross(sub(to, from), [0, 1, 0]));
      for (let k = 0; k < MAX_PENNANTS; k++) {
        const s = (k + .5) / MAX_PENNANTS, p0 = string(s - .03), p1 = string(s + .03), tip = add(string(s), [0, -.1, 0]);
        const cloth = p => [Math.min(1, (p0[1] - p[1]) / .1), 2 * (k + 1) + .5, side[0] * .07, side[2] * .07];
        push([p0, p1, tip], PENNANTS[k % PENNANTS.length], 0, cloth);
      }
    }
  });
  extra?.({ push, frustum, box, ground, light, next });
  return {
    positions: new Float32Array(positions), colors: new Uint8Array(colors), flags: new Float32Array(flags), count: positions.length / 3,
    lights: new Float32Array(lights), spark
  };
}
