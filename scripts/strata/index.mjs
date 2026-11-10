// Strata (/strata/): the hub of the hunt. The mountain in cross-section, one stratum per puzzle, answer boxes
// aligned so that a borehole from the summit passes through one letter of each. Answers are checked by the hunt
// Worker; this page holds no answers, only their lengths and where the borehole crosses them.
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Sediment from the living surface down to the oldest year, then cold bedrock. Each stratum gets its own tone.
const YEAR_TONES = ['#34402f', '#363a2c', '#38362a', '#393228', '#382e25', '#352a22', '#31261f', '#2c221c', '#271e19'];
const BEDROCK_TONES = ['#20252b', '#1d2227', '#1a1e23', '#171b20'];
// Each year's label is set in that year's type, so the hub reads as the same ring of years as /eras/.
const YEAR_TYPE = {
  '1996': '"Times New Roman", Times, serif', '1999': 'Verdana, Geneva, sans-serif', '2003': 'Tahoma, Verdana, sans-serif',
  '2007': '"Lucida Grande", "Lucida Sans Unicode", "Trebuchet MS", sans-serif', '2011': '"League Gothic", Impact, sans-serif',
  '2014': '"Open Sans", "Segoe UI", sans-serif', '2018': 'Roboto, Arial, sans-serif', '2023': 'Inter, system-ui, sans-serif'
};
const FONTS = [
  ['League Gothic', 400, 'league-gothic', 'league-gothic-latin-400-normal.woff2'],
  ['Open Sans', 300, 'open-sans', 'open-sans-latin-300-normal.woff2'],
  ['Roboto', 400, 'roboto', 'roboto-latin-400-normal.woff2']
];

