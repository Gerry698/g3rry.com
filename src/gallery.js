// A thumbnail opens a preview; the photograph's own page (the Phantom) is one step further, from the preview.
// Modified and middle clicks keep the link's own target.
const dialog = document.querySelector('#photo-dialog');
const links = [...document.querySelectorAll('a[data-photo]')];

if (dialog && typeof dialog.showModal === 'function' && links.length) {
  const image = dialog.querySelector('#dialog-image');
  const stage = dialog.querySelector('#dialog-stage');
  const status = dialog.querySelector('#dialog-status');
  const caption = dialog.querySelector('#dialog-caption');
  const exposure = dialog.querySelector('#dialog-exposure');
  const position = dialog.querySelector('#dialog-position');
  const close = dialog.querySelector('#dialog-close');
  const phantom = dialog.querySelector('#dialog-phantom');
  const previous = dialog.querySelector('#dialog-previous');
  const next = dialog.querySelector('#dialog-next');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let opener = 0;
  let request = 0;
  let morphing = false;
  let gesture = null;
  const pointers = new Set();
  const photoHash = index => '#photo-' + links[index].dataset.photo;
  const hashIndex = () => links.findIndex((link, index) => photoHash(index) === location.hash);
  const thumbnail = index => links[index].querySelector('img');
  const decoded = img => img.complete && img.naturalWidth > 0;
  const onScreen = element => {
    const box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < innerHeight;
  };

  function show(index) {
    current = (index + links.length) % links.length;
    const link = links[current];
    const thumb = thumbnail(current);
    const token = ++request;
    const width = Number(link.dataset.width);
    const height = Number(link.dataset.height);
    image.alt = thumb.alt;
    image.width = width;
    image.height = height;
    // The image box takes the photograph's own shape (styles.css), not the whole stage's.
    image.style.setProperty('--ratio', String(width / height));
    caption.textContent = link.dataset.caption;
    exposure.textContent = link.dataset.exposure;
    position.textContent = String(current + 1).padStart(2, '0') + ' / ' + links.length;
    phantom.href = link.getAttribute('href');
    // A thumbnail that has already loaded stands in until the full size arrives; the preview grows out of it.
    const standIn = decoded(thumb);
    if (standIn) image.src = thumb.currentSrc || thumb.src;
    else image.removeAttribute('src');
    image.hidden = !standIn;
    stage.setAttribute('aria-busy', 'true');
    status.textContent = standIn ? '' : 'Loading photograph…';
    // Let the browser pick a WebP size for the screen; the JPEG stays the fallback.
    const loading = new Image();
    loading.sizes = '100vw';
    if (link.dataset.srcset) loading.srcset = link.dataset.srcset;
    loading.onload = () => {
      if (token !== request || !dialog.open) return;
      image.src = loading.currentSrc || link.dataset.large;
      image.hidden = false;
      status.textContent = '';
      stage.setAttribute('aria-busy', 'false');
    };
    loading.onerror = () => {
      if (token !== request || !dialog.open) return;
      image.hidden = true;
      status.textContent = 'This photograph could not load. Try another frame.';
      stage.setAttribute('aria-busy', 'false');
    };
    loading.src = link.dataset.large;
  }
  // Where the browser has view transitions, the photograph moves between its thumbnail and the preview; never under
  // reduced motion. Exactly one element carries the name at each snapshot, and each name is cleared when its part ends.
  function morph(from, update, target) {
    if (!document.startViewTransition || reduced.matches || morphing || !from) return update();
    let to = null;
    morphing = true;
    from.style.viewTransitionName = 'photo';
    const transition = document.startViewTransition(async () => {
      from.style.viewTransitionName = '';
      update();
      to = target();
      if (!to) return;
      to.style.viewTransitionName = 'photo';
      // The page stays frozen on the old frame meanwhile; this is a decoded thumbnail, so it takes a moment at most.
      await to.decode().catch(() => {});
    });
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {}).finally(() => { morphing = false; });
    transition.finished.catch(() => {}).finally(() => { if (to) to.style.viewTransitionName = ''; });
  }
  function open(index, fromLink = false) {
    const enter = () => {
      if (!dialog.open) {
        opener = index;
        dialog.showModal();
        close.focus();
        // Arriving at a frame's address (back from its page, or a shared link): put the grid behind on that frame. A
        // preview opened from the grid leaves it where it is, which is also where going back restores it.
        if (!fromLink && !onScreen(links[index])) links[index].scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      show(index);
    };
    if (fromLink && !dialog.open) morph(decoded(thumbnail(index)) ? thumbnail(index) : null, enter, () => image.hidden ? null : image);
    else enter();
    if (fromLink) history.pushState({ g3rryPhoto: true }, '', photoHash(index));
  }
  // Closing returns the photograph to its thumbnail when that is on screen; otherwise it fades where it is.
  function dismiss() {
    if (!dialog.open || morphing) return;
    const thumb = thumbnail(current);
    morph(image.hidden ? null : image, () => dialog.close(), () => decoded(thumb) && onScreen(thumb) ? thumb : null);
  }
  function navigate(step) {
    show(current + step);
    // A shared URL owns no history entry; closing it should stay on the gallery.
    history.replaceState(history.state, '', photoHash(current));
  }
  links.forEach((link, index) => link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!morphing) open(index, true);
  }));
  close.addEventListener('click', dismiss);
  previous.addEventListener('click', () => navigate(-1));
  next.addEventListener('click', () => navigate(1));
  // Empty space closes the preview; the photograph, the controls and the caption (so it can be copied) do not. Only a
  // press that began on empty space and stayed put counts: a drag off the caption or a button ends in a click on their
  // common ancestor, and a drag that selects text or swipes to another frame is not a click.
  const keep = '#dialog-image, button, a, .dialog-caption';
  let press = null;
  dialog.addEventListener('pointerdown', event => {
    // A second finger (a pinch) is never primary, so it cancels the press.
    press = event.isPrimary && event.button === 0 && !event.target.closest(keep) ? { x: event.clientX, y: event.clientY } : null;
  });
  dialog.addEventListener('click', event => {
    const empty = press && !event.target.closest(keep) && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 10;
    press = null;
    if (empty) dismiss();
  });
  // Escape closes through the same path as Close; when the browser will not let a close be held back, it simply closes.
  dialog.addEventListener('cancel', event => {
    if (!event.cancelable) return;
    event.preventDefault();
    dismiss();
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
    links[opener].focus({ preventScroll: true });
  });
  function syncAddress() {
    const index = hashIndex();
    if (index !== -1) open(index);
    else dismiss();
  }
  window.addEventListener('popstate', syncAddress);
  window.addEventListener('hashchange', syncAddress);
  syncAddress();
}
