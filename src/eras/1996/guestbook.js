// The guestbook, read from the live guestbook of this site and written out the way a 1996 CGI script would.
var box = document.getElementById('entries');

function two(n) { return n < 10 ? '0' + n : String(n); }
function when(ms) {
  var d = new Date(ms);
  return two(d.getMonth() + 1) + '/' + two(d.getDate()) + '/' + two(d.getFullYear() % 100) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
}
function line(label, text, parent) {
  var b = document.createElement('b');
  b.appendChild(document.createTextNode(label + ' '));
  parent.appendChild(b);
  parent.appendChild(document.createTextNode(text));
  parent.appendChild(document.createElement('br'));
}
function entry(note) {
  var block = document.createElement('font');
  block.face = 'Arial,Helvetica';
  block.size = '2';
  line('Name:', note.name || 'Anonymous', block);
  line('Date:', when(note.date), block);
  var b = document.createElement('b');
  b.appendChild(document.createTextNode('Comments:'));
  block.appendChild(b);
  block.appendChild(document.createElement('br'));
  var lines = String(note.message).split('\n');
  for (var i = 0; i < lines.length; i++) {
    block.appendChild(document.createTextNode(lines[i]));
    block.appendChild(document.createElement('br'));
  }
  if (note.reply) {
    var reply = document.createElement('i');
    reply.appendChild(document.createTextNode('Gerry wrote back: ' + note.reply.message));
    block.appendChild(reply);
    block.appendChild(document.createElement('br'));
  }
  box.appendChild(block);
  box.appendChild(document.createElement('hr'));
}

fetch('/api/guestbook', { headers: { Accept: 'application/json' } }).then(function (response) {
  if (!response.ok) throw new Error(response.status);
  return response.json();
}).then(function (data) {
  while (box.firstChild) box.removeChild(box.firstChild);
  var seen = {}, all = (data.pinned || []).concat(data.entries || []), shown = 0;
  for (var i = 0; i < all.length; i++) {
    if (seen[all[i].id]) continue;
    seen[all[i].id] = true;
    entry(all[i]);
    shown++;
  }
  if (!shown) box.appendChild(document.createTextNode('Nobody has signed yet. Be the first!'));
})['catch'](function () {
  while (box.firstChild) box.removeChild(box.firstChild);
  box.appendChild(document.createTextNode('Sorry, the guestbook could not be loaded right now. Try again later!'));
});
