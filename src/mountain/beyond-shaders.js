// GLSL for the chapters off the trail (beyond.js): the chamber of the Heart and the moon. Linear HDR like the rest;
// the shared composite pass tone-maps. The chamber is its own small world, lit by the heart alone, so its passes
// take none of the mountain's sky, fog or shadows.
import { chunks, fullscreenVertex } from './shaders.js';

const { header, noise, corners } = chunks;

// The heart's light, shared by everything in the chamber. It beats: two close strokes, then rest. A point farther from
// the heart feels each beat a little later, so light travels out along the crystals and round the walls.
const heart = `
uniform vec4 uHeart;   // the heart's centre, and the strength of its light now
uniform vec3 uBeat;    // seconds since the last beat, seconds between beats, how hard it beats
uniform vec3 uEye, uHeartColor, uCool;
uniform float uWater, uMirror, uTime;
float beatAt(float delay) {
  float t = mod(uBeat.x - delay + uBeat.y * 4., uBeat.y);
  return (exp(-t * 3.2) * smoothstep(0., .07, t) + .6 * exp(-max(t - .34, 0.) * 4.2) * smoothstep(.34, .4, t)) * uBeat.z;
}
// The chamber is drawn twice: once as it is and once turned over under the water, as the pool's reflection.
vec4 placed(mat4 viewProj, vec3 world) {
  if (uMirror > .5) world.y = 2. * uWater - world.y;
  return viewProj * vec4(world, 1.);
}
`;
// Fragment shaders only (screen-space derivatives).
const facets = `
// The facet's own normal, turned to face the eye. (For the reflection uEye is the eye turned over, too.)
vec3 facet(vec3 world, out vec3 v, out float dist) {
  vec3 n = normalize(cross(dFdx(world), dFdy(world)));
  vec3 toEye = uEye - world;
  dist = length(toEye);
  v = toEye / dist;
  return dot(n, v) < 0. ? -n : n;
}
// What the water gives back is dimmer, and dimmer still the higher the thing it mirrors.
vec3 mirrored(vec3 color, vec3 world) { return uMirror > .5 ? color * .5 * exp(-(world.y - uWater) * .16) : color; }
`;

export const rockVertex = header + heart + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec4 vColor;
void main() {
  vWorld = aPosition;
  vColor = vec4(aColor.rgb * aColor.rgb, aColor.a);
  gl_Position = placed(uViewProj, aPosition);
}`;

export const rockFragment = header + noise + heart + facets + `
in vec3 vWorld;
in vec4 vColor;
out vec4 outColor;
uniform vec3 uSeam;
uniform float uEras;
void main() {
  if (vWorld.y < uWater) discard;
  vec3 v; float dist;
  vec3 n = facet(vWorld, v, dist);
  vec3 toHeart = uHeart.xyz - vWorld;
  float d = length(toHeart), facing = dot(n, toHeart / d);
  // The heart's light wraps a little round each facet and falls off with distance; the beat reaches it late.
  float diffuse = max(facing, 0.) * .8 + .2 * smoothstep(-.5, .6, facing);
  float beat = beatAt(d * .1);
  vec3 warm = uHeartColor * (uHeart.w + beat * .55) * diffuse * 5.2 / (1. + d * d * .42);
  // Cold light: a little from everywhere, more from above, most under the chimney.
  float under = max(n.y, 0.) * exp(-dot(vWorld.xz - uHeart.xz, vWorld.xz - uHeart.xz) * .1);
  vec3 cold = uCool * (.09 + .15 * (n.y * .5 + .5) + .3 * under);
  vec3 color = vColor.rgb * (warm + cold) * vColor.a;
  // The rock is wet: facets turned just so throw the heart back.
  color += uHeartColor * pow(max(dot(reflect(-v, n), toHeart / d), 0.), 9.) * (.16 + .2 * beat) / (1. + d * d * .12) * vColor.a;
  // The seams: one thin line of light round the walls for each era, wandering like strata. They brighten as each
  // beat passes them.
  float wander = sin(vWorld.x * 1.3 + vWorld.z * .7) * .07 + sin(vWorld.z * 2.3 - vWorld.x * 1.1) * .04;
  float s = (vWorld.y + wander - uWater) / .62 - .35, k = floor(s + .5);
  float line = (1. - smoothstep(0., fwidth(s) * 1.2 + .016, abs(s - k))) * step(.5, k) * step(k, uEras + .5) * smoothstep(.97, .7, abs(n.y));
  color += mix(uSeam, uHeartColor, beat * .6) * line * (.24 + .8 * beat);
  // The chamber's air swallows what is far.
  color = mix(color, uCool * .018, 1. - exp(-dist * .05));
  outColor = vec4(mirrored(color, vWorld), 1.);
}`;

export const crystalVertex = header + heart + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
layout(location = 2) in vec4 aData;   // group, how far along the light's way, shard number or seed, own glow
uniform mat4 uViewProj;
uniform float uShards;
out vec3 vWorld;
out vec3 vColor;
out vec4 vData;
mat2 turn(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main() {
  vec3 p = aPosition;
  if (aData.x < .5) {
    // The heart turns slowly and rides a slow swell.
    p.xz = turn(uTime * .06) * p.xz;
    p += uHeart.xyz + vec3(0., sin(uTime * .45) * .05, 0.);
  } else if (aData.x < 1.5) {
    // Each shard spins about itself and circles the heart on its own ring, at its own pace and height.
    float i = aData.z, a = uTime * (.1 + .014 * i) + i / max(uShards, 1.) * 6.2832 + sin(i * 4.1) * .3;
    p.xz = turn(uTime * .3 + i * 1.7) * p.xz;
    p.xy = turn(sin(i * 2.7) * .35) * p.xy;
    float ring = .98 + .12 * sin(i * 2.4 + 1.);
    p += uHeart.xyz + vec3(cos(a) * ring, .08 * sin(uTime * .37 + i * 1.9) + .24 * sin(i * 3.1 + .5), sin(a) * ring);
  }
  vWorld = p;
  vColor = aColor.rgb * aColor.rgb;
  vData = aData;
  gl_Position = placed(uViewProj, p);
}`;

