/* gerry zhao :: intro
   what used to be intro.swf. loading bar, scan, the name assembling from points, the line typing itself,
   then ENTER. SKIP INTRO and SOUND sit under the stage, as they always did. */

var stage = document.getElementById('stage');
var g = stage.getContext ? stage.getContext('2d') : null;
var W = 760, H = 420, ORANGE = '#ff6600';
var soundOn = false, audio = null;
var soundLink = document.getElementById('sound');
var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function go() { location.href = 'home.html'; }

soundLink.onclick = function () {
  soundOn = !soundOn;
  soundLink.firstChild.nodeValue = 'SOUND: ' + (soundOn ? 'ON' : 'OFF');
  if (soundOn && !audio && (window.AudioContext || window.webkitAudioContext)) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (soundOn) bleep(660, 0.08);
  return false;
};
function bleep(freq, length) {
  if (!soundOn || !audio) return;
  var o = audio.createOscillator(), v = audio.createGain(), t = audio.currentTime;
  o.type = 'square'; o.frequency.value = freq;
  v.gain.setValueAtTime(0.05, t); v.gain.setValueAtTime(0.05, t + length * 0.8); v.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(v); v.connect(audio.destination); o.start(t); o.stop(t + length + 0.02);
}
function whoosh() {
  if (!soundOn || !audio) return;
  var n = audio.sampleRate, buffer = audio.createBuffer(1, n, n), d = buffer.getChannelData(0);
  for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  var s = audio.createBufferSource(), f = audio.createBiquadFilter(), v = audio.createGain(), t = audio.currentTime;
  s.buffer = buffer; f.type = 'bandpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 1); v.gain.value = 0.08;
  s.connect(f); f.connect(v); v.connect(audio.destination); s.start(t);
}

function textWidth(text, scale) { return text.length * 6 * scale - scale; }
function drawText(text, x, y, scale, colour, count) {
  g.fillStyle = colour;
  var shown = typeof count == 'number' ? count : text.length;
  for (var n = 0; n < shown; n++) {
    var glyph = PIXELFONT[text.charAt(n)];
    if (!glyph) continue;
    for (var j = 0; j < 7; j++) for (var i = 0; i < 5; i++) if (glyph[j].charAt(i) == '#') g.fillRect(x + (n * 6 + i) * scale, y + j * scale, scale - (scale > 3 ? 1 : 0), scale - (scale > 3 ? 1 : 0));
  }
}
function textPoints(text, scale, x0, y0) {
  var points = [];
  for (var n = 0; n < text.length; n++) {
    var glyph = PIXELFONT[text.charAt(n)];
    if (!glyph) continue;
    for (var j = 0; j < 7; j++) for (var i = 0; i < 5; i++) if (glyph[j].charAt(i) == '#') points.push({ x: x0 + (n * 6 + i) * scale, y: y0 + j * scale });
  }
  return points;
}

// Preload what the site needs, and show it honestly.
var files = (stage.getAttribute('data-preload') || '').split(',');
var loaded = 0, loadStart = new Date().getTime(), sequenceStart = 0;
for (var f = 0; f < files.length; f++) {
  var im = new Image();
  im.onload = im.onerror = function () { loaded++; };
  im.src = files[f];
}

var NAME = 'GERRY ZHAO', SCALE = 9;
var nameX = (W - textWidth(NAME, SCALE)) / 2, nameY = 130;
var particles = textPoints(NAME, SCALE, nameX, nameY);
for (var p = 0; p < particles.length; p++) {
  var a = Math.random() * Math.PI * 2, r = 380 + Math.random() * 200;
  particles[p].sx = W / 2 + Math.cos(a) * r; particles[p].sy = H / 2 + Math.sin(a) * r;
  particles[p].delay = Math.random() * 600;
}
var LINE = 'CHASING LIGHT. KEEPING MOMENTS.', typed = 0, scanned = false, enterShown = false;
// Every key has its own touch: TYPING (in pixelfont.js) holds how long each keystroke sounds and the pause after it,
// in milliseconds. Spaces make no sound. The line starts typing three seconds in, whatever the motion setting.
var TYPE_START = 3000, keyAt = [], keyLength = [], clock = TYPE_START;
for (var c = 0, k = 0; c < LINE.length; c++) {
  keyAt.push(clock);
  if (LINE.charAt(c) == ' ') { keyLength.push(0); continue; }
  var key = TYPING[k++ % TYPING.length];
  keyLength.push(key[0]);
  clock += key[0] + key[1];
}
var ENTER_AT = Math.max(5200, clock + 300);

