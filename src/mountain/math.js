export const TAU = Math.PI * 2;
export const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOut = t => 1 - Math.pow(1 - t, 3);
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const normalize = a => scale(a, 1 / (length(a) || 1));
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// Direction from compass azimuth and elevation in degrees; azimuth runs from +x towards +z.
export const direction = (azimuth, elevation) => {
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
};

// Column-major 4x4 matrices, as WebGL expects.
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function orthographic(left, right, bottom, top, near, far) {
  const lr = 1 / (left - right), bt = 1 / (bottom - top), nf = 1 / (near - far);
  return new Float32Array([-2 * lr, 0, 0, 0, 0, -2 * bt, 0, 0, 0, 0, 2 * nf, 0, (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1]);
}
export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = normalize(sub(eye, target));
  let x = cross(up, z);
  if (length(x) < 1e-6) x = cross([0, 0, 1], z);
  x = normalize(x);
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
    out[column * 4 + row] = sum;
  }
  return out;
}
export function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det
  ]);
}
export function transform(m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w];
}

// Deterministic PRNG (mulberry32) so the mountain is the same on every visit.
export function random(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 2D gradient noise in roughly [-1, 1].
export function noise2(seed) {
  const next = random(seed), perm = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255];
  for (let i = 0; i < 256; i++) { const a = next() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const h00 = perm[X + perm[Y]], h10 = perm[X + 1 + perm[Y]], h01 = perm[X + perm[Y + 1]], h11 = perm[X + 1 + perm[Y + 1]];
    const n00 = gx[h00] * xf + gy[h00] * yf, n10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const n01 = gx[h01] * xf + gy[h01] * (yf - 1), n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    return 1.4 * lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  };
}
export function fbm(noise, x, y, octaves, gain = .5, lacunarity = 2.03) {
  let sum = 0, amplitude = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x, y) * amplitude; total += amplitude;
    amplitude *= gain; x = x * lacunarity + 17.1; y = y * lacunarity - 9.3;
  }
  return sum / total;
}
// Ridged multifractal: sharp crests where the noise crosses zero, each octave weighted by the one before.
export function ridged(noise, x, y, octaves, gain = .5, lacunarity = 2.1) {
  let sum = 0, amplitude = .5, weight = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x, y));
    n *= n * weight;
    weight = clamp(n * 1.6, 0, 1);
    sum += n * amplitude; total += amplitude;
    amplitude *= gain; x = x * lacunarity + 31.7; y = y * lacunarity + 5.9;
  }
  return sum / total;
}

export function hexToLinear(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255].map(c => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); });
}
