import { createTerrain, QUALITY } from './terrain.js';
import { buildScene } from './scene.js';
import { MAX_PENNANTS } from './props.js';
import { createRenderer, warmUp } from './renderer.js';
import { PALETTES } from './palettes.js';
import { perspective, lookAt, multiply, invert, transform, clamp, lerp, easeInOut, smoothstep, mix3, sub, normalize, dot, random, TAU } from './math.js';
import { eyeOf, idlePose, stationPose, valleyPose, orbitPose, orbitOf, ORBIT, sway, travelTime, interpolate, clampToGround, spacePose, planFlight, heartPose, enterHeart, doorPoses, diveIn, diveOut, FOV } from './camera.js';
import { conditions, skyPalette, createStorm } from './weather.js';
import { createSkyMenu, panel } from './sky-menu.js';
import { createGlobe } from './globe.js';
import { HEART } from './beyond.js';
import { createAudio } from './audio.js';

const root = document.documentElement;
const canvas = document.querySelector('#mountain-canvas');
const items = [...document.querySelectorAll('#mountain-route > li')];
// The chapters off the trail: one inside the mountain, one past the summit (beyond.js).
const beyondItems = Object.fromEntries([...document.querySelectorAll('#mountain-beyond > li')].map(item => [item.dataset.beyond, item]));
const ui = Object.fromEntries(['intro', 'begin', 'card', 'card-kicker', 'card-title', 'card-text', 'card-extra', 'card-link', 'card-pending', 'altitude', 'hint', 'loader', 'nudge', 'sound', 'sound-toggle', 'sound-themes', 'sound-volume', 'freecam']
  .map(id => [id, document.querySelector('#mountain-' + id)]));
const params = new URLSearchParams(location.search);
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = { get matches() { return reducedQuery.matches || params.get('motion') === 'reduce'; } };
const gl = canvas && items.length ? canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }) : null;
const meters = y => Math.round(900 + y * 340);
// The moon's mean distance, where the altitude meter ends up on the way there.
const MOON_KM = 384400, altitudeUnit = document.querySelector('#mountain-altitude + span');
// Entering a camp's page closes the mountain into black with the camp's own effect (veil.js).
const VEILS = { photography: 'iris', phantom: 'points', mailboxes: 'envelope', summit: 'tent', trailhead: 'tent', below: 'geode', above: 'eclipse' };
// Sound is off until the visitor turns it on; the choice and the music are remembered (audio.js).
const sound = createAudio();

// The loading line climbs as the work is done: modules here, then the scene (built in a worker) and the shaders
// (compiled by the driver in parallel), then the renderer and the first frame. Between steps it keeps creeping towards
// the next one, so it never stands still; the altitude meter counts up with it to the height of the first view.
// When the work is done the line does not jump to the end: it finishes its climb at its own pace, the summit lights,
// and only then is the mountain revealed under it (see `revealed` in draw()).
const loading = (() => {
  const line = ui.loader, start = meters(idlePose(0).y);
  // ?timer: previews that pause animation frames while hidden.
  const nextFrame = params.has('timer') ? callback => setTimeout(() => callback(performance.now()), 30) : requestAnimationFrame;
  let shown = -1, target = 0, ceiling = 0, since = 0, last = 0, frame = 0, finish = null, revealed = !line;
  const tick = now => {
    const dt = Math.min(.1, (now - last) / 1000);
    last = now;
    if (finish) {
      const t = Math.min(1, (now - finish.start) / finish.duration);
      shown = t < 1 ? finish.from + (1 - finish.from) * (1 - Math.pow(1 - t, 3)) : 1;
    } else {
      const goal = target + (ceiling - target) * (1 - Math.exp(-(now - since) / 2600));
      shown += (goal - shown) * (1 - Math.exp(-dt / .42));
    }
    line.style.setProperty('--ridge', shown.toFixed(4));
    if (ui.altitude) ui.altitude.textContent = Math.round(shown * start).toLocaleString('en-US');
    if (shown < 1) { frame = nextFrame(tick); return; }
    revealed = true;
    line.classList.add('is-done');
    // The summit's light comes on with one soft bell, for those who have sound on.
    sound.play('light');
    setTimeout(() => line.classList.add('is-gone'), 2600);
  };
  const begin = () => {
    // The first call takes over from the CSS creep that ran before this module loaded.
    shown = parseFloat(getComputedStyle(line).getPropertyValue('--ridge')) || 0;
    line.style.animation = 'none';
    last = performance.now();
    frame = nextFrame(tick);
  };
  return {
    get active() { return !revealed; },
    get revealed() { return revealed; },
    reach(value, next = value) {
      if (!line || finish) return;
      if (shown < 0) begin();
      target = Math.max(target, value); ceiling = Math.max(ceiling, next); since = performance.now();
    },
    done() {
      if (!line || finish) return;
      if (shown < 0) begin();
      // The rest of the climb takes 0.6–1.2 s whatever is left, so a fast load still reads as a stroke, not a snap.
      finish = { from: shown, start: performance.now(), duration: reduced.matches ? 200 : clamp((1 - shown) * 1500, 600, 1200) };
    },
    stop() { cancelAnimationFrame(frame); clearTimeout(frame); revealed = true; line?.classList.add('is-gone'); }
  };
})();

// Let the page paint its text first, then build the mountain (a few hundred milliseconds of work).
let started = false;
const kick = () => { if (!started) { started = true; start().catch(fallBack); } };
if (gl) { loading.reach(.24, .4); requestAnimationFrame(() => setTimeout(kick, 30)); setTimeout(kick, 500); }
// Without WebGL2 the page keeps its plain camp list, over a still picture of the mountain.
else fallBack();

