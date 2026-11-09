// 2014: flat. One long page. A full-screen photograph with the name over it and a ghost button, a hamburger,
// flat colour sections with round icons and long shadows, numbers that count up, a filterable portfolio,
// a parallax band, testimonials (the guestbook), a dark contact section.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const YEAR = 2014;

export default async function build(ctx, era) {
  const { root, dist, output, escape, csp, photos, around, variant } = ctx;
  const fontsDir = path.join(dist, 'eras/2014/fonts');
  await mkdir(fontsDir, { recursive: true });
  for (const weight of [300, 400, 600, 800]) await copyFile(path.join(root, 'node_modules/@fontsource/open-sans/files/open-sans-latin-' + weight + '-normal.woff2'), path.join(fontsDir, 'open-sans-' + weight + '.woff2'));

  const heroPhoto = photos.find(photo => photo.id === 'p16') || photos[0];
  const bandPhoto = photos.find(photo => photo.id === 'p05') || photos[1];
  await variant(heroPhoto, YEAR, 'img/hero.jpg', image => image.resize({ width: 1600, height: 1000, fit: 'cover' }).jpeg({ quality: 74, progressive: true }).toBuffer());
  await variant(bandPhoto, YEAR, 'img/band.jpg', image => image.resize({ width: 1600, height: 900, fit: 'cover', position: 'attention' }).jpeg({ quality: 70, progressive: true }).toBuffer());
  const tiles = [];
  for (const photo of photos) {
    const tile = await variant(photo, YEAR, 'img/work-' + photo.frame + '.jpg', image => image.resize({ width: 600, height: 450, fit: 'cover' }).jpeg({ quality: 76 }).toBuffer());
    const full = await variant(photo, YEAR, 'img/full-' + photo.frame + '.jpg', image => image.resize({ width: 1400, height: 1000, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer());
    tiles.push({ photo, tile, full });
  }
  const cities = [...new Set(photos.map(photo => photo.city))];
  const slug = city => city.toLowerCase().replace(/\s+/g, '-');
  const lenses = new Set(photos.map(photo => photo.meta.lens)).size;
  const longest = Math.max(...photos.map(photo => /^\d+$/.test(photo.meta.shutter) ? Number(photo.meta.shutter) : 0));

  const ring = around(YEAR);
  const label = item => String(item.year);
  // Round flat icons with a long shadow falling to the lower right.
  const icon = paths => `<svg class="icon" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56"/><path class="long" d="M84 40 L160 116 L116 160 L40 84 Z"/>${paths}</svg>`;
  const icons = {
    camera: icon('<rect x="32" y="44" width="56" height="38" rx="5" fill="#fff"/><rect x="48" y="36" width="20" height="10" rx="2" fill="#fff"/><circle cx="60" cy="63" r="12" fill="currentColor"/><circle cx="60" cy="63" r="6" fill="#fff"/>'),
    moon: icon('<path d="M70 34a28 28 0 1 0 18 46 22 22 0 1 1-18-46z" fill="#fff"/>'),
    bridge: icon('<path d="M28 78h64M40 78V40M80 78V40M40 42q20 30 40 0M28 52q12 4 12-10M92 52q-12 4-12-10" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>'),
    mail: icon('<rect x="32" y="42" width="56" height="38" rx="4" fill="#fff"/><path d="M33 44l27 20 27-20" stroke="currentColor" stroke-width="4" fill="none"/>')
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1">
${csp}
<meta name="robots" content="noindex">
<title>GERRY ZHAO | Photography</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body id="top">

<nav class="navbar" id="navbar">
  <div class="container">
    <a class="brand" href="#top">GERRY<strong>ZHAO</strong></a>
    <button class="hamburger" id="hamburger" type="button" aria-label="Open the menu" aria-expanded="false"><span></span><span></span><span></span></button>
  </div>
</nav>
<div class="overlay-menu" id="menu">
  <ul>
    <li><a href="#about">About</a></li><li><a href="#work">Work</a></li><li><a href="#notes">Kind words</a></li><li><a href="#contact">Contact</a></li><li><a href="/eras/">Other years</a></li>
  </ul>
</div>

<header class="hero" id="hero">
  <div class="hero-inner">
    <h1>GERRY ZHAO</h1>
    <p class="tagline">PHOTOGRAPHER &nbsp;&middot;&nbsp; LIGHT CHASER</p>
    <a class="btn-ghost" href="#work">VIEW MY WORK</a>
  </div>
  <a class="scroll-down" href="#about" aria-label="Scroll down"><span></span></a>
</header>

<section class="section turquoise" id="about">
  <div class="container">
    <h2 class="section-title">HELLO, I'M GERRY.</h2>
    <p class="lead">I make photographs of light: trains stretched into lines, rain on Times Square, the Golden Gate after sundown. Here is some of my work.</p>
    <div class="row features">
      <div class="col-md-4">${icons.camera}<h3>Long exposures</h3><p>Twenty seconds at f/32, until a train becomes a line.</p></div>
      <div class="col-md-4">${icons.moon}<h3>Night &amp; rain</h3><p>Neon on wet pavement, umbrellas, the city after dark.</p></div>
      <div class="col-md-4">${icons.bridge}<h3>Bridges at dusk</h3><p>The Golden Gate in the last minutes of light.</p></div>
    </div>
  </div>
</section>

<section class="section stats">
  <div class="container">
    <div class="row">
      <div class="col-md-3 stat"><span class="count" data-to="${photos.length}">0</span><span class="what">Photographs</span></div>
      <div class="col-md-3 stat"><span class="count" data-to="${cities.length}">0</span><span class="what">Cities</span></div>
      <div class="col-md-3 stat"><span class="count" data-to="${lenses}">0</span><span class="what">Lenses</span></div>
      <div class="col-md-3 stat"><span class="count" data-to="${longest}" data-suffix="s">0</span><span class="what">Longest exposure</span></div>
    </div>
  </div>
</section>

<section class="section work" id="work">
  <div class="container">
    <h2 class="section-title dark">PORTFOLIO</h2>
    <ul class="filters" id="filters">
      <li><button type="button" class="active" data-filter="all">All</button></li>
      ${cities.map(city => '<li><button type="button" data-filter="' + slug(city) + '">' + escape(city) + '</button></li>').join('\n      ')}
    </ul>
  </div>
  <div class="grid" id="grid">
${tiles.map(({ photo, tile, full }, i) => `    <a class="tile" href="${full.src}" data-city="${slug(photo.city)}" data-index="${i}" data-width="${full.width}" data-height="${full.height}">
      <img src="${tile.src}" width="${tile.width}" height="${tile.height}" alt="${escape(photo.alt)}" loading="lazy">
      <span class="caption"><strong>${escape(photo.place)}</strong><em>${escape(photo.city)}</em></span>
    </a>`).join('\n')}
  </div>
</section>

<section class="parallax" id="band">
  <div class="container"><blockquote>&ldquo;Chasing light. Keeping moments.&rdquo;</blockquote></div>
</section>

<section class="section notes" id="notes">
  <div class="container">
    <h2 class="section-title dark">KIND WORDS</h2>
    <div class="carousel" id="carousel"><p class="quote">Loading&hellip;</p></div>
    <div class="dots" id="dots"></div>
    <p class="center"><a class="btn-flat" href="/guestbook/">LEAVE A NOTE</a></p>
  </div>
</section>

<section class="section contact" id="contact">
  <div class="container">
    <h2 class="section-title">GET IN TOUCH</h2>
    <div class="row">
      <div class="col-md-6">${icons.mail}<p class="lead">Say hello at <a href="mailto:${ctx.site.guestbook.contact}">${ctx.site.guestbook.contact}</a>, or get your own address on <a href="https://mail.g3rry.com/">g3mail</a>.</p></div>
      <div class="col-md-6"><ul class="links"><li><a href="/phantom/">The Phantom &rarr;</a></li><li><a href="/mountain/">The Ascent &rarr;</a></li><li><a href="${ring.previous.href}">&larr; ${label(ring.previous)}</a> &nbsp;|&nbsp; <a href="/eras/">All years</a> &nbsp;|&nbsp; <a href="${ring.next.href}">${label(ring.next)} &rarr;</a></li></ul></div>
    </div>
  </div>
</section>

<footer class="footer"><div class="container">&copy; ${new Date().getUTCFullYear()} GERRY ZHAO. MADE WITH &hearts;.</div></footer>
<a class="to-top" id="to-top" href="#top" aria-label="Back to top">&uarr;</a>

<div class="slider" id="slider" hidden>
  <button type="button" class="slider-close" id="slider-close" aria-label="Close">&times;</button>
  <button type="button" class="slider-prev" id="slider-prev" aria-label="Previous">&lsaquo;</button>
  <img id="slider-image" src="${tiles[0].full.src}" width="${tiles[0].full.width}" height="${tiles[0].full.height}" alt="">
  <button type="button" class="slider-next" id="slider-next" aria-label="Next">&rsaquo;</button>
  <p class="slider-count" id="slider-count"></p>
</div>

<script src="js/app.js"></script>
</body>
</html>
`;
  await output('eras/2014/index.html', html);
}
