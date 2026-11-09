// Strata hub: checks answers with the hunt Worker, keeps the strata you solved in this browser, shows the flags.
(() => {
  const STORE = 'strata-solved';
  const COLOURS = { red: '#d2513f', orange: '#e08a3c', yellow: '#e6c45a', green: '#5f9a62', blue: '#4f7fc2', white: '#eee9df' };
  const normalise = value => value.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let solved = {};
  try { solved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { solved = {}; }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(solved)); } catch { /* private window: progress lasts this visit */ } };

  const rows = [...document.querySelectorAll('.stratum')];
  const progress = document.querySelector('#strata-progress');
  const fill = (row, answer) => {
    row.querySelectorAll('.cell').forEach((cell, i) => { cell.textContent = answer[i] || ''; });
    row.classList.add('solved');
  };
  const count = () => {
    const done = rows.filter(row => row.classList.contains('solved')).length;
    progress.textContent = done ? done + ' of ' + rows.length + ' strata' : '';
  };
  for (const row of rows) {
    const answer = solved[row.dataset.puzzle];
    if (typeof answer === 'string' && answer.length === Number(row.dataset.length)) fill(row, answer);
  }
  count();

  const messages = {
    slow_down: 'Too many tries at once. Wait a minute.',
    bad_answer: 'Letters, please.',
    not_ready: 'The hunt is not open yet.'
  };
  for (const form of document.querySelectorAll('form.answer')) {
    const input = form.querySelector('input'), button = form.querySelector('button'), note = form.querySelector('output');
    input.disabled = button.disabled = false;
    const row = form.closest('.stratum');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const answer = normalise(input.value);
      note.className = 'answer-note';
      if (!answer) { note.textContent = messages.bad_answer; return; }
      if (row && answer.length !== Number(row.dataset.length)) { note.textContent = 'That has ' + answer.length + ' letters; this stratum holds ' + row.dataset.length + '.'; return; }
      button.disabled = true;
      note.textContent = 'Checking…';
      try {
        const response = await fetch('/api/hunt/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: form.dataset.puzzle, answer }) });
        const result = await response.json();
        if (!response.ok) note.textContent = messages[result.error] || 'That did not go through. Try again in a moment.';
        else if (result.correct) {
          note.textContent = 'Yes.';
          note.classList.add('good');
          if (row) { solved[row.dataset.puzzle] = answer; save(); fill(row, answer); count(); }
        } else note.textContent = result.nudge || 'Not this one.';
        if (result.nudge) note.classList.add('good');
      } catch {
        note.textContent = 'The mountain is out of reach just now.';
      } finally {
        button.disabled = false;
      }
    });
  }

  // Flags: a list below, and the newest few on the summit.
  const list = document.querySelector('#flag-list'), flagNote = document.querySelector('#flags-note'), summit = document.querySelector('#summit-flags');
  fetch('/api/hunt/flags').then(response => (response.ok ? response.json() : { flags: [] })).then(({ flags }) => {
    if (!flags.length) return;
    flagNote.textContent = flags.length === 1 ? 'One flag so far.' : flags.length + ' flags so far.';
    const date = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
    for (const flag of flags) {
      const item = document.createElement('li'), mark = document.createElement('span');
      mark.className = 'flag-mark flag-' + flag.colour;
      item.append(mark, '#' + flag.number + ' · ' + date.format(new Date(flag.date)));
      list.append(item);
    }
    const svg = 'http://www.w3.org/2000/svg', peak = Number(summit.dataset.peak);
    flags.slice(-12).forEach((flag, i) => {
      const x = peak + (i % 2 ? 1 : -1) * (6 + Math.floor(i / 2) * 7), y = 14 + Math.floor(i / 2) * 6;
      const pole = document.createElementNS(svg, 'line');
      for (const [name, value] of Object.entries({ x1: x, y1: y, x2: x, y2: y - 12 })) pole.setAttribute(name, value);
      const cloth = document.createElementNS(svg, 'path');
      cloth.setAttribute('d', 'M' + x + ' ' + (y - 12) + ' l7 2.5 l-7 2.5 Z');
      cloth.setAttribute('fill', COLOURS[flag.colour] || COLOURS.white);
      summit.append(pole, cloth);
    });
  }).catch(() => {});
})();
