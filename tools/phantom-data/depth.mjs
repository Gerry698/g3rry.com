// Photographs with depth: a metric depth map for each photograph in the lab, fused from three sources.
//   1. Depth Anything V2 Small (Apache-2.0), run on this machine: relative depth with fine structure but no scale.
//   2. A scene model written by looking at the photograph (content/phantom/scenes.json): where the horizon sits and how
//      high the lens stood above the ground, how far known things are from their size in the frame, where it focused.
//   3. For photographs placed in the atlas, the LiDAR as seen from the solved camera station.
// The network's relative inverse depth is fitted to those metric anchors (a robust affine fit, then a smooth correction
// wherever anchors are dense), clipped to the scene's far limit, and its edges are snapped to the photograph's colour edges.
// Output: content/phantom/scenes/<id>.bin (see encode); a preview with the anchors goes to .cache/phantom-scenes/<id>.jpg.
//   node depth.mjs              every photograph with a scene model
//   node depth.mjs p05 p07      only these
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { pipeline, env, RawImage } from '@huggingface/transformers';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
env.cacheDir = path.join(here, '.models');
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const lab = await read('content/phantom.json');
const photos = await read('content/photos.json');
const scenes = await read('content/phantom/scenes.json');
const frames = await read('content/phantom/atlas/frames.json');
const wanted = process.argv.slice(2);
const ids = wanted.length ? wanted : Object.keys(scenes);
// Working resolution of the stored map (long side), and the network's input (long side, a multiple of its 14 px patches).
const WORK = 1024;
const NET_LONG = 1022;

const estimator = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'fp32' });
await mkdir(path.join(root, 'content/phantom/scenes'), { recursive: true });
await mkdir(path.join(root, '.cache/phantom-scenes'), { recursive: true });

