// The dial-up screen. Picks a modem speed for the 1996 and 1999 copies of the site, plays a handshake
// synthesised from the tones a modem actually sends (dial tone, touch-tone digits, ringback, the 2100 Hz answer
// tone with its phase reversals, V.21 FSK bursts, line probing and training noise), then opens the year.
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
  var number = '8055550196';
  var dialing = false;

  // Start on the year's usual modem unless one was already chosen.
  window.Modem.get().then(function (bps) {
    menu.value = String(bps === null ? usual[to] : bps);
    menu.disabled = false;
  });
  document.title = 'Connect to g3rry.com (' + to + ')';

  function say(text, progress) {
    status.textContent = text;
    if (typeof progress === 'number') meter.style.width = Math.round(progress * 100) + '%';
  }

  function handshake(ctx, t0) {
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
    function noise(start, length, level, from, to) {
      var buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate), data = buffer.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      src.buffer = buffer; filter.type = 'bandpass'; filter.frequency.setValueAtTime(from, t0 + start); filter.frequency.linearRampToValueAtTime(to, t0 + start + length); filter.Q.value = 0.8;
      gain.gain.setValueAtTime(level, t0 + start); gain.gain.setValueAtTime(0, t0 + start + length);
      src.connect(filter).connect(gain).connect(out); src.start(t0 + start);
    }
    var dtmf = { 0: [941, 1336], 1: [697, 1209], 5: [770, 1336], 6: [770, 1477], 8: [852, 1336], 9: [852, 1477] };
    tone([350, 440], 0, 1.1, 0.3); // dial tone
    for (var d = 0; d < number.length; d++) tone(dtmf[number[d]], 1.2 + d * 0.11, 0.07, 0.4);
    tone([440, 480], 2.6, 1.6, 0.3); // ringback
    // Answer tone: 2100 Hz with a phase reversal every 450 ms, which tells echo cancellers to switch off.
    // 2100 Hz × 0.45 s is a whole number of cycles, so a negative gain on every other segment is the reversal.
    for (var r = 0; r < 4; r++) tone([2100], 4.4 + r * 0.45, 0.45, r % 2 ? -0.35 : 0.35);
    fsk(1180, 980, 6.2, 0.35); fsk(1850, 1650, 6.6, 0.35); // V.8 call menu and joint menu
    tone([150, 450, 750, 1050, 1350, 1650, 1950, 2250, 2550, 2850, 3150, 3450], 7.05, 0.25, 0.06); // line probing
    tone([150, 450, 750, 1050, 1350, 1650, 1950, 2250, 2550, 2850, 3150, 3450], 7.4, 0.25, 0.06);
    tone([1200], 7.75, 0.3, 0.25);
    noise(8.1, 0.7, 0.6, 1800, 1800); // equaliser training
    noise(8.9, 1.4, 0.45, 1200, 2400);
    return 10.4;
  }

  function finish(bps) {
    say(bps ? 'Connected at ' + bps.toLocaleString('en-US') + ' bps.' : 'Connected.', 1);
    setTimeout(function () { location.href = '/eras/' + to + '/'; }, 700);
  }

  connect.addEventListener('click', function () {
    if (dialing) return;
    dialing = true;
    connect.disabled = true;
    menu.disabled = true;
    var bps = Number(menu.value);
    var saved = window.Modem.set(bps === usual[to] ? null : bps).then(window.Modem.ready);
    if (!bps) { saved.then(function () { finish(0); }); return; }
    var length = 10.4;
    if (speaker.checked && (window.AudioContext || window.webkitAudioContext)) {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      length = handshake(ctx, ctx.currentTime + 0.05);
      setTimeout(function () { ctx.close(); }, (length + 0.5) * 1000);
    }
    var steps = [[0, 'Dialing 805-555-0196...'], [2.6, 'Ringing...'], [4.4, 'Negotiating with the remote modem...'], [8.1, 'Verifying user name and password...'], [9.4, 'Logging on to network...']];
    steps.forEach(function (step) { setTimeout(function () { say(step[1], step[0] / length); }, step[0] * 1000); });
    setTimeout(function () { saved.then(function () { finish(bps); }); }, length * 1000);
  });
})();
