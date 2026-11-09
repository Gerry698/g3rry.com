// Not part of any year: this connects the page to the modem service worker (/eras/modem.js) and keeps the
// "Your modem" menus in step with the chosen speed. An empty value means each year's usual modem.
(function () {
  'use strict';
  var SETTING = '/eras/modem-setting', STORE = 'eras-modem';
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
  window.Modem = { get: get, set: set, ready: controlled, supported: supported };

  var menus = document.querySelectorAll('[data-modem]');
  if (!supported) return;
  get().then(function (bps) {
    Array.prototype.forEach.call(menus, function (menu) {
      var value = bps === null ? '' : String(bps);
      if (!Array.prototype.some.call(menu.options, function (option) { return option.value === value; })) value = menu.options[0].value;
      menu.value = value;
      menu.disabled = false;
      menu.addEventListener('change', function () {
        var choice = menu.value === '' ? null : Number(menu.value);
        set(choice).then(function () {
          // On a page of a slowed year, reload so the new speed applies to it at once.
          if (/^\/eras\/(1996|1999)\//.test(location.pathname)) location.reload();
        });
      });
    });
  });
})();
