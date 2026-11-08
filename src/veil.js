// Page transitions through black. A classic script in every page's <head>, so it runs before the first paint:
// a page reached through a transition starts black (html.veil-hold, see veil.css) and opens once it is ready, and
// the mountain calls g3veil.leave() to close the current page into black, with an effect drawn from the camp being
// left, before it navigates. The black hides the moment one heavy page is torn down and the next one starts.
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const KEY = 'g3-veil';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, alpha = 1) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';

  // Each effect draws the cover at p: 0 is fully open, 1 is black. Leaving runs p from 0 to 1, arriving from 1 to 0.
  // [leave, arrive] durations in milliseconds.
  const effects = {
    fade: { time: [280, 360], draw() {} },

    // A lens diaphragm: seven blades close around a heptagonal opening that turns as it shrinks.
    iris: {
      time: [760, 900],
      draw(c, w, h, p, scale) {
        const n = 7, cx = w / 2, cy = h / 2, reach = Math.hypot(w, h) / 2 * 1.04;
        const r = reach * (1 - p), turn = -Math.PI / 2 + p * 2 * Math.PI / n * .7;
        const R = r / Math.cos(Math.PI / n), far = reach * 3;
        const vignette = c.createRadialGradient(cx, cy, r * .5, cx, cy, Math.max(1, r));
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(0,0,0,' + (.45 * smooth(0, .4, p)) + ')');
        c.fillStyle = vignette;
        c.fillRect(0, 0, w, h);
        const corner = k => { const a = turn + (2 * k - 1) * Math.PI / n; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
        for (let k = 0; k < n; k++) {
          // Blade k shows between its own edge's ray and the previous blade's ray, so the overlaps spiral evenly.
          const phi = turn + 2 * k * Math.PI / n, nx = Math.cos(phi), ny = Math.sin(phi);
          const t = [-ny, nx], back = [-Math.sin(phi - 2 * Math.PI / n), Math.cos(phi - 2 * Math.PI / n)];
          const a = corner(k), b = corner(k + 1);
          c.beginPath();
          c.moveTo(a[0], a[1]);
          c.lineTo(b[0], b[1]);
          c.lineTo(b[0] + t[0] * far, b[1] + t[1] * far);
          c.lineTo(a[0] + back[0] * far, a[1] + back[1] * far);
          c.closePath();
          const sheen = c.createLinearGradient(cx + nx * r, cy + ny * r, cx + nx * (r + reach * .9), cy + ny * (r + reach * .9));
          sheen.addColorStop(0, '#36373c');
          sheen.addColorStop(.1, '#1d1e22');
          sheen.addColorStop(1, '#09090b');
          c.fillStyle = sheen;
          c.fill();
          c.lineWidth = scale;
          c.strokeStyle = 'rgba(255,255,255,.2)';
          c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
          const seam = c.createLinearGradient(b[0], b[1], b[0] + t[0] * reach * .7, b[1] + t[1] * reach * .7);
          seam.addColorStop(0, 'rgba(255,255,255,.13)');
          seam.addColorStop(1, 'rgba(255,255,255,0)');
          c.strokeStyle = seam;
          c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(b[0] + t[0] * reach, b[1] + t[1] * reach); c.stroke();
        }
      }
    },

    // A tent door: the zip runs from the floor to the ridge and the two flaps fold away; leaving zips it shut.
    tent: {
      time: [820, 1000],
      draw(c, w, h, p, scale) {
        const o = 1 - p, open = easeInOut(clamp(o / .85));
        const apex = h * (1.02 - 1.75 * open), spread = w * 1.3 * open;
        const half = y => y <= apex ? 0 : spread * Math.pow((y - apex) / (h - apex), .8);
        const steps = 28, edge = [];
        for (let i = 0; i <= steps; i++) { const y = i / steps * h; edge.push([w / 2 - half(y), y]); }
        const flap = () => {
          c.beginPath();
          c.moveTo(-2, -2);
          edge.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.lineTo(x, y - 2));
          c.lineTo(edge.at(-1)[0], h + 2);
          c.lineTo(-2, h + 2);
          c.closePath();
          // Folds bunch towards the side as the flap is drawn back.
          const width = Math.max(w * .14, w / 2 - half(h * .55));
          const folds = c.createLinearGradient(0, 0, width, 0);
          for (let i = 0; i <= 12; i++) folds.addColorStop(i / 12, i === 12 ? '#4c2a19' : i % 2 ? '#3f2115' : '#28130b');
          c.fillStyle = folds;
          c.fill();
          // Light from outside along the open edge, and the zip's teeth just inside it.
          c.lineJoin = 'round';
          c.beginPath();
          edge.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
          c.strokeStyle = 'rgba(255,170,100,.14)'; c.lineWidth = 9 * scale; c.stroke();
          c.strokeStyle = 'rgba(255,200,150,.6)'; c.lineWidth = scale; c.stroke();
          c.save();
          c.translate(-3 * scale, 0);
          c.setLineDash([2 * scale, 3 * scale]);
          c.strokeStyle = 'rgba(18,8,4,.85)'; c.lineWidth = 2 * scale; c.stroke();
          c.restore();
        };
        flap();
        c.save(); c.translate(w, 0); c.scale(-1, 1); flap(); c.restore();
        // While the door is shut, a thread of light shows through the zip.
        if (o < .12) {
          const glow = c.createLinearGradient(0, 0, 0, h);
          glow.addColorStop(0, 'rgba(255,190,120,0)');
          glow.addColorStop(.6, 'rgba(255,190,120,' + (.5 * (1 - o / .12) * (1 - smooth(.9, 1, p))) + ')');
          glow.addColorStop(1, 'rgba(255,190,120,.1)');
          c.fillStyle = glow;
          c.fillRect(w / 2 - scale, 0, 2 * scale, h);
        }
      }
    },

    // The page dissolves into points of light that swell and go dark, outward from where it was touched.
    points: {
      time: [780, 920],
      draw(c, w, h, p, scale, origin) {
        const size = Math.max(w, h) / 30, row = size * .866;
        const ox = origin[0] * w, oy = origin[1] * h;
        const reach = Math.max(Math.hypot(ox, oy), Math.hypot(w - ox, oy), Math.hypot(ox, h - oy), Math.hypot(w - ox, h - oy));
        const buckets = Array.from({ length: 9 }, () => []);
        for (let j = -1; j * row < h + row; j++) {
          const y = j * row;
          for (let x = j % 2 ? -size / 2 : -size; x < w + size; x += size) {
            const q = clamp(p * 1.8 - Math.hypot(x - ox, y - oy) / reach * .8);
            if (q > 0) buckets[Math.round(smooth(.08, .6, q) * 8)].push(x, y, size * .62 * Math.pow(q, 1.3));
          }
        }
        buckets.forEach((dots, i) => {
          if (!dots.length) return;
          c.fillStyle = rgb(mix([255, 207, 125], [0, 0, 0], i / 8));
          c.beginPath();
          for (let k = 0; k < dots.length; k += 3) { c.moveTo(dots[k] + dots[k + 2], dots[k + 1]); c.arc(dots[k], dots[k + 1], dots[k + 2], 0, 2 * Math.PI); }
          c.fill();
        });
      }
    },

    // A letter sealed: the side flaps fold in, the pocket rises, the top flap comes down and a wax seal is pressed.
    envelope: {
      time: [1050, 1050],
      draw(c, w, h, p, scale) {
        const cx = w / 2, cy = h * .52;
        const side = easeInOut(smooth(0, .34, p)), bottom = easeInOut(smooth(.14, .52, p)), flap = easeInOut(smooth(.4, .76, p)), seal = smooth(.7, .84, p);
        const tri = (points, fill, line) => {
          c.beginPath();
          points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
          c.closePath();
          c.fillStyle = fill; c.fill();
          if (line) { c.strokeStyle = line; c.lineWidth = scale; c.stroke(); }
        };
        const slide = (1 - side) * w * .6;
        tri([[-slide - 2, -2], [cx - slide, cy], [-slide - 2, h + 2]], '#0e1534', 'rgba(255,255,255,.06)');
        tri([[w + slide + 2, -2], [cx + slide, cy], [w + slide + 2, h + 2]], '#0e1534', 'rgba(255,255,255,.06)');
        const rise = (1 - bottom) * h * .75;
        tri([[-2, h + 2 + rise], [cx, cy + rise], [w + 2, h + 2 + rise]], '#131b42', 'rgba(255,255,255,.08)');
        // The top flap swings down from behind the top edge; past the middle of its turn its outside faces us.
        const tip = -cy + flap * (2 * cy + h * .05);
        if (tip > 0) tri([[-2, -2], [w + 2, -2], [cx, tip]], mixColor(flap), 'rgba(255,255,255,.1)');
        if (seal > 0) {
          const radius = Math.min(w, h) * .05 * (1 + .25 * Math.sin(seal * Math.PI)), sy = cy + h * .05;
          const wax = c.createRadialGradient(cx - radius * .3, sy - radius * .3, radius * .1, cx, sy, radius);
          wax.addColorStop(0, '#ffe0a3'); wax.addColorStop(.55, '#ffcf7d'); wax.addColorStop(1, '#b8803a');
          c.globalAlpha = seal;
          c.fillStyle = 'rgba(255,207,125,.18)';
          c.beginPath(); c.arc(cx, sy, radius * 2.2, 0, 2 * Math.PI); c.fill();
          c.fillStyle = wax;
          c.beginPath(); c.arc(cx, sy, radius, 0, 2 * Math.PI); c.fill();
          c.strokeStyle = 'rgba(120,70,20,.55)'; c.lineWidth = 1.5 * scale;
          c.beginPath(); c.arc(cx, sy, radius * .62, 0, 2 * Math.PI); c.stroke();
          c.globalAlpha = 1;
        }
        function mixColor(t) { return rgb(mix([28, 38, 86], [16, 23, 54], t)); }
      }
    }
  };

  // One cover canvas at a time, above everything.
  let veil = null;
  function mount(name, origin, blocking) {
    unmount();
    const canvas = document.createElement('canvas');
    canvas.className = 'veil' + (blocking ? ' is-blocking' : '');
    canvas.setAttribute('aria-hidden', 'true');
    (document.body || root).append(canvas);
    veil = { canvas, context: canvas.getContext('2d'), effect: effects[name] || effects.fade, name, origin: origin || [.5, .5], p: 0, run: 0 };
    root.classList.add('veil-active');
    return veil;
  }
  function unmount() {
    if (!veil) return;
    veil.canvas.remove();
    veil = null;
    root.classList.remove('veil-active');
  }
  function paint(p) {
    const { canvas, context: c, effect, origin } = veil;
    const scale = Math.min(2, devicePixelRatio || 1), w = Math.round(innerWidth * scale), h = Math.round(innerHeight * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    veil.p = p;
    c.clearRect(0, 0, w, h);
    if (p > 0) effect.draw(c, w, h, p, scale, origin);
    // Every effect ends in pure black; a plain fade is only this wash.
    const wash = veil.name === 'fade' || effect === effects.fade ? p : smooth(.82, 1, p);
    if (wash > 0) { c.fillStyle = 'rgba(0,0,0,' + wash + ')'; c.fillRect(0, 0, w, h); }
  }
  function play(to, duration) {
    const from = veil.p, run = ++veil.run, start = performance.now();
    return new Promise(resolve => {
      const frame = now => {
        if (!veil || veil.run !== run) return resolve(false);
        const t = clamp((now - start) / duration);
        paint(from + (to - from) * easeInOut(t));
        if (t < 1) requestAnimationFrame(frame); else resolve(true);
      };
      requestAnimationFrame(frame);
    });
  }

  // ---- Arriving: hold the page in black until it is ready, then open --------------------------------------------------
  let arrival = null;
  try {
    const entry = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    sessionStorage.removeItem(KEY);
    const navigation = performance.getEntriesByType?.('navigation')[0];
    if (entry && Date.now() - entry.at < 8000 && entry.to === location.pathname && (!navigation || navigation.type === 'navigate')) arrival = entry;
  } catch {}
  if (arrival) {
    root.classList.add('veil-hold');
    // Pages with their own start-up (the lab, a photograph's page) announce their first frame with "g3:ready".
    const ready = new Promise(resolve => {
      const waitForPage = root.hasAttribute('data-veil-wait');
      setTimeout(resolve, waitForPage ? 3500 : 1800);
      if (waitForPage) addEventListener('g3:ready', resolve, { once: true });
      else {
        const loaded = () => {
          const hero = document.querySelector('img[fetchpriority="high"]');
          Promise.all([document.fonts?.ready, hero?.decode?.().catch(() => {})]).then(resolve);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loaded, { once: true }); else loaded();
      }
    });
    ready.then(() => requestAnimationFrame(() => {
      const name = reduced() ? 'fade' : arrival.effect;
      mount(name, arrival.origin, false);
      paint(1);
      root.classList.remove('veil-hold');
      play(0, (effects[name] || effects.fade).time[1]).then(done => { if (done) unmount(); });
    }));
  }

  // ---- Leaving -------------------------------------------------------------------------------------------------------------
  let safety = 0;
  function reopen() {
    clearTimeout(safety);
    if (!veil) return;
    veil.canvas.classList.remove('is-blocking');
    dispatchEvent(new CustomEvent('g3:veil', { detail: 'open' }));
    play(0, veil.effect.time[1]).then(done => { if (done) unmount(); });
  }
  // Back to a page that left through a transition: the browser restored it from its cache still covered.
  addEventListener('pageshow', event => { if (event.persisted && veil && veil.p > 0) reopen(); });

  window.g3veil = {
    // For screenshots and tuning: one still frame of an effect at p, until clear().
    still(name, p, origin) { mount(name, origin, false); paint(p); },
    clear: unmount,
    // effect: a name above; origin: [x, y] in 0..1 of the window, where the points start from.
    leave({ effect = 'fade', href, origin } = {}) {
      const url = new URL(href, location.href);
      if (veil && veil.canvas.classList.contains('is-blocking')) return;
      const name = reduced() ? 'fade' : effect;
      mount(name, origin, true);
      play(1, (effects[name] || effects.fade).time[0]).then(done => {
        if (!done) return;
        dispatchEvent(new CustomEvent('g3:veil', { detail: 'covered' }));
        if (url.origin === location.origin) {
          try { sessionStorage.setItem(KEY, JSON.stringify({ effect: name, origin, to: url.pathname, at: Date.now() })); } catch {}
        }
        location.assign(url.href);
        // A navigation that was cancelled, or is taking very long: give the page back.
        safety = setTimeout(reopen, 12000);
      });
    }
  };
})();
