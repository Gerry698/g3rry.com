// 2007: Web 2.0. A glossy logo with a wet-floor reflection and a beta badge, pill tabs, a big green button,
// a tag cloud, relative dates, notes loaded with a spinner, photographs in a lightbox, an Atom feed.
import sharp from 'sharp';
import { canvas, png, animatedGif, hex, mix } from './pixels.mjs';
import { fonts } from './fonts.mjs';

const YEAR = 2007;
const VARELA = { pkg: 'varela-round', name: 'varela-round-latin-400-normal.woff' };

// Which tags a photograph gets, read from its description and its exposure.
const TAGS = [
  ['rain', p => /rain|wet|umbrella/i.test(p.alt)], ['night', p => /night|neon|illuminated|billboard|fluorescent/i.test(p.alt)],
  ['sunset', p => /sunset|setting sun/i.test(p.alt)], ['dusk', p => /dusk|after sunset/i.test(p.alt)],
  ['people', p => /person|people|pedestrians|crowd|onlookers|cyclist/i.test(p.alt)], ['street', p => /street|storefronts|avenue|pavement/i.test(p.alt)],
  ['bridge', p => /bridge/i.test(p.alt)], ['water', p => /water|waves|waterfront|beach|ferry/i.test(p.alt)],
  ['statue', p => /statue/i.test(p.alt)], ['umbrella', p => /umbrella/i.test(p.alt)], ['reflection', p => /reflect/i.test(p.alt)],
  ['blackandwhite', p => /black-and-white/i.test(p.alt)], ['lighttrails', p => /trails/i.test(p.alt)],
  ['longexposure', p => /^\d+$/.test(p.meta.shutter) && Number(p.meta.shutter) >= 1], ['telephoto', p => p.meta.focal >= 135],
  ['wideangle', p => p.meta.focal <= 28], ['newyork', p => p.city === 'New York'], ['sanfrancisco', p => p.city === 'San Francisco']
];

async function svg(markup) { return sharp(Buffer.from(markup)).png().toBuffer(); }

