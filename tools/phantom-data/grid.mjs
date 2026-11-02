// A crop of a photograph with a measuring grid: lines every 0.01 of the full frame, labelled every 0.05, so positions
// (a tower top, a horizon, a walker's feet) can be read off in the frame's own 0..1 coordinates for scene models and
// camera resection.
//   node grid.mjs ../../Photo/p17-fr9a2619.jpg 0.41,0.08,0.60,0.30 ../../.cache/p17-tops.jpg [width=1100]
import sharp from 'sharp';
const [file, box = '0,0,1,1', out, w = 1100] = process.argv.slice(2);
if (!file || !out) throw new Error('Usage: node grid.mjs <photo> <x0,y0,x1,y1> <out.jpg> [width]');
const [x0, y0, x1, y1] = box.split(',').map(Number), width = +w;
const meta = await sharp(file).metadata();
const L = Math.round(x0 * meta.width), T = Math.round(y0 * meta.height), W = Math.round((x1 - x0) * meta.width), H = Math.round((y1 - y0) * meta.height);
const k = width / W, lines = [];
for (let v = Math.ceil(x0 * 100); v <= x1 * 100; v++) {
  const x = (v / 100 * meta.width - L) * k;
  lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H * k}" stroke="${v % 5 ? '#0ff4' : '#0ffa'}"/>` + (v % 5 ? '' : `<text x="${x + 2}" y="12" fill="#0ff" font-size="12">${(v / 100).toFixed(2)}</text>`));
}
for (let v = Math.ceil(y0 * 100); v <= y1 * 100; v++) {
  const y = (v / 100 * meta.height - T) * k;
  lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${v % 5 ? '#ff04' : '#ff0a'}"/>` + (v % 5 ? '' : `<text x="2" y="${y - 2}" fill="#ff0" font-size="12">${(v / 100).toFixed(2)}</text>`));
}
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(H * k)}">${lines.join('')}</svg>`);
await sharp(file).rotate().extract({ left: L, top: T, width: W, height: H }).resize(width).composite([{ input: svg }]).jpeg({ quality: 88 }).toFile(out);
console.log(out, meta.width + 'x' + meta.height);
