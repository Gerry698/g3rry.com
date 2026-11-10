import { PALETTES, blend } from './palettes.js';
import { createTerrain } from './terrain.js';
import { program, texture, framebuffer, vertexArray } from './gl.js';
import { chunks } from './shaders.js';
import { weatherShaders } from './weather-shaders.js';
import { TAU, clamp, lerp, smoothstep, mix3, add, scale, dot, random, noise2 } from './math.js';

// Weather below the cloud deck. Above the deck the climb keeps its designed hour per camp (palettes.js); below it,
// over the valley floor and the lower slopes, the world follows the visitor's own clock and the day's weather:
// clear, cloud, fog, rain or snow. The deck is a layer of puffs at DECK (about 1,700 m on the altitude meter) that
// thickens with the cover; rain and snow fall only beneath it, wet ground darkens, snow settles on the valley.
// Climbing past Camp II the valley fades back into the climb's own palette, so the summit is exactly as designed.

export const DECK = 2.35;
const BAND = .6;
export const KINDS = ['clear', 'cloud', 'fog', 'rain', 'snow'];

// Chances of clear, cloud, fog, rain and snow by month, for a temperate mountain valley.
const CLIMATE = [
  [.30, .24, .14, .08, .24], [.30, .24, .12, .12, .22], [.34, .26, .10, .20, .10], [.40, .26, .08, .24, .02],
  [.46, .24, .06, .24, 0], [.56, .20, .04, .20, 0], [.62, .16, .04, .18, 0], [.60, .18, .06, .16, 0],
  [.50, .22, .12, .16, 0], [.40, .24, .18, .16, .02], [.32, .26, .18, .14, .10], [.28, .24, .16, .10, .22]
];
// The visitor's season: time zones south of the equator get the months turned half a year.
const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
const southern = /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Noumea)|^America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima)|^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Lusaka|Gaborone)|^Indian\/(Mauritius|Reunion)/.test(zone);

// The day's weather: the one place to plug in a real source later. Deterministic per calendar day, so everyone
// visiting on the same local date sees the same sky, and a reload never changes it.
export function weatherFor(date = new Date()) {
  const next = random(date.getFullYear() * 512 + date.getMonth() * 32 + date.getDate());
  next();
  let roll = next(), kind = 'clear';
  for (const [i, chance] of CLIMATE[(date.getMonth() + (southern ? 6 : 0)) % 12].entries()) {
    if (roll < chance) { kind = KINDS[i]; break; }
    roll -= chance;
  }
  return { kind, intensity: .35 + next() * .65 };
}

// Sunrise and sunset in local clock hours for a mid-latitude valley, longest at the June solstice (December south).
// One pair per calendar day, so they hold still through the day (the sky menu draws its dial from them).
function daylight(date) {
  const day = Math.floor((date - new Date(date.getFullYear(), 0, 1)) / 864e5);
  const summer = Math.cos((day - 172) / 365.25 * TAU) * (southern ? -1 : 1);
  return { rise: 6.5 - summer * .7, set: 18.65 + summer * 1.8 };
}

// The valley's state for the page: the day's weather and the local hour, unless the query, the sky menu or the debug
// API set them (?weather=clear|cloud|fog|rain|snow, ?hour=0..24).
export function conditions(params, reduced) {
  const pick = value => KINDS.includes(value) ? value : null;
  const hourOf = value => value === null || value === '' || !Number.isFinite(+value) ? null : clamp(+value, 0, 24);
  let kind = pick(params.get('weather')), intensity = null, hour = hourOf(params.get('hour'));
  // version counts changes of weather by hand; drift says whether the latest eases in (the sky menu) or shows at once
  // (the debug API). The hour is read afresh every frame and needs neither.
  let cache = null, version = 0, drift = false;
  return {
    now(date = new Date()) {
      const second = Math.floor(date / 1000);
      if (cache?.second !== second) {
        const today = weatherFor(date);
        cache = {
          second, kind: kind || today.kind, intensity: intensity ?? (kind ? .8 : today.intensity), today: today.kind,
          hour: hour ?? date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600, light: daylight(date),
          manual: kind !== null || hour !== null
        };
      }
      return { ...cache, version, drift, calm: reduced.matches };
    },
    set(nextKind, nextIntensity, eased = false) { kind = pick(nextKind); intensity = Number.isFinite(nextIntensity) ? clamp(nextIntensity, 0, 1) : null; cache = null; version++; drift = eased; },
    setHour(value) { hour = hourOf(value ?? null); cache = null; },
    // Back to the visitor's own clock and the day's own weather.
    reset() { kind = null; intensity = null; hour = null; cache = null; version++; drift = true; }
  };
}

