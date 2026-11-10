// GLSL sources. Lighting is done in linear HDR; the composite pass tone-maps and grades.
// Weather below the cloud deck (weather.js): its chunks are spliced in where marked "weather".
import { weatherAir, weatherBasics, weatherLight } from './weather-shaders.js';

const header = '#version 300 es\nprecision highp float;\nprecision highp sampler2DShadow;\n';

const noise = `
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float hash13(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
`;

// Sky colour by direction; the same function tints the fog so distant ground melts into the sky.
const atmosphere = `
uniform vec3 uCamPos, uSunDir, uGlow, uZenith, uHorizon, uBelow;
uniform vec2 uFog;
${weatherAir}
vec3 skyColor(vec3 d) {
  float e = d.y;
  // Blend in a perceptual (square-root) space so warm horizons and blue zeniths don't meet in grey.
  vec3 color = mix(sqrt(uHorizon), sqrt(uZenith), pow(clamp(e, 0., 1.), .45));
  color = mix(color, sqrt(uBelow), smoothstep(.0, -.2, e));
  color *= color;
  float s = max(dot(d, uSunDir), 0.);
  float band = exp(-abs(e - .015) * 8.);
  color += uGlow * (pow(s, 5.) * .5 + pow(s, 40.) * .8) * (.3 + .7 * band);
  color += uGlow * band * .1 * (.35 + .65 * s);
  return color;
}
vec3 atmosphere(vec3 color, vec3 world) {
  vec3 ray = world - uCamPos;
  float dist = length(ray);
  vec3 d = ray / dist;
  // Valley mist thins quickly with height; distance haze only starts beyond the massif.
  const float falloff = .75;
  float k = d.y * falloff;
  float heightFog = uFog.y * 2.5 * exp(-uCamPos.y * falloff) * (abs(k) > 1e-4 ? (1. - exp(-k * dist)) / k : dist);
  float amount = 1. - exp(-max(dist - 10., 0.) * uFog.x - heightFog);
  vec3 haze = mix(uHorizon, skyColor(normalize(vec3(d.x, max(d.y, .0), d.z))), .65);
  return lowAir(color, haze, amount, world);
}
`;

const lighting = `
uniform vec3 uKeyDir, uKeyColor, uAmbSky, uAmbGround;
uniform sampler2DShadow uShadow;
uniform mat4 uLightMatrix;
uniform float uShadowSize;
float shadowAt(vec3 world, vec3 n) {
  float below = underDeck(world);  // weather: below the deck its own light casts the shadows
  if (below > .999) return lowShadow(world, n);
  vec3 c = (uLightMatrix * vec4(world + n * .035, 1.)).xyz * .5 + .5;
  if (any(lessThan(c, vec3(0))) || any(greaterThan(c, vec3(1)))) return 1.;
  float texel = 1.4 / uShadowSize, sum = 0.;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) sum += texture(uShadow, vec3(c.xy + vec2(x, y) * texel, c.z - .0006));
  return mix(sum / 9., below > 0. ? lowShadow(world, n) : 0., below);
}
vec3 light(vec3 albedo, vec3 n, float ao, float wrap, float shadow) {
  float diffuse = clamp((dot(n, uKeyDir) + wrap) / (1. + wrap), 0., 1.);
  vec3 ambient = mix(uAmbGround, uAmbSky, n.y * .5 + .5) * ao;
  return albedo * (uKeyColor * diffuse * shadow + ambient);
}
${weatherLight}`;

