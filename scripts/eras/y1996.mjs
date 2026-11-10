// 1996: a personal home page in HTML 3.2. Tables, font tags, a tiled starfield, GIFs in 256 colours,
// progressive JPEGs, a guestbook and a ring of sites. The modem service worker sets the pace.
import path from 'node:path';
import sharp from 'sharp';
import { canvas, drawText, drawMask, textWidth, gif, animatedGif, random, hex, mix, paint, blur, cover, cutOut } from './pixels.mjs';
import { fonts, face, FACES, markup } from './fonts.mjs';

const YEAR = 1996;
const UPDATED = '12/24/96';
const MATTE = '#000022'; // the starfield's own colour, which every transparent GIF here is cut out of
const date = d => [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCFullYear() % 100].map(n => String(n).padStart(2, '0')).join('/');
const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const kb = bytes => Math.max(1, Math.round(bytes / 1024)) + 'K';

// ---- Art ------------------------------------------------------------------------------------------------------

// A page title as Paint Shop Pro made them: Times Bold Italic, anti-aliased, a gradient fill and a drop shadow,
// saved as a transparent GIF over the background colour.
async function title(type, text) {
  const ink = await type.coverage('<span foreground="#ffffff">' + markup(text) + '</span>', face(FACES.timesBoldItalic, 44));
  const shadow = blur(ink, 1), drop = 3, pad = 2;
  const width = ink.width + pad * 2 + drop + 2, height = ink.height + pad * 2 + drop + 2;
  const c = canvas(width, height, hex(MATTE)), covered = new Uint8Array(width * height);
  const sx = pad + drop - shadow.offset, sy = pad + drop - shadow.offset;
  paint(c, shadow, sx, sy, [40, 0, 70, 255], 1.6);
  cover(covered, width, shadow, sx, sy);
  const top = hex('#ffff66'), bottom = hex('#ff6a00');
  paint(c, ink, pad, pad, (i, j) => mix(top, bottom, j / (ink.height - 1)));
  cover(covered, width, ink, pad, pad);
  return gif(cutOut(c, covered, 60), { colours: 128 });
}

async function stars() {
  const c = canvas(96, 96, hex('#000022')), next = random(1996);
  for (let n = 0; n < 46; n++) {
    const x = Math.floor(next() * 96), y = Math.floor(next() * 96), b = next();
    const colour = b > 0.9 ? [255, 255, 255, 255] : b > 0.6 ? [170, 190, 255, 255] : [90, 100, 160, 255];
    c.set(x, y, colour);
    if (b > 0.94) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) c.set((x + dx + 96) % 96, (y + dy + 96) % 96, [120, 130, 200, 255]);
  }
  return gif(c, { colours: 16 });
}

async function rainbow() {
  const width = 468, c = canvas(width, 6);
  for (let x = 0; x < width; x++) {
    const h = x / width * 300, k = n => (n + h / 60) % 6, f = n => 255 * (1 - Math.max(0, Math.min(k(n), 4 - k(n), 1)));
    const rgb = [f(5), f(3), f(1)].map(Math.round);
    for (let y = 0; y < 6; y++) c.set(x, y, y === 1 ? mix([...rgb, 255], [255, 255, 255, 255], 0.55) : y === 5 ? mix([...rgb, 255], [0, 0, 0, 255], 0.4) : [...rgb, 255]);
  }
  return gif(c, { colours: 64 });
}