// Between two hours the colours mix in a perceptual (square-root) space: in linear light the bright dawn would
// swamp the night and pass through a muddy brown.
const COLORS = ['keyColor', 'glow', 'zenith', 'horizon', 'below', 'ambSky', 'ambGround', 'tint', 'cloud'];
function mixHours(a, b, t) {
  const out = blend(a, b, t);
  for (const name of COLORS) out[name] = a[name].map((x, c) => lerp(Math.sqrt(x), Math.sqrt(b[name][c]), t) ** 2);
  return out;
}

// The hour's palette, from the climb's own: night, dawn around sunrise, morning, noon, golden hour, dusk.
function hourPalette(hour, { rise, set }) {
  const noon = (rise + set) / 2;
  const keys = [[rise - 1.3, 'night'], [rise - .1, 'dawn'], [rise + .8, 'dawn'], [rise + 2.8, 'morning'], [noon - 1, 'noon'],
    [noon + 1.5, 'noon'], [set - 1.1, 'golden'], [set + .2, 'dusk'], [set + 1.3, 'night']];
  const h = hour < keys[0][0] ? hour + 24 : hour;
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, a] = keys[i], [h1, b] = keys[i + 1];
    if (h >= h0 && h < h1) return mixHours(PALETTES[a], PALETTES[b], smoothstep(h0, h1, h));
  }
  return mixHours(PALETTES.night, PALETTES.night, 0);
}

// What each weather does below the deck: cover of the deck's puffs, how overcast and how dim the light is, the fog
// density, wetness, snow cover on the ground, and the strength of the rain or snow falling.
function amounts(kind, i) {
  const base = { cover: .05, overcast: 0, dim: 1, cool: 0, fog: .004, wet: 0, snow: 0, rain: 0, flakes: 0 };
  if (kind === 'cloud') return { ...base, cover: .45 + .4 * i, overcast: .55 + .4 * i, dim: .88 - .18 * i, cool: .3, fog: .012 };
  if (kind === 'fog') return { ...base, cover: .4 + .3 * i, overcast: .92, dim: 1, cool: .3, fog: .3 + .45 * i, wet: .12 };
  if (kind === 'rain') return { ...base, cover: .55 + .3 * i, overcast: .85 + .15 * i, dim: .6 - .16 * i, cool: 1, fog: .025 + .02 * i, wet: .55 + .45 * i, rain: .45 + .55 * i };
  if (kind === 'snow') return { ...base, cover: .5 + .3 * i, overcast: .8 + .15 * i, dim: .95, cool: .6, fog: .025 + .02 * i, snow: .55 + .45 * i, flakes: .45 + .55 * i };
  return base;
}

