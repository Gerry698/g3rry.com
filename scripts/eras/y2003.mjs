// 2003: an intro you can skip, drawn on a canvas where Flash once was, in front of a photoblog in XHTML and CSS:
// a fixed 760-pixel layout, sliding-door tabs, nine-pixel Verdana, pixel-type headings, an RSS feed.
import sharp from 'sharp';
import { canvas, drawText, textWidth, gif, hex, mix, GLYPHS } from './pixels.mjs';

const YEAR = 2003;
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORANGE = '#FF6600', DARK = '#222222';

async function pixelHeading(text, colour = '#333333') {
  const c = canvas(textWidth(text, 1, 1) + 2, 9);
  drawText(c, text, 1, 1, 1, hex(colour));
  return gif(c, { colours: 4 });
}
async function logo() {
  const c = canvas(300, 50);
  drawText(c, 'GERRY ZHAO', 2, 8, 4, hex('#FFFFFF'));
  c.rect(2, 40, 18, 3, hex(ORANGE));
  drawText(c, 'PHOTOGRAPHS / NOTES / EXPERIMENTS', 24, 38, 1, hex('#999999'));
  return gif(c, { colours: 8 });
}
// Sliding doors: one tall image per side, the top half for the resting tab and the bottom half for the current one.
async function tabSide(side) {
  const w = side === 'left' ? 9 : 400, h = 60, c = canvas(w, h);
  for (const [top, from, to] of [[0, '#555555', '#3a3a3a'], [30, ORANGE, '#cc5200']]) {
    c.rect(0, top, w, 30, (x, y) => mix(hex(from), hex(to), (y - top) / 29));
    c.rect(0, top, w, 1, mix(hex(from), [255, 255, 255, 255], 0.35));
    if (side === 'left') { c.rect(0, top, 1, 30, [0, 0, 0, 255]); c.set(0, top, [0, 0, 0, 0]); c.set(1, top, [0, 0, 0, 0]); c.set(0, top + 1, [0, 0, 0, 0]); }
    else { c.rect(w - 1, top, 1, 30, [0, 0, 0, 255]); c.set(w - 1, top, [0, 0, 0, 0]); c.set(w - 2, top, [0, 0, 0, 0]); c.set(w - 1, top + 1, [0, 0, 0, 0]); }
  }
  return gif(c, { colours: 64 });
}
async function stripes() {
  const c = canvas(4, 4, hex('#3a3a3a'));
  for (let i = 0; i < 4; i++) c.set(i, 3 - i, hex('#333333'));
  return gif(c, { colours: 4 });
}
// The little 80 × 15 buttons that filled every sidebar.
async function badge(left, right, colour) {
  const c = canvas(80, 15, hex('#666666'));
  c.rect(1, 1, 78, 13, hex('#FFFFFF'));
  const split = textWidth(left) + 6;
  c.rect(2, 2, split, 11, hex(colour));
  drawText(c, left, 5, 4, 1, hex('#FFFFFF'));
  drawText(c, right, split + 5, 4, 1, hex('#333333'));
  return gif(c, { colours: 16 });
}

