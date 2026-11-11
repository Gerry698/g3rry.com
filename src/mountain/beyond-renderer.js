import { program, precompile, vertexArray } from './gl.js';
import * as sources from './beyond-shaders.js';
import { HEART, MOON, spaceMoon } from './beyond.js';
import { hexToLinear, lerp, clamp, smoothstep, mix3, normalize, cross, add, sub, scale, length, easeInOut } from './math.js';

// Draws the chapters off the trail that beyond.js built: the chamber of the Heart (a frame of its own, in place of
// the mountain) and, outdoors and out past the air, the moon, home, and the line of stars between them.
const PROGRAMS = {
  rock: ['rockVertex', 'rockFragment'], crystal: ['crystalVertex', 'crystalFragment'], pool: ['poolVertex', 'poolFragment'],
  mote: ['moteVertex', 'moteFragment'], shaft: ['shaftVertex', 'shaftFragment'], moon: ['orbVertex', 'moonFragment'], home: ['orbVertex', 'homeFragment']
};
export const warmUpBeyond = gl => precompile(gl, Object.values(PROGRAMS).map(([vertex, fragment]) => [sources[vertex], sources[fragment]]));

const GOLD = hexToLinear('#ffc978'), COOL = hexToLinear('#8fb4ff'), SEAM = hexToLinear('#7fe0d8').map(c => c * 1.5), DEEP = hexToLinear('#157a85');
// The beat as the shaders see it (beyond-shaders.js, beatAt), at the heart itself.
export function heartBeat(time) {
  const t = ((time % HEART.period) + HEART.period) % HEART.period;
  return Math.exp(-t * 3.2) * smoothstep(0, .07, t) + .6 * Math.exp(-Math.max(t - .34, 0) * 4.2) * smoothstep(.34, .4, t);
}

