// Other years: a link to /eras/#y2003 opens that year's notes.
(function () {
  'use strict';
  function open() {
    var item = location.hash && document.getElementById(location.hash.slice(1));
    var notes = item && item.querySelector('details');
    if (notes) notes.open = true;
  }
  window.addEventListener('hashchange', open);
  open();
})();
