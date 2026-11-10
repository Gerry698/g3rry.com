// 2018: Material cards with elevation, an app bar with tabs, a floating action button, ripples, letter avatars,
// a dialog with EXIF chips, a flat illustration, a cookie banner after 25 May, a newsletter modal, a JSON Feed.
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const YEAR = 2018;

// The 2018 copy's own service worker. Like many progressive web apps of its year it promises to work offline, and
// keeps the promise with one saved page: when a page cannot be fetched, the offline page is shown instead. The cache
// is named after the saved files, so a visitor who comes back after they change gets the new ones.
const serviceWorker = version => `// Gerry Zhao — sw.js. Without a connection, a saved page.
const CACHE = 'eras-2018-offline-${version}';
const SAVED = ['/eras/2018/offline.html', '/eras/2018/app.css'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SAVED)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('eras-2018-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/eras/2018/offline.html')));
  } else if (SAVED.includes(new URL(request.url).pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
  }
});
`;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A flat illustration in the manner of the free library everyone used in 2018: its violet accent, a big soft blob, a
// long figure with a small head on a ground line, a plant in a pot, a camera on a tripod, and the moon.
const ILLUSTRATION = `<svg class="illustration" viewBox="0 0 400 260" role="img" aria-label="A person photographing the moon with a camera on a tripod">
  <path d="M52 196 C30 118 112 36 214 44 C316 52 380 116 356 188 C340 236 262 238 186 238 C112 238 66 236 52 196 Z" fill="#f2f2f2"/>
  <circle cx="306" cy="74" r="26" fill="#6c63ff"/><circle cx="296" cy="66" r="5" fill="#fff" opacity=".22"/><circle cx="314" cy="86" r="4" fill="#fff" opacity=".22"/><circle cx="318" cy="64" r="2.5" fill="#fff" opacity=".22"/>
  <circle cx="120" cy="70" r="2" fill="#6c63ff" opacity=".45"/><circle cx="172" cy="56" r="1.6" fill="#6c63ff" opacity=".45"/><circle cx="356" cy="132" r="1.8" fill="#6c63ff" opacity=".45"/><circle cx="244" cy="92" r="1.4" fill="#6c63ff" opacity=".45"/>
  <g fill="none" stroke="#3f3d56" stroke-width="2"><path d="M86 212 C84 190 78 170 66 152"/><path d="M86 212 C88 188 96 168 110 156"/><path d="M86 212 V160"/></g>
  <path d="M66 152 C52 150 46 164 56 176 C66 172 72 160 66 152 Z" fill="#6c63ff"/><path d="M110 156 C124 152 132 166 122 178 C112 174 104 164 110 156 Z" fill="#6c63ff"/>
  <path d="M86 160 C78 146 82 128 92 120 C98 132 96 148 86 160 Z" fill="#6c63ff"/><path d="M80 190 C66 186 58 196 64 206 C74 204 80 198 80 190 Z" fill="#3f3d56"/><path d="M93 186 C106 180 116 190 110 200 C100 200 94 194 93 186 Z" fill="#3f3d56"/>
  <path d="M70 210 H102 L97 238 H75 Z" fill="#3f3d56"/>
  <g stroke="#3f3d56" stroke-width="3" stroke-linecap="round"><path d="M260 152 L238 237"/><path d="M260 152 L282 237"/><path d="M260 152 V237"/></g>
  <g transform="rotate(-24 258 142)"><rect x="240" y="132" width="34" height="20" rx="3" fill="#2f2e41"/><rect x="272" y="136" width="12" height="12" rx="2" fill="#6c63ff"/><rect x="245" y="128" width="10" height="5" rx="1" fill="#2f2e41"/></g>
  <path d="M195 168 L189 236 H199 L205 188 L210 236 H220 L215 168 Z" fill="#2f2e41"/>
  <ellipse cx="193" cy="237" rx="8" ry="3" fill="#3f3d56"/><ellipse cx="216" cy="237" rx="8" ry="3" fill="#3f3d56"/>
  <path d="M190 124 Q205 114 220 124 L223 172 H192 Z" fill="#6c63ff"/>
  <rect x="202" y="110" width="7" height="10" fill="#ffb8b8"/><circle cx="205" cy="102" r="10" fill="#ffb8b8"/>
  <path d="M195.4 103 C193 90 215 86 215.6 100 C211 95 202 95 195.4 103 Z" fill="#2f2e41"/>
  <path d="M215 128 L243 147" stroke="#ffb8b8" stroke-width="5.5" stroke-linecap="round"/><path d="M214 127 L224 134" stroke="#6c63ff" stroke-width="8" stroke-linecap="round"/>
  <path d="M213 138 L239 154" stroke="#ffb8b8" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M24 238 H376" stroke="#3f3d56" stroke-width="2"/>
</svg>`;

