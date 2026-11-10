// Pixel art for the early years: a 5 × 7 bitmap font, a tiny RGBA canvas, and GIF / PNG output through sharp.
// Everything here is drawn from code, so the images are the same on every machine and in CI.
import sharp from 'sharp';

export const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'], J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'], X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], 1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], 3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'], 5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'], 7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], 9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'], "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'], ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'], ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'], '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '/': ['.....', '....#', '...#.', '..#..', '.#...', '#....', '.....'], '@': ['.###.', '#...#', '#.###', '#.#.#', '#.##.', '#....', '.####'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'], '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'], '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'], '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....']
};

// The tiny type of the 80 × 15 "antipixel" buttons: five pixels tall, letters of their own widths.
export const TINY = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['#', '#', '#', '#', '#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], R: ['##.', '#.#', '##.', '#.#', '#.#'], S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'], 0: ['.#.', '#.#', '#.#', '#.#', '.#.'], 1: ['.#', '##', '.#', '.#', '.#'],
  2: ['##.', '..#', '.#.', '#..', '###'], 3: ['##.', '..#', '.#.', '..#', '##.'], '.': ['.', '.', '.', '.', '#'], ' ': ['.', '.', '.', '.', '.']
};
const tinyGlyph = ch => { const glyph = TINY[ch]; if (!glyph) throw new Error('No tiny glyph for "' + ch + '"'); return glyph; };
export const tinyWidth = text => [...text.toUpperCase()].reduce((sum, ch, n) => sum + tinyGlyph(ch)[0].length + (n ? 1 : 0), 0);
export function drawTiny(c, text, x, y, colour) {
  for (const ch of text.toUpperCase()) {
    const glyph = tinyGlyph(ch);
    glyph.forEach((row, j) => [...row].forEach((bit, i) => { if (bit === '#') c.set(x + i, y + j, colour); }));
    x += glyph[0].length + 1;
  }
}

export function canvas(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  const c = {
    width, height, data,
    set(x, y, rgba) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4, a = rgba[3] ?? 255;
      if (a >= 255) { data.set([rgba[0], rgba[1], rgba[2], 255], i); return; }
      const t = a / 255, keep = 1 - t;
      data.set([rgba[0] * t + data[i] * keep, rgba[1] * t + data[i + 1] * keep, rgba[2] * t + data[i + 2] * keep, Math.max(data[i + 3], a)], i);
    },
    get(x, y) { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; },
    rect(x, y, w, h, rgba) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) c.set(i, j, typeof rgba === 'function' ? rgba(i, j) : rgba); },
    // Rows of characters, one per pixel; `palette` maps characters to colours and '.' stays transparent.
    sprite(rows, palette, x = 0, y = 0, scale = 1) {
      rows.forEach((row, j) => [...row].forEach((ch, i) => { if (palette[ch]) c.rect(x + i * scale, y + j * scale, scale, scale, palette[ch]); }));
    }
  };
  return c;
}

// A 5 × 7 glyph given as seven row masks (bit 4 is the left column).
export function drawMask(c, rows, x, y, scale = 1, colour = [255, 255, 255, 255]) {
  rows.forEach((mask, j) => { for (let i = 0; i < 5; i++) if (mask & (16 >> i)) c.rect(x + i * scale, y + j * scale, scale, scale, colour); });
}
export const maskCells = rows => rows.flatMap((mask, j) => [0, 1, 2, 3, 4].filter(i => mask & (16 >> i)).map(i => [i, j]));

export function textWidth(text, scale = 1, spacing = 1) {
  return text.length ? text.length * (5 + spacing) * scale - spacing * scale : 0;
}

// colour may be an RGBA array or a function (column, row within the glyph grid) => RGBA, for gradients.
export function drawText(c, text, x, y, scale = 1, colour = [255, 255, 255, 255], spacing = 1) {
  [...text.toUpperCase()].forEach((ch, n) => {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error('No glyph for "' + ch + '"');
    glyph.forEach((row, j) => [...row].forEach((bit, i) => {
      if (bit === '#') c.rect(x + (n * (5 + spacing) + i) * scale, y + j * scale, scale, scale, typeof colour === 'function' ? colour(i, j) : colour);
    }));
  });
}

const raw = c => sharp(Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength), { raw: { width: c.width, height: c.height, channels: 4 } });
export const png = c => raw(c).png({ compressionLevel: 9 }).toBuffer();
export const gif = (c, options = {}) => raw(c).gif({ colours: 256, dither: 0, effort: 10, ...options }).toBuffer();
export async function animatedGif(frames, { delay = 100, loop = 0, colours = 64 } = {}) {
  const pngs = await Promise.all(frames.map(png));
  return sharp(pngs, { join: { animated: true } }).gif({ delay, loop, colours, dither: 0, effort: 10 }).toBuffer();
}

// A small deterministic random source, so starfields and scatter are the same on every build.
export function random(seed = 1) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

// ---- Type in real fonts and the layer effects of the paint programs of the day --------------------------------
// A coverage map is { width, height, alpha } with alpha 0–255, as coverage() in fonts.mjs returns for a line of text.

// Paints a coverage map at (x, y). colour is RGBA or a function (column, row within the map) => RGBA.
export function paint(c, cov, x, y, colour, opacity = 1) {
  for (let j = 0; j < cov.height; j++) for (let i = 0; i < cov.width; i++) {
    const a = cov.alpha[j * cov.width + i] * opacity;
    if (a < 1) continue;
    const rgba = typeof colour === 'function' ? colour(i, j) : colour;
    c.set(x + i, y + j, [rgba[0], rgba[1], rgba[2], Math.round(a * (rgba[3] ?? 255) / 255)]);
  }
}

