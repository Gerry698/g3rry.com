import { program, precompile, vertexArray } from './gl.js';
import * as sources from './beyond-shaders.js';
import { HEART, MOON, nearMoon } from './beyond.js';
import { PALETTES } from './palettes.js';
import { hexToLinear, lerp, clamp, smoothstep, mix3, normalize, cross, add, sub, scale, length, easeInOut } from './math.js';

// Draws the chapters off the trail that beyond.js built: the chamber of the Heart (a frame of its own, in place of
// the mountain) and, outdoors, the moon and the line of stars that leads from the summit to it.
const PROGRAMS = {
  rock: ['rockVertex', 'rockFragment'], crystal: ['crystalVertex', 'crystalFragment'], pool: ['poolVertex', 'poolFragment'],
  mote: ['moteVertex', 'moteFragment'], shaft: ['shaftVertex', 'shaftFragment'], moon: ['moonVertex', 'moonFragment']
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

  // ---- The moon and the way to it --------------------------------------------------------------------------------
  const moon = scene.moon && vertexArray(gl, [{ data: scene.moon.positions, size: 3 }, { data: scene.moon.colors, ...bytes }]);
  const summit = scene.camps.at(-1), top = [summit.x, summit.y + .8, summit.z];
  const night = PALETTES.sky.moonDir, near = nearMoon([summit.x, summit.y, summit.z], Math.atan2(night[2], night[0]));
  // A line of stars from the summit's flag up to the moon's nearer limb, bowed like a thrown rope. Every seventh is a
  // brighter one, so it reads as a constellation rather than a dotted rule.
  const STARS = 50, stars = sprites(STARS), way = [];
  {
    const toward = normalize(sub(near.slice(0, 3), top)), end = sub(near.slice(0, 3), scale(toward, near[3] * 1.12));
    const side = normalize(cross(toward, [0, 1, 0])), bow = add(mix3(top, end, .5), add(scale(side, 9), [0, -7, 0]));
    for (let i = 0; i < STARS; i++) {
      const t = (i + 1.5) / (STARS + 1.5), a = mix3(top, bow, t), b = mix3(bow, end, t);
      way.push(mix3(a, b, t));
    }
  }

  // Where the moon is in this frame and how the sky should glow round it. near: 0 far off, 1 come close (Moonward).
  function moonState(frame) {
    const p = frame.palette, come = easeInOut(clamp(frame.beyond?.sky || 0, 0, 1));
    const center = mix3(scale(p.moonDir, MOON.distance), near, come), radius = lerp(MOON.radius, near[3], come);
    const toMoon = sub(center, frame.eye), distance = length(toMoon), dir = scale(toMoon, 1 / distance);
    return { center, radius, dir, size: Math.asin(Math.min(1, radius / distance)), come };
  }

  // After the opaque scene and before the clouds, which pass in front of it. veil: how much of it the valley's sky
  // hides when the lens is under the cloud deck (0 none).
  function drawMoon(frame, common, state, veil = 0) {
    const p = frame.palette, power = p.moon * (1 - veil);
    if (!moon || power < .01) return;
    // Lit from the side the frame's middle is on, a little from below: the sun has set.
    const right = normalize(cross(state.dir, [0, 1, 0])), up = cross(right, state.dir);
    const lightOn = normalize(add(scale(state.dir, -.42), add(scale(right, -.74), scale(up, -.36))));
    programs.moon.use().set({
      uViewProj: frame.viewProj, uMoon: [...state.center, state.radius], uMoonTurn: [Math.cos(2.2), Math.sin(2.2)], uMoonLight: lightOn,
      // Far off it is a bright disc; come near, it is dimmed until its plains and craters show in the light.
      uMoonColor: [1, .97, .9].map(c => c * lerp(1, .6, state.come)), uMoonShade: [.012, .017, .034], uMoonPower: [power, smoothstep(.3, .9, p.moon)]
    });
    // Its own depth, so its far side stays behind its near one.
    gl.depthMask(true);
    gl.bindVertexArray(moon.vao);
    gl.drawArrays(gl.TRIANGLES, 0, scene.moon.count);
    gl.depthMask(false);
  }

  // The stars of the way light one after another as the lens leaves the summit, gold at the flag and pale at the moon.
  function drawWay(frame, common) {
    const come = frame.beyond?.sky || 0, call = frame.beyond?.skyCall || 0;
    if (come < .01 && call < .01) return;
    for (let i = 0; i < STARS; i++) {
      const t = i / (STARS - 1), bright = i % 7 === 3;
      // Called (a nudge at the summit), only the first few show, as a hint of where it goes.
      const lit = Math.max(smoothstep(t - .12, t, come * 1.14), call * smoothstep(.42, .1, t) * .8);
      const twinkle = frame.beyond?.calm ? 1 : .8 + .2 * Math.sin(frame.time * (1.3 + (i % 5) * .4) + i * 2.1);
      const tone = mix3([1, .6, .26], [.75, .85, 1], smoothstep(.1, .7, t)), power = lit * twinkle * (bright ? 3.4 : 1.25);
      // Sized by how far off they are, so they look the same from the summit (points by the flag, not lamps in the
      // lens) as from Moonward, where every seventh stands out.
      stars.data.set([...way[i], length(sub(way[i], frame.eye)) * (bright ? .0075 : .0034)], i * 4);
      stars.colors.set([tone[0] * power, tone[1] * power, tone[2] * power, 0], i * 4);
    }
    drawSprites(stars, common);
  }

  return { drawChamber, drip, moonState, drawMoon, drawWay, hasMoon: Boolean(moon), near, drops: scene.chamber?.drips || null };
}
