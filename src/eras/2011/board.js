// The cork board: the captions switch, Polaroids that can be dragged around the board (as jQuery UI made everyone's
// do in 2011), and a Polaroid that comes off the board when clicked.
(function () {
  var toggle = document.getElementById('captions');
  toggle.addEventListener('change', function () {
    document.body.className = document.body.className.replace(/\s*no-captions/, '') + (toggle.checked ? '' : ' no-captions');
  }, false);

  // Dragging. A press that moves more than a few pixels is a drag, not a click on the photograph.
  // 2026: pointer events, so a finger drags as well as a mouse; in 2011 this was jQuery UI's draggable().
  var cards = document.querySelectorAll('.board .polaroid'), top = 10;
  for (var c = 0; c < cards.length; c++) {
    (function (card) {
      var start = null;
      card.addEventListener('pointerdown', function (event) {
        if (event.button !== 0) return;
        start = { x: event.clientX, y: event.clientY, left: parseFloat(card.getAttribute('data-x')) || 0, top: parseFloat(card.getAttribute('data-y')) || 0, moved: false };
        card.setPointerCapture(event.pointerId);
      }, false);
      card.addEventListener('pointermove', function (event) {
        if (!start) return;
        var dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (!start.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
        if (!start.moved) { start.moved = true; card.style.zIndex = ++top; card.className += ' dragging'; }
        card.setAttribute('data-x', start.left + dx);
        card.setAttribute('data-y', start.top + dy);
        window.placeCard(card, true);
      }, false);
      function release() {
        if (!start) return;
        if (start.moved) { card.setAttribute('data-dragged', '1'); card.className = card.className.replace(/\s*dragging/, ''); }
        start = null;
      }
      card.addEventListener('pointerup', release, false);
      card.addEventListener('pointercancel', release, false);
      card.addEventListener('dragstart', function (event) { event.preventDefault(); }, false);
    })(cards[c]);
  }

  function close() { var z = document.getElementById('zoom'); if (z) z.parentNode.removeChild(z); }
  var links = document.querySelectorAll('.board .polaroid a');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function (event) {
      event.preventDefault();
      var card = this.parentNode;
      if (card.getAttribute('data-dragged')) { card.removeAttribute('data-dragged'); return; }
      var zoom = document.createElement('div'); zoom.id = 'zoom';
      var figure = document.createElement('figure');
      var image = document.createElement('img');
      image.src = this.href; image.width = 612; image.height = 612; image.alt = this.querySelector('img').alt;
      var caption = document.createElement('figcaption');
      caption.appendChild(document.createTextNode(this.getAttribute('data-caption')));
      figure.appendChild(image); figure.appendChild(caption); zoom.appendChild(figure);
      zoom.addEventListener('click', close, false);
      document.body.appendChild(zoom);
    }, false);
  }
  document.addEventListener('keydown', function (event) { if (event.keyCode === 27) close(); }, false);
})();
