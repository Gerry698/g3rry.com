// 1999: a splash page, then a frameset. A fixed menu of image buttons that swap on mouse-over, content in
// web-safe colours on nested tables held in shape by spacer GIFs, a photo of the week, a page per photograph.
import sharp from 'sharp';
import { canvas, drawText, textWidth, gif, animatedGif, hex, mix } from './pixels.mjs';

const YEAR = 1999;
const date = d => [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCFullYear()].map((n, i) => i < 2 ? String(n).padStart(2, '0') : String(n)).join('/');
const SAFE = { navy: '#003366', blue: '#336699', sky: '#6699CC', pale: '#CCCCCC', light: '#EEEEEE', white: '#FFFFFF', black: '#000000', orange: '#FF9900' };

// ---- Art ------------------------------------------------------------------------------------------------------

function bevel(c, w, h, from, to) {
  c.rect(0, 0, w, h, (x, y) => mix(hex(from), hex(to), y / (h - 1)));
  c.rect(0, 0, w, 1, mix(hex(from), [255, 255, 255, 255], 0.5)); c.rect(0, 0, 1, h, mix(hex(from), [255, 255, 255, 255], 0.5));
  c.rect(0, h - 1, w, 1, [0, 0, 0, 255]); c.rect(w - 1, 0, 1, h, [0, 0, 0, 255]);
}
async function menuButton(label, on) {
  const w = 150, h = 26, c = canvas(w, h);
  bevel(c, w, h, on ? SAFE.sky : SAFE.blue, on ? SAFE.blue : SAFE.navy);
  drawText(c, (on ? '> ' : '') + label, on ? 10 : 14, 6, 2, on ? hex(SAFE.white) : hex(SAFE.pale));
  return gif(c, { colours: 32 });
}
async function smallButton(label, on) {
  const w = textWidth(label, 1) + 20, h = 17, c = canvas(w, h);
  bevel(c, w, h, on ? SAFE.orange : SAFE.blue, on ? '#CC6600' : SAFE.navy);
  drawText(c, label, 10, 5, 1, hex(SAFE.white));
  return gif(c, { colours: 16 });
}
async function banner() {
  const w = 468, h = 60, c = canvas(w, h);
  c.rect(0, 0, w, h, (x, y) => mix(hex(SAFE.navy), hex(SAFE.blue), x / w * 0.7 + y / h * 0.3));
  for (let x = 0; x < w; x += 4) c.rect(x, 0, 1, h, [255, 255, 255, 18]);
  const text = 'GERRY ZHAO ONLINE', tw = textWidth(text, 3);
  drawText(c, text, (w - tw) / 2 + 2, 12, 3, [0, 0, 0, 180]);
  drawText(c, text, (w - tw) / 2, 10, 3, (i, j) => mix(hex(SAFE.white), hex(SAFE.pale), j / 6));
  const sub = 'PHOTOGRAPHY * LIGHT * NOTES', sw = textWidth(sub, 1, 2);
  drawText(c, sub, (w - sw) / 2, 42, 1, hex(SAFE.orange), 2);
  return gif(c, { colours: 64 });
}
async function splashLogo() {
  const w = 360, h = 120, c = canvas(w, h, hex(SAFE.black));
  const text = 'G3RRY.COM', tw = textWidth(text, 6);
  for (let k = 6; k > 0; k--) drawText(c, text, (w - tw) / 2 + k, 22 + k, 6, mix(hex(SAFE.navy), hex(SAFE.blue), 1 - k / 6));
  drawText(c, text, (w - tw) / 2, 22, 6, (i, j) => mix([255, 255, 255, 255], hex(SAFE.sky), j / 7));
  const sub = 'EST. 1999', sw = textWidth(sub, 1, 3);
  drawText(c, sub, (w - sw) / 2, 92, 1, hex(SAFE.pale), 3);
  return gif(c, { colours: 32 });
}
// A small logo for the top of the menu: a ring of points turning, the kind every site had spinning somewhere.
async function spinner() {
  const frames = [];
  for (let f = 0; f < 12; f++) {
    const c = canvas(40, 40, hex(SAFE.navy));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, age = (k - f + 12) % 12;
      const colour = mix([255, 255, 255, 255], hex(SAFE.navy), age / 12);
      c.rect(Math.round(20 + Math.cos(a) * 13) - 1, Math.round(20 + Math.sin(a) * 13) - 1, 3, 3, colour);
    }
    drawText(c, 'G', 17, 17, 1, hex(SAFE.orange));
    frames.push(c);
  }
  return animatedGif(frames, { delay: 90, colours: 16 });
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
  const art = async (name, bytes) => { await output('eras/1999/images/' + name, bytes); return sharp(bytes).metadata(); };
  const img = (src, meta, alt, extra = '') => `<IMG SRC="${src}" WIDTH="${meta.width}" HEIGHT="${meta.pageHeight || meta.height}" ALT="${ascii(alt)}" BORDER="0"${extra}>`;

  await art('spacer.gif', await spacer());
  const sp = (w, h) => `<IMG SRC="images/spacer.gif" WIDTH="${w}" HEIGHT="${h}" ALT="">`;
  const logo = await art('logo.gif', await splashLogo());
  const enter = [await art('enter.gif', await smallButton('ENTER SITE', false)), await art('enter-on.gif', await smallButton('ENTER SITE', true))];
  const bannerMeta = await art('banner.gif', await banner());
  const spin = await art('spin.gif', await spinner());
  const menu = [['home', 'HOME', 'home.html'], ['photos', 'PHOTOS', 'photos.html'], ['guestbook', 'GUESTBOOK', 'guestbook.html'], ['email', 'E-MAIL ME', 'mailto:' + site.guestbook.contact]];
  const menuMeta = {};
  for (const [id, label] of menu) { menuMeta[id] = await art('b-' + id + '.gif', await menuButton(label, false)); await art('b-' + id + '-on.gif', await menuButton(label, true)); }
  const arrows = {};
  for (const [id, label] of [['prev', '< PREV'], ['next', 'NEXT >'], ['back', 'GALLERY']]) { arrows[id] = await art('a-' + id + '.gif', await smallButton(label, false)); await art('a-' + id + '-on.gif', await smallButton(label, true)); }
  for (let n = 0; n < 10; n++) await art('c' + n + '.gif', await lcd(n));

  const pictures = [];
  for (const photo of photos) {
    const big = await variant(photo, YEAR, 'photos/' + photo.id + '.jpg', image => image.resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 62 }).toBuffer());
    const thumb = await variant(photo, YEAR, 'photos/' + photo.id + '_th.jpg', image => image.resize({ width: 100, height: 100, fit: 'inside' }).sharpen().jpeg({ quality: 60 }).toBuffer());
    const medium = await variant(photo, YEAR, 'photos/' + photo.id + '_md.jpg', image => image.resize({ width: 200, height: 200, fit: 'inside' }).jpeg({ quality: 60 }).toBuffer());
    pictures.push({ photo, big, thumb, medium, page: 'photo-' + photo.frame + '.html' });
  }

  const ring = around(YEAR);
  const label = item => item.now ? 'Now' : String(item.year);
  const doc = (title, body, { doctype = 'transitional', bodyAttrs = 'BGCOLOR="#FFFFFF" TEXT="#000000" LINK="#003366" VLINK="#336699" ALINK="#FF9900" LEFTMARGIN="0" TOPMARGIN="0" MARGINWIDTH="0" MARGINHEIGHT="0"', scripts = ['scripts.js'] } = {}) => `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 ${doctype === 'frameset' ? 'Frameset' : 'Transitional'}//EN">
<HTML lang="en">
<HEAD>
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
  const modem = `<P ALIGN="CENTER">${font('Your modem: <SELECT ID="modem-speed" data-modem disabled><OPTION VALUE="">56K (1999)</OPTION><OPTION VALUE="28800">28,800 bps</OPTION><OPTION VALUE="33600">33,600 bps</OPTION><OPTION VALUE="0">DSL (full speed)</OPTION></SELECT>', 1, ' COLOR="#666666"')}</P>`;
  const footer = `<P ALIGN="CENTER">${font('&copy; ' + new Date().getUTCFullYear() + ' Gerry Zhao. All rights reserved.<BR>Best viewed at 800x600 in High Color with a frames-capable browser.', 1, ' COLOR="#666666"')}</P>
