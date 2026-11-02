// Target sets: for every particle a position (xyz + size flag) and a colour (sRGB + log intensity).
// Pure functions so they can run in the worker; all randomness is seeded so a set is identical every time it is built.
import { random } from './math.js';

const WARM = [1, .93, .82];
const GOLD = [.86, .7, .43];
const DUST = [.78, .83, .92];
export const intensityCode = value => Math.round(Math.min(1, Math.max(0, (Math.log2(Math.max(value, 1e-6)) + 8) / 14)) * 255);

function createSet(count) {
  return { pos: new Float32Array(count * 4), col: new Uint8Array(count * 4), count, gain: 1 };
}

function put(set, i, x, y, z, flag, rgb, intensity) {
  set.pos[i * 4] = x;
  set.pos[i * 4 + 1] = y;
  set.pos[i * 4 + 2] = z;
  set.pos[i * 4 + 3] = flag;
  set.col[i * 4] = Math.round(Math.min(1, rgb[0]) * 255);
  set.col[i * 4 + 1] = Math.round(Math.min(1, rgb[1]) * 255);
  set.col[i * 4 + 2] = Math.round(Math.min(1, rgb[2]) * 255);
  set.col[i * 4 + 3] = intensityCode(intensity);
}

// Faint points far around the subject; out of focus they become the bokeh that shows depth of field at work.
// A quarter float close to the lens, where even small apertures blur them into discs; the rest hang well behind the subject.
function fillDust(set, start, rand, { inner = 4, outer = 16, intensity = .55, centre = [0, 0, -4] } = {}) {
  for (let i = start; i < set.count; i++) {
    // One in ten is a small lamp: bright enough that its out-of-focus disc still shows once the light is spread over it.
    const level = rand() < .1 ? 6 + 34 * rand() ** 2 : intensity * (.02 + rand() * .12);
    if (rand() < .25) {
      put(set, i, (rand() - .5) * 9, (rand() - .5) * 5.5, 2.2 + rand() * 4, -(1 + rand() * .5), DUST, level);
      continue;
    }
    const u = rand() * 2 - 1, phi = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const r = inner + (outer - inner) * Math.pow(rand(), .8);
    put(set, i, centre[0] + Math.cos(phi) * s * r * 1.4, centre[1] + u * r * .6, centre[2] + Math.sin(phi) * s * r, -(1 + rand() * .6), DUST, level);
  }
}

export function dustCount(count) {
  return Math.min(Math.round(count * .06), 24000);
}

// Opening: a slowly turning ring of light, like an aperture seen from inside, with a haze around it.
export function introSet({ count, seed = 7 }) {
  const set = createSet(count);
  const rand = random(seed);
  const dust = dustCount(count);
  const haze = Math.round(count * .1);
  const ring = count - dust - haze;
  for (let i = 0; i < ring; i++) {
    const a = rand() * Math.PI * 2;
    const spread = Math.pow(rand(), 3) * (rand() < .5 ? -1 : 1);
    const r = 2.2 + spread * .35 + (rand() - .5) * .03;
    const glow = .3 + .7 * Math.pow(.5 + .5 * Math.cos(a * 3 + 1.2), 2);
    put(set, i, Math.cos(a) * r, Math.sin(a) * r, (rand() - .5) * .08 + spread * .2, 1, rand() < .2 ? GOLD : WARM, glow * (.7 + rand() * .6));
  }
  // A faint veil of light inside and around the ring, thickest near it.
  for (let i = ring; i < ring + haze; i++) {
    const a = rand() * Math.PI * 2;
    const r = 2.2 + (rand() + rand() + rand() - 1.5) * 1.1;
    put(set, i, Math.cos(a) * r, Math.sin(a) * r, (rand() - .5) * 1.2, 1, WARM, .22 * rand());
  }
  fillDust(set, ring + haze, rand, { intensity: .7 });
  return set;
}

// Squared Euclidean distance transform (Felzenszwalb and Huttenlocher), one dimension at a time.
function distance1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}

function insideDistance(mask, w, h) {
  const big = 1e12;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? big : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    distance1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    distance1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]);
  }
  return grid;
}

function cumulative(weights) {
  const cdf = new Float64Array(weights.length);
  let total = 0;
  for (let i = 0; i < weights.length; i++) { total += weights[i]; cdf[i] = total; }
  return { cdf, total };
}

function pick(cdf, value) {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < value) lo = mid + 1; else hi = mid; }
  return lo;
}