function fallBack(error) {
  if (error) console.error(error);
  loading.stop();
  root.classList.remove('mountain-live');
  root.classList.add('mountain-static');
}

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
  const request = {
    tier, camps: items.map(item => ({ model: item.dataset.model || null, prints: item.dataset.prints ? item.dataset.prints.split(',') : null })),
    beyond: { below: beyondItems.below ? { eras: beyondItems.below.dataset.eras === undefined ? 4 : +beyondItems.below.dataset.eras } : null, above: beyondItems.above ? {} : null }
  };
  // The driver compiles the shaders on its own threads while the worker builds the scene.
  const warm = warmUp(gl).catch(() => {});
  let scene;
  try { scene = params.has('inline') ? buildScene(request) : await sceneInWorker(request); }
  catch { scene = buildScene(request); }
  loading.reach(.72, .84);
  await warm;
  loading.reach(.86, .95);
  const { camps, trail } = scene;
  const terrain = createTerrain();
  terrain.setLedges(scene.ledges);
  const renderer = createRenderer(gl, scene, quality);
  // Below the cloud deck: the visitor's local hour and the day's weather (weather.js; ?weather= and ?hour= override).
  const weather = conditions(params, reduced);
  // Lightning, when the valley has a storm: the renderer draws it, the ears hear it after it.
  const storm = createStorm(terrain);
  loading.reach(.95, .99);
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
      if (isCamp(state.index) && items[state.index].dataset.model === 'summit') showCard(state.index);
    }).catch(() => {});

  // Stops, in the order the wheel walks them: the Heart (below the trail), the opening orbit, the camps from the
  // trailhead to the summit, then Moonward (past it). The two off the trail exist only if the page lists them.
  const IDLE = -1, BELOW = scene.chamber && scene.cave ? -2 : NaN, ABOVE = scene.above ? items.length : NaN;
  const lowest = BELOW === -2 ? BELOW : IDLE, highest = ABOVE === items.length ? ABOVE : items.length - 1;
  // The sky menu's station below the clouds: a place like a camp, but not one the wheel walks to.
  const VALLEY = -3;
  const isCamp = index => index >= 0 && index < items.length;
  const record = (item, more) => {
    const link = item.querySelector('a');
    return {
      item, id: item.id, link, kicker: item.dataset.kicker || '', title: link.querySelector('.camp-title')?.textContent || '', text: item.querySelector('p')?.textContent || '',
      href: link.hasAttribute('data-pending') ? null : link.getAttribute('href'), pending: item.dataset.pendingText || null, ...more
    };
  };
  const data = items.map(item => record(item, { model: item.dataset.model || null }));
  const chapters = new Map();
  if (BELOW === -2) chapters.set(BELOW, record(beyondItems.below, { model: 'below' }));
  if (ABOVE === items.length) chapters.set(ABOVE, record(beyondItems.above, { model: 'above' }));
  const stop = index => isCamp(index) ? data[index] : chapters.get(index) || null;
  const stops = [...data.map((entry, index) => [index, entry]), ...chapters];
  const indexOfHash = () => { const found = stops.find(([, entry]) => '#' + entry.id === location.hash); return found ? found[0] : null; };
  // How far up the trail a stop counts as (lit dots, the climber, the valley's weather): the Heart as the opening
  // view, Moonward as the summit.
  const progressOf = index => index === ABOVE ? items.length - 1 : isCamp(index) ? index : -1;
  const name = index => index === BELOW ? 'heart' : index === ABOVE ? 'moonward' : index === VALLEY ? 'valley' : isCamp(index) ? 'camp' : 'idle';

  let layout = innerWidth >= innerHeight * .9 ? 'side' : 'stack';
  const summit = camps.at(-1), door = scene.cave ? doorPoses(scene.cave) : null;
  let stations, valley;
  const frameStations = () => {
    stations = camps.map((camp, i) => stationPose(camp, summit, i / Math.max(1, camps.length - 2), terrain, layout));
    valley = valleyPose(layout);
  };
  frameStations();
  // One clock lights the whole mountain (weather.js, skyPalette): the hour, and how thin the air is at this height,
  // none below Camp II and all of it at the summit.
  const thinAt = progress => smoothstep(1, Math.max(2, camps.length - 1), progress);
  // Moonward's places, out past the air (beyond.js): the lens flies there and back, it is not a station on the mountain.
  const groundView = pose => pose.eye ? pose : { eye: clampToGround(eyeOf(pose), terrain), target: pose.target };
  // The opening orbit starts from rest once the mountain is revealed and reaches full speed over 2.5 s, so it hardly
  // drifts from the traced outline while that fades. `lag` is how far the orbit's own time trails the clock.
  let orbitSpeed = 0, lag = 0;
  const still = time => reduced.matches ? 0 : time;
  const poseAt = (index, time) => index === BELOW ? heartPose(HEART.at, HEART.orbit, still(time), pointer, layout)
    : index === ABOVE ? spacePose(renderer.beyond.away, still(time), pointer, layout)
    : index === VALLEY ? sway(valley, still(time), pointer)
    : index === IDLE ? idlePose(reduced.matches ? 0 : time - lag) : sway(stations[index], still(time), pointer);

  // inside: the lens is in the chamber of the Heart. sky: how near the moon has come (1 at Moonward).
  const state = { index: IDLE, travel: null, started: false, progress: -1, arrived: 0, inside: false, sky: 0, aimed: false };
  const phantomIndex = items.findIndex(item => item.dataset.model === 'phantom');
  let pointer = [0, 0], pointerTarget = [0, 0], pointerPower = 0, form = 0, current = null, clock = 0, ahead = 1, focus = null, clearing = 0, fadeIn = params.has('debug') ? 1 : 0, debugPose = null, debugPalette = null, debugHide = null;
  // The chapters off the trail are called before they are entered (see step()); these ease in and out with the call.
  const calls = { [BELOW]: 0, [ABOVE]: 0 };
  let nudge = null, nudgeTimer = 0;
  // The free camera while it is on, and the sky menu (both below); a stop to go on to once the lens is back outdoors.
  let free = null, sky = null, onward = null;

  const heading = () => state.travel ? state.travel.to : state.index;
  function go(index) {
    if (index !== VALLEY) index = clamp(index, lowest, highest);
    // The passage through the rock, in or out of the Heart, is not interrupted; nor is the flight to the moon or back.
    if (!Number.isFinite(index) || state.travel?.through || state.travel?.space) return;
    // Between the Heart and the moon the way leads through the open air: out to the opening view first, then on.
    onward = null;
    if ((index === ABOVE && state.inside) || (index === BELOW && state.index === ABOVE)) { onward = index; index = IDLE; }
    const leaving = Boolean(free);
    if (leaving) leaveFree();
    if (index !== VALLEY) closeSky();
    sky?.dismissCue();
    const target = heading();
    if (index === target && !leaving) return;
    hideNudge();
    const from = current || poseAt(state.index, clock);
    const through = index === BELOW ? 'in' : state.inside ? 'out' : null;
    const space = index === ABOVE ? 'out' : state.index === ABOVE && !state.travel ? 'back' : null;
    // The moon is a long flight; the Heart is a dive, a moment of rock, and an arrival.
    const duration = reduced.matches ? (through || space ? 1.1 : .7) : space ? 6.4 : through ? 4.4 : travelTime(from, poseAt(index, clock + 2));
    // The flight to the moon is planned as it sets off: where the moon is to be (aimFrom), and the path there or back.
    let track = null;
    if (space === 'out') { const aim = aimFrom(from); renderer.beyond.aim(aim.direction); state.aimed = aim.aimed; }
    if (space && !reduced.matches) {
      const ground = groundView(space === 'out' ? from : poseAt(index, clock + duration));
      track = planFlight(ground, poseAt(ABOVE, space === 'out' ? clock + duration : clock), renderer.beyond.away, terrain, space === 'back');
    }
    state.travel = { from, to: index, fromProgress: state.progress, fromSky: state.sky, start: clock, duration, progress: 0, cut: reduced.matches, through, space, track };
    state.started = true;
    showCard(null);
    root.classList.toggle('mountain-climbing', stop(index) !== null);
    ui.hint && (ui.hint.hidden = true);
    markRoute(index);
    sound.play('depart', { from: name(target), to: name(index), up: progressOf(index) + (index === ABOVE ? 1 : 0) > progressOf(target) + (target === ABOVE ? 1 : 0), duration });
    tellSound();
  }
  // Where the moon is to be for the flight out: the one in the sky, if it is up and ahead over the crest (within 50° of
  // the way from the lens over the summit), so the moon in view is the moon the lens goes to; otherwise low over the
  // crest ahead, where it rises into view as the lens comes over the top (and the one in the sky, out of view, fades).
  function aimFrom(pose) {
    const eye = pose.eye || eyeOf(pose);
    let ahead = [summit.x - eye[0], 0, summit.z - eye[2]];
    if (Math.hypot(ahead[0], ahead[2]) < 1) { const target = pose.target; ahead = [target[0] - eye[0], 0, target[2] - eye[2]]; }
    ahead = normalize(ahead);
    const sky = skyPalette(weather.now(), 1), m = sky.moonDir, flat = normalize([m[0], 0, m[2]]);
    if (sky.moon > .5 && m[1] > .07 && dot(flat, ahead) > Math.cos(50 * Math.PI / 180)) return { direction: m, aimed: true };
    const rise = 15 * Math.PI / 180;
    return { direction: [ahead[0] * Math.cos(rise), Math.sin(rise), ahead[2] * Math.cos(rise)], aimed: false };
  }
  // One stop per gesture. The trail's own stops follow each other at once; a chapter off the trail asks for the step
  // twice: the first only calls it (a line of text, a sound, its marker, a glow where it is), the second goes.
  function step(direction) {
    const at = heading(), next = at + direction;
    // From the valley, under the sky menu, a step up the page leaves for the opening view.
    if (at === VALLEY) { if (direction > 0) go(IDLE); return; }
    if (!(next >= lowest && next <= highest)) { sound.play('edge'); return; }
    if (next === ABOVE || next === BELOW) {
      if (state.travel) return;
      if (!(nudge && nudge.to === next && performance.now() < nudge.until)) { call(next); return; }
    }
    go(next);
  }
  function call(index) {
    nudge = { to: index, until: performance.now() + 4500 };
    const entry = stop(index);
    if (ui.nudge) {
      ui.nudge.textContent = 'Off the trail ' + (index === ABOVE ? '↑' : '↓') + ' ' + entry.title + ' — once more to go';
      ui.nudge.hidden = false;
      ui.nudge.classList.remove('is-shown');
      requestAnimationFrame(() => ui.nudge.classList.add('is-shown'));
    }
    entry.item.classList.add('is-called');
    sound.play('nudge', { up: index === ABOVE });
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(hideNudge, 4500);
  }
  function hideNudge() {
    clearTimeout(nudgeTimer);
    if (!nudge) return;
    stop(nudge.to)?.item.classList.remove('is-called');
    nudge = null;
    if (ui.nudge) { ui.nudge.classList.remove('is-shown'); ui.nudge.hidden = true; }
  }

  // The sky menu (sky-menu.js). Opened on the trail it takes the lens down through the clouds to the valley, across the
  // river from the waterfall, where the hour and the weather show in full; Done climbs back to where it was (out of the
  // Heart and back into it, if that is where it was opened). Opened from the free camera, the lens stays where it is.
  let skyReturn = IDLE;
  function openSky() {
    if (sky.open || state.travel?.through || state.travel?.space) return;
    skyReturn = heading();
    if (free) freeView.hide();
    sky.show();
    root.classList.add('mountain-sky-open');
    if (!free) go(VALLEY);
  }
  function closeSky() {
    if (!sky?.open) return;
    sky.hide();
    root.classList.remove('mountain-sky-open');
    if (free) freeView.show();
  }
  function doneSky() {
    const back = free ? null : skyReturn;
    closeSky();
    if (back !== null && heading() === VALLEY) go(back === VALLEY ? IDLE : back);
  }

  // The free camera: drag the scene or the globe to orbit, wheel or pinch to zoom (arrows and +/− too). It starts from
  // wherever the lens is, turns towards the mountain's axis, and lets the climb's palette go to the opening one.
  const freeView = panel(ui.freecam);
  const globeCanvas = document.querySelector('#freecam-globe');
  const globe = createGlobe(globeCanvas, camps);
  const readouts = Object.fromEntries(['bearing', 'elevation', 'range'].map(name => [name, document.querySelector('#freecam-' + name)]));
  document.querySelector('#freecam-hint').textContent = matchMedia('(pointer: coarse)').matches ? 'Drag to orbit · pinch to zoom' : 'Drag to orbit · scroll to zoom';
  function enterFree() {
    // Not from inside the mountain or on the way through its rock: the lens has to be out under the sky first.
    if (free || state.inside || state.sky > 0 || state.travel?.through) return;
    closeSky();
    hideNudge();
    const from = current || poseAt(state.index, clock);
    const orbit = orbitOf(clampToGround(eyeOf(from), terrain));
    free = {
      ...orbit, spin: [0, 0], start: clock,
      goal: { az: orbit.az, el: clamp(orbit.el, ORBIT.low, ORBIT.high), dist: clamp(orbit.dist, ORBIT.near, ORBIT.far) },
      from: { target: from.target, progress: state.progress }
    };
    state.travel = null;
    state.index = IDLE;
    state.started = true;
    showCard(null);
    markRoute(IDLE);
    history.replaceState(null, '', location.pathname + location.search);
    root.classList.remove('mountain-climbing');
    root.classList.add('mountain-free');
    if (ui.hint) ui.hint.hidden = true;
    sky.dismissCue();
    freeView.show();
    tellSound();
  }
  function leaveFree() {
    if (!free) return;
    free = null;
    root.classList.remove('mountain-free');
    freeView.hide();
  }
  function turn(dx, dy, span) {
    free.goal.az += dx / span * Math.PI;
    free.goal.el = clamp(free.goal.el + dy / span * Math.PI * .5, ORBIT.low, ORBIT.high);
  }
  const zoom = factor => { free.goal.dist = clamp(free.goal.dist * factor, ORBIT.near, ORBIT.far); };
  // The lens eases after its goal; a fling keeps turning it for a moment.
  function orbitStep(dt) {
    const goal = free.goal;
    if (!grips.size && (free.spin[0] || free.spin[1])) {
      goal.az += free.spin[0] * dt;
      goal.el = clamp(goal.el + free.spin[1] * dt, ORBIT.low, ORBIT.high);
      free.spin = free.spin.map(v => Math.abs(v) < .01 ? 0 : v * Math.exp(-dt * 3));
    }
    const k = 1 - Math.exp(-dt * 10);
    for (const name of ['az', 'el', 'dist']) free[name] += (goal[name] - free[name]) * k;
  }
  // One finger (or the mouse) turns, two pinch. The scene and the globe both take a drag; a full drag across the
  // scene's height turns half way round, across the globe likewise.
  const grips = new Map();
  let fling = [0, 0], flingTime = 0, pinch = 0;
  function grip(element, span) {
    element.addEventListener('pointerdown', event => {
      if (!free || event.button > 0) return;
      element.setPointerCapture(event.pointerId);
      grips.set(event.pointerId, [event.clientX, event.clientY]);
      free.spin = [0, 0];
      fling = [0, 0];
      flingTime = performance.now();
      pinch = 0;
      root.classList.add('mountain-grabbing');
    });
    element.addEventListener('pointermove', event => {
      if (!free || !grips.has(event.pointerId)) return;
      const [x, y] = grips.get(event.pointerId);
      grips.set(event.pointerId, [event.clientX, event.clientY]);
      if (grips.size > 1) {
        const [a, b] = [...grips.values()], distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoom(pinch / distance);
        pinch = distance;
        return;
      }
      const dx = event.clientX - x, dy = event.clientY - y, now = performance.now(), dt = Math.max(8, now - flingTime) / 1000, s = span();
      turn(dx, dy, s);
      fling = [lerp(fling[0], dx / s * Math.PI / dt, .5), lerp(fling[1], dy / s * Math.PI * .5 / dt, .5)];
      flingTime = now;
    });
    const release = event => {
      if (!grips.delete(event.pointerId)) return;
      pinch = 0;
      if (grips.size) return;
      root.classList.remove('mountain-grabbing');
      // Capped, so a flick on the small globe does not send the view half way round.
      if (free && !reduced.matches && performance.now() - flingTime < 80) free.spin = [clamp(fling[0], -2, 2), clamp(fling[1], -.8, .8)];
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
  }
  grip(canvas, () => canvas.clientHeight);
  grip(globeCanvas, () => globeCanvas.clientWidth);
  let shownReadouts = '';
  function readOrbit() {
    const degrees = radians => radians * 180 / Math.PI;
    const elevation = Math.round(degrees(free.el));
    const values = {
      bearing: (Math.round(degrees(free.az)) % 360 + 360) % 360 + '°',
      elevation: (elevation < 0 ? '−' : '+') + Math.abs(elevation) + '°',
      range: (free.dist * .34).toFixed(1) + ' km'
    };
    const text = Object.values(values).join();
    if (text === shownReadouts) return;
    shownReadouts = text;
    for (const [name, value] of Object.entries(values)) readouts[name].textContent = value;
  }
  document.querySelector('#freecam-sky').addEventListener('click', openSky);
  document.querySelector('#freecam-exit').addEventListener('click', () => go(IDLE));
  sky = createSkyMenu({ weather, reduced, onToggle: () => sky.open ? doneSky() : openSky(), onFree: enterFree, onDone: doneSky });

  function arrive(index) {
    const entry = stop(index);
    state.index = index;
    state.travel = null;
    state.arrived = clock;
    state.inside = index === BELOW;
    state.sky = index === ABOVE ? 1 : 0;
    showCard(index);
    history.replaceState(null, '', entry ? '#' + entry.id : location.pathname + location.search);
    if (entry) prefetch(entry.href);
    sound.play('arrive', { stop: name(index), model: entry?.model || null });
    tellSound();
    if (onward !== null) { const next = onward; onward = null; go(next); }
  }

  // A camp reached is a camp likely entered: fetch its page ahead, so the black after the transition is brief.
  const prefetched = new Set();
  function prefetch(href) {
    if (!href || prefetched.has(href)) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    prefetched.add(href);
    document.head.append(Object.assign(document.createElement('link'), { rel: 'prefetch', href: url.pathname }));
  }

  // Leaving for a camp's page: the transition covers the window, then navigates.
  const modified = event => event && (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
  function enter(index, href, event) {
    const origin = event && event.clientX ? [event.clientX / innerWidth, event.clientY / innerHeight] : [.5, .5];
    const effect = VEILS[stop(index)?.model] || 'tent';
    sound.play('veil', { effect });
    if (window.g3veil) window.g3veil.leave({ effect, href, origin });
    else location.href = href;
  }
  ui['card-link']?.addEventListener('click', event => {
    const entry = stop(state.index);
    if (modified(event) || !entry?.href || state.travel) return;
    event.preventDefault();
    enter(state.index, entry.href, event);
  });
  // The Photography card's prints open their own pages through the lens.
  ui['card-extra']?.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link || modified(event) || !isCamp(state.index)) return;
    event.preventDefault();
    enter(state.index, link.getAttribute('href'), event);
  });

  function showCard(index) {
    if (!ui.card) return;
    ui.intro && ui.intro.classList.toggle('is-hidden', index !== IDLE && state.started);
    const entry = index === null ? null : stop(index);
    if (!entry) { ui.card.classList.remove('is-visible'); return; }
    // Out at the moon the height is the moon's distance.
    ui['card-kicker'].textContent = entry.kicker + ' · ' + (index === ABOVE ? MOON_KM.toLocaleString('en-US') + ' km' : meters(isCamp(index) ? camps[index].y : HEART.at[1]).toLocaleString('en-US') + ' m');
    ui['card-title'].textContent = entry.title;
    ui['card-text'].textContent = entry.text;
    // Camps can carry more than a line of text: the Photography prints, the latest note in the summit register.
    const extra = entry.item.querySelector('.camp-extra');
    ui['card-extra'].replaceChildren(...(extra ? [extra.cloneNode(true)] : []));
    if (entry.model === 'summit' && latestNote) {
      const quote = document.createElement('blockquote'), body = document.createElement('p'), by = document.createElement('cite');
      quote.className = 'camp-extra camp-note';
      body.textContent = latestNote.message;
      by.textContent = latestNote.name + (latestNote.owner ? ' · site owner' : '');
      quote.append(body, by);
      ui['card-extra'].append(quote);
    }
    ui['card-link'].hidden = !entry.href;
    ui['card-pending'].hidden = Boolean(entry.href);
    ui['card-pending'].textContent = entry.pending || 'Trail under construction';
    if (entry.href) ui['card-link'].href = entry.href;
    ui.card.hidden = false;
    requestAnimationFrame(() => ui.card.classList.add('is-visible'));
  }

  function markRoute(index) {
    for (const [i, entry] of stops) {
      if (i === index) entry.link.setAttribute('aria-current', 'step');
      else entry.link.removeAttribute('aria-current');
      entry.item.classList.toggle('is-passed', isCamp(i) && i < index);
    }
    root.classList.toggle('mountain-off-trail', chapters.has(index));
  }

  // Input: one camp per wheel gesture; a pause of 180 ms starts a new gesture. With the free camera the wheel zooms;
  // over the sky menu it does nothing.
  let wheelTotal = 0, wheelLast = 0, wheelLocked = false;
  addEventListener('wheel', event => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const amount = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1);
    if (free) { zoom(Math.exp(clamp(amount, -200, 200) * .0015)); return; }
    if (event.target.closest?.('.mountain-almanac, .sound-volume')) return;
    sky.dismissCue();
    const now = performance.now(), gap = now - wheelLast;
    wheelLast = now;
    if (gap > 180) { wheelTotal = 0; wheelLocked = false; }
    if (wheelLocked) return;
    wheelTotal += amount;
    if (Math.abs(wheelTotal) > 45) { step(Math.sign(wheelTotal)); wheelLocked = true; }
  }, { passive: false });

  // On the trail a swipe climbs or descends, a tap on a camp (or the door, or the moon) goes there and a tap elsewhere
  // climbs on, except under the sky menu, which a stray tap should not close. The free camera has its own drag (above).
  let press = null;
  canvas.addEventListener('pointerdown', event => { sky.dismissCue(); press = free ? null : { x: event.clientX, y: event.clientY, time: performance.now() }; });
  canvas.addEventListener('pointerup', event => {
    if (!press || free) return;
    const dx = event.clientX - press.x, dy = event.clientY - press.y;
    press = null;
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) { step(dy < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) > 12) return;
    // In the chamber a touch on the pool is a drop of water.
    if (state.inside) { if (!state.travel) touchPool(event.clientX, event.clientY); return; }
    if (sky.open) return;
    const hit = pick(event.clientX, event.clientY);
    if (hit !== null) { sound.play('tap'); go(hit); }
    else if (heading() < items.length - 1) step(1);
  });
  let pointerSeen = -Infinity;
  canvas.addEventListener('pointermove', event => {
    pointerTarget = [event.clientX / canvas.clientWidth * 2 - 1, event.clientY / canvas.clientHeight * 2 - 1];
    pointerSeen = performance.now();
  });
  addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // The sky menu's dial and lists keep their own keys (it closes on Escape itself).
    if (event.target.closest?.('.mountain-almanac, .sound-volume')) return;
    sky.dismissCue();
    const onLink = event.target instanceof HTMLAnchorElement || event.target instanceof HTMLButtonElement;
    if ((event.key === 'm' || event.key === 'M') && !onLink) { setSound(!sound.enabled); return; }
    if (free) {
      const turns = { ArrowLeft: [.2, 0], ArrowRight: [-.2, 0], ArrowUp: [0, .1], ArrowDown: [0, -.1] };
      if (event.key in turns) {
        event.preventDefault();
        free.goal.az += turns[event.key][0];
        free.goal.el = clamp(free.goal.el + turns[event.key][1], ORBIT.low, ORBIT.high);
      } else if (event.key === '+' || event.key === '=') zoom(.85);
      else if (event.key === '-' || event.key === '_') zoom(1 / .85);
      else if (event.key === 'Escape' || event.key === 'Home') go(IDLE);
      return;
    }
    if (event.key === 'Escape' && sky.open) { doneSky(); return; }
    const keys = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 };
    if (event.key in keys) { event.preventDefault(); step(keys[event.key]); }
    else if (event.key === ' ' && !onLink) { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    else if (event.key === 'Home') { event.preventDefault(); go(IDLE); }
    else if (event.key === 'End') { event.preventDefault(); go(items.length - 1); }
    else if (event.key === 'Escape') go(IDLE);
    else if (event.key === 'Enter' && !onLink && !state.travel && stop(state.index)?.href) enter(state.index, stop(state.index).href);
  });
  ui.begin?.addEventListener('click', () => { sound.play('tap'); go(0); });
  // A typed or pasted #camp link climbs (or descends) to that camp.
  addEventListener('hashchange', () => { const index = indexOfHash(); if (index !== null) go(index); });
  for (const [i, entry] of stops) entry.link.addEventListener('click', event => {
    if (i === state.index && !state.travel && entry.href && modified(event)) return;
    event.preventDefault();
    if (i === state.index && !state.travel && entry.href) enter(i, entry.href, event); else { sound.play('tap'); go(i); }
  });

  // Sound: the switch, and the three kinds of music to choose from.
  function setSound(on) {
    sound.setEnabled(on);
    showSound();
    if (on) tellSound();
  }
  function showSound() {
    if (!ui.sound) return;
    ui['sound-toggle'].setAttribute('aria-pressed', String(sound.enabled));
    ui['sound-toggle'].querySelector('.sound-label').textContent = sound.enabled ? 'Sound on' : 'Sound off';
    ui['sound-themes'].hidden = !sound.enabled;
    if (ui['sound-volume']) {
      ui['sound-volume'].hidden = !sound.enabled;
      const slider = ui['sound-volume'].querySelector('input');
      slider.value = String(sound.volume);
      slider.style.setProperty('--level', Math.round(sound.volume * 100) + '%');
    }
    root.classList.toggle('mountain-sound-on', sound.enabled);
    for (const button of ui['sound-themes'].querySelectorAll('[data-theme]')) button.setAttribute('aria-checked', String(button.dataset.theme === sound.theme));
  }
  if (ui.sound && sound.supported) {
    ui.sound.hidden = false;
    ui['sound-toggle'].addEventListener('click', () => setSound(!sound.enabled));
    ui['sound-themes'].addEventListener('click', event => {
      const button = event.target.closest?.('[data-theme]');
      if (!button) return;
      sound.setTheme(button.dataset.theme);
      showSound();
    });
    ui['sound-volume']?.querySelector('input').addEventListener('input', event => {
      sound.setVolume(+event.target.value);
      event.target.style.setProperty('--level', Math.round(sound.volume * 100) + '%');
    });
    showSound();
  }
  // Small sounds for the page's own controls: a tick as the pointer comes onto one.
  for (const element of document.querySelectorAll('.mountain-route a, .mountain-begin, .mountain-enter, .mountain-sound button, .mountain-sky, .almanac-foot button')) element.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') sound.play('hover'); });
  ui['card-extra']?.addEventListener('pointerover', event => { if (event.pointerType === 'mouse' && event.target.closest?.('a')) sound.play('hover'); });
  // What the music and the air should be doing, whenever the stop changes.
  function tellSound() {
    const index = heading(), entry = stop(index);
    sound.scene({ stop: name(index), camp: isCamp(index) ? index : -1, camps: items.length, travelling: Boolean(state.travel) });
  }

  // Position along the trail for a progress value measured in camps.
  function trailAt(s) {
    let low = 0, high = trail.length - 1;
    if (s <= trail[0][3]) return trail[0].slice(0, 3).map((v, i) => i === 1 ? v + .06 : v);
    if (s >= trail[high][3]) return trail[high].slice(0, 3).map((v, i) => i === 1 ? v + .06 : v);
    while (high - low > 1) { const mid = (low + high) >> 1; if (trail[mid][3] < s) low = mid; else high = mid; }
    const t = (s - trail[low][3]) / (trail[high][3] - trail[low][3] || 1);
    return [0, 1, 2].map(i => lerp(trail[low][i], trail[high][i], t) + (i === 1 ? .06 : 0));
  }

  // What a click on the mountain lands on: a camp's lantern, the door of the Heart, or the moon.
  let projected = [];
  function pick(x, y) {
    let best = null, distance = Infinity;
    for (const p of projected) { const d = Math.hypot(p.x - x, p.y - y) - p.reach; if (p.seen && d < 0 && d < distance) { distance = d; best = p.index; } }
    return best;
  }
  // A touch in the chamber: where the line of sight meets the pool, a drop falls.
  let viewProjInverse = null, lastTouch = -Infinity;
  function touchPool(x, y) {
    if (!viewProjInverse || clock - lastTouch < .35) return;
    const clip = [x / canvas.clientWidth * 2 - 1, 1 - y / canvas.clientHeight * 2];
    const near = transform(viewProjInverse, [clip[0], clip[1], -1]), far = transform(viewProjInverse, [clip[0], clip[1], 1]);
    const t = (HEART.water - near[1]) / (far[1] - near[1]);
    if (!(t > 0 && t < 1)) return;
    const at = mix3(near, far, t);
    if (Math.hypot(at[0] - HEART.at[0], at[2] - HEART.at[2]) > 3.6) return;
    lastTouch = clock;
    drop(at[0], at[2], 1);
  }
  function drop(x, z, strength) {
    renderer.beyond.drip(x, z, clock, strength);
    sound.play('drip', { pan: panOf([x, HEART.water, z]), strength });
  }

  // Rendering
  let scaleFactor = 1, frameTimes = [], last = performance.now(), cueArmed = false;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, quality.dpr) * scaleFactor;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr)), height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    renderer.resize(width, height);
    const next = innerWidth >= innerHeight * .9 ? 'side' : 'stack';
    if (next !== layout) { layout = next; frameStations(); }
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // Things that happen on their own time: drops from the chamber's roof, shooting stars past the summit.
  const chance = random(97);
  let nextDrop = 3, meteor = null, nextMeteor = 4, beats = -1, cameraRight = [1, 0, 0], cameraEye = [0, 0, 0], lastHeard = -1, glinted = -Infinity;
  const panOf = at => clamp(dot(normalize(sub(at, cameraEye)), cameraRight) * 1.2, -1, 1);

  function draw(now) {
    const delta = Math.min(.1, (now - last) / 1000);
    last = now;
    // Until the loading line has reached the summit the frame stays black and the opening orbit waits at its start,
    // so the mountain then appears exactly under the outline that was traced for that view.
    if (loading.revealed || state.index !== IDLE || state.travel) {
      clock += delta;
      lag += delta * (1 - orbitSpeed);
      orbitSpeed = Math.min(1, orbitSpeed + delta / 2.5);
    }
    if (loading.revealed) fadeIn = Math.min(1, fadeIn + delta / 1.6);
    pointer = pointer.map((v, i) => lerp(v, pointerTarget[i], Math.min(1, delta * 2)));

    let pose, palette, fade = easeInOut(fadeIn), inside = state.inside;
    const travel = state.travel;
    if (free) {
      orbitStep(delta);
      const e = easeInOut(clamp((clock - free.start) / 1.4, 0, 1));
      pose = orbitPose(free);
      pose.target = mix3(free.from.target, pose.target, e);
      state.progress = lerp(free.from.progress, -1, e);
    } else if (travel) {
      const t = travel.progress = Math.min(1, (clock - travel.start) / travel.duration);
      const e = easeInOut(t);
      state.progress = lerp(travel.fromProgress, progressOf(travel.to), e);
      // On the flight the world below stays in sight over the ridge and goes dark only as the lens climbs away (and
      // comes back as it falls home).
      state.sky = travel.track ? (travel.space === 'out' ? smoothstep(.36, .6, t) : 1 - smoothstep(.36, .58, t)) : lerp(travel.fromSky, travel.to === ABOVE ? 1 : 0, e);
      if (travel.through) inside = (travel.through === 'in') === (t >= .5);
      if (travel.cut) {
        pose = t < .5 ? travel.from : poseAt(travel.to, clock);
        fade *= Math.abs(1 - t * 2);
      } else if (travel.through === 'in') {
        // The dive to the door, black as the lens crosses the threshold, then the chamber opens.
        pose = t < .5 ? diveIn(travel.from, door, t / .5) : enterHeart(poseAt(BELOW, clock), HEART.at, (t - .5) / .5);
        fade *= t < .5 ? 1 - smoothstep(.36, .5, t) : smoothstep(.5, .7, t);
      } else if (travel.through === 'out') {
        pose = t < .5 ? enterHeart(poseAt(BELOW, clock), HEART.at, 1 - t / .5) : diveOut(door, poseAt(travel.to, travel.start + travel.duration), (t - .5) / .5);
        fade *= t < .5 ? 1 - smoothstep(.3, .5, t) : smoothstep(.5, .66, t);
      } else if (travel.space) {
        // Over the crest, up and round the moon; or back down and round the summit (camera.js, planFlight).
        pose = travel.track(t, poseAt(ABOVE, clock));
      } else pose = interpolate(travel.from, poseAt(travel.to, travel.start + travel.duration), t);
      if (t >= 1) arrive(travel.to);
    } else {
      pose = poseAt(state.index, clock);
      state.progress = progressOf(state.index);
    }
    // The light: the Heart is lit by itself (its grade changes while the frame is black); everything else by the hour,
    // the same above the clouds as below, with the air thinning towards the summit and gone on the way to the moon.
    const heaven = weather.now();
    if (inside) palette = PALETTES.core;
    else {
      palette = skyPalette(heaven, Math.max(thinAt(state.progress), state.sky));
      // Out at the moon no hour of the mountain's applies: the stars are at their deepest and the grade is its own.
      const s = state.sky;
      Object.assign(palette, { deep: s, exposure: lerp(palette.exposure, 1.12, s), saturation: lerp(palette.saturation, 1, s), tint: mix3(palette.tint, [.93, .95, 1], s), stars: lerp(palette.stars, 1, s) });
    }
    if (debugPose) pose = debugPose;
    if (debugPalette) palette = debugPalette;
    current = pose;

    const eye = pose.eye || clampToGround(eyeOf(pose), terrain);
    const aspect = canvas.width / canvas.height;
    // On the flight to the moon and back the lens opens a little wider while it is at speed.
    const rush = travel?.track && !debugPose ? pose.rush || 0 : 0;
    const fov = ((inside ? FOV.inside : FOV)[aspect < 1 ? 'portrait' : 'landscape']) * (1 + .16 * rush) * Math.PI / 180;
    const projection = perspective(fov, aspect, renderer.near, renderer.far);
    const view = lookAt(eye, pose.target);
    const viewProj = multiply(projection, view);
    viewProjInverse = invert(viewProj);
    cameraEye = eye;
    cameraRight = [view[0], view[4], view[8]];
    const at = heading();
    const settled = state.travel || !isCamp(state.index) ? 0 : smoothstep(0, .8, clock - state.arrived);
    const here = isCamp(state.index) ? camps[state.index] : camps[0];
    // The climber and the dots still ahead fade out once a camp is reached (or the valley, under the sky menu) and come
    // back when the climb resumes.
    const moving = state.travel ? (state.travel.to === VALLEY ? 0 : 1) : state.index === IDLE ? 1 : 0;
    ahead = lerp(ahead, moving, Math.min(1, delta * (moving ? 4 : 1.6)));
    // Clouds part along the line of sight to the camp being approached or visited (the summit from Moonward, the door
    // on the way to the Heart).
    const sight = isCamp(at) ? [camps[at].x, camps[at].y + .2, camps[at].z] : at === ABOVE ? [summit.x, summit.y + .2, summit.z] : at === BELOW ? scene.cave.glow : null;
    if (sight) focus = focus ? mix3(focus, sight, Math.min(1, delta * 2.5)) : sight;
    clearing = lerp(clearing, sight ? 1 : 0, Math.min(1, delta * 1.5));
    // The Phantom's points gather into the mark while its camp is visited, and shy away from a moving pointer.
    form = lerp(form, state.index === phantomIndex && !state.travel ? 1 : 0, Math.min(1, delta * (form < .5 ? .9 : 1.6)));
    pointerPower = lerp(pointerPower, performance.now() - pointerSeen < 1200 ? 1 : 0, Math.min(1, delta * 3));
    if (form > .7 && pointerPower > .6 && now - pointerSeen < 60 && now - glinted > 140) { glinted = now; sound.play('glint', { pan: pointerTarget[0] }); }
    // A chapter that has been called glows where it is, until the call lapses or is answered.
    const called = nudge && now < nudge.until ? nudge.to : at;
    for (const side of [BELOW, ABOVE]) if (Number.isFinite(side)) calls[side] = lerp(calls[side], called === side && !inside ? 1 : 0, Math.min(1, delta * 2.2));

    // The heart keeps time for everything it lights; its beat is heard in the chamber, and faintly at the door.
    const beat = Math.floor(clock / HEART.period);
    if (beat !== beats) { beats = beat; if (inside) sound.play('heartbeat', { strength: 1 }); else if (calls[BELOW] > .4) sound.play('heartbeat', { strength: .35 * calls[BELOW] }); }
    if (inside && !state.travel && !reduced.matches && clock > nextDrop && renderer.beyond.drops?.length) {
      const drops = renderer.beyond.drops, k = Math.floor(chance() * drops.length / 3) * 3;
      drop(drops[k], drops[k + 1], .55 + chance() * .45);
      nextDrop = clock + 2.2 + chance() * 4.5;
    }
    // Shooting stars, now and then, in the deep sky of Moonward.
    if (meteor && clock > meteor.start + meteor.life) meteor = null;
    if (!meteor && state.sky > .85 && !reduced.matches && clock > nextMeteor) {
      // Somewhere in the upper half of the view, falling across it.
      const forward = normalize(sub(pose.target, eye)), up = [view[1], view[5], view[9]];
      const from = normalize([0, 1, 2].map(i => forward[i] + cameraRight[i] * (chance() - .5) * .9 + up[i] * (.1 + chance() * .28)));
      const fall = normalize([0, 1, 2].map(i => cameraRight[i] * (chance() < .5 ? -1 : 1) * (.5 + chance() * .5) - up[i] * (.25 + chance() * .5)));
      meteor = { start: clock, life: .7 + chance() * .5, from, fall, reach: .16 + chance() * .14 };
      nextMeteor = clock + 5 + chance() * 8;
      sound.play('meteor', { pan: clamp(dot(from, cameraRight) * 2.5, -1, 1), duration: meteor.life });
    }
    let streak = null;
    if (meteor) {
      const t = (clock - meteor.start) / meteor.life, head = normalize([0, 1, 2].map(i => meteor.from[i] + meteor.fall[i] * meteor.reach * t));
      streak = { head, tail: normalize([0, 1, 2].map(i => head[i] - meteor.fall[i] * meteor.reach * .45 * Math.min(1, t * 3))), power: Math.sin(Math.PI * Math.min(1, t)) ** .6 };
    }

    const markers = {
      progress: state.progress, settled, pillar: [here.x, here.y, here.z, settled], climber: trailAt(state.progress), climberPower: smoothstep(-.4, 0, state.progress) * ahead * (1 - state.sky),
      ahead, focus: [...(focus || [0, 0, 0]), clearing], pennants, form, pointer: [pointerTarget[0], -pointerTarget[1], reduced.matches ? 0 : pointerPower]
    };
    // The moon in the sky stays where the hour has it, unless the flight goes to one somewhere else: then that fades
    // as the lens sets off, and the one it is going to shows over the crest ahead (reveal); the other way coming home.
    // phase: how far the light on it has turned from the full moon seen from the mountain to the sun out there.
    const flight = travel?.track ? (travel.space === 'out' ? travel.progress : 1 - travel.progress) : state.sky;
    const stay = !travel?.track || state.aimed ? 1 : travel.space === 'out' ? 1 - smoothstep(.02, .14, travel.progress) : smoothstep(.84, .98, travel.progress);
    const reveal = !travel?.track || state.aimed ? 0 : travel.space === 'out' ? smoothstep(.14, .3, travel.progress) : 1 - smoothstep(.62, .8, travel.progress);
    const beyond = { inside, sky: state.sky, skyCall: calls[ABOVE] || 0, coreCall: calls[BELOW] || 0, meteor: streak, calm: reduced.matches, stay, reveal, phase: smoothstep(.4, .8, flight) };
    // A strike of lightning, and its thunder after it, by as long as the sound takes to come from there.
    const strike = storm.tick(clock, heaven);
    if (strike && !inside) {
      const far = Math.hypot(strike.at[0] - eye[0], strike.at[1] - eye[1], strike.at[2] - eye[2]);
      sound.play('thunder', { near: 1 - smoothstep(3, 38, far), pan: clamp(dot(normalize(sub(strike.at, eye)), cameraRight) * 1.3, -1, 1), delay: .15 + far * .085 });
    }
    const lightning = { strike: storm.strike, flash: inside ? 0 : storm.flash(clock, reduced.matches) };
    renderer.render({ eye, view, viewProj, invViewProj: viewProjInverse, fov, time: clock, palette, fade, markers, beyond, weather: heaven, storm: lightning, hide: debugHide, canvasWidth: canvas.width, canvasHeight: canvas.height });

    // The canvas may reach under the browser's bars, so screen positions are measured on its own box.
    const box = [canvas.clientWidth, canvas.clientHeight];
    const onScreen = (point, index, reach) => {
      const p = transform(viewProj, point);
      return { index, reach, x: (p[0] * .5 + .5) * box[0], y: (.5 - p[1] * .5) * box[1], seen: p[3] > 0 && Math.abs(p[0]) < 1.1 && Math.abs(p[1]) < 1.1 };
    };
    projected = inside ? [] : camps.map((camp, i) => onScreen([camp.x, camp.y + .25, camp.z], i, 34));
    if (!inside && BELOW === -2 && at !== BELOW) projected.push(onScreen(scene.cave.glow, BELOW, 30));
    if (!inside && ABOVE === items.length && at !== ABOVE && palette.moon > .5) {
      const moon = renderer.beyond.moonState({ palette, eye, beyond });
      projected.push(onScreen(moon.center, ABOVE, Math.max(26, moon.size / (fov / 2) * box[1] / 2)));
    }
    if (ui.altitude && !loading.active) {
      // On the way to the moon the metres run out: the count goes on in kilometres to the moon's distance.
      const metres = lerp(meters(eye[1]), MOON_KM * 1000, state.sky ** 3), far = metres >= 1e5, unit = far ? 'km' : 'm';
      ui.altitude.textContent = Math.round(far ? metres / 1000 : metres).toLocaleString('en-US');
      if (altitudeUnit && altitudeUnit.textContent !== unit) altitudeUnit.textContent = unit;
    }
    tint(renderer.edgeColor());
    sky.tick(now);
    if (free && freeView.open) { globe(free); readOrbit(); }
    // On the first visits, once the mountain is in and the opening words have settled, the sky readout explains itself.
    if (!cueArmed && loading.revealed && fadeIn >= 1) {
      cueArmed = true;
      if (state.index === IDLE && !state.travel && !free && !params.has('clean')) sky.cueLater(reduced.matches ? 800 : 2600);
    }

    // The air for the ears: where the lens is, and what stands near it (a few times a second is plenty). The valley's
    // weather is whatever the sky menu has made it, so rain chosen there is rain heard here.
    if (sound.enabled && clock - lastHeard > .12) {
      lastHeard = clock;
      const valleySky = heaven, presence = 1 - smoothstep(1, camps.length - 1, state.progress);
      sound.listener({
        eye, right: cameraRight, inside, height: eye[1], sky: state.sky, moving: travel ? Math.sin(Math.PI * travel.progress) : 0,
        fall: scene.water.foot, fire: fireAt, weather: valleySky.kind, intensity: valleySky.intensity * presence, ground: groundHeard(eye)
      });
    }

    // Adaptive resolution: step down when frames run long, recover slowly.
    if (!params.has('timer')) frameTimes.push(delta);
    if (frameTimes.length === 45) {
      const average = frameTimes.reduce((a, b) => a + b) / frameTimes.length;
      frameTimes = [];
      const next = average > .024 ? Math.max(.5, scaleFactor * .8) : average < .0135 ? Math.min(1, scaleFactor * 1.06) : scaleFactor;
      if (Math.abs(next - scaleFactor) > .01) { scaleFactor = next; resize(); }
    }
  }
  // The ground's own sounds (the waterfall, the fire, the valley's rain and thunder) are not heard above Camp III: on
  // the trail they fade out from Camp II to just past Camp III, in the free camera with height, and out at the moon.
  const third = camps[Math.min(2, camps.length - 1)];
  const groundHeard = eye => (1 - state.sky) * (free ? 1 - smoothstep(third.y - .2, third.y + 1.2, eye[1]) : 1 - smoothstep(1.2, 2.5, state.progress));
  // The trailhead's fire, for the ears: the first of the props' lights that flickers like one.
  const fireAt = (() => { const l = scene.props.lights; for (let i = 0; i < l.length; i += 8) if (l[i + 7] === 1) return [l[i], l[i + 1], l[i + 2]]; return null; })();
  // The browser's own colour around the page (the status bar, the strip under a toolbar, overscroll) follows the sky
  // at the top of the frame, so the mountain reads edge to edge even where the browser paints a flat colour.
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  let tinted = [-9, -9, -9];
  function tint(color) {
    if (!color || color.every((v, i) => Math.abs(v - tinted[i]) < 3)) return;
    tinted = color;
    const hex = '#' + color.map(v => v.toString(16).padStart(2, '0')).join('');
    root.style.setProperty('--tint', hex);
    themeMeta?.setAttribute('content', hex);
  }

  let frames = 0, paused = false;
  // High-refresh screens would otherwise redraw up to 240 times a second; ~80 is plenty for a slow orbit.
  let lastDrawn = -Infinity;
  const frame = now => {
    if (paused) return;
    if (now - lastDrawn >= 12) {
      lastDrawn = now; draw(now); frames++;
      if (frames === 1) loading.done();
    }
    schedule(frame);
  };
  // Once a transition has covered the window, the mountain stops drawing and leaves the machine to the next page;
  // coming back (from the browser's page cache) picks up where it left off. The sound goes quiet with it.
  const resume = () => { if (!paused) return; paused = false; last = performance.now(); sound.hush(false); schedule(frame); };
  addEventListener('g3:veil', event => { if (event.detail === 'covered') { paused = true; sound.hush(true); } else resume(); });
  addEventListener('pageshow', event => { if (event.persisted) resume(); });
  document.addEventListener('visibilitychange', () => sound.hush(document.hidden || paused));
  // ?timer drives frames from a timer, for previews that pause animation frames while hidden.
  const schedule = params.has('timer') ? callback => setTimeout(() => callback(performance.now()), 30) : callback => requestAnimationFrame(callback);

  // Opened at a stop: the page starts there, already inside or already aloft.
  function place(index) {
    state.index = index; state.progress = progressOf(index); state.started = true; state.travel = null;
    state.inside = index === BELOW; state.sky = index === ABOVE ? 1 : 0; state.arrived = clock;
    root.classList.toggle('mountain-climbing', stop(index) !== null);
    if (ui.hint && index !== IDLE) ui.hint.hidden = true;
    markRoute(index); showCard(index);
    if (index !== IDLE) prefetch(stop(index).href);
    tellSound();
  }
  const initial = indexOfHash();
  if (initial !== null) place(initial);
  else { if (ui.hint) ui.hint.hidden = false; tellSound(); }
  if (ui.begin) ui.begin.hidden = false;
  schedule(frame);

  if (params.has('clean')) root.classList.add('mountain-clean');
  if (params.has('timer')) root.classList.add('mountain-still');
  if (params.has('debug')) window.mountain = {
    terrain, camps, stations, data, PALETTES, go, step, sound, scene, renderer, BELOW, ABOVE,
    pose(angle, radius, y, target = [0, 4.3, 0]) { debugPose = angle === undefined ? null : { angle: angle * Math.PI / 180, radius, y, target }; },
    // A free lens anywhere: look(eye, target), or look() to let go.
    look(eye, target) { debugPose = eye ? { eye, target } : null; return this.settle(); },
    time(name) { debugPalette = name ? PALETTES[name] : null; },
    // Weather below the deck: weather('rain', .8) or weather() for the day's own; hour(22.5) or hour() for the clock.
    weather(kind, intensity) { weather.set(kind, intensity); return this.settle(); },
    // In a storm: lightning at the next frame (strike(.8) holds its flash at .8, for a still).
    strike(hold, at) { storm.soon(hold, at); },
    hour(value) { weather.setHour(value); return this.settle(); },
    get sky() { return weather.now(); },
    get palette() { return skyPalette(weather.now(), Math.max(thinAt(state.progress), state.sky)); },
    // The sky menu and the free camera: menu() opens the menu, menu(false) is Done; orbit(az, el, dist) in degrees
    // and world units turns the free camera on at once at that point, orbit() leaves it for the trail.
    menu(open = true) { if (open) openSky(); else doneSky(); return this.settle(); },
    orbit(az, el, dist) {
      if (az === undefined) { go(IDLE); return this.settle(); }
      enterFree();
      const at = { az: az * Math.PI / 180, el: el * Math.PI / 180, dist };
      Object.assign(free, at, { start: clock - 2 });
      Object.assign(free.goal, at);
      return this.settle();
    },
    get current() { return current; },
    // Jumps the journey under way to t (0 to 1) of its time, for stills of it.
    seek(t) { if (state.travel) state.travel.start = clock - t * state.travel.duration; return this.settle(); },
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
    station(i) { place(i); ahead = 0; clearing = 1; focus = null; form = i === phantomIndex ? 1 : 0; debugPose = isCamp(i) ? stations[i] : null; debugPalette = null; state.arrived = clock - 2; return this.settle(); },
    // The chapters off the trail, at once: chapter('heart'), chapter('moonward').
    chapter(which) { debugPose = null; debugPalette = null; place(which === 'heart' ? BELOW : ABOVE); ahead = 0; return this.settle(); },
    // Resolves once two fresh frames have been drawn, so screenshots never catch a stale pose.
    settle() { const start = frames; return new Promise(resolve => { const check = () => frames >= start + 2 ? resolve(frames) : setTimeout(check, 16); check(); }); },
    get quality() { return { tier, ...quality, samples: renderer.samples, float: renderer.float, scaleFactor }; }
  };
}