export const crystalFragment = header + heart + facets + `
in vec3 vWorld;
in vec3 vColor;
in vec4 vData;
out vec4 outColor;
void main() {
  if (vWorld.y < uWater) discard;
  vec3 v; float dist;
  vec3 n = facet(vWorld, v, dist);
  vec3 toHeart = uHeart.xyz - vWorld;
  float d = max(length(toHeart), 1e-3);
  float rim = pow(1. - max(dot(n, v), 0.), 2.6);
  // No two facets send the same light back, and what each sends shifts as the lens moves: a cut stone's fire.
  float fire = .5 + .5 * sin(dot(reflect(-v, n), vec3(5.1, 7.3, 6.7)) * 2.3 + vData.z * 9.);
  vec3 color;
  if (vData.x < .5) {
    // The heart: lit from its middle, the beat running out to its points; white at the core, gold at the edges.
    float beat = beatAt(vData.y * .28);
    float inner = mix(1., .3, smoothstep(0., 1., vData.y));
    color = vColor * (uHeart.w * .9 + beat * 1.7) * inner * (.42 + .95 * fire);
    color += vec3(1., .93, .8) * rim * (.45 + beat * .8);
  } else if (vData.x < 1.5) {
    // A shard: its own tint, glowing from inside, and catching the heart on the side that faces it.
    float beat = beatAt(.32 + vData.z * .05);
    float lit = max(dot(n, toHeart / d), 0.);
    color = vColor * ((.5 + beat * 1.1) * vData.w * (.4 + .9 * fire) + uHeartColor * lit * 1.3);
    color += mix(vec3(1.), vColor, .5) * rim * (.3 + beat * .4);
  } else {
    // Grown on the rock: cold glass that the heart lights, with a little glow of its own that answers the beat.
    float beat = beatAt(d * .1 + .1);
    float facing = dot(n, toHeart / d), lit = max(facing, 0.) * .8 + .2 * smoothstep(-.4, .7, facing);
    color = vColor * (uHeartColor * (uHeart.w + beat * .6) * lit * 1.9 / (1. + d * d * .17) + uCool * .07) * (.4 + .8 * fire);
    color += vColor * vData.w * (.3 + 1.4 * beat) * mix(1.4, .4, vData.y);
    color += (uCool * .3 + uHeartColor * .4 / (1. + d * d * .2)) * rim * .4;
    color += uHeartColor * pow(max(dot(reflect(-v, n), toHeart / d), 0.), 24.) * 1.5 / (1. + d * d * .15);
  }
  color = mix(color, uCool * .018, 1. - exp(-dist * .04));
  outColor = vec4(mirrored(color, vWorld), 1.);
}`;

// The pool: a still sheet laid over the reflection drawn beneath it. Looking down it is dark and deep; towards the far
// wall it gives the chamber back. Drops from the roof spread rings across it.
export const poolVertex = header + corners + heart + `
uniform mat4 uViewProj;
out vec3 vWorld;
void main() {
  vec2 c = corners[gl_VertexID];
  vWorld = vec3(uHeart.x + c.x * 9., uWater, uHeart.z + c.y * 9.);
  gl_Position = uViewProj * vec4(vWorld, 1.);
}`;

