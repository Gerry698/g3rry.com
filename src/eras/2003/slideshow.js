/* gerry zhao :: slideshow.js
   click a thumbnail and the big picture fades over. opacity for mozilla and safari;
   IE wanted filter: alpha(opacity=n) instead, and got it from a branch that is gone now. */

var slide = document.getElementById('slide');
var caption = document.getElementById('caption');
var links = document.getElementById('filmstrip').getElementsByTagName('a');
var current = 0, playing = null, fading = null;

function setOpacity(el, value) { el.style.opacity = value; }

function show(index, instant) {
  index = (index + links.length) % links.length;
  var link = links[index];
  for (var i = 0; i < links.length; i++) links[i].className = i == index ? 'on' : '';
  current = index;
  if (location.hash != '#' + link.id) history.replaceState(null, '', '#' + link.id);
  var swap = function () {
    slide.src = link.href;
    slide.width = link.getAttribute('data-width');
    slide.height = link.getAttribute('data-height');
    slide.alt = link.getAttribute('data-alt');
    while (caption.firstChild) caption.removeChild(caption.firstChild);
    var strong = document.createElement('strong');
    strong.appendChild(document.createTextNode(link.getAttribute('data-title')));
    caption.appendChild(strong);
    caption.appendChild(document.createTextNode(' · ' + link.getAttribute('data-alt')));
  };
  if (instant) { swap(); return; }
  clearInterval(fading);
  var step = 10;
  fading = setInterval(function () {
    step--;
    setOpacity(slide, step / 10);
    if (step <= 0) {
      clearInterval(fading);
      swap();
      var up = 0;
      fading = setInterval(function () { up++; setOpacity(slide, up / 10); if (up >= 10) clearInterval(fading); }, 30);
    }
  }, 25);
}

for (var i = 0; i < links.length; i++) {
  links[i].index = i;
  links[i].onclick = function () { show(this.index); return false; };
}
document.getElementById('prev').onclick = function () { show(current - 1); return false; };
document.getElementById('next').onclick = function () { show(current + 1); return false; };
document.getElementById('play').onclick = function () {
  if (playing) { clearInterval(playing); playing = null; this.firstChild.nodeValue = 'play slideshow'; }
  else { playing = setInterval(function () { show(current + 1); }, 3500); this.firstChild.nodeValue = 'stop slideshow'; }
  return false;
};
// A link like photos.html#f07 opens on that frame.
var start = /^#f(\d\d)$/.exec(location.hash);
if (start) for (var k = 0; k < links.length; k++) if (links[k].id == 'f' + start[1]) show(k, true);
if (!start) links[0].className = 'on';
// The anchor scrolled the page down to the filmstrip; the viewer is at the top.
if (start) window.scrollTo(0, 0);
