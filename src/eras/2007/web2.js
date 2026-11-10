/* gerry zhao (beta) - web2.js
   the grey "Search photos..." hint that clears on focus, and dates that say how long ago. */

var G = {
  $: function (id) { return document.getElementById(id); },
  // "about 2 years ago", the way every 2007 site said it.
  ago: function (time) {
    var s = Math.round((new Date().getTime() - time) / 1000);
    if (s < 60) return 'less than a minute ago';
    var m = Math.round(s / 60); if (m < 45) return m + ' minute' + (m == 1 ? '' : 's') + ' ago';
    var h = Math.round(m / 60); if (h < 24) return 'about ' + h + ' hour' + (h == 1 ? '' : 's') + ' ago';
    var d = Math.round(h / 24); if (d < 30) return d + ' day' + (d == 1 ? '' : 's') + ' ago';
    var mo = Math.round(d / 30); if (mo < 12) return 'about ' + mo + ' month' + (mo == 1 ? '' : 's') + ' ago';
    var y = Math.round(d / 365); return 'about ' + y + ' year' + (y == 1 ? '' : 's') + ' ago';
  },
  text: function (el, value) { while (el.firstChild) el.removeChild(el.firstChild); el.appendChild(document.createTextNode(value)); }
};

(function () {
  var q = G.$('q'), hint = 'Search photos...';
  q.onfocus = function () { if (q.value == hint) { q.value = ''; q.className = 'active'; } };
  q.onblur = function () { if (q.value == '') { q.value = hint; q.className = ''; } };
  function search() { if (q.value && q.value != hint) location.href = 'photos.html?q=' + encodeURIComponent(q.value); }
  G.$('go').onclick = search;
  q.onkeydown = function (e) { if ((e || window.event).keyCode == 13) search(); };
  var spans = document.getElementsByTagName('span');
  for (var i = 0; i < spans.length; i++) if (spans[i].className == 'ago' && spans[i].getAttribute('data-time')) G.text(spans[i], G.ago(Number(spans[i].getAttribute('data-time'))));
})();
