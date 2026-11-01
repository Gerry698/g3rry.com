// Estimates relative depth for the lab's Develop photographs with Depth Anything V2 Small (Apache-2.0), on this machine.
// Output per photo: content/phantom/depth/<id>.bin = gzip(uint16 width, uint16 height, then row-delta uint16 disparity),
// where 0 is the farthest and 65535 the nearest point in the frame. A greyscale preview goes to .cache/phantom-depth/.
//   npm run depth                 every Develop photo
//   npm run depth -- p05 p09      only these
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { pipeline, env, RawImage } from '@huggingface/transformers';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
env.cacheDir = path.join(here, '.models');
const lab = JSON.parse(await readFile(path.join(root, 'content/phantom.json'), 'utf8'));
const photos = JSON.parse(await readFile(path.join(root, 'content/photos.json'), 'utf8'));
const wanted = process.argv.slice(2);
const ids = (wanted.length ? wanted : lab.develop.map(entry => entry.photo));
// The network sees the image at this size on its short side (a multiple of its 14 px patches); larger keeps finer edges.
const SHORT_SIDE = 700;
const LONG_LIMIT = 1050;
const STORED = 560;

const estimator = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'fp32' });
await mkdir(path.join(root, 'content/phantom/depth'), { recursive: true });
await mkdir(path.join(root, '.cache/phantom-depth'), { recursive: true });

for (const id of ids) {
  const photo = photos.find(item => item.id === id);
  if (!photo) throw new Error('Unknown photo ' + id);
  const { data, info } = await sharp(path.join(root, photo.source)).rotate().removeAlpha().resize({ width: 1600, height: 1600, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const processor = estimator.processor.image_processor;
  const fit = Math.min(SHORT_SIDE / Math.min(info.width, info.height), LONG_LIMIT / Math.max(info.width, info.height));
  const snap = value => Math.max(14, Math.round(value * fit / 14) * 14);
  processor.size = { width: snap(info.width), height: snap(info.height) };
  processor.keep_aspect_ratio = false;
  const started = performance.now();
  const { predicted_depth: tensor } = await estimator(new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3));
  const [fullHeight, fullWidth] = tensor.dims.slice(-2);
  const values = tensor.data;
  // Robust range: the extreme half-percent at either end is clipped so one specular glint cannot flatten the scene.
  const sorted = Float32Array.from(values).sort();
  const lo = sorted[Math.floor(sorted.length * .005)], hi = sorted[Math.floor(sorted.length * .995)];
  // Box-average down to about STORED px on the long side, then keep 12 bits: plenty for depth, and far smaller once zipped.
  const k = Math.ceil(Math.max(fullWidth, fullHeight) / STORED);
  const width = Math.floor(fullWidth / k), height = Math.floor(fullHeight / k);
  const disparity = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) sum += values[(y * k + dy) * fullWidth + x * k + dx];
    const t = Math.max(0, Math.min(1, (sum / (k * k) - lo) / (hi - lo)));
    disparity[y * width + x] = Math.round(t * 4095) * 16;
  }
  // Row deltas turn a smooth field into small numbers, which gzip packs several times tighter.
  const encoded = Buffer.alloc(4 + disparity.length * 2);
  encoded.writeUInt16LE(width, 0);
  encoded.writeUInt16LE(height, 2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const previous = x ? disparity[i - 1] : y ? disparity[i - width] : 0;
    encoded.writeUInt16LE((disparity[i] - previous) & 0xffff, 4 + i * 2);
  }
  const file = gzipSync(encoded, { level: 9 });
  await writeFile(path.join(root, 'content/phantom/depth', id + '.bin'), file);
  const preview = Buffer.from(Array.from(disparity, value => value >> 8));
  await sharp(preview, { raw: { width, height, channels: 1 } }).png().toFile(path.join(root, '.cache/phantom-depth', id + '.png'));
  console.log(id, width + 'x' + height, (file.length / 1024).toFixed(0) + ' KiB', Math.round(performance.now() - started) + ' ms');
}