// A mark image becomes either a flat sheet of light or a relief with rounded edges, lit from the upper left.
export function markSet({ count, pixels, width, height, relief = false, seed = 11 }) {
  const set = createSet(count);
  const rand = random(seed);
  // The image is padded by a pixel of darkness so shapes touching its border still get an edge.
  const w = width + 2, h = height + 2;
  const bright = new Float32Array(w * h);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const luminance = (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) / 255;
    const value = Math.max(0, Math.min(1, (luminance - .3) / .3)) * pixels[i + 3] / 255;
    bright[(y + 1) * w + x + 1] = value;
  }
  const fit = Math.min(2.9 / width, 2.0 / height);
  const thickness = .15 / fit, bevel = .09 / fit;
  // Relief height follows a quarter-circle bevel of the distance to the outline. The distance is interpolated at each
  // point's own sub-pixel position (the outline sits half a pixel outside the last lit pixel), so the bevel is smooth
  // rather than stepped, and front and back faces meet exactly at the silhouette.
  const inside = relief ? insideDistance(bright.map(value => value > .25 ? 1 : 0), w, h) : null;
  const distanceAt = (fx, fy) => {
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const i = y0 * w + x0;
    return (inside[i] * (1 - tx) + inside[i + 1] * tx) * (1 - ty) + (inside[i + w] * (1 - tx) + inside[i + w + 1] * tx) * ty;
  };
  const heightAt = (fx, fy) => {
    const t = Math.min(Math.max(distanceAt(fx, fy) - .5, 0) / bevel, 1);
    return thickness * Math.sqrt(1 - (1 - t) ** 2);
  };
  const weights = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!relief) { weights[i] = bright[i]; continue; }
    if (inside[i] <= 0) continue;
    const gx = (heightAt(x + .5, y) - heightAt(x - .5, y)), gy = (heightAt(x, y + .5) - heightAt(x, y - .5));
    // Sample by surface area so the steep bevels are as dense as the faces.
    weights[i] = Math.min(6, Math.sqrt(1 + gx * gx + gy * gy)) * (.35 + .65 * bright[i]);
  }
  const { cdf, total } = cumulative(weights);
  const shapes = count - dustCount(count);
  const light = [-.45, .55, .7];
  const norm = Math.hypot(...light);
  for (let n = 0; n < shapes; n++) {
    const i = pick(cdf, rand() * total);
    const px = i % w + rand() - .5, py = Math.floor(i / w) + rand() - .5;
    const x = (px - w / 2) * fit, y = -(py - h / 2) * fit;
    if (!relief) {
      const b = bright[i];
      const rgb = GOLD.map((g, k) => g + (WARM[k] - g) * b);
      // Uneven brightness per point keeps the grain of a million separate lights visible inside a solid stroke.
      put(set, n, x, y, (rand() - .5) * .025, 1, rgb, (.3 + b * .9) * (.25 + 1.5 * rand() ** 2));
      continue;
    }
    const front = rand() < .62;
    const gx = heightAt(px + .35, py) - heightAt(px - .35, py), gy = heightAt(px, py + .35) - heightAt(px, py - .35);
    // Surface normal of z = h(x, y); image y runs down, so its slope flips sign in world space.
    let nx = -gx / .7, ny = gy / .7, nz = front ? 1 : -1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    const diffuse = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / norm);
    const rim = Math.pow(1 - Math.abs(nz), 2.5);
    const z = heightAt(px, py) * fit * (front ? 1 : -1);
    const shade = front ? .16 + .95 * diffuse + .55 * rim : .1 + .25 * diffuse + .35 * rim;
    const rgb = rim > .3 ? GOLD : WARM;
    put(set, n, x, y, z, 1, rgb, shade * (.7 + .5 * bright[i]) * (.45 + rand() * 1.1));
  }
  fillDust(set, shapes, rand);
  return set;
}

// Positive size flags carry a second value: flag = size + 16 * round(255 * level), with size < 16. Dust flags stay negative.
const packFlag = (size, level) => Math.min(size, 15.9) + 16 * Math.round(Math.max(0, Math.min(1, level)) * 255);

function blurredLuminance(pixels, width, height, radius) {
  let a = new Float32Array(width * height), b = new Float32Array(width * height);
  for (let i = 0; i < a.length; i++) a[i] = Math.pow((.2126 * pixels[i * 4] + .7152 * pixels[i * 4 + 1] + .0722 * pixels[i * 4 + 2]) / 255, .8);
  // Two passes of a separable box filter approximate a gaussian.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += a[y * width + Math.max(0, Math.min(width - 1, x))];
      for (let x = 0; x < width; x++) {
        b[y * width + x] = sum / (2 * radius + 1);
        sum += a[y * width + Math.min(width - 1, x + radius + 1)] - a[y * width + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += b[Math.max(0, Math.min(height - 1, y)) * width + x];
      for (let y = 0; y < height; y++) {
        a[y * width + x] = sum / (2 * radius + 1);
        sum += b[Math.min(height - 1, y + radius + 1) * width + x] - b[Math.max(0, y - radius) * width + x];
      }
    }
  }
  return a;
}

