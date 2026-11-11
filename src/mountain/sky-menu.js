import { TAU, easeInOut } from './math.js';

// The sky menu: the mountain's hour, and the weather below the clouds (weather.js). It opens from the readout beside the
// altitude meter and takes the camp card's place. The hour is a dial drawn like an astrolabe: a ring of 24 hours turned
// so the day's noon is at the top, the sun's arc from sunrise to sunset over a horizon with the mountain standing on
// it; drag the sun (the moon at night) round, or step it with the arrow keys. The weather is a list of five skies.
// A headline says what the valley is doing, in words: "Heavy rain / after midnight."

const NS = 'http://www.w3.org/2000/svg';
const node = (tag, attributes, parent) => {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  parent?.append(element);
  return element;
};
const wrap = hour => (hour % 24 + 24) % 24;
const fixed = value => value.toFixed(2);
export const clockText = hour => { const m = Math.round(wrap(hour) * 60) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const daytime = (hour, { rise, set }) => hour >= rise && hour < set;
const clockHour = (date = new Date()) => date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;

const NAMES = { cloud: ['Broken cloud', 'Cloud', 'Overcast'], fog: ['Thin fog', 'Fog', 'Thick fog'], rain: ['Drizzle', 'Rain', 'Heavy rain'], storm: ['Distant thunder', 'Thunderstorm', 'Violent storm'], snow: ['Flurries', 'Snow', 'Heavy snow'] };
const NOUNS = { clear: 'clear sky', cloud: 'cloud', fog: 'fog', rain: 'rain', storm: 'thunder', snow: 'snow' };
function phase(hour, { rise, set }) {
  const noon = (rise + set) / 2;
  if (hour >= rise - .4 && hour < rise + .8) return 'at dawn';
  if (hour >= rise + .8 && hour < 9.5) return 'in the early morning';
  if (hour >= 9.5 && hour < noon - .9) return 'in the morning';
  if (hour >= noon - .9 && hour < noon + .9) return 'at noon';
  if (hour >= noon + .9 && hour < set - 1.3) return 'in the afternoon';
  if (hour >= set - 1.3 && hour < set - .1) return 'at golden hour';
  if (hour >= set - .1 && hour < set + .9) return 'at dusk';
  if (hour >= set + .9 && hour < 22.8) return 'in the evening';
  if (hour >= 22.8 || hour < .6) return 'around midnight';
  return hour >= rise - 2 ? 'before dawn' : 'in the small hours';
}
export function headline(sky) {
  const when = phase(sky.hour, sky.light);
  const what = sky.kind === 'clear' ? (daytime(sky.hour, sky.light) || /dawn|dusk/.test(when) ? 'Clear skies' : 'Starlight')
    : NAMES[sky.kind][sky.intensity < .45 ? 0 : sky.intensity < .78 ? 1 : 2];
  return [what, when + '.'];
}

// The panels (sky menu, free camera) share the camp card's slot. Each opening replays their entrance: taking the
// hidden attribute off restarts their animations.
export function panel(element) {
  let timer = 0, open = false;
  return {
    get open() { return open; },
    show() {
      clearTimeout(timer);
      open = true;
      if (element.hidden) { element.hidden = false; void element.offsetWidth; }
      element.classList.add('is-visible');
    },
    hide() {
      open = false;
      element.classList.remove('is-visible');
      clearTimeout(timer);
      timer = setTimeout(() => { if (!open) element.hidden = true; }, 900);
    }
  };
}

export function createSkyMenu({ weather, reduced, onToggle, onFree, onDone }) {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const button = $('mountain-sky'), read = $('mountain-sky-read'), sun = $('mountain-sky-sun'), horizonMark = $('mountain-sky-horizon');
  const almanac = $('mountain-almanac'), title = $('almanac-title'), dial = $('almanac-dial'), kinds = $('almanac-kinds');
  const strength = $('almanac-strength'), strengthBox = strength.closest('label'), live = $('almanac-live'), liveText = $('almanac-live-text');
  const cue = $('mountain-cue');
  const view = panel(almanac);
  let built = null, words = '', readout = '', tween = 0, lastTick = 0;

  // The dial for a day's sunrise and sunset. Angles run clockwise from the top, where noon is.
  function build(light) {
    const noon = (light.rise + light.set) / 2, R = 84;
    const at = (hour, r = R) => { const a = (hour - noon) / 24 * TAU; return [r * Math.sin(a), -r * Math.cos(a)]; };
    const horizon = at(light.rise)[1];
    const svg = node('svg', { viewBox: '-100 -100 200 200', 'aria-hidden': 'true', focusable: 'false' });
    const glow = node('radialGradient', { id: 'almanac-halo' }, node('defs', {}, svg));
    node('stop', { offset: 0, 'stop-color': '#ffcf7d', 'stop-opacity': .5 }, glow);
    node('stop', { offset: 1, 'stop-color': '#ffcf7d', 'stop-opacity': 0 }, glow);
    // The sun's day is a solid arc over the top; the night under the horizon is dotted, like the trail.
    const [x0, y0] = at(light.rise), [x1, y1] = at(light.set), long = light.set - light.rise > 12;
    node('path', { d: `M${fixed(x1)} ${fixed(y1)}A${R} ${R} 0 ${long ? 0 : 1} 1 ${fixed(x0)} ${fixed(y0)}`, class: 'dial-night' }, svg);
    node('path', { d: `M${fixed(x0)} ${fixed(y0)}A${R} ${R} 0 ${long ? 1 : 0} 1 ${fixed(x1)} ${fixed(y1)}`, class: 'dial-day', pathLength: 1 }, svg);
    const ticks = node('g', { class: 'dial-ticks' }, svg);
    for (let hour = 0; hour < 24; hour++) {
      const major = hour % 6 === 0, [ax, ay] = at(hour, R - (major ? 9 : 4.5)), [bx, by] = at(hour, R);
      node('line', { x1: fixed(ax), y1: fixed(ay), x2: fixed(bx), y2: fixed(by), class: major ? 'is-major' : 'is-minor' }, ticks);
    }
    for (const hour of [0, 6, 12, 18]) {
      const [x, y] = at(hour, R + 10.5);
      node('text', { x: fixed(x), y: fixed(y), dy: '.36em', class: 'dial-numeral' }, svg).textContent = String(hour).padStart(2, '0');
    }
    node('line', { x1: -100, x2: 100, y1: fixed(horizon), y2: fixed(horizon), class: 'dial-horizon', pathLength: 1 }, svg);
    const ridge = [[-46, 0], [-33, -8], [-24, -12], [-15, -21], [-7, -29], [0, -35], [6, -28], [12, -24], [20, -16], [29, -10], [46, 0]];
    node('polyline', { points: ridge.map(([x, y]) => x + ',' + fixed(horizon + y)).join(' '), class: 'dial-ridge', pathLength: 1 }, svg);
    const now = node('line', { class: 'dial-now' }, svg);
    const time = node('text', { x: 0, y: fixed((horizon + 72) / 2 + 7), class: 'dial-time' }, svg);
    const marker = node('g', { class: 'dial-marker' }, svg);
    node('circle', { r: 17, fill: 'url(#almanac-halo)', class: 'dial-halo' }, marker);
    node('circle', { r: 6.5, class: 'dial-sun' }, marker);
    node('path', { d: 'M0-6.5A6.5 6.5 0 0 0 0 6.5A8 8 0 0 1 0-6.5Z', class: 'dial-moon' }, marker);
    dial.replaceChildren(svg);
    return { light, at, now, time, marker, hourAt: (x, y) => wrap(noon + Math.atan2(x, -y) / TAU * 24) };
  }

  function place(sky) {
    const { at, now, time, marker } = built;
    const [x, y] = at(sky.hour);
    marker.setAttribute('transform', `translate(${fixed(x)} ${fixed(y)})`);
    marker.classList.toggle('is-night', !daytime(sky.hour, sky.light));
    time.textContent = clockText(sky.hour);
    // The visitor's own hour stays marked on the rim while another is set.
    const real = clockHour(), [ax, ay] = at(real, 89), [bx, by] = at(real, 96);
    for (const [name, value] of Object.entries({ x1: ax, y1: ay, x2: bx, y2: by })) now.setAttribute(name, fixed(value));
    now.classList.toggle('is-shown', Math.abs(wrap(real - sky.hour + 12) - 12) > .05);
    dial.setAttribute('aria-valuenow', sky.hour.toFixed(2));
    dial.setAttribute('aria-valuetext', clockText(sky.hour) + (sky.manual ? '' : ', your own clock'));
  }

  // The header's readout: the valley's hour and sky, and a small dial with the sun (or moon) on it.
  function mark(sky) {
    const noon = (sky.light.rise + sky.light.set) / 2, a = (sky.hour - noon) / 24 * TAU;
    sun.setAttribute('cx', fixed(9 * Math.sin(a)));
    sun.setAttribute('cy', fixed(-9 * Math.cos(a)));
    const horizon = fixed(-9 * Math.cos((sky.light.rise - noon) / 24 * TAU));
    horizonMark.setAttribute('y1', horizon);
    horizonMark.setAttribute('y2', horizon);
    button.classList.toggle('is-night', !daytime(sky.hour, sky.light));
  }

  function refresh() {
    const sky = weather.now();
    const text = clockText(sky.hour) + ' ' + sky.kind;
    if (text !== readout) {
      readout = text;
      read.replaceChildren(Object.assign(document.createElement('b'), { textContent: clockText(sky.hour) }), ' ' + sky.kind);
      button.setAttribute('aria-label', 'On the mountain: ' + clockText(sky.hour) + ', ' + NOUNS[sky.kind] + ' below the clouds. Change the hour and the weather');
      mark(sky);
    }
    if (!view.open) return;
    if (!built || Math.abs(built.light.rise - sky.light.rise) + Math.abs(built.light.set - sky.light.set) > .01) built = build(sky.light);
    place(sky);
    const [what, when] = headline(sky);
    if (what + when !== words) {
      // The first reading comes in with the panel; later ones surface on their own.
      const first = !words;
      words = what + when;
      title.replaceChildren(what, document.createElement('br'), when);
      title.classList.remove('is-new');
      if (!first) { void title.offsetWidth; title.classList.add('is-new'); }
    }
    for (const input of kinds.querySelectorAll('input')) {
      input.checked = input.value === sky.kind;
      input.closest('label').classList.toggle('is-today', input.value === sky.today);
    }
    if (document.activeElement !== strength) strength.value = sky.intensity;
    strength.disabled = sky.kind === 'clear';
    strengthBox.classList.toggle('is-off', strength.disabled);
    live.disabled = !sky.manual;
    liveText.textContent = sky.manual ? 'Follow my clock' : 'Your clock · live';
  }

  // Jumps of more than a few minutes glide round the dial, the shorter way.
  function setHour(hour, animate, done) {
    cancelAnimationFrame(tween);
    const from = weather.now().hour, delta = wrap(hour - from + 12) - 12;
    if (!animate || reduced.matches || Math.abs(delta) < .15) { weather.setHour(wrap(hour)); done?.(); refresh(); return; }
    const start = performance.now(), duration = 320 + Math.abs(delta) * 45;
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      weather.setHour(wrap(from + delta * easeInOut(t)));
      if (t === 1) done?.();
      refresh();
      if (t < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }

  let dragging = null;
  const pointerHour = event => {
    const box = dial.getBoundingClientRect(), s = 200 / box.width;
    const x = (event.clientX - box.left) * s - 100, y = (event.clientY - box.top) * s - 100;
    return Math.hypot(x, y) > 28 ? built.hourAt(x, y) : null;
  };
  dial.addEventListener('pointerdown', event => {
    if (!built || event.button > 0) return;
    const hour = pointerHour(event);
    if (hour === null) return;
    event.preventDefault();
    dial.setPointerCapture(event.pointerId);
    dragging = event.pointerId;
    dial.classList.add('is-dragging');
    dial.focus({ preventScroll: true });
    setHour(hour, true);
  });
  dial.addEventListener('pointermove', event => {
    if (dragging !== event.pointerId) return;
    const hour = pointerHour(event);
    if (hour !== null) setHour(hour, false);
  });
  const release = event => { if (dragging === event.pointerId) { dragging = null; dial.classList.remove('is-dragging'); } };
  dial.addEventListener('pointerup', release);
  dial.addEventListener('pointercancel', release);
  dial.addEventListener('keydown', event => {
    const steps = { ArrowRight: .25, ArrowUp: .25, ArrowLeft: -.25, ArrowDown: -.25, PageUp: 1, PageDown: -1 };
    if (!(event.key in steps)) return;
    event.preventDefault();
    setHour(weather.now().hour + steps[event.key], false);
  });

  kinds.addEventListener('change', event => { weather.set(event.target.value, +strength.value, true); refresh(); });
  strength.addEventListener('input', () => { weather.set(weather.now().kind, +strength.value, true); refresh(); });
  // Back to the visitor's clock and the day's own weather: the sun glides home first.
  live.addEventListener('click', () => {
    // The button turns into a status once live, so the focus moves on to the dial.
    dial.focus({ preventScroll: true });
    weather.set(null, NaN, true);
    setHour(clockHour(), true, () => weather.setHour(null));
  });
  button.addEventListener('click', () => { dismissCue(true); onToggle(); });
  $('almanac-free').addEventListener('click', () => onFree());
  $('almanac-done').addEventListener('click', () => onDone());
  almanac.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); onDone(); } });

  // The first visits: a line drops from the readout to a note on what it is. Shown twice at most, and never again
  // once the menu has been opened.
  const KEY = 'g3.sky.cue';
  const remembered = () => { try { return +(localStorage.getItem(KEY) || 0); } catch { return 9; } };
  const remember = value => { try { localStorage.setItem(KEY, String(value)); } catch { /* private mode */ } };
  let cueTimer = 0;
  function cueLater(delay) {
    if (remembered() >= 2 || !cue.hidden) return;
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => {
      remember(remembered() + 1);
      cue.querySelector('.cue-text').textContent = 'The mountain keeps your own hour, and below the clouds, today’s ' + NOUNS[weather.now().today] + '.';
      cue.hidden = false;
      root.classList.add('mountain-cueing');
      cueTimer = setTimeout(() => dismissCue(), 9000);
    }, delay);
  }
  function dismissCue(opened) {
    clearTimeout(cueTimer);
    if (opened) remember(9);
    if (cue.hidden) return;
    root.classList.remove('mountain-cueing');
    cue.classList.add('is-leaving');
    setTimeout(() => { cue.hidden = true; cue.classList.remove('is-leaving'); }, 700);
  }
  cue.addEventListener('click', () => { dismissCue(true); onToggle(); });

  button.hidden = false;
  refresh();
  return {
    get open() { return view.open; },
    show() {
      dismissCue(true);
      built = null;
      words = '';
      view.show();
      button.setAttribute('aria-expanded', 'true');
      refresh();
      requestAnimationFrame(() => dial.focus({ preventScroll: true }));
    },
    hide() {
      if (!view.open) return;
      const inside = almanac.contains(document.activeElement);
      cancelAnimationFrame(tween);
      view.hide();
      button.setAttribute('aria-expanded', 'false');
      if (inside) button.focus({ preventScroll: true });
    },
    // Called every frame; the clock is read twice a second.
    tick(now) { if (now - lastTick > 500) { lastTick = now; refresh(); } },
    cueLater, dismissCue
  };
}
