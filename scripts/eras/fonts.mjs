// Text drawn into images (logos, headings with reflections) uses OFL fonts from @fontsource. Those ship as WOFF,
// which the font renderer inside sharp does not read, so each is unwrapped into a plain TrueType/OpenType file.
import { inflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// WOFF 1.0: a header, a table directory, then each table zlib-compressed unless that would not save space.
export function woffToSfnt(woff) {
  if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error('Not a WOFF 1.0 file.');
  const flavor = woff.readUInt32BE(4), count = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const [tag, offset, compLength, origLength, checksum] = [woff.readUInt32BE(at), woff.readUInt32BE(at + 4), woff.readUInt32BE(at + 8), woff.readUInt32BE(at + 12), woff.readUInt32BE(at + 16)];
    const raw = woff.subarray(offset, offset + compLength);
    tables.push({ tag, checksum, data: compLength < origLength ? inflateSync(raw) : Buffer.from(raw) });
  }
  tables.sort((a, b) => a.tag - b.tag);
  const power = 2 ** Math.floor(Math.log2(count));
  const header = Buffer.alloc(12 + count * 16);
  header.writeUInt32BE(flavor, 0); header.writeUInt16BE(count, 4);
  header.writeUInt16BE(power * 16, 6); header.writeUInt16BE(Math.log2(power), 8); header.writeUInt16BE(count * 16 - power * 16, 10);
  let offset = header.length;
  const bodies = [];
  tables.forEach((table, i) => {
    const at = 12 + i * 16;
    header.writeUInt32BE(table.tag, at); header.writeUInt32BE(table.checksum, at + 4);
    header.writeUInt32BE(offset, at + 8); header.writeUInt32BE(table.data.length, at + 12);
    const padded = Buffer.alloc((table.data.length + 3) & ~3);
    table.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}

export function fonts(root) {
  const directory = path.join(root, '.cache', 'fonts');
  const files = {};
  async function file(pkg, name) {
    const key = pkg + '/' + name;
    if (files[key]) return files[key];
    const target = path.join(directory, name.replace(/\.woff$/, '.ttf'));
    try { await stat(target); } catch {
      await mkdir(directory, { recursive: true });
      await writeFile(target, woffToSfnt(await readFile(path.join(root, 'node_modules/@fontsource', pkg, 'files', name))));
    }
    return (files[key] = target);
  }
  // A line of text as an RGBA image: `markup` is Pango markup, `font` a family and size such as "Varela Round 60".
  // The image is cropped to the ink, so two separate renderings do not share a baseline.
  async function text(markup, { pkg, name, font, dpi = 72 }) {
    return sharp({ text: { text: markup, font, fontfile: await file(pkg, name), rgba: true, dpi } }).png().toBuffer();
  }
  // The same, as raw pixels: { width, height, alpha, rgba } with alpha 0–255 per pixel (see paint() in pixels.mjs).
  async function coverage(markup, options) {
    const { data, info } = await sharp(await text(markup, options)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = new Uint8ClampedArray(info.width * info.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return { width: info.width, height: info.height, alpha, rgba: data };
  }
  return { file, text, coverage };
}

// Text for Pango markup.
export const markup = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The faces used for type drawn into images, all OFL from @fontsource. Arimo and Tinos are metric twins of Arial
// and Times New Roman; Archivo Black stands in for Arial Black and Open Sans for Verdana.
export const FACES = {
  timesBoldItalic: { pkg: 'tinos', name: 'tinos-latin-700-italic.woff', family: 'Tinos Bold Italic' },
  arialBold: { pkg: 'arimo', name: 'arimo-latin-700-normal.woff', family: 'Arimo Bold' },
  arialBlack: { pkg: 'archivo-black', name: 'archivo-black-latin-400-normal.woff', family: 'Archivo Black' },
  verdanaBold: { pkg: 'open-sans', name: 'open-sans-latin-700-normal.woff', family: 'Open Sans Bold' },
  verdana: { pkg: 'open-sans', name: 'open-sans-latin-600-normal.woff', family: 'Open Sans Semi-Bold' },
  roundedBold: { pkg: 'nunito', name: 'nunito-latin-800-normal.woff', family: 'Nunito Ultra-Bold' }
};
// Options for text() / coverage(): a face from FACES at a size in pixels.
export const face = (which, size) => ({ pkg: which.pkg, name: which.name, font: which.family + ' ' + size });
