// Notes, written onto the legal pad: the name in pen, the note after it.
(function () {
  var list = document.getElementById('notes') || document.getElementById('latest');
  if (!list) return;
  var limit = list.id === 'latest' ? 4 : 100;
  function clear() { while (list.firstChild) list.removeChild(list.firstChild); }
  function add(name, text, className) {
    var li = document.createElement('li');
    if (className) li.className = className;
    if (name) { var b = document.createElement('b'); b.appendChild(document.createTextNode(name)); li.appendChild(b); }
    li.appendChild(document.createTextNode(text));
    list.appendChild(li);
  }
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/guestbook');
  xhr.setRequestHeader('Accept', 'application/json');
  xhr.onload = function () {
    clear();
    if (xhr.status !== 200) { add('', 'The notes could not be loaded just now.'); return; }
    var data = JSON.parse(xhr.responseText), seen = {}, n = 0, all = (data.pinned || []).concat(data.entries || []);
    for (var i = 0; i < all.length && n < limit; i++) {
      if (seen[all[i].id]) continue;
      seen[all[i].id] = true;
      add(all[i].name || 'Someone', all[i].message.replace(/\s+/g, ' '));
      if (all[i].reply && limit > 4) add('Gerry', all[i].reply.message.replace(/\s+/g, ' '), 'reply');
      n++;
    }
    if (!n) add('', 'Nothing here yet. Be the first!');
  };
  xhr.onerror = function () { clear(); add('', 'The notes could not be loaded just now.'); };
  xhr.send();
})();
