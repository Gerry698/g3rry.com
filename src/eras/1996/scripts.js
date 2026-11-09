// Gerry's home page scripts. JavaScript 1.0 style, the kind Netscape 2.0 ran.

// <BLINK> only ever blinked in Netscape; this makes it blink everywhere.
var blinkOn = true;
function blink() {
  var tags = document.getElementsByTagName('blink');
  blinkOn = !blinkOn;
  for (var i = 0; i < tags.length; i++) tags[i].style.visibility = blinkOn ? 'visible' : 'hidden';
}
setInterval(blink, 600);

// Random year in the Time Ring.
var randomLink = document.getElementById('ring-random');
if (randomLink) {
  randomLink.onclick = function () {
    var years = ['1996', '1999', '2003', '2007', '2011', '2014', '2018', '2023'];
    var here = location.pathname.split('/')[2];
    var pick = here;
    while (pick == here) pick = years[Math.floor(Math.random() * years.length)];
    location.href = '/eras/' + pick + '/';
    return false;
  };
}

// The hit counter, one GIF per digit.
var counterLine = document.getElementById('counter-line');
if (counterLine && window.fetch) {
  fetch('/api/counter?year=1996', { headers: { Accept: 'application/json' } }).then(function (response) {
    return response.ok ? response.json() : null;
  }).then(function (data) {
    if (!data || typeof data.count != 'number') return;
    var digits = String(data.count);
    while (digits.length < 6) digits = '0' + digits;
    var box = document.getElementById('counter');
    for (var i = 0; i < digits.length; i++) {
      var digit = document.createElement('img');
      digit.src = 'art/d' + digits.charAt(i) + '.gif';
      digit.width = 14; digit.height = 20; digit.alt = digits.charAt(i);
      box.appendChild(digit);
    }
    counterLine.hidden = false;
  })['catch'](function () {});
}