export const terrainVertex = header + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec4 vColor;
void main() {
  vWorld = aPosition;
  vColor = vec4(aColor.rgb * aColor.rgb, aColor.a * 1.12);
  gl_Position = uViewProj * vec4(aPosition, 1.);
}`;

export const terrainFragment = header + atmosphere + lighting + `
in vec3 vWorld;
in vec4 vColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.) n = -n;
  float shadow = shadowAt(vWorld, n);
  float snow = smoothstep(.45, .7, dot(vColor.rgb, vec3(.3, .5, .2)));
  vec3 color = light(weathered(vColor.rgb, n, vWorld), n, vColor.a, .2 + snow * .25, shadow, vWorld);
  vec3 v = normalize(uCamPos - vWorld);
  color += uKeyColor * pow(max(dot(n, normalize(uKeyDir + v)), 0.), 36.) * .14 * snow * shadow;
  outColor = vec4(atmosphere(color, vWorld), 1.);
}`;

export const treeVertex = header + weatherBasics + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aPart;
layout(location = 2) in vec4 aInstance;
layout(location = 3) in vec2 aExtra;
uniform mat4 uViewProj;
uniform float uTime;
out vec3 vWorld;
out vec3 vAlbedo;
out float vAo;
void main() {
  float c = cos(aExtra.x), s = sin(aExtra.x);
  vec3 p = aPosition * aInstance.w;
  // No two alike: each instance a little taller or squatter than the shape (detail.js shares this shader).
  p.y *= .88 + .24 * fract(aExtra.y * 13.7);
  p.xz = mat2(c, -s, s, c) * p.xz;
  // aPart: 0 bark, 1 needles, 2 leaves, 3 stone. Stone stays put in the wind.
  float stone = step(2.5, aPart);
  p.x += sin(uTime * 1.1 + aExtra.y * 40.) * .012 * aPosition.y * aPosition.y * (1. - stone);
  vWorld = aInstance.xyz + p;
  vec3 needles = mix(vec3(.028, .062, .046), vec3(.06, .11, .06), aExtra.y) * (.75 + .45 * aPosition.y);
  vec3 leaves = mix(vec3(.05, .088, .034), vec3(.105, .125, .045), aExtra.y) * (.75 + .4 * aPosition.y);
  vec3 rock = mix(vec3(.085, .08, .075), vec3(.19, .18, .165), aExtra.y);
  vAlbedo = aPart < .5 ? vec3(.08, .05, .035) : aPart < 1.5 ? needles : aPart < 2.5 ? leaves : rock;
  // Snow up high, and below the cloud deck when the day's weather brings it (weather.js).
  float high = max(smoothstep(1.4, 2.5, aInstance.y + aExtra.y * .4), uLowAir.w * underDeck(aInstance.xyz));
  float snowy = high * (stone > .5 ? step(.4, aPosition.y) : step(.5, aPart) * smoothstep(.5, .95, fract(aPosition.y * 2.4)));
  vAlbedo = mix(vAlbedo, vec3(.72, .76, .84), snowy * .75);
  vAo = mix(.45, 1., clamp(aPosition.y * (stone > .5 ? 2.2 : 1.2), 0., 1.));
  gl_Position = uViewProj * vec4(vWorld, 1.);
}`;

export const treeFragment = header + atmosphere + lighting + `
in vec3 vWorld;
in vec3 vAlbedo;
in float vAo;
out vec4 outColor;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 color = light(weathered(vAlbedo, n, vWorld), n, vAo, .35, shadowAt(vWorld, n), vWorld);
  outColor = vec4(atmosphere(color, vWorld), 1.);
}`;

export const terrainDepthVertex = header + `
layout(location = 0) in vec3 aPosition;
uniform mat4 uLightViewProj;
void main() { gl_Position = uLightViewProj * vec4(aPosition, 1.); }`;

export const treeDepthVertex = header + `
layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec4 aInstance;
layout(location = 3) in vec2 aExtra;
uniform mat4 uLightViewProj;
void main() {
  float c = cos(aExtra.x), s = sin(aExtra.x);
  vec3 p = aPosition * aInstance.w;
  p.y *= .88 + .24 * fract(aExtra.y * 13.7);
  p.xz = mat2(c, -s, s, c) * p.xz;
  gl_Position = uLightViewProj * vec4(aInstance.xyz + p, 1.);
}`;

export const depthFragment = header + 'void main() {}';

export const fullscreenVertex = header + `
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.);
  vUv = p * .5 + .5;
  gl_Position = vec4(p, 0., 1.);
}`;