const luma = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
// Overcast turns the sun into diffuse skylight and the sky into an even grey of the same brightness that keeps some of
// the hour's hue (a neutral grey reads as khaki beside the night's blues), cooler and greyer in rain.
function overcast(p, a) {
  const o = a.overcast, k = a.dim;
  const grey = (c, gain) => {
    const l = luma(c);
    return mix3([l * (.96 - a.cool * .06), l * .98, l * (1.03 + a.cool * .08)], c, .45 - a.cool * .35).map(v => v * gain * k);
  };
  return {
    ...p,
    zenith: mix3(p.zenith, grey(p.horizon, 1.05), o), horizon: mix3(p.horizon, grey(p.horizon, 1), o), below: mix3(p.below, grey(p.below, 1), o),
    glow: scale(p.glow, 1 - o), keyColor: scale(p.keyColor, 1 - .9 * o),
    ambSky: mix3(p.ambSky, grey(add(p.ambSky, scale(p.keyColor, .3)), 1.05), o), ambGround: mix3(p.ambGround, grey(p.ambGround, 1), o),
    cloud: mix3(p.cloud, grey(p.cloud, .85), o), saturation: p.saturation * (1 - .35 * o)
  };
}

// The weather's effects fade with the valley's presence; the light's character is in the palette blend instead.
const scaled = (a, presence) => Object.fromEntries(Object.entries(a).map(([name, value]) => [name, ['dim', 'overcast', 'cool'].includes(name) ? value : value * presence]));

// The shared shaders' valley uniforms (all but the shadow map) for the weather, its eased amounts, the climb's
// palette in this frame, the valley's presence and how far the lens is above the deck (0 under it, 1 well above).
// Seen from above the deck the valley's light leans halfway to the climb's, so a noon valley under the summit's
// night reads as the same world rather than a pasted-in photograph; under the deck it is the visitor's hour in full.
const ABOVE = .5;
function valleyUniforms(sky, eased, camp, presence, above = 0) {
  const v = blend(camp, overcast(sky ? hourPalette(sky.hour, sky.light) : camp, eased), presence * (1 - ABOVE * above));
  // The frame is exposed and graded for the climb's palette; the valley's light is scaled to look as its own would.
  // An overcast valley keeps the frame's colour grade, so its greys sit with the climb's colours instead of against them.
  const tint = mix3(v.tint, camp.tint, eased.overcast);
  const gain = [0, 1, 2].map(c => v.exposure / camp.exposure * tint[c] / camp.tint[c]);
  const lit = color => color.map((value, c) => value * gain[c]);
  const a = scaled(eased, presence);
  return {
    uDeck: [DECK, BAND, a.cover, presence], uLowAir: [a.fog, v.saturation / camp.saturation, a.wet, a.snow],
    uLowFog: [DECK - .1, .9, .12 + eased.overcast * .5 * presence, 0],
    uLowKeyDir: v.key, uLowKeyColor: lit(v.keyColor), uLowAmbSky: lit(v.ambSky), uLowAmbGround: lit(v.ambGround), uLowZenith: lit(v.zenith),
    uLowHorizon: lit(v.horizon), uLowBelow: lit(v.below), uLowGlow: lit(v.glow), uLowSunDir: v.sun, uLowCloud: v.cloud
  };
}

// Puffs for the deck, stride 5 like the scene's clouds. Their seed is 1 + the cover at which they appear; a noise
// field orders them, so a thin deck gathers in banks and a thick one closes the gaps.
function deckPuffs(terrain, count, seed = 29) {
  const next = random(seed), field = noise2(seed), out = [];
  for (let tries = 0; out.length < count * 5 && tries < count * 40; tries++) {
    const angle = next() * TAU, r = 6.5 + Math.pow(next(), .85) * 38;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    if (terrain.height(x, z) > DECK - .5) continue;
    const order = clamp(.5 + field(x * .1, z * .1) * .55 + (next() - .5) * .4, 0, .99);
    out.push(x, DECK - .25 + (next() - .5) * .3, z, .9 + next() * 1.1, 1 + order);
  }
  return out;
}

// Rain shafts around the valley, stride 4 (x, ground height, z, half width), each with the strength it appears at.
function curtains(terrain, count, seed = 31) {
  const next = random(seed), shafts = [], seeds = [];
  for (let tries = 0; seeds.length < count && tries < count * 30; tries++) {
    const angle = next() * TAU, r = 8 + next() * 28;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r, ground = terrain.height(x, z);
    if (ground > DECK - .8) continue;
    shafts.push(x, ground - .1, z, .6 + next() * .7);
    seeds.push(next() * .8);
  }
  return { shafts: new Float32Array(shafts), seeds: new Float32Array(seeds), count: seeds.length };
}

