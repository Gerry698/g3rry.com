// The guestbook, read from the live guestbook of this site and written out the way guestbook.pl from Matt's Script
// Archive wrote its entries: the comments in bold, the name (linked when there is an address), then the place and
// the date, then a rule. 2026: fetch, from the current guestbook, which keeps no addresses or towns.
var box = document.getElementById('entries');
var dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// The address in the page's footer, which is further down than this script.
function mailto() {
  var links = document.getElementsByTagName('a');
  for (var i = 0; i < links.length; i++) if (links[i].href.indexOf('mailto:') == 0) return links[i].href;
  return '';
}

function two(n) { return n < 10 ? '0' + n : String(n); }
// "Monday, November 2, 1996 at 03:49:00", as the script's $date had it.
function when(ms) {
  var d = new Date(ms);
  return dayNames[d.getDay()] + ', ' + monthNames[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()
    + ' at ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}
function text(value, parent) { parent.appendChild(document.createTextNode(value)); }
function br(parent) { parent.appendChild(document.createElement('br')); }
function entry(note) {
  var comments = document.createElement('b');
  var lines = String(note.message).split('\n');
  for (var i = 0; i < lines.length; i++) { if (i) br(comments); text(lines[i], comments); }
  box.appendChild(comments);
  br(box);
  if (note.owner && mailto()) {
    var link = document.createElement('a');
    link.href = mailto();
    text(note.name || 'Gerry', link);
    box.appendChild(link);
  } else text(note.name || 'Anonymous', box);
  br(box);
  text(' - ' + when(note.date) + ' ', box);
  if (note.reply) {
    br(box);
    var reply = document.createElement('i');
    text('Gerry wrote back: ' + note.reply.message, reply);
    box.appendChild(reply);
  }
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
  if (!shown) text('Nobody has signed yet. Be the first!', box);
})['catch'](function () {
  while (box.firstChild) box.removeChild(box.firstChild);
  text('Sorry, the guestbook could not be loaded right now. Try again later!', box);
});
