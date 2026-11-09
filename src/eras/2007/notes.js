/* gerry zhao (beta) - notes.js
   loads the guestbook with AJAX (asynchronous JavaScript and XML; it is JSON now) while the spinner turns. */

(function () {
  var latest = G.$('latest-notes'), list = G.$('notes');
  function text(tag, value, className) { var e = document.createElement(tag); if (className) e.className = className; e.appendChild(document.createTextNode(value)); return e; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function failed(el) { clear(el); el.appendChild(text(el == list ? 'li' : 'p', 'Oops! Notes could not be loaded. Try again later.')); }

  var request = new XMLHttpRequest();
  request.open('GET', '/api/guestbook', true);
  request.setRequestHeader('Accept', 'application/json');
  request.onreadystatechange = function () {
    if (request.readyState != 4) return;
    if (request.status != 200) { if (latest) failed(latest); if (list) failed(list); return; }
    var data;
    try { data = JSON.parse(request.responseText); } catch (e) { if (latest) failed(latest); if (list) failed(list); return; }
    var seen = {}, notes = [], all = (data.pinned || []).concat(data.entries || []);
    for (var i = 0; i < all.length; i++) if (!seen[all[i].id]) { seen[all[i].id] = true; notes.push(all[i]); }
    if (latest) {
      clear(latest);
      for (var j = 0; j < Math.min(4, notes.length); j++) {
        var p = document.createElement('p');
        p.appendChild(text('b', notes[j].name || 'Anonymous'));
        p.appendChild(document.createTextNode(': ' + notes[j].message.slice(0, 90) + (notes[j].message.length > 90 ? '…' : '') + ' '));
        p.appendChild(text('span', G.ago(notes[j].date), 'ago'));
        latest.appendChild(p);
      }
      if (!notes.length) latest.appendChild(text('p', 'No notes yet.'));
    }
    if (list) {
      clear(list);
      for (var k = 0; k < notes.length; k++) {
        var li = document.createElement('li');
        var face = document.createElement('img');
        face.src = 'images/avatar.png'; face.width = 48; face.height = 48; face.alt = ''; face.className = 'avatar';
        li.appendChild(face);
        var bubble = document.createElement('div'); bubble.className = 'bubble';
        bubble.appendChild(text('b', notes[k].name || 'Anonymous'));
        bubble.appendChild(document.createTextNode(' '));
        bubble.appendChild(text('span', G.ago(notes[k].date), 'ago'));
        var lines = notes[k].message.split('\n');
        var body = document.createElement('p');
        for (var n = 0; n < lines.length; n++) { if (n) body.appendChild(document.createElement('br')); body.appendChild(document.createTextNode(lines[n])); }
        bubble.appendChild(body);
        if (notes[k].reply) bubble.appendChild(text('p', 'Gerry: ' + notes[k].reply.message, 'reply'));
        li.appendChild(bubble);
        list.appendChild(li);
      }
      if (!notes.length) list.appendChild(text('li', 'No notes yet. Be the first!'));
    }
  };
  request.send(null);
})();
