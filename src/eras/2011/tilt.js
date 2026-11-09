// Each Polaroid hangs at its own slight angle, and straightens up when you point at it.
(function () {
  var cards = document.querySelectorAll('.polaroid');
  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      var angle = parseFloat(card.getAttribute('data-tilt')) || 0;
      var rest = 'rotate(' + angle + 'deg)';
      card.style.webkitTransform = card.style.transform = rest;
      card.addEventListener('mouseenter', function () { card.style.webkitTransform = card.style.transform = 'rotate(0deg) scale(1.06)'; }, false);
      card.addEventListener('mouseleave', function () { card.style.webkitTransform = card.style.transform = rest; }, false);
    })(cards[i]);
  }
})();
