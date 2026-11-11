// The mountain's sound: recordings, not synthesis. Two layers that never borrow from each other:
//   music  solo piano, recorded (public domain; the sources are listed in content/sound/CREDITS.md), one piece for
//          each kind of place: Satie's first Gymnopédie on the mountain, Chopin's E minor Nocturne in the Heart,
//          Chopin's "Harp" Étude out at the moon. A piece plays through, rests, and starts again; it picks up where it
//          was when the lens comes back. Going between places one gives way to the other; leaving for the moon the old
//          one closes behind a low-pass, as the air does, and the new one opens out over the flight.
//   air    field recordings of where the lens is: wind, more of it higher up and on the move, gone in the Heart and
//          out past the air; rain in the valley, light or heavy; thunder after the lightning, by its distance. And the
//          waterfall, the one sound made here, by distance and bearing. The ground's own sounds (water, rain, thunder)
//          are not heard above Camp III.
// Nothing sounds for a click, a step or an arrival: moving only changes the wind. Two choices of what to hear: the
// piano with the air ('piano'), or the air alone ('nature').
// Sound is off until the visitor turns it on; that choice, the music and the volume are remembered. Browsers only let a
// page make sound after a touch or a key, so a remembered "on" waits for the first one. The recordings are fetched
// only once they are needed.

const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const THEMES = ['piano', 'nature'];
// Each recording's level, so they sit together (measured: RMS over the recording, dBFS).
const LEVEL = {
  'satie-gymnopedie-1': -30.6, 'chopin-nocturne-e-minor': -28.8, 'chopin-harp-study': -29.6,
  wind: -37.1, 'rain-light': -47.5, 'rain-heavy': -27.6, 'thunder-near': -21, 'thunder-clap': -19, 'thunder-roll-1': -27, 'thunder-roll-2': -26, 'thunder-roll-3': -27, drops: -45
};
const toUnity = name => 10 ** ((-30 - (LEVEL[name] ?? -30)) / 20);
// The piece for each kind of place.
const PIECES = { trail: 'satie-gymnopedie-1', heart: 'chopin-nocturne-e-minor', moon: 'chopin-harp-study' };
const placeOf = scene => scene.stop === 'heart' ? 'heart' : scene.stop === 'moonward' ? 'moon' : 'trail';
// Where each of the pool's drops starts in its recording (drops.mp3), in seconds.
const DROPS = [.1, 1.3, 1.7, 2.9, 3.9];

const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

