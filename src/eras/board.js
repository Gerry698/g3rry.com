// The board that answers one particular number, in a HyperTerminal window of its time, printed at the speed of the
// modem. Its text comes from the hunt Worker, which sends it only to a caller who dialled the right number, and which
// checks the caller's route (the strata this browser has solved) before it offers a flag.
(function () {
  'use strict';
  var COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'white'];
  var CONNECT = { 14400: '14400/ARQ/V32BIS/LAPM/V42BIS', 28800: '28800/ARQ/V34/LAPM/V42BIS', 33600: '33600/ARQ/V34/LAPM/V42BIS', 48000: '48000/ARQ/V90/LAPM/V42BIS', 0: '115200' };
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var board, screen, log, keys, clock, token, speed, started, ticking, result;

  // Prints segments ([text, class]) at the line speed: ten bits to a character, sixty ticks a second. The visible
  // screen is hidden from screen readers; each finished print goes to the log in one piece instead.
  function print(segments, done) {
    if (typeof segments === 'string') segments = [[segments]];
    var all = segments.map(function (s) { return s[0]; }).join('');
    var nodes = segments.map(function (s) {
      var span = document.createElement('span');
      if (s[1]) span.className = s[1];
      screen.appendChild(span);
      return span;
    });
    var perTick = still ? Infinity : Math.max(1, Math.round(speed / 10 / 60)), shown = 0;
    (function tick() {
      shown = Math.min(all.length, shown + perTick);
      var left = shown;
      segments.forEach(function (s, i) { nodes[i].textContent = s[0].slice(0, Math.max(0, left)); left -= s[0].length; });
      screen.scrollTop = screen.scrollHeight;
      if (shown < all.length) return requestAnimationFrame(tick);
      var entry = document.createElement('p');
      entry.textContent = all;
      log.appendChild(entry);
      if (done) done();
    })();
  }
  function choose(options) {
    while (keys.firstChild) keys.removeChild(keys.firstChild);
    options.forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = '[' + option.key + '] ' + option.label;
      button.setAttribute('data-key', option.key.toLowerCase());
      button.addEventListener('click', option.run);
      keys.appendChild(button);
    });
    if (keys.firstChild) keys.firstChild.focus();
  }
  document.addEventListener('keydown', function (event) {
    if (!board || board.hidden || event.ctrlKey || event.metaKey || event.altKey) return;
    var button = keys.querySelector('button[data-key="' + String(event.key).toLowerCase().replace(/[^a-z]/g, '') + '"]');
    if (button) { event.preventDefault(); button.click(); }
  });

  function frame(lines) {
    var width = Math.max.apply(null, lines.map(function (line) { return line.length; })) + 2;
    var pad = function (line) { return line + new Array(width - line.length + 1).join(' '); };
    return '╔' + new Array(width + 1).join('═') + '╗\n'
      + lines.map(function (line) { return '║' + pad(' ' + line) + '║'; }).join('\n')
      + '\n╚' + new Array(width + 1).join('═') + '╝\n';
  }
  function fillIn(lines) {
    var done = result.route.filter(function (s) { return s.ok; }).length;
    return lines.map(function (line) { return line.replace('{solved}', done).replace('{total}', result.route.length).replace('{needed}', result.needed); }).join('\n') + '\n';
  }
  function route() {
    var segments = [['\nCALLER CHECK\n', 'hi']];
    result.route.forEach(function (stratum) {
      var name = stratum.id.toUpperCase();
      segments.push(['  ' + name + ' ' + new Array(Math.max(2, 26 - name.length)).join('.') + ' ']);
      segments.push(stratum.ok ? ['OK', 'ok'] : ['--', 'dim']);
      segments.push(['\n']);
    });
    segments.push(['\n' + fillIn(token ? result.board.admitted : result.board.short)]);
    return segments;
  }

  function hangUp(extra) {
    choose([]);
    print((extra || '') + '\n+++\nATH0\nNO CARRIER\n', function () {
      clearInterval(ticking);
      clock.textContent = 'Disconnected';
      var back = document.createElement('a');
      back.href = '/strata/';
      back.textContent = 'Back to Strata';
      keys.appendChild(back);
      back.focus();
    });
  }
  function goodbye() { hangUp('\nThanks for calling. The summit will be here.\n'); }
  function menu() {
    choose(token ? [{ key: 'F', label: 'Plant a flag on the summit', run: colours }, { key: 'G', label: 'Goodbye', run: goodbye }]
      : [{ key: 'G', label: 'Goodbye', run: goodbye }]);
  }
  function colours() {
    choose([]);
    print('\nWhat colour is your flag?\n', function () {
      choose(COLOURS.map(function (colour) {
        return { key: colour.charAt(0).toUpperCase(), label: colour, run: function () { plant(colour); } };
      }));
    });
  }
  function plant(colour) {
    choose([]);
    print('\nClimbing... ', function () {
      fetch('/api/hunt/flag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, colour: colour }) })
        .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
        .then(function (planted) {
          if (planted.ok) {
            try { localStorage.setItem('strata-flag', JSON.stringify(planted.body)); } catch (e) { /* private window */ }
            var when = new Date(planted.body.date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
            hangUp('\n\nFlag #' + planted.body.number + ' (' + colour + ') planted on the summit, ' + when + '.\nIt flies over the mountain at the top of the Strata page.\n');
          } else {
            var why = { enough_flags_today: 'Your line has planted its flags for today. Call again tomorrow.', already_planted: 'This call has already planted its flag.', token_expired: 'The connection went stale. Dial again.' };
            hangUp('\n\n' + (why[planted.body.error] || 'The summit could not be reached. Dial again later.') + '\n');
          }
        })['catch'](function () { hangUp('\n\nThe line dropped.\n'); });
    });
  }

  function elapsed() {
    var s = Math.floor((Date.now() - started) / 1000);
    return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  window.Board = {
    open: function (reply, bps) {
      result = reply;
      token = reply.token;
      speed = bps || 115200;
      board = document.getElementById('board');
      screen = document.getElementById('board-screen');
      log = document.getElementById('board-log');
      keys = document.getElementById('board-keys');
      clock = document.getElementById('board-clock');
      document.getElementById('board-speed').textContent = (bps ? bps : 115200) + ' 8-N-1';
      document.querySelector('.dialer').hidden = true;
      board.hidden = false;
      document.title = 'SUMMIT - HyperTerminal';
      started = Date.now();
      clock.textContent = 'Connected ' + elapsed();
      ticking = setInterval(function () { clock.textContent = 'Connected ' + elapsed(); }, 1000);
      print([['CONNECT ' + (CONNECT[bps] || CONNECT[0]) + '\n\n', 'hi'], [frame(reply.board.banner), 'logo'], ['\n' + reply.board.lines.join('\n') + '\n']], function () {
        print(route(), menu);
      });
    },
    // Back to the dialog (a page restored from the back/forward cache comes back showing the board).
    close: function () {
      if (!board) return;
      clearInterval(ticking);
      while (screen.firstChild) screen.removeChild(screen.firstChild);
      while (log.firstChild) log.removeChild(log.firstChild);
      while (keys.firstChild) keys.removeChild(keys.firstChild);
      board.hidden = true;
      document.querySelector('.dialer').hidden = false;
    }
  };
})();
