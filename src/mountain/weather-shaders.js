// GLSL for the weather below the cloud deck (weather.js). Up there the climb keeps its designed hour; down here the
// valley has its own palette (the visitor's local time, overcast by the weather) and its own shadow map.
// `weatherBasics`, `weatherAir` and `weatherLight` are spliced into the shared shaders in shaders.js (uLow* uniforms
// are the valley's); weatherShaders() builds the weather's own passes from the shared chunks shaders.js exports.

// Safe in vertex shaders: where the valley starts, and how the deck's puffs show.
export const weatherBasics = `
uniform vec4 uDeck;  // deck height, half-width of the blend band, cover of the deck's puffs, presence (0 turns it all off)
uniform vec4 uLowAir;  // fog density below the deck, saturation, wetness, snow cover
// 1 below the deck, 0 above, over a wide band that wanders, so it never draws a level line across the slopes.
float underDeck(vec3 world) {
  float edge = (sin(world.x * .9 + world.z * .5) + sin(world.z * 1.3 - world.x * .7) * .7 + sin(world.x * 2.9 - world.z * 2.3) * .3) * .14;
  return smoothstep(uDeck.x + uDeck.y, uDeck.x - uDeck.y, world.y + edge);
}
// The deck's puffs carry 1 + the cover at which they appear as their seed; the scene's own clouds are always there.
float deckPuff(float seed) { return seed < 1. ? 1. : smoothstep(seed - 1., seed - .92, uDeck.z); }
`;

// Goes into the shared atmosphere chunk, after its uniforms (it uses uCamPos).
export const weatherAir = weatherBasics + `
uniform vec3 uLowKeyDir, uLowKeyColor, uLowAmbSky, uLowAmbGround, uLowZenith, uLowHorizon, uLowBelow, uLowGlow, uLowSunDir, uLowCloud;
uniform vec4 uLowFog;  // top of the valley air, depth of its soft top, how fast the valley sky closes in from below
uniform vec4 uFocus;  // the camp in view and how far the clouds have parted for it (shaders.js, cloudVertex)
uniform sampler2DShadow uLowShadow;
uniform mat4 uLowLightMatrix;
// The same gradient as skyColor() in shaders.js, in the valley's colours.
vec3 lowSky(vec3 d) {
  float e = d.y;
  vec3 color = mix(sqrt(uLowHorizon), sqrt(uLowZenith), pow(clamp(e, 0., 1.), .45));
  color = mix(color, sqrt(uLowBelow), smoothstep(.0, -.2, e));
  color *= color;
  float s = max(dot(d, uLowSunDir), 0.);
  float band = exp(-abs(e - .015) * 8.);
  color += uLowGlow * (pow(s, 5.) * .5 + pow(s, 40.) * .8) * (.3 + .7 * band);
  color += uLowGlow * band * .1 * (.35 + .65 * s);
  return color;
}
// Valley air: full density below a soft top, none above. Its integral over height gives the exact average density
// along any straight path, so the fog layer costs no marching.
float lowFogIntegral(float y) {
  float base = uLowFog.x - uLowFog.y, t = clamp(y - base, 0., uLowFog.y);
  return min(y, base) + t - t * t / (2. * uLowFog.y);
}
float lowFogAlong(float y0, float y1) {
  return abs(y1 - y0) < 1e-3 ? clamp((uLowFog.x - y0) / uLowFog.y, 0., 1.) : (lowFogIntegral(y1) - lowFogIntegral(y0)) / (y1 - y0);
}
// Called by atmosphere() with the scene's own haze: valley surfaces take the valley's haze and saturation, and every
// path through the valley air picks up its fog (thin on a clear day, a white sea on a foggy one).
vec3 lowAir(vec3 color, vec3 haze, float amount, vec3 world) {
  vec3 ray = world - uCamPos;
  float dist = length(ray), w = underDeck(world);
  float fog = uLowAir.x * lowFogAlong(uCamPos.y, world.y) * max(dist - 2.5, 0.);
  if (w <= 0. && fog <= 0.) return mix(color, haze, clamp(amount, 0., 1.));
  // The air clears around the camp being visited, as the clouds part for it.
  vec3 toFocus = world - uFocus.xyz;
  fog *= 1. - uFocus.w * .8 * exp(-dot(toFocus, toFocus) * .1);
  vec3 d = ray / dist;
  vec3 low = mix(uLowHorizon, lowSky(normalize(vec3(d.x, max(d.y, 0.), d.z))), .65);
  color = mix(vec3(dot(color, vec3(.2126, .7152, .0722))), color, mix(1., uLowAir.y, w));
  color = mix(color, mix(haze, low, w), clamp(amount, 0., 1.));
  return mix(color, low, 1. - exp(-fog));
}
float lowShadow(vec3 world, vec3 n) {
  vec3 c = (uLowLightMatrix * vec4(world + n * .035, 1.)).xyz * .5 + .5;
  if (any(lessThan(c, vec3(0))) || any(greaterThan(c, vec3(1)))) return 1.;
  float texel = 1.4 / float(textureSize(uLowShadow, 0).x), sum = 0.;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) sum += texture(uLowShadow, vec3(c.xy + vec2(x, y) * texel, c.z - .0006));
  return sum / 9.;
}
// Wet ground darkens; snow settles on the facets that face up, the steeper ones too as the cover grows.
vec3 weathered(vec3 albedo, vec3 n, vec3 world) {
  float w = underDeck(world);
  if (w <= 0.) return albedo;
  float drift = sin(world.x * 1.7 + world.z * .9) * sin(world.z * 1.3 - world.x * .6) * .05;
  float cover = uLowAir.w * w * smoothstep(.95 - uLowAir.w * .32, .98 - uLowAir.w * .32, n.y + drift);
  return mix(albedo * (1. - uLowAir.z * w * .45), vec3(.8, .84, .9), cover);
}
// Cloud puffs below the deck are lit by the valley.
vec3 lowCloud(vec3 color, float lit, vec3 world) {
  float w = underDeck(world);
  return w <= 0. ? color : mix(color, uLowCloud * mix(uLowAmbSky * 1.1, uLowKeyColor * .55 + uLowAmbSky * .6, lit), w);
}
// The sky seen from under the deck: the valley's own sky towards the horizon, the climb's overhead.
vec3 lowBackdrop(vec3 color, vec3 d) {
  float below = uDeck.x - uCamPos.y;
  if (below <= -uDeck.y) return color;
  float t = d.y > 1e-3 ? max(below, 0.) / d.y : 1e3;
  return mix(color, lowSky(d), (1. - exp(-t * uLowFog.z)) * smoothstep(-uDeck.y, uDeck.y, below));
}
`;

