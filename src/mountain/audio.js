// The mountain's sound, all of it made here with Web Audio: no files to fetch. Three layers share one room:
//   music   three kinds to choose from (THEMES below), each written as rules rather than a recording, so it never loops
//           and it follows the climb: every stop has its own harmony, register and density. Out at the moon the same
//           rules are played on synthesizers instead (ORBIT below), with a slow arpeggio of their own under them;
//   air     what the place sounds like where the lens is: wind that grows with height, the waterfall and the trailhead's
//           fire by distance and bearing, the valley's rain and thunder, the hum of the chamber, the thin air past the
//           summit. The ground's own sounds (water, fire, weather) are not heard above Camp III;
//   sounds  one for each thing the page does (SOUNDS below): a step along the trail, an arrival at each camp, the
//           page's own controls, the transitions into a camp's page.
// Sound is off until the visitor turns it on; that choice, the music and the volume are remembered. Browsers only let a
// page make sound after a touch or a key, so a remembered "on" waits for the first one.

const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const NOTES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 'F#3' → MIDI number.
const note = name => { const [, letter, sharp, octave] = /^([A-G])([#b]?)(-?\d)$/.exec(name); return NOTES[letter] + (sharp === '#' ? 1 : sharp === 'b' ? -1 : 0) + (Number(octave) + 1) * 12; };
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const chord = (bass, tones) => ({ bass: note(bass), tones: tones.split(' ').map(note) });

// The harmony of each stop, in D: a short round of chords (a bass note and five tones the music draws on, low to
// high), how busy the music is there (energy), and how far up or down it is played (lift, in semitones).
const HARMONY = {
  idle: { energy: .35, lift: 0, round: [chord('D2', 'D3 A3 E4 F#4 A4'), chord('G2', 'D3 B3 D4 F#4 A4')] },
  // The trailhead at dawn: plain and bright.
  0: { energy: .55, lift: 0, round: [chord('D2', 'D3 A3 D4 F#4 A4'), chord('B2', 'D3 A3 B3 F#4 A4'), chord('G2', 'D3 G3 B3 D4 A4'), chord('A2', 'E3 A3 D4 E4 A4')] },
  // Photography in golden light: warmer, a step down.
  1: { energy: .68, lift: 0, round: [chord('G2', 'D3 B3 F#4 A4 D5'), chord('F#2', 'D3 A3 D4 F#4 A4'), chord('E2', 'D3 G3 B3 F#4 G4'), chord('A2', 'E3 G3 D4 E4 A4')] },
  // The Phantom at dusk: the relative minor, unresolved.
  2: { energy: .78, lift: 0, round: [chord('B2', 'F#3 A3 C#4 D4 F#4'), chord('G2', 'F#3 B3 D4 F#4 B4'), chord('E2', 'G3 B3 D4 F#4 G4'), chord('F#2', 'E3 A3 C#4 E4 A4')] },
  // The mailboxes: climbing, hopeful.
  3: { energy: .85, lift: 0, round: [chord('G2', 'D3 B3 E4 A4 D5'), chord('A2', 'E3 A3 C#4 E4 A4'), chord('B2', 'D3 A3 D4 F#4 B4'), chord('C#3', 'E3 A3 C#4 E4 A4')] },
  // The summit at night: wide open, the raised fourth of the Lydian mode like cold air.
  summit: { energy: .5, lift: 12, round: [chord('D2', 'A2 E3 F#3 C#4 E4'), chord('D2', 'B2 E3 G#3 B3 E4')] },
  // The Heart: the same D turned minor, low and slow.
  heart: { energy: .4, lift: -12, round: [chord('D2', 'A3 C4 E4 F4 A4'), chord('Bb1', 'Bb3 D4 F4 A4 C5'), chord('C2', 'G3 C4 D4 E4 G4'), chord('D2', 'A3 D4 E4 F4 A4')] },
  // Moonward: far above, sparse, never quite landing.
  moonward: { energy: .42, lift: 12, round: [chord('F#2', 'C#3 E3 A3 B3 E4'), chord('D2', 'A2 C#3 G#3 E4 F#4'), chord('E2', 'B2 E3 G#3 B3 F#4')] }
};
const harmonyOf = scene => HARMONY[scene.stop === 'camp' ? (scene.camp >= scene.camps - 1 ? 'summit' : Math.min(scene.camp, 3)) : scene.stop] || HARMONY.idle;

export const THEMES = ['hearth', 'thin-air', 'lanterns'];
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

// context: an OfflineAudioContext to render into, for tests (then drive the music with advance()).
export function createAudio({ context = null } = {}) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const supported = Boolean(context || Context);
  let enabled = !context && read('g3-sound') === 'on', theme = THEMES.includes(read('g3-theme')) ? read('g3-theme') : THEMES[0];
  // The volume, 0 to 1, heard on a curve so the slider's middle sounds like the middle.
  const stored = Number.parseFloat(read('g3-volume'));
  let volume = !context && Number.isFinite(stored) ? clamp(stored) : .75;
  const loudness = () => .85 * (volume / .75) ** 1.7;
  let ctx = null, graph = null, hushed = false, timer = 0, seed = 20261110;
  // orbit: the lens is out at the moon (or on its way), where the music is played on synthesizers.
  let orbit = false, orbitSince = 0;
  let scene = { stop: 'idle', camp: -1, camps: 5, time: 'idle', travelling: false };
  // The music's own dice, so it is never the same twice but never depends on the frame rate.
  const dice = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pickOne = list => list[Math.floor(dice() * list.length)];

  // ---- The room: buses, two reverbs, an echo, a limiter ------------------------------------------------------------
  function build() {
    ctx = context || new Context({ latencyHint: 'interactive' });
    const gain = (value, to) => { const node = ctx.createGain(); node.gain.value = value; if (to) node.connect(to); return node; };
    const master = gain(0), limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9; limiter.knee.value = 10; limiter.ratio.value = 8; limiter.attack.value = .004; limiter.release.value = .22;
    master.connect(limiter).connect(ctx.destination);
    const air = gain(1.7, master), sounds = gain(.85, master);
    // Reverb by convolution with noise that dies away, darker as it goes: a hall for the open mountain, a long dark
    // cavern for the Heart. Everything sends to both; `space` sets how much of each comes back.
    const impulse = (seconds, tone) => {
      const length = Math.round(seconds * ctx.sampleRate), buffer = ctx.createBuffer(2, length, ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const out = buffer.getChannelData(channel);
        let low = 0;
        for (let i = 0; i < length; i++) {
          const t = i / length, k = lerp(tone, .03, Math.sqrt(t));
          low += ((Math.random() * 2 - 1) - low) * k;
          out[i] = low * Math.exp(-t * 6.2) * Math.min(1, i / (ctx.sampleRate * .004)) / Math.sqrt(k) * .5;
        }
      }
      return buffer;
    };
    const send = gain(1), hall = ctx.createConvolver(), cavern = ctx.createConvolver();
    hall.buffer = impulse(3.1, .5); cavern.buffer = impulse(5.6, .22);
    const hallBack = gain(.5, master), cavernBack = gain(0, master);
    send.connect(hall).connect(hallBack);
    send.connect(cavern).connect(cavernBack);
    // An echo for the plucked and struck things: dotted, soft, losing its top each time round.
    const echo = ctx.createDelay(1.5), echoBack = gain(.34), echoTone = ctx.createBiquadFilter(), echoIn = gain(1);
    echo.delayTime.value = .51; echoTone.type = 'lowpass'; echoTone.frequency.value = 2400;
    echoIn.connect(echo).connect(echoTone).connect(echoBack).connect(echo);
    echoTone.connect(gain(.3, master));
    echoTone.connect(gain(.35, send));
    // Noise to carve the weather and the small hard sounds from: white, pink (equal energy in every octave, softer
    // than white) and brown (white, integrated: a rumble).
    const noise = kind => {
      const length = ctx.sampleRate * 2.5, buffer = ctx.createBuffer(1, length, ctx.sampleRate), out = buffer.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + .02 * white) / 1.02; out[i] = last * 3.5; }
        else if (kind === 'pink') { b0 = .99765 * b0 + white * .099046; b1 = .963 * b1 + white * .2965164; b2 = .57 * b2 + white * 1.0526913; out[i] = (b0 + b1 + b2 + white * .1848) * .2; }
        else out[i] = white;
      }
      return buffer;
    };
    // The waterfall: not a hiss but a soft roar, its weight between about 100 and 700 Hz, that swells and settles as
    // the water comes down in gouts. A few seconds of it, different in each ear, written once and looped (the tail is folded into the start,
    // so the loop has no seam).
    const falls = () => {
      const rate = ctx.sampleRate, length = Math.round(6 * rate), blend = Math.round(.1 * rate), buffer = ctx.createBuffer(2, length, rate);
      for (let channel = 0; channel < 2; channel++) {
        const out = buffer.getChannelData(channel);
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
      return buffer;
    };
    // The piano's partials, fixed once.
    const partials = new Float32Array([0, 1, .46, .2, .1, .06, .03, .02]);
    graph = { gain, master, airBus: air, sounds, send, hallBack, cavernBack, echoIn, white: noise('white'), pink: noise('pink'), brown: noise('brown'), falls: falls(), felt: ctx.createPeriodicWave(new Float32Array(partials.length), partials) };
    graph.music = musicBus(.62);
    graph.air = buildAir(air);
    graph.level = 0;
    return graph;
  }
  // The music's bus, through a low-pass filter that is wide open except while the music changes worlds (turnPage).
  function musicBus(level, open = 20000) {
    const bus = graph.gain(level), tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.Q.value = .5; tone.frequency.value = open;
    bus.connect(tone).connect(graph.master);
    bus.tone = tone;
    return bus;
  }

  // A voice's way out: straight to its bus, a share to the reverbs, a share to the echo, placed left or right.
  function out(bus, { wet = .3, echo = 0, pan = 0 } = {}) {
    const node = ctx.createStereoPanner();
    node.pan.value = clamp(pan, -1, 1);
    node.connect(bus);
    if (wet > 0) node.connect(graph.gain(wet, graph.send));
    if (echo > 0) node.connect(graph.gain(echo, graph.echoIn));
    return node;
  }
  // An envelope: up in `attack`, then dying away with time constant `decay` until `end`.
  function envelope(level, t, attack, decay, end, to) {
    const node = ctx.createGain();
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(level, t + attack);
    node.gain.setTargetAtTime(0, t + attack, decay);
    node.connect(to);
    return { node, stop: source => { source.start(t); source.stop(end); } };
  }

  // ---- Instruments ---------------------------------------------------------------------------------------------------
  // A felted piano: soft hammer, the tone darkening as it dies; low notes ring longer.
  function felt(t, midi, level = .5, { pan = 0, wet = .35, long = 1, bus = graph.music } = {}) {
    const f = hz(midi), decay = clamp(1.05 - (midi - 48) * .014, .3, 1.2) * long, end = t + decay * 6;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.Q.value = .3;
    tone.frequency.setValueAtTime(Math.min(9000, 500 + level * 3200 + f * 1.5), t);
    tone.frequency.exponentialRampToValueAtTime(Math.max(260, f * 1.3), t + decay * 2.2);
    const env = envelope(level * .3, t, .007, decay, end, tone);
    tone.connect(out(bus, { wet, pan }));
    const body = ctx.createOscillator(), air = ctx.createOscillator();
    body.setPeriodicWave(graph.felt); body.frequency.value = f; body.connect(env.node);
    air.frequency.value = f * 1.0025; air.connect(graph.gain(.35, env.node));
    env.stop(body); env.stop(air);
  }
  // A warm held chord tone: two detuned saws through a low filter that opens and closes with the note.
  function pad(t, midi, seconds, level = .1, { attack = 1.8, release = 2.6, bright = 850, pan = 0, wet = .45, bus = graph.music } = {}) {
    const f = hz(midi), end = t + seconds + release * 3, tone = ctx.createBiquadFilter(), env = ctx.createGain();
    tone.type = 'lowpass'; tone.Q.value = .5;
    tone.frequency.setValueAtTime(bright * .5, t);
    tone.frequency.linearRampToValueAtTime(bright, t + attack);
    tone.frequency.setTargetAtTime(bright * .45, t + seconds, release);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.setTargetAtTime(0, t + Math.max(attack, seconds), release * .5);
    tone.connect(env).connect(out(bus, { wet, pan }));
    for (const [type, detune, share] of [['sawtooth', -7, .5], ['sawtooth', 8, .5], ['sine', 0, .9]]) {
      const source = ctx.createOscillator();
      source.type = type; source.frequency.value = f; source.detune.value = detune;
      source.connect(graph.gain(share, tone));
      source.start(t); source.stop(end);
    }
  }
  // Breath on glass: a pure tone that swells and fades over many seconds, wavering a little.
  function breath(t, midi, seconds, level = .1, { attack = 4, release = 6, pan = 0, wet = .6, bus = graph.music } = {}) {
    const f = hz(midi), end = t + seconds + release * 3.5, env = ctx.createGain(), sway = ctx.createOscillator();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.setTargetAtTime(0, t + Math.max(attack, seconds), release * .5);
    env.connect(out(bus, { wet, pan }));
    sway.frequency.value = .11 + dice() * .1;
    sway.start(t); sway.stop(end);
    for (const [ratio, share] of [[1, 1], [2.001, .16], [.5, .3], [3.002, .05]]) {
      const source = ctx.createOscillator();
      source.frequency.value = f * ratio;
      sway.connect(graph.gain(f * ratio * .0018, source.frequency));
      source.connect(graph.gain(share, env));
      source.start(t); source.stop(end);
    }
  }
  // Struck glass: a sine bent by a faster one whose pull dies quickly, so it rings clean after a bright edge.
  function glass(t, midi, level = .4, { pan = 0, wet = .5, echo = 0, long = 1, bus = graph.music } = {}) {
    const f = hz(midi), decay = clamp(.95 - (midi - 72) * .012, .35, 1.1) * long, end = t + decay * 6;
    const env = envelope(level * .2, t, .004, decay, end, out(bus, { wet, echo, pan }));
    const carrier = ctx.createOscillator(), bender = ctx.createOscillator(), depth = ctx.createGain();
    carrier.frequency.value = f; bender.frequency.value = f * 3.51;
    depth.gain.setValueAtTime(f * 2.4 * level, t);
    depth.gain.setTargetAtTime(f * .08, t, .09);
    bender.connect(depth).connect(carrier.frequency);
    carrier.connect(env.node);
    env.stop(carrier); env.stop(bender);
  }
  // A music box's comb, or a thumb piano: the note, a quick bright partial above it, a short body below.
  function pluck(t, midi, level = .5, { pan = 0, wet = .3, echo = 0, long = 1, bus = graph.music } = {}) {
    const f = hz(midi), decay = clamp(.42 - (midi - 60) * .006, .16, .5) * long, end = t + decay * 6, way = out(bus, { wet, echo, pan });
    for (const [ratio, share, life] of [[1, 1, 1], [2, .28, .45], [4.18, .22, .09]]) {
      const env = envelope(level * .24 * share, t, .003, decay * life, end, way), source = ctx.createOscillator();
      source.frequency.value = f * ratio;
      source.connect(env.node);
      env.stop(source);
    }
  }
  // The floor under it all: a sine with a little triangle, slow to speak.
  function deep(t, midi, level = .4, { long = 1, bus = graph.music } = {}) {
    const decay = .9 * long, end = t + decay * 5, tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 320;
    const env = envelope(level * .3, t, .03, decay, end, tone);
    tone.connect(out(bus, { wet: .12 }));
    for (const [type, share] of [['sine', 1], ['triangle', .25]]) {
      const source = ctx.createOscillator();
      source.type = type; source.frequency.value = hz(midi);
      source.connect(graph.gain(share, env.node));
      env.stop(source);
    }
  }
  // A gliding sine: from one pitch to another over its life. The small hard sounds are made of these and of noise.
  function blip(t, from, to, seconds, level, { pan = 0, wet = .15, attack = .004, type = 'sine', bus = graph.sounds } = {}) {
    const env = envelope(level, t, attack, seconds * .35, t + seconds * 2.2, out(bus, { wet, pan })), source = ctx.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(from, t);
    source.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + seconds);
    source.connect(env.node);
    env.stop(source);
  }
  // Noise through a filter that can sweep: a puff, a hiss, a rush.
  function rush(t, seconds, level, { kind = 'white', type = 'bandpass', from = 1000, to = from, q = 1, attack = .005, pan = 0, panTo = pan, wet = .15, hold = false, bus = graph.sounds } = {}) {
    const source = ctx.createBufferSource(), tone = ctx.createBiquadFilter(), env = ctx.createGain(), way = out(bus, { wet, pan });
    source.buffer = graph[kind]; source.loop = true;
    tone.type = type; tone.Q.value = q;
    tone.frequency.setValueAtTime(from, t);
    tone.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + seconds);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    if (hold) env.gain.setTargetAtTime(0, t + seconds * .6, seconds * .16); else env.gain.setTargetAtTime(0, t + attack, seconds * .3);
    if (panTo !== pan) way.pan.linearRampToValueAtTime(clamp(panTo, -1, 1), t + seconds);
    source.connect(tone).connect(env).connect(way);
    source.start(t, Math.random() * 2); source.stop(t + seconds * (hold ? 1.6 : 2.2));
    return env;
  }

  // ---- The same music out at the moon: synthesizers in place of wood, felt and breath --------------------------------
  // An electric piano: a sine bent by another at its own pitch, the bend dying fast, so each note starts as a bell and
  // settles into a round tone, with a quiet tine an octave up. It stands in for the felted piano.
  function keys(t, midi, level = .5, { pan = 0, wet = .5, long = 1, bus = graph.music } = {}) {
    const f = hz(midi), decay = clamp(1.25 - (midi - 48) * .013, .4, 1.5) * long, end = t + decay * 6;
    const env = envelope(level * .17, t, .006, decay, end, out(bus, { wet, echo: .2, pan }));
    const carrier = ctx.createOscillator(), bender = ctx.createOscillator(), depth = ctx.createGain(), tine = ctx.createOscillator();
    carrier.frequency.value = f; bender.frequency.value = f;
    depth.gain.setValueAtTime(f * (1.1 + level * 1.4), t);
    depth.gain.setTargetAtTime(f * .18, t, .16);
    bender.connect(depth).connect(carrier.frequency);
    carrier.connect(env.node);
    tine.frequency.value = f * 2.004;
    tine.connect(graph.gain(.1, env.node));
    env.stop(carrier); env.stop(bender); env.stop(tine);
  }
  // A synthesizer pad: three detuned saws under a resonant filter that breathes slowly open and shut. It stands in for
  // the held chord and for the breaths on glass.
  function haze(t, midi, seconds, level = .1, { attack = 2.6, release = 3.6, bright = 1100, pan = 0, wet = .6, bus = graph.music } = {}) {
    const f = hz(midi), end = t + seconds + release * 3, tone = ctx.createBiquadFilter(), env = ctx.createGain(), sway = ctx.createOscillator();
    tone.type = 'lowpass'; tone.Q.value = 1.6;
    tone.frequency.setValueAtTime(bright * .3, t);
    tone.frequency.linearRampToValueAtTime(bright, t + attack);
    tone.frequency.setTargetAtTime(bright * .3, t + seconds, release);
    sway.frequency.value = .06 + dice() * .06;
    sway.connect(graph.gain(bright * .35, tone.frequency));
    sway.start(t); sway.stop(end);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level * .7, t + attack);
    env.gain.setTargetAtTime(0, t + Math.max(attack, seconds), release * .5);
    tone.connect(env);
    for (const detune of [-11, 0, 12]) {
      const source = ctx.createOscillator();
      source.type = 'sawtooth'; source.frequency.value = f; source.detune.value = detune + (dice() - .5) * 4;
      source.connect(graph.gain(.33, tone));
      source.start(t); source.stop(end);
    }
    env.connect(out(bus, { wet, pan }));
  }
  // A synthesizer pluck: a square and a saw through a resonant filter that snaps shut, echoing. For the music box.
  function zap(t, midi, level = .5, { pan = 0, wet = .35, echo = .3, long = 1, bright = 1, bus = graph.music } = {}) {
    const f = hz(midi), decay = clamp(.36 - (midi - 60) * .005, .13, .45) * long, end = t + decay * 6;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.Q.value = 5;
    tone.frequency.setValueAtTime(Math.min(11000, f * 6 * bright), t);
    tone.frequency.exponentialRampToValueAtTime(Math.max(180, f * 1.1), t + decay * 1.6);
    const env = envelope(level * .1, t, .003, decay, end, tone);
    tone.connect(out(bus, { wet, echo, pan }));
    for (const [type, detune] of [['square', -5], ['sawtooth', 6]]) {
      const source = ctx.createOscillator();
      source.type = type; source.frequency.value = f; source.detune.value = detune;
      source.connect(env.node);
      env.stop(source);
    }
  }
  // A sub: a sine that swells in under everything, with the faintest octave above it.
  function sub(t, midi, level = .4, { long = 1, bus = graph.music } = {}) {
    const decay = 1.6 * long, end = t + decay * 5, tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 260;
    const env = envelope(level * .32, t, .35, decay, end, tone);
    tone.connect(out(bus, { wet: .2 }));
    for (const [ratio, type, share] of [[1, 'sine', 1], [2, 'triangle', .12]]) {
      const source = ctx.createOscillator();
      source.type = type; source.frequency.value = hz(midi) * ratio;
      source.connect(graph.gain(share, env.node));
      env.stop(source);
    }
  }
  // What the scores play on: the mountain's instruments, or out at the moon, their synthesizer counterparts. Notes
  // already sounding finish on the instrument they began on.
  const I = {
    felt: (t, midi, level, options) => orbit ? keys(t, midi, level * 1.3, options) : felt(t, midi, level, options),
    pad: (t, midi, seconds, level, options = {}) => orbit ? haze(t, midi, seconds, level * 1.1, { ...options, bright: (options.bright || 850) * 1.5, attack: 2.4 }) : pad(t, midi, seconds, level, options),
    breath: (t, midi, seconds, level, options = {}) => orbit ? haze(t, midi, seconds, level * 3.2, { ...options, bright: 700 + midi * 6 }) : breath(t, midi, seconds, level, options),
    glass: (t, midi, level, options = {}) => glass(t, midi, level, orbit ? { ...options, long: (options.long || 1) * 1.6, echo: Math.max(options.echo || 0, .45) } : options),
    pluck: (t, midi, level, options = {}) => orbit ? zap(t, midi, level, { ...options, echo: Math.max(options.echo || 0, .3) }) : pluck(t, midi, level, options),
    deep: (...a) => (orbit ? sub : deep)(...a)
  };

  // ---- Air: the place itself, as a few noises that never stop, turned up and down by listener() -----------------
  function buildAir(bus) {
    const layer = (kind, type, frequency, q) => {
      const source = ctx.createBufferSource(), tone = ctx.createBiquadFilter(), level = ctx.createGain(), place = ctx.createStereoPanner();
      source.buffer = graph[kind]; source.loop = true; source.playbackRate.value = source.buffer.numberOfChannels > 1 ? 1 : .9 + Math.random() * .2;
      tone.type = type; tone.frequency.value = frequency; tone.Q.value = q;
      level.gain.value = 0;
      source.connect(tone).connect(level).connect(place).connect(bus);
      place.connect(graph.gain(.2, graph.send));
      source.start(0, Math.random() * 2);
      return { tone, level, place };
    };
    return {
      wind: layer('brown', 'bandpass', 380, .5), whistle: layer('white', 'bandpass', 1700, 3), fall: layer('falls', 'lowpass', 2400, .5),
      // Rain is the plain hiss of it, and under a heavy fall a softer body of sound.
      fire: layer('brown', 'lowpass', 340, .5), rain: layer('white', 'highpass', 1800, .4), pour: layer('pink', 'bandpass', 900, .6), cave: layer('brown', 'lowpass', 120, .7), thin: layer('white', 'highpass', 6500, .5)
    };
  }
  let crackle = 0, ground = 1;
  // Where the lens is and what is near it; called a few times a second. Everything eases to its new level. ground:
  // how much of the ground's own sound (water, fire, weather) reaches the lens, 1 low down and 0 above Camp III.
  function listener(state) {
    if (!graph || hushed) return;
    ground = clamp(state.ground ?? 1);
    const now = ctx.currentTime, air = graph.air, outside = state.inside ? 0 : 1;
    const set = (layer, level, pan = 0) => { layer.level.gain.setTargetAtTime(level, now, .35); layer.place.pan.setTargetAtTime(clamp(pan, -1, 1), now, .2); };
    const toward = at => { const d = [at[0] - state.eye[0], at[1] - state.eye[1], at[2] - state.eye[2]], l = Math.hypot(...d) || 1; return { distance: l, pan: (d[0] * state.right[0] + d[1] * state.right[1] + d[2] * state.right[2]) / l }; };
    // Wind: more of it higher up and while the lens is moving, in slow gusts; almost none in the thin air above.
    const gust = .65 + .35 * Math.sin(now * .23) * Math.sin(now * .071 + 1.3), high = smooth(1, 11, state.height), aloft = state.sky || 0;
    set(air.wind, outside * (.035 + .075 * high + .08 * (state.moving || 0)) * gust * (1 - .7 * aloft), Math.sin(now * .13) * .4);
    air.wind.tone.frequency.setTargetAtTime(300 + 380 * high + 500 * (state.moving || 0), now, .5);
    set(air.whistle, outside * (.004 + .016 * high) * gust * gust * (1 - .5 * aloft), Math.sin(now * .17 + 2) * .6);
    air.whistle.tone.frequency.setTargetAtTime(1300 + 900 * gust, now, 1.2);
    // The waterfall and the fire, by distance and bearing.
    const fall = state.fall ? toward(state.fall) : null, fire = state.fire ? toward(state.fire) : null;
    set(air.fall, fall ? outside * ground * .12 / (1 + (fall.distance / 5.5) ** 2) : 0, fall ? fall.pan : 0);
    const warmth = fire ? outside * ground / (1 + (fire.distance / 6) ** 2) : 0;
    set(air.fire, warmth > .08 ? warmth * .12 : 0, fire ? fire.pan : 0);
    if (warmth > .12 && now > crackle) {
      crackle = now + .05 + Math.random() * .5 / warmth * .25;
      rush(now + Math.random() * .05, .012 + Math.random() * .03, warmth * (.03 + Math.random() * .09), { type: 'highpass', from: 1500 + Math.random() * 3000, pan: fire.pan, wet: .1, bus: graph.air.fire.place });
    }
    // Rain in the valley (a storm's too), heard from the lower slopes.
    const raining = state.weather === 'rain' || state.weather === 'storm' ? outside * ground : 0, hard = state.intensity || 0;
    set(air.rain, raining * (.02 + .07 * hard));
    set(air.pour, raining * .2 * smooth(.4, 1, hard));
    set(air.cave, state.inside ? .075 : 0);
    set(air.thin, outside * aloft * .012);
    // The room: the hall outdoors, the cavern inside the mountain.
    graph.hallBack.gain.setTargetAtTime(state.inside ? .1 : .5, now, .4);
    graph.cavernBack.gain.setTargetAtTime(state.inside ? .62 : aloft * .25, now, .4);
  }

  // ---- Music: three kinds, each a set of rules over the stop's harmony -------------------------------------------
  // Hearth: a felted piano over a held chord, in slow eighths: a bass note, a broken chord, now and then a few notes
  // of tune on top. The most song-like of the three.
  // Thin air: no pulse at all. Five long breaths, each coming round at its own interval, so the chord they make is
  // never the same twice; a bell, rarely.
  // Lanterns: a music box. Two small figures of five and seven notes turn against a bar of eight, so they keep
  // sliding past each other; a soft low note under them.
  const SCORES = {
    hearth: {
      pace: 60 / 63 / 2,
      step(t, i, h) {
        const bar = Math.floor(i / 8), beat = i % 8, sparse = h.energy < .45, c = h.round[bar % h.round.length], lift = h.lift;
        heard = c;
        if (beat === 0) {
          if (bar % 4 === 0) this.shape = pickOne([[0, 1, 2, 3, 2, 1, 2, 4], [0, 2, 1, 3, 4, 3, 2, 1], [1, 2, 3, 2, 4, 2, 3, 1], [0, 1, 3, 2, 4, 3, 1, 2]]);
          this.tune = dice() < .25 + h.energy * .45 ? pickOne([[1, 4, 6], [0, 3, 6], [2, 5, 7], [0, 5]]) : [];
          I.felt(t, c.bass, .52, { long: 1.5, wet: .3 });
          for (const [k, tone] of c.tones.slice(0, 3).entries()) I.pad(t, tone + lift, this.pace * 8, .045 + h.energy * .03, { pan: (k - 1) * .35, bright: 620 + h.energy * 600 });
        }
        if (sparse && beat % 2) return;
        const late = (dice() - .5) * .016;
        if (beat > 0 && dice() < .5 + h.energy * .5) I.felt(t + late, c.tones[this.shape[beat]] + lift, .26 + dice() * .14 + (beat === 4 ? .08 : 0), { pan: (this.shape[beat] - 2) * .16 });
        if (this.tune.includes(beat)) {
          // The tune moves by step among the chord's upper tones, an octave up.
          this.at = clamp((this.at ?? 3) + pickOne([-1, -1, 0, 1, 1]), 2, 4);
          I.felt(t + late + .01, c.tones[this.at] + 12 + lift, .5 + dice() * .12, { long: 1.6, wet: .5, pan: .12 });
        }
      }
    },
    'thin-air': {
      pace: 1,
      step(t, i, h) {
        this.due ||= [.2, 2.5, 5.5, 9, 13];
        const spans = [19.7, 23.3, 27.1, 31.9, 37.3], c = h.round[Math.floor(i / 44) % h.round.length], lift = h.lift;
        heard = c;
        for (const [voice, span] of spans.entries()) {
          if (i < this.due[voice]) continue;
          this.due[voice] += span * (h.energy < .4 ? 1.25 : 1);
          const tone = c.tones[(voice * 2 + Math.floor(i / span)) % c.tones.length] + lift + (voice === 4 ? 12 : 0);
          I.breath(t, tone, 5 + dice() * 4, .075 + dice() * .035, { pan: (voice - 2) * .34, attack: i < 6 ? 2 : 4 });
        }
        if (i % 29 === 2) I.breath(t, c.bass + 12, 9, .12, { attack: 5, release: 7, wet: .4 });
        if (i % 13 === 7 && dice() < .45 + h.energy * .4) I.glass(t + dice() * .5, c.tones[3 + Math.floor(dice() * 2)] + 12 + lift, .3 + dice() * .15, { long: 1.8, wet: .8, echo: .35, pan: dice() - .5 });
      }
    },
    lanterns: {
      pace: 60 / 88 / 2,
      step(t, i, h) {
        const slow = h.energy < .45, bar = Math.floor(i / 8), beat = i % 8, c = h.round[(slow ? Math.floor(bar / 2) : bar) % h.round.length], lift = h.lift;
        heard = c;
        if (slow && i % 2) return;
        const n = slow ? i / 2 : i, five = [0, 2, 1, 3, 2][n % 5], seven = [4, 3, -1, 2, 4, -1, 1][n % 7];
        if (h.lift <= 0 || dice() < .55) I.pluck(t, c.tones[five] + lift + (lift < 0 ? 12 : 0), .42 + dice() * .12 + (beat === 0 ? .1 : 0), { pan: -.3, wet: slow ? .55 : .28, echo: slow ? .3 : .12, long: slow ? 1.6 : 1 });
        if (seven >= 0 && dice() < .35 + h.energy * .65) I.pluck(t + .006, c.tones[seven] + 12 + lift, .24 + dice() * .1, { pan: .38, wet: .4, echo: .25 });
        if (beat === 0) I.deep(t, c.bass + 12, .5, { long: slow ? 2 : 1.2 });
        if (beat === 5 && h.energy > .6) I.deep(t, c.bass + 19, .26);
        // A grain of sand on the off-beats where the climb is busiest.
        if (h.energy > .66 && beat % 2) rush(t, .03, .012 + (beat === 3 ? .008 : 0), { type: 'highpass', from: 7000, pan: .2, wet: .05, bus: graph.music });
      }
    }
  };
  let score = null, stepAt = 0, stepIndex = 0;
  function startMusic(when) {
    score = Object.create(SCORES[theme]);
    stepAt = when; stepIndex = 0;
  }
  // The notes still ringing belong to where the music was. When the key itself changes (the Heart is in the minor)
  // or the kind of music does, they are faded out on their own bus and what follows starts on a fresh one, so a held
  // F sharp never meets an F. Leaving for the moon (sweep 1) the old music is muffled as it goes, as if the air were
  // closing over it, and the new comes in muffled and opens out over the flight; coming home (sweep -1) the same,
  // the other way round, but quicker to open.
  function turnPage(seconds = 1.2, sweep = 0) {
    const now = ctx.currentTime, old = graph.music, filter = old.tone.frequency;
    old.gain.cancelScheduledValues(now);
    old.gain.setTargetAtTime(0, now + (sweep ? seconds * .3 : 0), seconds / 3);
    if (sweep) { filter.cancelScheduledValues(now); filter.setValueAtTime(filter.value, now); filter.exponentialRampToValueAtTime(sweep > 0 ? 240 : 700, now + seconds); }
    setTimeout(() => old.disconnect(), (seconds + 1) * 1000 * 3);
    graph.music = musicBus(0, sweep ? 380 : 20000);
    graph.music.gain.setTargetAtTime(.62, now + seconds * (sweep ? .25 : .5), seconds / 2);
    if (sweep) { const open = graph.music.tone.frequency; open.setValueAtTime(380, now); open.exponentialRampToValueAtTime(20000, now + seconds * (sweep > 0 ? 1.5 : 1)); }
  }
  // Out at the moon, under whichever music is playing: a slow arpeggio on the synthesizer, in sixteenths, through the
  // chord the music is on, which comes in over the flight and grows for a while after; now and then a high glint, and
  // a sub under each new chord.
  let heard = null, lastHeard = null, arpAt = 0, arpIndex = 0;
  const ARP = [0, -1, 2, 4, -1, 3, 1, -1, 4, -1, 2, 3, -1, 4, 1, -1];
  function orbitLayer(until) {
    if (!orbit || !heard) return;
    const pace = 60 / 76 / 4;
    if (!context && arpAt < ctx.currentTime - 1) arpAt = ctx.currentTime + .05;
    while (arpAt < until) {
      const k = arpIndex++, bar = Math.floor(k / 16), beat = k % 16, t = arpAt, c = heard;
      const grown = smooth(0, 14, t - orbitSince), resting = bar % 4 === 3;
      if (c !== lastHeard) { lastHeard = c; sub(t, c.bass + 12, .55, { long: 2.4 }); }
      const tone = ARP[beat];
      if (tone >= 0 && grown > .02 && (!resting || beat % 4 === 0)) {
        const shimmer = .5 + .5 * Math.sin(t * .09);
        zap(t, c.tones[tone] + 12 + (bar % 2 && beat > 7 ? 12 : 0), (.2 + (beat % 4 === 0 ? .08 : 0)) * grown, { pan: beat % 2 ? .45 : -.45, wet: .5, echo: .38, long: .8, bright: .5 + shimmer * .9 });
      }
      if (beat === 8 && dice() < .22 * grown) glass(t, c.tones[3 + Math.floor(dice() * 2)] + 24, .16, { pan: dice() * 1.4 - .7, wet: .9, echo: .5, long: 1.4 });
      arpAt += pace;
    }
  }
  // Writes the music a little ahead of the clock; called on a timer, or by a test with a time to reach.
  function advance(until) {
    if (!graph || !score) return;
    until ??= ctx.currentTime + .28;
    if (!context && stepAt < ctx.currentTime - 1) stepAt = ctx.currentTime + .05;   // woken after a long sleep: pick up from now
    const harmony = harmonyOf(scene);
    while (stepAt < until) {
      score.step(stepAt, stepIndex++, harmony);
      // The time breathes a little, bar by bar.
      stepAt += score.pace * (1 + .025 * Math.sin(stepIndex * .19));
    }
    orbitLayer(until);
  }

  // ---- Sounds: one for each thing the page does --------------------------------------------------------------------
  const arpeggio = (t, notes, gap, play) => notes.forEach((name, k) => play(t + k * gap, note(name), k));
  const SOUNDS = {
    // The page's own controls.
    hover: t => blip(t, 1900, 1650, .03, .02, { wet: .05 }),
    tap: t => { blip(t, 520, 320, .07, .085); rush(t, .012, .03, { type: 'highpass', from: 3000 }); },
    on: t => arpeggio(t, ['D5', 'A5'], .13, (at, midi) => glass(at, midi, .5, { bus: graph.sounds, wet: .5 })),
    theme: t => {
      if (theme === 'hearth') arpeggio(t, ['D4', 'F#4', 'A4'], .11, (at, midi) => felt(at, midi, .6, { bus: graph.sounds }));
      else if (theme === 'thin-air') breath(t, note('A4'), 1.2, .12, { attack: .5, release: 1.2, bus: graph.sounds });
      else arpeggio(t, ['A4', 'D5', 'F#5'], .1, (at, midi) => pluck(at, midi, .6, { bus: graph.sounds, echo: .2 }));
    },
    // The end of the way, either end: a dull knock.
    edge: t => { blip(t, 150, 92, .16, .13, { wet: .1 }); rush(t, .07, .05, { kind: 'brown', type: 'lowpass', from: 300 }); },
    // A chapter off the trail, called: a question in two notes, up for the sky, down for the rock.
    nudge: (t, { up }) => up
      ? arpeggio(t, ['A4', 'E5', 'B5'], .14, (at, midi) => glass(at, midi, .5, { bus: graph.sounds, wet: .7, echo: .3, long: 1.4 }))
      : arpeggio(t, ['A3', 'F3', 'D3'], .17, (at, midi) => felt(at, midi, .36, { bus: graph.sounds, wet: .7, long: 1.6 })),
    // The summit's light coming on as the loading line arrives.
    light: t => arpeggio(t, ['D5', 'A5'], .22, (at, midi) => glass(at, midi, .34, { bus: graph.sounds, wet: .7, long: 1.5 })),
    // Leaving a stop: air rushing past, rising when the way goes up and falling when it goes down. Into the Heart it
    // is rock closing overhead; Moonward, the air thinning to nothing.
    depart(t, { from, to, up, duration }) {
      if (to === 'heart') {
        rush(t, duration * .5, .1, { from: 900, to: 260, q: .8, attack: duration * .22, hold: true });
        rush(t + duration * .3, duration * .5, .4, { kind: 'brown', type: 'lowpass', from: 420, to: 70, attack: duration * .14, hold: true, wet: .5 });
        blip(t + duration * .42, 96, 34, 1.5, .26, { attack: .05, wet: .4 });
      } else if (from === 'heart') {
        rush(t, duration * .5, .4, { kind: 'brown', type: 'lowpass', from: 80, to: 380, attack: duration * .2, hold: true, wet: .5 });
        rush(t + duration * .45, duration * .5, .09, { from: 300, to: 1100, q: .8, attack: duration * .2, hold: true });
      } else if (to === 'moonward') {
        // Air over the ridge, gathering, then thinning to nothing as the lens climbs; a low swell lifts it off, and the
        // synthesizer the music is about to change to answers in a rising figure.
        rush(t, duration * .7, .06, { from: 380, to: 1400, q: 1.1, attack: duration * .35, hold: true, pan: -.25, panTo: .25 });
        rush(t + duration * .3, duration * .6, .06, { from: 1400, to: 6000, q: 1.8, attack: duration * .25, hold: true, wet: .5 });
        blip(t + duration * .2, 48, 96, duration * .45, .1, { attack: duration * .25, wet: .5 });
        arpeggio(t + duration * .34, ['A4', 'E5', 'G#5', 'B5', 'E6', 'F#6'], duration * .07, (at, midi, k) => zap(at, midi, .34 + k * .03, { bus: graph.sounds, wet: .7, echo: .4, pan: (k % 2 ? .45 : -.45), long: 1.2 }));
      } else if (from === 'moonward') {
        rush(t, duration * .8, .06, { from: 6000, to: 700, q: 1.5, attack: duration * .3, hold: true, wet: .5 });
        arpeggio(t + duration * .08, ['F#6', 'E6', 'B5', 'G#5', 'E5', 'A4'], duration * .06, (at, midi, k) => zap(at, midi, .3, { bus: graph.sounds, wet: .7, echo: .35, pan: (k % 2 ? .45 : -.45), long: 1.2 }));
        rush(t + duration * .55, duration * .45, .14, { from: 1300, to: 380, q: 1.1, attack: duration * .2, hold: true, pan: .25, panTo: -.25 });
      } else {
        rush(t, duration, .24, { from: up ? 320 : 1300, to: up ? 1500 : 300, q: 1.1, attack: duration * .38, hold: true, pan: up ? -.3 : .3, panTo: up ? .3 : -.3 });
        blip(t, up ? 150 : 260, up ? 300 : 120, duration * .8, .05, { attack: duration * .3, wet: .4 });
      }
    },
    // Reaching a stop: each has its own small signature, over the same soft landing.
    arrive(t, { stop, model }) {
      if (stop === 'idle') return;
      blip(t, 105, 68, .22, .075, { wet: .2 });
      const signature = {
        // The fire catches.
        trailhead: () => { for (let k = 0; k < 7; k++) rush(t + .05 + Math.random() * .55, .012 + Math.random() * .03, .04 + Math.random() * .07, { type: 'highpass', from: 1600 + Math.random() * 3000, pan: -.2 + Math.random() * .3 }); arpeggio(t + .1, ['D3', 'A3'], .16, (at, midi) => felt(at, midi, .42, { bus: graph.sounds })); },
        // A shutter: mirror up, curtain, mirror down, the film wound on.
        photography: () => { rush(t + .05, .016, .36, { from: 3400, q: 1.4, wet: .08 }); rush(t + .135, .022, .27, { from: 1900, q: 1.2, wet: .08 }); blip(t + .14, 96, 58, .05, .12, { wet: .08 }); rush(t + .24, .16, .028, { from: 950, to: 1250, q: 7, attack: .02 }); },
        // The points gathering into the mark: a rising scatter of glass.
        phantom: () => { const scale = ['B4', 'D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6']; for (let k = 0; k < 14; k++) glass(t + .1 + k * .075 + Math.random() * .04, note(scale[Math.min(scale.length - 1, Math.floor(k / 2 + Math.random() * 2))]), .14 + Math.random() * .12, { bus: graph.sounds, pan: Math.random() * 1.6 - .8, wet: .7, echo: .25 }); },
        // A letterbox flap, and a bicycle bell somewhere.
        mailboxes: () => { rush(t + .04, .02, .14, { from: 1200, q: 1 }); blip(t + .05, 320, 210, .04, .07); glass(t + .2, note('A5'), .5, { bus: graph.sounds, wet: .4 }); glass(t + .31, note('E6'), .32, { bus: graph.sounds, wet: .4 }); },
        // A singing bowl, two close pitches beating, and the flag snapping in the wind.
        summit: () => { for (const [f, level] of [[293.66, .13], [295.3, .1], [587.9, .05], [881.5, .025]]) blip(t + .06, f, f, 3.2, level, { attack: .03, wet: .7 }); for (let k = 0; k < 3; k++) rush(t + .3 + k * .17 + Math.random() * .05, .09, .05, { from: 520, q: .7, pan: .3 }); },
        // The chamber answering: a minor chord struck on glass, left to ring.
        below: () => arpeggio(t + .25, ['D4', 'A4', 'E5', 'F5', 'A5'], .13, (at, midi, k) => glass(at, midi, .44 - k * .04, { bus: graph.sounds, wet: .9, long: 2, pan: (k - 2) * .25 })),
        // Three high notes with a long way between them.
        above: () => arpeggio(t + .2, ['E5', 'B5', 'F#6'], .3, (at, midi, k) => glass(at, midi, .36 - k * .05, { bus: graph.sounds, wet: .9, echo: .45, long: 2 }))
      }[model];
      signature?.();
    },
    // Entering a camp's page: the sound of the thing that closes over the window (veil.js).
    veil(t, { effect }) {
      const closing = {
        // A diaphragm's blades stopping down, then shut.
        iris: () => { for (let k = 0; k < 7; k++) rush(t + .04 + .46 * (1 - (1 - k / 7) ** 1.6), .008, .09, { from: 4200 - k * 250, q: 2, wet: .05 }); blip(t + .58, 130, 66, .09, .2, { wet: .1 }); },
        // A tent's zip, drawn shut.
        tent: () => { const env = rush(t, .62, .11, { from: 900, to: 3600, q: 3.5, attack: .05, hold: true, wet: .08 }); const teeth = ctx.createOscillator(), depth = graph.gain(.08, env.gain); teeth.type = 'square'; teeth.frequency.setValueAtTime(38, t); teeth.frequency.linearRampToValueAtTime(74, t + .6); teeth.connect(depth); teeth.start(t); teeth.stop(t + .75); blip(t + .66, 170, 90, .08, .12); },
        // Points of light swelling and going dark.
        points: () => { const scale = ['E6', 'D6', 'B5', 'A5', 'F#5', 'E5', 'D5', 'B4']; for (let k = 0; k < 16; k++) glass(t + k * .042 + Math.random() * .02, note(scale[Math.floor(k / 2)]), .2, { bus: graph.sounds, pan: Math.random() * 1.6 - .8, wet: .6 }); },
        // A letter folded, three folds, and the seal pressed.
        envelope: () => { for (const [at, pan] of [[0, -.5], [.26, .5], [.5, 0]]) rush(t + at, .2, .075, { from: 2600, to: 1400, q: .7, attack: .04, pan }); blip(t + .8, 190, 86, .12, .24, { wet: .2 }); },
        // Stone drawing shut over crystal.
        geode: () => { rush(t, .8, .32, { kind: 'brown', type: 'lowpass', from: 380, to: 110, attack: .1, hold: true, wet: .4 }); arpeggio(t + .08, ['A6', 'F6', 'D6', 'A5', 'F5'], .12, (at, midi) => pluck(at, midi, .34, { bus: graph.sounds, wet: .7 })); },
        // The moon's disc sliding over the light.
        eclipse: () => { blip(t, 330, 110, .9, .1, { attack: .3, wet: .6 }); rush(t, .9, .05, { from: 4000, to: 500, q: 1, attack: .3, hold: true, wet: .5 }); }
      }[effect];
      closing?.();
    },
    // The heart: two strokes, felt more than heard.
    heartbeat(t, { strength = 1 }) { blip(t, 64, 42, .2, .34 * strength, { wet: .3, attack: .012 }); blip(t + .34, 58, 40, .17, .22 * strength, { wet: .3, attack: .012 }); },
    // A drop into the pool: the plink, and the small note the hollow of water sings after it.
    drip(t, { pan = 0, strength = 1 }) { blip(t, 1700 + Math.random() * 500, 700, .04, .1 * strength, { pan, wet: .8, attack: .002 }); blip(t + .028, 480 + Math.random() * 160, 930, .05, .07 * strength, { pan, wet: .8 }); },
    // The Phantom's points, brushed aside.
    glint: (t, { pan = 0 }) => glass(t, note(pickOne(['B6', 'D7', 'E7', 'F#7'])), .16 + Math.random() * .08, { bus: graph.sounds, pan, wet: .6 }),
    // A shooting star: a breath of high air crossing the sky.
    meteor: (t, { pan = 0, duration = 1 }) => rush(t, duration, .08, { from: 5200, to: 1600, q: 2.5, attack: duration * .2, hold: true, pan, panTo: -pan, wet: .6 }),
    // Thunder, after the flash by as long as the sound takes to come: near, a tearing crack and then the roll; far off,
    // only a low grumble in a few long swells. near: 1 overhead, 0 at the far end of the valley.
    thunder(start, { near = .5, pan = 0, delay = 0 }) {
      const bus = graph.airBus, heard = ground, t = start + delay;
      if (heard < .02) return;
      if (near > .6) {
        const crack = (near - .6) / .4;
        rush(t, .06, .3 * crack * heard, { type: 'highpass', from: 2200, pan, wet: .25, bus });
        rush(t + .015, .5, .26 * crack * heard, { type: 'bandpass', from: 2400, to: 380, q: .7, pan, wet: .5, bus });
      }
      const cut = 150 + 520 * near, swells = 3 + Math.floor(Math.random() * 3);
      let at = t + .04 + (1 - near) * .25;
      for (let k = 0; k < swells; k++) {
        const span = .7 + Math.random() * 1.5;
        rush(at, span, (.32 + .35 * near) * (1 - k / (swells + 1.5)) * (.65 + .35 * Math.random()) * heard, { kind: 'brown', type: 'lowpass', from: cut * (1.25 - k * .12), to: cut * .45, q: .7, attack: .06 + Math.random() * .3, hold: true, wet: .55, pan: pan * (1 - k * .2), bus });
        at += span * (.3 + Math.random() * .45);
      }
      rush(t + .3, 5 + 3 * (1 - near), .22 * heard, { kind: 'brown', type: 'lowpass', from: 110, to: 45, attack: .9, hold: true, wet: .7, pan: pan * .5, bus });
    }
  };
  const quiet = { hover: .07, glint: .12, tap: .05 };
  const lastPlayed = {};
  function play(name, options = {}) {
    if (!graph || !enabled || hushed || ctx.state !== 'running' && !context) return;
    const now = ctx.currentTime;
    if (quiet[name] && now - (lastPlayed[name] ?? -1) < quiet[name]) return;
    lastPlayed[name] = now;
    SOUNDS[name]?.(now + .012, options);
  }

  // ---- On, off, and the browser's rule about the first touch ----------------------------------------------------
  function level(to, seconds = .6) {
    if (!graph) return;
    const now = ctx.currentTime;
    graph.master.gain.cancelScheduledValues(now);
    graph.master.gain.setTargetAtTime(to, now, seconds / 3);
    graph.level = to;
  }
  function run() {
    if (!graph) build();
    if (!score) startMusic(ctx.currentTime + .15);
    level(loudness(), 1.2);
    if (context) return;
    clearInterval(timer);
    timer = setInterval(() => { if (ctx.state === 'running' && !hushed) advance(); }, 60);
    advance();
  }
  // A remembered "on", or one given before any touch: start at the first touch or key.
  const unlock = () => {
    if (!enabled) return;
    if (!graph) run();
    if (ctx.state !== 'running') ctx.resume().then(() => { if (enabled && !hushed) run(); }).catch(() => {});
  };
  if (supported && !context) for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, unlock, { passive: true, capture: true });

  return {
    supported, themes: THEMES,
    get enabled() { return enabled; },
    get theme() { return theme; },
    get volume() { return volume; },
    get running() { return Boolean(graph) && (Boolean(context) || ctx.state === 'running'); },
    // Call from a click or a key: the browser starts sound only then.
    setEnabled(on) {
      if (!supported) return;
      enabled = Boolean(on);
      if (!context) write('g3-sound', enabled ? 'on' : 'off');
      if (enabled) {
        run();
        if (!context) ctx.resume().then(() => play('on')).catch(() => {});
      } else if (graph) { level(0, .4); clearInterval(timer); score = null; }
    },
    setTheme(next) {
      if (!THEMES.includes(next) || next === theme) return;
      theme = next;
      if (!context) write('g3-theme', theme);
      if (graph && enabled) { turnPage(); startMusic(ctx.currentTime + .9); play('theme'); }
    },
    // 0 to 1; remembered.
    setVolume(next) {
      volume = clamp(Number(next) || 0);
      if (!context) write('g3-volume', volume.toFixed(2));
      if (graph && enabled && !hushed) level(loudness(), .12);
    },
    // What stop the page is at or heading for: { stop: 'idle' | 'camp' | 'heart' | 'moonward', camp, camps, time, travelling }.
    // Heading for the moon the music changes to its synthesizers over the flight; heading home, back again.
    scene(next) {
      const minor = scene.stop === 'heart', wasOrbit = orbit;
      scene = { ...scene, ...next };
      orbit = scene.stop === 'moonward';
      if (orbit && !wasOrbit) { orbitSince = graph ? Math.max(ctx.currentTime, stepAt - .3) : 0; arpAt = orbitSince + .5; arpIndex = 0; lastHeard = null; }
      if (!graph || !score) return;
      if (orbit !== wasOrbit) turnPage(orbit ? 4.2 : 2.6, orbit ? 1 : -1);
      else if (minor !== (scene.stop === 'heart')) turnPage(2.4);
    },
    listener,
    play,
    // Quiet while the page is hidden or covered by a transition; back when it returns.
    hush(on) {
      if (hushed === Boolean(on)) return;
      hushed = Boolean(on);
      if (!graph || !enabled) return;
      if (hushed) level(0, .35); else { level(loudness(), .8); advance(); }
    },
    advance
  };
}