export const skyFragment = header + noise + atmosphere + `
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvViewProj;
uniform float uTime, uStars, uMoon, uAurora, uSunDisc;
uniform float uMoonSize, uMoonHalo, uMoonDisc, uDeep;  // the moon's angular radius and the glow round it; 1 draws it here as a plain disc; the deep sky of Moonward
uniform vec3 uMoonDir, uKeyColor, uMeteorTail;
uniform vec4 uMeteor;  // a shooting star's head as a direction, and its brightness
// One layer of stars: a point in some cells of a grid laid through the sky, never wider than a pixel or two.
vec3 starLayer(vec3 d, float grid, float rare, float gain) {
  vec3 p = d * grid, cell = floor(p);
  float h = hash13(cell), px = length(fwidth(p));
  if (h <= rare) return vec3(0);
  vec3 center = cell + .2 + .6 * vec3(hash13(cell + 1.7), hash13(cell + 5.3), hash13(cell + 9.1));
  float point = smoothstep(px * 1.4, px * .25, length(p - center));
  float twinkle = .7 + .3 * sin(uTime * (1.5 + h * 6.) + h * 300.);
  vec3 tint = mix(vec3(1., .85, .7), vec3(.75, .85, 1.), hash13(cell + 3.3));
  return tint * point * twinkle * (h - rare) / (1. - rare) * gain;
}
vec3 aurora(vec3 d) {
  if (d.y < .03) return vec3(0);
  vec3 sum = vec3(0);
  float jitter = hash12(gl_FragCoord.xy);
  for (int i = 0; i < 18; i++) {
    float f = (float(i) + jitter) / 18.;
    vec2 p = d.xz / d.y * (1.2 + f * .9);
    float wave = vnoise(p * vec2(.55, .22) + vec2(uTime * .015, 0.)) * 2. + p.x * .25;
    float curtain = pow(1. - abs(fract(wave) * 2. - 1.), 9.) * vnoise(p * 1.7 - uTime * .03);
    sum += mix(vec3(.15, 1., .55), vec3(.55, .25, 1.), f * f) * curtain * (1. - f) * .11;
  }
  return sum * smoothstep(.03, .3, d.y);
}
void main() {
  vec4 far = uInvViewProj * vec4(vUv * 2. - 1., 1., 1.);
  vec3 d = normalize(far.xyz / far.w - uCamPos);
  vec3 color = skyColor(d);
  float s = dot(d, uSunDir);
  color += uKeyColor * uSunDisc * smoothstep(.99955, .99975, s) * 9.;
  float above = smoothstep(-.02, .12, d.y);
  if (uStars > 0.) {
    color += starLayer(d, 260., .972, 3.2) * uStars * above;
    float across = dot(d, normalize(vec3(.35, .55, -.75))), band = exp(-across * across * 18.);
    color += vec3(.5, .55, .8) * band * (vnoise3(d * 9.) * .7 + vnoise3(d * 23.) * .3) * .05 * uStars * above;
    // Past the summit the sky deepens: a second, finer field of stars, and the galaxy's band shows its warm heart,
    // its cold arms and the dark lanes of dust between them.
    if (uDeep > 0.) {
      color += starLayer(d, 640., .974, 1.5) * uDeep * above;
      float lanes = smoothstep(.42, .72, vnoise3(d * 6.5 + 2.)) * exp(-across * across * 60.);
      vec3 arms = vec3(.42, .55, 1.) * (.05 + .1 * vnoise3(d * 12.)) + vec3(1., .74, .5) * .12 * smoothstep(.4, .85, vnoise3(d * 2.6 + 4.));
      color += arms * band * (1. - .75 * lanes) * uDeep * above;
    }
  }
  if (uMeteor.w > 0.) {
    // A shooting star: a short stroke, brightest at its head.
    vec3 along = uMeteorTail - uMeteor.xyz;
    float t = clamp(dot(d - uMeteor.xyz, along) / max(dot(along, along), 1e-8), 0., 1.);
    float off = length(d - (uMeteor.xyz + along * t)), px = length(fwidth(d));
    color += vec3(.85, .92, 1.) * uMeteor.w * (1. - t) * (1. - t) * smoothstep(px * 2.2, px * .3, off) * 7. * above;
  }
  if (uMoon > 0.) {
    float m = dot(d, uMoonDir);
    // The moon itself is a body of its own (beyond.js); here is the glow in the air round it, measured from its limb,
    // so the glow keeps to it when it comes near.
    float past = max(acos(clamp(m, -1., 1.)) - uMoonSize * .96, 0.);
    color += uMoon * uMoonHalo * vec3(.55, .65, 1.) * (exp(-past * past * 450.) * .5 + exp(-past * past * 12.) * .04);
    if (uMoonDisc > .5) {
      float crater = vnoise3(d * 900.) * .25 + vnoise3(d * 2400.) * .1;
      color += uMoon * vec3(1., .97, .9) * smoothstep(.99925, .99945, m) * (2.6 - crater * 2.);
    }
  }
  if (uAurora > 0.) color += aurora(d) * uAurora;
  outColor = vec4(lowBackdrop(color, d), 1.);
}`;