// A photograph becomes one point per sample, pushed back to its estimated distance along the ray it was taken through.
// From the camera position at the origin it projects to exactly the original frame; anywhere else the depth shows.
// `frame` (optional) places the camera: { pos, right, up, forward } in scene units, for a photograph set into the atlas.
export function photoSet({ count, pixels, width, height, depth, depthWidth, depthHeight, tanX, tanY, unit, sizeFlag, frame = null, seed = 23 }) {
  const set = createSet(count);
  const rand = random(seed);
  const shapes = Math.min(width * height, count - dustCount(count));
  const step = Math.sqrt(width * height / shapes);
  // Isophotes are read from luminance smoothed over a few pixels; raw pixels would break every line into grain.
  const smooth = blurredLuminance(pixels, width, height, Math.max(2, Math.round(width / 260)));
  let n = 0;
  for (let gy = 0; n < shapes && gy < height; gy += step) {
    for (let gx = 0; n < shapes && gx < width; gx += step) {
      const sx = gx + rand() * step, sy = gy + rand() * step;
      const x = Math.min(width - 1, Math.floor(sx)), y = Math.min(height - 1, Math.floor(sy));
      const i = (y * width + x) * 4;
      const u = sx / width, v = sy / height;
      // Bilinear depth so the coarser depth map does not print its pixel grid onto the scene.
      const dx = u * depthWidth - .5, dy = v * depthHeight - .5;
      const x0 = Math.max(0, Math.min(depthWidth - 1, Math.floor(dx))), y0 = Math.max(0, Math.min(depthHeight - 1, Math.floor(dy)));
      const x1 = Math.min(depthWidth - 1, x0 + 1), y1 = Math.min(depthHeight - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, dx - x0)), fy = Math.max(0, Math.min(1, dy - y0));
      const d00 = depth[y0 * depthWidth + x0], d10 = depth[y0 * depthWidth + x1], d01 = depth[y1 * depthWidth + x0], d11 = depth[y1 * depthWidth + x1];
      // Across a depth edge (neighbours more than 12% apart), interpolating would hang points in the empty air between
      // subject and background; there each point takes its nearest neighbour instead, so it lands on one side or the other.
      // Elsewhere depth is interpolated geometrically, as metric depth varies.
      const edge = Math.max(d00, d10, d01, d11) > 1.12 * Math.min(d00, d10, d01, d11);
      const z = edge ? (fy < .5 ? (fx < .5 ? d00 : d10) : (fx < .5 ? d01 : d11))
        : Math.exp((Math.log(d00) * (1 - fx) + Math.log(d10) * fx) * (1 - fy) + (Math.log(d01) * (1 - fx) + Math.log(d11) * fx) * fy);
      const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
      const luma = .2126 * r + .7152 * g + .0722 * b;
      // Lift highlights back above white so neon, lamps and the sun bloom as they did in the scene.
      const lift = 1 + 7 * Math.pow(Math.max(0, (luma - .72) / .28), 2);
      const cx = (2 * u - 1) * tanX * z * unit, cy = (1 - 2 * v) * tanY * z * unit, cz = z * unit;
      if (frame) {
        const { pos, right, up, forward } = frame;
        put(set, n, pos[0] + right[0] * cx + up[0] * cy + forward[0] * cz, pos[1] + right[1] * cx + up[1] * cy + forward[1] * cz,
          pos[2] + right[2] * cx + up[2] * cy + forward[2] * cz, packFlag(sizeFlag, smooth[y * width + x]), [r, g, b], lift);
      } else put(set, n, cx, cy, -cz, packFlag(sizeFlag, smooth[y * width + x]), [r, g, b], lift);
      n++;
    }
  }
  fillDust(set, n, rand, { inner: 3, outer: 14, intensity: .25 });
  return set;
}

