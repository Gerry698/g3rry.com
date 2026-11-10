// Gerry Zhao Online - scripts.js
// Image rollovers, the photo of the week, the Y2K countdown and the visitor counter.

// ---- Rollovers: every image with an "over" picture swaps to it under the mouse. Preloaded, so the swap is instant.
var preloaded = new Array();
function setUpRollovers() {
  if (!document.images) return;
  for (var i = 0; i < document.images.length; i++) {
    var image = document.images[i];
    var over = image.getAttribute('data-over');
    if (!over) continue;
    var hover = new Image();
    hover.src = over;
    preloaded[preloaded.length] = hover;
    image.outSrc = image.src;
    image.overSrc = hover.src;
    image.onmouseover = function () { this.src = this.overSrc; };
    image.onmouseout = function () { this.src = this.outSrc; };
  }
}

// ---- Photo of the week: a different photograph each week of the year.
function photoOfTheWeek() {
  if (typeof photos == 'undefined' || !document.getElementById) return;
  var now = new Date();
  var start = new Date(now.getFullYear(), 0, 1);
  var week = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
  var pick = photos[week % photos.length];
  var image = document.getElementById('week-photo');
  if (!image) return;
  image.src = pick[0]; image.width = pick[1]; image.height = pick[2]; image.alt = pick[4];
  document.getElementById('week-link').href = pick[3];
  var caption = document.getElementById('week-caption');
  caption.firstChild.nodeValue = pick[4];
}

// ---- Y2K: days left until 1 January 2000.
// 2026: counted from today's month and day in 1999, so the page stays in its year.
function y2k() {
  var box = document.getElementById && document.getElementById('y2k');
  if (!box) return;
  var now = new Date();
  var today = new Date(1999, now.getMonth(), now.getDate());
  box.firstChild.nodeValue = String(Math.round((new Date(2000, 0, 1) - today) / (24 * 60 * 60 * 1000)));
}

// ---- The counter, as green LCD digits. 2026: fetch, from the counter of the current site.
function counter() {
  var box = document.getElementById && document.getElementById('counter');
  if (!box || !window.fetch) return;
  fetch('/api/counter?year=1999', { headers: { Accept: 'application/json' } }).then(function (response) {
    return response.ok ? response.json() : null;
  }).then(function (data) {
    if (!data || typeof data.count != 'number') return;
    var digits = String(data.count);
    while (digits.length < 7) digits = '0' + digits;
    while (box.firstChild) box.removeChild(box.firstChild);
    for (var i = 0; i < digits.length; i++) {
      var digit = new Image(13, 19);
      digit.src = 'images/c' + digits.charAt(i) + '.gif';
      digit.alt = digits.charAt(i);
      box.appendChild(digit);
    }
    document.getElementById('visitors').hidden = false;
  })['catch'](function () {});
}

setUpRollovers();
photoOfTheWeek();
y2k();
counter();