function frame() {
  var now = new Date().getTime();
  if (!sequenceStart) {
    var progress = files.length ? loaded / files.length : 1;
    var shown = Math.min(progress, (now - loadStart) / 1200);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    drawText('LOADING ' + Math.round(shown * 100) + '%', W / 2 - 50, H / 2 - 20, 2, '#888');
    g.fillStyle = '#333'; g.fillRect(W / 2 - 100, H / 2 + 4, 200, 4);
    g.fillStyle = ORANGE; g.fillRect(W / 2 - 100, H / 2 + 4, 200 * shown, 4);
    if (shown >= 1 || now - loadStart > 8000) sequenceStart = now;
    requestAnimationFrame(frame);
    return;
  }
  var t = reduce ? 99999 : now - sequenceStart;
  // Motion trails: paint black at low opacity instead of clearing.
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, W, H);
  // Scan line and grid.
  if (t < 1300) {
    if (!scanned) { scanned = true; whoosh(); }
    var y = (t / 1300) * H;
    g.fillStyle = ORANGE; g.fillRect(0, y, W, 2);
    g.fillStyle = 'rgba(255,102,0,0.15)'; g.fillRect(0, y - 30, W, 30);
  }
  g.fillStyle = 'rgba(255,255,255,' + Math.min(0.06, t / 20000) + ')';
  for (var gx = 0; gx < W; gx += 40) g.fillRect(gx, 0, 1, H);
  for (var gy = 0; gy < H; gy += 40) g.fillRect(0, gy, W, 1);
  // The name assembles.
  for (var k = 0; k < particles.length; k++) {
    var q = particles[k], u = Math.max(0, Math.min(1, (t - 700 - q.delay) / 1400));
    var e = 1 - Math.pow(1 - u, 3);
    var px = q.sx + (q.x - q.sx) * e, py = q.sy + (q.y - q.sy) * e;
    g.fillStyle = u < 1 ? ORANGE : '#fff';
    g.fillRect(px, py, SCALE - 1, SCALE - 1);
  }
  // The line types itself.
  var typing = now - sequenceStart;
  if (typing > TYPE_START) {
    while (typed < LINE.length && typing >= keyAt[typed]) { if (keyLength[typed]) bleep(880, keyLength[typed] / 1000); typed++; }
    var lineX = (W - textWidth(LINE, 2)) / 2;
    g.fillStyle = '#000'; g.fillRect(lineX - 4, 226, textWidth(LINE, 2) + 20, 20);
    drawText(LINE, lineX, 230, 2, '#ccc', typed);
    if (typed < LINE.length || Math.floor(t / 400) % 2) { g.fillStyle = ORANGE; g.fillRect(lineX + typed * 12, 230, 8, 14); }
  }
  // ENTER.
  if (t > ENTER_AT && typed >= LINE.length) {
    if (!enterShown) { enterShown = true; bleep(440, 0.15); stage.style.cursor = 'pointer'; }
    var glow = 0.55 + 0.45 * Math.sin(t / 260);
    g.fillStyle = '#000'; g.fillRect(W / 2 - 60, 300, 120, 34);
    g.strokeStyle = 'rgba(255,102,0,' + glow + ')'; g.lineWidth = 2; g.strokeRect(W / 2 - 56, 302, 112, 30);
    drawText('ENTER >', W / 2 - textWidth('ENTER >', 2) / 2, 310, 2, 'rgba(255,255,255,' + (0.6 + glow * 0.4) + ')');
  }
  requestAnimationFrame(frame);
}

if (g) {
  stage.onclick = function () { if (enterShown) go(); };
  document.onkeydown = function (event) { if (enterShown && (event || window.event).keyCode == 13) go(); };
  requestAnimationFrame(frame);
}