// sounds: { name: url } for the recordings (main.js reads it from the page). context: an OfflineAudioContext to render
// into, for tests (then drive it with advance(); music is decoded rather than streamed there).
export function createAudio({ context = null, sounds = {} } = {}) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const supported = Boolean(context || Context);
  const storedTheme = read('g3-theme');
  let enabled = !context && read('g3-sound') === 'on', theme = THEMES.includes(storedTheme) ? storedTheme : THEMES[0];
  // The volume, 0 to 1, heard on a curve so the slider's middle sounds like the middle.
  const stored = Number.parseFloat(read('g3-volume'));
  let volume = !context && Number.isFinite(stored) ? clamp(stored) : .75;
  const loudness = () => .85 * (volume / .75) ** 1.7;
  let ctx = null, graph = null, hushed = false, timer = 0;
  let scene = { stop: 'idle', camp: -1, camps: 5, travelling: false }, place = 'trail';

  // ---- Recordings: fetched and decoded once, when first wanted -----------------------------------------------------
  const buffers = new Map();
  function buffer(name) {
    if (!buffers.has(name)) {
      const url = sounds[name];
      buffers.set(name, { value: null, promise: url ? fetch(url).then(r => r.arrayBuffer()).then(data => new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)))
        .then(value => { buffers.get(name).value = value; return value; }).catch(() => null) : Promise.resolve(null) });
    }
    return buffers.get(name);
  }

  // ---- The room ------------------------------------------------------------------------------------------------------
  function build() {
    ctx = context || new Context({ latencyHint: 'playback' });
    const gain = (value, to) => { const node = ctx.createGain(); node.gain.value = value; if (to) node.connect(to); return node; };
    const master = gain(0), limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 8; limiter.ratio.value = 6; limiter.attack.value = .005; limiter.release.value = .25;
    master.connect(limiter).connect(ctx.destination);
    const music = gain(1.5, master), air = gain(1, master);
    // A small dark room for the drops in the Heart's pool: noise dying away, losing its top as it goes.
    const length = Math.round(2.6 * ctx.sampleRate), impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const out = impulse.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < length; i++) { const t = i / length; low += ((Math.random() * 2 - 1) - low) * (.35 - .3 * Math.sqrt(t)); out[i] = low * Math.exp(-t * 5.5) * .6; }
    }
    const cave = ctx.createConvolver();
    cave.buffer = impulse;
    cave.connect(gain(.55, air));
    graph = { gain, master, music, air, cave, level: 0 };
    graph.falls = falls();
    graph.beds = { wind: bed('wind'), light: bed('rain-light'), heavy: bed('rain-heavy') };
    graph.tracks = {};
    return graph;
  }

  // The waterfall: not a hiss but a soft roar, its weight between about 100 and 700 Hz, that swells and settles as the
  // water comes down in gouts. A few seconds of it, different in each ear, written once and looped (the tail folded
  // into the start, so the loop has no seam).
  function falls() {
    const rate = ctx.sampleRate, length = Math.round(6 * rate), blend = Math.round(.1 * rate), data = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const out = data.getChannelData(channel);
      let b0 = 0, b1 = 0, b2 = 0, low = 0, floor = 0, swell = 1, aim = 1;
      for (let i = 0; i < length + blend; i++) {
        const white = Math.random() * 2 - 1;
        b0 = .99765 * b0 + white * .099046; b1 = .963 * b1 + white * .2965164; b2 = .57 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2 + white * .1848) * .2;
        low += (pink - low) * (4400 / rate);
        floor += (low - floor) * (700 / rate);
        if (i % Math.round(rate * .16) === 0) aim = .7 + Math.random() * .6;
        swell += (aim - swell) * (4 / rate);
        const v = ((low - floor) * 1.6 + pink * .22) * swell;
        if (i < length) out[i] = v; else { const k = (i - length) / blend; out[i - length] = out[i - length] * k + v * (1 - k); }
      }
    }
    const source = ctx.createBufferSource(), tone = ctx.createBiquadFilter(), level = graph.gain(0), place = ctx.createStereoPanner();
    source.buffer = data; source.loop = true;
    tone.type = 'lowpass'; tone.frequency.value = 2400;
    source.connect(tone).connect(level).connect(place).connect(graph.air);
    source.start();
    return { level, place };
  }

  // A recording that goes on as long as it is wanted: two voices take turns, each from somewhere else in it, crossing
  // over for a few seconds, so it never audibly loops. Fetched the first time it is turned up.
  function bed(name) {
    const level = graph.gain(0), tone = ctx.createBiquadFilter(), place = ctx.createStereoPanner(), unity = toUnity(name);
    tone.type = 'lowpass'; tone.frequency.value = 18000; tone.Q.value = .4;
    level.connect(tone).connect(place).connect(graph.air);
    let next = 0, wanted = false;
    return {
      level, tone, place,
      want(on) { wanted = wanted || on; if (on) buffer(name); },
      // Writes voices up to `until`.
      schedule(until) {
        const data = wanted && buffers.get(name)?.value;
        if (!data) return;
        const fade = 3, now = ctx.currentTime;
        if (next < now) next = now;
        while (next < until) {
          const span = Math.min(data.duration - .5, 12 + Math.random() * 10), from = .2 + Math.random() * Math.max(0, data.duration - span - .4);
          const source = ctx.createBufferSource(), shape = graph.gain(0);
          source.buffer = data;
          shape.gain.setValueAtTime(0, next);
          shape.gain.linearRampToValueAtTime(unity, next + fade);
          shape.gain.setValueAtTime(unity, next + span - fade);
          shape.gain.linearRampToValueAtTime(0, next + span);
          source.connect(shape).connect(level);
          source.start(next, from, span);
          next += span - fade;
        }
      }
    };
  }

  // ---- Music ---------------------------------------------------------------------------------------------------------
  // A piece, streamed from its recording through a fader and a low-pass. It plays through, rests, and starts again;
  // stopped, it keeps its place. In a test it is decoded instead and played from the start.
  function track(name) {
    const fader = graph.gain(0), tone = ctx.createBiquadFilter(), unity = toUnity(name);
    tone.type = 'lowpass'; tone.frequency.value = 20000; tone.Q.value = .5;
    fader.connect(tone).connect(graph.music);
    let element = null, rest = 0, playing = false;
    if (!context && ctx.createMediaElementSource && sounds[name]) {
      element = new Audio();
      element.preload = 'auto';
      element.src = sounds[name];
      ctx.createMediaElementSource(element).connect(fader);
      element.addEventListener('ended', () => { clearTimeout(rest); rest = setTimeout(() => { if (playing) { element.currentTime = 0; element.play().catch(() => {}); } }, 7000); });
    }
    const start = () => {
      if (element) { element.play().catch(() => {}); return; }
      buffer(name).promise.then(data => {
        if (!data || !playing) return;
        const source = ctx.createBufferSource();
        source.buffer = data; source.connect(fader); source.start(ctx.currentTime + .05);
      });
    };
    return {
      // Comes in over `seconds`, after `delay`; opening from a muffled `from` Hz when it comes out of the air.
      play(seconds = 2.5, delay = 0, from = 0) {
        const now = ctx.currentTime, f = tone.frequency, g = fader.gain;
        clearTimeout(this.stopping);
        g.cancelScheduledValues(now); f.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.setValueAtTime(g.value, now + delay);
        g.linearRampToValueAtTime(unity, now + delay + seconds);
        f.setValueAtTime(from || 20000, now);
        if (from) { f.setValueAtTime(from, now + delay); f.exponentialRampToValueAtTime(20000, now + delay + seconds * 1.6); }
        if (!playing) { playing = true; start(); }
      },
      // Goes over `seconds`; closing down to `to` Hz first when it is left behind under the air.
      stop(seconds = 2.5, to = 0) {
        const now = ctx.currentTime, f = tone.frequency, g = fader.gain;
        g.cancelScheduledValues(now); f.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + seconds);
        f.setValueAtTime(f.value, now);
        if (to) f.exponentialRampToValueAtTime(to, now + seconds * .8);
        clearTimeout(this.stopping);
        this.stopping = setTimeout(() => { if (fader.gain.value < .001 || context) { playing = false; element?.pause(); } }, (seconds + .3) * 1000);
      },
      pause() { element?.pause(); },
      // Some browsers let a page start a piece by itself only once that piece has been started from a touch: each is
      // started and stopped again (silently) with the first one.
      prime() { if (element && !playing) element.play().then(() => { if (!playing) element.pause(); }).catch(() => {}); },
      resume() { if (playing) element?.play().catch(() => {}); }
    };
  }
  const trackFor = which => graph.tracks[which] ||= track(PIECES[which]);
  // Into the new place's piece. Out to the moon (sweep 1) the old one closes behind a low-pass over the flight and the
  // new opens out of one; home (sweep -1) the same the other way, quicker. Into or out of the Heart, the rock muffles the
  // old one as the lens goes through, and the new comes up once it is through.
  function turn(from, to, sweep) {
    if (from && graph.tracks[from]) graph.tracks[from].stop(sweep > 0 ? 4.5 : sweep < 0 ? 3 : 2, sweep ? 300 : 900);
    if (theme !== 'piano') return;
    if (sweep > 0) trackFor(to).play(5, 1.5, 380);
    else if (sweep < 0) trackFor(to).play(3.5, 1.4, 500);
    else if (from) trackFor(to).play(2.5, 2);
    else trackFor(to).play(3);
  }

  // ---- The air -------------------------------------------------------------------------------------------------------
  let ground = 1;
  // Where the lens is and what is near it; called a few times a second. Everything eases to its new level. ground:
  // how much of the ground's own sound (water, rain, thunder) reaches the lens, 1 low down and 0 above Camp III.
  function listener(state) {
    if (!graph || hushed) return;
    ground = clamp(state.ground ?? 1);
    const now = ctx.currentTime, beds = graph.beds, outside = state.inside ? 0 : 1, aloft = state.sky || 0, moving = state.moving || 0;
    const set = (layer, level, pan = 0) => { layer.level.gain.setTargetAtTime(level, now, .5); layer.place.pan.setTargetAtTime(clamp(pan, -1, 1), now, .3); };
    const toward = at => { const d = [at[0] - state.eye[0], at[1] - state.eye[1], at[2] - state.eye[2]], l = Math.hypot(...d) || 1; return { distance: l, pan: (d[0] * state.right[0] + d[1] * state.right[1] + d[2] * state.right[2]) / l }; };
    // Wind: a little low down, more higher up and while the lens is moving; fading out as the air runs out.
    const high = smooth(1, 11, state.height), wind = outside * (.17 + .22 * high + .2 * moving) * (1 - aloft);
    beds.wind.want(wind > .01);
    set(beds.wind, wind);
    beds.wind.tone.frequency.setTargetAtTime(1400 + 9000 * Math.max(high, moving), now, .8);
    // The waterfall, by distance and bearing.
    const fall = state.fall ? toward(state.fall) : null;
    set(graph.falls, fall ? outside * ground * (1 - aloft) * .2 / (1 + (fall.distance / 5.5) ** 2) : 0, fall ? fall.pan : 0);
    // Rain in the valley (a storm's too): light, and under a heavy fall the heavy one over it.
    const raining = state.weather === 'rain' || state.weather === 'storm' ? outside * ground * (1 - aloft) : 0, hard = clamp(state.intensity || 0);
    const light = raining * (.22 + .25 * hard), heavy = raining * smooth(.35, 1, hard) * (state.weather === 'storm' ? .85 : .7);
    beds.light.want(light > .01); beds.heavy.want(heavy > .01);
    set(beds.light, light); set(beds.heavy, heavy);
    // In a storm the thunder is fetched ahead, so the first clap is not late after its flash.
    if (state.weather === 'storm') for (const name of ['thunder-near', 'thunder-clap', ...ROLLS]) buffer(name);
  }

  // ---- The few things that sound when they happen ----------------------------------------------------------------
  const ROLLS = ['thunder-roll-1', 'thunder-roll-2', 'thunder-roll-3'];
  const SOUNDS = {
    // Thunder, after the flash by as long as the sound takes to come: close, a clap; far off, a low roll. near: 1
    // overhead, 0 at the far end of the valley.
    thunder(start, { near = .5, pan = 0, delay = 0 }) {
      if (ground < .02) return;
      const name = near > .62 ? (Math.random() < .5 ? 'thunder-near' : 'thunder-clap') : ROLLS[Math.floor(Math.random() * ROLLS.length)];
      buffer(name).promise.then(data => {
        if (!data || !graph) return;
        const source = ctx.createBufferSource(), tone = ctx.createBiquadFilter(), level = graph.gain(toUnity(name) * (.6 + 2 * near) * ground), place = ctx.createStereoPanner();
        tone.type = 'lowpass'; tone.frequency.value = 500 + 9000 * near * near;
        place.pan.value = clamp(pan, -1, 1) * .8;
        source.buffer = data;
        source.connect(tone).connect(level).connect(place).connect(graph.air);
        source.start(Math.max(ctx.currentTime, start + delay));
      });
    },
    // A drop into the Heart's pool, in the hollow of the chamber.
    drip(start, { pan = 0, strength = 1 }) {
      const data = buffer('drops').value;
      if (!data) return;
      const source = ctx.createBufferSource(), level = graph.gain(toUnity('drops') * .5 * strength), place = ctx.createStereoPanner();
      source.buffer = data; place.pan.value = clamp(pan, -1, 1);
      source.connect(level).connect(place);
      place.connect(graph.air); place.connect(graph.cave);
      source.start(start, DROPS[Math.floor(Math.random() * DROPS.length)], .5);
    }
  };
  function play(name, options = {}) {
    if (!graph || !enabled || hushed || ctx.state !== 'running' && !context) return;
    SOUNDS[name]?.(ctx.currentTime + .01, options);
  }

  // Keeps the beds written a little ahead; called on a timer, or by a test with a time to reach.
  function advance(until) {
    if (!graph) return;
    until ??= ctx.currentTime + 1.5;
    for (const layer of Object.values(graph.beds)) layer.schedule(until);
  }

  // ---- On, off, and the browser's rule about the first touch ----------------------------------------------------
  function level(to, seconds = .6) {
    if (!graph) return;
    const now = ctx.currentTime;
    graph.master.gain.cancelScheduledValues(now);
    graph.master.gain.setTargetAtTime(to, now, seconds / 3);
    graph.level = to;
  }
  let started = false;
  function run() {
    if (!graph) build();
    level(loudness(), 1.2);
    if (!started) { started = true; turn(null, place, 0); if (!context) for (const which of Object.keys(PIECES)) if (which !== place) trackFor(which).prime(); }
    else if (theme === 'piano') graph.tracks[place]?.resume();
    if (context) return;
    clearInterval(timer);
    timer = setInterval(() => { if (ctx.state === 'running' && !hushed) advance(); }, 400);
    advance();
  }
  // A remembered "on", or one given before any touch: start at the first touch or key.
  const unlock = () => {
    if (!enabled) return;
    if (!graph) run();
    if (ctx.state !== 'running') ctx.resume().then(() => { if (enabled && !hushed) run(); }).catch(() => {});
  };
  if (supported && !context) for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, unlock, { passive: true, capture: true });
  // The drops are small: fetched with the first sound, so a touch on the pool is heard at once.
  const prefetch = () => { if (sounds.drops) buffer('drops'); };

  return {
    supported, themes: THEMES,
    get enabled() { return enabled; },
    get theme() { return theme; },
    get volume() { return volume; },
    get running() { return Boolean(graph) && (Boolean(context) || ctx.state === 'running'); },
    // For checks: the context, and the mix before the limiter.
    get context() { return ctx; },
    get output() { return graph?.master || null; },
    // Call from a click or a key: the browser starts sound only then.
    setEnabled(on) {
      if (!supported) return;
      enabled = Boolean(on);
      if (!context) write('g3-sound', enabled ? 'on' : 'off');
      if (enabled) {
        run();
        prefetch();
        if (!context) ctx.resume().catch(() => {});
      } else if (graph) {
        level(0, .4);
        clearInterval(timer);
        setTimeout(() => { if (!enabled) for (const t of Object.values(graph.tracks)) t.pause(); }, 600);
      }
    },
    setTheme(next) {
      if (!THEMES.includes(next) || next === theme) return;
      theme = next;
      if (!context) write('g3-theme', theme);
      if (!graph || !enabled) return;
      if (theme === 'piano') trackFor(place).play(2.5); else graph.tracks[place]?.stop(2);
    },
    // 0 to 1; remembered.
    setVolume(next) {
      volume = clamp(Number(next) || 0);
      if (!context) write('g3-volume', volume.toFixed(2));
      if (graph && enabled && !hushed) level(loudness(), .12);
    },
    // What stop the page is at or heading for: { stop: 'idle' | 'camp' | 'heart' | 'moonward' | 'valley', camp, camps,
    // travelling }. The music follows the kind of place.
    scene(next) {
      scene = { ...scene, ...next };
      const to = placeOf(scene);
      if (to === place) return;
      const from = place;
      place = to;
      if (graph && enabled && started) turn(from, to, to === 'moon' ? 1 : from === 'moon' ? -1 : 0);
    },
    listener,
    play,
    // Quiet while the page is hidden or covered by a transition; back when it returns.
    hush(on) {
      if (hushed === Boolean(on)) return;
      hushed = Boolean(on);
      if (!graph || !enabled) return;
      if (hushed) { level(0, .35); setTimeout(() => { if (hushed) for (const t of Object.values(graph.tracks)) t.pause(); }, 500); }
      else { level(loudness(), .8); if (theme === 'piano') graph.tracks[place]?.resume(); advance(); }
    },
    advance
  };
}
