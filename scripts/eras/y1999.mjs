// 1999: a splash page, then a frameset. A fixed menu of image buttons that swap on mouse-over, content in
// web-safe colours on nested tables held in shape by spacer GIFs, a photo of the week, a page per photograph.
import sharp from 'sharp';
import { canvas, drawText, gif, animatedGif, hex, mix, paint, blur, bevel, lit, flare } from './pixels.mjs';
import { fonts, face, FACES, markup } from './fonts.mjs';

const YEAR = 1999;
const UPDATED = '11/28/1999';
const date = d => [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCFullYear()].map((n, i) => i < 2 ? String(n).padStart(2, '0') : String(n)).join('/');
// An exposure the way it went into a notebook: "70mm, 1/1000 at f/2.8", "104mm, 20 sec at f/32".
const exposure = meta => meta.focal + 'mm, ' + (/^\d+(\.\d+)?$/.test(meta.shutter) ? meta.shutter + ' sec' : meta.shutter) + ' at f/' + meta.aperture;
const SAFE = { navy: '#003366', blue: '#336699', sky: '#6699CC', pale: '#CCCCCC', light: '#EEEEEE', white: '#FFFFFF', black: '#000000', orange: '#FF9900' };

// ---- Art ------------------------------------------------------------------------------------------------------
// Photoshop 5 had just added layer effects, and everything got them: Bevel and Emboss, Drop Shadow, a lens flare.