// The lamp blinks. Strata (under-construction): see the private solution book.
async function barricade(sign) {
  const draw = (lit, letter) => {
    const c = canvas(104, 40);
    c.rect(14, 22, 4, 18, hex('#8a8a8a')); c.rect(86, 22, 4, 18, hex('#8a8a8a'));
    c.rect(10, 38, 12, 2, hex('#5a5a5a')); c.rect(82, 38, 12, 2, hex('#5a5a5a'));
    c.rect(2, 10, 100, 12, (x, y) => letter || ((x + y) % 14) < 7 ? hex('#ffd400') : hex('#111111'));
    if (letter) drawMask(c, letter, 50, 12, 1, hex('#111111'));
    c.rect(2, 10, 100, 1, hex('#fff6a0')); c.rect(2, 21, 100, 1, hex('#5a4a00'));
    const lamp = lit ? hex('#ff8a00') : hex('#6a3600');
    c.rect(49, 6, 6, 4, hex('#333333'));
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if ((x - 2.5) ** 2 + (y - 2.5) ** 2 < 9) c.set(49 + x, y, lamp);
    if (lit) for (const [x, y] of [[46, 1], [58, 1], [45, 4], [59, 4]]) c.set(x, y, hex('#ffd27a'));
    return c;
  };
  const frames = [], delay = [];
  for (const letter of sign) { frames.push(draw(true), draw(true, letter), draw(false)); delay.push(470, 40, 490); }
  return animatedGif(frames, { delay, colours: 16 });
}

// NEW!, flashing red and yellow, in heavy type with a hard shadow.
async function newBadge(type) {
  const ink = await type.coverage('<span foreground="#ffffff">NEW!</span>', face(FACES.arialBlack, 14));
  const frames = [hex('#ff2020'), hex('#ffff40')].map(colour => {
    const width = ink.width + 4, height = ink.height + 4;
    const c = canvas(width, height, hex(MATTE)), covered = new Uint8Array(width * height);
    paint(c, ink, 2, 2, [0, 0, 0, 255]);
    cover(covered, width, ink, 2, 2);
    paint(c, ink, 1, 1, colour);
    cover(covered, width, ink, 1, 1);
    return cutOut(c, covered, 70);
  });
  return animatedGif(frames, { delay: 400, colours: 32 });
}

async function envelope() {
  const frames = [0, 1].map(lift => {
    const c = canvas(32, 24);
    const y0 = 4 - lift;
    c.rect(2, y0 + 4, 28, 16, hex('#f4f0d8'));
    for (let x = 0; x < 28; x++) { const y = Math.round(Math.abs(x - 13.5) * 0.55); c.set(2 + x, y0 + 4 + (8 - y), hex('#8a7a50')); }
    c.rect(2, y0 + 4, 28, 1, hex('#8a7a50')); c.rect(2, y0 + 19, 28, 1, hex('#8a7a50'));
    c.rect(2, y0 + 4, 1, 16, hex('#8a7a50')); c.rect(29, y0 + 4, 1, 16, hex('#8a7a50'));
    c.rect(23, y0 + 6, 5, 4, hex('#d02020'));
    return c;
  });
  return animatedGif(frames, { delay: 350, colours: 8 });
}

// The classic 88 × 31 button: two or three lines of tiny type on a bevelled gradient.
async function button(lines, from, to, ink = [255, 255, 255, 255]) {
  const c = canvas(88, 31);
  c.rect(0, 0, 88, 31, (x, y) => mix(hex(from), hex(to), y / 30));
  c.rect(0, 0, 88, 1, [255, 255, 255, 255]); c.rect(0, 0, 1, 31, [255, 255, 255, 255]);
  c.rect(0, 30, 88, 1, [0, 0, 0, 255]); c.rect(87, 0, 1, 31, [0, 0, 0, 255]);
  const top = Math.round((31 - (lines.length * 9 - 2)) / 2);
  lines.forEach((line, i) => {
    const x = Math.round((88 - textWidth(line)) / 2);
    drawText(c, line, x + 1, top + i * 9 + 1, 1, [0, 0, 0, 160]);
    drawText(c, line, x, top + i * 9, 1, ink);
  });
  return gif(c, { colours: 32 });
}

async function digit(n) {
  const c = canvas(14, 20, hex('#000000'));
  c.rect(0, 0, 14, 1, hex('#777777')); c.rect(0, 19, 14, 1, hex('#333333')); c.rect(0, 0, 1, 20, hex('#777777')); c.rect(13, 0, 1, 20, hex('#333333'));
  drawText(c, String(n), 2, 3, 2, hex('#e8ffe0'));
  return gif(c, { colours: 4 });
}

