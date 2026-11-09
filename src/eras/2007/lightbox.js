/* gerry zhao (beta) - lightbox.js
   photographs open over the dimmed page. click the left or right half to step, Esc or the X to close. */

(function () {
  var links = [], current = 0, box, frame, image, caption, loading;
  var all = document.getElementsByTagName('a');
  for (var i = 0; i < all.length; i++) if (/(^| )lightbox( |$)/.test(all[i].className)) links.push(all[i]);
  if (!links.length) return;

  function el(tag, id, parent) { var e = document.createElement(tag); if (id) e.id = id; if (parent) parent.appendChild(e); return e; }
  function build() {
    var overlay = el('div', 'overlay', document.body);
    box = el('div', 'lightbox', document.body);
    frame = el('div', 'lightbox-frame', box);
    image = el('img', 'lightbox-image', frame);
    image.alt = '';
    loading = el('img', 'lightbox-loading', frame);
    loading.src = 'images/spinner.gif'; loading.width = 24; loading.height = 24; loading.alt = 'Loading';
    var prev = el('a', 'lightbox-prev', frame), next = el('a', 'lightbox-next', frame), close = el('a', 'lightbox-close', frame);
    prev.href = next.href = close.href = '#';
    var x = el('img', null, close); x.src = 'images/close.png'; x.width = 30; x.height = 30; x.alt = 'Close';
    caption = el('div', 'lightbox-caption', frame);
    overlay.onclick = hide; close.onclick = function () { hide(); return false; };
    prev.onclick = function () { show(current - 1); return false; };
    next.onclick = function () { show(current + 1); return false; };
    document.onkeydown = function (e) {
      if (!box || box.style.display == 'none') return;
      var k = (e || window.event).keyCode;
      if (k == 27) hide(); else if (k == 37) show(current - 1); else if (k == 39) show(current + 1);
    };
  }
  function hide() { document.getElementById('overlay').style.display = 'none'; box.style.display = 'none'; }
  function show(index) {
    if (!box) build();
    index = (index + links.length) % links.length;
    current = index;
    var link = links[index];
    document.getElementById('overlay').style.display = 'block';
    box.style.display = 'block';
    loading.style.display = 'block';
    image.style.visibility = 'hidden';
    var next = new Image();
    next.onload = function () {
      var maxW = window.innerWidth - 80, maxH = window.innerHeight - 160, w = next.width, h = next.height;
      var scale = Math.min(1, maxW / w, maxH / h);
      image.src = next.src; image.width = Math.round(w * scale); image.height = Math.round(h * scale);
      image.alt = link.getElementsByTagName('img')[0].alt;
      image.style.visibility = 'visible';
      loading.style.display = 'none';
    };
    next.src = link.href;
    while (caption.firstChild) caption.removeChild(caption.firstChild);
    var b = document.createElement('b'); b.appendChild(document.createTextNode(link.getAttribute('data-title') || '')); caption.appendChild(b);
    caption.appendChild(document.createElement('br'));
    var exif = link.getAttribute('data-exif');
    caption.appendChild(document.createTextNode((exif ? exif + '  ·  ' : '') + 'Image ' + (index + 1) + ' of ' + links.length));
  }
  for (var j = 0; j < links.length; j++) {
    links[j].index = j;
    links[j].onclick = function () { show(this.index); return false; };
  }
})();