// Camera-facing quads for instanced sprites, two triangles per instance.
const corners = 'const vec2 corners[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(1, 1), vec2(-1, -1), vec2(1, 1), vec2(-1, 1));\n';
const linearDepth = `
uniform sampler2D uDepth;
uniform vec2 uResolution, uClip;
uniform float uSoft;
float linearize(float depth) { float z = depth * 2. - 1.; return 2. * uClip.x * uClip.y / (uClip.y + uClip.x - z * (uClip.y - uClip.x)); }
// Fades sprites where they meet the ground instead of cutting a hard line.
float softEdge(float range) {
  if (uSoft < .5) return 1.;
  float scene = linearize(texture(uDepth, gl_FragCoord.xy / uResolution).r);
  return clamp((scene - linearize(gl_FragCoord.z)) / range, 0., 1.);
}
`;

export const trailVertex = header + corners + `
layout(location = 0) in vec4 aPoint;
uniform mat4 uViewProj;
uniform vec3 uRight, uUp, uCamPos;
uniform float uProgress, uPixel;
out vec2 vCorner;
out float vLit;
out vec3 vWorld;
void main() {
  vec2 c = corners[gl_VertexID];
  vec3 toCamera = uCamPos - aPoint.xyz;
  float dist = length(toCamera);
  float size = max(.017, dist * uPixel * 1.6);
  vLit = smoothstep(uProgress + .015, uProgress - .015, aPoint.w);
  vCorner = c;
  vWorld = aPoint.xyz;
  gl_Position = uViewProj * vec4(aPoint.xyz + toCamera / dist * .06 + (c.x * uRight + c.y * uUp) * size, 1.);
}`;

export const trailFragment = header + atmosphere + `
in vec2 vCorner;
in float vLit;
in vec3 vWorld;
out vec4 outColor;
uniform vec3 uLantern;
uniform float uAhead;
void main() {
  // Walked dots glow; the ones still ahead show only while travelling (uAhead), so a camp at rest is calm.
  float a = smoothstep(1., .45, length(vCorner)) * mix(.32 * uAhead, 1., vLit);
  vec3 color = mix(vec3(1., .96, .9) * .7, uLantern * 1.5, vLit);
  float keep = 1. - clamp(length(vWorld - uCamPos) / 60., 0., 1.);
  outColor = vec4(color, 1.) * a * keep;
}`;

export const glowVertex = header + corners + `
layout(location = 0) in vec4 aGlow;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
uniform vec3 uRight, uUp, uCamPos;
uniform float uPixel;
out vec2 vCorner;
out vec4 vColor;
void main() {
  vec2 c = corners[gl_VertexID];
  vec3 toCamera = uCamPos - aGlow.xyz;
  float dist = length(toCamera);
  float size = max(aGlow.w, dist * uPixel * 5.);
  vCorner = c;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aGlow.xyz + toCamera / dist * .25 + (c.x * uRight + c.y * uUp) * size, 1.);
}`;