// ---- Camera: pixel -> ray, for the photograph's own lens on a 36 x 24 mm sensor ---------------------------------
function lens(meta, width, height) {
  const [sensorW, sensorH] = width >= height ? [36, 24] : [24, 36];
  const tanX = sensorW / 2 / meta.focal, tanY = sensorH / 2 / meta.focal;
  return { tanX, tanY, ray: (x, y) => [((x + .5) / width * 2 - 1) * tanX, (1 - (y + .5) / height * 2) * tanY, -1] };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

// A level ground plane `height` metres below the lens, with the horizon at y (0 top, 1 bottom) on the left and right edges.
function groundPlane(camera, horizon, height, width, height_px) {
  const left = camera.ray(-.5, horizon[0] * height_px - .5), right = camera.ray(width - .5, horizon[1] * height_px - .5);
  const up = normalize(cross(right, left));
  return (x, y) => { const d = camera.ray(x, y), k = dot(up, d); return k < -1e-4 ? height / -k : Infinity; };
}

// ---- LiDAR seen from an atlas station -------------------------------------------------------------------------
function decodeCloud(buffer) {
  const raw = gunzipSync(buffer), length = raw.readUInt32LE(0), meta = JSON.parse(raw.subarray(4, 4 + length)), n = meta.count;
  const body = raw.subarray(4 + length);
  const axes = [0, 1, 2].map(k => { const out = new Float32Array(n); let value = 0; for (let j = 0; j < n; j++) { value = (value + body.readUInt16LE((k * n + j) * 2)) & 0xffff; out[j] = meta.min[k] + value / 65535 * meta.size[k]; } return out; });
  return { n, axes, classes: body.subarray(6 * n, 7 * n) };
}
async function lidarAnchors(stopId, camera, width, height) {
  const stop = lab.atlas.stops.find(item => item.id === stopId), station = frames.stops[stopId];
  const cloud = decodeCloud(await readFile(path.join(root, 'content/phantom/atlas', stop.cloud + '.bin')));
  const forward = normalize(station.look.map((v, k) => v - station.camera[k]));
  const right = normalize(cross(forward, [0, 0, 1])), up = cross(right, forward);
  // A coarse z-buffer: the nearest return per cell is the surface the photograph saw (when nothing newer stood in front).
  const cell = 8, gw = Math.ceil(width / cell), gh = Math.ceil(height / cell);
  const nearest = new Float32Array(gw * gh).fill(Infinity), hits = new Uint16Array(gw * gh);
  for (let j = 0; j < cloud.n; j++) {
    if (cloud.classes[j] === 9) continue;
    const d = [cloud.axes[0][j] - station.camera[0], cloud.axes[1][j] - station.camera[1], cloud.axes[2][j] - station.camera[2]];
    const z = dot(d, forward);
    if (z < 1) continue;
    const u = (dot(d, right) / z / camera.tanX + 1) / 2, v = (1 - dot(d, up) / z / camera.tanY) / 2;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const i = Math.floor(v * gh) * gw + Math.floor(u * gw);
    hits[i]++;
    if (z < nearest[i]) nearest[i] = z;
  }
  const anchors = [];
  for (let i = 0; i < nearest.length; i++) if (hits[i]) anchors.push({ x: (i % gw + .5) * cell, y: (Math.floor(i / gw) + .5) * cell, z: nearest[i], kind: 'lidar' });
  return anchors;
}

// ---- Fitting -----------------------------------------------------------------------------------------------
// The network predicts relative inverse depth D; metric inverse depth is taken as a*D + b, fitted in log depth with Huber weights.
function fitAffine(anchors) {
  let a = 1, b = 0;
  {
    // Start from a weighted linear fit on inverse depth, weighting by depth squared so near anchors do not dominate.
    let s = [0, 0, 0, 0, 0];
    for (const p of anchors) { const w = p.weight * p.z * p.z, t = 1 / p.z; s[0] += w * p.d * p.d; s[1] += w * p.d; s[2] += w; s[3] += w * p.d * t; s[4] += w * t; }
    const det = s[0] * s[2] - s[1] * s[1];
    if (Math.abs(det) > 1e-12) { a = (s[3] * s[2] - s[1] * s[4]) / det; b = (s[0] * s[4] - s[1] * s[3]) / det; }
    if (!(a > 0)) { a = 1 / anchors.reduce((m, p) => m + p.z * p.d, 0) * anchors.length; b = 0; }
  }
  for (let iteration = 0; iteration < 40; iteration++) {
    let h00 = 0, h01 = 0, h11 = 0, g0 = 0, g1 = 0;
    for (const p of anchors) {
      const w = Math.max(1e-6, a * p.d + b), r = Math.log(w) + Math.log(p.z);
      const huber = Math.abs(r) < .12 ? 1 : .12 / Math.abs(r);
      const k = p.weight * huber, j0 = p.d / w, j1 = 1 / w;
      h00 += k * j0 * j0; h01 += k * j0 * j1; h11 += k * j1 * j1; g0 += k * j0 * r; g1 += k * j1 * r;
    }
    const det = h00 * h11 - h01 * h01 + 1e-12;
    const da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    a -= da; b -= db;
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}

// The network orders depth well, but its output is not affine in metric inverse depth across three orders of magnitude
// (a walker at 18 m and a tower at 300 m in one frame). So relative depth is mapped to log depth through a monotone
// piecewise-linear curve: knots at quantiles of the frame's own values, fitted to the anchors with Huber weights,
// pulled toward the affine fit where no anchor speaks, smoothed, and kept non-increasing (nearer never maps farther).
function fitCurve(anchors, D, prior) {
  const sorted = Float32Array.from(D).sort(), K = 12;
  const knots = Array.from({ length: K }, (_, k) => sorted[Math.floor(k / (K - 1) * (sorted.length - 1))]);
  for (let k = 1; k < K; k++) if (knots[k] <= knots[k - 1]) knots[k] = knots[k - 1] + 1e-6;
  const locate = d => {
    if (d <= knots[0]) return [0, 0];
    if (d >= knots[K - 1]) return [K - 2, 1];
    let k = 0;
    while (d > knots[k + 1]) k++;
    return [k, (d - knots[k]) / (knots[k + 1] - knots[k])];
  };
  const total = anchors.reduce((s, p) => s + p.weight, 0), lambda = .01 * total, mu = .03 * total;
  let g = knots.map(prior);
  for (let iteration = 0; iteration < 15; iteration++) {
    const A = Array.from({ length: K }, () => new Float64Array(K)), r = new Float64Array(K);
    for (const p of anchors) {
      const [k, t] = locate(p.d), target = Math.log(p.z), e = g[k] * (1 - t) + g[k + 1] * t - target;
      const w = p.weight * (Math.abs(e) < .12 ? 1 : .12 / Math.abs(e));
      A[k][k] += w * (1 - t) ** 2; A[k][k + 1] += w * (1 - t) * t; A[k + 1][k] += w * (1 - t) * t; A[k + 1][k + 1] += w * t * t;
      r[k] += w * (1 - t) * target; r[k + 1] += w * t * target;
    }
    for (let k = 0; k < K; k++) { A[k][k] += lambda; r[k] += lambda * prior(knots[k]); }
    for (let k = 1; k < K - 1; k++) for (const [i, vi] of [[k - 1, 1], [k, -2], [k + 1, 1]]) for (const [j, vj] of [[k - 1, 1], [k, -2], [k + 1, 1]]) A[i][j] += mu * vi * vj;
    g = isotonicDecreasing(solve(A, r));
  }
  return d => { const [k, t] = locate(d); return g[k] * (1 - t) + g[k + 1] * t; };
}
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
// Pool adjacent violators: the closest non-increasing sequence.
function isotonicDecreasing(values) {
  const blocks = [];
  for (const v of values) {
    blocks.push([v, 1]);
    while (blocks.length > 1 && blocks.at(-2)[0] < blocks.at(-1)[0]) {
      const [v2, n2] = blocks.pop(), [v1, n1] = blocks.pop();
      blocks.push([(v1 * n1 + v2 * n2) / (n1 + n2), n1 + n2]);
    }
  }
  return blocks.flatMap(([v, n]) => Array(n).fill(v));
}
// Each kind of anchor carries a fixed share of the fit, however many samples it has: a handful of measured anchors
// must not be outvoted by thousands of LiDAR cells.
const SHARE = { point: 2, box: 1, ground: 1, lidar: 1.5 };
function balance(anchors) {
  const counts = {};
  for (const p of anchors) counts[p.kind] = (counts[p.kind] || 0) + 1;
  for (const p of anchors) p.weight = SHARE[p.kind] / counts[p.kind];
  return anchors;
}

// The correction is an edge-aware weighted least squares on a grid a quarter of the photograph's resolution: each anchor
// pulls its cell toward its own residual, neighbouring cells are tied together unless an edge in colour or in the network's
// depth runs between them, and a faint pull toward zero lets it fade where no anchor reaches. So what the LiDAR says about
// a cliff stays on the cliff and what the ground plane says stays on the sand, with a transition between them rather than
// an average. Solved by conjugate gradients.
function edgeAwareField(rgbFull, DFull, fullWidth, fullHeight) {
  const S = 4, width = Math.ceil(fullWidth / S), height = Math.ceil(fullHeight / S), n = width * height;
  const colour = new Float32Array(n * 3), D = new Float32Array(n), counts = new Float32Array(n);
  for (let y = 0; y < fullHeight; y++) for (let x = 0; x < fullWidth; x++) {
    const i = Math.floor(y / S) * width + Math.floor(x / S), j = y * fullWidth + x;
    for (let c = 0; c < 3; c++) colour[i * 3 + c] += rgbFull[j * 3 + c];
    D[i] += DFull[j];
    counts[i]++;
  }
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) colour[i * 3 + c] /= counts[i]; D[i] /= counts[i]; }
  const sorted = Float32Array.from(D).sort();
  const dScale = Math.max(1e-6, sorted[Math.floor(n * .99)] - sorted[Math.floor(n * .01)]);
  const tie = (i, j) => 6 * Math.exp(-8 * (Math.abs(colour[3 * i] - colour[3 * j]) + Math.abs(colour[3 * i + 1] - colour[3 * j + 1])
    + Math.abs(colour[3 * i + 2] - colour[3 * j + 2])) - 30 * Math.abs(D[i] - D[j]) / dScale);
  const right = new Float32Array(n), below = new Float32Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x + 1 < width) right[i] = tie(i, i + 1);
    if (y + 1 < height) below[i] = tie(i, i + width);
  }
  const fade = .002;
  return (anchors, residual) => {
    const data = new Float32Array(n), target = new Float32Array(n);
    const mean = anchors.reduce((sum, p) => sum + p.weight, 0) / anchors.length;
    anchors.forEach((p, k) => {
      const i = Math.min(height - 1, Math.floor(p.y / S)) * width + Math.min(width - 1, Math.floor(p.x / S)), w = p.weight / mean;
      data[i] += w;
      target[i] += w * residual[k];
    });
    const apply = (v, out) => {
      for (let i = 0; i < n; i++) out[i] = (data[i] + fade) * v[i];
      for (let i = 0; i < n; i++) {
        if (right[i]) { const d = right[i] * (v[i] - v[i + 1]); out[i] += d; out[i + 1] -= d; }
        if (below[i]) { const d = below[i] * (v[i] - v[i + width]); out[i] += d; out[i + width] -= d; }
      }
    };
    const field = new Float32Array(n), r = Float32Array.from(target), p = Float32Array.from(r), q = new Float32Array(n);
    let rr = r.reduce((s, v) => s + v * v, 0);
    for (let iteration = 0; iteration < 400 && rr > 1e-10; iteration++) {
      apply(p, q);
      let pq = 0;
      for (let i = 0; i < n; i++) pq += p[i] * q[i];
      const alpha = rr / pq;
      let next = 0;
      for (let i = 0; i < n; i++) { field[i] += alpha * p[i]; r[i] -= alpha * q[i]; next += r[i] * r[i]; }
      for (let i = 0; i < n; i++) p[i] = r[i] + next / rr * p[i];
      rr = next;
    }
    for (let i = 0; i < n; i++) field[i] = Math.max(-4.5, Math.min(4.5, field[i]));
    return (x, y) => {
      const fx = Math.max(0, Math.min(width - 1.001, x / S - .5)), fy = Math.max(0, Math.min(height - 1.001, y / S - .5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, at = (i, j) => field[j * width + i];
      return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    };
  };
}

// ---- Edges ----------------------------------------------------------------------------------------------------
// Where the depth jumps, the network blurs the step over a few pixels and leaves points hanging in the air between
// subject and background. Each such pixel joins the side whose colour it matches.
function snapEdges(logZ, rgb, width, height) {
  const out = Float32Array.from(logZ);
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    let lo = Infinity, hi = -Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const v = logZ[(y + dy) * width + x + dx]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < .12) continue;
    const cut = (lo + hi) / 2;
    const near = [0, 0, 0, 0, 0], far = [0, 0, 0, 0, 0];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const i = (y + dy) * width + x + dx, side = logZ[i] < cut ? near : far;
      side[0] += rgb[i * 3]; side[1] += rgb[i * 3 + 1]; side[2] += rgb[i * 3 + 2]; side[3] += logZ[i]; side[4]++;
    }
    if (!near[4] || !far[4]) continue;
    const i = y * width + x;
    const distance = side => Math.hypot(rgb[i * 3] - side[0] / side[4], rgb[i * 3 + 1] - side[1] / side[4], rgb[i * 3 + 2] - side[2] / side[4]);
    out[i] = distance(near) <= distance(far) ? Math.min(logZ[i], near[3] / near[4]) : Math.max(logZ[i], far[3] / far[4]);
  }
  return out;
}

