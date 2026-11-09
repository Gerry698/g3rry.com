// GLSL for the water (water.js builds the meshes, water-renderer.js draws them). Same conventions as shaders.js:
// linear HDR, flat facets from screen-space derivatives, the shared sky, fog and shadow functions.
import { chunks } from './shaders.js';

const { header, noise, atmosphere, lighting, corners } = chunks;

// White water (the stream's steep stretches and the fall) is mostly air and foam: it scatters light rather than mirroring
// the sky, so it is lit like a matte, slightly translucent surface, a shade under the snow's white so it never outshines the
// summit or flares in the bloom. foam: 0 for the water's own deep colour, 1 for white.
const whiteWater = `
vec3 whiteWater(float foam, vec3 n, vec3 world, float shadow) {
  float low = underDeck(world);
  vec3 deep = mix(mix(uHorizon, uZenith, .92), mix(uLowHorizon, uLowZenith, .92), low) * .8;
  return light(mix(deep, vec3(.52, .56, .6), clamp(foam, 0., 1.)), n, 1., .85, mix(shadow, 1., .2), world);
}
`;

// River and pool. aPosition.w is the water's depth at the vertex; aFacet is the same on all three corners of a facet:
// distance along the course, position across it (−1 to 1), mean depth, and how fast the level falls there.
export const waterVertex = header + `
layout(location = 0) in vec4 aPosition;
layout(location = 1) in vec4 aFacet;
uniform mat4 uViewProj;
uniform float uTime;
out vec4 vWorld;
flat out vec4 vFacet;
void main() {
  vec3 p = aPosition.xyz;
  // A slow swell on two crossing waves tilts the facets so they catch the sky in turn. It depends on position alone,
  // so corners shared by neighbouring facets move together; far out, where facets are larger, the waves are too.
  float scale = clamp(length(p.xz) / 10., 1., 7.);
  vec2 q = p.xz / scale;
  p.y += (sin(dot(q, vec2(3.1, 2.3)) + uTime * 1.3) + sin(dot(q, vec2(-1.9, 3.7)) - uTime * 1.7) * .7) * .022 * scale;
  vWorld = vec4(p, aPosition.w);
  vFacet = aFacet;
  gl_Position = uViewProj * vec4(p, 1.);
}`;

export const waterFragment = header + noise + atmosphere + lighting + whiteWater + `
in vec4 vWorld;
flat in vec4 vFacet;
out vec4 outColor;
uniform float uTime;
uniform vec3 uFoot;
void main() {
  vec3 world = vWorld.xyz;
  vec3 n = normalize(cross(dFdx(world), dFdy(world)));
  if (n.y < 0.) n = -n;
  vec3 v = normalize(uCamPos - world);
  float shadow = shadowAt(world, n);
  // Below the cloud deck the valley's own hour and weather light the water (weather-shaders.js).
  float low = underDeck(world);
  vec3 keyDir = normalize(mix(uKeyDir, uLowKeyDir, low)), keyColor = mix(uKeyColor, uLowKeyColor, low);
  // Each facet mirrors the sky in its own direction, steepened a little so it picks up the deeper sky rather than the
  // haze at the horizon, and the Fresnel term has a floor, so even seen from above the water reads as a strip of sky.
  vec3 r = reflect(-v, n);
  r = normalize(vec3(r.x, abs(r.y) * 1.35, r.z));
  vec3 sky = mix(skyColor(r), lowSky(r), low);
  float fresnel = .04 + .96 * pow(1. - max(dot(n, v), 0.), 5.);
  // Below the surface the water takes the sky's own deep colour, lighter in the shallows, a little different facet by facet.
  float depth = vFacet.z;
  vec3 body = mix(mix(uHorizon, uZenith, .92), mix(uLowHorizon, uLowZenith, .92), low) * mix(.62, .22, smoothstep(.02, .35, depth));
  vec3 ambient = mix(mix(uAmbGround, uAmbSky, .8), mix(uLowAmbGround, uLowAmbSky, .8), low);
  float diffuse = max(dot(n, keyDir), 0.);
  vec3 color = mix(body + keyColor * diffuse * shadow * .015, sky, .16 + .84 * fresnel) * (.86 + .28 * hash12(vFacet.xy * 17.3));
  // Glints of sun or moon on facets turned just right.
  float glint = max(dot(reflect(-v, n), keyDir), 0.);
  color += keyColor * (pow(glint, 60.) * 1.4 + pow(glint, 8.) * .1) * shadow;
  // Steep stretches (the stream on its way to the lip) are white water, not a mirror: lit matte like the fall, with streaks
  // of foam sliding down. Otherwise half their tumbled facets would catch the dark zenith and read as a chequerboard.
  float rapid = smoothstep(.25, .8, vFacet.w);
  if (rapid > 0.) {
    float rush = vnoise(vec2(vFacet.y * 2.6 + 1.7, vFacet.x * 7. - uTime * 3.2));
    color = mix(color, whiteWater(.5 + (rush - .5) * 1.1, n, world, shadow), rapid);
  }
  // Foam: whole facets turn white where the water is shallow against a bank, where it runs fast, and where it churns under
  // the fall; the pattern steps downstream with the flow. A thin line marks the water's edge itself.
  float speed = vFacet.w;
  float churn = (1. - smoothstep(.15, .6, distance(world.xz, uFoot.xz))) * (.35 + .65 * hash12(vFacet.xy * 7.1 + floor(uTime * 2.5)));
  float foam = clamp(smoothstep(.07, .02, depth) * step(0., depth) * .3 + smoothstep(.03, .45, speed) * .7 + churn * .75, 0., 1.);
  float flow = vFacet.x * 3. - uTime * (.55 + min(speed, 1.) * 5.);
  float pick = hash12(vec2(floor(flow + vFacet.y * 1.7), floor(vFacet.y * 4. + 7.)));
  float white = step(1. - foam * .8, pick) * (.55 + .45 * foam);
  float edge = smoothstep(.04, 0., vWorld.w) * (.45 + .55 * step(.35, hash12(vec2(floor(flow * 1.3 + vFacet.y * 3.), 5.))));
  vec3 froth = vec3(.9, .94, 1.) * (ambient * 1.35 + keyColor * (diffuse * .65 + .12) * shadow);
  color = mix(color, froth, max(white, edge * .5));
  outColor = vec4(atmosphere(color, world), 1.);
}`;

