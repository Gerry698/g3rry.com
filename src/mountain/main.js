import { createTerrain, QUALITY } from './terrain.js';
import { buildScene } from './scene.js';
import { MAX_PENNANTS } from './props.js';
import { createRenderer } from './renderer.js';
import { PALETTES, TIMES, blend } from './palettes.js';
import { perspective, lookAt, multiply, invert, transform, clamp, lerp, easeInOut, smoothstep, mix3 } from './math.js';
import { eyeOf, idlePose, stationPose, sway, travelTime, interpolate, clampToGround } from './camera.js';

const root = document.documentElement;
const canvas = document.querySelector('#mountain-canvas');
const items = [...document.querySelectorAll('#mountain-route > li')];
const ui = Object.fromEntries(['intro', 'begin', 'card', 'card-kicker', 'card-title', 'card-text', 'card-extra', 'card-link', 'card-pending', 'altitude', 'hint']
  .map(id => [id, document.querySelector('#mountain-' + id)]));
const params = new URLSearchParams(location.search);
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = { get matches() { return reducedQuery.matches || params.get('motion') === 'reduce'; } };
const gl = canvas && items.length ? canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }) : null;
const meters = y => Math.round(900 + y * 340);

// Let the page paint its text first, then build the mountain (a few hundred milliseconds of work).
let started = false;
const kick = () => { if (!started) { started = true; start(); } };
if (gl) { requestAnimationFrame(() => setTimeout(kick, 30)); setTimeout(kick, 500); }
// Without WebGL2 the page keeps its plain camp list, over a still picture of the mountain.
else root.classList.add('mountain-static');

function sceneInWorker(request) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', event => { worker.terminate(); resolve(event.data); });
    worker.addEventListener('error', event => { worker.terminate(); reject(event.error || new Error(event.message)); });
    worker.postMessage(request);
  });
}