// The Phantom as a 1996 animated GIF: points of the first mark fly in, hold, and blow away.
async function phantom(root, source) {
  const { data, info } = await sharp(path.join(root, source)).resize({ width: 72, height: 72, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lit = [];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4, luma = (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255;
    if (data[i + 3] > 128 && luma > .35) lit.push([x - info.width / 2, y - info.height / 2]);
  }
  const next = random(7), size = 120, count = Math.min(420, lit.length);
  const points = Array.from({ length: count }, () => {
    const [x, y] = lit[Math.floor(next() * lit.length)];
    const a = next() * Math.PI * 2, r = 70 + next() * 40;
    return { tx: size / 2 + x * 1.35, ty: size / 2 + y * 1.35, sx: size / 2 + Math.cos(a) * r, sy: size / 2 + Math.sin(a) * r, ex: size / 2 + x * 1.35 + (next() - .5) * 160, ey: size / 2 + y * 1.35 - 40 - next() * 80, warm: next() };
  });
  const ease = t => 1 - (1 - t) ** 3;
  const frames = [];
  const total = 30;
  for (let f = 0; f < total; f++) {
    const c = canvas(size, size, hex('#000000'));
    for (const p of points) {
      let x, y;
      if (f < 12) { const t = ease(f / 11); x = p.sx + (p.tx - p.sx) * t; y = p.sy + (p.ty - p.sy) * t; }
      else if (f < 22) { x = p.tx; y = p.ty; }
      else { const t = ((f - 22) / 7) ** 2; x = p.tx + (p.ex - p.tx) * t; y = p.ty + (p.ey - p.ty) * t; }
      const twinkle = f >= 12 && f < 22 && (Math.floor(p.warm * 97) + f) % 9 === 0;
      c.set(x, y, twinkle ? [255, 255, 255, 255] : p.warm > .5 ? hex('#ffd27a') : hex('#c9af77'));
    }
    frames.push(c);
  }
  return animatedGif(frames, { delay: [...Array(total)].map((_, f) => f === 21 ? 900 : f === total - 1 ? 400 : 70), colours: 8 });
}

// ---- Pages ----------------------------------------------------------------------------------------------------

export default async function build(ctx, era) {
  const { output, ascii, csp, photos, site, around, variant, hero } = ctx;
  const type = fonts(ctx.root);
  const art = async (name, bytes) => { await output('eras/1996/art/' + name, bytes); return (await sharp(bytes).metadata()); };
  const img = (src, meta, alt, extra = '') => `<IMG SRC="${src}" WIDTH="${meta.width}" HEIGHT="${meta.pageHeight || meta.height}" ALT="${ascii(alt)}"${extra}>`;

  const titles = {};
  for (const [key, text] of [['home', "Gerry's Home Page"], ['photos', 'My Photo Gallery'], ['notes', 'Guestbook']]) titles[key] = await art('title-' + key + '.gif', await title(type, text));
  await art('stars.gif', await stars());
  const bar = await art('bar.gif', await rainbow());
  const construction = await art('construction.gif', await barricade(ctx.puzzles.sign));
  const fresh = await art('new.gif', await newBadge(type));
  const mail = await art('mail.gif', await envelope());
  const buttons = [
    ['best.gif', await button(['BEST VIEWED', 'WITH', 'NETSCAPE'], '#203080', '#000830'), 'Best viewed with Netscape Navigator'],
    ['notepad.gif', await button(['MADE WITH', 'NOTEPAD'], '#f0f0f0', '#a0a0a0', [0, 0, 0, 255]), 'Made with Notepad'],
    ['ring.gif', await button(['G3RRY.COM', 'TIME RING'], '#7a2a9a', '#2a0040'), 'g3rry.com Time Ring']
  ];
  const buttonMeta = [];
  for (const [name, bytes, alt] of buttons) buttonMeta.push([name, await art(name, bytes), alt]);
  for (let n = 0; n < 10; n++) await art('d' + n + '.gif', await digit(n));
  const phantomMeta = await art('phantom.gif', await phantom(ctx.root, site.phantom.shapes[0].source));

  // Photographs: a progressive JPEG for each, at most 480 pixels on the long side, and a dithered GIF thumbnail.
  const pictures = [];
  for (const photo of photos) {
    const big = await variant(photo, YEAR, 'pics/frame' + photo.frame + '.jpg', image => image.resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 55, progressive: true, chromaSubsampling: '4:2:0' }).toBuffer());
    const thumb = await variant(photo, YEAR, 'pics/frame' + photo.frame + 't.gif', image => image.resize({ width: 96, height: 96, fit: 'inside' }).modulate({ saturation: 1.15 }).gif({ colours: 256, dither: 1, effort: 10 }).toBuffer());
    pictures.push({ photo, big, thumb });
  }
  const me = await variant(hero, YEAR, 'pics/me.jpg', image => image.resize({ width: 240 }).jpeg({ quality: 55, progressive: true }).toBuffer());

  const ring = around(YEAR);
  const ringLabel = item => String(item.year);
  const head = (pageTitle, description) => `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<HTML lang="en">
<HEAD>
<!-- 2026: a Content-Security-Policy, which no server or page had in 1996. -->
${csp}
<META NAME="robots" CONTENT="noindex">
<META NAME="description" CONTENT="${ascii(description)}">
<META NAME="keywords" CONTENT="Gerry Zhao, photography, photos, pictures, New York, San Francisco, Golden Gate Bridge, Times Square, light, guestbook">
<TITLE>${ascii(pageTitle)}</TITLE>
</HEAD>
<BODY BGCOLOR="#000022" BACKGROUND="art/stars.gif" TEXT="#FFFFCC" LINK="#66CCFF" VLINK="#CC99FF" ALINK="#FF9900">
`;
  const hr = `<P ALIGN=CENTER>${img('art/bar.gif', bar, '')}</P>`;
  const timeRing = `<CENTER>
<TABLE BORDER=3 CELLPADDING=6 CELLSPACING=0 BGCOLOR="#2A0040">
<TR><TD ALIGN=CENTER><FONT FACE="Arial,Helvetica" SIZE=2>
This site is a member of the <B>g3rry.com Time Ring</B><BR>
[<A HREF="${ring.previous.href}">&lt;&lt; ${ringLabel(ring.previous)}</A>]
[<A HREF="/eras/" ID="ring-random">Random</A>]
[<A HREF="/eras/">List all years</A>]
[<A HREF="${ring.next.href}">${ringLabel(ring.next)} &gt;&gt;</A>]
</FONT></TD></TR>
</TABLE>
</CENTER>`;
  // The speeds are written in by /eras/modem-client.js, from the one list it keeps for every page.
  const modem = `<P ALIGN=CENTER><FONT FACE="Arial,Helvetica" SIZE=1 COLOR="#8888AA"><SPAN data-modem-links="1996"></SPAN><A HREF="/eras/dialup.html?to=1996">Dial up again</A></FONT></P>`;
  const nav = current => '<P ALIGN=CENTER><FONT FACE="Arial,Helvetica" SIZE=2>' + [['index.html', 'Home'], ['photos.html', 'Photo Gallery'], ['guestbook.html', 'Guestbook']]
    .map(([href, label]) => href === current ? '[ <B>' + label + '</B> ]' : '[ <A HREF="' + href + '">' + label + '</A> ]').join(' ') + '</FONT></P>';
  const foot = `${hr}
${timeRing}
<P ALIGN=CENTER>${buttonMeta.map(([name, meta, alt]) => img('art/' + name, meta, alt, ' HSPACE=4')).join('\n')}</P>
<CENTER><ADDRESS><FONT SIZE=2>Last updated ${UPDATED}.<BR>
${img('art/mail.gif', mail, '', ' ALIGN=ABSMIDDLE')} E-mail me: <A HREF="mailto:${site.guestbook.contact}">${site.guestbook.contact}</A></FONT></ADDRESS></CENTER>
${modem}
<SCRIPT SRC="/eras/modem-client.js"></SCRIPT>
<SCRIPT SRC="scripts.js"></SCRIPT>
</BODY>
</HTML>
`;

  // What's new: the photographs grouped by the day and place they were taken, newest first.
  const days = [];
  for (const photo of [...photos].sort((a, b) => b.taken - a.taken)) {
    const key = date(photo.taken) + ' ' + photo.place;
    const day = days.find(item => item.key === key);
    if (day) day.count++; else days.push({ key, when: date(photo.taken), place: photo.place, city: photo.city, count: 1 });
  }
  const news = days.slice(0, 6).map((day, i) => `<LI><B>${day.when}</B> - ${day.count === 1 ? 'A picture' : words[day.count] + ' pictures'} from ${ascii(day.place)}, ${ascii(day.city)}${i === 0 ? ' ' + img('art/new.gif', fresh, 'New!', ' ALIGN=ABSMIDDLE') : ''}`).join('\n');

  const home = head("Gerry's Home Page", "Gerry Zhao's home page: photographs of light, a guestbook and other cool stuff.") + `<CENTER>
${img('art/title-home.gif', titles.home, "Gerry's Home Page")}
<P>${img('art/construction.gif', construction, 'Under construction', ' ALIGN=ABSMIDDLE')} <FONT COLOR="#FFFF00"><B><BLINK>This page is always under construction!</BLINK></B></FONT></P>
</CENTER>
${hr}
<TABLE WIDTH=560 BORDER=0 CELLPADDING=8 CELLSPACING=0 ALIGN=CENTER>
<TR>
<TD VALIGN=TOP WIDTH=250><A HREF="photos.html">${img('pics/me.jpg', me, hero.alt, ' BORDER=2')}</A><BR>
<FONT FACE="Arial,Helvetica" SIZE=1>${ascii(hero.place)}, 20 seconds at f/32.</FONT></TD>
<TD VALIGN=TOP><FONT FACE="Times New Roman,Times" SIZE=3>
<FONT SIZE=5 COLOR="#FFCC66"><B>Hi!</B></FONT><BR>
My name is <B>Gerry Zhao</B>, and this is my little corner of the World Wide Web.
I like to take pictures of light: rain at night, trains in the dark, bridges at sunset.
Have a look around, and please sign my guestbook before you go!
</FONT></TD>
</TR>
</TABLE>
${hr}
<TABLE WIDTH=560 BORDER=0 CELLPADDING=4 CELLSPACING=0 ALIGN=CENTER>
<TR><TD>
<FONT FACE="Arial,Helvetica" SIZE=4 COLOR="#FFCC66"><B>What's New?</B></FONT>
<UL>
${news}
</UL>
<FONT FACE="Arial,Helvetica" SIZE=4 COLOR="#FFCC66"><B>Cool Stuff on This Site</B></FONT>
<UL>
<LI><A HREF="photos.html"><B>My Photo Gallery</B></A> - ${photos.length} pictures from ${ascii([...new Set(photos.map(photo => photo.city))].join(' and '))}.
<LI><A HREF="guestbook.html"><B>Guestbook</B></A> - see who has been here, and <A HREF="/guestbook/">sign it</A>!
<LI><A HREF="https://mail.g3rry.com/"><B>Free E-mail!</B></A> - get your own address @g3rry.com.
<LI><A HREF="/mountain/"><B>The Ascent</B></A> - my mountain in 3-D. Coming soon!<!-- 2026: it came; you will need a much newer computer. -->
</UL>
<TABLE BORDER=0 CELLPADDING=6><TR>
<TD><A HREF="/phantom/">${img('art/phantom.gif', phantomMeta, 'The Phantom: points of light gathering into a mark', ' BORDER=0')}</A></TD>
<TD VALIGN=MIDDLE><FONT FACE="Arial,Helvetica" SIZE=2><A HREF="/phantom/"><B>The Phantom</B></A><BR>A thousand little points of light, as an animated GIF.<BR>
Someday it will follow your mouse.<!-- 2026: it does now. --></FONT></TD>
</TR></TABLE>
</TD></TR>
</TABLE>
<P ALIGN=CENTER ID="counter-line" HIDDEN><FONT FACE="Arial,Helvetica" SIZE=2>You are visitor number <SPAN ID="counter"></SPAN></FONT></P>
` + foot;
  await output('eras/1996/index.html', home);

  const totalThumbs = pictures.reduce((sum, item) => sum + item.thumb.bytes, 0);
  const rows = [];
  for (let i = 0; i < pictures.length; i += 3) {
    rows.push('<TR>\n' + pictures.slice(i, i + 3).map(({ photo, big, thumb }) => `<TD ALIGN=CENTER VALIGN=TOP WIDTH=170><A HREF="${big.src}">${img(thumb.src, thumb, photo.alt, ' BORDER=2')}</A><BR>
<FONT FACE="Arial,Helvetica" SIZE=2><B>#${photo.frame}</B> ${ascii(photo.place)}<BR>${date(photo.taken)}<BR>
<FONT SIZE=1>[<A HREF="${big.src}">${big.width}x${big.height}, ${kb(big.bytes)}</A>]</FONT></FONT></TD>`).join('\n') + '\n</TR>');
  }
  const gallery = head("Gerry's Photo Gallery", 'Eighteen photographs by Gerry Zhao.') + `<CENTER>
${img('art/title-photos.gif', titles.photos, 'My Photo Gallery')}
</CENTER>
${nav('photos.html')}
<TABLE WIDTH=560 BORDER=0 ALIGN=CENTER><TR><TD><FONT FACE="Times New Roman,Times" SIZE=3>
Here are ${photos.length} of my pictures. Click on a little picture to see it bigger.
<B>Warning:</B> this page has a lot of graphics (about ${kb(totalThumbs)}), so it may take a while. Please be patient!
</FONT></TD></TR></TABLE>
<P>
<TABLE BORDER=1 CELLPADDING=6 CELLSPACING=2 BGCOLOR="#000044" ALIGN=CENTER>
${rows.join('\n')}
</TABLE>
` + foot;
  await output('eras/1996/photos.html', gallery);

  const guestbook = head("Gerry's Guestbook", 'Notes left by visitors to Gerry Zhao\'s home page.') + `<CENTER>
${img('art/title-notes.gif', titles.notes, 'Guestbook')}
</CENTER>
${nav('guestbook.html')}
<TABLE WIDTH=560 BORDER=0 ALIGN=CENTER><TR><TD><FONT FACE="Times New Roman,Times" SIZE=3>
Thanks for stopping by! Here is what other visitors have written.
<B><A HREF="/guestbook/">Sign my guestbook!</A></B><!-- 2026: the link goes to the current guestbook; the old CGI script stopped working long ago. -->
</FONT>
<HR>
<DIV ID="entries"><FONT FACE="Arial,Helvetica" SIZE=2>Loading the guestbook...</FONT></DIV>
<NOSCRIPT><FONT FACE="Arial,Helvetica" SIZE=2>The guestbook needs JavaScript turned on.</FONT></NOSCRIPT>
</TD></TR></TABLE>
<SCRIPT SRC="guestbook.js"></SCRIPT>
` + foot;
  await output('eras/1996/guestbook.html', guestbook);
  await privateFolder(ctx);
}

