// Notes as a Material list, each with a coloured letter avatar.
(async () => {
  const list = document.getElementById('notes') || document.getElementById('latest-notes');
  if (!list) return;
  const limit = list.id === 'latest-notes' ? 3 : 100;
  const colours = ['#e91e63', '#9c27b0', '#3f51b5', '#009688', '#ff9800', '#795548', '#607d8b', '#4caf50'];
  const colourFor = name => colours[[...name].reduce((sum, ch) => sum + ch.codePointAt(0), 0) % colours.length];
  const when = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const item = (children) => { const li = document.createElement('li'); li.className = 'list-item'; li.append(...children); return li; };
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
  try {
    const response = await fetch('/api/guestbook', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status);
    const data = await response.json();
    const seen = new Set();
    const notes = [...(data.pinned || []), ...(data.entries || [])].filter(note => !seen.has(note.id) && seen.add(note.id)).slice(0, limit);
    list.textContent = '';
    for (const note of notes) {
      const name = note.name || 'Visitor';
      const avatar = text('span', name.charAt(0).toUpperCase(), 'avatar');
      avatar.style.background = colourFor(name);
      const body = document.createElement('div');
      body.append(text('p', name, 'primary'), text('p', note.message), text('p', when(note.date), 'secondary'));
      if (note.reply && limit > 3) body.append(text('p', 'Gerry: ' + note.reply.message, 'reply'));
      list.append(item([avatar, body]));
    }
    if (!notes.length) list.append(item([text('span', 'No notes yet.', 'secondary')]));
  } catch (error) {
    list.textContent = '';
    list.append(item([text('span', 'Notes could not be loaded.', 'secondary')]));
  }
})();