// Farms and hamlets on the valley floor, stride 4: position just above the ground, and the share of lights at which
// this one is on (late at night most go dark).
function hamlets(terrain, count = 40, seed = 37) {
  const next = random(seed), out = [];
  for (let found = 0, tries = 0; found < count && tries < 600; tries++) {
    const angle = next() * TAU, r = 10 + next() * 32;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    if (terrain.height(x, z) > DECK - 1 || terrain.slope(x, z) > .35 || terrain.water.wet(x, z, .8)) continue;
    found++;
    for (let i = 0, lights = 1 + Math.floor(next() * 5); i < lights; i++) {
      const lx = x + (next() - .5) * .8, lz = z + (next() - .5) * .8;
      out.push(lx, terrain.height(lx, lz) + .3, lz, next() * .95);
    }
  }
  return new Float32Array(out);
}
// The share of windows lit at a local hour: all of them through the evening, a third in the small hours, more again
// for early risers, none in daylight.
function windows(hour, { rise, set }) {
  const dark = Math.max(1 - smoothstep(rise - 1, rise + .3, hour), smoothstep(set - .2, set + .9, hour));
  const t = (hour + 12) % 24;
  return dark * (1 - .65 * smoothstep(11, 13.5, t) + .35 * smoothstep(17, 18.5, t));
}

const SOURCES = weatherShaders(chunks);
const PROGRAMS = {
  rain: ['rainVertex', 'rainFragment'], flakes: ['flakeVertex', 'flakeFragment'], curtain: ['curtainVertex', 'curtainFragment'], lights: ['lightVertex', 'lightFragment']
};
// For the renderer's warm-up, so the driver compiles these with everything else.
export const weatherSources = Object.values(PROGRAMS).map(([vertex, fragment]) => [SOURCES[vertex], SOURCES[fragment]]);