export default async function build(ctx, era) {
  const { output, escape, csp, photos, site, around, variant } = ctx;
  const art = async (name, bytes) => { await output('eras/2003/images/' + name, bytes); return sharp(bytes).metadata(); };
  const img = (src, meta, alt, extra = '') => `<img src="${src}" width="${meta.width}" height="${meta.pageHeight || meta.height}" alt="${escape(alt)}"${extra} />`;

  const logoMeta = await art('logo.gif', await logo());
  await art('tab-left.gif', await tabSide('left'));
  await art('tab-right.gif', await tabSide('right'));
  await art('stripes.gif', await stripes());
  await art('bullet.gif', await gif(canvas(4, 4, hex(ORANGE)), { colours: 2 }));
  const headings = {};
  for (const [key, text] of [['about', 'ABOUT'], ['archives', 'ARCHIVES'], ['elsewhere', 'ELSEWHERE'], ['ring', 'TIME RING'], ['syndicate', 'SYNDICATE'], ['blogroll', 'BLOGROLL'], ['latest', 'LATEST PHOTOGRAPHS'], ['gallery', 'GALLERY'], ['comments', 'COMMENTS']]) {
    headings[key] = await art('h-' + key + '.gif', await pixelHeading(text, key === 'latest' || key === 'gallery' || key === 'comments' ? ORANGE : '#333333'));
  }
  const badges = [['b-xhtml.gif', await art('b-xhtml.gif', await badge('W3C', 'XHTML 1.0', '#336699')), 'XHTML 1.0'],
    ['b-css.gif', await art('b-css.gif', await badge('W3C', 'CSS 2', '#336699')), 'CSS 2'],
    ['b-rss.gif', await art('b-rss.gif', await badge('XML', 'RSS 2.0', ORANGE)), 'RSS 2.0']];
  // The intro draws its type with the same 5 × 7 font as the images.
  const used = [...new Set('GERRY ZHAO CHASING LIGHT. KEEPING MOMENTS. LOADING 0123456789% SKIP INTRO ENTER > SOUND ON OFF'.split(''))];
  await output('eras/2003/pixelfont.js', '// A 5 x 7 pixel font, for the intro, and the touch of each keystroke as the line types itself.\nvar PIXELFONT = ' + JSON.stringify(Object.fromEntries(used.map(ch => [ch, GLYPHS[ch]]))) + ';\nvar TYPING = ' + JSON.stringify(ctx.puzzles.rhythm) + ';\n');

  const pictures = [];
  for (const photo of photos) {
    const big = await variant(photo, YEAR, 'photos/' + photo.frame + '.jpg', image => image.resize({ width: 460, height: 400, fit: 'inside' }).jpeg({ quality: 72 }).toBuffer());
    const post = await variant(photo, YEAR, 'photos/' + photo.frame + '-post.jpg', image => image.resize({ width: 440, height: 440, fit: 'inside' }).jpeg({ quality: 72 }).toBuffer());
    const thumb = await variant(photo, YEAR, 'photos/' + photo.frame + '-sq.jpg', image => image.resize({ width: 56, height: 56, fit: 'cover' }).sharpen().jpeg({ quality: 70 }).toBuffer());
    pictures.push({ photo, big, post, thumb });
  }

  const ring = around(YEAR);
  const label = item => String(item.year);
  const head = (title, extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xml:lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
${csp.replace('>', ' />')}
<meta name="robots" content="noindex" />
<title>${escape(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css" />
<link rel="alternate stylesheet" type="text/css" href="zen.css" title="Zen" />
<link rel="alternate" type="application/rss+xml" title="RSS 2.0" href="index.xml" />
${extra}</head>
`;
  const tabs = current => '<ul id="tabs">' + [['home.html', 'Home'], ['photos.html', 'Gallery'], ['guestbook.html', 'Comments'], ['/eras/', 'Other years']]
    .map(([href, text]) => '<li' + (href === current ? ' class="current"' : '') + '><a href="' + href + '">' + text + '</a></li>').join('') + '</ul>';
  const monthsUsed = [];
  for (const { photo } of [...pictures].sort((a, b) => b.photo.taken - a.photo.taken)) {
    const key = months[photo.taken.getUTCMonth()] + ' ' + photo.taken.getUTCFullYear();
    const entry = monthsUsed.find(item => item.key === key);
    if (entry) entry.count++; else monthsUsed.push({ key, count: 1 });
  }
  const sidebar = `<div id="sidebar">
<h3>${img('images/h-about.gif', headings.about, 'About')}</h3>
<p>Photographs of light by Gerry Zhao: long exposures, rain, bridges at dusk. Shot on two zooms and, lately, a very long one.</p>
<h3>${img('images/h-archives.gif', headings.archives, 'Archives')}</h3>
<ul>${monthsUsed.map(item => '<li><a href="photos.html">' + item.key + '</a> (' + item.count + ')</li>').join('')}</ul>
<h3>${img('images/h-elsewhere.gif', headings.elsewhere, 'Elsewhere')}</h3>
<ul><li><a href="https://mail.g3rry.com/">g3mail</a>: free mail</li><li><a href="/phantom/">The Phantom</a></li><li><a href="/mountain/">The Ascent</a></li></ul>
<h3>${img('images/h-ring.gif', headings.ring, 'Time ring')}</h3>
<p><a href="${ring.previous.href}">&laquo; ${label(ring.previous)}</a> &middot; <a href="/eras/">all</a> &middot; <a href="${ring.next.href}">${label(ring.next)} &raquo;</a></p>
<h3>${img('images/h-blogroll.gif', headings.blogroll, 'Blogroll')}</h3>
<ul id="blogroll">${ctx.puzzles.blogroll.map((name, i) => '<li id="blog' + String(i + 1).padStart(2, '0') + '">' + escape(name) + '</li>').join('')}</ul>
<p class="rot">(The links rotted years ago.)</p>
<h3>${img('images/h-syndicate.gif', headings.syndicate, 'Syndicate')}</h3>
<p><a href="index.xml">RSS 2.0</a> feed of new photographs.</p>
<p class="badges">${badges.map(([name, meta, alt]) => img('images/' + name, meta, alt)).join(' ')}</p>
</div>`;
  const zenIds = ctx.puzzles.zen.map(name => '#blog' + String(ctx.puzzles.blogroll.indexOf(name) + 1).padStart(2, '0'));
  await output('eras/2003/zen.css', `/* gerry zhao :: zen
   an alternate style for the same markup (View > Page Style > Zen). less orange, more air. */
body { background: #f4f1ea; color: #555; font-family: Georgia, "Times New Roman", serif; }
#container { background: #fbfaf6; border: 0; }
#header, #tabs { background: none; border: 0; }
#header img, #tabs, .badges, #sidebar h3 img { opacity: 0.35; }
#content { font-size: 13px; line-height: 1.9; }
#sidebar { color: #888; }
#blogroll { position: relative; height: ${zenIds.length * 2}em; }
#blogroll li { display: none; }
${zenIds.map((id, i) => id + ' { display: block; position: absolute; left: 0; top: ' + i * 2 + 'em; }').join('\n')}
#blogroll li:first-letter { font-size: 18px; color: #222; }
.rot { display: none; }
`);
  const page = (title, current, main, scripts = []) => head(title + ' :: gerry zhao') + `<body>
<div id="container">
<div id="header"><a href="home.html">${img('images/logo.gif', logoMeta, 'Gerry Zhao')}</a></div>
${tabs(current)}
<div id="content">
${main}
</div>
${sidebar}
<div id="footer">&copy; ${new Date().getUTCFullYear()} Gerry Zhao &middot; best viewed at 1024x768 &middot; <a href="index.html">replay intro</a></div>
</div>
${scripts.map(src => '<script type="text/javascript" src="' + src + '"></script>').join('\n')}
</body>
</html>
`;

  // Intro.
  await output('eras/2003/index.html', head('gerry zhao :: intro') + `<body class="intro">
<div id="stage-wrap">
<canvas id="stage" width="760" height="420" data-preload="${pictures.map(item => item.post.src).join(',')},images/logo.gif,images/tab-left.gif,images/tab-right.gif">Your browser cannot show the intro. <a href="home.html">Enter the site</a>.</canvas>
<p id="intro-links"><a href="home.html" id="skip">SKIP INTRO</a> <a href="#" id="sound">SOUND: OFF</a></p>
<p id="intro-note">Once this needed Flash Player 6. Now any browser draws it.</p>
</div>
<script type="text/javascript" src="pixelfont.js"></script>
<script type="text/javascript" src="intro.js"></script>
</body>
</html>
`);

  // Home: a photoblog, newest first.
  const posts = [...pictures].sort((a, b) => b.photo.taken - a.photo.taken).map(({ photo, post }) => {
    const t = photo.taken, hh = t.getUTCHours(), time = ((hh + 11) % 12 + 1) + ':' + String(t.getUTCMinutes()).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM');
    return { key: days[t.getUTCDay()] + ', ' + months[t.getUTCMonth()] + ' ' + t.getUTCDate() + ', ' + t.getUTCFullYear(), html: `<div class="post" id="f${photo.frame}">
<h4>${escape(photo.place)}</h4>
<p class="photo"><a href="photos.html#f${photo.frame}">${img(post.src, post, photo.alt)}</a></p>
<p>${escape(photo.alt)}</p>
<p class="posted">Posted by Gerry at ${time} | <a href="photos.html#f${photo.frame}">Permalink</a> | ${photo.meta.focal}mm f/${photo.meta.aperture} ${escape(photo.meta.shutter)}s ISO ${photo.meta.iso}</p>
</div>` };
  });
  const grouped = [];
  for (const item of posts) { const last = grouped.at(-1); if (last && last.key === item.key) last.items.push(item.html); else grouped.push({ key: item.key, items: [item.html] }); }
  await output('eras/2003/home.html', page('home', 'home.html', `<h2>${img('images/h-latest.gif', headings.latest, 'Latest photographs')}</h2>
${grouped.map(day => '<h3 class="date">' + day.key + '</h3>\n' + day.items.join('\n')).join('\n')}`));

  // Gallery: a slideshow with a filmstrip.
  const first = pictures[0];
  await output('eras/2003/photos.html', page('gallery', 'photos.html', `<h2>${img('images/h-gallery.gif', headings.gallery, 'Gallery')}</h2>
<div id="viewer">
<div id="frame">${img(first.big.src, first.big, first.photo.alt, ' id="slide"')}</div>
<p id="caption"><strong>#${first.photo.frame} ${escape(first.photo.place)}</strong> &middot; ${escape(first.photo.alt)}</p>
<p id="controls"><a href="#" id="prev">&laquo; prev</a> <a href="#" id="play">play slideshow</a> <a href="#" id="next">next &raquo;</a></p>
</div>
<ul id="filmstrip">
${pictures.map(({ photo, big, thumb }) => `<li><a href="${big.src}" id="f${photo.frame}" data-width="${big.width}" data-height="${big.height}" data-title="#${photo.frame} ${escape(photo.place)}" data-alt="${escape(photo.alt)}">${img(thumb.src, thumb, photo.alt)}</a></li>`).join('\n')}
</ul>`, ['slideshow.js']));

  await output('eras/2003/guestbook.html', page('comments', 'guestbook.html', `<h2>${img('images/h-comments.gif', headings.comments, 'Comments')}</h2>
<p>What visitors have left behind. <a href="/guestbook/">Post a comment</a> (on the current site).</p>
<div id="comments"><p class="loading">Loading comments&hellip;</p></div>`, ['comments.js']));

  // A real feed, as every photoblog had.
  const rfc822 = d => days[d.getUTCDay()].slice(0, 3) + ', ' + String(d.getUTCDate()).padStart(2, '0') + ' ' + months[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCFullYear() + ' ' + d.toISOString().slice(11, 19) + ' GMT';
  const base = new URL('/eras/2003/', site.url).href;
  await output('eras/2003/index.xml', `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
<channel>
<title>gerry zhao :: photographs</title>
<link>${base}home.html</link>
<description>Photographs of light by Gerry Zhao.</description>
<language>en-us</language>
${[...pictures].sort((a, b) => b.photo.taken - a.photo.taken).map(({ photo, post }) => `<item>
<title>${escape(photo.place)}</title>
<link>${base}photos.html#f${photo.frame}</link>
<guid isPermaLink="false">g3rry-2003-${photo.id}</guid>
<pubDate>${rfc822(photo.taken)}</pubDate>
<description>${escape('<img src="' + base + post.src + '" width="' + post.width + '" height="' + post.height + '" alt="' + escape(photo.alt) + '" /><br />' + escape(photo.alt))}</description>
</item>`).join('\n')}
</channel>
</rss>
`);
}
