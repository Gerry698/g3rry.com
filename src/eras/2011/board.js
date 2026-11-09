// The cork board: the captions switch, and a Polaroid that comes off the board when clicked.
(function () {
  var toggle = document.getElementById('captions');
  toggle.addEventListener('change', function () {
    document.body.className = document.body.className.replace(/\s*no-captions/, '') + (toggle.checked ? '' : ' no-captions');
  }, false);

  function close() { var z = document.getElementById('zoom'); if (z) z.parentNode.removeChild(z); }
  var links = document.querySelectorAll('.board .polaroid a');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function (event) {
      event.preventDefault();
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