// The GL side. Adds the deck's puffs to scene.clouds (call before the renderer builds its cloud buffers); update()
// returns the uniforms the shared shaders need each frame.
export function createWeather(gl, scene, quality) {
  const terrain = createTerrain();
  // Fewer, on phones: every puff is overdraw across a large part of the frame.
  const deck = deckPuffs(terrain, Math.round(quality.clouds * (quality.samples > 1 ? .9 : .6)));
  const clouds = new Float32Array(scene.clouds.length + deck.length);
  clouds.set(scene.clouds);
  clouds.set(deck, scene.clouds.length);
  scene.clouds = clouds;

  const programs = Object.fromEntries(Object.entries(PROGRAMS).map(([name, [vertex, fragment]]) => [name, program(gl, SOURCES[vertex], SOURCES[fragment], name)]));
  const shafts = curtains(terrain, quality.clouds > 200 ? 72 : 48);
  const curtainArray = vertexArray(gl, [{ data: shafts.shafts, size: 4, divisor: 1 }, { data: shafts.seeds, size: 1, divisor: 1 }]);
  const lightPoints = hamlets(terrain), lightArray = vertexArray(gl, [{ data: lightPoints, size: 4 }]);
  const empty = gl.createVertexArray();
  const counts = { rain: Math.round(quality.snow * 1.5), flakes: Math.round(quality.snow * 1.3) };
  const shadowMap = texture(gl, quality.shadow, quality.shadow, { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, compare: true });
  const shadowTarget = framebuffer(gl, { depth: shadowMap });
  let shadowKey = null, lightMatrix = null, eased = null, last = 0, version = -1, rate = 2.5, uniforms = {}, live = null;

  function update(frame, renderShadow) {
    const sky = frame.weather, camp = frame.palette;
    const off = !sky || frame.hide?.has('weather');
    // The valley is all there from the trailhead to Camp II and fades into the climb's palette towards the summit.
    const presence = off ? 0 : 1 - smoothstep(1, scene.camps.length - 1, frame.markers.progress);
    // The day's weather turning over at midnight drifts in over a few seconds, a choice in the sky menu over about one;
    // a change through the debug API shows at once.
    const target = amounts(sky?.kind, sky?.intensity ?? 0);
    if (sky?.version !== version) rate = sky?.drift ? .8 : 0;
    const step = eased && rate ? clamp((frame.time - last) / rate, 0, 1) : 1;
    if (!rate) rate = 2.5;
    eased = Object.fromEntries(Object.entries(target).map(([name, value]) => [name, lerp(eased?.[name] ?? value, value, step)]));
    last = frame.time;
    version = sky?.version;
    const valley = valleyUniforms(sky, eased, camp, presence, smoothstep(DECK + .5, DECK + 3.5, frame.eye[1]));
    if (!shadowKey || dot(shadowKey, valley.uLowKeyDir) < .99998) { lightMatrix = renderShadow(valley.uLowKeyDir, shadowTarget); shadowKey = valley.uLowKeyDir.slice(); }
    live = { ...scaled(eased, presence), calm: sky?.calm, presence, windows: sky ? windows(sky.hour, sky.light) * presence : 0 };
    uniforms = { ...valley, uLowShadow: shadowMap, uLowLightMatrix: lightMatrix };
    return uniforms;
  }

  // Before the clouds, which pass in front of them: the valley's lights after dark, and the shafts under the deck.
  function drawUnderClouds(common, hide) {
    if (live.windows > .01 && !hide?.has('lights')) {
      programs.lights.use().set({ ...common, uLights: [live.windows, 2] });
      gl.bindVertexArray(lightArray.vao);
      gl.drawArrays(gl.POINTS, 0, lightPoints.length / 4);
    }
    const strength = Math.max(live.rain, live.flakes);
    if (strength < .01 || hide?.has('curtains')) return;
    programs.curtain.use().set({ ...common, uCurtain: [strength, live.flakes > live.rain ? 1 : 0, live.calm ? .08 : 1, DECK + .25] });
    gl.bindVertexArray(curtainArray.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, shafts.count);
  }

  // With the other particles: a box around the lens (only while it is near or under the deck) and a wide one over
  // the valley that takes over beyond it.
  const layers = [
    { near: true, size: [14, 8, 14], fade: [.5, 1.6, 4.5, 7], share: 1 },
    { near: false, center: [0, (.6 + DECK) / 2, 0], size: [72, DECK - .6, 72], fade: [5, 8, 38, 52], share: .9 }
  ];
  function drawPrecipitation(common) {
    if (live.rain < .01 && live.flakes < .01) return;
    gl.bindVertexArray(empty);
    const pixel = Math.max(1, common.uHeight / 760);
    for (const layer of layers) {
      if (layer.near && common.uCamPos[1] > DECK + 1.5) continue;
      const box = { uBoxCenter: layer.near ? common.uCamPos : layer.center, uBoxSize: layer.size, uBoxFade: layer.fade };
      if (live.rain > .01) {
        // Calm motion: slow short drops instead of streaks.
        programs.rain.use().set({ ...common, ...box, uRain: live.calm ? [.7, .035, live.rain, 1.6 * pixel] : [7.5, .24, live.rain * (layer.near ? 1 : .7), pixel] });
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, Math.round(counts.rain * layer.share));
      }
      if (live.flakes > .01) {
        programs.flakes.use().set({ ...common, ...box, uFlakes: live.calm ? [.12, .3, live.flakes, 0] : [.45, 1, live.flakes, 0] });
        gl.drawArrays(gl.POINTS, 0, Math.round(counts.flakes * layer.share * (layer.near ? 1 : 1.6)));
      }
    }
  }

  return { update, drawUnderClouds, drawPrecipitation, get uniforms() { return uniforms; }, get state() { return live; } };
}