// Appended to the shared lighting chunk: light() with the surface's position blends in the valley's light.
export const weatherLight = `
vec3 light(vec3 albedo, vec3 n, float ao, float wrap, float shadow, vec3 world) {
  vec3 camp = light(albedo, n, ao, wrap, shadow);
  float w = underDeck(world);
  if (w <= 0.) return camp;
  float diffuse = clamp((dot(n, uLowKeyDir) + wrap) / (1. + wrap), 0., 1.);
  vec3 ambient = mix(uLowAmbGround, uLowAmbSky, n.y * .5 + .5) * ao;
  vec3 below = albedo * (uLowKeyColor * diffuse * shadow + ambient);
  // Wet ground mirrors the valley sky on its flatter facets.
  if (uLowAir.z > 0.) {
    vec3 v = normalize(uCamPos - world);
    below += lowSky(reflect(-v, n)) * pow(1. - max(dot(n, v), 0.), 4.) * uLowAir.z * smoothstep(.7, .95, n.y) * .5;
  }
  return mix(camp, below, w);
}
`;

// Rain and snow fill a box that wraps around its centre: near the lens a small box that travels with the camera, and
// farther out a wide fixed one over the valley floor, so the weather also reads from high above the deck.
const box = `
uniform vec3 uBoxCenter, uBoxSize;
uniform vec4 uBoxFade;  // fades in from the lens between x and y, out between z and w
vec3 inBox(vec3 start) { return mod(start - uBoxCenter, uBoxSize) - uBoxSize * .5 + uBoxCenter; }
float boxFade(float dist) { return smoothstep(uBoxFade.x, uBoxFade.y, dist) * (1. - smoothstep(uBoxFade.z, uBoxFade.w, dist)); }
`;