// glow: the renderer's own sprite program (shaders.js, glowVertex), which the heart's halo and the stars reuse.
export function createBeyond(gl, scene, quality, glow) {
  const programs = Object.fromEntries(Object.entries(PROGRAMS).map(([name, [vertex, fragment]]) => [name, program(gl, sources[vertex], sources[fragment], name)]));
  const empty = gl.createVertexArray();
  const bytes = { size: 4, type: gl.UNSIGNED_BYTE, normalized: true };
  const sprites = count => {
    const data = new Float32Array(count * 4), colors = new Float32Array(count * 4);
    return { data, colors, count, array: vertexArray(gl, [{ data, size: 4, divisor: 1, usage: gl.DYNAMIC_DRAW }, { data: colors, size: 4, divisor: 1, usage: gl.DYNAMIC_DRAW }]) };
  };
  const drawSprites = (set, common) => {
    set.array.update(0, set.data);
    set.array.update(1, set.colors);
    glow.use().set(common);
    gl.bindVertexArray(set.array.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, set.count);
  };

  // ---- The chamber ---------------------------------------------------------------------------------------------------
  const chamber = scene.chamber && {
    shell: vertexArray(gl, [{ data: scene.chamber.shell.positions, size: 3 }, { data: scene.chamber.shell.colors, ...bytes }]),
    crystals: vertexArray(gl, [{ data: scene.chamber.crystals.positions, size: 3 }, { data: scene.chamber.crystals.colors, ...bytes }, { data: scene.chamber.crystals.data, size: 4 }]),
    halo: sprites(2), drips: new Float32Array(16).fill(-100), next: 0
  };
  // A drop lands on the pool at (x, z); its rings spread for a few seconds.
  function drip(x, z, time, strength = 1) {
    if (!chamber) return;
    chamber.drips.set([x, z, time, strength], chamber.next * 4);
    chamber.next = (chamber.next + 1) % 4;
  }

  // The whole frame while the lens is inside: the reflection first (the chamber turned over under the water), the
  // chamber itself, the pool's surface over the reflection, then the light in the air.
  function drawChamber(frame, common) {
    const time = frame.time, calm = frame.beyond.calm, beat = heartBeat(time) * (calm ? .3 : 1), eye = frame.eye;
    const uniforms = {
      uViewProj: frame.viewProj, uHeart: [...HEART.at, .95], uBeat: [time, HEART.period, calm ? .3 : 1], uHeartColor: GOLD, uCool: COOL, uWater: HEART.water,
      uTime: calm ? 0 : time, uSeam: SEAM, uEras: scene.chamber.eras, uShards: scene.chamber.eras, uHeight: common.uHeight, uDeep: DEEP, uDrips: chamber.drips,
      uShaft: [7.2, .5, 1., .16]
    };
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const mirror of [1, 0]) {
      const view = { ...uniforms, uMirror: mirror, uEye: mirror ? [eye[0], 2 * HEART.water - eye[1], eye[2]] : eye };
      programs.rock.use().set(view);
      gl.bindVertexArray(chamber.shell.vao);
      gl.drawArrays(gl.TRIANGLES, 0, scene.chamber.shell.count);
      programs.crystal.use().set(view);
      gl.bindVertexArray(chamber.crystals.vao);
      gl.drawArrays(gl.TRIANGLES, 0, scene.chamber.crystals.count);
    }
    const open = { ...uniforms, uMirror: 0, uEye: eye, uTime: time };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(empty);
    programs.pool.use().set(open);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    programs.shaft.use().set(open);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    programs.mote.use().set(open);
    gl.drawArrays(gl.POINTS, 0, quality.samples > 1 ? 220 : 120);
    const lift = calm ? 0 : Math.sin(time * .45) * .05, at = [HEART.at[0], HEART.at[1] + lift, HEART.at[2]];
    chamber.halo.data.set([...at, 2.2, ...at, .5]);
    chamber.halo.colors.set([...GOLD.map(c => c * (.16 + .22 * beat)), 0, ...GOLD.map(c => c * (.16 + .36 * beat)), 0]);
    drawSprites(chamber.halo, common);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  // ---- The moon, home, and the way between ------------------------------------------------------------------------
  const summit = scene.camps.at(-1), top = [summit.x, summit.y + .8, summit.z];
  // Moonward's places: the moon as a body of its own a long way off, and home behind (beyond.js). Aimed afresh each
  // time the lens sets off (aim below).
  let away = spaceMoon([summit.x, summit.y, summit.z]);
  // A line of stars from the summit's flag out to the moon, bowed like a thrown rope: the way the lens goes. From the
  // far side, looking back, it runs from home up towards the moon's edge. Every seventh is a brighter one, so it
  // reads as a constellation rather than a dotted rule.
  const STARS = 56, stars = sprites(STARS), way = [], lamps = sprites(2);
  function layWay() {
    // It ends over the far side, where the lens comes to rest, to the left of the view back; on the way it rises well
    // clear of the moon's edge, so from there it is an arc across the sky from home.
    const end = add(away.center, add(scale(away.side, away.radius * 2.6), add(scale(away.up, away.radius * 1.9), scale(away.toward, away.radius * .6))));
    const bow = add(mix3(top, end, .45), add(scale(away.side, away.radius * 2.4), scale(away.up, away.radius * 1.1)));
    way.length = 0;
    for (let i = 0; i < STARS; i++) {
      const t = ((i + 1.5) / (STARS + 1.5)) ** 1.25, a = mix3(top, bow, t), b = mix3(bow, end, t);
      way.push(mix3(a, b, t));
    }
  }
  layWay();
  // The moon's place out there, the way the lens is about to go (a direction from the summit; none for the usual one).
  function aim(direction = null) { away = spaceMoon([summit.x, summit.y, summit.z], direction); layWay(); }

  // Where the moon is in this frame. On the mountain it is far off where the hour puts it. Leaving for it (sky from 0
  // to 1) it becomes the place the lens is flying to and grows to its own size on the way; if the hour had it under the
  // horizon, or somewhere else in the sky (beyond.stay going to 0: it fades from there first), it comes out of the dark
  // ahead instead.
  function moonState(frame) {
    const p = frame.palette, space = clamp(frame.beyond?.sky || 0, 0, 1), come = easeInOut(space), stay = frame.beyond?.stay ?? 1;
    const ahead = add(top, scale(away.toward, MOON.distance)), far = stay > .5 ? mix3(ahead, add(top, scale(p.moonDir, MOON.distance)), p.moon) : ahead;
    // It takes its place early, while it is still small, so the lens can keep it in the middle of the frame all the
    // way; it grows over the whole flight.
    const center = mix3(far, away.center, smoothstep(0, .3, space)), radius = lerp(MOON.radius, away.radius, come * come);
    const toMoon = sub(center, frame.eye), distance = length(toMoon), dir = scale(toMoon, 1 / distance);
    return { center, radius, dir, size: Math.asin(Math.min(1, radius / distance)), come, space, stay: Math.abs(stay * 2 - 1), reveal: stay > .5 ? 0 : frame.beyond?.reveal || 0, phase: frame.beyond?.phase ?? come };
  }

  // A turn about an axis, as the world-to-body matrix the shaders want (column-major).
  const turned = (axis, angle) => {
    const [x, y, z] = axis, c = Math.cos(-angle), sn = Math.sin(-angle), k = 1 - c;
    return [c + x * x * k, y * x * k + z * sn, z * x * k - y * sn, x * y * k - z * sn, c + y * y * k, z * y * k + x * sn, x * z * k + y * sn, y * z * k - x * sn, c + z * z * k];
  };
  // A body is one full-screen pass that keeps the pixels on it and writes their depth, so the mountain stands in front.
  const drawOrb = (name, common, uniforms) => {
    programs[name].use().set({ uViewProj: common.uViewProj, uInvViewProj: common.uInvViewProj, uCamPos: common.uCamPos, uPixel: common.uPixel, ...uniforms });
    gl.depthMask(true);
    gl.bindVertexArray(empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(false);
  };

  // After the opaque scene and before the clouds, which pass in front of it. veil: how much of it the valley's sky
  // hides when the lens is under the cloud deck (0 none).
  function drawMoon(frame, common, state, veil = 0) {
    const p = frame.palette, power = Math.max(p.moon * (1 - veil) * state.stay, state.reveal, smoothstep(.02, .3, state.space));
    if (power < .01) return;
    // From the mountain it is the full moon it is (opposite the sun, weather.js), lit from nearly behind the lens, a
    // little from the left, so only a sliver of its right edge is in shadow and its markings, not its relief, show; and
    // it is seen through the air. Out there the sun is a place, and the shadows keep still as the lens moves.
    const right = normalize(cross(state.dir, [0, 1, 0])), up = cross(right, state.dir);
    const look = normalize(add(scale(state.dir, -1), add(scale(right, -.3), scale(up, .1))));
    const air = 1 - smoothstep(.02, .3, state.space);
    // Out there the ground slides slowly under the lens, as from an orbit.
    const drift = frame.beyond?.calm ? 0 : frame.time * .0045 * state.come;
    drawOrb('moon', common, {
      uOrb: [...state.center, state.radius], uOrbTurn: turned(away.side, .9 + drift), uOrbLight: normalize(mix3(look, away.light, state.phase)),
      // From the mountain a soft-lit disc, as bright against the frame whatever the lens is exposed for; come near, it is dimmed until its plains and craters show in the light.
      uOrbColor: [1, .97, .9].map(c => c * lerp(.38 * Math.min(2, (1.2 / p.exposure) ** .8), .42, state.come)), uOrbShade: [.012, .017, .034].map(c => c * (1 - .55 * state.come)),
      uOrbPower: [power, Math.max(smoothstep(.3, .9, p.moon), state.reveal, smoothstep(.05, .35, state.space))], uOrbDetail: quality.samples > 1 ? 1 : 0,
      uOrbAir: air, uOrbSoft: lerp(1, 2.2, air)
    });
  }

  // Home, once the mountain itself has gone dark behind the lens: a small world where the mountain was, the summit's
  // lantern still showing on the side that faces the moon.
  function drawHome(frame, common, state) {
    // It stays until the mountain itself is back in sight (renderer.js draws the world again under space .5).
    const power = smoothstep(.44, .72, state.space);
    if (power < .01) return;
    const { center, radius, summit: lamp } = away.home;
    drawOrb('home', common, { uOrb: [...center, radius], uOrbTurn: turned([0, 1, 0], frame.beyond?.calm ? 0 : frame.time * .01), uOrbLight: away.light, uOrbPower: [power, power], uOrbSoft: 1 });
    const beat = frame.beyond?.calm ? 1 : 1 + .25 * Math.sin(frame.time * 1.7);
    lamps.data.set([...lamp, radius * .34, ...lamp, radius * .34]);
    lamps.colors.set([.9 * power * beat, .54 * power * beat, .23 * power * beat, 0, 0, 0, 0, 0]);
    drawSprites(lamps, common);
  }

  // The stars of the way light one after another as the lens leaves the summit, gold at the flag and pale at the moon.
  function drawWay(frame, common) {
    const come = frame.beyond?.sky || 0, call = frame.beyond?.skyCall || 0;
    if (come < .01 && call < .01) return;
    for (let i = 0; i < STARS; i++) {
      const t = i / (STARS - 1), bright = i % 7 === 3;
      // Called (a nudge at the summit), only the first few show, as a hint of where it goes.
      const lit = Math.max(smoothstep(t - .12, t, come * 1.14), call * smoothstep(.3, .06, t) * .8);
      const twinkle = frame.beyond?.calm ? 1 : .8 + .2 * Math.sin(frame.time * (1.3 + (i % 5) * .4) + i * 2.1);
      // Seen from the moon the first of them would lie across home's own disc: those are left to the summit's lantern.
      const clear = come > .5 && length(sub(way[i], away.home.center)) < away.home.radius * 1.35 ? 0 : 1;
      const tone = mix3([1, .6, .26], [.75, .85, 1], smoothstep(.05, .5, t)), power = lit * twinkle * clear * (bright ? 3.4 : 1.25);
      // Sized by how far off they are, so they look the same from the summit (points by the flag, not lamps in the
      // lens) as from the moon, where every seventh stands out.
      stars.data.set([...way[i], length(sub(way[i], frame.eye)) * (bright ? .0075 : .0034)], i * 4);
      stars.colors.set([tone[0] * power, tone[1] * power, tone[2] * power, 0], i * 4);
    }
    drawSprites(stars, common);
  }

  return { drawChamber, drip, moonState, drawMoon, drawHome, drawWay, hasMoon: true, aim, get away() { return away; }, drops: scene.chamber?.drips || null };
}