// ---- /eras/1996/private/: the folder robots.txt asks robots to stay out of, listed the way Apache listed folders.

async function icon(kind) {
  const c = canvas(20, 22), ink = hex('#000000'), paper = hex('#ffffff'), grey = hex('#c0c0c0');
  if (kind === 'back') {
    c.rect(4, 10, 13, 2, ink);
    for (let i = 0; i < 6; i++) { c.set(4 + i, 10 - i, ink); c.set(4 + i, 11 + i, ink); }
    c.rect(15, 4, 2, 7, ink);
  } else if (kind !== 'blank') {
    c.rect(3, 1, 12, 20, paper); c.rect(3, 1, 12, 1, ink); c.rect(3, 20, 15, 1, ink); c.rect(3, 1, 1, 20, ink); c.rect(17, 5, 1, 16, ink);
    for (let i = 0; i < 4; i++) c.set(14 + i, 1 + i, ink);
    if (kind === 'text') for (let y = 7; y < 19; y += 2) c.rect(6, y, 9, 1, grey);
    else { c.rect(6, 7, 9, 4, hex('#3366cc')); for (let y = 13; y < 19; y += 2) c.rect(6, y, 9, 1, grey); }
  }
  return gif(c, { colours: 8 });
}

async function privateFolder(ctx) {
  const { output, csp, ascii, puzzles } = ctx;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Apache 1.1 printed two-digit years ("03-Feb-96 21:14"); the four-digit ones came with the Y2K fixes of 1.3.
  const stamp = value => { const [d, t] = value.split(' '), [y, m, day] = d.split('-'); return day + '-' + months[m - 1] + '-' + y.slice(2) + ' ' + t; };
  // Columns: the icon, a space, the name padded to 25, the date, two spaces, the size right-aligned in 5.
  const row = (icon, alt, href, name, when, size) => '<IMG SRC="../icons/' + icon + '.gif" ALT="' + alt + '" WIDTH="20" HEIGHT="22"> <A HREF="' + href + '">' + name + '</A>'
    + ' '.repeat(Math.max(1, 25 - name.length)) + stamp(when) + '  ' + size.padStart(5) + '  ';
  for (const kind of ['blank', 'back', 'text', 'layout']) await output('eras/1996/icons/' + kind + '.gif', await icon(kind));
  const page = (title, body) => `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<HTML lang="en">
<HEAD>
<!-- 2026: a Content-Security-Policy, which no server or page had in 1996. -->
${csp}
<META NAME="robots" CONTENT="noindex">
<TITLE>${ascii(title)}</TITLE>
</HEAD>
<BODY BGCOLOR="#FFFFFF" TEXT="#000000" LINK="#0000EE" VLINK="#551A8B">
${body}
</BODY>
</HTML>
`;
  for (const file of puzzles.privateFiles) {
    if (file.body !== null) await output('eras/1996/private/' + file.name, file.body.replace(/\n/g, '\r\n') + '\r\n');
    else if (file.name === 'about-me.html') await output('eras/1996/private/about-me.html', page('About me', `<H1>About me</H1>
<P>Hi! My name is Gerry. I take pictures, mostly of cities and of light. This is the "about me" page for my home page.
It is not finished yet, so it is not linked from anywhere.</P>
<P>Things I like: film, maps, mountains, the smell of the photo lab.</P>
<P><A HREF="../">Back to my home page</A></P>`));
    else await output('eras/1996/private/' + file.name, page('Bookmarks for Gerry', `<!-- Netscape bookmark file, saved as a page. -->
<H1>Bookmarks for Gerry</H1>
<DL><DT><H3>My pages</H3>
<DL>
<DT><A HREF="../">Gerry's Home Page</A>
<DT><A HREF="../photos.html">My Photo Gallery</A>
<DT><A HREF="../guestbook.html">Guestbook</A>
</DL>
<DT><H3>To read later</H3>
<DL>
<DT><A HREF="../../1999/">The future (frames?)</A>
</DL>
</DL>`));
  }
  const byName = [...puzzles.privateFiles].sort((a, b) => a.name.localeCompare(b.name));
  const rows = byName.map(file => {
    const kind = file.name.endsWith('.html') ? ['layout', '[   ]'] : ['text', '[TXT]'];
    return '<SPAN>' + row(kind[0], kind[1], file.name, file.name, file.date, file.size) + '\n</SPAN>';
  });
  await output('eras/1996/private/index.html', `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<HTML lang="en">
 <HEAD>
<!-- 2026: a Content-Security-Policy, which no server or page had in 1996. -->
${csp}
  <META NAME="robots" CONTENT="noindex">
  <TITLE>Index of /eras/1996/private</TITLE>
 </HEAD>
 <BODY BGCOLOR="#FFFFFF" TEXT="#000000">
<H1>Index of /eras/1996/private</H1>
<PRE ID="listing"><IMG SRC="../icons/blank.gif" ALT="     " WIDTH="20" HEIGHT="22"> <A HREF="index.html?N=D" ID="sort-N">Name</A>                     <A HREF="index.html?M=A" ID="sort-M">Last modified</A>     <A HREF="index.html?S=A" ID="sort-S">Size</A>  <A HREF="index.html?D=A" ID="sort-D">Description</A>
<HR>
${row('back', '[DIR]', '../', 'Parent Directory', '1996-12-24 19:31', '-')}
${rows.join('')}</PRE><HR>
<SCRIPT SRC="sort.js"></SCRIPT>
 </BODY>
</HTML>
`);
}