export const glowFragment = header + `
in vec2 vCorner;
in vec4 vColor;
out vec4 outColor;
void main() {
  float d = length(vCorner);
  float light = exp(-d * d * 22.) * 1.6 + exp(-d * 4.5) * .3;
  outColor = vec4(vColor.rgb * light * smoothstep(1., .7, d), 0.);
}`;

// A vertical beam over the current camp, always turned to face the camera.
export const pillarVertex = header + corners + `
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec4 uPillar;
out vec2 vCorner;
void main() {
  vec2 c = corners[gl_VertexID];
  vec3 toCamera = uCamPos - uPillar.xyz;
  vec3 side = normalize(vec3(-toCamera.z, 0., toCamera.x));
  vCorner = c;
  gl_Position = uViewProj * vec4(uPillar.xyz + side * c.x * .07 * uPillar.w + vec3(0, (c.y * .5 + .5) * 2.6 * uPillar.w, 0), 1.);
}`;

export const pillarFragment = header + `
in vec2 vCorner;
out vec4 outColor;
uniform vec3 uLantern;
uniform float uTime, uPillarPower;
void main() {
  // Multisample positions can fall just outside the quad, so keep pow() bases non-negative.
  float v = clamp(vCorner.y * .5 + .5, 0., 1.);
  float beam = pow(max(1. - abs(vCorner.x), 0.), 3.) * pow(1. - v, 2.2) * smoothstep(0., .05, v);
  float shimmer = .85 + .15 * sin(uTime * 2.2 - v * 9.);
  outColor = vec4(uLantern * beam * shimmer * .9 * uPillarPower, 0.);
}`;