// A raised plate: a gradient, lit along the top and left, dark along the bottom and right.
function plate(c, w, h, from, to) {
  c.rect(0, 0, w, h, (x, y) => mix(hex(from), hex(to), y / (h - 1)));
  c.rect(0, 0, w, 1, mix(hex(from), [255, 255, 255, 255], 0.55)); c.rect(0, 0, 1, h, mix(hex(from), [255, 255, 255, 255], 0.55));
  c.rect(1, 1, w - 2, 1, mix(hex(from), [255, 255, 255, 255], 0.22)); c.rect(1, 1, 1, h - 2, mix(hex(from), [255, 255, 255, 255], 0.22));
  c.rect(1, h - 2, w - 2, 1, mix(hex(to), [0, 0, 0, 255], 0.35)); c.rect(w - 2, 1, 1, h - 2, mix(hex(to), [0, 0, 0, 255], 0.35));
  c.rect(0, h - 1, w, 1, [0, 0, 0, 255]); c.rect(w - 1, 0, 1, h, [0, 0, 0, 255]);
}
// A round bullet with a highlight, grey at rest and glowing orange under the pointer.
function bullet(c, x, y, glow) {
  const centre = glow ? hex('#FFCC66') : hex('#DDDDDD'), rim = glow ? hex('#CC6600') : hex('#667788');
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const d = Math.hypot(i - 3.5, j - 3.5);
    if (d > 4) continue;
    const t = Math.min(1, Math.hypot(i - 2.6, j - 2.6) / 4.6);
    c.set(x + i, y + j, [...mix(centre, rim, t).slice(0, 3), d > 3.4 ? Math.round(255 * (4 - d) / 0.6) : 255]);
  }
}
// A label in bold Verdana with a one-pixel drop shadow.
async function label(type, c, text, x, y, colour, size = 11) {
  const ink = await type.coverage('<span foreground="#ffffff" letter_spacing="600">' + markup(text) + '</span>', face(FACES.verdanaBold, size));
  const top = y === null ? Math.round((c.height - ink.height) / 2) : y;
  paint(c, ink, x + 1, top + 1, [0, 0, 0, 255], 0.55);
  paint(c, ink, x, top, colour);
  return ink;
}
async function menuButton(type, text, on) {
  const w = 150, h = 26, c = canvas(w, h);
  plate(c, w, h, on ? SAFE.sky : SAFE.blue, on ? SAFE.blue : SAFE.navy);
  bullet(c, 10, 9, on);
  await label(type, c, text, 26, null, on ? hex(SAFE.white) : hex(SAFE.pale));
  return gif(c, { colours: 96 });
}
async function smallButton(type, text, on) {
  const ink = await type.coverage('<span foreground="#ffffff" letter_spacing="600">' + markup(text) + '</span>', face(FACES.verdanaBold, 10));
  const w = ink.width + 22, h = 19, c = canvas(w, h);
  plate(c, w, h, on ? SAFE.orange : SAFE.blue, on ? '#CC6600' : SAFE.navy);
  await label(type, c, text, 11, null, hex(SAFE.white), 10);
  return gif(c, { colours: 64 });
}
async function banner(type) {
  const w = 468, h = 60, c = canvas(w, h);
  c.rect(0, 0, w, h, (x, y) => mix(hex(SAFE.navy), hex(SAFE.blue), x / w * 0.7 + y / h * 0.3));
  for (let x = 0; x < w; x += 4) c.rect(x, 0, 1, h, [255, 255, 255, 18]);
  const ink = await type.coverage('<span foreground="#ffffff">GERRY ZHAO ONLINE</span>', face(FACES.arialBlack, 27));
  const x = Math.round((w - ink.width) / 2), y = 7;
  const soft = blur(ink, 2);
  paint(c, soft, x + 3 - soft.offset, y + 3 - soft.offset, [0, 0, 0, 255], 0.8);
  const shade = bevel(ink, 3, 5), white = hex(SAFE.white), pale = hex('#B8C8DC');
  paint(c, ink, x, y, (i, j) => lit(mix(white, pale, j / (ink.height - 1)), shade[j * ink.width + i], 0.9, 0.55));
  const sub = await type.coverage('<span foreground="#ffffff" letter_spacing="3500">PHOTOGRAPHY · LIGHT · NOTES</span>', face(FACES.verdanaBold, 9));
  paint(c, sub, Math.round((w - sub.width) / 2) + 1, 44, [0, 0, 0, 255], 0.5);
  paint(c, sub, Math.round((w - sub.width) / 2), 43, hex(SAFE.orange));
  return gif(c, { colours: 128 });
}
// The splash logo in chrome: sky above the horizon, dark ground below it, a bevel, and a lens flare on the corner.
async function splashLogo(type) {
  const w = 360, h = 120, c = canvas(w, h, hex(SAFE.black));
  const ink = await type.coverage('<span foreground="#ffffff">G3RRY.COM</span>', face(FACES.arialBlack, 46));
  const x = Math.round((w - ink.width) / 2), y = 26;
  const glow = blur(ink, 3);
  paint(c, glow, x - glow.offset, y - glow.offset, hex('#1F4F8F'), 0.9);
  const shade = bevel(ink, 3, 6);
  const chrome = t => t < 0.5 ? mix(hex('#F4FAFF'), hex('#6F8FB8'), t / 0.5) : t < 0.56 ? mix(hex('#141820'), hex('#3A3328'), (t - 0.5) / 0.06) : mix(hex('#3A3328'), hex('#EDE3CC'), (t - 0.56) / 0.44);
  paint(c, ink, x, y, (i, j) => lit(chrome(j / (ink.height - 1)), shade[j * ink.width + i], 0.85, 0.5));
  flare(c, x + ink.width - 30, y + 3, 5, [w * 0.25, h * 0.75]);
  const sub = await type.coverage('<span foreground="#ffffff" letter_spacing="6000">EST. 1999</span>', face(FACES.verdana, 10));
  paint(c, sub, Math.round((w - sub.width) / 2), 90, hex('#999999'));
  return gif(c, { colours: 128 });
}
// A small logo for the top of the menu: a wireframe globe turning, the World Wide Web in twelve frames.
async function globe() {
  const frames = [], r = 15, cx = 19.5, cy = 19.5, line = hex(SAFE.sky), bright = hex('#CCEEFF'), rim = hex('#99CCFF');
  for (let f = 0; f < 12; f++) {
    const c = canvas(40, 40, hex(SAFE.navy));
    for (let a = 0; a < 360; a += 1.5) { const t = a * Math.PI / 180; c.set(cx + Math.cos(t) * r, cy + Math.sin(t) * r, rim); }
    for (const lat of [-60, -30, 0, 30, 60]) {
      const p = lat * Math.PI / 180, half = Math.cos(p) * r, y = cy - Math.sin(p) * r;
      for (let x = -half; x <= half; x += 0.5) c.set(cx + x, y, lat === 0 ? bright : line);
    }
    for (let k = 0; k < 12; k++) {
      const lon = (k * 30 + f * 2.5) * Math.PI / 180;
      for (let lat = -90; lat <= 90; lat += 2) {
        const p = lat * Math.PI / 180, x = Math.sin(lon) * Math.cos(p) * r;
        if (Math.cos(lon) < 0) continue;
        c.set(cx + x, cy - Math.sin(p) * r, line);
      }
    }
    frames.push(c);
  }
  return animatedGif(frames, { delay: 100, colours: 8 });
}
async function lcd(n) {
  const c = canvas(13, 19, hex('#102010'));
  drawText(c, '8', 1, 2, 2, hex('#1c3a1c'));
  drawText(c, String(n), 1, 2, 2, hex('#66FF66'));
  return gif(c, { colours: 4 });
}
const spacer = () => gif(canvas(1, 1), { colours: 2 });