// A soft copy of a coverage map (two box passes, close to a Gaussian), grown by 2r on every side.
export function blur(cov, r) {
  const grow = r * 2, w = cov.width + grow * 2, h = cov.height + grow * 2;
  let a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let j = 0; j < cov.height; j++) for (let i = 0; i < cov.width; i++) a[(j + grow) * w + i + grow] = cov.alpha[j * cov.width + i];
  const pass = (from, to, dx, dy) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let sum = 0, n = 0;
      for (let k = -r; k <= r; k++) { const x = i + k * dx, y = j + k * dy; if (x >= 0 && y >= 0 && x < w && y < h) sum += from[y * w + x]; n++; }
      to[j * w + i] = sum / n;
    }
  };
  for (let round = 0; round < 2; round++) { pass(a, b, 1, 0); pass(b, a, 0, 1); }
  return { width: w, height: h, alpha: Uint8ClampedArray.from(a), offset: grow };
}

// Bevel and Emboss (inner bevel), as a light value per pixel of the map: above 0 lit, below 0 in shade.
// The light comes from the upper left, as it did by default.
export function bevel(cov, size = 2, depth = 3) {
  const soft = blur(cov, Math.max(1, Math.round(size / 2))), o = soft.offset, w = soft.width;
  const height = (i, j) => soft.alpha[(j + o) * w + i + o] / 255;
  const light = [-1, -1, 1].map(v => v / Math.sqrt(3)), flat = light[2];
  const shade = new Float32Array(cov.width * cov.height);
  for (let j = 0; j < cov.height; j++) for (let i = 0; i < cov.width; i++) {
    const gx = (height(i + 1, j) - height(i - 1, j)) / 2 * depth, gy = (height(i, j + 1) - height(i, j - 1)) / 2 * depth;
    const n = Math.hypot(gx, gy, 1), lit = (-gx * light[0] - gy * light[1] + light[2]) / n;
    shade[j * cov.width + i] = Math.max(-1, Math.min(1, (lit - flat) / (1 - flat)));
  }
  return shade;
}
// Applies a bevel value to a colour: lit towards white, shaded towards black.
export const lit = (rgba, value, highlight = 0.75, shadow = 0.6) => value >= 0 ? mix(rgba, [255, 255, 255, rgba[3] ?? 255], value * highlight) : mix(rgba, [0, 0, 0, rgba[3] ?? 255], -value * shadow);

// A lens flare, added to what is under it: a hot centre, four streaks, and rings strung along the line to the middle.
export function flare(c, x, y, size, towards = [c.width / 2, c.height / 2]) {
  const add = (px, py, rgb, amount) => {
    px = Math.round(px); py = Math.round(py);
    if (px < 0 || py < 0 || px >= c.width || py >= c.height || amount <= 0) return;
    const i = (py * c.width + px) * 4;
    for (let k = 0; k < 3; k++) c.data[i + k] = Math.min(255, c.data[i + k] + rgb[k] * amount);
  };
  const reach = Math.ceil(size * 3);
  for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) {
    const r = Math.hypot(i, j) / size;
    add(x + i, y + j, [255, 250, 230], Math.exp(-r * r * 2.2) + 0.35 * Math.exp(-r * 1.6));
    add(x + i, y + j, [255, 255, 255], Math.exp(-(j * j) / 0.9) * Math.exp(-Math.abs(i) / (size * 2.6)) * 0.9 + Math.exp(-(i * i) / 0.9) * Math.exp(-Math.abs(j) / (size * 1.4)) * 0.7);
  }
  const rings = [[0.55, 0.22, [120, 200, 255]], [0.8, 0.12, [255, 170, 90]], [1.3, 0.3, [140, 255, 170]]];
  for (const [at, radius, rgb] of rings) {
    const cx = x + (towards[0] - x) * at * 2, cy = y + (towards[1] - y) * at * 2, rr = size * radius * 4;
    for (let j = -rr - 2; j <= rr + 2; j++) for (let i = -rr - 2; i <= rr + 2; i++) {
      const d = Math.hypot(i, j);
      add(cx + i, cy + j, rgb, d < rr ? 0.1 + 0.18 * Math.exp(-((d - rr) ** 2) / 2) : 0.18 * Math.exp(-((d - rr) ** 2) / 2));
    }
  }
}

// A GIF of the canvas with one-bit transparency: wherever the artwork covers less than `threshold` (0–255 in the
// cover map, a Uint8Array the size of the canvas) the pixel is cut out; the rest keeps the matte colour it was
// painted over, the halo every transparent GIF of the time had.
export function cutOut(c, cover, threshold = 40) {
  for (let i = 0; i < cover.length; i++) c.data[i * 4 + 3] = cover[i] >= threshold ? 255 : 0;
  return c;
}
// Adds a coverage map, placed at (x, y), into a cover map for cutOut().
export function cover(target, width, cov, x, y) {
  for (let j = 0; j < cov.height; j++) for (let i = 0; i < cov.width; i++) {
    const at = (y + j) * width + x + i;
    if (at >= 0 && at < target.length && x + i >= 0 && x + i < width) target[at] = Math.max(target[at], cov.alpha[j * cov.width + i]);
  }
  return target;
}

export const hex = value => {
  const n = parseInt(value.replace('#', ''), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255, 255];
};
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
