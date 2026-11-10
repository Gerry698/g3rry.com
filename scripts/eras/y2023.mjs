// 2023: dark by default. A bento grid of rounded tiles, some frosted over slow gradient blobs, set in Inter;
// a command palette on ⌘K; photographs open with a view transition. No framework underneath.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const YEAR = 2023;

export default async function build(ctx, era) {
  const { root, dist, output, escape, csp, photos, around, variant } = ctx;
  const fontsDir = path.join(dist, 'eras/2023/fonts');
  await mkdir(fontsDir, { recursive: true });
  for (const weight of [400, 500, 600, 700]) await copyFile(path.join(root, 'node_modules/@fontsource/inter/files/inter-latin-' + weight + '-normal.woff2'), path.join(fontsDir, 'inter-' + weight + '.woff2'));

  const shots = [];
  for (const photo of photos) {
    const thumb = await variant(photo, YEAR, 'media/' + photo.id + '-640.webp', image => image.resize({ width: 640 }).webp({ quality: 78 }).toBuffer());
    const full = await variant(photo, YEAR, 'media/' + photo.id + '-1600.webp', image => image.resize({ width: 1600, height: 1600, fit: 'inside' }).webp({ quality: 80 }).toBuffer());
    shots.push({ photo, thumb, full });
  }
  const hero = shots.find(item => item.photo.id === 'p17') || shots[0];
  const heroWide = await variant(hero.photo, YEAR, 'media/hero.webp', image => image.resize({ width: 1200, height: 900, fit: 'cover', position: 'attention' }).webp({ quality: 80 }).toBuffer());
  const cities = [...new Set(photos.map(photo => photo.city))];
  const lenses = [...new Set(photos.map(photo => photo.meta.lens))];
  const longest = Math.max(...photos.map(photo => /^\d+$/.test(photo.meta.shutter) ? Number(photo.meta.shutter) : 0));
  const newest = [...shots].sort((a, b) => b.photo.taken - a.photo.taken)[0];
  // The newest photograph closes the grid as a strip across its full width.
  const newestWide = await variant(newest.photo, YEAR, 'media/newest.webp', image => image.resize({ width: 1200, height: 500, fit: 'cover', position: 'attention' }).webp({ quality: 80 }).toBuffer());

  const ring = around(YEAR);
  const label = item => String(item.year);
  // Everything the command palette can jump to.
  const commands = [
    { group: 'Pages', title: 'Home', href: 'index.html' }, { group: 'Pages', title: 'Photos', href: 'photos.html' },
    { group: 'Pages', title: 'Guestbook', href: '/guestbook/' }, { group: 'Pages', title: 'The Phantom', href: '/phantom/' },
    { group: 'Pages', title: 'The Ascent', href: '/mountain/' }, { group: 'Pages', title: 'g3mail', href: 'https://mail.g3rry.com/' },
    ...shots.map(({ photo }) => ({ group: 'Photos', title: photo.place + ' · ' + photo.city, href: 'photos.html#' + photo.id })),
    ...ring.all.map(item => ({ group: 'Years', title: item.year + ' · ' + item.name, href: item.href }))
  ];
  await output('eras/2023/commands.json', JSON.stringify(commands) + '\n');

  const page = (title, current, body, scripts = []) => `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${csp}
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark light">
<meta name="view-transition" content="same-origin">
<title>${escape(title)}</title>
<link rel="preload" href="fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div class="blobs" aria-hidden="true"><span></span><span></span><span></span></div>
<header class="top">
  <a class="mark" href="index.html"><span class="dot"></span>gerry zhao</a>
  <nav>${[['index.html', 'Home'], ['photos.html', 'Photos'], ['/guestbook/', 'Guestbook'], ['/eras/', 'Other years']].map(([href, text]) => '<a href="' + href + '"' + (href === current ? ' aria-current="page"' : '') + '>' + text + '</a>').join('')}</nav>
  <button type="button" class="kbd-button" id="open-palette" aria-haspopup="dialog"><span>Search</span><kbd>⌘K</kbd></button>
</header>
${body}
<footer class="foot">
  <span>© ${YEAR}–${new Date().getUTCFullYear()} Gerry Zhao</span>
  <span>Built with HTML, CSS and a little JavaScript. No framework.</span>
  <span><a href="${ring.previous.href}">← ${label(ring.previous)}</a> · <a href="/eras/">All years</a> · <a href="${ring.next.href}">${label(ring.next)} →</a></span>
</footer>
<dialog class="palette" id="palette" aria-label="Command palette">
  <input type="search" id="palette-input" placeholder="Search pages, photos, years…" autocomplete="off" spellcheck="false" role="combobox" aria-label="Search pages, photos and years" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list">
  <ul id="palette-list" role="listbox" aria-label="Results"></ul>
  <p class="hint"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>↵</kbd> to open · <kbd>esc</kbd> to close</p>
</dialog>
<script type="module" src="palette.js"></script>
${scripts.map(src => '<script type="module" src="' + src + '"></script>').join('\n')}
</body>
</html>
`;

  await output('eras/2023/index.html', page('Gerry Zhao', 'index.html', `<main class="bento">
  <a class="tile hero" href="photos.html#${hero.photo.id}">
    <img src="${heroWide.src}" width="${heroWide.width}" height="${heroWide.height}" alt="${escape(hero.photo.alt)}">
    <span class="hero-label"><span class="eyebrow">Latest series</span><span>The Golden Gate, after sundown</span></span>
  </a>
  <section class="tile intro glass">
    <p class="eyebrow">Hi, I'm Gerry</p>
    <h1>I photograph light at the edges of the day.</h1>
    <p class="muted">Long exposures, rain and neon, bridges at dusk. New York and San Francisco so far.</p>
  </section>
  <section class="tile stat"><span class="big">${photos.length}</span><span class="muted">photographs</span></section>
  <section class="tile stat"><span class="big">${longest}<small>s</small></span><span class="muted">longest exposure, f/32</span></section>
  <section class="tile note glass" id="note-tile">
    <p class="eyebrow">Latest note</p>
    <blockquote id="latest-note" class="muted">Loading…</blockquote>
    <a class="arrow" href="/guestbook/">Sign the guestbook →</a>
  </section>
  <section class="tile places">
    <p class="eyebrow">Places</p>
    <ul>${cities.map(city => '<li><span class="pin"></span>' + escape(city) + '<span class="muted"> · ' + photos.filter(photo => photo.city === city).length + '</span></li>').join('')}</ul>
  </section>
  <section class="tile wordle" aria-label="A Wordle result, shared without spoilers">
    <p class="eyebrow">${escape(ctx.puzzles.wordle.title)}</p>
    <div class="wordle-grid">${ctx.puzzles.wordle.rows.map(row => '<div class="wordle-row">' + [...row.marks].map((mark, i) => '<span class="sq ' + mark + '">' + escape(row.letters.charAt(i)) + '</span>').join('') + '</div>').join('')}</div>
    <p class="muted">Shared from the trailhead at 7:02 am.</p>
  </section>
  <section class="tile kit">
    <p class="eyebrow">Kit</p>
    <ul>${lenses.map(lens => '<li>' + escape(lens.replace(/ IS USM$/, '').replace(' L', 'L')) + '</li>').join('')}</ul>
  </section>
  <a class="tile link" href="/phantom/"><p class="eyebrow">Lab</p><h2>The Phantom</h2><p class="muted">A million points of light on the GPU.</p><span class="arrow">↗</span></a>
  <a class="tile link" href="/mountain/"><p class="eyebrow">Index</p><h2>The Ascent</h2><p class="muted">The whole site as one mountain.</p><span class="arrow">↗</span></a>
  <a class="tile link glass" href="https://mail.g3rry.com/"><p class="eyebrow">Mail</p><h2>g3mail</h2><p class="muted">A free @g3rry.com address.</p><span class="arrow">↗</span></a>
  <a class="tile newest" href="photos.html#${newest.photo.id}"><img src="${newestWide.src}" width="${newestWide.width}" height="${newestWide.height}" alt="${escape(newest.photo.alt)}" loading="lazy"><span class="hero-label"><span class="eyebrow">Newest</span><span>${escape(newest.photo.place)}</span></span></a>
</main>`, ['notes.js']));

  await output('eras/2023/photos.html', page('Photos · Gerry Zhao', 'photos.html', `<main class="photos">
  <header class="photos-head"><h1>Photos</h1><p class="muted">${photos.length} frames · ${cities.join(' · ')}</p></header>
  <div class="masonry">
${shots.map(({ photo, thumb, full }) => `    <a class="shot" id="${photo.id}" href="${full.src}" data-width="${full.width}" data-height="${full.height}" data-caption="${escape(photo.place + ' · ' + photo.city)}" data-exif="${escape(photo.meta.focal + ' mm · ƒ/' + photo.meta.aperture + ' · ' + photo.meta.shutter + ' s · ISO ' + photo.meta.iso)}"><img src="${thumb.src}" width="${thumb.width}" height="${thumb.height}" alt="${escape(photo.alt)}" loading="lazy"><span>${escape(photo.place)}</span></a>`).join('\n')}
  </div>
</main>
<dialog class="viewer" id="viewer" aria-label="Photo">
  <img id="viewer-image" src="${shots[0].full.src}" width="${shots[0].full.width}" height="${shots[0].full.height}" alt="">
  <p><strong id="viewer-caption"></strong> <span class="muted" id="viewer-exif"></span></p>
  <button type="button" id="viewer-close" aria-label="Close">×</button>
</dialog>`, ['photos.js']));
}
