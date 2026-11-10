// Strata hub: checks answers with the hunt Worker, keeps the strata you solved in this browser (the dial-up page
// sends them to the summit board), hands out the ranger's notes slowly, and shows the flags.
(() => {
  const COLOURS = { red: '#d2513f', orange: '#e08a3c', yellow: '#e6c45a', green: '#5f9a62', blue: '#4f7fc2', white: '#eee9df' };
  const NOTE_WAIT = 120_000; // between one of the ranger's notes and the next
  const normalise = value => value.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const load = key => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: this visit only */ } };
  const solved = load('strata-solved'), fieldNotes = load('strata-notes'), hints = load('strata-hints');

  const list = document.querySelector('.strata-list');
  const rows = [...document.querySelectorAll('.stratum')];
  const progress = document.querySelector('#strata-progress');
  rows.forEach((row, i) => row.querySelector('.cell.bore')?.style.setProperty('--i', i));
  const fill = (row, answer) => {
    row.querySelectorAll('.cell').forEach((cell, i) => { cell.textContent = answer[i] || ''; });
    row.classList.add('solved');
    const note = row.querySelector('.field-note');
    if (note && fieldNotes[row.dataset.puzzle]) { note.textContent = fieldNotes[row.dataset.puzzle]; note.hidden = false; }
  };
  const count = () => {
    const done = rows.filter(row => row.classList.contains('solved')).length;
    progress.textContent = done ? done + ' of ' + rows.length + ' strata' : '';
    return done;
  };
  for (const row of rows) {
    const answer = solved[row.dataset.puzzle];
    if (typeof answer === 'string' && answer.length === Number(row.dataset.length)) fill(row, answer);
  }
  if (count() === rows.length) list.classList.add('cored');

  const messages = {
    slow_down: 'Too many tries at once. Wait a minute.',
    enough_for_today: 'That is enough guessing for one day. The ranger’s notes may help.',
    bad_answer: 'Letters, please.',
    not_ready: 'The hunt is not open yet.'
  };
  for (const form of document.querySelectorAll('form.answer')) {
    const input = form.querySelector('input'), button = form.querySelector('button');
    const row = form.closest('.stratum');
    const note = (row || form.parentElement).querySelector('.answer-note');
    input.disabled = button.disabled = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      note.className = 'answer-note';
      if (/[Ѐ-ӿ]/.test(input.value)) { note.textContent = 'In English, please.'; return; }
      const answer = normalise(input.value);
      if (!answer) { note.textContent = messages.bad_answer; return; }
      const length = row ? Number(row.dataset.length) : 0;
      button.disabled = true;
      note.textContent = 'Checking…';
      try {
        const response = await fetch('/api/hunt/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: form.dataset.puzzle, answer }) });
        const result = await response.json();
        if (!response.ok) note.textContent = messages[result.error] || 'That did not go through. Try again in a moment.';
        else if (result.correct) {
          note.textContent = 'Yes.';
          note.classList.add('good');
          if (row) {
            solved[row.dataset.puzzle] = answer; store('strata-solved', solved);
            if (result.note) { fieldNotes[row.dataset.puzzle] = result.note; store('strata-notes', fieldNotes); }
            fill(row, answer);
            row.querySelector('h2').focus();
            if (count() === rows.length) list.classList.add('cored');
          }
        } else if (result.nudge) {
          note.textContent = result.nudge;
          note.classList.add('good');
        } else if (length && answer.length !== length) {
          note.textContent = /^\d+$/.test(answer) ? 'That is a number; this stratum holds ' + length + ' letters.' : 'That has ' + answer.length + ' letters; this stratum holds ' + length + '.';
        } else note.textContent = 'Not this one.';
      } catch {
        note.textContent = 'The mountain is out of reach just now.';
      } finally {
        button.disabled = false;
      }
    });
  }

  // The ranger's notes: three per stratum, the next one a little while after the last.
  for (const box of document.querySelectorAll('.notes')) {
    const id = box.dataset.puzzle, button = box.querySelector('.notes-button'), shown = box.querySelector('.ranger-notes');
    const state = hints[id] || (hints[id] = { notes: [], at: 0 });
    let tiers = 3, timer = 0;
    const show = text => { const item = document.createElement('li'); item.textContent = text; shown.append(item); };
    state.notes.forEach(show);
    const refresh = () => {
      clearTimeout(timer);
      if (state.notes.length >= tiers) { button.hidden = true; return; }
      const wait = state.at + NOTE_WAIT - Date.now();
      if (state.notes.length && wait > 0) {
        button.disabled = true;
        const seconds = Math.ceil(wait / 1000);
        button.textContent = 'Another note in ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        timer = setTimeout(refresh, Math.min(wait, 1000));
        return;
      }
      button.disabled = false;
      button.textContent = state.notes.length ? 'Another note' : 'The ranger’s notes';
    };
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const response = await fetch('/api/hunt/hint?id=' + encodeURIComponent(id) + '&tier=' + (state.notes.length + 1));
        if (!response.ok) throw new Error(String(response.status));
        const result = await response.json();
        tiers = result.tiers;
        state.notes.push(result.text); state.at = Date.now(); store('strata-hints', hints);
        show(result.text);
        shown.lastElementChild.setAttribute('tabindex', '-1');
        shown.lastElementChild.focus();
      } catch {
        button.textContent = 'The ranger is out on the trail. Try again later.';
        setTimeout(refresh, 5000);
        return;
      }
      refresh();
    });
    box.hidden = false;
    refresh();
  }

  // Flags: a list below, and the newest few on the summit. A flag this browser planted is marked as yours.
  const flagList = document.querySelector('#flag-list'), flagNote = document.querySelector('#flags-note'), summit = document.querySelector('#summit-flags');
  const mine = load('strata-flag');
  fetch('/api/hunt/flags', { cache: 'no-store' }).then(response => (response.ok ? response.json() : { flags: [] })).then(({ flags }) => {
    if (mine.number && !flags.some(flag => flag.number === mine.number)) flags.push(mine);
    if (!flags.length) return;
    flagNote.textContent = flags.length === 1 ? 'One flag so far.' : flags.length + ' flags so far.';
    const date = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
    for (const flag of flags) {
      const item = document.createElement('li'), mark = document.createElement('span');
      mark.className = 'flag-mark flag-' + flag.colour;
      item.append(mark, '#' + flag.number + ' · ' + date.format(new Date(flag.date)) + (flag.strata === rows.length ? ' · the whole mountain' : ''));
      if (flag.number === mine.number) { item.classList.add('mine'); item.append(' · yours'); }
      flagList.append(item);
    }
    const svg = 'http://www.w3.org/2000/svg', peak = Number(summit.dataset.peak), top = Number(summit.dataset.top);
    const make = (name, attributes) => { const node = document.createElementNS(svg, name); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; };
    flags.slice(-12).forEach((flag, i) => {
      const side = i % 2 ? 1 : -1, step = Math.floor(i / 2);
      const x = peak + side * (8 + step * 9), y = top + 8 + step * 5 + (side > 0 ? 3 : 1);
      const group = make('g', flag.number === mine.number ? { class: 'mine' } : {});
      group.append(make('line', { x1: x, y1: y, x2: x, y2: y - 14 }), make('path', { d: 'M' + x + ' ' + (y - 14) + ' l8 2.8 l-8 2.8 Z', fill: COLOURS[flag.colour] || COLOURS.white }));
      if (flag.strata === rows.length) group.append(make('circle', { class: 'finial', cx: x, cy: y - 15, r: 1.4 }));
      summit.append(group);
    });
  }).catch(() => {});
})();
