// Each Polaroid hangs at its own slight angle, and straightens up when you point at it. One that has been dragged
// keeps its new place (board.js stores it in data-x and data-y).
(function () {
  window.placeCard = function (card, lifted) {
    var x = parseFloat(card.getAttribute('data-x')) || 0, y = parseFloat(card.getAttribute('data-y')) || 0;
    var angle = parseFloat(card.getAttribute('data-tilt')) || 0;
    var transform = 'translate(' + x + 'px,' + y + 'px) ' + (lifted ? 'rotate(0deg) scale(1.06)' : 'rotate(' + angle + 'deg)');
    card.style.webkitTransform = card.style.transform = transform;
  };
  var cards = document.querySelectorAll('.polaroid');
  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      window.placeCard(card, false);
      card.addEventListener('mouseenter', function () { window.placeCard(card, true); }, false);
      card.addEventListener('mouseleave', function () { window.placeCard(card, false); }, false);
    })(cards[i]);
  }
})();
