const stage = document.querySelector('#phantom-stage');
const canvas = document.querySelector('#phantom-canvas');
const fallback = document.querySelector('#phantom-fallback');
const select = document.querySelector('#phantom-shape');
const toggle = document.querySelector('#motion-toggle');

if (stage && canvas && fallback && select && toggle) {
  const context = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const source = new Image();
  let points = [];
  let frame = 0;
  let width = 0;
  let height = 0;
  let visible = true;
  let paused = false;
  let ready = false;
  let pointer = { x: -1000, y: -1000 };

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function draw() {
    frame = 0;
    context.clearRect(0, 0, width, height);
    for (const point of points) {
      const dx = point.tx - pointer.x;
      const dy = point.ty - pointer.y;
      const distance = Math.hypot(dx, dy);
      const force = Math.max(0, 1 - distance / 95) * 22;
      const targetX = point.tx + dx / Math.max(distance, 1) * force;
      const targetY = point.ty + dy / Math.max(distance, 1) * force;
      point.x += (targetX - point.x) * .075;
      point.y += (targetY - point.y) * .075;
      context.fillStyle = 'rgba(222,207,174,' + point.opacity + ')';
      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fill();
    }
    if (!paused && !reduced.matches && visible && !document.hidden && ready) frame = requestAnimationFrame(draw);
  }

  function sync() {
    stop();
    const animate = context && ready && !paused && !reduced.matches;
    canvas.hidden = !animate;
    fallback.hidden = Boolean(animate);
    toggle.hidden = !context;
    toggle.disabled = reduced.matches;
    toggle.textContent = reduced.matches ? 'Motion reduced' : paused ? 'Play motion' : 'Pause motion';
    toggle.setAttribute('aria-pressed', String(paused || reduced.matches));
    if (animate && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function rebuild() {
    if (!context || !source.naturalWidth) return;
    const bounds = stage.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const sample = document.createElement('canvas');
    const fit = Math.min(width * .7 / source.naturalWidth, height * .68 / source.naturalHeight);
    sample.width = Math.max(1, Math.round(source.naturalWidth * fit));
    sample.height = Math.max(1, Math.round(source.naturalHeight * fit));
    const sampleContext = sample.getContext('2d', { willReadFrequently: true });
    sampleContext.drawImage(source, 0, 0, sample.width, sample.height);
    const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
    const spacing = Math.max(3, Math.ceil(Math.sqrt(sample.width * sample.height / 1900)));
    points = [];
    for (let y = 0; y < sample.height; y += spacing) {
      for (let x = 0; x < sample.width; x += spacing) {
        const index = (y * sample.width + x) * 4;
        const brightness = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
        if (pixels[index + 3] < 100 || brightness < 85) continue;
        const tx = x + (width - sample.width) / 2;
        const ty = y + (height - sample.height) / 2;
        points.push({ tx, ty, x: Math.random() * width, y: Math.random() * height, radius: 1 + brightness / 300, opacity: .4 + brightness / 450 });
      }
    }
    ready = true;
    sync();
  }

  function changeShape() {
    ready = false;
    stop();
    const option = select.selectedOptions[0];
    fallback.src = option.dataset.src;
    fallback.alt = option.textContent + ' Phantom shape';
    source.src = option.dataset.src;
    sync();
  }

  source.addEventListener('load', rebuild);
  source.addEventListener('error', () => { ready = false; sync(); });
  select.addEventListener('change', changeShape);
  toggle.addEventListener('click', () => { paused = !paused; sync(); });
  let release = 0;
  function aim(event) {
    clearTimeout(release);
    const bounds = stage.getBoundingClientRect();
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  stage.addEventListener('pointerdown', aim);
  stage.addEventListener('pointermove', aim);
  // A touch ends as soon as the finger lifts (or the page scrolls); keep the ripple visible briefly.
  stage.addEventListener('pointerleave', event => {
    clearTimeout(release);
    release = setTimeout(() => { pointer = { x: -1000, y: -1000 }; }, event.pointerType === 'mouse' ? 0 : 700);
  });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  new ResizeObserver(rebuild).observe(stage);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { rootMargin: '100px' }).observe(stage);
  select.disabled = !context;
  changeShape();
}
