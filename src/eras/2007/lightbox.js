/* gerry zhao (beta) - lightbox.js
   photographs open over the dimmed page, the way Lightbox 2 did it: a white box that grows from 250 x 250 to the
   size of the picture, the picture fading in, then the caption bar with CLOSE X. click the left or right half to
   step; Esc, X or C closes, P and N or the arrow keys step. */

(function () {
  var links = [], current = 0, built = false, timer = null;
  var overlay, box, outer, image, hoverNav, loading, dataBox, caption, number;
  var BORDER = 10, RESIZE = 400, FADE = 300;
  // 2026: a system that asks for less motion gets the picture at once (matchMedia).
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var all = document.getElementsByTagName('a');
  for (var i = 0; i < all.length; i++) if (/(^| )lightbox( |$)/.test(all[i].className)) links.push(all[i]);
  if (!links.length) return;

  function el(tag, id, parent) { var e = document.createElement(tag); if (id) e.id = id; if (parent) parent.appendChild(e); return e; }
  function build() {
    overlay = el('div', 'overlay', document.body);
    box = el('div', 'lightbox', document.body);
    outer = el('div', 'outerImageContainer', box);
    var inner = el('div', 'imageContainer', outer);
    image = el('img', 'lightboxImage', inner);
    image.alt = '';
    hoverNav = el('div', 'hoverNav', inner);
    var prev = el('a', 'prevLink', hoverNav), next = el('a', 'nextLink', hoverNav);
    prev.href = next.href = '#';
    prev.title = 'Previous'; next.title = 'Next';
    loading = el('div', 'loading', inner);
    var spin = el('img', null, loading);
    spin.src = 'images/spinner.gif'; spin.width = 24; spin.height = 24; spin.alt = 'Loading';
    dataBox = el('div', 'imageDataContainer', box);
    var data = el('div', 'imageData', dataBox), details = el('div', 'imageDetails', data);
    caption = el('span', 'caption', details);
    number = el('span', 'numberDisplay', details);
    var bottom = el('div', 'bottomNav', data), close = el('a', 'bottomNavClose', bottom);
    close.href = '#';
    var label = el('img', null, close);
    label.src = 'images/closelabel.gif'; label.width = 66; label.height = 22; label.alt = 'Close';
    overlay.onclick = hide;
    box.onclick = function (e) { if ((e || window.event).target == box) hide(); };
    close.onclick = function () { hide(); return false; };
    prev.onclick = function () { show(current - 1); return false; };
    next.onclick = function () { show(current + 1); return false; };
    document.onkeydown = function (e) {
      if (box.style.display == 'none') return;
      var k = (e || window.event).keyCode;
      if (k == 27 || k == 88 || k == 67) hide(); else if (k == 37 || k == 80) show(current - 1); else if (k == 39 || k == 78) show(current + 1);
    };
    built = true;
  }
  function text(el, value) { while (el.firstChild) el.removeChild(el.firstChild); el.appendChild(document.createTextNode(value)); }

  // Effect.Scale and Effect.Appear, more or less: a sinusoidal ease over a fixed time.
  function animate(ms, step, done) {
    clearInterval(timer);
    if (still) { step(1); done(); return; }
    var start = new Date().getTime();
    timer = setInterval(function () {
      var t = Math.min(1, (new Date().getTime() - start) / ms);
      step((1 - Math.cos(t * Math.PI)) / 2);
      if (t >= 1) { clearInterval(timer); done(); }
    }, 10);
  }
  function setOpacity(el, value) { el.style.opacity = value; el.style.filter = 'alpha(opacity=' + Math.round(value * 100) + ')'; }

  function hide() {
    clearInterval(timer);
    overlay.style.display = 'none';
    box.style.display = 'none';
  }
  function show(index) {
    if (!built) build();
    index = (index + links.length) % links.length;
    current = index;
    var link = links[index];
    overlay.style.display = 'block';
    box.style.display = 'block';
    loading.style.display = 'block';
    image.style.display = 'none';
    hoverNav.style.display = 'none';
    dataBox.style.display = 'none';
    var picture = new Image();
    picture.onload = function () {
      if (current != index) return;
      var maxW = (window.innerWidth || document.documentElement.clientWidth) - 80, maxH = (window.innerHeight || document.documentElement.clientHeight) - 140;
      var scale = Math.min(1, maxW / picture.width, maxH / picture.height);
      var w = Math.round(picture.width * scale), h = Math.round(picture.height * scale);
      image.src = picture.src; image.width = w; image.height = h;
      image.alt = link.getElementsByTagName('img')[0].alt;
      var fromW = outer.offsetWidth, fromH = outer.offsetHeight, toW = w + BORDER * 2, toH = h + BORDER * 2;
      animate(RESIZE, function (p) {
        outer.style.width = Math.round(fromW + (toW - fromW) * p) + 'px';
        outer.style.height = Math.round(fromH + (toH - fromH) * p) + 'px';
      }, function () {
        loading.style.display = 'none';
        setOpacity(image, 0);
        image.style.display = 'block';
        animate(FADE, function (p) { setOpacity(image, p); }, function () {
          hoverNav.style.display = 'block';
          dataBox.style.width = toW + 'px';
          text(caption, link.getAttribute('data-title') || link.title || '');
          var exif = link.getAttribute('data-exif');
          text(number, (exif ? exif + '  ·  ' : '') + 'Image ' + (index + 1) + ' of ' + links.length);
          dataBox.style.display = 'block';
        });
      });
    };
    picture.src = link.href;
  }
  for (var j = 0; j < links.length; j++) {
    links[j].index = j;
    links[j].onclick = function () { show(this.index); return false; };
  }
})();
