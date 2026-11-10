// Not part of any year: this connects the page to the modem service worker (/eras/modem.js) and keeps the
// "Your modem" choices in step with the chosen speed. Nothing chosen means each year's usual modem.
(function () {
  'use strict';
  var SETTING = '/eras/modem-setting', STORE = 'eras-modem';
  // The one list of speeds every page offers: bits per second and the label on a 1996 or 1999 page.
  var SPEEDS = [[14400, '14.4'], [28800, '28.8'], [33600, '33.6'], [48000, '56K'], [0, 'no modem']];
  // What each slowed year had in the shops, and the speed it assumes when nothing is chosen (as modem.js does).
  // A speed chosen elsewhere that a year did not sell is still shown there, so the page never names the wrong one.
  var YEARS = { 1996: { usual: 28800, sold: [14400, 28800, 33600, 0] }, 1999: { usual: 48000, sold: [14400, 28800, 33600, 48000, 0] } };
  var supported = 'serviceWorker' in navigator && 'caches' in window;
  var ready = supported
    ? navigator.serviceWorker.register('/eras/modem.js', { scope: '/eras/' }).then(function () { return navigator.serviceWorker.ready; }).catch(function () { return null; })
    : Promise.resolve(null);

  function get() {
    if (!supported) return Promise.resolve(null);
    return caches.open(STORE).then(function (cache) { return cache.match(SETTING); })
      .then(function (stored) { return stored ? stored.json() : null; })
      .then(function (data) { return data && typeof data.bps === 'number' ? data.bps : null; })
      .catch(function () { return null; });
  }
  function set(bps) {
    if (!supported) return Promise.resolve();
    return caches.open(STORE).then(function (cache) {
      if (bps === null) return cache.delete(SETTING);
      return cache.put(SETTING, new Response(JSON.stringify({ bps: bps }), { headers: { 'Content-Type': 'application/json' } }));
    }).catch(function () {});
  }
  // Resolves once this page itself goes through the modem, so the next page it opens will.
  function controlled() {
    return ready.then(function (registration) {
      if (!registration || navigator.serviceWorker.controller) return registration;
      return new Promise(function (resolve) {
        navigator.serviceWorker.addEventListener('controllerchange', function () { resolve(registration); }, { once: true });
        setTimeout(function () { resolve(registration); }, 3000);
      });
    });
  }
  window.Modem = { get: get, set: set, ready: controlled, supported: supported, speeds: SPEEDS };

  // On a page of a slowed year, reload so the new speed applies to it at once.
  function choose(bps) {
    set(bps).then(function () { if (/^\/eras\/(1996|1999)\//.test(location.pathname)) location.reload(); });
  }
  // [14.4] [28.8] [33.6] [no modem]: the speed in use in bold, the others as links.
  function links(line, bps) {
    var year = YEARS[line.getAttribute('data-modem-links')];
    if (!year) return;
    var current = bps === null ? year.usual : bps;
    while (line.firstChild) line.removeChild(line.firstChild);
    line.appendChild(document.createTextNode('Your modem: '));
    var known = false;
    SPEEDS.forEach(function (speed) {
      if (speed[0] === current) known = true;
      if (speed[0] !== current && year.sold.indexOf(speed[0]) < 0) return;
      line.appendChild(document.createTextNode('['));
      if (speed[0] === current) {
        var bold = document.createElement('b');
        bold.appendChild(document.createTextNode(speed[1]));
        line.appendChild(bold);
      } else {
        var link = document.createElement('a');
        link.href = '#';
        link.appendChild(document.createTextNode(speed[1]));
        link.addEventListener('click', function (event) { event.preventDefault(); choose(speed[0]); });
        line.appendChild(link);
      }
      line.appendChild(document.createTextNode('] '));
    });
    if (!known) {
      var odd = document.createElement('b');
      odd.appendChild(document.createTextNode('[' + (current / 1000) + 'K] '));
      line.appendChild(odd);
    }
    line.appendChild(document.createTextNode('· '));
  }

  var menus = document.querySelectorAll('[data-modem]');
  var lines = document.querySelectorAll('[data-modem-links]');
  if (!supported) return;
  get().then(function (bps) {
    Array.prototype.forEach.call(menus, function (menu) {
      var value = bps === null ? '' : String(bps);
      if (!Array.prototype.some.call(menu.options, function (option) { return option.value === value; })) value = menu.options[0].value;
      menu.value = value;
      menu.disabled = false;
      menu.addEventListener('change', function () { choose(menu.value === '' ? null : Number(menu.value)); });
    });
    Array.prototype.forEach.call(lines, function (line) { links(line, bps); });
  });
})();