// ---- Pages ----------------------------------------------------------------------------------------------------

export default async function build(ctx, era) {
  const { output, ascii, csp, photos, site, around, variant } = ctx;
  const type = fonts(ctx.root);
  const art = async (name, bytes) => { await output('eras/1999/images/' + name, bytes); return sharp(bytes).metadata(); };
  const img = (src, meta, alt, extra = '') => `<IMG SRC="${src}" WIDTH="${meta.width}" HEIGHT="${meta.pageHeight || meta.height}" ALT="${ascii(alt)}" BORDER="0"${extra}>`;

  await art('spacer.gif', await spacer());
  const sp = (w, h) => `<IMG SRC="images/spacer.gif" WIDTH="${w}" HEIGHT="${h}" ALT="">`;
  const logo = await art('logo.gif', await splashLogo(type));
  const enter = [await art('enter.gif', await smallButton(type, 'ENTER SITE', false)), await art('enter-on.gif', await smallButton(type, 'ENTER SITE', true))];
  const bannerMeta = await art('banner.gif', await banner(type));
  const spin = await art('spin.gif', await globe());
  const menu = [['home', 'HOME', 'home.html'], ['photos', 'PHOTOS', 'photos.html'], ['guestbook', 'GUESTBOOK', 'guestbook.html'], ['email', 'E-MAIL ME', 'mailto:' + site.guestbook.contact]];
  const menuMeta = {};
  for (const [id, text] of menu) { menuMeta[id] = await art('b-' + id + '.gif', await menuButton(type, text, false)); await art('b-' + id + '-on.gif', await menuButton(type, text, true)); }
  const arrows = {};
  for (const [id, text] of [['prev', '« PREV'], ['next', 'NEXT »'], ['back', 'GALLERY']]) { arrows[id] = await art('a-' + id + '.gif', await smallButton(type, text, false)); await art('a-' + id + '-on.gif', await smallButton(type, text, true)); }
  for (let n = 0; n < 10; n++) await art('c' + n + '.gif', await lcd(n));

  const pictures = [];
  for (const photo of photos) {
    const big = await variant(photo, YEAR, 'photos/' + photo.id + '.jpg', image => image.resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 62 }).toBuffer());
    const thumb = await variant(photo, YEAR, 'photos/' + photo.id + '_th.jpg', image => image.resize({ width: 100, height: 100, fit: 'inside' }).sharpen().jpeg({ quality: 60 }).toBuffer());
    const medium = await variant(photo, YEAR, 'photos/' + photo.id + '_md.jpg', image => image.resize({ width: 200, height: 200, fit: 'inside' }).jpeg({ quality: 60 }).toBuffer());
    pictures.push({ photo, big, thumb, medium, page: 'photo-' + photo.frame + '.html' });
  }

  const ring = around(YEAR);
  const label = item => String(item.year);
  const doc = (title, body, { doctype = 'transitional', bodyAttrs = 'BGCOLOR="#FFFFFF" TEXT="#000000" LINK="#003366" VLINK="#336699" ALINK="#FF9900" LEFTMARGIN="0" TOPMARGIN="0" MARGINWIDTH="0" MARGINHEIGHT="0"', scripts = ['scripts.js'] } = {}) => `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 ${doctype === 'frameset' ? 'Frameset' : 'Transitional'}//EN">
<HTML lang="en">
<HEAD>
<!-- 2026: a Content-Security-Policy, which no server or page had in 1999. -->
${csp}
<META NAME="robots" CONTENT="noindex">
<META NAME="description" CONTENT="Gerry Zhao Online: photography, light and notes.">
<META NAME="keywords" CONTENT="Gerry Zhao, photography, photo gallery, New York, San Francisco, night photography, guestbook">
<META NAME="generator" CONTENT="Notepad and a lot of patience">
<TITLE>${ascii(title)}</TITLE>
</HEAD>
${doctype === 'frameset' ? body : '<BODY ' + bodyAttrs + '>\n' + body + '\n' + scripts.map(src => '<SCRIPT SRC="' + src + '"></SCRIPT>').join('\n') + '\n</BODY>'}
</HTML>
`;
  const font = (text, size = 2, extra = '') => `<FONT FACE="Verdana,Arial,Helvetica" SIZE="${size}"${extra}>${text}</FONT>`;
  const heading = text => `<TABLE WIDTH="100%" BORDER="0" CELLPADDING="4" CELLSPACING="0"><TR><TD BGCOLOR="${SAFE.navy}">${font('<B>' + text + '</B>', 2, ' COLOR="#FFFFFF"')}</TD></TR></TABLE>`;
  // The speeds are written in by /eras/modem-client.js, from the one list it keeps for every page.
  const modem = `<P ALIGN="CENTER">${font('<SPAN data-modem-links="1999"></SPAN><A HREF="/eras/dialup.html?to=1999" TARGET="_top">Dial up again</A>', 1, ' COLOR="#666666"')}</P>`;
  const footer = `<P ALIGN="CENTER">${font('&copy; ' + YEAR + '&ndash;' + new Date().getUTCFullYear() + ' Gerry Zhao. All rights reserved.<BR>Best viewed at 800x600 in High Color with a frames-capable browser.', 1, ' COLOR="#666666"')}</P>
${modem}
<SCRIPT SRC="/eras/modem-client.js"></SCRIPT>`;
  // Every content page is a fixed 560-pixel table inside the main frame.
  // The banner of the home frame is an image map. Strata (hotspots): see the private solution book.
  const scale = 6, letterWidth = 6 * scale, mapLeft = Math.round((bannerMeta.width - ctx.puzzles.map.length * letterWidth + scale) / 2), mapTop = 9;
  const areas = ctx.puzzles.map.flatMap((rows, n) => rows.flatMap((mask, j) => {
    const runs = [];
    for (let i = 0; i < 5; i++) if (mask & (16 >> i)) { const last = runs.at(-1); if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]); }
    return runs.map(([a, b]) => [mapLeft + n * letterWidth + a * scale, mapTop + j * scale, mapLeft + n * letterWidth + (b + 1) * scale - 1, mapTop + (j + 1) * scale - 1]);
  }));
  const bannerMap = '<MAP NAME="banner">\n' + areas.map(r => '<AREA SHAPE="RECT" COORDS="' + r.join(',') + '" HREF="home.html" ALT="" TABINDEX="-1">').join('\n') + '\n</MAP>';
  const page = (title, inner, scripts, { map = false } = {}) => doc(title, `<TABLE WIDTH="560" BORDER="0" CELLPADDING="0" CELLSPACING="0">
<TR><TD>${sp(560, 12)}</TD></TR>
<TR><TD ALIGN="CENTER">${img('images/banner.gif', bannerMeta, 'Gerry Zhao Online', map ? ' USEMAP="#banner"' : '')}${map ? '\n' + bannerMap : ''}</TD></TR>
<TR><TD>${sp(560, 12)}</TD></TR>
<TR><TD>
${inner}
</TD></TR>
<TR><TD>${sp(560, 16)}</TD></TR>
<TR><TD>${footer}</TD></TR>
</TABLE>`, { scripts });

  // Splash, frameset, menu.
  await output('eras/1999/index.html', doc('Gerry Zhao Online', `<CENTER>
${sp(1, 120)}<BR>
${img('images/logo.gif', logo, 'g3rry.com')}<BR>
${sp(1, 24)}<BR>
<A HREF="frames.html" ID="enter-link">${img('images/enter.gif', enter[0], 'Enter site', ' NAME="enter" ID="enter" data-over="images/enter-on.gif"')}</A><BR>
${sp(1, 30)}<BR>
${font('This site uses frames and JavaScript.<BR>Best viewed at 800x600 or higher.', 1, ' COLOR="#999999"')}<BR>
${sp(1, 16)}<BR>
${font('<A HREF="home.html">No frames? Click here.</A>', 1, ' COLOR="#999999"')}
</CENTER>
<SCRIPT SRC="/eras/modem-client.js"></SCRIPT>`, { bodyAttrs: 'BGCOLOR="#000000" TEXT="#CCCCCC" LINK="#6699CC" VLINK="#6699CC" ALINK="#FF9900"' }));

  await output('eras/1999/frames.html', doc('Gerry Zhao Online', `<FRAMESET COLS="170,*" FRAMEBORDER="0" BORDER="0" FRAMESPACING="0">
  <FRAME SRC="menu.html" NAME="menu" SCROLLING="no" NORESIZE MARGINWIDTH="0" MARGINHEIGHT="0">
  <FRAME SRC="home.html" NAME="main" MARGINWIDTH="10" MARGINHEIGHT="0">
  <NOFRAMES>
  <BODY><P>This site uses frames, but your browser does not support them. <A HREF="home.html">Go to the home page.</A></P></BODY>
  </NOFRAMES>
</FRAMESET>`, { doctype: 'frameset' }));

  const menuRows = menu.map(([id, text, href]) => `<TR><TD ALIGN="CENTER"><A HREF="${href}"${href.startsWith('mailto:') ? '' : ' TARGET="main"'}>${img('images/b-' + id + '.gif', menuMeta[id], text, ' NAME="' + id + '" data-over="images/b-' + id + '-on.gif"')}</A></TD></TR>`).join('\n');
  await output('eras/1999/menu.html', doc('Menu', `<TABLE WIDTH="170" BORDER="0" CELLPADDING="0" CELLSPACING="0">
<TR><TD>${sp(170, 16)}</TD></TR>
<TR><TD ALIGN="CENTER">${img('images/spin.gif', spin, 'g3rry.com')}</TD></TR>
<TR><TD>${sp(170, 16)}</TD></TR>
${menuRows}
<TR><TD>${sp(170, 24)}</TD></TR>
<TR><TD ALIGN="CENTER">${font('<B>TIME RING</B><BR><A HREF="' + ring.previous.href + '" TARGET="_top">&laquo; ' + label(ring.previous) + '</A> | <A HREF="/eras/" TARGET="_top">All</A> | <A HREF="' + ring.next.href + '" TARGET="_top">' + label(ring.next) + ' &raquo;</A>', 1, ' COLOR="#CCCCCC"')}</TD></TR>
<TR><TD>${sp(170, 24)}</TD></TR>
<TR><TD ALIGN="CENTER">${font('Last updated<BR>' + UPDATED, 1, ' COLOR="#6699CC"')}</TD></TR>
</TABLE>`, { bodyAttrs: 'BGCOLOR="#003366" TEXT="#CCCCCC" LINK="#FFFFFF" VLINK="#FFFFFF" ALINK="#FF9900" LEFTMARGIN="0" TOPMARGIN="0" MARGINWIDTH="0" MARGINHEIGHT="0"' }));

  // Home.
  const featured = pictures.find(item => item.photo.featured) || pictures[0];
  const newest = [...pictures].sort((a, b) => b.photo.taken - a.photo.taken);
  const updates = newest.slice(0, 5).map(item => `<TR><TD VALIGN="TOP" WIDTH="80">${font('<B>' + date(item.photo.taken) + '</B>', 1)}</TD><TD>${font('Added <A HREF="' + item.page + '">#' + item.photo.frame + ' ' + ascii(item.photo.place) + '</A>', 1)}</TD></TR>`).join('\n');
  await output('eras/1999/photos.js', '// Photo of the week: one of these is shown on the home page, a different one each week.\nvar photos = new Array(\n'
    + pictures.map(item => '  new Array("' + item.medium.src + '", ' + item.medium.width + ', ' + item.medium.height + ', "' + item.page + '", "#' + item.photo.frame + ' ' + item.photo.place.replace(/"/g, '') + '")').join(',\n') + '\n);\n');
  const home = page('Gerry Zhao Online - Home', `<TABLE WIDTH="560" BORDER="0" CELLPADDING="0" CELLSPACING="0">
<TR>
<TD WIDTH="340" VALIGN="TOP">
${heading('WELCOME!')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD>${font(`Welcome to <B>Gerry Zhao Online</B>, my home on the Web. I photograph light: subway trains in long exposures, Times Square in the rain, the Golden Gate after sunset.<BR><BR>
There are <B>${photos.length} photographs</B> in the <A HREF="photos.html">gallery</A>, each with its own page. Please take a moment to <A HREF="guestbook.html">read the guestbook</A> and <A HREF="/guestbook/" TARGET="_top">sign it</A>.`)}</TD></TR></TABLE>
${sp(1, 10)}
${heading('LATEST UPDATES')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="4" CELLSPACING="0">
${updates}
</TABLE>
${sp(1, 10)}
${heading('Y2K WATCH')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD>${font('Days until the year 2000: <B><SPAN ID="y2k">?</SPAN></B><BR>This site is Y2K compliant.', 1)}</TD></TR></TABLE>
</TD>
<TD WIDTH="20">${sp(20, 1)}</TD>
<TD WIDTH="200" VALIGN="TOP">
${heading('PHOTO OF THE WEEK')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="0" CELLSPACING="0" BGCOLOR="${SAFE.light}"><TR><TD ALIGN="CENTER">${sp(1, 6)}<BR>
<A HREF="${featured.page}" ID="week-link">${img(featured.medium.src, featured.medium, featured.photo.alt, ' ID="week-photo"')}</A><BR>
${font('<SPAN ID="week-caption">#' + featured.photo.frame + ' ' + ascii(featured.photo.place) + '</SPAN>', 1)}<BR>${sp(1, 6)}</TD></TR></TABLE>
${sp(1, 10)}
<DIV ID="visitors" HIDDEN>
${heading('VISITORS')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD ALIGN="CENTER">${font('You are visitor', 1)}<BR><SPAN ID="counter"></SPAN></TD></TR></TABLE>
${sp(1, 10)}
</DIV>
${heading('ELSEWHERE')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD>${font('&raquo; <A HREF="https://mail.g3rry.com/" TARGET="_top">Free @g3rry.com e-mail</A><BR>&raquo; <A HREF="/phantom/" TARGET="_top">The Phantom</A><!-- 2026: it needs a browser from 2026. --><BR>&raquo; <A HREF="/mountain/" TARGET="_top">The Ascent</A>', 1)}</TD></TR></TABLE>
</TD>
</TR>
</TABLE>`, ['photos.js', 'scripts.js'], { map: true });
  await output('eras/1999/home.html', home);

  // Gallery and a page for every photograph.
  const cells = pictures.map(item => `<TD ALIGN="CENTER" VALIGN="TOP" WIDTH="140">
<TABLE BORDER="0" CELLPADDING="3" CELLSPACING="0" BGCOLOR="${SAFE.pale}"><TR><TD><A HREF="${item.page}">${img(item.thumb.src, item.thumb, item.photo.alt)}</A></TD></TR></TABLE>
${font('<A HREF="' + item.page + '">#' + item.photo.frame + '</A> ' + ascii(item.photo.place), 1)}</TD>`);
  const grid = [];
  for (let i = 0; i < cells.length; i += 4) grid.push('<TR>\n' + cells.slice(i, i + 4).join('\n') + '\n</TR>\n<TR><TD COLSPAN="4">' + sp(1, 12) + '</TD></TR>');
  await output('eras/1999/photos.html', page('Gerry Zhao Online - Photos', `${heading('PHOTO GALLERY')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD>${font(photos.length + ' photographs from New York (June 2023) and San Francisco (December 2025). Click a thumbnail to see the full-size picture.', 1)}</TD></TR></TABLE>
<TABLE WIDTH="560" BORDER="0" CELLPADDING="0" CELLSPACING="0">
${grid.join('\n')}
</TABLE>`));
  for (const [i, item] of pictures.entries()) {
    const prev = pictures[i - 1], next = pictures[i + 1], meta = item.photo.meta;
    const nav = [prev ? `<A HREF="${prev.page}">${img('images/a-prev.gif', arrows.prev, 'Previous', ' NAME="prev" data-over="images/a-prev-on.gif"')}</A>` : '',
      `<A HREF="photos.html">${img('images/a-back.gif', arrows.back, 'Back to the gallery', ' NAME="back" data-over="images/a-back-on.gif"')}</A>`,
      next ? `<A HREF="${next.page}">${img('images/a-next.gif', arrows.next, 'Next', ' NAME="next" data-over="images/a-next-on.gif"')}</A>` : ''].filter(Boolean).join(sp(8, 1));
    await output('eras/1999/' + item.page, page('Gerry Zhao Online - #' + item.photo.frame + ' ' + item.photo.place, `${heading('#' + item.photo.frame + ' &middot; ' + ascii(item.photo.place).toUpperCase())}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="8" CELLSPACING="0"><TR><TD ALIGN="CENTER">
${img(item.big.src, item.big, item.photo.alt)}<BR>${sp(1, 8)}<BR>
${font('<B>' + ascii(item.photo.place + ', ' + item.photo.city) + '</B>', 2)}<BR>${sp(1, 6)}<BR>
${font(date(item.photo.taken) + ' &middot; ' + exposure(meta) + ', ISO ' + meta.iso, 1, ' COLOR="#666666"')}<BR>${sp(1, 12)}<BR>
${nav}
</TD></TR></TABLE>`));
  }

  await output('eras/1999/guestbook.html', page('Gerry Zhao Online - Guestbook', `${heading('GUESTBOOK')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD>${font('Thanks for visiting! <A HREF="/guestbook/" TARGET="_top">Sign the guestbook</A>.<!-- 2026: it opens the current guestbook. -->', 1)}</TD></TR></TABLE>
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="1" CELLSPACING="0" BGCOLOR="${SAFE.navy}"><TR><TD>
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="5" CELLSPACING="0" ID="entries">
<TR BGCOLOR="${SAFE.blue}"><TD WIDTH="110">${font('<B>Name</B>', 1, ' COLOR="#FFFFFF"')}</TD><TD WIDTH="90">${font('<B>Date</B>', 1, ' COLOR="#FFFFFF"')}</TD><TD>${font('<B>Message</B>', 1, ' COLOR="#FFFFFF"')}</TD></TR>
<TR BGCOLOR="#FFFFFF"><TD COLSPAN="3">${font('Loading...', 1)}</TD></TR>
</TABLE>
</TD></TR></TABLE>
${sp(1, 16)}
${heading('FROM THE OLD GUESTBOOK')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD>${font('Saved from the guestbook CGI before it broke. Some entries did not survive the trip very well.', 1)}</TD></TR></TABLE>
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="1" CELLSPACING="0" BGCOLOR="${SAFE.navy}"><TR><TD>
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="5" CELLSPACING="0">
<TR BGCOLOR="#FFFFFF"><TD WIDTH="110" VALIGN="TOP">${font(ascii(ctx.puzzles.encoding.name), 1)}</TD><TD WIDTH="90" VALIGN="TOP">${font('11/13/1999', 1)}</TD><TD VALIGN="TOP">${font(ascii(ctx.puzzles.encoding.message) + '<BR><I>' + ascii(ctx.puzzles.encoding.browser) + '</I>', 1)}</TD></TR>
</TABLE>
</TD></TR></TABLE>`, ['scripts.js', 'guestbook.js']));
}
