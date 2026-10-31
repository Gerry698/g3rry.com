const dialog = document.querySelector('#photo-dialog');
const links = [...document.querySelectorAll('a[data-photo]')];
const collection = document.querySelector('.photo-collection');
const tools = document.querySelector('#collection-tools');

if (tools && collection) {
  tools.classList.add('ready');
  tools.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      collection.dataset.view = button.dataset.view;
      const sizes = button.dataset.view === 'large' ? collection.dataset.sizesLarge : collection.dataset.sizesGrid;
      collection.querySelectorAll('source[sizes]').forEach(source => { source.sizes = sizes; });
      tools.querySelectorAll('[data-view]').forEach(control => {
        control.setAttribute('aria-pressed', String(control === button));
      });
    });
  });
}

if (dialog && typeof dialog.showModal === 'function' && links.length) {
  const image = dialog.querySelector('#dialog-image');
  const stage = dialog.querySelector('#dialog-stage');
  const status = dialog.querySelector('#dialog-status');
  const feedback = dialog.querySelector('#dialog-feedback');
  const caption = dialog.querySelector('#dialog-caption');
  const position = dialog.querySelector('#dialog-position');
  const close = dialog.querySelector('#dialog-close');
  const original = dialog.querySelector('#dialog-original');
  const share = dialog.querySelector('#dialog-share');
  const previous = dialog.querySelector('#dialog-previous');
  const next = dialog.querySelector('#dialog-next');
  const hint = 'Swipe or use arrow keys. Open image to zoom.';
  let current = 0;
  let request = 0;
  let returnFocus = null;
  let gesture = null;
  const pointers = new Set();
  const photoHash = index => '#' + links[index].closest('figure').id;
  const hashIndex = () => links.findIndex((link, index) => photoHash(index) === location.hash);

  function show(index) {
    current = (index + links.length) % links.length;
    const link = links[current];
    const thumbnail = link.querySelector('img');
    const token = ++request;
    image.hidden = true;
    image.removeAttribute('src');
    image.alt = thumbnail.alt;
    image.width = Number(link.dataset.width);
    image.height = Number(link.dataset.height);
    caption.textContent = thumbnail.alt;
    position.textContent = String(current + 1).padStart(2, '0') + ' / ' + links.length;
    original.href = link.href;
    feedback.textContent = hint;
    stage.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading photograph…';
    // Let the browser pick a WebP size for the screen; the JPEG link stays the fallback and the "Open image" target.
    const loading = new Image();
    loading.sizes = '100vw';
    if (link.dataset.srcset) loading.srcset = link.dataset.srcset;
    loading.onload = () => {
      if (token !== request || !dialog.open) return;
      image.src = loading.currentSrc || link.href;
      image.hidden = false;
      status.textContent = '';
      stage.setAttribute('aria-busy', 'false');
    };
    loading.onerror = () => {
      if (token !== request || !dialog.open) return;
      status.textContent = 'This photograph could not load. Try Open image or another frame.';
      stage.setAttribute('aria-busy', 'false');
    };
    loading.src = link.href;
  }
  function open(index, fromLink = false) {
    if (!dialog.open) {
      returnFocus = links[index];
      dialog.showModal();
      close.focus();
    }
    show(index);
    if (fromLink) history.pushState({ g3rryPhoto: true }, '', photoHash(current));
  }
  function navigate(step) {
    show(current + step);
    // A shared URL owns no history entry; closing it should stay on the gallery.
    history.replaceState(history.state, '', photoHash(current));
  }
  links.forEach((link, index) => {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      open(index, true);
    });
  });
  close.addEventListener('click', () => dialog.close());
  previous.addEventListener('click', () => navigate(-1));
  next.addEventListener('click', () => navigate(1));
  share.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      feedback.textContent = 'Link copied. Share this frame.';
    } catch {
      feedback.textContent = 'Copy this page’s address to share this frame.';
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(event.key === 'ArrowLeft' ? -1 : 1);
    }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button, a[href]')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  // Leave vertical scrolling and pinch zoom native; never capture a pointer.
  dialog.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    pointers.add(event.pointerId);
    if (pointers.size > 1) gesture = null;
  }, true);
  stage.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    if (pointers.size !== 1 || !event.isPrimary || (window.visualViewport?.scale ?? 1) > 1 || event.clientX < 20 || event.clientX > innerWidth - 20) {
      gesture = null;
      return;
    }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
  });
  window.addEventListener('pointerup', event => {
    const start = gesture;
    pointers.delete(event.pointerId);
    gesture = null;
    if (!start || start.id !== event.pointerId || pointers.size || (window.visualViewport?.scale ?? 1) > 1) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - start.time < 800) navigate(dx < 0 ? 1 : -1);
  });
  window.addEventListener('pointercancel', event => {
    pointers.delete(event.pointerId);
    gesture = null;
  });
  dialog.addEventListener('close', () => {
    ++request;
    image.removeAttribute('src');
    pointers.clear();
    gesture = null;
    if (hashIndex() !== -1) {
      if (history.state?.g3rryPhoto) history.back();
      else history.replaceState(history.state, '', location.pathname + location.search);
    }
    returnFocus?.focus({ preventScroll: true });
  });
  function syncAddress() {
    const index = hashIndex();
    if (index !== -1) open(index);
    else if (dialog.open) dialog.close();
  }
  window.addEventListener('popstate', syncAddress);
  window.addEventListener('hashchange', syncAddress);
  syncAddress();
}