export const poolFragment = header + heart + `
in vec3 vWorld;
out vec4 outColor;
uniform vec4 uDrips[4];   // x, z, when it fell, how hard
uniform vec3 uDeep;
void main() {
  vec3 toEye = uEye - vWorld;
  float dist = length(toEye), look = toEye.y / dist;
  float glance = pow(1. - clamp(look, 0., 1.), 3.);
  float rings = 0.;
  for (int i = 0; i < 4; i++) {
    float age = uTime - uDrips[i].z, r = distance(vWorld.xz, uDrips[i].xy), front = age * .55;
    if (age < 0. || age > 7.) continue;
    rings += sin((r - front) * 30.) * smoothstep(front + .04, front - .1, r) * smoothstep(front - 1.1, front - .1, r) * exp(-age * .8) * exp(-r * .5) * uDrips[i].w;
  }
  float d = distance(vWorld.xz, uHeart.xz);
  // The heart's light on the water under it, the beat spreading across the surface.
  vec3 glow = uHeartColor * (.05 + .1 * beatAt(d * .1)) / (1. + d * d * .5);
  vec3 body = uDeep * (.3 + .15 * glance) + glow * (1. - glance);
  float cover = mix(.7, .1, glance);
  vec3 color = body * cover + (uHeartColor * .5 + uCool * .25) * max(rings, 0.) * .35 * (.3 + glance);
  cover = clamp(cover + abs(rings) * .08, 0., 1.);
  outColor = vec4(color, cover);
}`;

// Dust in the chamber's air, lit as it drifts near the heart. Additive points.
export const moteVertex = header + noise + heart + `
uniform mat4 uViewProj;
uniform float uHeight;
out float vLight;
void main() {
  float id = float(gl_VertexID);
  vec3 seed = vec3(hash12(vec2(id, 1.9)), hash12(vec2(id, 6.7)), hash12(vec2(id, 3.1)));
  float bearing = seed.x * 6.2832 + uTime * (.012 + seed.z * .02), r = .5 + seed.y * 3.2;
  vec3 p = uHeart.xyz + vec3(cos(bearing) * r, (seed.z - .42) * 3.4 + sin(uTime * (.12 + seed.x * .1) + id) * .18, sin(bearing) * r);
  float d = distance(p, uHeart.xyz), dist = distance(p, uEye);
  vLight = (uHeart.w + beatAt(d * .1) * .8) / (1. + d * d * .35) * smoothstep(.25, .9, dist) * (.4 + .6 * seed.y) * step(uWater, p.y);
  gl_Position = uViewProj * vec4(p, 1.);
  gl_PointSize = clamp(uHeight * (.004 + seed.z * .005) / max(dist, .1), 1., 7.);
}`;

export const moteFragment = header + `
in float vLight;
out vec4 outColor;
uniform vec3 uHeartColor;
void main() {
  float a = smoothstep(.5, .05, length(gl_PointCoord - .5));
  outColor = vec4(uHeartColor * a * vLight * 1.3, 0.);
}`;

// The light that falls down the chimney onto the heart: a soft column turned to face the lens.
export const shaftVertex = header + corners + heart + `
uniform mat4 uViewProj;
uniform vec4 uShaft;   // top height, half width at the top, half width at the foot, strength
out vec2 vCorner;
out vec3 vWorld;
void main() {
  vec2 c = corners[gl_VertexID];
  float up = c.y * .5 + .5;
  vec3 foot = vec3(uHeart.x, uWater, uHeart.z), toEye = uEye - foot;
  vec3 side = normalize(vec3(-toEye.z, 0., toEye.x));
  vWorld = foot + side * c.x * mix(uShaft.z, uShaft.y, up) + vec3(0., up * (uShaft.x - uWater), 0.);
  vCorner = c;
  gl_Position = uViewProj * vec4(vWorld, 1.);
}`;

export const shaftFragment = header + noise + heart + `
in vec2 vCorner;
in vec3 vWorld;
out vec4 outColor;
uniform vec4 uShaft;
void main() {
  float up = clamp(vCorner.y * .5 + .5, 0., 1.), across = abs(vCorner.x);
  float beam = pow(max(1. - across, 0.), 2.2) * smoothstep(0., .25, up) * mix(.35, 1., up);
  float streaks = .65 + .35 * vnoise(vec2(vCorner.x * 5. + 3., uTime * .05)) + .2 * vnoise(vec2(vCorner.x * 13., up * 2. - uTime * .08));
  outColor = vec4(uCool * beam * streaks * uShaft.w, 0.);
}`;