// ---- Encoding ---------------------------------------------------------------------------------------------------
// gzip( uint32 header length, JSON header { width, height, near, far, nearest, subject }, then width*height uint16 log depths
// as row deltas ). `nearest` is the 3rd-percentile depth: how close the camera may come before the scene runs into the lens.
// Log depth keeps 12 bits between near and far: steps of a fraction of a percent at every distance.
function encode(logZ, width, height, near, far, nearest, subject) {
  const header = Buffer.from(JSON.stringify({ width, height, near: +near.toFixed(3), far: +far.toFixed(1), nearest: +nearest.toPrecision(3), subject }));
  const body = Buffer.alloc(width * height * 2);
  const span = Math.log(far) - Math.log(near);
  const q = new Uint16Array(width * height);
  for (let i = 0; i < q.length; i++) q[i] = Math.round(Math.max(0, Math.min(1, (logZ[i] - Math.log(near)) / span)) * 4095) * 16;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, previous = x ? q[i - 1] : y ? q[i - width] : 0;
    body.writeUInt16LE((q[i] - previous) & 0xffff, i * 2);
  }
  const head = Buffer.alloc(4);
  head.writeUInt32LE(header.length, 0);
  return gzipSync(Buffer.concat([head, header, body]), { level: 9 });
}

// A false-colour preview (near warm, far cool) with every anchor marked, for checking a scene model by eye.
async function preview(id, logZ, width, height, near, far, anchors) {
  const span = Math.log(far) - Math.log(near);
  const image = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const t = Math.max(0, Math.min(1, (logZ[i] - Math.log(near)) / span));
    image[i * 3] = Math.round(255 * Math.max(0, Math.min(1, 1.6 - 2.2 * t)));
    image[i * 3 + 1] = Math.round(255 * Math.max(0, Math.min(1, 1.2 - Math.abs(t - .45) * 2.4)));
    image[i * 3 + 2] = Math.round(255 * Math.max(0, Math.min(1, 2.2 * t - .4)));
  }
  const dots = anchors.filter((p, i) => p.kind !== 'lidar' || i % 4 === 0).map(p => `<circle cx="${p.x}" cy="${p.y}" r="${p.kind === 'lidar' ? 1.5 : p.kind === 'ground' ? 2 : 6}" fill="${p.kind === 'point' ? '#fff' : 'none'}" stroke="${p.kind === 'lidar' ? '#0f0' : p.kind === 'ground' ? '#ff0' : '#000'}" stroke-width="1.5"/>`).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${dots}</svg>`);
  await sharp(image, { raw: { width, height, channels: 3 } }).composite([{ input: svg }]).jpeg({ quality: 85 }).toFile(path.join(root, '.cache/phantom-scenes', id + '.jpg'));
}

// ---- Per photograph ------------------------------------------------------------------------------------------
for (const id of ids) {
  const scene = scenes[id], meta = lab.photos[id], photo = photos.find(item => item.id === id);
  if (!scene || !meta || !photo) throw new Error('Needs a scene model, lab metadata and a manifest entry: ' + id);
  const started = performance.now();
  const source = sharp(path.join(root, photo.source)).rotate().removeAlpha();
  const { data: rgbBytes, info } = await source.clone().resize({ width: WORK, height: WORK, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const width = info.width, height = info.height;
  const rgb = Float32Array.from(rgbBytes, v => v / 255);

  // The network, at about a thousand pixels on the long side.
  const fit = NET_LONG / Math.max(width, height), snap = value => Math.max(14, Math.round(value * fit / 14) * 14);
  const processor = estimator.processor.image_processor;
  processor.size = { width: snap(width), height: snap(height) };
  processor.keep_aspect_ratio = false;
  const { predicted_depth: tensor } = await estimator(new RawImage(new Uint8ClampedArray(rgbBytes), width, height, 3));
  const [netH, netW] = tensor.dims.slice(-2);
  const net = tensor.data;
  const D = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(netW - 1.001, Math.max(0, (x + .5) / width * netW - .5)), sy = Math.min(netH - 1.001, Math.max(0, (y + .5) / height * netH - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
    D[y * width + x] = (net[y0 * netW + x0] * (1 - tx) + net[y0 * netW + x0 + 1] * tx) * (1 - ty) + (net[(y0 + 1) * netW + x0] * (1 - tx) + net[(y0 + 1) * netW + x0 + 1] * tx) * ty;
  }
  const dAt = (x, y, r = 3) => {
    const values = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) values.push(D[yy * width + xx]);
    }
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
  };

  // Anchors from the scene model.
  const camera = lens(meta, width, height);
  const anchors = [];
  for (const anchor of scene.anchors || []) {
    if (anchor.box) {
      const [x0, y0, x1, y1] = anchor.box;
      for (let v = y0; v <= y1 + 1e-9; v += (y1 - y0) / 4 || 1) for (let u = x0; u <= x1 + 1e-9; u += (x1 - x0) / 4 || 1)
        anchors.push({ x: u * width, y: v * height, z: anchor.z, weight: .4, kind: 'box' });
    } else anchors.push({ x: anchor.at[0] * width, y: anchor.at[1] * height, z: anchor.z, weight: 1, kind: 'point' });
  }
  const explicit = anchors.length;
  if (scene.lidar) {
    // A scene can limit the LiDAR to part of the frame (sand and water move; a bridge does not).
    const [lx0, ly0, lx1, ly1] = scene.lidarRegion || [0, 0, 1, 1];
    anchors.push(...(await lidarAnchors(scene.lidar, camera, width, height)).filter(p => p.x >= lx0 * width && p.x <= lx1 * width && p.y >= ly0 * height && p.y <= ly1 * height));
  }
  let ground = null;
  if (scene.ground) {
    const plane = groundPlane(camera, scene.ground.horizon, scene.ground.height, width, height);
    const [rx0, ry0, rx1, ry1] = scene.ground.region || [0, Math.max(...scene.ground.horizon) + .04, 1, 1];
    ground = [];
    for (let v = ry0; v <= ry1; v += .025) for (let u = rx0; u <= rx1; u += .025) {
      const x = Math.min(width - 1, u * width), y = Math.min(height - 1, v * height), z = plane(x, y);
      if (Number.isFinite(z) && z < (scene.far || 2000)) ground.push({ x, y, z, weight: .35, kind: 'ground' });
    }
  }
  for (const p of anchors) p.d = dAt(p.x, p.y);
  if (ground) for (const p of ground) p.d = dAt(p.x, p.y, 2);

  // The network is right locally but bends globally (at Marshall's Beach it puts the wet sand and a cliff 100 m off at the
  // same relative depth). So log depth = curve(relative depth) + an edge-aware correction, fitted in turns: the curve
  // to the anchors with the correction taken out, the correction to what the curve leaves. Each turn drops ground samples
  // that disagree (people, cars, kerbs standing on the plane) and LiDAR cells lying well behind the fit: something newer
  // than the survey stands in front of them.
  const far = scene.far || 2000;
  const curveFor = list => {
    const { a, b } = fitAffine(balance(list));
    const prior = d => Math.log(Math.min(far, 1 / Math.max(1 / far, a * d + b)));
    return { a, b, curve: fitCurve(list, D, prior) };
  };
  let used = anchors.concat(ground || []);
  const spread = edgeAwareField(rgb, D, width, height);
  let field = () => 0, a, b, curve;
  for (let pass = 0; pass < 5; pass++) {
    ({ a, b, curve } = curveFor(used.map(p => ({ ...p, z: p.z / Math.exp(field(p.x, p.y)) }))));
    if (used.length >= 2) field = spread(balance(used), used.map(p => Math.log(p.z) - curve(p.d)));
    // Tolerances tighten turn by turn, so a first fit that is still far off cannot throw out the anchors that would fix it.
    if (pass < 4 && anchors.length) {
      const off = p => Math.log(p.z) - curve(p.d) - field(p.x, p.y), [lidarLimit, groundLimit] = [[1.2, 1], [.9, .6], [.6, .35], [.6, .35]][pass];
      used = anchors.filter(p => p.kind !== 'lidar' || off(p) < lidarLimit).concat((ground || []).filter(p => Math.abs(off(p)) < groundLimit));
    }
  }
  const logZ = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) logZ[y * width + x] = Math.min(Math.log(far), curve(D[y * width + x]) + field(x, y));
  const snapped = snapEdges(logZ, rgb, width, height);

  // Report: how well the model meets its anchors, and the depth range it spans.
  const after = used.map(p => Math.log(p.z) - snapped[Math.min(height - 1, Math.round(p.y)) * width + Math.min(width - 1, Math.round(p.x))]);
  const rms = list => Math.sqrt(list.reduce((s, r) => s + r * r, 0) / Math.max(1, list.length));
  const sorted = Float32Array.from(snapped).sort();
  const near = Math.max(.2, Math.exp(sorted[Math.floor(sorted.length * .002)]) * .9);
  const file = encode(snapped, width, height, near, far * 1.001, Math.exp(sorted[Math.floor(sorted.length * .03)]), scene.subject);
  await writeFile(path.join(root, 'content/phantom/scenes', id + '.bin'), file);
  await preview(id, snapped, width, height, near, far, used);
  const explicitErrors = used.slice(0, explicit).map((p, i) => (Math.exp(after[i]) * 100 - 100).toFixed(0) + '%');
  console.log(id, width + 'x' + height, (file.length / 1024).toFixed(0) + ' KiB', 'a ' + a.toPrecision(3) + ' b ' + b.toPrecision(3),
    'anchors ' + explicit + ' named, ' + (used.length - explicit) + ' dense',
    'error rms ' + (rms(after) * 100).toFixed(0) + '% named [' + explicitErrors.join(' ') + ']',
    'depth p5/p50/p95 ' + [.05, .5, .95].map(q => Math.exp(sorted[Math.floor(q * sorted.length)]).toFixed(1)).join('/') + ' m',
    Math.round(performance.now() - started) + ' ms');
}