${modem}
<SCRIPT SRC="/eras/modem-client.js"></SCRIPT>`;
  // Every content page is a fixed 560-pixel table inside the main frame.
  const page = (title, inner, scripts) => doc(title, `<TABLE WIDTH="560" BORDER="0" CELLPADDING="0" CELLSPACING="0">
<TR><TD>${sp(560, 12)}</TD></TR>
<TR><TD ALIGN="CENTER">${img('images/banner.gif', bannerMeta, 'Gerry Zhao Online')}</TD></TR>
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

  const menuRows = menu.map(([id, text, href]) => `<TR><TD><A HREF="${href}"${href.startsWith('mailto:') ? '' : ' TARGET="main"'}>${img('images/b-' + id + '.gif', menuMeta[id], text, ' NAME="' + id + '" data-over="images/b-' + id + '-on.gif"')}</A></TD></TR>`).join('\n');
  await output('eras/1999/menu.html', doc('Menu', `<TABLE WIDTH="170" BORDER="0" CELLPADDING="0" CELLSPACING="0">
<TR><TD>${sp(170, 16)}</TD></TR>
<TR><TD ALIGN="CENTER">${img('images/spin.gif', spin, 'g3rry.com')}</TD></TR>
<TR><TD>${sp(170, 16)}</TD></TR>
${menuRows}
<TR><TD>${sp(170, 24)}</TD></TR>
<TR><TD ALIGN="CENTER">${font('<B>TIME RING</B><BR><A HREF="' + ring.previous.href + '" TARGET="_top">&laquo; ' + label(ring.previous) + '</A> | <A HREF="/eras/" TARGET="_top">All</A> | <A HREF="' + ring.next.href + '" TARGET="_top">' + label(ring.next) + ' &raquo;</A>', 1, ' COLOR="#CCCCCC"')}</TD></TR>
<TR><TD>${sp(170, 24)}</TD></TR>
<TR><TD ALIGN="CENTER">${font('Last updated<BR>' + date(new Date()), 1, ' COLOR="#6699CC"')}</TD></TR>
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
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD>${font('&raquo; <A HREF="https://mail.g3rry.com/" TARGET="_top">Free @g3rry.com e-mail</A><BR>&raquo; <A HREF="/phantom/" TARGET="_top">The Phantom</A> (needs a 2026 browser)<BR>&raquo; <A HREF="/mountain/" TARGET="_top">The Ascent</A>', 1)}</TD></TR></TABLE>
</TD>
</TR>
</TABLE>`, ['photos.js', 'scripts.js']);
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
${font(ascii(item.photo.alt), 2)}<BR>${sp(1, 6)}<BR>
${font(ascii(item.photo.place + ', ' + item.photo.city) + ' &middot; ' + date(item.photo.taken) + '<BR>' + ascii(meta.lens) + ' at ' + meta.focal + 'mm, f/' + meta.aperture + ', ' + ascii(meta.shutter) + ' sec, ISO ' + meta.iso, 1, ' COLOR="#666666"')}<BR>${sp(1, 12)}<BR>
${nav}
</TD></TR></TABLE>`));
  }

  await output('eras/1999/guestbook.html', page('Gerry Zhao Online - Guestbook', `${heading('GUESTBOOK')}
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="6" CELLSPACING="0"><TR><TD>${font('Thanks for visiting! <A HREF="/guestbook/" TARGET="_top">Sign the guestbook</A> (opens the current guestbook).', 1)}</TD></TR></TABLE>
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="1" CELLSPACING="0" BGCOLOR="${SAFE.navy}"><TR><TD>
<TABLE WIDTH="100%" BORDER="0" CELLPADDING="5" CELLSPACING="0" ID="entries">
<TR BGCOLOR="${SAFE.blue}"><TD WIDTH="110">${font('<B>Name</B>', 1, ' COLOR="#FFFFFF"')}</TD><TD WIDTH="90">${font('<B>Date</B>', 1, ' COLOR="#FFFFFF"')}</TD><TD>${font('<B>Message</B>', 1, ' COLOR="#FFFFFF"')}</TD></TR>
<TR BGCOLOR="#FFFFFF"><TD COLSPAN="3">${font('Loading...', 1)}</TD></TR>
</TABLE>
</TD></TR></TABLE>`, ['scripts.js', 'guestbook.js']));
}
