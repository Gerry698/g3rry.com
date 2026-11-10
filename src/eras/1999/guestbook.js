// Gerry Zhao Online - guestbook.js
// Reads the live guestbook and writes it into the table, rows in alternating colours.
// 2026: fetch, from the current guestbook.
var table = document.getElementById('entries');

function pad(n) { return n < 10 ? '0' + n : String(n); }
function cell(text, row, width) {
  var td = document.createElement('td');
  td.vAlign = 'top';
  if (width) td.width = width;
  var font = document.createElement('font');
  font.face = 'Verdana,Arial,Helvetica';
  font.size = '1';
  var lines = String(text).split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (i) font.appendChild(document.createElement('br'));
    font.appendChild(document.createTextNode(lines[i]));
  }
  td.appendChild(font);
  row.appendChild(td);
  return font;
}
function clearRows() {
  while (table.rows.length > 1) table.deleteRow(1);
}

fetch('/api/guestbook', { headers: { Accept: 'application/json' } }).then(function (response) {
  if (!response.ok) throw new Error(response.status);
  return response.json();
}).then(function (data) {
  clearRows();
  var seen = {}, all = (data.pinned || []).concat(data.entries || []), n = 0;
  for (var i = 0; i < all.length; i++) {
    var note = all[i];
    if (seen[note.id]) continue;
    seen[note.id] = true;
    var row = table.insertRow(table.rows.length);
    row.bgColor = n % 2 ? '#EEEEEE' : '#FFFFFF';
    var d = new Date(note.date);
    cell(note.name || 'Anonymous', row, 110);
    cell(pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear(), row, 90);
    var message = cell(note.message, row);
    if (note.reply) {
      message.appendChild(document.createElement('br'));
      var reply = document.createElement('i');
      reply.appendChild(document.createTextNode('Reply from Gerry: ' + note.reply.message));
      message.appendChild(reply);
    }
    n++;
  }
  if (!n) { var empty = table.insertRow(1); empty.bgColor = '#FFFFFF'; cell('No entries yet.', empty).parentNode.colSpan = 3; }
})['catch'](function () {
  clearRows();
  var row = table.insertRow(1);
  row.bgColor = '#FFFFFF';
  cell('The guestbook could not be loaded. Please try again later.', row).parentNode.colSpan = 3;
});
