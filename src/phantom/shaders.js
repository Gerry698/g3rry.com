// GLSL for the lab. Positions live in transform-feedback buffers; targets live in float textures read with texelFetch.
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

// Shared by the simulation and the point renderer so both agree on each particle's morph progress.
const morph = `
uniform sampler2D uFromPos;
uniform sampler2D uToPos;
uniform float uMorph;
uniform float uSpread;
uniform vec4 uSweep;
uint hashu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hash1(uint x) { return float(hashu(x)) * (1.0 / 4294967295.0); }
ivec2 cellOf(int id) { return ivec2(id & 1023, id >> 10); }
float progressOf(float seed, vec3 to) {
  float key = mix(seed, clamp(0.5 + dot(to, uSweep.xyz), 0.0, 1.0), uSweep.w);
  return smoothstep(key * uSpread, key * uSpread + 1.0 - uSpread, uMorph);
}
`;

// Simplex noise with its analytic gradient (after Gustavson and McEwan's public-domain GLSL version).
const noise = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec3 noiseGradient(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - 0.5;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec4 j = p - 49.0 * floor(p * (1.0 / 49.0));
  vec4 x_ = floor(j * (1.0 / 7.0));
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = (x_ * 2.0 + 0.5) / 7.0 - 1.0;
  vec4 y = (y_ * 2.0 + 0.5) / 7.0 - 1.0;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 g0 = normalize(vec3(a0.xy, h.x));
  vec3 g1 = normalize(vec3(a0.zw, h.y));
  vec3 g2 = normalize(vec3(a1.xy, h.z));
  vec3 g3 = normalize(vec3(a1.zw, h.w));
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m3 = m2 * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(g0, x0), dot(g1, x1), dot(g2, x2), dot(g3, x3));
  vec4 t = m3 * pdotx;
  vec3 grad = -8.0 * (t.x * x0 + t.y * x1 + t.z * x2 + t.w * x3) + m4.x * g0 + m4.y * g1 + m4.z * g2 + m4.w * g3;
  return grad * 105.0;
}
// The cross product of two gradients is divergence-free, so the flow swirls without bunching up.
vec3 flow(vec3 p) {
  return cross(noiseGradient(p), noiseGradient(p + vec3(31.416, -47.853, 12.793)));
}
`;

export const simVertex = header + morph + noise + `
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec4 aVel;
uniform float uDt;
uniform float uTime;
uniform float uStiffness;
uniform float uDamping;
uniform float uTurbulence;
uniform float uFlightTurbulence;
uniform float uNoiseScale;
uniform vec3 uRayOrigin;
uniform vec3 uRayDir;
uniform float uRayRadius;
uniform float uRayForce;
uniform vec4 uShock[4];
uniform float uShockSpeed;
uniform float uShockWidth;
uniform float uShockForce;
uniform float uSnap;
out vec4 vPos;
out vec4 vVel;
void main() {
  ivec2 cell = cellOf(gl_VertexID);
  vec3 from = texelFetch(uFromPos, cell, 0).xyz;
  vec3 to = texelFetch(uToPos, cell, 0).xyz;
  float seed = hash1(uint(gl_VertexID) * 747796405u + 2891336453u);
  float m = progressOf(seed, to);
  vec3 target = mix(from, to, m);
  float flight = sin(3.14159265 * m);
  if (uSnap > 0.5) { vPos = vec4(target, 1.0); vVel = vec4(0.0); return; }
  vec3 p = aPos.xyz;
  vec3 v = aVel.xyz;
  float k = uStiffness * (0.7 + 0.6 * seed) * (1.0 - 0.9 * flight);
  vec3 force = (target - p) * k;
  float swirl = uTurbulence + uFlightTurbulence * flight;
  if (swirl > 0.0) force += flow(p * uNoiseScale + vec3(0.0, 0.0, uTime * 0.07)) * swirl;
  vec3 w = p - uRayOrigin;
  vec3 r = w - uRayDir * dot(w, uRayDir);
  float d = length(r);
  force += r / max(d, 1e-4) * uRayForce * exp(-d * d / (uRayRadius * uRayRadius));
  for (int i = 0; i < 4; i++) {
    vec4 s = uShock[i];
    if (s.w < 0.0) continue;
    vec3 q = p - s.xyz;
    float dq = length(q);
    float x = (dq - s.w * uShockSpeed) / uShockWidth;
    force += q / max(dq, 1e-4) * uShockForce * exp(-x * x) * exp(-s.w * 1.8);
  }
  float damping = 2.0 * sqrt(max(k, 0.5)) * uDamping;
  v += force * uDt;
  v *= exp(-damping * uDt);
  p += v * uDt;
  vPos = vec4(p, 1.0);
  vVel = vec4(v, flight);
}
`;

export const simFragment = header + `
out vec4 color;
void main() { color = vec4(0.0); }
`;

export const pointVertex = header + morph + `
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec4 aVel;
uniform sampler2D uFromColor;
uniform sampler2D uToColor;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uCoc;
uniform float uFocus;
uniform float uBase;
uniform float uMaxSize;
uniform float uGain;
uniform float uTime;
uniform float uNear;
uniform float uMode;
uniform float uContours;
uniform vec3 uContourOrigin;
uniform float uContourUnit;
uniform sampler2D uShadow;
uniform mat4 uSunMatrix;
uniform float uSun;
uniform vec3 uSunColor;
uniform float uShadowBias;
uniform float uFromGain;
uniform float uToGain;
uniform float uDustGain;
uniform sampler2D uPhoto;
uniform mat4 uPhotoMatrix;
uniform float uPhotoMix;
out vec3 vColor;
out float vSize;
out vec2 vScreen;
// Size flag and an optional second value (smoothed light level), packed as size + 16 * level8; negative means dust.
vec2 unpackFlag(float w) { return w < 0.0 ? vec2(w, 0.0) : vec2(mod(w, 16.0), floor(w / 16.0) / 255.0); }
void main() {
  ivec2 cell = cellOf(gl_VertexID);
  vec4 fromPos = texelFetch(uFromPos, cell, 0);
  vec4 toPos = texelFetch(uToPos, cell, 0);
  float seed = hash1(uint(gl_VertexID) * 747796405u + 2891336453u);
  float m = progressOf(seed, toPos.xyz);
  vec4 color = mix(texelFetch(uFromColor, cell, 0), texelFetch(uToColor, cell, 0), m);
  vec2 fromFlag = unpackFlag(fromPos.w), toFlag = unpackFlag(toPos.w);
  float flags = mix(fromFlag.x, toFlag.x, m);
  float smoothLight = mix(fromFlag.y, toFlag.y, m);
  vec4 view = uView * vec4(aPos.xyz, 1.0);
  gl_Position = uProjection * view;
  float z = -view.z;
  if (z < uNear) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // Thin lens: blur-circle diameter grows with |z - focus| / z; uCoc folds in focal length, aperture and sensor-to-pixel scale.
  float coc = uCoc * abs(z - uFocus) / z;
  float size = clamp(max(coc, uBase * abs(flags)), 1.0, uMaxSize);
  // The same light spread over a larger disc: brightness falls with area so focus pulls never change exposure.
  float energy = uBase * uBase * abs(flags) * abs(flags) / (size * size);
  // Dust keeps a fixed count at every quality level, so it has its own gain instead of the set's per-particle one.
  float intensity = exp2(color.a * 14.0 - 8.0) * (flags < 0.0 ? uDustGain : mix(uFromGain, uToGain, m));
  float twinkle = flags < 0.0 ? 0.6 + 0.4 * sin(uTime * (0.4 + seed * 1.3) + seed * 61.0) : 1.0;
  float heat = 1.0 + 1.2 * aVel.w;
  vec3 rgb = pow(color.rgb, vec3(2.2));
  // The sun at the moment of exposure: a point the sun's depth map sees first is lit, warm; one behind something is in
  // shadow, lit only by the blue sky. Nine taps soften the edge of the map's texels.
  if (uSun > 0.0 && flags >= 0.0) {
    vec4 ls = uSunMatrix * vec4(aPos.xyz, 1.0);
    vec3 p = ls.xyz / ls.w * 0.5 + 0.5;
    float lit = 1.0;
    if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0 && p.z < 1.0) {
      ivec2 size = textureSize(uShadow, 0), c = ivec2(p.xy * vec2(size));
      float sum = 0.0;
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
        sum += p.z - uShadowBias <= texelFetch(uShadow, clamp(c + ivec2(dx, dy), ivec2(0), size - 1), 0).r ? 1.0 : 0.0;
      lit = sum / 9.0;
    }
    rgb = mix(rgb, mix(rgb * vec3(0.5, 0.6, 0.85), rgb * uSunColor, lit), uSun);
    intensity *= mix(1.0, mix(0.3, 2.6, lit), uSun);
  }
  // At an atlas stop the photograph is projected from where it was taken: points inside its frame take its colour.
  if (uPhotoMix > 0.0) {
    vec4 shot = uPhotoMatrix * vec4(mix(fromPos.xyz, toPos.xyz, m), 1.0);
    vec2 uv = shot.xy / max(shot.w, 1e-4) * 0.5 + 0.5;
    float inside = shot.w > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 ? 1.0 : 0.0;
    vec3 photo = pow(textureLod(uPhoto, vec2(uv.x, 1.0 - uv.y), 0.0).rgb, vec3(2.2));
    rgb = mix(rgb, photo * 1.15, uPhotoMix * inside);
    intensity *= mix(1.0, mix(0.3, 2.4, inside), uPhotoMix);
  }
  // Contour modes keep only points near an iso-level: equal light (isophotes) or equal distance from where the photo was taken.
  if (uContours > 0.0) {
    float luma = pow(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), 0.45);
    float level = uMode < 1.5 ? smoothLight * 16.0 : log2(max(distance(mix(fromPos.xyz, toPos.xyz, m), uContourOrigin) * uContourUnit, 1e-3)) * 5.0;
    float keep = smoothstep(0.8, 0.96, abs(fract(level) - 0.5) * 2.0);
    rgb = mix(rgb, vec3(1.0, 0.8, 0.5) * (0.35 + luma), uContours * 0.8);
    intensity *= mix(1.0, keep * 2.4, uContours);
  }
  vColor = rgb * intensity * energy * twinkle * heat * uGain;
  gl_PointSize = size;
  vSize = size;
  vScreen = gl_Position.xy / gl_Position.w;
}
`;

export const pointFragment = header + `
in vec3 vColor;
in float vSize;
in vec2 vScreen;
uniform float uBlades;
uniform float uRoundness;
uniform float uCatEye;
out vec4 color;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  float core = exp(-r2 * 4.0);
  float shape = core;
  float bokeh = smoothstep(2.5, 7.0, vSize);
  if (bokeh > 0.0) {
    // Nine rounded blades, plus mechanical vignetting: a second pupil shifted toward the frame centre clips edge highlights into cat's eyes.
    float sector = 6.2831853 / uBlades;
    float a = mod(atan(q.y, q.x) + 0.35, sector) - 0.5 * sector;
    float edge = mix(cos(0.5 * sector) / cos(a), 1.0, uRoundness);
    float e = sqrt(r2) / edge;
    float e2 = length(q + vScreen * uCatEye);
    float aa = 2.5 / vSize;
    float disc = (1.0 - smoothstep(1.0 - aa, 1.0, e)) * (1.0 - smoothstep(1.0 - aa, 1.0, e2));
    float rim = 0.78 + 0.4 * smoothstep(0.5, 1.0, e);
    shape = mix(core, disc * rim * 0.245, bokeh);
  }
  if (shape < 0.003) discard;
  color = vec4(vColor * shape, 1.0);
}
`;

export const fullscreenVertex = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Exponential shutter: each frame keeps a fraction of the last, which is how a long exposure integrates moving light.
export const accumulateFragment = header + `
in vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uPrevious;
uniform float uDecay;
out vec4 color;
void main() {
  color = vec4(mix(texture(uCurrent, vUv).rgb, texture(uPrevious, vUv).rgb, uDecay), 1.0);
}
`;

// 13-tap downsample (Jimenez 2014); the first level uses a Karis average so single bright points cannot flicker the bloom.
export const downFragment = header + `
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uKaris;
out vec4 color;
vec3 tap(vec2 o) { return texture(uSource, vUv + o * uTexel).rgb; }
float weight(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0)), l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
  vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
  vec4 w = uKaris > 0.5 ? vec4(weight(g0), weight(g1), weight(g2), weight(g3)) : vec4(1.0);
  float w4 = uKaris > 0.5 ? weight(g4) : 1.0;
  vec3 sum = (g0 * w.x + g1 * w.y + g2 * w.z + g3 * w.w) * 0.125 + g4 * w4 * 0.5;
  color = vec4(sum / (dot(w, vec4(0.125)) + w4 * 0.5), 1.0);
}
`;

export const upFragment = header + `
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uWeight;
out vec4 color;
void main() {
  vec2 t = uTexel;
  vec3 s = texture(uSource, vUv + vec2(-t.x, t.y)).rgb + 2.0 * texture(uSource, vUv + vec2(0.0, t.y)).rgb + texture(uSource, vUv + t).rgb
    + 2.0 * texture(uSource, vUv + vec2(-t.x, 0.0)).rgb + 4.0 * texture(uSource, vUv).rgb + 2.0 * texture(uSource, vUv + vec2(t.x, 0.0)).rgb
    + texture(uSource, vUv - t).rgb + 2.0 * texture(uSource, vUv + vec2(0.0, -t.y)).rgb + texture(uSource, vUv + vec2(t.x, -t.y)).rgb;
  color = vec4(s * (uWeight / 16.0), 1.0);
}
`;

export const compositeFragment = header + `
in vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uHalation;
uniform float uGrain;
uniform float uFrame;
uniform float uTanCorner;
uniform float uAberration;
uniform vec3 uInner;
uniform vec3 uOuter;
out vec4 color;
// Khronos PBR Neutral: keeps photographic hues intact and only rolls highlights off toward white.
vec3 neutral(vec3 c) {
  float x = min(c.r, min(c.g, c.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= offset;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 0.76) return c;
  float d = 0.24;
  float newPeak = 1.0 - d * d / (peak + d - 0.76);
  c *= newPeak / peak;
  float g = 1.0 - 1.0 / (0.15 * (peak - newPeak) + 1.0);
  return mix(c, vec3(newPeak), g);
}
vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
uint hashu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float rand(uvec3 v) { return float(hashu(v.x ^ hashu(v.y ^ hashu(v.z)))) * (1.0 / 4294967295.0); }
void main() {
  vec2 centred = vUv - 0.5;
  float aspect = uResolution.x / uResolution.y;
  float radius = length(centred * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
  vec2 shift = centred * uAberration * radius;
  vec3 c = vec3(texture(uImage, vUv - shift).r, texture(uImage, vUv).g, texture(uImage, vUv + shift).b);
  vec3 bloom = texture(uBloom, vUv).rgb;
  c += bloom * uBloomStrength + bloom * vec3(1.0, 0.38, 0.18) * uHalation;
  c += mix(uInner, uOuter, smoothstep(0.0, 1.1, radius));
  // Natural vignetting follows cos^4 of the field angle; real lenses correct part of it, so only part is applied.
  float theta = atan(radius * uTanCorner);
  c *= mix(1.0, pow(cos(theta), 4.0), 0.5);
  c = encode(neutral(c * uExposure));
  uvec3 seed = uvec3(gl_FragCoord.xy, uint(uFrame));
  float n = rand(seed) + rand(seed + uvec3(7u, 13u, 101u)) - 1.0;
  color = vec4(c + n * uGrain, 1.0);
}
`;

// The sun's view of the scene: the same points, drawn as small squares into a depth map. Dust drifts near the lens and
// casts no shadow.
export const shadowVertex = header + morph + `
layout(location = 0) in vec4 aPos;
uniform mat4 uSunMatrix;
uniform float uSplat;
void main() {
  ivec2 cell = cellOf(gl_VertexID);
  if (texelFetch(uToPos, cell, 0).w < 0.0 || texelFetch(uFromPos, cell, 0).w < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = uSunMatrix * vec4(aPos.xyz, 1.0);
  gl_PointSize = uSplat;
}
`;
export const shadowFragment = header + `
out vec4 color;
void main() { color = vec4(0.0); }
`;

// The camera station drawn as a frustum of light lines, shown while the view is away from it.
export const lineVertex = header + `
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProjection;
void main() { gl_Position = uViewProjection * vec4(aPos, 1.0); }
`;
export const lineFragment = header + `
uniform vec3 uColor;
out vec4 color;
void main() { color = vec4(uColor, 1.0); }
`;

// The sun itself, a disc half a degree across in its true direction, with a glow the bloom carries further.
export const sunVertex = header + `
uniform mat4 uViewProjection;
uniform vec3 uEye;
uniform vec3 uDir;
uniform float uDistance;
uniform float uSize;
void main() {
  gl_Position = uViewProjection * vec4(uEye + uDir * uDistance, 1.0);
  gl_PointSize = uSize;
}
`;
export const sunFragment = header + `
uniform vec3 uColor;
uniform float uDisc;
out vec4 color;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float disc = 1.0 - smoothstep(uDisc * 0.85, uDisc, r);
  float glow = exp(-r * r * 9.0) * 0.25 + exp(-r * 3.0) * 0.04;
  color = vec4(uColor * (disc * 60.0 + glow * 6.0), 1.0);
}
`;
