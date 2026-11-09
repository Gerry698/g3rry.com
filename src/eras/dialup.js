// The dial-up screen. Picks a modem speed for the 1996 and 1999 copies of the site, plays a handshake
// synthesised from the tones a modem actually sends (dial tone, touch-tone digits, ringback, the 2100 Hz answer
// tone with its phase reversals, V.21 FSK bursts, line probing and training noise), then opens the year.
// Another number can be dialled instead; what answers is up to the telephone network (the hunt Worker).
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var to = /^(1996|1999)$/.test(params.get('to') || '') ? params.get('to') : '1996';
  var usual = { 1996: 28800, 1999: 48000 };
  var menu = document.getElementById('modem-speed');
  var speaker = document.getElementById('dialer-speaker');
  var status = document.getElementById('dialer-status');
  var meter = document.getElementById('dialer-meter');
  var connect = document.getElementById('dialer-connect');
  var other = document.getElementById('dialer-number');
  var saved = '18007867473'; // the access number stored with this connection
  var dialing = false;

  window.Modem.get().then(function (bps) {
    menu.value = String(bps === null ? usual[to] : bps);
    menu.disabled = false;
  });
  document.title = 'Connect to g3rry.com (' + to + ')';

  function say(text, progress) {
    status.textContent = text;
    if (typeof progress === 'number') meter.style.width = Math.round(progress * 100) + '%';
  }

  var DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
    7: [852, 1209], 8: [852, 1336], 9: [852, 1477], '*': [941, 1209], 0: [941, 1336], '#': [941, 1477] };

  // The line: everything a call sounds like, scheduled on one AudioContext. Returns helpers that place sounds.
  function line(ctx, t0) {
    var out = ctx.createGain();
    out.gain.value = 0.18;
    var band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 1400; band.Q.value = 0.5; // a telephone line passes 300 to 3400 Hz
    out.connect(band).connect(ctx.destination);
    function tone(freqs, start, length, level) {
      freqs.forEach(function (f) {
        var osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0, t0 + start);
        gain.gain.linearRampToValueAtTime(level || 0.5, t0 + start + 0.01);
        gain.gain.setValueAtTime(level || 0.5, t0 + start + length - 0.01);
        gain.gain.linearRampToValueAtTime(0, t0 + start + length);
        osc.connect(gain).connect(out);
        osc.start(t0 + start); osc.stop(t0 + start + length + 0.02);
      });
    }
    // Frequency-shift keying: random bits at 300 baud between two tones (V.21).
    function fsk(mark, space, start, length) {
      var osc = ctx.createOscillator(), gain = ctx.createGain(), bit = 1 / 300;
      for (var t = 0; t < length; t += bit) osc.frequency.setValueAtTime(Math.random() < 0.5 ? mark : space, t0 + start + t);
      gain.gain.setValueAtTime(0.35, t0 + start); gain.gain.setValueAtTime(0, t0 + start + length);
      osc.connect(gain).connect(out); osc.start(t0 + start); osc.stop(t0 + start + length + 0.02);
    }
    function noise(start, length, level, from, upTo) {
      var buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate), data = buffer.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      src.buffer = buffer; filter.type = 'bandpass'; filter.frequency.setValueAtTime(from, t0 + start); filter.frequency.linearRampToValueAtTime(upTo, t0 + start + length); filter.Q.value = 0.8;
      gain.gain.setValueAtTime(level, t0 + start); gain.gain.setValueAtTime(0, t0 + start + length);
      src.connect(filter).connect(gain).connect(out); src.start(t0 + start);
    }
    return { tone: tone, fsk: fsk, noise: noise };
  }

  // Dial tone and the digits: returns when dialling ends (seconds from the start).
  function dial(sound, number) {
    if (sound) sound.tone([350, 440], 0, 1.1, 0.3);
    for (var d = 0; d < number.length; d++) if (sound) sound.tone(DTMF[number.charAt(d)], 1.2 + d * 0.11, 0.07, 0.4);
    return 1.2 + number.length * 0.11 + 0.2;
  }
  // Ringback, then the answering modem's tones; returns the length of the whole handshake from `at`.
  function answer(sound, at) {
    if (!sound) return 7.6;
    sound.tone([440, 480], at, 1.6, 0.3); // ringback
    // Answer tone: 2100 Hz with a phase reversal every 450 ms, which tells echo cancellers to switch off.
    // 2100 Hz × 0.45 s is a whole number of cycles, so a negative gain on every other segment is the reversal.
    for (var r = 0; r < 4; r++) sound.tone([2100], at + 1.8 + r * 0.45, 0.45, r % 2 ? -0.35 : 0.35);
    sound.fsk(1180, 980, at + 3.6, 0.35); sound.fsk(1850, 1650, at + 4, 0.35); // V.8 call menu and joint menu
    var probe = [150, 450, 750, 1050, 1350, 1650, 1950, 2250, 2550, 2850, 3150, 3450];
    sound.tone(probe, at + 4.45, 0.25, 0.06); sound.tone(probe, at + 4.8, 0.25, 0.06); // line probing
    sound.tone([1200], at + 5.15, 0.3, 0.25);
    sound.noise(at + 5.5, 0.7, 0.6, 1800, 1800); // equaliser training
    sound.noise(at + 6.3, 1.4, 0.45, 1200, 2400);
    return 7.8;
  }
  // What a failed call sounds like.
  function failure(sound, at, outcome) {
    if (!sound) return 3;
    if (outcome === 'busy') { for (var b = 0; b < 6; b++) sound.tone([480, 620], at + b, 0.5, 0.3); return 6; }
    if (outcome === 'not-in-service') { sound.tone([913.8], at, 0.274, 0.3); sound.tone([1370.6], at + 0.274, 0.274, 0.3); sound.tone([1776.7], at + 0.548, 0.38, 0.3); return 1.5; }
    var rings = outcome === 'no-answer' ? 6 : 2;
    for (var r = 0; r < rings; r++) sound.tone([440, 480], at + r * 6, 2, 0.3);
    return outcome === 'no-answer' ? 6 * 6 : 12;
  }

  function audio() {
    if (!speaker.checked || !(window.AudioContext || window.webkitAudioContext)) return null;
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var sound = line(ctx, ctx.currentTime + 0.05);
    sound.close = function (after) { setTimeout(function () { ctx.close(); }, after * 1000); };
    return sound;
  }

  function finish(bps) {
    say(bps ? 'Connected at ' + bps.toLocaleString('en-US') + ' bps.' : 'Connected.', 1);
    setTimeout(function () { location.href = '/eras/' + to + '/'; }, 700);
  }

  function reset() {
    dialing = false;
    connect.disabled = false;
    menu.disabled = false;
    other.disabled = false;
  }

  connect.addEventListener('click', function () {
    if (dialing) return;
    var typed = other.value.replace(/[^0-9*#]/g, '');
    dialing = true;
    connect.disabled = true;
    menu.disabled = true;
    other.disabled = true;
    var bps = Number(menu.value);
    if (typed) return dialOther(typed, bps);
    var stored = window.Modem.set(bps === usual[to] ? null : bps).then(window.Modem.ready);
    if (!bps) { stored.then(function () { finish(0); }); return; }
    var sound = audio(), dialled = dial(sound, saved), length = dialled + answer(sound, dialled);
    if (sound) sound.close(length + 0.5);
    var steps = [[0, 'Dialing...'], [dialled, 'Ringing...'], [dialled + 1.8, 'Negotiating with the remote modem...'], [dialled + 5.5, 'Verifying user name and password...'], [dialled + 6.8, 'Logging on to network...']];
    steps.forEach(function (step) { setTimeout(function () { say(step[1], step[0] / length); }, step[0] * 1000); });
    setTimeout(function () { stored.then(function () { finish(bps); }); }, length * 1000);
  });

  var messages = {
    busy: 'The line is busy.',
    'no-carrier': 'NO CARRIER',
    'not-in-service': 'The number you have dialed is not in service.',
    'no-answer': 'NO ANSWER'
  };
  function dialOther(number, bps) {
    var sound = audio(), dialled = dial(sound, number);
    say('Dialing ' + number + '...', 0.1);
    var reply = fetch('/api/hunt/dial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: number }) })
      .then(function (response) { return response.ok ? response.json() : { connected: false, outcome: 'no-carrier' }; })
      ['catch'](function () { return { connected: false, outcome: 'no-carrier' }; });
    setTimeout(function () {
      reply.then(function (result) {
        if (result.connected) {
          var length = answer(sound, dialled);
          if (sound) sound.close(dialled + length + 0.5);
          say('Ringing...', 0.3);
          setTimeout(function () { say('Negotiating with the remote modem...', 0.6); }, 1800);
          setTimeout(function () { window.Board.open(result, bps); }, length * 1000);
        } else {
          var wait = failure(sound, dialled, result.outcome);
          if (sound) sound.close(dialled + wait + 0.5);
          say(result.outcome === 'busy' || result.outcome === 'not-in-service' ? messages[result.outcome] : 'Ringing...', 0.3);
          setTimeout(function () { say(messages[result.outcome] || 'NO CARRIER', 0); reset(); }, Math.min(wait, 12) * 1000);
        }
      });
    }, dialled * 1000);
  }
})();
