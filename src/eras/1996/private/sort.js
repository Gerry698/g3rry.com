// Apache sorted its folder listings by the column named in the query string (?N=A, ?M=D, ...). This server only
// has files, so the browser does the sorting.
(function () {
  var query = /^\?([NMSD])=([AD])$/.exec(location.search);
  var key = query ? query[1] : 'N', order = query ? query[2] : 'A';
  var months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  var listing = document.getElementById('listing');
  var rows = [].slice.call(listing.getElementsByTagName('span'));
  function value(row) {
    var text = row.textContent;
    if (key === 'M') {
      var m = /(\d\d)-(\w{3})-(\d{4}) (\d\d):(\d\d)/.exec(text);
      return Date.UTC(+m[3], months[m[2]], +m[1], +m[4], +m[5]);
    }
    if (key === 'S') return parseInt(/\s(\d+)k\s/.exec(text)[1], 10);
    return row.getElementsByTagName('a')[0].firstChild.nodeValue;
  }
  if (key !== 'D') rows.sort(function (a, b) {
    var x = value(a), y = value(b), c = x < y ? -1 : x > y ? 1 : 0;
    return order === 'A' ? c : -c;
  });
  for (var i = 0; i < rows.length; i++) listing.appendChild(rows[i]);
  // The column just sorted now links to the reverse order; the others sort ascending.
  var columns = ['N', 'M', 'S', 'D'];
  for (var j = 0; j < columns.length; j++) {
    document.getElementById('sort-' + columns[j]).href = 'index.html?' + columns[j] + '=' + (columns[j] === key && order === 'A' ? 'D' : 'A');
  }
})();
