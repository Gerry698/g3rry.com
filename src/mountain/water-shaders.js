// GLSL for the water (water.js builds the meshes, water-renderer.js draws them). Same conventions as shaders.js:
// linear HDR, flat facets from screen-space derivatives, the shared sky, fog and shadow functions.
import { chunks } from './shaders.js';

const { header, noise, atmosphere, lighting, corners } = chunks;

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

export const waterFragment = header + noise + atmosphere + lighting + `
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
  // Each facet mirrors the sky in its own direction, steepened a little so it picks up the deeper sky rather than the
  // haze at the horizon, and the Fresnel term has a floor, so even seen from above the water reads as a strip of sky.
  vec3 r = reflect(-v, n);
  r = normalize(vec3(r.x, abs(r.y) * 1.35, r.z));
  vec3 sky = skyColor(r);
  float fresnel = .04 + .96 * pow(1. - max(dot(n, v), 0.), 5.);
  // Below the surface the water takes the sky's own deep colour, lighter in the shallows, a little different facet by facet.
  float depth = vFacet.z;
  vec3 body = mix(uHorizon, uZenith, .92) * mix(.62, .22, smoothstep(.02, .35, depth));
  vec3 ambient = mix(uAmbGround, uAmbSky, .8);
  float diffuse = max(dot(n, uKeyDir), 0.);
  vec3 color = mix(body + uKeyColor * diffuse * shadow * .015, sky, .16 + .84 * fresnel) * (.86 + .28 * hash12(vFacet.xy * 17.3));
  // Glints of sun or moon on facets turned just right.
  float glint = max(dot(reflect(-v, n), uKeyDir), 0.);
  color += uKeyColor * (pow(glint, 60.) * 1.4 + pow(glint, 8.) * .1) * shadow;
  // Foam: whole facets turn white where the water is shallow against a bank, where it runs fast, and where it churns under
  // the fall; the pattern steps downstream with the flow. A thin line marks the water's edge itself.
  float speed = vFacet.w;
  float churn = 1. - smoothstep(.15, .8, distance(world.xz, uFoot.xz));
  float foam = clamp(smoothstep(.07, .02, depth) * step(0., depth) * .3 + smoothstep(.03, .45, speed) * .7 + churn * 1.2, 0., 1.);
  float flow = vFacet.x * 3. - uTime * (.55 + min(speed, 1.) * 5.);
  float pick = hash12(vec2(floor(flow + vFacet.y * 1.7), floor(vFacet.y * 4. + 7.)));
  float white = step(1. - foam * .8, pick) * (.55 + .45 * foam);
  float edge = smoothstep(.04, 0., vWorld.w) * (.45 + .55 * step(.35, hash12(vec2(floor(flow * 1.3 + vFacet.y * 3.), 5.))));
  vec3 froth = vec3(.9, .94, 1.) * (ambient * 1.35 + uKeyColor * (diffuse * .65 + .12) * shadow);
  color = mix(color, froth, max(white, edge * .5));
  outColor = vec4(atmosphere(color, world), 1.);
}`;

// The falling water. aFall: how far down (0 at the lip, 1 at the pool), across the sheet (−1 to 1), the sheet's seed.
export const fallVertex = header + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aFall;
uniform mat4 uViewProj;
uniform float uTime;
out vec3 vWorld;
out vec4 vFall;
void main() {
  vec3 p = aPosition;
  p.y += sin(uTime * 6.5 + aFall.x * 9. + aFall.z * 2.) * .006;
  vWorld = p;
  vFall = aFall;
  gl_Position = uViewProj * vec4(p, 1.);
}`;

export const fallFragment = header + noise + atmosphere + lighting + `
in vec3 vWorld;
in vec4 vFall;
out vec4 outColor;
uniform float uTime;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(uCamPos - vWorld);
  if (dot(n, v) < 0.) n = -n;
  float f = clamp(vFall.x, 0., 1.), a = vFall.y;
  // Streaks of white water slide down in columns, each at its own pace; hard-edged, so they read as facets of foam.
  float column = floor(a * 2.5 + 2.5);
  float pace = 1.05 + hash12(vec2(column, vFall.z)) * .7;
  float run = fract(f * 3.2 - uTime * pace + hash12(vec2(vFall.z, column + 3.)));
  float streak = step(.4, run);
  // Ragged sides where a streak thins out.
  if (abs(a) > .78 && run < .32) discard;
  vec3 albedo = mix(vec3(.4, .52, .6), vec3(.86, .92, .97), streak * .7 + f * .25);
  vec3 color = light(albedo, n, 1., .6, shadowAt(vWorld, n));
  color = mix(color, skyColor(reflect(-v, n)), .15);
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
  vec3 center = uFoot + vec3(cos(angle), 0., sin(angle)) * (.12 + phase * .55) + vec3(0., .08 + phase * (.7 + seed * .6), 0.);
  vec2 c = corners[gl_VertexID];
  vCorner = c;
  vAlpha = sin(phase * 3.1416) * (.1 + seed * .1);
  vWorld = center + (c.x * uRight + c.y * uUp) * (.22 + phase * .5);
  gl_Position = uViewProj * vec4(vWorld, 1.);
}`;

export const mistFragment = header + atmosphere + `
in vec2 vCorner;
in float vAlpha;
in vec3 vWorld;
out vec4 outColor;
uniform vec3 uKeyColor, uAmbSky;
void main() {
  float a = smoothstep(1., .1, length(vCorner));
  a *= a * vAlpha;
  vec3 color = atmosphere(uAmbSky * 1.5 + uKeyColor * .35 + .02, vWorld);
  outColor = vec4(color * a, a);
}`;