// A boundary between two strata: a gentle wave for sediment, a broken edge where the years stop and the bedrock begins.
function boundary(fill, seed, rocky) {
  const points = [];
  for (let x = 0; x <= 1200; x += rocky ? 40 : 30) {
    const y = rocky ? 7 + ((x * 7 + seed * 13) % 11) - 5 : 7 + 4 * Math.sin(x / (95 + seed * 9) + seed) + 2 * Math.sin(x / 37 + seed * 2);
    points.push(x + ' ' + y.toFixed(1));
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 14" preserveAspectRatio="none"><path fill="' + fill + '" d="M' + points.join(' L') + ' L1200 14 L0 14 Z"/></svg>\n';
}

export async function buildStrata(ctx) {
  const { root, dist, output, render, escape } = ctx;
  const content = JSON.parse(await readFile(path.join(root, 'content/strata.json'), 'utf8'));
  const { sheet } = JSON.parse(await readFile(path.join(root, 'content/strata/puzzles.json'), 'utf8'));
  const rows = content.rows;
  for (const row of rows) if (!/^[a-z][a-z-]*$/.test(row.id) || !row.title || !(row.length > 0) || !(row.bore >= 0 && row.bore < row.length)) throw new Error('Invalid stratum: ' + row.id);
  const lead = Math.max(...rows.map(row => row.bore));
  const tail = Math.max(...rows.map(row => row.length - row.bore - 1));
  const cells = lead + 1 + tail;

  // Where each puzzle lives: a link where following it is part of the way in, plain text where it is not.
  const links = { '2026': '/photos/', '2023': '/eras/2023/', '2018': '/eras/2018/', '2014': '/eras/2014/', '2011': '/eras/2011/photos.html', '2007': '/eras/2007/', '2003': '/eras/2003/', '1999': '/eras/1999/', '1996': '/eras/1996/' };
  const whereLink = row => {
    if (row.link) return '<a href="' + escape(row.link) + '">' + escape(row.where) + '</a>';
    // Kept out of Cloudflare's address scrambling, so the address reads the same in the page source.
    if (row.id === 'ranger') return '<!--email_off--><a href="mailto:ranger@g3rry.com">' + escape(row.where) + '</a><!--/email_off-->';
    if (row.id === 'dial-tone') return '<a href="/eras/dialup.html">' + escape(row.where) + '</a>';
    if (row.id === 'disallow' || row.id === 'dig') return escape(row.where);
    return links[row.stratum] ? '<a href="' + links[row.stratum] + '">' + escape(row.where) + '</a>' : escape(row.where);
  };
  const contactSheet = '<ol class="contact-sheet">' + sheet.map((frame, i) => '<li><span class="frame-number">' + String(i + 1).padStart(2, '0') + '</span><span class="frame-note">'
    + escape(frame.note) + '</span><span class="frame-letter">letter ' + frame.n + '</span></li>').join('') + '</ol>';

  const strata = [...new Set(rows.map(row => row.stratum))];
  const years = strata.filter(stratum => /^\d+$/.test(stratum)), bedrock = strata.filter(stratum => !/^\d+$/.test(stratum));
  if (years.length > YEAR_TONES.length || bedrock.length > BEDROCK_TONES.length) throw new Error('More strata than tones.');
  const tone = stratum => /^\d+$/.test(stratum) ? YEAR_TONES[years.indexOf(stratum)] : BEDROCK_TONES[bedrock.indexOf(stratum)];

  // The mountain's profile, wide enough to reach both edges of the section; its peak stands above the borehole and
  // its rock is the surface stratum, so the strata below read as the inside of the same mountain.
  const ridge = '<div class="ridge" aria-hidden="true"><svg viewBox="0 0 3200 150" focusable="false">'
    + '<path class="ridge-rock" d="M0 130 L180 124 L360 128 L540 118 L700 123 L800 124 L890 112 L960 118 L1050 96 L1110 104 L1190 84 L1250 92 L1320 70 L1380 78 L1440 52 L1500 60 L1552 30 L1600 6 L1630 28 L1658 21 L1700 48 L1760 40 L1830 66 L1890 58 L1960 84 L2040 78 L2120 100 L2200 94 L2280 112 L2400 118 L2560 124 L2760 119 L2950 127 L3200 123 L3200 150 L0 150 Z"/>'
    + '<path class="ridge-snow" d="M1586 22 L1600 6 L1616 25 L1608 21 L1601 31 L1594 23 Z"/>'
    + '<g class="summit-flags" id="summit-flags" data-peak="1600" data-top="6"></g></svg></div>';

  const rowHtml = row => {
    const depth = strata.indexOf(row.stratum);
    const first = rows.find(other => other.stratum === row.stratum) === row;
    const boxes = Array.from({ length: row.length }, (_, i) => '<span class="cell' + (i === row.bore ? ' bore' : '') + '"></span>').join('');
    return `<li class="stratum ${/^\d+$/.test(row.stratum) ? 'year' : 'bedrock'}${first ? ' first' : ''}" id="${row.id}" data-puzzle="${row.id}" data-length="${row.length}" data-depth="${depth}" data-stratum="${escape(row.stratum)}">
      <div class="stratum-text">
        <p class="stratum-label"><span class="stratum-year">${escape(row.stratum)}</span><span class="stratum-where">${whereLink(row)}</span></p>
        <h2 tabindex="-1">${escape(row.title)}</h2>
        <p class="stratum-flavor">${escape(row.flavor)}</p>
        ${row.id === 'contact-sheet' ? contactSheet : ''}
        <form class="answer" data-puzzle="${row.id}" novalidate>
          <label class="visually-hidden" for="answer-${row.id}">Answer to ${escape(row.title)} (${row.length} letters)</label>
          <input id="answer-${row.id}" name="answer" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="${row.length} letters" disabled>
          <button type="submit" disabled>Check</button>
        </form>
        <p class="answer-note" role="status"></p>
        <div class="notes" data-puzzle="${row.id}" hidden>
          <ol class="ranger-notes"></ol>
          <button type="button" class="notes-button">The ranger’s notes</button>
        </div>
        <p class="field-note" hidden></p>
      </div>
      <div class="boxes" data-lead="${lead - row.bore}" aria-hidden="true">${boxes}</div>
    </li>`;
  };

  const body = `<section class="strata wrap" aria-labelledby="strata-title">
  <header class="strata-intro">
    <p class="eyebrow"><span class="gold-line" aria-hidden="true"></span>${escape(content.intro.kicker)}</p>
    <h1 id="strata-title">${escape(content.intro.title)}</h1>
    <p class="intro">${escape(content.intro.text)}</p>
    <p class="intro strata-help">Stuck in a layer? The ranger keeps three notes for each, and hands them out slowly.</p>
    <p class="strata-progress" id="strata-progress" role="status"></p>
  </header>
  <div class="section-view">
    ${ridge}
    <ol class="strata-list">
      ${rows.map(rowHtml).join('\n      ')}
    </ol>
  </div>
  <section class="borehole" aria-labelledby="borehole-title">
    <h2 id="borehole-title">The borehole</h2>
    <p class="intro">Read straight down from the summit. When you know what it says, you will know what to do; you can test what you read here.</p>
    <form class="answer" data-puzzle="meta" novalidate>
      <label class="visually-hidden" for="answer-meta">What the borehole says</label>
      <input id="answer-meta" name="answer" autocomplete="off" spellcheck="false" maxlength="40" placeholder="What it says" disabled>
      <button type="submit" disabled>Check</button>
    </form>
    <p class="answer-note" role="status"></p>
    <div class="notes" data-puzzle="meta" hidden>
      <ol class="ranger-notes"></ol>
      <button type="button" class="notes-button">The ranger’s notes</button>
    </div>
  </section>
  <section class="flags" aria-labelledby="flags-title">
    <h2 id="flags-title">Flags on the summit</h2>
    <p class="intro" id="flags-note">Everyone who comes up the whole mountain may plant a flag. None yet.</p>
    <ol class="flag-list" id="flag-list"></ol>
  </section>
  <noscript><p class="intro">Checking answers needs JavaScript; the puzzles themselves are all out on the site.</p></noscript>
</section>`;

  await mkdir(path.join(dist, 'strata/fonts'), { recursive: true });
  await copyFile(path.join(root, 'src/strata/strata.js'), path.join(dist, 'strata/strata.js'));
  for (const [, , pkg, file] of FONTS) await copyFile(path.join(root, 'node_modules/@fontsource', pkg, 'files', file), path.join(dist, 'strata/fonts', file));
  for (const stratum of strata) {
    const depth = strata.indexOf(stratum);
    await output('strata/layer-' + depth + '.svg', boundary(tone(stratum), depth + 1, stratum === bedrock[0]));
  }
  // Generated: the answer boxes line up on the borehole (each row is pushed right by `data-lead` cells), each stratum
  // has its tone and its boundary, and each year its type.
  const css = await readFile(path.join(root, 'src/strata/strata.css'), 'utf8');
  await output('strata/strata.css', FONTS.map(([family, weight, , file]) => `@font-face { font-family: "${family}"; font-weight: ${weight}; font-display: swap; src: url("fonts/${file}") format("woff2"); }`).join('\n') + '\n'
    + css + '\n.strata { --cells: ' + cells + '; --lead: ' + lead + '; --surface-tone: ' + tone(strata[0]) + '; }\n'
    + Array.from({ length: lead + 1 }, (_, n) => '.boxes[data-lead="' + n + '"] { padding-left: calc(' + n + ' * var(--cell)); }').join('\n') + '\n'
    + strata.map((stratum, depth) => '.stratum[data-depth="' + depth + '"] { --layer: ' + tone(stratum) + '; }\n.stratum.first[data-depth="' + depth + '"]::before { background-image: url("layer-' + depth + '.svg"); }').join('\n') + '\n'
    + Object.entries(YEAR_TYPE).map(([year, family]) => '.stratum[data-stratum="' + year + '"] .stratum-year { font-family: ' + family + '; }').join('\n') + '\n');
  await output('strata/index.html', render(body, {
    title: content.title, description: content.description, route: '/strata/', pageClass: 'strata-page', noindex: true,
    head: '<link rel="stylesheet" href="/strata/strata.css">', classicScripts: ['/strata/strata.js']
  }));
}