// The falling water (water.js). aFall is the same on all three corners of a facet: how far down (0 at the lip, 1 at the
// pool; 2 for the foam ring at the foot), position across (−1 to 1), column and row. uLip: the lip and the drop below it.
export const fallVertex = header + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aFall;
uniform mat4 uViewProj;
uniform float uTime;
uniform vec4 uLip;
uniform vec3 uFoot;
out vec3 vWorld;
out vec4 vFall;
void main() {
  vec3 p = aPosition;
  if (aFall.x > 1.5) {
    // The foam ring heaves: each peak rises and falls on its own beat.
    p.y += max(p.y - uFoot.y, 0.) * sin(uTime * 5.3 + p.x * 23. + p.z * 17.) * .45;
  } else {
    // The body trembles a little more the further it has fallen. Everything here depends on position alone, so corners
    // shared by neighbouring facets move together and no cracks open.
    float down = clamp((uLip.y - p.y) / uLip.w, 0., 1.);
    p.xz += vec2(sin(p.y * 11. - uTime * 8. + p.x * 7.), cos(p.y * 9. - uTime * 7. + p.z * 7.)) * .009 * down;
  }
  vWorld = p;
  vFall = aFall;
  gl_Position = uViewProj * vec4(p, 1.);
}`;

export const fallFragment = header + noise + atmosphere + lighting + whiteWater + `
in vec3 vWorld;
in vec4 vFall;
out vec4 outColor;
uniform float uTime;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(uCamPos - vWorld);
  if (dot(n, v) < 0.) n = -n;
  float low = underDeck(vWorld);
  vec3 keyDir = normalize(mix(uKeyDir, uLowKeyDir, low)), keyColor = mix(uKeyColor, uLowKeyColor, low);
  // White water (whiteWater above): off the lip as white as the stream that feeds it, whiter as it falls. Whole facets
  // brighten and dim as streaks of foam slide down: long down the fall and narrow across it, so the noise changes fast
  // from column to column and slowly from row to row. The foam ring at the foot flickers facet by facet.
  float f = vFall.x, ring = step(1.5, f);
  float flow = vnoise(vec2(vFall.z * 1.9 + 3.1, vFall.w * .22 - uTime * .75)) * .7 + vnoise(vec2(vFall.z * 3.7 + 9.4, vFall.w * .5 - uTime * 1.6)) * .3;
  float foam = ring > .5 ? .62 + .3 * hash12(vec2(vFall.z, floor(uTime * 4.))) : clamp(.48 + smoothstep(0., .4, f) * .32 + (flow - .5) * 1.1 + abs(vFall.y) * .1, 0., 1.);
  float shadow = shadowAt(vWorld, n);
  vec3 color = whiteWater(foam, n, vWorld, shadow);
  vec3 albedo = vec3(.52, .56, .6) * foam;
  // Sun or moon behind the curtain lights it through, most on the thin flanks.
  float through = pow(max(dot(-v, keyDir), 0.), 3.) * (.25 + .5 * (1. - abs(dot(n, v))));
  color += keyColor * albedo * through * .35 * mix(shadow, 1., .2) * (1. - ring);
  outColor = vec4(atmosphere(color, vWorld), 1.);
}`;

// Spray drifting up from the foot of the fall: soft puffs that rise, swell and fade on their own cycles.
export const mistVertex = header + noise + corners + `
uniform mat4 uViewProj;
uniform vec3 uRight, uUp, uFoot;
uniform float uTime;
out vec2 vCorner;
out float vAlpha;
out vec3 vWorld;
void main() {
  float id = float(gl_InstanceID);
  float seed = hash12(vec2(id, 3.1)), phase = fract(uTime * (.09 + seed * .07) + seed * 7.3);
  float angle = hash12(vec2(id, 8.7)) * 6.2832;
  vec3 center = uFoot + vec3(cos(angle), 0., sin(angle)) * (.15 + phase * .4) + vec3(0., .05 + phase * (.35 + seed * .3), 0.);
  vec2 c = corners[gl_VertexID];
  vCorner = c;
  vAlpha = sin(phase * 3.1416) * (.035 + seed * .045);
  vWorld = center + (c.x * uRight + c.y * uUp) * (.14 + phase * .3);
  gl_Position = uViewProj * vec4(vWorld, 1.);
}`;

export const mistFragment = header + atmosphere + `
in vec2 vCorner;
in float vAlpha;
in vec3 vWorld;
out vec4 outColor;
uniform vec3 uAmbSky;
void main() {
  float a = smoothstep(1., .1, length(vCorner));
  a *= a * vAlpha;
  vec3 color = atmosphere(mix(uAmbSky, uLowAmbSky, underDeck(vWorld)), vWorld);
  outColor = vec4(color * a, a);
}`;
