// Strata (/strata/): the hub of the hunt. The mountain in cross-section, one stratum per puzzle, answer boxes
// aligned so that a borehole from the summit passes through one letter of each. Answers are checked by the hunt
// Worker; this page holds no answers, only their lengths and where the borehole crosses them.
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

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
    if (row.id === 'ranger') return '<a href="mailto:ranger@g3rry.com">' + escape(row.where) + '</a>';
    if (row.id === 'dial-tone') return '<a href="/eras/dialup.html">' + escape(row.where) + '</a>';
    if (row.id === 'disallow' || row.id === 'dig') return escape(row.where);
    return links[row.stratum] ? '<a href="' + links[row.stratum] + '">' + escape(row.where) + '</a>' : escape(row.where);
  };
  const contactSheet = '<ol class="contact-sheet">' + sheet.map((frame, i) => '<li><span class="frame-number">' + String(i + 1).padStart(2, '0') + '</span><span class="frame-note">'
    + escape(frame.note) + '</span><span class="frame-letter">letter ' + frame.n + '</span></li>').join('') + '</ol>';

  // The summit stands right above the borehole.
  const summit = x => {
    const p = (dx, y) => (x + dx).toFixed(1) + ' ' + y;
    return '<svg class="summit" viewBox="0 0 400 120" aria-hidden="true" focusable="false"><path d="M0 120 L' + p(-80, 70) + ' L' + p(-35, 86) + ' L' + p(0, 8) + ' L' + p(36, 64) + ' L' + p(62, 52) + ' L400 120 Z"/>'
      + '<path class="summit-snow" d="M' + p(-14, 40) + ' L' + p(0, 8) + ' L' + p(14, 40) + ' L' + p(6, 34) + ' L' + p(0, 42) + ' L' + p(-7, 34) + ' Z"/>'
      + '<g class="summit-flags" id="summit-flags" data-peak="' + x.toFixed(1) + '"></g></svg>';
  };
  const strata = [...new Set(rows.map(row => row.stratum))];
  const band = stratum => /^\d+$/.test(stratum) ? 'year' : 'bedrock';
  const rowHtml = (row, index) => {
    const boxes = Array.from({ length: row.length }, (_, i) => '<span class="cell' + (i === row.bore ? ' bore' : '') + '"></span>').join('');
    return `<li class="stratum ${band(row.stratum)}" id="${row.id}" data-puzzle="${row.id}" data-length="${row.length}" data-depth="${strata.indexOf(row.stratum)}">
      <div class="stratum-text">
        <p class="stratum-label"><span class="stratum-year">${escape(row.stratum)}</span><span class="stratum-where">${whereLink(row)}</span></p>
        <h2>${escape(row.title)}</h2>
        <p class="stratum-flavor">${escape(row.flavor)}</p>
        ${row.id === 'contact-sheet' ? contactSheet : ''}
        <form class="answer" data-puzzle="${row.id}" novalidate>
          <label class="visually-hidden" for="answer-${row.id}">Answer to ${escape(row.title)} (${row.length} letters)</label>
          <input id="answer-${row.id}" name="answer" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="${row.length} letters" disabled>
          <button type="submit" disabled>Check</button>
          <output class="answer-note" for="answer-${row.id}" aria-live="polite"></output>
        </form>
      </div>
      <div class="boxes" data-lead="${lead - row.bore}" aria-hidden="true">${boxes}</div>
    </li>`;
  };

  const body = `<section class="strata wrap" aria-labelledby="strata-title">
  <header class="strata-intro">
    <p class="eyebrow"><span class="gold-line" aria-hidden="true"></span>${escape(content.intro.kicker)}</p>
    <h1 id="strata-title">${escape(content.intro.title)}</h1>
    <p class="intro">${escape(content.intro.text)}</p>
    <p class="strata-progress" id="strata-progress" aria-live="polite"></p>
  </header>
  <div class="section-view">
    ${summit((lead + .5) / cells * 400)}
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
      <output class="answer-note" for="answer-meta" aria-live="polite"></output>
    </form>
  </section>
  <section class="flags" aria-labelledby="flags-title">
    <h2 id="flags-title">Flags on the summit</h2>
    <p class="intro" id="flags-note">Everyone who reaches the top may plant one flag. None yet.</p>
    <ol class="flag-list" id="flag-list"></ol>
  </section>
  <noscript><p class="intro">Checking answers needs JavaScript; the puzzles themselves are all out on the site.</p></noscript>
</section>`;

  await mkdir(path.join(dist, 'strata'), { recursive: true });
  await copyFile(path.join(root, 'src/strata/strata.js'), path.join(dist, 'strata/strata.js'));
  // The answer boxes line up on the borehole: each row is pushed right by `data-lead` cells.
  const css = await readFile(path.join(root, 'src/strata/strata.css'), 'utf8');
  await output('strata/strata.css', css + '\n.strata { --cells: ' + cells + '; --lead: ' + lead + '; }\n'
    + Array.from({ length: lead + 1 }, (_, n) => '.boxes[data-lead="' + n + '"] { padding-left: calc(' + n + ' * var(--cell)); }').join('\n') + '\n');
  await output('strata/index.html', render(body, {
    title: content.title, description: content.description, route: '/strata/', pageClass: 'strata-page', noindex: true,
    head: '<link rel="stylesheet" href="/strata/strata.css">', classicScripts: ['/strata/strata.js']
  }));
}
