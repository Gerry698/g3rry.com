// The latest note from the guestbook, in its tile.
const quote = document.querySelector('#latest-note');
try {
  const response = await fetch('/api/guestbook', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(String(response.status));
  const { pinned = [], entries = [] } = await response.json();
  const note = [...pinned, ...entries][0];
  if (!note) quote.textContent = 'No notes yet. Yours could be the first.';
  else {
    quote.textContent = '“' + note.message + '”';
    const cite = document.createElement('cite');
    cite.textContent = '— ' + (note.name || 'a visitor') + ', ' + new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-Math.round((Date.now() - note.date) / 86400000), 'day');
    quote.append(cite);
  }
} catch {
  quote.textContent = 'The notes could not load just now.';
}
