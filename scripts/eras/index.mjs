// Other years (/eras/): the site rebuilt as it would have been built in earlier years of the web.
// Each year is a module that writes its own pages from the same content the current site uses.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import y1996 from './y1996.mjs';
import y1999 from './y1999.mjs';
import y2003 from './y2003.mjs';
import y2007 from './y2007.mjs';
import y2011 from './y2011.mjs';
import y2014 from './y2014.mjs';
import y2018 from './y2018.mjs';
import y2023 from './y2023.mjs';

const builders = { 1996: y1996, 1999: y1999, 2003: y2003, 2007: y2007, 2011: y2011, 2014: y2014, 2018: y2018, 2023: y2023 };

export async function buildEras(ctx) {
  const { root, output, escape, digest, cachedImage, lab, render } = ctx;
  const content = JSON.parse(await readFile(path.join(root, 'content/eras.json'), 'utf8'));
  const years = content.eras.map(era => era.year);
  if (years.some((year, i) => !builders[year] || (i && year <= years[i - 1]))) throw new Error('eras.json years must be known and ascending: ' + years.join(', '));
  for (const era of content.eras) if (!era.name || !era.line || !Array.isArray(era.colophon) || !era.colophon.length) throw new Error('Era needs a name, a line and a colophon: ' + era.year);

  // The ring of years, wrapping from the last year back to the first through the current site.
  const ring = [...years.map(year => ({ year, href: '/eras/' + year + '/' })), { year: new Date().getUTCFullYear(), href: '/', now: true }];
  const around = year => {
    const i = ring.findIndex(item => item.year === year);
    return { previous: ring[(i - 1 + ring.length) % ring.length], next: ring[(i + 1) % ring.length], all: ring };
  };

  // Local time of each photograph: camera time corrected by its trip, as on the photograph pages.
  const taken = Object.fromEntries(ctx.photos.map(photo => {
    const meta = lab.photos[photo.id], trip = lab.trips.find(item => item.id === meta.trip);
    const minutes = (trip.cameraClockBehindMinutes || 0) - (trip.cameraClockAheadMinutes || 0);
    const local = new Date(Date.parse(meta.exif + 'Z') + minutes * 60000);
    return [photo.id, local];
  }));
  const photos = ctx.photos.map((photo, index) => ({
    ...photo, index, frame: String(index + 1).padStart(2, '0'), place: lab.photos[photo.id].place, meta: lab.photos[photo.id], taken: taken[photo.id],
    city: lab.sites.find(site => site.id === lab.trips.find(trip => trip.id === lab.photos[photo.id].trip).site).name,
    landscape: photo.width > photo.height
  }));

  // One derived image of one photograph for one year, cached like the main photo encodes.
  async function variant(photo, year, file, make) {
    const master = await readFile(path.join(root, photo.source));
    const ext = path.extname(file).slice(1);
    const name = 'era-' + year + '-' + photo.id + '-' + digest(master) + '-' + digest(make.toString() + sharp.versions.sharp + file) + '.' + ext;
    const bytes = await cachedImage(name, () => make(sharp(master).rotate()));
    await output('eras/' + year + '/' + file, bytes);
    const meta = await sharp(bytes).metadata();
    return { src: file, width: meta.width, height: meta.pageHeight || meta.height, bytes: bytes.length };
  }
  // Static files of a year (scripts, styles) are copied as they are: their plain names are part of the period.
  async function copyStatic(year, sub = '') {
    const directory = path.join(root, 'src/eras', String(year), sub);
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const relative = sub ? sub + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await copyStatic(year, relative);
      else await output('eras/' + year + '/' + relative, await readFile(path.join(directory, entry.name)));
    }
  }
  // Text for pages that predate UTF-8 in practice: escaped, with anything outside ASCII as a numeric entity.
  const ascii = value => escape(value).replace(/[^\x00-\x7f]/gu, ch => '&#' + ch.codePointAt(0) + ';');
  const csp = '<meta http-equiv="Content-Security-Policy" content="' + ctx.policy() + '">';

  const shared = { ...ctx, content, photos, around, variant, copyStatic, ascii, csp, hero: photos.find(photo => photo.id === ctx.site.hero.photoId) };
  for (const era of content.eras) {
    await copyStatic(era.year);
    await builders[era.year](shared, era);
  }

  // The time machine itself: the modem service worker and the dial-up screen are shared by 1996 and 1999.
  for (const name of ['modem.js', 'modem-client.js', 'dialup.js', 'dialup.css', 'dial.css', 'dial.js']) {
    await output('eras/' + name, await readFile(path.join(root, 'src/eras', name)));
  }
  await output('eras/dialup.html', `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${csp}
  <meta name="robots" content="noindex">
  <title>Dial-up connection</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/eras/dialup.css">
</head>
<body>
  <main class="dialer" aria-labelledby="dialer-title">
    <div class="dialer-bar"><span id="dialer-title">Connect to g3rry.com</span><a class="dialer-close" href="/eras/" aria-label="Cancel and go back">×</a></div>
    <div class="dialer-body">
      <svg class="dialer-icon" viewBox="0 0 40 32" aria-hidden="true"><rect x="2" y="4" width="14" height="11" fill="#d8d4c8" stroke="#222"/><rect x="4" y="6" width="10" height="7" fill="#1d4f7a"/><rect x="5" y="16" width="8" height="3" fill="#bbb6a8" stroke="#222"/><rect x="24" y="14" width="14" height="11" fill="#d8d4c8" stroke="#222"/><rect x="26" y="16" width="10" height="7" fill="#1d4f7a"/><rect x="27" y="26" width="8" height="3" fill="#bbb6a8" stroke="#222"/><path d="M13 21 C18 30 22 6 27 13" fill="none" stroke="#222" stroke-dasharray="2 2"/></svg>
      <dl class="dialer-fields">
        <dt>User name</dt><dd>guest</dd>
        <dt>Phone number</dt><dd>805-555-0196</dd>
        <dt><label for="modem-speed">Modem</label></dt>
        <dd><select id="modem-speed" data-modem>
          <option value="14400">14,400 bps</option><option value="28800">28,800 bps</option><option value="33600">33,600 bps</option>
          <option value="48000">56K (connects near 48,000 bps)</option><option value="0">No modem: full speed</option>
        </select></dd>
      </dl>
      <label class="dialer-check"><input type="checkbox" id="dialer-speaker" checked> Modem speaker on</label>
      <p class="dialer-status" id="dialer-status" role="status">Ready to dial.</p>
      <div class="dialer-meter" aria-hidden="true"><span id="dialer-meter"></span></div>
      <div class="dialer-actions">
        <button type="button" id="dialer-connect">Connect</button>
        <a href="/eras/" id="dialer-cancel">Cancel</a>
      </div>
      <p class="dialer-note">The 1996 and 1999 copies of this site load at the speed you choose here: one shared line, four connections at a time, the way a modem fetched a page. The handshake sound is synthesised in your browser.</p>
    </div>
  </main>
  <script src="/eras/modem-client.js"></script>
  <script src="/eras/dialup.js"></script>
</body>
</html>
`);

  // The dial page, in the current site's own style.
  const lines = value => escape(value).replace(/\n/g, '<br>');
  const dial = content.eras.map(era => `<li class="era" id="y${era.year}">
      <a class="era-link" href="/eras/${era.year}/"><span class="era-year">${era.year}</span><span class="era-name">${escape(era.name)}</span><span class="era-line">${escape(era.line)}</span><span class="era-arrow" aria-hidden="true">↗</span></a>
      <details class="era-notes"><summary>How it was built</summary>${era.colophon.map(p => '<p>' + escape(p) + '</p>').join('')}</details>
      ${era.dial ? '<a class="era-dialup" href="/eras/dialup.html?to=' + era.year + '">Arrive by modem</a>' : ''}
    </li>`).join('\n    ');
  const body = `<section class="eras wrap" aria-labelledby="eras-title">
  <header class="eras-intro">
    <p class="eyebrow"><span class="gold-line" aria-hidden="true"></span>${escape(content.intro.kicker)}</p>
    <h1 id="eras-title">${lines(content.intro.title)}</h1>
    <p class="intro">${escape(content.intro.text)}</p>
  </header>
  <ol class="era-list">
    ${dial}
    <li class="era era-now" id="now">
      <a class="era-link" href="/"><span class="era-year">${ring.at(-1).year}</span><span class="era-name">This site</span><span class="era-line">The one you came from.</span><span class="era-arrow" aria-hidden="true">↗</span></a>
    </li>
  </ol>
  <p class="eras-modem"><label for="modem-speed">Modem for 1996 and 1999</label>
    <select id="modem-speed" data-modem disabled><option value="">The year's usual</option><option value="14400">14,400 bps</option><option value="28800">28,800 bps</option><option value="33600">33,600 bps</option><option value="48000">56K</option><option value="0">No modem</option></select></p>
</section>`;
  await output('eras/index.html', render(body, {
    title: content.title, description: content.description, route: '/eras/', pageClass: 'eras-page',
    head: '<link rel="stylesheet" href="/eras/dial.css">', classicScripts: ['/eras/modem-client.js', '/eras/dial.js']
  }));
  return { years };
}
