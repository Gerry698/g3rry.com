/*!
 * GERRY ZHAO | Photography — app.js
 * Navbar on scroll, the hamburger, smooth scrolling, counters, portfolio filter, slider, testimonials, back to top.
 * Written without jQuery for once.
 */
;(function (window, document) {
  'use strict';

  var $ = function (selector) { return document.querySelector(selector); };
  var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };
  // 2026: a system that asks for less motion (prefers-reduced-motion, which 2014 did not have) gets no parallax,
  // no counting, no scrolling animation and no carousel turning by itself.
  var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (still) document.documentElement.className += ' still';

  // Navbar goes solid after the hero; the back-to-top button appears.
  var navbar = $('#navbar'), toTop = $('#to-top');
  function onScroll() {
    var y = window.pageYOffset;
    navbar.classList.toggle('solid', y > 80);
    toTop.classList.toggle('show', y > 600);
    counters();
  }
  window.addEventListener('scroll', onScroll);

  // Parallax, twice over: the band's photograph stays put while the page moves, and two thin layers over it move
  // with the page at their own speeds. Strata (depth-of-field): see the private solution book.
  var band = $('#band'), depths = $$('#band .depth'), queued = false, settle = null;
  function slide() {
    queued = false;
    var box = band.getBoundingClientRect(), off = (box.top + box.height / 2) - window.innerHeight / 2;
    depths.forEach(function (layer) {
      var shift = (off * 0.9 * Number(layer.getAttribute('data-direction'))).toFixed(1);
      layer.style.webkitTransform = layer.style.transform = 'translateX(-50%) translateX(' + shift + 'px)';
    });
  }
  // With less motion the layers do not follow the scroll; they take their place once the page comes to rest.
  function queue() {
    if (still) { clearTimeout(settle); settle = setTimeout(slide, 150); return; }
    if (!queued) { queued = true; window.requestAnimationFrame(slide); }
  }
  window.addEventListener('scroll', queue);
  window.addEventListener('resize', queue);
  slide();

  // Hamburger: a full-screen menu, even on a 27-inch monitor.
  var burger = $('#hamburger'), menu = $('#menu');
  function toggleMenu(open) {
    burger.classList.toggle('open', open);
    menu.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  burger.addEventListener('click', function () { toggleMenu(!menu.classList.contains('open')); });
  $$('#menu a').forEach(function (a) { a.addEventListener('click', function () { toggleMenu(false); }); });

  // Links within the page glide to their section, as $('html, body').animate({ scrollTop: ... }) did.
  function glide(to) {
    var from = window.pageYOffset, start = null;
    if (still) { window.scrollTo(0, to); return; }
    function step(t) {
      if (!start) start = t;
      var p = Math.min(1, (t - start) / 700), eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      window.scrollTo(0, from + (to - from) * eased);
      if (p < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }
  $$('a[href^="#"]').forEach(function (link) {
    var id = link.getAttribute('href').slice(1), target = id && document.getElementById(id);
    if (!target) return;
    link.addEventListener('click', function (e) {
      e.preventDefault();
      glide(id === 'top' ? 0 : target.getBoundingClientRect().top + window.pageYOffset);
    });
  });

  // Numbers count up the first time they scroll into view.
  var counted = false;
  function counters() {
    if (counted) return;
    var stats = $('.stats');
    if (stats.getBoundingClientRect().top > window.innerHeight * 0.85) return;
    counted = true;
    $$('.count').forEach(function (el) {
      var to = parseInt(el.getAttribute('data-to'), 10), suffix = el.getAttribute('data-suffix') || '', start = null;
      if (still) { el.textContent = to + suffix; return; }
      function step(t) {
        if (!start) start = t;
        var p = Math.min(1, (t - start) / 1600);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suffix;
        if (p < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    });
  }

  // Portfolio filter.
  var tiles = $$('.tile');
  $$('#filters button').forEach(function (button) {
    button.addEventListener('click', function () {
      $$('#filters button').forEach(function (b) { b.classList.remove('active'); });
      button.classList.add('active');
      var filter = button.getAttribute('data-filter');
      tiles.forEach(function (tile) { tile.classList.toggle('out', filter !== 'all' && tile.getAttribute('data-city') !== filter); });
    });
  });

  // Slider.
  var slider = $('#slider'), image = $('#slider-image'), count = $('#slider-count'), current = 0;
  function visible() { return tiles.filter(function (t) { return !t.classList.contains('out'); }); }
  function show(index) {
    var list = visible();
    current = (index + list.length) % list.length;
    var tile = list[current];
    image.src = tile.getAttribute('href');
    image.width = tile.getAttribute('data-width');
    image.height = tile.getAttribute('data-height');
    image.alt = tile.querySelector('img').alt;
    count.textContent = (current + 1) + ' / ' + list.length;
    slider.hidden = false;
  }
  tiles.forEach(function (tile) {
    tile.addEventListener('click', function (e) { e.preventDefault(); show(visible().indexOf(tile)); });
  });
  $('#slider-close').addEventListener('click', function () { slider.hidden = true; });
  $('#slider-prev').addEventListener('click', function () { show(current - 1); });
  $('#slider-next').addEventListener('click', function () { show(current + 1); });
  document.addEventListener('keydown', function (e) {
    if (slider.hidden) return;
    if (e.keyCode === 27) slider.hidden = true; else if (e.keyCode === 37) show(current - 1); else if (e.keyCode === 39) show(current + 1);
  });

  // Testimonials: the guestbook, one note at a time. The carousel waits while the pointer or the focus is on it,
  // and stops for good once a dot is chosen.
  var carousel = $('#carousel'), dots = $('#dots'), notes = [], at = 0, timer = null, chosen = false;
  function render(i) {
    var note = notes[i];
    var quote = document.createElement('p'); quote.className = 'quote'; quote.textContent = '“' + note.message + '”';
    var who = document.createElement('p'); who.className = 'who'; who.textContent = note.name || 'A visitor';
    carousel.textContent = '';
    carousel.appendChild(quote); carousel.appendChild(who);
    $$('#dots button').forEach(function (d, k) { d.classList.toggle('active', k === i); });
    at = i;
  }
  function stop() { clearInterval(timer); timer = null; }
  function start() {
    stop();
    if (still || chosen || notes.length < 2) return;
    timer = setInterval(function () { render((at + 1) % notes.length); }, 6000);
  }
  [carousel, dots].forEach(function (el) {
    el.addEventListener('mouseenter', stop);
    el.addEventListener('mouseleave', start);
    el.addEventListener('focusin', stop);
    el.addEventListener('focusout', start);
  });
  function failed() { carousel.textContent = 'The notes could not be loaded just now.'; }
  var request = new XMLHttpRequest();
  request.open('GET', '/api/guestbook');
  request.setRequestHeader('Accept', 'application/json');
  request.onload = function () {
    if (request.status !== 200) { failed(); return; }
    var data;
    try { data = JSON.parse(request.responseText); } catch (e) { failed(); return; }
    var seen = {};
    (data.pinned || []).concat(data.entries || []).forEach(function (n) { if (!seen[n.id]) { seen[n.id] = true; notes.push(n); } });
    notes = notes.slice(0, 6);
    if (!notes.length) { carousel.textContent = 'No notes yet.'; return; }
    notes.forEach(function (n, k) {
      var d = document.createElement('button'); d.type = 'button'; d.setAttribute('aria-label', 'Note ' + (k + 1));
      d.addEventListener('click', function () { chosen = true; stop(); render(k); });
      dots.appendChild(d);
    });
    render(0);
    start();
  };
  request.onerror = failed;
  request.send();

  onScroll();
})(window, document);