async function start() {
  const tier = QUALITY[params.get('quality')] ? params.get('quality') : matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700 ? 'low' : 'high';
  const quality = QUALITY[tier];
  const request = { tier, camps: items.map(item => ({ model: item.dataset.model || null, prints: item.dataset.prints ? item.dataset.prints.split(',') : null })) };
  let scene;
  try { scene = params.has('inline') ? buildScene(request) : await sceneInWorker(request); }
  catch { scene = buildScene(request); }
  const { camps, trail } = scene;
  const terrain = createTerrain();
  terrain.setLedges(scene.ledges);
  let renderer;
  try { renderer = createRenderer(gl, scene, quality); }
  catch (error) { console.error(error); return; }
  root.classList.add('mountain-live');

  // The Phantom camp's mark and the guestbook's notes arrive on their own time; the scene starts without them.
  const shapeUrl = items.find(item => item.dataset.shape)?.dataset.shape;
  if (shapeUrl) fetch(shapeUrl).then(response => response.json()).then(points => renderer.setSparkShape(new Float32Array(points))).catch(() => {});
  let pennants = 0, latestNote = null;
  if (items.some(item => item.dataset.model === 'summit')) fetch('/api/guestbook', { headers: { Accept: 'application/json' } })
    .then(response => response.ok ? response.json() : Promise.reject(new Error(response.status)))
    .then(notes => {
      pennants = Math.min(MAX_PENNANTS, notes.entries.length + (notes.next ? MAX_PENNANTS : 0));
      latestNote = notes.pinned?.[0] || notes.entries[0] || null;
      if (state.index >= 0 && items[state.index].dataset.model === 'summit') showCard(state.index);
    }).catch(() => {});

  const data = items.map((item, i) => {
    const link = item.querySelector('a');
    return {
      id: item.id, link, kicker: item.dataset.kicker || '', title: link.querySelector('.camp-title')?.textContent || '',
      text: item.querySelector('p')?.textContent || '', href: link.hasAttribute('data-pending') ? null : link.getAttribute('href'),
      time: PALETTES[item.dataset.time] ? item.dataset.time : TIMES[Math.round(i / Math.max(1, items.length - 1) * (TIMES.length - 1))]
    };
  });

  let layout = innerWidth >= innerHeight * .9 ? 'side' : 'stack';
  let stations = camps.map((camp, i) => stationPose(camp, camps.at(-1), i / Math.max(1, camps.length - 2), terrain, layout));
  const paletteOf = index => PALETTES[index < 0 ? 'idle' : data[index].time];
  const poseAt = (index, time) => index < 0 ? idlePose(reduced.matches ? 0 : time) : sway(stations[index], reduced.matches ? 0 : time, pointer);

  const state = { index: -1, travel: null, started: false, progress: -1, arrived: 0 };
  const phantomIndex = items.findIndex(item => item.dataset.model === 'phantom');
  let pointer = [0, 0], pointerTarget = [0, 0], pointerPower = 0, form = 0, current = null, clock = 0, ahead = 1, focus = null, clearing = 0, fadeIn = params.has('debug') ? 1 : 0, debugPose = null, debugPalette = null, debugHide = null;

  function go(index) {
    index = clamp(index, -1, data.length - 1);
    const target = state.travel ? state.travel.to : state.index;
    if (index === target) return;
    const from = current || poseAt(state.index, clock);
    const fromPalette = state.travel ? blend(state.travel.fromPalette, paletteOf(state.travel.to), easeInOut(state.travel.progress)) : paletteOf(state.index);
    const end = poseAt(index, clock + 2);
    const duration = reduced.matches ? .7 : travelTime(from, end);
    state.travel = { from, to: index, fromPalette, fromProgress: state.progress, start: clock, duration, progress: 0, cut: reduced.matches };
    state.started = true;
    showCard(null);
    root.classList.toggle('mountain-climbing', index >= 0);
    ui.hint && (ui.hint.hidden = true);
    markRoute(index);
  }
  const step = direction => go((state.travel ? state.travel.to : state.index) + direction);

  function arrive(index) {
    state.index = index;
    state.travel = null;
    state.arrived = clock;
    showCard(index);
    history.replaceState(null, '', index < 0 ? location.pathname + location.search : '#' + data[index].id);
  }

  function showCard(index) {
    if (!ui.card) return;
    ui.intro && ui.intro.classList.toggle('is-hidden', index !== -1 && state.started);
    if (index === null || index < 0) { ui.card.classList.remove('is-visible'); return; }
    const camp = data[index];
    ui['card-kicker'].textContent = camp.kicker + ' · ' + meters(camps[index].y).toLocaleString('en-US') + ' m';
    ui['card-title'].textContent = camp.title;
    ui['card-text'].textContent = camp.text;
    // Camps can carry more than a line of text: the Photography prints, the latest note in the summit register.
    const extra = items[index].querySelector('.camp-extra');
    ui['card-extra'].replaceChildren(...(extra ? [extra.cloneNode(true)] : []));
    if (items[index].dataset.model === 'summit' && latestNote) {
      const quote = document.createElement('blockquote'), body = document.createElement('p'), by = document.createElement('cite');
      quote.className = 'camp-extra camp-note';
      body.textContent = latestNote.message;
      by.textContent = latestNote.name + (latestNote.owner ? ' · site owner' : '');
      quote.append(body, by);
      ui['card-extra'].append(quote);
    }
    ui['card-link'].hidden = !camp.href;
    ui['card-pending'].hidden = Boolean(camp.href);
    if (camp.href) ui['card-link'].href = camp.href;
    ui.card.hidden = false;
    requestAnimationFrame(() => ui.card.classList.add('is-visible'));
  }

  function markRoute(index) {
    data.forEach((camp, i) => {
      if (i === index) camp.link.setAttribute('aria-current', 'step');
      else camp.link.removeAttribute('aria-current');
      camp.link.parentElement.classList.toggle('is-passed', i < index);
    });
  }

  // Input: one camp per wheel gesture; a pause of 180 ms starts a new gesture.
  let wheelTotal = 0, wheelLast = 0, wheelLocked = false;
  addEventListener('wheel', event => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const now = performance.now(), gap = now - wheelLast;
    wheelLast = now;
    if (gap > 180) { wheelTotal = 0; wheelLocked = false; }
    if (wheelLocked) return;
    wheelTotal += event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1);
    if (Math.abs(wheelTotal) > 45) { step(Math.sign(wheelTotal)); wheelLocked = true; }
  }, { passive: false });

  let press = null;
  canvas.addEventListener('pointerdown', event => { press = { x: event.clientX, y: event.clientY, time: performance.now() }; });
  canvas.addEventListener('pointerup', event => {
    if (!press) return;
    const dx = event.clientX - press.x, dy = event.clientY - press.y;
    press = null;
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) { step(dy < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) > 12) return;
    const hit = pick(event.clientX, event.clientY);
    if (hit >= 0) go(hit); else if ((state.travel ? state.travel.to : state.index) < data.length - 1) step(1);
  });
  let pointerSeen = -Infinity;
  canvas.addEventListener('pointermove', event => {
    pointerTarget = [event.clientX / innerWidth * 2 - 1, event.clientY / innerHeight * 2 - 1];
    pointerSeen = performance.now();
  });
  addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const onLink = event.target instanceof HTMLAnchorElement || event.target instanceof HTMLButtonElement;
    const keys = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 };
    if (event.key in keys) { event.preventDefault(); step(keys[event.key]); }
    else if (event.key === ' ' && !onLink) { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    else if (event.key === 'Home') { event.preventDefault(); go(-1); }
    else if (event.key === 'End') { event.preventDefault(); go(data.length - 1); }
    else if (event.key === 'Escape') go(-1);
    else if (event.key === 'Enter' && !onLink && state.index >= 0 && data[state.index].href) location.href = data[state.index].href;
  });
  ui.begin?.addEventListener('click', () => go(0));
  // A typed or pasted #camp link climbs (or descends) to that camp.
  addEventListener('hashchange', () => { const index = data.findIndex(camp => '#' + camp.id === location.hash); if (index >= 0) go(index); });
  data.forEach((camp, i) => camp.link.addEventListener('click', event => {
    if (i === state.index && !state.travel && camp.href) return;
    event.preventDefault();
    go(i);
  }));

  // Position along the trail for a progress value measured in camps.
  function trailAt(s) {
    let low = 0, high = trail.length - 1;
    if (s <= trail[0][3]) return trail[0].slice(0, 3).map((v, i) => i === 1 ? v + .06 : v);
    if (s >= trail[high][3]) return trail[high].slice(0, 3).map((v, i) => i === 1 ? v + .06 : v);
    while (high - low > 1) { const mid = (low + high) >> 1; if (trail[mid][3] < s) low = mid; else high = mid; }
    const t = (s - trail[low][3]) / (trail[high][3] - trail[low][3] || 1);
    return [0, 1, 2].map(i => lerp(trail[low][i], trail[high][i], t) + (i === 1 ? .06 : 0));
  }

  let projected = [];
  function pick(x, y) {
    let best = -1, distance = 34;
    projected.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (p[2] && d < distance) { distance = d; best = i; } });
    return best;
  }

  // Rendering
  let scaleFactor = 1, frameTimes = [], last = performance.now();
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, quality.dpr) * scaleFactor;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr)), height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    renderer.resize(width, height);
    const next = innerWidth >= innerHeight * .9 ? 'side' : 'stack';
    if (next !== layout) { layout = next; stations = camps.map((camp, i) => stationPose(camp, camps.at(-1), i / Math.max(1, camps.length - 2), terrain, layout)); }
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  function draw(now) {
    const delta = Math.min(.1, (now - last) / 1000);
    last = now;
    clock += delta;
    fadeIn = Math.min(1, fadeIn + delta / 1.4);
    pointer = pointer.map((v, i) => lerp(v, pointerTarget[i], Math.min(1, delta * 2)));

    let pose, palette, fade = easeInOut(fadeIn);
    const travel = state.travel;
    if (travel) {
      travel.progress = Math.min(1, (clock - travel.start) / travel.duration);
      const e = easeInOut(travel.progress);
      palette = blend(travel.fromPalette, paletteOf(travel.to), e);
      state.progress = lerp(travel.fromProgress, travel.to, e);
      if (travel.cut) {
        pose = travel.progress < .5 ? travel.from : poseAt(travel.to, clock);
        fade *= Math.abs(1 - travel.progress * 2);
      } else pose = interpolate(travel.from, poseAt(travel.to, travel.start + travel.duration), travel.progress);
      if (travel.progress >= 1) arrive(travel.to);
    } else {
      pose = poseAt(state.index, clock);
      palette = paletteOf(state.index);
      state.progress = state.index;
    }
    if (debugPose) pose = debugPose;
    if (debugPalette) palette = debugPalette;
    current = pose;

    const eye = clampToGround(eyeOf(pose), terrain);
    const aspect = canvas.width / canvas.height;
    const fov = (aspect < 1 ? 58 : 40) * Math.PI / 180;
    const projection = perspective(fov, aspect, renderer.near, renderer.far);
    const view = lookAt(eye, pose.target);
    const viewProj = multiply(projection, view);
    const settled = state.travel || state.index < 0 ? 0 : smoothstep(0, .8, clock - state.arrived);
    const here = state.index >= 0 ? camps[state.index] : camps[0];
    // The climber and the dots still ahead fade out once a camp is reached and come back when the climb resumes.
    const moving = state.travel || state.index < 0 ? 1 : 0;
    ahead = lerp(ahead, moving, Math.min(1, delta * (moving ? 4 : 1.6)));
    // Clouds part along the line of sight to the camp being approached or visited.
    const heading = state.travel ? state.travel.to : state.index;
    if (heading >= 0) { const camp = camps[heading]; focus = focus ? mix3(focus, [camp.x, camp.y + .2, camp.z], Math.min(1, delta * 2.5)) : [camp.x, camp.y + .2, camp.z]; }
    clearing = lerp(clearing, heading >= 0 ? 1 : 0, Math.min(1, delta * 1.5));
    // The Phantom's points gather into the mark while its camp is visited, and shy away from a moving pointer.
    form = lerp(form, state.index === phantomIndex && !state.travel ? 1 : 0, Math.min(1, delta * (form < .5 ? .9 : 1.6)));
    pointerPower = lerp(pointerPower, performance.now() - pointerSeen < 1200 ? 1 : 0, Math.min(1, delta * 3));
    const markers = {
      progress: state.progress, settled, pillar: [here.x, here.y, here.z, settled], climber: trailAt(state.progress), climberPower: smoothstep(-.4, 0, state.progress) * ahead,
      ahead, focus: [...(focus || [0, 0, 0]), clearing], pennants, form, pointer: [pointerTarget[0], -pointerTarget[1], reduced.matches ? 0 : pointerPower]
    };
    renderer.render({ eye, view, viewProj, invViewProj: invert(viewProj), fov, time: clock, palette, fade, markers, hide: debugHide, canvasWidth: canvas.width, canvasHeight: canvas.height });

    projected = camps.map(camp => {
      const p = transform(viewProj, [camp.x, camp.y + .25, camp.z]);
      return [(p[0] * .5 + .5) * innerWidth, (.5 - p[1] * .5) * innerHeight, p[3] > 0 && Math.abs(p[0]) < 1.1 && Math.abs(p[1]) < 1.1];
    });
    if (ui.altitude) ui.altitude.textContent = meters(eye[1]).toLocaleString('en-US');

    // Adaptive resolution: step down when frames run long, recover slowly.
    if (!params.has('timer')) frameTimes.push(delta);
    if (frameTimes.length === 45) {
      const average = frameTimes.reduce((a, b) => a + b) / frameTimes.length;
      frameTimes = [];
      const next = average > .024 ? Math.max(.5, scaleFactor * .8) : average < .0135 ? Math.min(1, scaleFactor * 1.06) : scaleFactor;
      if (Math.abs(next - scaleFactor) > .01) { scaleFactor = next; resize(); }
    }
  }
  let frames = 0;
  // High-refresh screens would otherwise redraw up to 240 times a second; ~80 is plenty for a slow orbit.
  let lastDrawn = -Infinity;
  const frame = now => {
    if (now - lastDrawn >= 12) { lastDrawn = now; draw(now); frames++; }
    schedule(frame);
  };
  // ?timer drives frames from a timer, for previews that pause animation frames while hidden.
  const schedule = params.has('timer') ? callback => setTimeout(() => callback(performance.now()), 30) : callback => requestAnimationFrame(callback);

  const initial = data.findIndex(camp => '#' + camp.id === location.hash);
  if (initial >= 0) { state.index = initial; state.progress = initial; state.started = true; root.classList.add('mountain-climbing'); markRoute(initial); showCard(initial); }
  else if (ui.hint) ui.hint.hidden = false;
  if (ui.begin) ui.begin.hidden = false;
  schedule(frame);

  if (params.has('clean')) root.classList.add('mountain-clean');
  if (params.has('timer')) root.classList.add('mountain-still');
  if (params.has('debug')) window.mountain = {
    terrain, camps, stations, data, PALETTES, go,
    pose(angle, radius, y, target = [0, 4.3, 0]) { debugPose = angle === undefined ? null : { angle: angle * Math.PI / 180, radius, y, target }; },
    time(name) { debugPalette = name ? PALETTES[name] : null; },
    get current() { return current; },
    get state() { return { ...state, travel: state.travel && { to: state.travel.to, progress: state.travel.progress } }; },
    // Average milliseconds per frame with the GPU forced to finish each one.
    bench(count = 40) {
      const pixel = new Uint8Array(4), start = performance.now();
      for (let i = 0; i < count; i++) { draw(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); }
      return { ms: +((performance.now() - start) / count).toFixed(2), size: [canvas.width, canvas.height] };
    },
    // Draws a frame and pins it as an image over the page: screenshots of a hidden preview can lag the canvas.
    snap() {
      draw(performance.now());
      let image = document.querySelector('#mountain-snap');
      if (!image) {
        image = Object.assign(document.createElement('img'), { id: 'mountain-snap', alt: '' });
        image.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none';
        canvas.after(image);
      }
      image.src = canvas.toDataURL('image/jpeg', .9);
      return new Promise(resolve => { image.onload = () => resolve('snapped'); });
    },
    unsnap() { document.querySelector('#mountain-snap')?.remove(); },
    hide(...names) { debugHide = new Set(names); return this.settle(); },
    // Stands in for the guestbook API, which the local preview does not have.
    notes(count, note = null) { pennants = Math.min(MAX_PENNANTS, count); latestNote = note; },
    pointer(x, y) { pointerTarget = [x, y]; pointerSeen = performance.now(); pointerPower = 1; },
    station(i) { state.index = i; state.arrived = clock - 2; ahead = 0; clearing = 1; focus = null; form = i === phantomIndex ? 1 : 0; debugPose = stations[i]; debugPalette = paletteOf(i); return this.settle(); },
    // Resolves once two fresh frames have been drawn, so screenshots never catch a stale pose.
    settle() { const start = frames; return new Promise(resolve => { const check = () => frames >= start + 2 ? resolve(frames) : setTimeout(check, 16); check(); }); },
    get quality() { return { tier, ...quality, samples: renderer.samples, float: renderer.float, scaleFactor }; }
  };
}
