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
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'], ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....']
};

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

// A 5 × 7 glyph given as seven row masks (bit 4 is the left column), as the hunt's puzzle data stores letters.
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

export const hex = value => {
  const n = parseInt(value.replace('#', ''), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255, 255];
};
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
