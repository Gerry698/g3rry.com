// The board that answers one particular number: a terminal of its time, printed at the speed of the modem.
// Its text comes from the hunt Worker, which sends it only to a caller who dialled the right number.
(function () {
  'use strict';
  var COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'white'];
  var screen, keys, token, speed;

  function print(text, done) {
    var perTick = Math.max(1, Math.round(speed / 10 / 60)), i = 0; // ten bits to a character, sixty ticks a second
    var node = document.createTextNode('');
    screen.appendChild(node);
    (function tick() {
      node.nodeValue = text.slice(0, i += perTick);
      screen.scrollTop = screen.scrollHeight;
      if (i < text.length) requestAnimationFrame(tick); else if (done) done();
    })();
  }
  function choose(options) {
    while (keys.firstChild) keys.removeChild(keys.firstChild);
    options.forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = '[' + option.key + '] ' + option.label;
      button.addEventListener('click', option.run);
      keys.appendChild(button);
    });
    if (keys.firstChild) keys.firstChild.focus();
  }
  document.addEventListener('keydown', function (event) {
    if (!keys || !keys.firstChild || event.ctrlKey || event.metaKey || event.altKey) return;
    var buttons = keys.getElementsByTagName('button');
    for (var i = 0; i < buttons.length; i++) if (buttons[i].textContent.charAt(1).toLowerCase() === event.key.toLowerCase()) { event.preventDefault(); buttons[i].click(); }
  });

  function hangUp(extra) {
    choose([]);
    print((extra || '') + '\n+++\nATH0\nNO CARRIER\n', function () {
      var back = document.createElement('a');
      back.href = '/strata/';
      back.textContent = 'Back to Strata';
      keys.appendChild(back);
      back.focus();
    });
  }
  function menu() {
    choose([
      { key: 'F', label: 'Plant a flag on the summit', run: colours },
      { key: 'G', label: 'Goodbye', run: function () { hangUp('\nThanks for calling. The summit will be here.\n'); } }
    ]);
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
        .then(function (result) {
          if (result.ok) {
            var when = new Date(result.body.date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
            hangUp('\n\nFlag #' + result.body.number + ' (' + colour + ') planted on the summit, ' + when + '.\nIt flies on the summit at the top of the Strata page.\n');
          } else {
            var why = { one_flag_a_day: 'Someone on your line planted a flag today already.', already_planted: 'This call has already planted its flag.', token_expired: 'The connection went stale. Dial again.' };
            hangUp('\n\n' + (why[result.body.error] || 'The summit could not be reached. Dial again later.') + '\n');
          }
        })['catch'](function () { hangUp('\n\nThe line dropped.\n'); });
    });
  }

  window.Board = {
    open: function (result, bps) {
      token = result.token;
      speed = bps || 56000;
      var board = document.getElementById('board');
      screen = document.getElementById('board-screen');
      keys = document.getElementById('board-keys');
      document.querySelector('.dialer').hidden = true;
      board.hidden = false;
      document.title = 'SUMMIT BBS';
      var text = result.board.banner.join('\n') + '\n' + result.board.lines.join('\n') + '\n';
      print(text, menu);
    }
  };
})();
