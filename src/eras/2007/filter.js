/* gerry zhao (beta) - filter.js
   photos.html?tag=rain shows only that tag; photos.html?q=bridge searches the descriptions. */

(function () {
  var params = {}, pairs = location.search.slice(1).split('&');
  for (var i = 0; i < pairs.length; i++) { var kv = pairs[i].split('='); if (kv[0]) params[kv[0]] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); }
  var tag = params.tag, q = params.q && params.q.toLowerCase();
  if (!tag && !q) return;
  var items = document.getElementsByTagName('li'), shown = 0;
  for (var j = 0; j < items.length; j++) {
    var tags = items[j].getAttribute('data-tags');
    if (tags === null) continue;
    var match = tag ? (' ' + tags + ' ').indexOf(' ' + tag + ' ') >= 0 : items[j].getAttribute('data-text').indexOf(q) >= 0;
    if (match) shown++; else items[j].className = 'hidden';
  }
  var links = document.getElementsByTagName('a');
  for (var k = 0; k < links.length; k++) if (tag && links[k].getAttribute('href') == 'photos.html?tag=' + tag) links[k].className += ' on';
  var note = G.$('filter-note');
  G.text(note, shown + ' photo' + (shown == 1 ? '' : 's') + (tag ? ' tagged “' + tag + '”' : ' matching “' + params.q + '”') + '. ');
  var all = document.createElement('a'); all.href = 'photos.html'; all.appendChild(document.createTextNode('Show all'));
  note.appendChild(all);
  note.className = '';
  // Lightbox should step through what is shown only.
  var hidden = document.querySelectorAll ? document.querySelectorAll('li.hidden a.lightbox') : [];
  for (var h = 0; h < hidden.length; h++) hidden[h].className = '';
})();