// The planet: land sampled evenly by area from an equirectangular mask, coasts picked out in gold, a faint graticule
// over the oceans, and a bright cap of light at every site. Longitudes are measured from `centre` so that site faces +z.
export function globeSet({ count, mask, maskWidth, maskHeight, sites, centre, radius = 1.6, seed = 31 }) {
  const set = createSet(count);
  const rand = random(seed);
  const at = (lat, lon) => mask[Math.min(maskHeight - 1, Math.floor((90 - lat) / 180 * maskHeight)) * maskWidth + ((Math.floor((lon + 180) / 360 * maskWidth) % maskWidth) + maskWidth) % maskWidth];
  const place = (lat, lon, r) => {
    const phi = lat * Math.PI / 180, lambda = (lon - centre[1]) * Math.PI / 180;
    return [r * Math.cos(phi) * Math.sin(lambda), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(lambda)];
  };
  const dust = dustCount(count);
  const siteShare = Math.round(count * .02);
  const graticule = Math.round(count * .06);
  const land = count - dust - siteShare * sites.length - graticule;
  let n = 0;
  const cell = 180 / maskHeight;
  while (n < land) {
    const lat = Math.asin(rand() * 2 - 1) * 180 / Math.PI, lon = rand() * 360 - 180;
    if (!at(lat, lon)) continue;
    const coast = !at(lat + cell, lon) || !at(lat - cell, lon) || !at(lat, lon + cell) || !at(lat, lon - cell);
    const [x, y, z] = place(lat, lon, radius * (1 + (rand() - .5) * .004));
    put(set, n++, x, y, z, 1, coast ? GOLD : WARM, coast ? 1.4 : .32 + rand() * .3);
  }
  for (let i = 0; i < graticule; i++) {
    const along = rand() * 360 - 180, line = Math.round((rand() * 360 - 180) / 15) * 15;
    const meridian = rand() < .5;
    const lat = meridian ? along / 2 : Math.max(-75, Math.min(75, line / 2)), lon = meridian ? line : along;
    const [x, y, z] = place(lat, lon, radius * .998);
    put(set, n++, x, y, z, 1, DUST, .12);
  }
  for (const site of sites) {
    const live = site.status === 'live';
    for (let i = 0; i < siteShare; i++) {
      const r = Math.pow(rand(), 2) * (live ? .9 : .6), a = rand() * Math.PI * 2;
      const [x, y, z] = place(site.lat + r * Math.sin(a), site.lon + r * Math.cos(a) / Math.cos(site.lat * Math.PI / 180), radius * (1.002 + rand() * .01));
      put(set, n++, x, y, z, 1, live ? GOLD : WARM, (live ? 5 : 1.2) * (1 - r));
    }
  }
  fillDust(set, n, rand, { inner: 4, outer: 18, intensity: .5 });
  return set;
}

// A LiDAR cloud (tools/phantom-data/atlas.mjs) in its site's east-north-up metres, re-centred and scaled into the scene:
// x east, y up, z south. Buildings glow warmer the taller they stand; ground, trees and water stay low, raised by `terrain`
// where the land itself is the subject (headlands rather than streets).
export function citySet({ count, data, centre, metersPerUnit, terrain = 1, seed = 37 }) {
  const set = createSet(count);
  const rand = random(seed);
  const view = new DataView(data);
  const length = view.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, length)));
  const m = meta.count;
  const body = new Uint8Array(data, 4 + length);
  const planes = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const coords = [0, 1, 2].map(k => {
    const out = new Float32Array(m);
    let value = 0;
    for (let j = 0; j < m; j++) { value = (value + planes.getUint16((k * m + j) * 2, true)) & 0xffff; out[j] = meta.min[k] + value / 65535 * meta.size[k]; }
    return out;
  });
  const classes = body.subarray(6 * m, 7 * m), intensities = body.subarray(7 * m, 8 * m);
  const shapes = count - dustCount(count);
  const u = 1 / metersPerUnit;
  const jitter = Math.sqrt(meta.size[0] * meta.size[1] / m) * .5;
  for (let n = 0; n < shapes; n++) {
    // Up to the cloud's own size every return is used once; beyond it, returns repeat with a small offset.
    const j = n < m ? n : Math.floor(rand() * m);
    const spread = n < m ? 0 : jitter;
    const east = coords[0][j] + (rand() - .5) * spread, north = coords[1][j] + (rand() - .5) * spread, up = coords[2][j];
    const cls = classes[j], lit = .55 + .9 * intensities[j] / 255;
    let rgb = WARM, level;
    if (cls === 6) { const t = Math.min(1, Math.max(0, up / 260)); rgb = t > .35 ? GOLD : WARM; level = (.5 + 1.6 * Math.sqrt(t)) * lit; }
    else if (cls === 2) { rgb = [.62, .68, .78]; level = .26 * lit * terrain; }
    else if (cls >= 3 && cls <= 5) { rgb = [.66, .74, .66]; level = .24 * lit * terrain; }
    else if (cls === 9) { rgb = [.5, .64, .86]; level = .2; }
    else if (cls === 17) { rgb = GOLD; level = 1.1 * lit; }
    else level = (.6 + up / 60) * lit;
    put(set, n, (east - centre[0]) * u, up * u, -(north - centre[1]) * u, 1, rgb, level);
  }
  fillDust(set, shapes, rand, { inner: 6, outer: 22, intensity: .4 });
  return set;
}
