// 2011: things that look like things. Linen behind everything, a stitched leather header in League Gothic,
// letterpress type, a ribbon, Polaroids pinned to cork with square, faded, warm photographs, a legal pad,
// a sliding switch. CSS3 with every vendor prefix, web fonts, and a first media query.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { canvas, png, random, hex } from './pixels.mjs';

const YEAR = 2011;

function texture(size, seed, colour) {
  const c = canvas(size, size), next = random(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) c.set(x, y, colour(x, y, next));
  return png(c);
}
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const shade = (rgb, d) => [clamp(rgb[0] + d), clamp(rgb[1] + d), clamp(rgb[2] + d), 255];

export default async function build(ctx, era) {
  const { root, output, escape, csp, photos, around, variant } = ctx;
  const art = async (name, bytes) => { await output('eras/2011/images/' + name, bytes); return sharp(bytes).metadata(); };
  const img = (src, meta, alt, extra = '') => `<img src="${src}" width="${meta.width}" height="${meta.pageHeight || meta.height}" alt="${escape(alt)}"${extra}>`;

  // Woven linen: horizontal and vertical threads with a little noise.
  await art('linen.png', await texture(96, 2011, (x, y, next) => {
    const thread = Math.sin(x * 2.1) * 3 + Math.sin(y * 2.3) * 3 + (next() - 0.5) * 14 + ((x * 7 + y * 3) % 5 === 0 ? -6 : 0);
    return shade(hex('#d3d0ca'), thread);
  }));
  await art('leather.png', await texture(128, 7, (x, y, next) => {
    const grain = (next() - 0.5) * 22 + Math.sin(x * 0.7 + Math.sin(y * 0.45) * 2) * 4 + Math.sin(y * 0.9 + Math.sin(x * 0.33) * 2) * 4;
    return shade(hex('#5b3a26'), grain);
  }));
  await art('cork.png', await texture(128, 3, (x, y, next) => {
    const n = next(), fleck = n > 0.985 ? 38 : n < 0.04 ? -42 : (n - 0.5) * 26;
    return shade(hex('#b98a5a'), fleck + Math.sin(x * 0.5) * 2);
  }));
  await art('paper.png', await texture(128, 11, (x, y, next) => shade(hex('#fbf8f0'), (next() - 0.5) * 8)));
  await art('pin.png', await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="30"><defs><radialGradient id="g" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#ff8a80"/><stop offset=".45" stop-color="#e0291c"/><stop offset="1" stop-color="#7a0f08"/></radialGradient></defs><path d="M13 16 L15 29 L12 29 Z" fill="#9a9a9a"/><ellipse cx="14" cy="27" rx="5" ry="1.6" fill="rgba(0,0,0,.25)"/><circle cx="13" cy="10" r="8.5" fill="url(#g)"/><ellipse cx="10.5" cy="7" rx="3" ry="2" fill="rgba(255,255,255,.65)"/></svg>`)).png().toBuffer());

  // Web fonts, self-hosted the way Font Squirrel kits were.
  const fontsDir = path.join(ctx.dist, 'eras/2011/fonts');
  await mkdir(fontsDir, { recursive: true });
  for (const [pkg, file] of [['league-gothic', 'league-gothic-latin-400-normal'], ['reenie-beanie', 'reenie-beanie-latin-400-normal']]) {
    for (const ext of ['woff2', 'woff']) await copyFile(path.join(root, 'node_modules/@fontsource', pkg, 'files', file + '.' + ext), path.join(fontsDir, file + '.' + ext));
  }

  // The filter: square, warm, faded, vignetted, as a photo app taught everyone to like in 2011.
  const vignette = size => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><radialGradient id="v" cx=".5" cy=".5" r=".72"><stop offset=".55" stop-color="#ffffff"/><stop offset="1" stop-color="#5e4a36"/></radialGradient></defs><rect width="${size}" height="${size}" fill="url(#v)"/></svg>`)).png().toBuffer();
  const v220 = await vignette(220), v612 = await vignette(612);
  const filtered = (image, size, mask) => image.resize({ width: size, height: size, fit: 'cover' })
    .modulate({ saturation: 0.82, brightness: 1.04 }).linear([0.86, 0.84, 0.76], [26, 20, 14])
    .composite([{ input: mask, blend: 'multiply' }]).jpeg({ quality: 82 }).toBuffer();
  const pictures = [];
  for (const photo of photos) {
    const square = await variant(photo, YEAR, 'photos/' + photo.id + '-sq.jpg', image => filtered(image, 220, v220));
    const large = await variant(photo, YEAR, 'photos/' + photo.id + '-612.jpg', image => filtered(image, 612, v612));
    pictures.push({ photo, square, large });
  }
  // Each Polaroid sits at its own angle, the same on every visit.
  const next = random(42);
  const tilt = pictures.map(() => Math.round((next() * 8 - 4) * 10) / 10);

  const ring = around(YEAR);
  const label = item => String(item.year);
  const page = (title, current, body, scripts = []) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${csp}
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body class="${current.replace('.html', '')}">
<header class="leather">
  <div class="stitch">
    <h1><a href="index.html">Gerry Zhao</a></h1>
    <p class="motto">Photographs &amp; notes</p>
  </div>
</header>
<nav class="ribbon"><ul>${[['index.html', 'Home'], ['photos.html', 'Photographs'], ['notes.html', 'Notes'], ['/eras/', 'Other years']].map(([href, text]) => '<li' + (href === current ? ' class="current"' : '') + '><a href="' + href + '">' + text + '</a></li>').join('')}</ul></nav>
${body}
<footer>
  <p class="letterpress">&copy; ${new Date().getUTCFullYear()} Gerry Zhao &middot; Time ring: <a href="${ring.previous.href}">&larr; ${label(ring.previous)}</a> &middot; <a href="/eras/">all</a> &middot; <a href="${ring.next.href}">${label(ring.next)} &rarr;</a></p>
</footer>
${scripts.map(src => '<script src="' + src + '"></script>').join('\n')}
</body>
</html>
`;
  const featured = pictures.filter(item => item.photo.featured);
  await output('eras/2011/index.html', page('Gerry Zhao — Photographs & notes', 'index.html', `<div class="sheet">
  <section class="welcome card">
    <h2 class="letterpress-dark">Chasing light. Keeping moments.</h2>
    <p>Hello! I take photographs of light: trains drawn out into long lines, rain on Times Square, the Golden Gate after the sun goes down. There are <strong>${photos.length}</strong> of them pinned up in the <a href="photos.html">photographs</a> room. Leave me a note while you are here.</p>
    <p class="buttons"><a class="button" href="photos.html">See the photographs</a> <a class="button grey" href="notes.html">Read the notes</a></p>
  </section>
  <section class="board small">
    ${featured.map((item, i) => `<figure class="polaroid" data-tilt="${tilt[i] * 1.5}"><img class="pin" src="images/pin.png" width="26" height="30" alt=""><a href="photos.html#${item.photo.id}">${img(item.square.src, item.square, item.photo.alt)}</a><figcaption>${escape(item.photo.place)}</figcaption></figure>`).join('\n    ')}
  </section>
  <section class="pad card">
    <h3 class="hand">Latest notes</h3>
    <ul id="latest" class="lines"><li>Loading&hellip;</li></ul>
    <p class="more"><a href="notes.html">All notes &rarr;</a></p>
  </section>
  <section class="elsewhere card">
    <h3 class="letterpress-dark">Elsewhere</h3>
    <ul>
      <li><a href="https://mail.g3rry.com/">g3mail</a> &mdash; a free @g3rry.com address</li>
      <li><a href="/phantom/">The Phantom</a> &mdash; light, in a million points</li>
      <li><a href="/mountain/">The Ascent</a> &mdash; the whole site as a mountain</li>
    </ul>
  </section>
</div>`, ['tilt.js', 'notes.js']));

  await output('eras/2011/photos.html', page('Photographs — Gerry Zhao', 'photos.html', `<div class="toolbar">
  <span class="letterpress">${photos.length} photographs, pinned up</span>
  <label class="switch"><span>Captions</span><input type="checkbox" id="captions" checked><span class="track"><span class="knob"></span><span class="on">ON</span><span class="off">OFF</span></span></label>
</div>
<section class="board">
${pictures.map((item, i) => `  <figure class="polaroid" id="${item.photo.id}" data-tilt="${tilt[i]}"><img class="pin" src="images/pin.png" width="26" height="30" alt=""><a href="${item.large.src}" data-caption="${escape(item.photo.place + ', ' + item.photo.city)}">${img(item.square.src, item.square, item.photo.alt)}</a><figcaption>${escape(item.photo.place)}</figcaption></figure>`).join('\n')}
</section>`, ['tilt.js', 'board.js']));

  await output('eras/2011/notes.html', page('Notes — Gerry Zhao', 'notes.html', `<div class="sheet narrow">
  <section class="pad card tall">
    <h2 class="hand">Notes from visitors</h2>
    <ul id="notes" class="lines"><li>Loading&hellip;</li></ul>
    <p class="more"><a class="button" href="/guestbook/">Leave a note</a></p>
  </section>
</div>`, ['notes.js']));
}