// The weather's own passes. Premultiplied alpha, like the other transparent passes.
export const weatherShaders = ({ header, noise, corners }) => ({
  // Rain: streaks stretched along their fall in screen space.
  rainVertex: header + noise + weatherBasics + corners + box + `
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uRain;  // fall speed, streak length, strength, width in pixels
out float vAlpha;
out vec2 vCorner;
void main() {
  float id = float(gl_InstanceID);
  vec3 seed = vec3(hash12(vec2(id, 2.1)), hash12(vec2(id, 8.3)), hash12(vec2(id, 4.7)));
  vec3 fall = normalize(vec3(.16, -1., .07));
  vec3 p = inBox(seed * uBoxSize + fall * uRain.x * (.85 + seed.z * .3) * uTime);
  vec4 head = uViewProj * vec4(p, 1.), tail = uViewProj * vec4(p - fall * uRain.y, 1.);
  float dist = distance(p, uCamPos);
  vAlpha = underDeck(p) * boxFade(dist) * (.45 + seed.y * .55) * uRain.z;
  vec2 c = corners[gl_VertexID];
  vCorner = c;
  if (vAlpha <= .001 || head.w < .05 || tail.w < .05) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec2 along = (tail.xy / tail.w - head.xy / head.w) * uResolution;
  along = dot(along, along) > 1e-6 ? normalize(along) : vec2(0., 1.);
  vec4 clip = c.y < 0. ? head : tail;
  clip.xy += vec2(-along.y, along.x) * c.x * uRain.w / uResolution * clip.w;
  gl_Position = clip;
}`,
  rainFragment: header + `
in float vAlpha;
in vec2 vCorner;
out vec4 outColor;
uniform vec3 uLowAmbSky, uLowKeyColor;
void main() {
  float a = vAlpha * (1. - abs(vCorner.x)) * (.3 + .7 * smoothstep(1., -1., vCorner.y));
  outColor = vec4((uLowAmbSky * 1.7 + uLowKeyColor * .3 + .025) * a, a * .5);
}`,
  // Snow, like the climb's own flurries (snowVertex) but heavier and only below the deck.
  flakeVertex: header + noise + weatherBasics + box + `
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uTime, uHeight;
uniform vec4 uFlakes;  // fall speed, flutter, strength
out float vAlpha;
void main() {
  float id = float(gl_VertexID);
  vec3 seed = vec3(hash12(vec2(id, 3.3)), hash12(vec2(id, 6.1)), hash12(vec2(id, 9.7)));
  float t = uTime * uFlakes.y;
  vec3 drift = vec3(.22, -uFlakes.x * (.7 + seed.y * .6), .1) * uTime + vec3(sin(t * .9 + id), 0., cos(t * .7 + id)) * .14;
  vec3 p = inBox(seed * uBoxSize + drift);
  float dist = length(p - uCamPos);
  vAlpha = underDeck(p) * boxFade(dist) * (.55 + seed.z * .45) * uFlakes.z;
  gl_Position = vAlpha > .001 ? uViewProj * vec4(p, 1.) : vec4(2., 2., 2., 1.);
  gl_PointSize = clamp(uHeight * (.013 + seed.z * .016) / max(dist, .1), 1., 10.);
}`,
  flakeFragment: header + `
in float vAlpha;
out vec4 outColor;
uniform vec3 uLowAmbSky, uLowKeyColor;
void main() {
  float a = smoothstep(.5, .1, length(gl_PointCoord - .5)) * vAlpha;
  outColor = vec4((uLowAmbSky * 1.5 + uLowKeyColor * .3 + .08) * a, a);
}`,
  // Rain and snow seen from afar: soft shafts hanging from the deck to the ground, turned towards the camera.
  curtainVertex: header + corners + `
layout(location = 0) in vec4 aCurtain;  // x, ground height, z, half width
layout(location = 1) in float aSeed;    // the precipitation at which it appears, and its pattern
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec4 uCurtain;  // precipitation, snow (0 rain, 1 snow), time, top height
out vec3 vShaft;  // across (-1..1), up (0..1), across in world units
out vec3 vWorld;
out float vAlpha;
out float vSeed;
void main() {
  vec2 c = corners[gl_VertexID];
  vec3 toCamera = uCamPos - aCurtain.xyz;
  vec3 side = normalize(vec3(-toCamera.z, 0., toCamera.x));
  // Shafts close to the lens would be a grey wash; the near rain and snow take over there.
  vAlpha = smoothstep(aSeed, aSeed + .12, uCurtain.x) * smoothstep(5., 10., length(toCamera.xz));
  vShaft = vec3(c.x, c.y * .5 + .5, c.x * aCurtain.w);
  vSeed = aSeed;
  // Leaning a little with the wind, like the rain near the lens.
  vWorld = aCurtain.xyz + side * (c.x * aCurtain.w - vShaft.y * .3) + vec3(0., vShaft.y * (uCurtain.w - aCurtain.y), 0.);
  gl_Position = vAlpha > .001 ? uViewProj * vec4(vWorld, 1.) : vec4(2., 2., 2., 1.);
}`,
  curtainFragment: header + noise + `
in vec3 vShaft;
in vec3 vWorld;
in float vAlpha;
in float vSeed;
out vec4 outColor;
uniform vec4 uCurtain;
uniform float uTime;
uniform vec3 uCamPos, uLowCloud, uLowAmbSky, uLowKeyColor, uLowHorizon;
void main() {
  float up = vShaft.y, t = uTime * uCurtain.z;
  float wobble = vnoise(vec2(up * 1.7 + vSeed * 11., vSeed * 5.)) - .5;
  float shape = smoothstep(1., .2, abs(vShaft.x + wobble * .6)) * smoothstep(0., .3, up) * smoothstep(1., .55, up);
  // Rain falls in fine fast streaks; snow drifts in a slow mottled veil.
  float streaks = uCurtain.y < .5
    ? .3 + .7 * smoothstep(.45, .85, vnoise(vec2(vShaft.z * 11. + vSeed * 40., vWorld.y * .9 + t * 4.)))
    : vnoise(vec2(vShaft.z * 3. + vSeed * 40., vWorld.y * 3. + t * .4)) * .6 + .4;
  float alpha = shape * streaks * vAlpha * mix(.75, .45, uCurtain.y);
  // Rain shafts read darker than the air around them, snow lighter; far ones sink into the valley's haze.
  vec3 color = uLowCloud * (uLowAmbSky + uLowKeyColor * .2) * mix(.4, 1.5, uCurtain.y);
  color = mix(color, uLowHorizon, clamp(distance(vWorld, uCamPos) / 70., 0., .6));
  outColor = vec4(color * alpha, alpha);
}`,
  // Windows and lanterns in the valley after dark (local time), dimmed by the valley's fog; additive points.
  lightVertex: header + 'uniform vec3 uCamPos;\n' + weatherAir + `
layout(location = 0) in vec4 aLight;  // position, and the share of lights at which this one is on
uniform mat4 uViewProj;
uniform float uTime, uHeight;
uniform vec2 uLights;  // share of lights on, brightness
out vec3 vColor;
void main() {
  float dist = distance(aLight.xyz, uCamPos);
  float on = smoothstep(aLight.w, aLight.w + .04, uLights.x);
  float seen = exp(-uLowAir.x * lowFogAlong(uCamPos.y, aLight.y) * max(dist - 2.5, 0.)) * smoothstep(1.5, 4., dist);
  float flicker = 1. + sin(uTime * (1.1 + aLight.w * 2.3) + aLight.w * 61.) * .07;
  vColor = vec3(1., .55, .2) * uLights.y * on * seen * flicker;
  gl_Position = on * seen > .01 ? uViewProj * vec4(aLight.xyz, 1.) : vec4(2., 2., 2., 1.);
  gl_PointSize = clamp(uHeight * .04 / max(dist, .1), uHeight / 240., uHeight / 100.);
}`,
  lightFragment: header + `
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor * smoothstep(.5, .1, length(gl_PointCoord - .5)), 0.); }`
});