export const propVertex = header + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
layout(location = 2) in vec4 aFlag;
uniform mat4 uViewProj;
uniform float uTime, uPennants;
out vec3 vWorld;
out vec3 vAlbedo;
out float vGlow;
void main() {
  vec3 p = aPosition;
  // Cloth ripples sideways in waves that run from the pole to the free end and grow along the way;
  // gusts swell and ease the motion. Everything off the cloth has aFlag.x = 0 and stays put.
  float pennant = floor(aFlag.y * .5), v = aFlag.y - pennant * 2.;
  float u = aFlag.x, phase = dot(aPosition.xz, vec2(3.1, 4.3)), t = uTime * 5.2 + phase;
  float gust = .7 + .3 * sin(uTime * .63 + phase);
  float wave = sin(u * 8.5 - t + v * .9) * .7 + sin(u * 17. - t * 1.6 + phase) * .3;
  p += vec3(aFlag.z, 0., aFlag.w) * wave * u * .17 * gust;
  // Summit pennants beyond the number of guestbook notes collapse to nothing.
  if (pennant > uPennants) p = vec3(0., -1e4, 0.);
  vWorld = p;
  vAlbedo = aColor.rgb * aColor.rgb;
  vGlow = 1. - aColor.a;
  gl_Position = uViewProj * vec4(p, 1.);
}`;

export const propFragment = header + atmosphere + lighting + `
in vec3 vWorld;
in vec3 vAlbedo;
in float vGlow;
out vec4 outColor;
uniform float uTime;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 color = light(weathered(vAlbedo, n, vWorld), n, 1., .4, shadowAt(vWorld, n), vWorld);
  // Emissive faces (fire, lamps, the lit register) glow on their own; flames flicker.
  float flicker = 1. + (sin(uTime * 11. + vWorld.x * 37.) * .18 + sin(uTime * 17.3 + vWorld.z * 23.) * .12) * smoothstep(.9, 1., vGlow);
  color = mix(color, vAlbedo * 7. * flicker, vGlow);
  outColor = vec4(atmosphere(color, vWorld), 1.);
}`;

// The Phantom camp's points of light: a loose, drifting swarm that gathers into the Phantom mark facing the camera
// (uSpark.xyz centre, w half-size) while the camp is visited (uForm), and shies away from the pointer.
export const sparkVertex = header + noise + `
layout(location = 0) in vec2 aShape;
uniform mat4 uViewProj;
uniform vec4 uSpark;
uniform vec3 uRight, uUp;
uniform float uTime, uForm, uHeight, uAspect;
uniform vec3 uPointer;
out float vAlpha;
out float vHeat;
void main() {
  float id = float(gl_VertexID);
  vec3 seed = vec3(hash12(vec2(id, 1.7)), hash12(vec2(id, 5.3)), hash12(vec2(id, 9.1))) - .5;
  vec3 drift = vec3(sin(uTime * .37 + id * .71), sin(uTime * .29 + id * 1.3) * .7, cos(uTime * .33 + id * .53)) * .22;
  vec3 loose = uSpark.xyz + (seed * vec3(2.4, 1.5, 2.4) + drift) * uSpark.w;
  vec3 formed = uSpark.xyz + (aShape.x * uRight + aShape.y * uUp) * uSpark.w + (seed.x * uRight + seed.y * uUp) * .006 * sin(uTime * 2. + id);
  float form = smoothstep(0., 1., clamp(uForm * 1.7 - (seed.z + .5) * .7, 0., 1.));
  vec3 p = mix(loose, formed, form);
  vec4 clip = uViewProj * vec4(p, 1.);
  // The pointer (uPointer.xy in clip space, z its strength) pushes nearby points aside in the screen plane.
  vec2 d = clip.xy / clip.w - uPointer.xy;
  d.x *= uAspect;
  float push = exp(-dot(d, d) * 90.) * uPointer.z;
  p += (normalize(d.x * uRight + d.y * uUp + 1e-5) * .35 + (seed.x * uRight + seed.y * uUp) * .3) * push * uSpark.w;
  clip = uViewProj * vec4(p, 1.);
  vAlpha = mix(.55, 1., form) * (.6 + (seed.y + .5) * .4);
  vHeat = form;
  gl_Position = clip;
  gl_PointSize = clamp(uHeight * (.0055 + (seed.z + .5) * .0035) / max(clip.w, .1), 1.5, 8.);
}`;

export const sparkFragment = header + `
in float vAlpha;
in float vHeat;
out vec4 outColor;
uniform vec3 uLantern;
uniform float uSparkPower;
void main() {
  float d = length(gl_PointCoord - .5);
  float a = smoothstep(.5, 0., d);
  vec3 color = mix(vec3(.62, .7, 1.), uLantern * 1.5, vHeat * .85) * (1. + smoothstep(.2, 0., d) * 2.);
  outColor = vec4(color * a * vAlpha * uSparkPower, 0.);
}`;

export const cloudVertex = header + corners + weatherBasics + `
layout(location = 0) in vec4 aCloud;
layout(location = 1) in float aSeed;
uniform mat4 uViewProj;
uniform vec3 uRight, uUp, uCamPos;
uniform float uTime;
uniform vec4 uFocus;
uniform vec3 uSummit;
out vec2 vCorner;
out vec3 vWorld;
out float vSeed;
out float vNear;
out float vClear;
// How much a puff of this size at center blocks the view from the lens to target: 1 on the line of sight,
// fading out over a cone that widens with distance, and none for puffs at or behind the target.
float parting(vec3 center, vec3 target, float size) {
  vec3 ray = target - uCamPos;
  float along = clamp(dot(center - uCamPos, ray) / max(dot(ray, ray), 1e-4), 0., 1.);
  float miss = distance(center, uCamPos + ray * along), reach = size * .8 + along * length(ray) * .1;
  return (1. - smoothstep(reach, reach + size * 1.6, miss)) * (1. - smoothstep(.85, 1., along));
}
void main() {
  vec2 c = corners[gl_VertexID];
  vec3 center = aCloud.xyz + vec3(sin(uTime * .05 + aSeed * 30.), 0., cos(uTime * .04 + aSeed * 20.)) * .4;
  vCorner = c;
  vSeed = aSeed;
  // Puffs close to the lens would fill the frame with blur; they dissolve instead.
  vNear = smoothstep(aCloud.w * 1.2, aCloud.w * 3.5, distance(center, uCamPos));
  // Puffs between the lens and the camp in view (uFocus.xyz, strength w) part so low cloud never hides it;
  // those in front of the summit thin out too, but only partly, so the sky keeps some weather.
  vClear = (1. - uFocus.w * parting(center, uFocus.xyz, aCloud.w)) * (1. - uFocus.w * .75 * parting(center, uSummit, aCloud.w));
  vClear *= deckPuff(aSeed);  // weather: the deck's puffs come and go with its cover
  vWorld = center + (c.x * uRight * 1.5 + c.y * uUp) * aCloud.w;
  if (vClear < .001) vWorld = center;  // a hidden puff draws nothing
  gl_Position = uViewProj * vec4(vWorld, 1.);
}`;

export const cloudFragment = header + noise + atmosphere + linearDepth + `
in vec2 vCorner;
in vec3 vWorld;
in float vSeed;
in float vNear;
in float vClear;
out vec4 outColor;
uniform vec3 uKeyDir, uKeyColor, uAmbSky, uCloud;
uniform float uTime, uCloudAmount;
void main() {
  vec2 p = vCorner * vec2(1., 1.25);
  float n = vnoise(p * 2.1 + vSeed * 17. + uTime * .03) * .6 + vnoise(p * 4.7 - vSeed * 9.) * .4;
  // The noise can push the outline past the quad; the last stretch to each edge fades so no straight cut shows.
  float shape = smoothstep(1., .35, length(p) + (n - .5) * .9) * smoothstep(1., .82, abs(vCorner.x)) * smoothstep(1., .82, abs(vCorner.y));
  float bottom = smoothstep(-.9, .4, vCorner.y);
  shape *= mix(.55, 1., bottom) * softEdge(1.2);
  float lit = clamp(.35 + vCorner.y * .45 + max(dot(uKeyDir, normalize(vec3(vCorner.x, 1., 0.))), 0.) * .3, 0., 1.);
  vec3 color = lowCloud(uCloud * mix(uAmbSky * 1.1, uKeyColor * .55 + uAmbSky * .6, lit), lit, vWorld);
  color = atmosphere(color, vWorld);
  float alpha = shape * .85 * uCloudAmount * vNear * vClear;
  outColor = vec4(color * alpha, alpha);
}`;

export const snowVertex = header + noise + weatherBasics + `
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uTime, uHeight;
out float vAlpha;
void main() {
  float id = float(gl_VertexID);
  vec3 seed = vec3(hash12(vec2(id, 1.3)), hash12(vec2(id, 7.1)), hash12(vec2(id, 3.7)));
  const vec3 box = vec3(16., 10., 16.);
  vec3 drift = vec3(.45, -.5 - seed.y * .35, .15) * uTime + vec3(sin(uTime * .8 + id), 0., cos(uTime * .6 + id)) * .12;
  vec3 p = mod(seed * box + drift - uCamPos, box) - box * .5 + uCamPos;
  float dist = length(p - uCamPos);
  vAlpha = smoothstep(.3, 1.2, dist) * (1. - smoothstep(5., 8., dist)) * (.5 + seed.z * .5);
  vAlpha *= 1. - underDeck(p);  // weather: below the deck its own rain and snow take over
  gl_Position = uViewProj * vec4(p, 1.);
  gl_PointSize = clamp(uHeight * (.012 + seed.z * .014) / max(dist, .1), 1., 9.);
}`;

export const snowFragment = header + `
in float vAlpha;
out vec4 outColor;
uniform vec3 uAmbSky, uKeyColor;
uniform float uSnow;
void main() {
  float a = smoothstep(.5, .1, length(gl_PointCoord - .5)) * vAlpha * uSnow;
  vec3 color = uAmbSky * 1.4 + uKeyColor * .25 + .08;
  outColor = vec4(color * a, a);
}`;

// Bloom: a thresholded downsample chain, then tent-filtered upsamples added back up the chain.
export const downsampleFragment = header + `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uThreshold;
void main() {
  vec3 a = texture(uSource, vUv + uTexel * vec2(-1, -1)).rgb, b = texture(uSource, vUv + uTexel * vec2(1, -1)).rgb;
  vec3 c = texture(uSource, vUv + uTexel * vec2(-1, 1)).rgb, d = texture(uSource, vUv + uTexel * vec2(1, 1)).rgb;
  vec3 e = texture(uSource, vUv).rgb;
  vec3 color = (a + b + c + d) * .125 + e * .5;
  if (any(isnan(color)) || any(isinf(color))) color = vec3(0);
  if (uThreshold > 0.) {
    float bright = max(color.r, max(color.g, color.b));
    color *= max(bright - uThreshold, 0.) / max(bright, 1e-4);
  }
  outColor = vec4(min(color, vec3(40.)), 1.);
}`;

export const upsampleFragment = header + `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uTexel;
void main() {
  vec3 sum = texture(uSource, vUv).rgb * 4.;
  sum += (texture(uSource, vUv + uTexel * vec2(1, 0)).rgb + texture(uSource, vUv - uTexel * vec2(1, 0)).rgb
        + texture(uSource, vUv + uTexel * vec2(0, 1)).rgb + texture(uSource, vUv - uTexel * vec2(0, 1)).rgb) * 2.;
  sum += texture(uSource, vUv + uTexel).rgb + texture(uSource, vUv - uTexel).rgb
       + texture(uSource, vUv + uTexel * vec2(1, -1)).rgb + texture(uSource, vUv + uTexel * vec2(-1, 1)).rgb;
  outColor = vec4(sum / 16., 1.);
}`;

export const compositeFragment = header + noise + `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene, uBloom;
uniform float uExposure, uSaturation, uTime, uFade, uBloomStrength, uFxaa;
uniform vec3 uTint;
uniform vec2 uTexel;
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + .03) / (x * (2.43 * x + .59) + .14), 0., 1.); }
vec3 graded(vec2 uv) { return aces((texture(uScene, uv).rgb + texture(uBloom, uv).rgb * uBloomStrength) * uExposure * uTint); }
float lum(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
void main() {
  vec3 color = graded(vUv);
  // Without multisampling (the low tier), a light FXAA pass smooths stair-stepped edges along their direction.
  if (uFxaa > 0.) {
    float nw = lum(graded(vUv + uTexel * vec2(-1, -1))), ne = lum(graded(vUv + uTexel * vec2(1, -1)));
    float sw = lum(graded(vUv + uTexel * vec2(-1, 1))), se = lum(graded(vUv + uTexel * vec2(1, 1))), m = lum(color);
    float low = min(m, min(min(nw, ne), min(sw, se))), high = max(m, max(max(nw, ne), max(sw, se)));
    vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
    float reduce = max((nw + ne + sw + se) * .03125, 1. / 128.);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8., 8.) * uTexel;
    vec3 a = .5 * (graded(vUv - dir / 6.) + graded(vUv + dir / 6.));
    vec3 b = a * .5 + .25 * (graded(vUv - dir * .5) + graded(vUv + dir * .5));
    float lb = lum(b);
    color = lb < low || lb > high ? a : b;
  }
  float luma = dot(color, vec3(.2126, .7152, .0722));
  color = mix(vec3(luma), color, uSaturation);
  vec2 q = vUv - .5;
  color *= 1. - dot(q, q) * .55;
  color = pow(color, vec3(1. / 2.2));
  color += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - .5) * (1.5 / 255. + .018 * (1. - luma));
  outColor = vec4(color * uFade, 1.);
}`;

// The shared pieces, for passes built outside this file (water-shaders.js, weather.js).
export const chunks = { header, noise, atmosphere, lighting, corners };