const ICON = {
  menu: '<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>', edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/>',
  share: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 1 0 15 5c0 .24.04.47.09.7L8.04 9.81a3 3 0 1 0 0 4.38l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z"/>',
  close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>'
};
const icon = (name, label) => `<svg class="mi" viewBox="0 0 24 24"${label ? ' role="img" aria-label="' + label + '"' : ' aria-hidden="true"'}>${ICON[name]}</svg>`;

export default async function build(ctx, era) {
  const { root, dist, output, escape, csp, photos, site, around, variant } = ctx;
  const fontsDir = path.join(dist, 'eras/2018/fonts');
  await mkdir(fontsDir, { recursive: true });
  for (const weight of [300, 400, 500]) await copyFile(path.join(root, 'node_modules/@fontsource/roboto/files/roboto-latin-' + weight + '-normal.woff2'), path.join(fontsDir, 'roboto-' + weight + '.woff2'));

  const cards = [];
  for (const photo of photos) {
    const media = await variant(photo, YEAR, 'images/' + photo.id + '-card.jpg', image => image.resize({ width: 640, height: 360, fit: 'cover' }).jpeg({ quality: 78, progressive: true }).toBuffer());
    const full = await variant(photo, YEAR, 'images/' + photo.id + '.jpg', image => image.resize({ width: 1200, height: 900, fit: 'inside' }).jpeg({ quality: 80, progressive: true }).toBuffer());
    cards.push({ photo, media, full });
  }
  const date = d => months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  const chips = photo => [photo.meta.focal + ' mm', 'f/' + photo.meta.aperture, photo.meta.shutter + ' s', 'ISO ' + photo.meta.iso];
  const card = ({ photo, media, full }) => `<article class="card elevate" data-full="${full.src}" data-width="${full.width}" data-height="${full.height}" data-title="${escape(photo.place)}" data-sub="${escape(photo.city + ' · ' + date(photo.taken))}" data-chips="${escape(chips(photo).join('|'))}" data-alt="${escape(photo.alt)}">
  <a class="card-media ripple" href="${full.src}"><img src="${media.src}" width="${media.width}" height="${media.height}" alt="${escape(photo.alt)}" loading="lazy"></a>
  <div class="card-body"><h3>${escape(photo.place)}</h3><p class="secondary">${escape(photo.city)} &middot; ${date(photo.taken)}</p></div>
  <div class="card-actions"><a class="button ripple open" href="${full.src}">View</a><button type="button" class="button ripple share" data-url="photos.html#${photo.id}">${icon('share')}Share</button></div>
</article>`;

  const ring = around(YEAR);
  const label = item => String(item.year);
  // A consent manager of 2018, with two tabs. Strata (legitimate-interest): see the private solution book.
  const vendorRow = (vendor, on, tab) => '<li class="vendor"><label><span class="vendor-text"><span class="vendor-name">' + escape(vendor.name) + '</span><span class="secondary">Keeps data for ' + vendor.days + ' day' + (vendor.days === 1 ? '' : 's') + '</span></span>'
    + '<input type="checkbox" class="toggle" data-tab="' + tab + '"' + (on ? ' checked' : '') + ' aria-label="' + escape(vendor.name) + '"></label></li>';
  const consent = `<div class="scrim" id="consent" hidden>
  <div class="dialog consent elevate-24" role="dialog" aria-modal="true" aria-labelledby="consent-title">
    <h2 id="consent-title">Your privacy choices</h2>
    <p>We and our ${ctx.puzzles.vendors.length} partners store and/or access information on a device, such as cookies, and process personal data for measurement and personalised content. You can change your choices at any time.</p>
    <div class="consent-tabs" role="tablist"><button type="button" role="tab" class="ripple" aria-selected="true" data-show="consent">Consent</button><button type="button" role="tab" class="ripple" aria-selected="false" data-show="legitimate">Legitimate interest</button></div>
    <ul class="vendors" data-panel="consent">${ctx.puzzles.vendors.map(vendor => vendorRow(vendor, false, 'consent')).join('')}</ul>
    <ul class="vendors" data-panel="legitimate" hidden>${ctx.puzzles.vendors.map(vendor => vendorRow(vendor, vendor.legitimate, 'legitimate')).join('')}</ul>
    <div class="dialog-actions"><button type="button" class="button ripple" id="consent-reject">Reject all</button><button type="button" class="button accent ripple" id="consent-save">Save choices</button></div>
  </div>
</div>`;
  const page = (title, current, body, scripts = ['app.js']) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${csp}
<meta name="robots" content="noindex">
<meta name="theme-color" content="#3f51b5">
<title>${escape(title)}</title>
<link rel="stylesheet" href="app.css">
<link rel="alternate" type="application/feed+json" title="Gerry Zhao" href="feed.json">
</head>
<body>
<header class="app-bar">
  <div class="app-bar-row">
    <button class="icon-button ripple" id="drawer-button" type="button" aria-label="Menu">${icon('menu')}</button>
    <a class="app-title" href="index.html">Gerry Zhao</a>
  </div>
  <nav class="tabs" id="drawer">${[['index.html', 'Home'], ['photos.html', 'Photos'], ['notes.html', 'Notes'], ['/eras/', 'Other years']].map(([href, text]) => '<a class="tab ripple' + (href === current ? ' active' : '') + '" href="' + href + '">' + text + '</a>').join('')}</nav>
</header>
<main class="content">
${body}
</main>
<footer class="footer">
  <p>&copy; ${YEAR}&ndash;${new Date().getUTCFullYear()} Gerry Zhao &middot; <a href="https://mail.g3rry.com/">g3mail</a> &middot; <a href="/phantom/">The Phantom</a> &middot; <a href="/mountain/">The Ascent</a></p>
  <p class="offline-ready">&#10003; Works offline</p>
  <p>Time ring: <a href="${ring.previous.href}">&larr; ${label(ring.previous)}</a> &middot; <a href="/eras/">All years</a> &middot; <a href="${ring.next.href}">${label(ring.next)} &rarr;</a></p>
</footer>
<a class="fab ripple" href="/guestbook/" aria-label="Leave a note" title="Leave a note">${icon('edit')}</a>
<div class="snackbar cookie" id="cookies" hidden>
  <p>This website uses cookies to ensure you get the best experience.<!-- 2026: it does not set any. It was 2018, and everyone had a banner. --></p>
  <div><button type="button" class="button ripple" id="cookies-manage">Manage</button><button type="button" class="button accent ripple" id="cookies-accept">Accept</button></div>
</div>
${consent}
<div class="scrim" id="newsletter" hidden>
  <div class="dialog elevate-24" role="dialog" aria-modal="true" aria-labelledby="newsletter-title">
    <h2 id="newsletter-title">Never miss a photo</h2>
    <p>New photographs, straight to your feed reader. No spam, ever.</p>
    <div class="dialog-actions"><button type="button" class="button ripple" id="newsletter-no">No thanks, I don&rsquo;t like photos</button><a class="button accent ripple" href="feed.json">Follow the feed</a></div>
  </div>
</div>
<div class="scrim" id="viewer" hidden>
  <div class="dialog wide elevate-24" role="dialog" aria-modal="true" aria-labelledby="viewer-title">
    <button type="button" class="icon-button close ripple" id="viewer-close" aria-label="Close">${icon('close')}</button>
    <img id="viewer-image" width="${cards[0].full.width}" height="${cards[0].full.height}" alt="">
    <div class="viewer-text"><h2 id="viewer-title"></h2><p class="secondary" id="viewer-sub"></p><div class="chips" id="viewer-chips"></div></div>
  </div>
</div>
${scripts.map(src => '<script src="' + src + '"></script>').join('\n')}
</body>
</html>
`;

  const featured = cards.filter(item => item.photo.featured);
  await output('eras/2018/index.html', page('Gerry Zhao', 'index.html', `<section class="hero card elevate-2">
  <div class="hero-text">
    <span class="chip">Photography</span>
    <h1>Chasing light.<br>Keeping moments.</h1>
    <p>I photograph light at the edges of the day: trains stretched into lines, rain on Times Square, the Golden Gate after sunset.</p>
    <a class="button raised accent ripple" href="photos.html">Browse ${photos.length} photos</a>
  </div>
  ${ILLUSTRATION}
</section>
<h2 class="headline">Featured</h2>
<div class="grid">
${featured.map(card).join('\n')}
</div>
<div class="two-up">
  <article class="card elevate-2 story">
    <p class="overline">3 min read</p>
    <h2>Twenty seconds at f/32</h2>
    <p class="drop">Under Columbus Circle a train arrives and leaves while the shutter stays open. Nothing of the train is left in the picture except the light it carried, drawn out into two bright lines along the platform.</p>
    <p>That is most of what I look for: the moment where light is the subject and everything else is only there to hold it.</p>
  </article>
  <article class="card elevate-2">
    <div class="card-body"><h3>Latest notes</h3></div>
    <ul class="list" id="latest-notes"><li class="list-item"><span class="secondary">Loading&hellip;</span></li></ul>
    <div class="card-actions"><a class="button ripple" href="notes.html">All notes</a></div>
  </article>
</div>`, ['app.js', 'notes.js']));

  await output('eras/2018/photos.html', page('Photos · Gerry Zhao', 'photos.html', `<h1 class="display">Photos</h1>
<p class="secondary">${photos.length} photographs from ${[...new Set(photos.map(photo => photo.city))].join(' and ')}.</p>
<div class="grid">
${cards.map(item => card(item).replace('<article class="card elevate"', '<article class="card elevate" id="' + item.photo.id + '"')).join('\n')}
</div>`));

  await output('eras/2018/notes.html', page('Notes · Gerry Zhao', 'notes.html', `<h1 class="display">Notes</h1>
<p class="secondary">From people who stopped by. Tap the pencil to leave one.</p>
<div class="card elevate-2"><ul class="list" id="notes"><li class="list-item"><span class="secondary">Loading&hellip;</span></li></ul></div>`, ['app.js', 'notes.js']));

  // Offline: the progressive web app's promise, kept by showing this page when the network is gone.
  const arm = [null, [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]];
  const figure = pair => {
    const shoulder = [40, 52], length = 30;
    const arms = pair.map(direction => {
      const [dx, dy] = arm[direction], norm = Math.hypot(dx, dy), x = shoulder[0] + dx / norm * length, y = shoulder[1] + dy / norm * length;
      const flag = '<g transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(0) + ')"><path d="M0 -1 h14 v-12 z" fill="#ffd54f"/><path d="M0 -1 v-12 h14 z" fill="#e53935"/></g>';
      return '<line x1="' + shoulder[0] + '" y1="' + shoulder[1] + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#37474f" stroke-width="5" stroke-linecap="round"/>' + flag;
    }).join('');
    return '<svg class="signal" viewBox="0 0 80 130" width="108" height="176" aria-hidden="true"><circle cx="40" cy="36" r="10" fill="#ffccbc"/><path d="M28 50 h24 l-2 38 h-20 z" fill="#3f51b5"/>'
      + '<path d="M34 88 l-4 34 M46 88 l4 34" stroke="#263238" stroke-width="6" stroke-linecap="round"/>' + arms + '</svg>';
  };
  const offline = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${csp}
<meta name="robots" content="noindex">
<title>Offline · Gerry Zhao</title>
<link rel="stylesheet" href="/eras/2018/app.css">
</head>
<body class="offline">
<main class="content">
  <div class="card elevate-2 offline-card">
    <h1 class="display">You&rsquo;re offline</h1>
    <p class="secondary">No connection right now, but this page was saved for you. While you wait, a climber on the ridge is signalling something.</p>
    <div class="signals">${ctx.puzzles.semaphore.map(figure).join('')}</div>
    <p class="secondary">Reconnect and refresh to see the photographs.</p>
  </div>
</main>
</body>
</html>
`;
  await output('eras/2018/offline.html', offline);
  const saved = Buffer.concat([Buffer.from(offline), await readFile(path.join(root, 'src/eras/2018/app.css'))]);
  await output('eras/2018/sw.js', serviceWorker(ctx.digest(saved)));

  // JSON Feed 1.0, new in 2017.
  const base = new URL('/eras/2018/', site.url).href;
  await output('eras/2018/feed.json', JSON.stringify({
    version: 'https://jsonfeed.org/version/1', title: 'Gerry Zhao', home_page_url: base, feed_url: base + 'feed.json',
    items: [...cards].sort((a, b) => b.photo.taken - a.photo.taken).map(({ photo, full }) => ({
      id: 'g3rry-2018-' + photo.id, url: base + 'photos.html#' + photo.id, title: photo.place, content_text: photo.alt, image: base + full.src,
      date_published: photo.taken.toISOString().slice(0, 19) + 'Z', tags: [photo.city]
    }))
  }, null, 2) + '\n');
}