export default async function build(ctx, era) {
  const { root, output, escape, csp, photos, site, around, variant } = ctx;
  const type = fonts(root);
  const art = async (name, bytes) => { await output('eras/2007/images/' + name, bytes); return sharp(bytes).metadata(); };
  const img = (src, meta, alt, extra = '') => `<img src="${src}" width="${meta.width}" height="${meta.pageHeight || meta.height}" alt="${escape(alt)}"${extra} />`;

  // Text filled with a vertical gradient, a gloss over its top half.
  async function glossyText(text, size, top, bottom) {
    const mask = await type.text('<span foreground="#ffffff">' + escape(text) + '</span>', { ...VARELA, font: 'Varela Round ' + size });
    const { width, height } = await sharp(mask).metadata();
    const fill = canvas(width, height);
    fill.rect(0, 0, width, height, (x, y) => {
      const base = mix(hex(top), hex(bottom), y / height);
      return y < height * 0.48 ? mix(base, [255, 255, 255, 255], 0.28) : base;
    });
    return sharp(await png(fill)).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }
  // The wet floor: the image, then itself upside down, fading out.
  async function reflect(input, { fraction = 0.4, opacity = 0.32, background } = {}) {
    const { width, height } = await sharp(input).metadata();
    const h = Math.round(height * fraction);
    const flipped = await sharp(input).flip().extract({ left: 0, top: 0, width, height: h }).ensureAlpha().png().toBuffer();
    const fade = canvas(width, h);
    fade.rect(0, 0, width, h, (x, y) => [255, 255, 255, Math.round(255 * opacity * (1 - y / h) ** 1.4)]);
    const faded = await sharp(flipped).composite([{ input: await png(fade), blend: 'dest-in' }]).png().toBuffer();
    return sharp({ create: { width, height: height + h + 2, channels: 4, background: background || { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input, top: 0, left: 0 }, { input: faded, top: height + 2, left: 0 }]).png().toBuffer();
  }

  // Logo and badge.
  const first = await glossyText('gerry', 64, '#5ab4ff', '#1166d6');
  const second = await glossyText('zhao', 64, '#c4c4c4', '#8a8a8a');
  const [m1, m2] = await Promise.all([sharp(first).metadata(), sharp(second).metadata()]);
  const word = await sharp({ create: { width: m1.width + m2.width + 10, height: Math.max(m1.height, m2.height), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: first, left: 0, top: 0 }, { input: second, left: m1.width + 10, top: 0 }]).png().toBuffer();
  const logo = await art('logo.png', await reflect(word, { fraction: 0.38, opacity: 0.3 }));
  const betaText = await type.text('<span foreground="#ffffff">beta</span>', { ...VARELA, font: 'Varela Round 13' });
  const betaMeta = await sharp(betaText).metadata();
  const betaPlate = await svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${betaMeta.width + 16}" height="22"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset=".5" stop-color="#ff8a00"/><stop offset=".51" stop-color="#f27300"/><stop offset="1" stop-color="#ff9a1f"/></linearGradient></defs><rect x=".5" y=".5" width="${betaMeta.width + 15}" height="21" rx="5" fill="url(#g)" stroke="#d06000"/></svg>`);
  const beta = await art('beta.png', await sharp(await sharp(betaPlate).composite([{ input: betaText, left: 8, top: Math.round((22 - betaMeta.height) / 2) }]).png().toBuffer())
    .rotate(-10, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());

  // Pill tabs (sliding doors: a left cap and a long right part), resting and hover stacked in one image.
  const pill = (from, mid, mid2, to, stroke) => svg(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="64"><defs>
    <linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from[0]}"/><stop offset=".5" stop-color="${mid[0]}"/><stop offset=".52" stop-color="${mid2[0]}"/><stop offset="1" stop-color="${to[0]}"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from[1]}"/><stop offset=".5" stop-color="${mid[1]}"/><stop offset=".52" stop-color="${mid2[1]}"/><stop offset="1" stop-color="${to[1]}"/></linearGradient></defs>
    <rect x=".5" y=".5" width="419" height="31" rx="15.5" fill="url(#a)" stroke="${stroke[0]}"/><rect x=".5" y="32.5" width="419" height="31" rx="15.5" fill="url(#b)" stroke="${stroke[1]}"/></svg>`);
  const tabs = await pill(['#ffffff', '#5ab4ff'], ['#eef4fa', '#2d8ff0'], ['#dde8f3', '#1a74d8'], ['#f1f6fb', '#4aa6ff'], ['#a9bfd6', '#0f5cb5']);
  await art('tab-left.png', await sharp(tabs).extract({ left: 0, top: 0, width: 16, height: 64 }).png().toBuffer());
  await art('tab-right.png', await sharp(tabs).extract({ left: 16, top: 0, width: 404, height: 64 }).png().toBuffer());
  const green = await pill(['#a8e05f', '#b8ec6f'], ['#7cc423', '#8ad62f'], ['#62a80f', '#6fba15'], ['#86d02c', '#94de3a'], ['#4e8a0a', '#4e8a0a']);
  await art('go-left.png', await sharp(green).extract({ left: 0, top: 0, width: 16, height: 64 }).png().toBuffer());
  await art('go-right.png', await sharp(green).extract({ left: 16, top: 0, width: 404, height: 64 }).png().toBuffer());
  const sky = canvas(1, 260);
  sky.rect(0, 0, 1, 260, (x, y) => mix(hex('#bfe0fb'), hex('#ffffff'), y / 259));
  await art('header.png', await png(sky));
  const rss = await art('feed.png', await svg(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb35a"/><stop offset="1" stop-color="#e76a00"/></linearGradient></defs><rect x=".5" y=".5" width="27" height="27" rx="6" fill="url(#g)" stroke="#c45a00"/><circle cx="8" cy="20" r="2.6" fill="#fff"/><path d="M5.5 12.5a10 10 0 0 1 10 10" stroke="#fff" stroke-width="3.2" fill="none"/><path d="M5.5 6a16.5 16.5 0 0 1 16.5 16.5" stroke="#fff" stroke-width="3.2" fill="none"/></svg>`));
  await art('avatar.png', await svg(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#e8ecef"/><circle cx="24" cy="19" r="9" fill="#b9c2c9"/><path d="M8 48c1-11 7.5-16 16-16s15 5 16 16z" fill="#b9c2c9"/></svg>`));
  await art('close.png', await svg(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="13.5" fill="#222" stroke="#fff" stroke-width="2.5"/><path d="M10 10l10 10M20 10l-10 10" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`));
  // The spinner: twelve bars, one lit, turning.
  const spinnerFrames = [];
  for (let f = 0; f < 12; f++) {
    const c = canvas(24, 24, hex('#ffffff'));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, shade = mix(hex('#333333'), hex('#ffffff'), ((k - f + 12) % 12) / 12 * 0.85);
      for (let r = 5; r < 11; r += 0.5) c.set(12 + Math.cos(a) * r, 12 + Math.sin(a) * r, shade), c.set(12 + Math.cos(a) * r + 0.5, 12 + Math.sin(a) * r, shade);
    }
    spinnerFrames.push(c);
  }
  const spinner = await art('spinner.gif', await animatedGif(spinnerFrames, { delay: 80, colours: 16 }));

  // Photographs: square thumbnails, lightbox images, and the featured ones standing on a wet floor.
  const pictures = [];
  for (const photo of photos) {
    const thumb = await variant(photo, YEAR, 'photos/' + photo.id + '_sq.jpg', image => image.resize({ width: 150, height: 150, fit: 'cover' }).sharpen().jpeg({ quality: 80 }).toBuffer());
    const large = await variant(photo, YEAR, 'photos/' + photo.id + '_l.jpg', image => image.resize({ width: 800, height: 600, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer());
    const tags = TAGS.filter(([, test]) => test(photo)).map(([tag]) => tag);
    pictures.push({ photo, thumb, large, tags });
  }
  const featured = [];
  for (const item of pictures.filter(item => item.photo.featured).slice(0, 3)) {
    const bytes = await reflect(await sharp(ctxPath(root, item.photo.source)).rotate().resize({ width: 240, height: 180, fit: 'cover' }).png().toBuffer(), { fraction: 0.35, opacity: 0.35, background: { r: 255, g: 255, b: 255, alpha: 1 } });
    const name = 'photos/' + item.photo.id + '_floor.jpg';
    const jpeg = await sharp(bytes).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
    await output('eras/2007/' + name, jpeg);
    featured.push({ ...item, floor: { src: name, ...(await sharp(jpeg).metadata()) } });
  }

  const counts = {};
  for (const item of pictures) for (const tag of item.tags) counts[tag] = (counts[tag] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  const cloud = Object.keys(counts).sort().map(tag => `<a href="photos.html?tag=${tag}" class="t${Math.max(1, Math.round(counts[tag] / max * 5))}" title="${counts[tag]} photo${counts[tag] > 1 ? 's' : ''}">${tag}</a>`).join(' ');

  const ring = around(YEAR);
  const label = item => String(item.year);
  const head = (title, current, main, side, scripts = []) => `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html lang="en" xml:lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
${csp.replace('>', ' />')}
<meta name="robots" content="noindex" />
<title>${escape(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css" media="screen" />
<link rel="alternate" type="application/atom+xml" title="gerry zhao (Atom)" href="atom.xml" />
</head>
<body>
<div id="page">
<div id="header">
<a id="logo" href="index.html">${img('images/logo.png', logo, 'gerry zhao')}</a>${img('images/beta.png', beta, 'beta', ' id="beta"')}
<p id="tagline">photos, notes &amp; other stuff</p>
<ul id="nav">${[['index.html', 'Home'], ['photos.html', 'Photos'], ['notes.html', 'Notes'], ['/eras/', 'Other years']].map(([href, text]) => '<li' + (href === current ? ' class="current"' : '') + '><a href="' + href + '">' + text + '</a></li>').join('')}</ul>
<div id="search"><label for="q" class="hide">Search photos</label><input type="text" id="q" value="Search photos..." /> <button type="button" id="go">Search</button></div>
</div>
<div id="main">
${main}
</div>
<div id="side">
${side}
<div class="box"><h3>Subscribe</h3><p><a href="atom.xml" class="feed">${img('images/feed.png', rss, 'Feed')} Subscribe to new photos</a></p></div>
<div class="box"><h3>Time ring</h3><p><a href="${ring.previous.href}">&laquo; ${label(ring.previous)}</a> &middot; <a href="/eras/">all years</a> &middot; <a href="${ring.next.href}">${label(ring.next)} &raquo;</a></p></div>
</div>
<div id="footer"><p>&copy; ${new Date().getUTCFullYear()} Gerry Zhao &middot; <a href="https://mail.g3rry.com/">g3mail</a> &middot; <a href="/phantom/">The Phantom</a> &middot; <a href="/mountain/">The Ascent</a></p></div>
</div>
<script type="text/javascript" src="web2.js"></script>
${scripts.map(src => '<script type="text/javascript" src="' + src + '"></script>').join('\n')}
</body>
</html>
`;
  // Bookmarks, shared the 2007 way. Every name is a domain hack (a puzzle of /strata/); none of them is linked.
  const bookmarks = '<div class="box delicious"><h3>My del.icio.us</h3><ul class="bookmarks">' + ctx.puzzles.bookmarks.map(item => '<li><span class="bm-title">' + escape(item.title) + '</span> <cite>' + escape(item.domain) + '</cite><br /><span class="bm-meta">saved by ' + item.saves.toLocaleString('en-US') + ' ' + (item.saves === 1 ? 'person' : 'people') + ' &middot; ' + item.tags.map(escape).join(' ') + '</span></li>').join('') + '</ul></div>';
  const notesBox = `<div class="box"><h3>Latest notes</h3><div id="latest-notes" class="ajax">${img('images/spinner.gif', spinner, '', ' class="spinner"')} Loading&hellip;</div></div>`;
  const newest = [...pictures].sort((a, b) => b.photo.taken - a.photo.taken).slice(0, 5);
  await output('eras/2007/index.html', head('gerry zhao (beta)', 'index.html', `<div id="hero">
<h1>Chasing light.<br />Keeping moments.</h1>
<p class="lead">Photographs of rain, trains and bridges at dusk, ${photos.length} of them and counting. Tag them, browse them, leave a note.</p>
<p><a class="go" href="photos.html"><span>Browse the photos &raquo;</span></a></p>
</div>
<div class="box">
<h2>Featured</h2>
<ul class="featured">${featured.map(item => `<li><a href="${item.large.src}" class="lightbox" data-title="${escape(item.photo.place + ', ' + item.photo.city)}">${img(item.floor.src, item.floor, item.photo.alt)}</a><p>${escape(item.photo.place)}</p></li>`).join('')}</ul>
</div>
<div class="box">
<h2>Recently added</h2>
<ul class="recent">${newest.map(item => `<li>${img(item.thumb.src, { width: 48, height: 48 }, item.photo.alt)}<p><a href="${item.large.src}" class="lightbox" data-title="${escape(item.photo.place + ', ' + item.photo.city)}">${escape(item.photo.place)}</a><br /><span class="ago" data-time="${item.photo.taken.getTime()}">${item.photo.taken.toISOString().slice(0, 10)}</span> &middot; tagged ${item.tags.slice(0, 3).map(tag => '<a href="photos.html?tag=' + tag + '">' + tag + '</a>').join(', ')}</p></li>`).join('')}</ul>
</div>`, `<div class="box"><h3>Tags</h3><p class="cloud">${cloud}</p></div>
${notesBox}
${bookmarks}`, ['lightbox.js', 'notes.js']));

  await output('eras/2007/photos.html', head('Photos | gerry zhao (beta)', 'photos.html', `<div class="box">
<h2>Photos <span class="count">(${photos.length})</span></h2>
<p id="filter-note" class="hide"></p>
<ul class="grid">${pictures.map(item => `<li data-tags="${item.tags.join(' ')}" data-text="${escape((item.photo.place + ' ' + item.photo.city + ' ' + item.photo.alt).toLowerCase())}"><a href="${item.large.src}" class="lightbox" data-title="${escape(item.photo.place + ', ' + item.photo.city)}" data-exif="${escape(item.photo.meta.focal + 'mm · f/' + item.photo.meta.aperture + ' · ' + item.photo.meta.shutter + 's · ISO ' + item.photo.meta.iso)}">${img(item.thumb.src, item.thumb, item.photo.alt)}</a><p>${escape(item.photo.place)}</p></li>`).join('\n')}</ul>
</div>`, `<div class="box"><h3>Tags</h3><p class="cloud">${cloud}</p></div>`, ['filter.js', 'lightbox.js']));

  await output('eras/2007/notes.html', head('Notes | gerry zhao (beta)', 'notes.html', `<div class="box">
<h2>Notes</h2>
<p>Notes from people who stopped by. <a class="go small" href="/guestbook/"><span>Leave a note &raquo;</span></a></p>
<ol id="notes" class="ajax notes">${'<li class="loading">' + img('images/spinner.gif', spinner, '', ' class="spinner"') + ' Loading notes&hellip;</li>'}</ol>
</div>`, `<div class="box"><h3>About</h3><p>Every note is read before it appears. Write one on the current guestbook; it shows up here too.</p></div>`, ['notes.js']));

  const base = new URL('/eras/2007/', site.url).href;
  const sorted = [...pictures].sort((a, b) => b.photo.taken - a.photo.taken);
  await output('eras/2007/atom.xml', `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>gerry zhao: new photos</title>
<link href="${base}" />
<link rel="self" href="${base}atom.xml" />
<id>tag:g3rry.com,2007:photos</id>
<updated>${sorted[0].photo.taken.toISOString().slice(0, 19)}Z</updated>
<author><name>Gerry Zhao</name></author>
${sorted.map(({ photo, large, tags }) => `<entry>
<title>${escape(photo.place)}</title>
<link href="${base}${large.src}" />
<id>tag:g3rry.com,2007:${photo.id}</id>
<updated>${photo.taken.toISOString().slice(0, 19)}Z</updated>
${tags.map(tag => '<category term="' + tag + '" />').join('')}
<summary>${escape(photo.alt)}</summary>
</entry>`).join('\n')}
</feed>
`);
}

function ctxPath(root, source) { return root + '/' + source; }