// The moon and home are exact spheres, found for each pixel by where its line of sight meets them, not meshes: the
// edge is a true circle at any distance and the surface is as sharp from close above it as from the mountain. Each is
// one full-screen pass that keeps only the pixels on the body, and writes its depth so the mountain can stand in front.
export const orbVertex = fullscreenVertex;

const orb = `
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvViewProj, uViewProj;
uniform vec3 uCamPos;
uniform float uPixel;
uniform vec4 uOrb;        // centre and radius
uniform mat3 uOrbTurn;    // world to the body's own frame (it turns slowly under the lens)
uniform vec3 uOrbLight;   // towards the sun
uniform vec2 uOrbPower;   // brightness, and how solid it is (a daytime moon lets the sky through)
vec3 hash33(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
// The point of the body this pixel sees: its direction from the centre in the world (xyz) and how much of the pixel
// the body covers (w, less than 1 only along the edge, which is what keeps the edge smooth). footprint: the size of
// a pixel there, in radii. reach widens the body, for the air round home.
vec4 orbHit(float reach, out vec3 rd, out float footprint) {
  vec4 far = uInvViewProj * vec4(vUv * 2. - 1., 1., 1.);
  rd = normalize(far.xyz / far.w - uCamPos);
  vec3 oc = uCamPos - uOrb.xyz;
  float along = -dot(oc, rd), radius = uOrb.w * reach;
  if (along < 0.) discard;
  float miss = sqrt(max(dot(oc, oc) - along * along, 0.)), px = along * uPixel;
  float cover = clamp((radius - miss) / px + .5, 0., 1.);
  if (cover <= 0.) discard;
  float t = along - sqrt(max(radius * radius - miss * miss, 0.));
  vec3 hit = uCamPos + rd * t;
  vec4 clip = uViewProj * vec4(hit, 1.);
  gl_FragDepth = clamp(clip.z / clip.w * .5 + .5, 0., 1.);
  footprint = t * uPixel / uOrb.w;
  return vec4(normalize(hit - uOrb.xyz), cover);
}
`;

// The moon's surface is a rule, the same from any distance. Craters come in sizes: for each size a grid of cells is
// laid through the body, each cell may hold one crater, and where a crater's ball cuts the surface is its bowl, with a
// raised rim that falls away outside. Every size slopes alike, so small craters look like large ones seen from far.
// Sizes too small for the pixel are left out, so the far moon costs almost nothing. Dark plains lie over part of it,
// and craters are shallower there. The light on it is whatever the slopes make of the sun, with no softening: along
// the edge of its night every rim throws a shadow.
export const moonFragment = header + noise + orb + `
uniform vec3 uOrbColor, uOrbShade;
uniform float uOrbDetail;   // 1 for every size of crater, 0 to leave the finest out
float craters(vec3 p, float freq, float amount, inout vec3 slope) {
  if (amount <= 0.) return 0.;
  vec3 q = p * freq, base = floor(q - .5);
  float h = 0.;
  for (int i = 0; i < 8; i++) {
    vec3 cell = base + vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1), rnd = hash33(cell + freq * 7.3);
    if (rnd.z > .5) continue;
    vec3 v = q - (cell + .5 + (rnd - .5) * .4);
    float r = .2 + .3 * fract(rnd.y * 7.31), dist = length(v), x = dist / r;
    if (x > 1.6) continue;
    // Old craters are worn shallow, a few are fresh and sharp.
    float worn = amount * (.3 + .7 * rnd.z * 2.);
    float rim = .3 * exp(-(x - 1.) * (x - 1.) / .0289);
    float bowl = x < 1. ? x * x - 1. : 0., dbowl = x < 1. ? 2. * x : 0.;
    h += worn * r / freq * (bowl + rim);
    slope += worn * (dbowl - rim * (x - 1.) / .01445) * v / max(dist, 1e-4);
  }
  return h;
}
// A size shows once its craters are a few pixels across.
float shown(float freq, float footprint) { return smoothstep(1.2, 3.5, .38 / freq / footprint); }
void main() {
  vec3 rd; float footprint;
  vec4 hit = orbHit(1., rd, footprint);
  vec3 d = uOrbTurn * hit.xyz, light = uOrbTurn * uOrbLight;
  // The plains: broad, soft-edged, darker.
  float mare = smoothstep(.5, .66, vnoise3(d * 1.25 + 3.1) * .62 + vnoise3(d * 2.9 + 8.7) * .28 + vnoise3(d * 6.3) * .1);
  vec3 slope = vec3(0);
  float h = 0., deep = .27 * (1. - .6 * mare);
  h += craters(d, 2.3, deep * shown(2.3, footprint), slope);
  h += craters(d, 5.7, deep * shown(5.7, footprint), slope);
  h += craters(d, 13.9, deep * shown(13.9, footprint), slope);
  h += craters(d, 33., deep * .9 * shown(33., footprint), slope);
  h += craters(d, 79., deep * .8 * shown(79., footprint) * uOrbDetail, slope);
  // The ground between them is not smooth either.
  float grit = shown(60., footprint);
  slope += (vec3(vnoise3(d * 150.), vnoise3(d * 150. + 31.), vnoise3(d * 150. + 67.)) - .5) * .12 * grit;
  vec3 n = normalize(d - (slope - d * dot(slope, d)));
  float sun = dot(n, light), whole = dot(d, light);
  // A little light comes back off the lit ground into the shadows, so a bowl in daylight is dark, not black.
  float lit = (pow(clamp(sun, 0., 1.), .8) + .035) * smoothstep(-.06, .08, whole);
  // Pale highlands, dark plains, bowls a little darker than their rims, and a mottling over all of it.
  vec3 albedo = mix(vec3(.74, .72, .67), vec3(.3, .31, .34), mare * .85);
  albedo *= (.9 + .22 * vnoise3(d * 9.) + .1 * vnoise3(d * 37.) * grit) * (1. + clamp(h * 9., -.3, .2));
  vec3 color = albedo * (uOrbColor * lit * 2.6 + uOrbShade);
  outColor = vec4(color * uOrbPower.x * hit.w, uOrbPower.y * hit.w);
}`;

