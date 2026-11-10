/* gerry zhao :: comments.js
   the guestbook, laid out like the comments under a blog post. */

var box = document.getElementById('comments');
var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function para(text, className) {
  var p = document.createElement('p');
  if (className) p.className = className;
  var lines = String(text).split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (i) p.appendChild(document.createElement('br'));
    p.appendChild(document.createTextNode(lines[i]));
  }
  return p;
}
function stamp(ms) {
  var d = new Date(ms), h = d.getHours(), m = d.getMinutes();
  return monthNames[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' at ' + ((h + 11) % 12 + 1) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM');
}
function empty() { while (box.firstChild) box.removeChild(box.firstChild); }

function failed() {
  empty();
  box.appendChild(para('Comments could not be loaded just now.'));
}
function render(data) {
  empty();
  var seen = {}, all = (data.pinned || []).concat(data.entries || []), n = 0;
  for (var i = 0; i < all.length; i++) {
    var note = all[i];
    if (seen[note.id]) continue;
    seen[note.id] = true;
    var div = document.createElement('div');
    div.className = 'comment';
    div.appendChild(para(note.message));
    if (note.reply) div.appendChild(para('Gerry: ' + note.reply.message, 'reply'));
    div.appendChild(para('Posted by ' + (note.name || 'Anonymous') + ' on ' + stamp(note.date), 'posted'));
    box.appendChild(div);
    n++;
  }
  if (!n) box.appendChild(para('No comments yet.'));
}

var request = new XMLHttpRequest();
request.open('GET', '/api/guestbook', true);
request.setRequestHeader('Accept', 'application/json');
request.onreadystatechange = function () {
  if (request.readyState != 4) return;
  if (request.status != 200) { failed(); return; }
  // 2026: JSON.parse; in 2003 the text would have been handed to eval.
  var data;
  try { data = JSON.parse(request.responseText); } catch (e) { failed(); return; }
  render(data);
};
request.send(null);