// Home, seen from the moon: sea, land, ice at the poles and cloud over them, the sun glinting off the sea, and a thin
// blue shell of air that shows as a bright edge on the day side and a soft ring beyond it.
export const homeFragment = header + noise + orb + `
float layers(vec3 p) { return vnoise3(p) * .5 + vnoise3(p * 2.1 + 5.) * .28 + vnoise3(p * 4.6 + 11.) * .14 + vnoise3(p * 9.7 + 3.) * .08; }
void main() {
  vec3 rd; float footprint;
  const float AIR = 1.07;
  vec4 hit = orbHit(AIR, rd, footprint);
  vec3 oc = uCamPos - uOrb.xyz;
  float along = -dot(oc, rd), miss = sqrt(max(dot(oc, oc) - along * along, 0.)) / uOrb.w;
  vec3 air = vec3(.25, .5, 1.);
  // Outside the ground: only the air, thinning outwards, lit on the sun's side.
  if (miss >= 1.) {
    vec3 at = normalize(uCamPos + rd * along - uOrb.xyz);
    float glow = pow(1. - (miss - 1.) / (AIR - 1.), 2.2) * smoothstep(-.35, .3, dot(at, uOrbLight));
    outColor = vec4(air * glow * .55 * uOrbPower.x * hit.w, 0.);
    return;
  }
  // The ground itself (the shell was hit first; step on to the surface).
  float t = along - sqrt(max(1. - miss * miss, 0.)) * uOrb.w;
  vec3 n = normalize(uCamPos + rd * t - uOrb.xyz), d = uOrbTurn * n, light = uOrbLight;
  float sun = dot(n, light), day = smoothstep(-.12, .2, sun);
  float land = smoothstep(.5, .56, layers(d * 1.7 + 2.3));
  float cloud = smoothstep(.5, .68, layers(vec3(d.x * 2.2, d.y * 4.4, d.z * 2.2) + 9.1));
  vec3 ground = mix(mix(vec3(.02, .09, .27), vec3(.05, .2, .42), smoothstep(.4, .52, layers(d * 1.7 + 2.3))),
    mix(vec3(.12, .2, .08), vec3(.32, .27, .17), vnoise3(d * 6. + 4.)), land);
  ground = mix(ground, vec3(.75, .8, .86), smoothstep(.78, .9, abs(d.y) + vnoise3(d * 8.) * .06));
  vec3 color = mix(ground, vec3(.86, .88, .92), cloud * .9) * (clamp(sun, 0., 1.) * 1.9 + .012);
  // The sun on the open sea.
  color += vec3(1., .93, .8) * pow(max(dot(reflect(-light, n), -rd), 0.), 60.) * (1. - land) * (1. - cloud) * 1.4;
  // The air along the edge.
  float edge = pow(1. - max(dot(n, -rd), 0.), 3.);
  color += air * edge * day * .9;
  float cover = clamp((1. - miss) / (footprint + 1e-5) + .5, 0., 1.);
  outColor = vec4(color * uOrbPower.x * cover, uOrbPower.y * cover);
}`;
