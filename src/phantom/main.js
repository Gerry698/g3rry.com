import { createContext, imageTexture, texture } from './gl.js';
import { Particles, ROW } from './particles.js';
import { Post } from './post.js';
import { Camera, orbit, framingDistance } from './camera.js';
import { clamp, lerp, smoothstep, catmull, project, sub, dot, add, scale, length, mix3, perspective, lookAt, multiply } from './math.js';
import { dustCount } from './targets.js';

const config = JSON.parse(document.getElementById('lab-config').textContent);
const canvas = document.getElementById('lab-canvas');
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const $ = selector => document.querySelector(selector);

const context = createContext(canvas);
if (context) {
  try { start(context); } catch (error) { console.error(error); root.classList.remove('lab-gl'); }
}

function start({ gl, hdr }) {
  root.classList.add('lab-gl');
  const particles = new Particles(gl);
  const post = new Post(gl, hdr);
  const camera = new Camera();
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  // ---- Off-thread target building -------------------------------------------------------------
  let job = 0;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.set);
  };
  const build = (kind, options, transfer = []) => new Promise((resolve, reject) => {
    const id = ++job;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, kind, options }, transfer);
  });

  async function loadImage(url) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  }
  function pixelsOf(image, maxSide) {
    const fit = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * fit)), height = Math.max(1, Math.round(image.naturalHeight * fit));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context2d = sample.getContext('2d', { willReadFrequently: true });
    context2d.drawImage(image, 0, 0, width, height);
    return { pixels: new Uint8Array(context2d.getImageData(0, 0, width, height).data.buffer), width, height };
  }
  // Depth maps (tools/phantom-data/depth.mjs): gzip of a width/height header and row-delta uint16 disparities.
  async function loadDepth(url) {
    const response = await fetch(url);
    const buffer = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const header = new DataView(buffer);
    const width = header.getUint16(0, true), height = header.getUint16(2, true);
    const deltas = new Uint16Array(buffer, 4, width * height);
    const values = new Uint16Array(width * height);
    for (let i = 0; i < deltas.length; i++) values[i] = (i % width ? values[i - 1] : i >= width ? values[i - width] : 0) + deltas[i];
    return { depth: Float32Array.from(values, value => value / 65535), depthWidth: width, depthHeight: height };
  }

  // ---- Quality: particle count follows what the device sustains ---------------------------------
  const tiers = [65536, 131072, 262144, 524288, 1048576];
  let tier = coarse.matches || Math.min(innerWidth, innerHeight) < 600 ? 1 : 3;
  let dpr = 1;
  let viewWidth = 1, viewHeight = 1;
  const count = () => tiers[tier];
  const base = () => 1.05 + .55 * dpr;

  const cache = new Map();
  const shapeImages = new Map();
  function setFor(key, make) {
    const full = key + '@' + count();
    if (!cache.has(full)) cache.set(full, make().catch(error => { cache.delete(full); throw error; }));
    return cache.get(full);
  }
  const markGain = n => 262144 / n * .2;
  function markTargets(shape, relief) {
    return setFor('mark:' + shape.id + ':' + relief, async () => {
      if (!shapeImages.has(shape.id)) shapeImages.set(shape.id, loadImage(shape.url));
      const sample = pixelsOf(await shapeImages.get(shape.id), 640);
      const set = await build('mark', { count: count(), ...sample, relief }, [sample.pixels.buffer]);
      set.gain = markGain(set.count);
      return set;
    });
  }
  function introTargets() {
    return setFor('intro', async () => {
      const set = await build('intro', { count: count() });
      set.gain = markGain(set.count) * 4.6;
      return set;
    });
  }

  // A photograph is sampled at about one point per particle; its size flag and gain make the points tile the frame like film grain.
  function photoFit(photo) {
    const aspect = viewWidth / viewHeight, photoAspect = photo.width / photo.height;
    const sensorW = photoAspect >= 1 ? 36 : 24, sensorH = photoAspect >= 1 ? 24 : 36;
    const tanX = sensorW / 2 / photo.focal, tanY = sensorH / 2 / photo.focal;
    // Our focal length is chosen so the whole frame fits the share of the screen left beside (or above) the text.
    const [roomX, roomY] = wide() ? [.58, .76] : [.92, .54];
    const needX = tanX / roomX, needY = tanY / roomY;
    let viewTanX, viewTanY;
    if (aspect >= 1) { viewTanX = Math.max(needX, needY * aspect); viewTanY = viewTanX / aspect; } else { viewTanY = Math.max(needY, needX / aspect); viewTanX = viewTanY * aspect; }
    const focal = 18 / (aspect >= 1 ? viewTanX : viewTanY);
    return { tanX, tanY, focal, viewTanX, viewTanY, screenArea: viewWidth * viewHeight * (tanX / viewTanX) * (tanY / viewTanY) };
  }
  function photoTargets(photo) {
    return setFor('photo:' + photo.id, async () => {
      const image = await loadImage(photo.url);
      const points = count() - dustCount(count());
      const side = Math.min(1280, Math.round(Math.sqrt(points * Math.max(photo.width / photo.height, photo.height / photo.width))));
      const sample = pixelsOf(image, side);
      const depth = photo.depthUrl ? await loadDepth(photo.depthUrl) : fallbackDepth(sample);
      const fit = photoFit(photo);
      const spacing = Math.sqrt(fit.screenArea / Math.min(points, sample.width * sample.height));
      const sizeFlag = Math.max(1, spacing * 1.15 / base());
      const unit = photo.unit;
      const set = await build('photo', {
        count: count(), ...sample, ...depth, near: photo.depth[0], far: photo.depth[1], tanX: fit.tanX, tanY: fit.tanY, unit, sizeFlag
      }, [sample.pixels.buffer]);
      set.points = Math.min(points, sample.width * sample.height);
      set.sizeFlag = sizeFlag;
      set.gain = photoGain(set, photo);
      return set;
    });
  }
  function photoGain(set, photo) {
    const spacing2 = photoFit(photo).screenArea / set.points;
    return spacing2 / (.19 * (base() * set.sizeFlag) ** 2) * .9;
  }
  // Until a depth map has been generated: nearer toward the bottom of the frame, as the ground usually is.
  function fallbackDepth({ width, height }) {
    const depth = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) depth[y * width + x] = .15 + .7 * Math.pow(y / height, 1.6);
    return { depth, depthWidth: width, depthHeight: height };
  }

  // ---- Layout ---------------------------------------------------------------------------------
  const wide = () => viewWidth / viewHeight > 1.15 && innerWidth > 860;
  // Lens shift that keeps the subject clear of the text: right of centre on wide screens, above it on narrow ones.
  const subjectShift = () => wide() ? [.28, 0] : [0, .22];

  // ---- Chapters -------------------------------------------------------------------------------
  const state = {
    shape: config.shapes[0], shutter: 0, focal: null, aperture: null, photo: 0, mode: 'photo', contours: 0,
    dragAzimuth: 0, dragElevation: 0, paused: false
  };
  const developPhotos = config.develop.map(photo => ({ ...photo, unit: 6 / Math.sqrt(photo.depth[0] * photo.depth[1]) }));

  function rail(keys, p) {
    const n = keys.length - 1;
    const x = clamp(p, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(x));
    const t = smoothstep(0, 1, x - i);
    const at = k => keys[clamp(k, 0, n)];
    return catmull(at(i - 1), at(i), at(i + 1), at(i + 2), t);
  }

  const chapters = {
    intro: {
      targets: introTargets,
      sim: { stiffness: 6, damping: .9, turbulence: .1, flight: 2.2, noiseScale: .35 },
      pointer: true,
      camera(p, time) {
        const distance = 8.6 - p * 1.4;
        const pos = orbit([0, 0, 0], Math.sin(time * .05) * .22, .1 + Math.sin(time * .037) * .05, distance);
        return { pos, look: [0, 0, 0], focal: 35, aperture: 1.6, focus: distance - .2, shift: [0, wide() ? .02 : .08], metersPerUnit: .5 };
      }
    },
    ignite: {
      targets: () => markTargets(state.shape, false),
      sim: { stiffness: 14, damping: .8, turbulence: 0, flight: 3, noiseScale: .55 },
      pointer: true,
      camera(p, time) {
        const still = state.shutter > 20 ? 0 : 1;
        const distance = 8.2 - p * .6;
        const pos = [Math.sin(time * .13) * .1 * still, Math.sin(time * .1) * .05 * still, distance];
        return { pos, look: [pos[0] * .5, pos[1] * .5, 0], focal: 50, aperture: 4, focus: distance, shift: subjectShift(), metersPerUnit: .5 };
      }
    },
    sculpt: {
      targets: () => markTargets(state.shape, true),
      sim: { stiffness: 16, damping: .85, turbulence: 0, flight: 3, noiseScale: .5 },
      pointer: true,
      drag: true,
      camera(p, time) {
        const [azimuth, elevation, railFocal, railAperture, focusShift] = rail([
          [0, .02, 50, 2.8, 0], [.62, .14, 35, 2, -.35], [1.15, .22, 135, 2, 0], [2.2, -.1, 85, 1.4, .45], [3.0, .08, 70, 2, 0], [Math.PI * 2 - .2, .04, 50, 2.8, 0]
        ], p);
        const focal = state.focal || railFocal;
        const aperture = state.aperture || railAperture;
        const distance = framingDistance(wide() ? 4.4 : 4.9, focal);
        const look = [0, 0, 0];
        const pos = orbit(look, azimuth + state.dragAzimuth + Math.sin(time * .1) * .02, clamp(elevation + state.dragElevation, -.9, 1.2), distance);
        return { pos, look, focal, aperture, focus: Math.max(.5, distance + focusShift), shift: subjectShift(), metersPerUnit: .6 };
      }
    },
    develop: {
      targets: () => photoTargets(developPhotos[state.photo]),
      sim: { stiffness: 18, damping: .9, turbulence: 0, flight: 2.4, noiseScale: .3 },
      pointer: false,
      drag: true,
      camera(p) {
        const photo = developPhotos[state.photo];
        const fit = photoFit(photo);
        const pivot = [0, 0, -6];
        // At the start the camera stands exactly where the photograph was taken; then it steps aside.
        const away = smoothstep(.12, .7, p);
        const azimuth = Math.sin(p * Math.PI * 1.5) * .11 * away + state.dragAzimuth;
        const elevation = .045 * away + state.dragElevation;
        const pos = orbit(pivot, azimuth, elevation, 6 - away * .4);
        return { pos, look: pivot, focal: fit.focal, aperture: 8, focus: 6, shift: subjectShift(), metersPerUnit: 1 / photo.unit };
      }
    },
    atlas: {
      phase: p => stopAt(p).id,
      targets: (p = progress) => { const stop = stopAt(p); return stop.cloud ? cityTargets(stop) : globeTargets(); },
      sim: { stiffness: 10, damping: .9, turbulence: 0, flight: 2.6, noiseScale: .3 },
      pointer: false,
      drag: true,
      camera(p, time) { return atlasCamera(stopAt(p), stopProgress(p), time); }
    }
  };

  // ---- Atlas: a globe, then each site's LiDAR clouds, scaled so a stop always fits the scene ----------------
  const atlas = config.atlas;
  const stops = atlas.stops;
  const home = config.sites.find(item => item.status === 'live') || config.sites[0];
  const GLOBE = 1.6;
  const rad = Math.PI / 180;
  const stopAt = p => stops[Math.min(stops.length - 1, Math.floor(clamp(p, 0, .9999) * stops.length))];
  const stopProgress = p => clamp(p * stops.length - stops.indexOf(stopAt(p)), 0, 1);
  const metersOf = stop => stop.id === 'overview' ? 1250 : 100;
  const inflate = async url => new Response((await fetch(url)).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  let land = null;
  function globeTargets() {
    return setFor('globe', async () => {
      land = land || inflate(atlas.land);
      const buffer = await land;
      const header = new DataView(buffer);
      const mask = new Uint8Array(buffer.slice(4));
      const set = await build('globe', { count: count(), mask, maskWidth: header.getUint16(0, true), maskHeight: header.getUint16(2, true), sites: config.sites, centre: [home.lat, home.lon], radius: GLOBE }, [mask.buffer]);
      set.gain = markGain(set.count) * 1.5;
      return set;
    });
  }
  const clouds = new Map();
  function cityTargets(stop) {
    return setFor('city:' + stop.id, async () => {
      if (!clouds.has(stop.cloud)) clouds.set(stop.cloud, inflate(atlas.clouds[stop.cloud]));
      const data = (await clouds.get(stop.cloud)).slice(0);
      const set = await build('city', { count: count(), data, centre: atlas.frames.clouds[stop.cloud].center, metersPerUnit: metersOf(stop) }, [data]);
      set.gain = markGain(set.count) * 2.6;
      return set;
    });
  }
  // East-north-up metres around the site origin -> this stop's scene units (x east, y up, z south).
  function world(stop, [east, north, up]) {
    const centre = atlas.frames.clouds[stop.cloud].center, u = 1 / metersOf(stop);
    return [(east - centre[0]) * u, up * u, -(north - centre[1]) * u];
  }
  const photoTextures = new Map();
  const blank = texture(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array(4) });
  function photoTexture(photo) {
    if (!photoTextures.has(photo.id)) {
      photoTextures.set(photo.id, null);
      loadImage(photo.url).then(image => photoTextures.set(photo.id, imageTexture(gl, image))).catch(() => {});
    }
    return photoTextures.get(photo.id) || blank;
  }
  // Where the stop's photograph was taken, in scene units, with the matrix that projects it.
  function station(stop) {
    const solved = atlas.frames.stops[stop.id];
    if (!solved || !stop.photo) return null;
    const pos = world(stop, solved.camera), look = world(stop, solved.look);
    const fit = photoFit(stop.photo);
    const matrix = multiply(perspective(2 * Math.atan(fit.tanY), fit.tanX / fit.tanY, .01, 4000), lookAt(pos, look));
    return { pos, look, fit, matrix };
  }
  let atlasPhoto = null;
  function atlasCamera(stop, t, time) {
    const shift = subjectShift();
    atlasPhoto = null;
    if (stop.id === 'globe') {
      const k = smoothstep(0, .85, t);
      const distance = lerp(8.6, 5.4, smoothstep(0, 1, t));
      const pos = orbit([0, 0, 0], lerp(-1.2, 0, k) + Math.sin(time * .05) * .04 + state.dragAzimuth, lerp(.12, home.lat * rad, k) + state.dragElevation, distance);
      return { pos, look: [0, 0, 0], focal: 50, aperture: 4, focus: distance - GLOBE, shift, metersPerUnit: 6371000 / GLOBE };
    }
    if (stop.id === 'overview') {
      const liberty = atlas.frames.stops.liberty ? world(stop, atlas.frames.stops.liberty.look) : [0, 0, 0];
      const k = smoothstep(0, 1, t);
      const look = mix3([0, 0, -.6], [liberty[0] * .6, 0, liberty[2] * .6], k);
      const pos = add(look, orbit([0, 0, 0], lerp(-.35, -.9, k) + state.dragAzimuth, lerp(.62, .42, k) + state.dragElevation, lerp(8.2, 5.2, k)));
      return { pos, look, focal: lerp(35, 45, k), aperture: 5.6, focus: length(sub(pos, look)), shift, metersPerUnit: metersOf(stop) };
    }
    const at = station(stop);
    if (!at) return { pos: [0, 3, 6], look: [0, 0, 0], focal: 35, aperture: 5.6, focus: 6.7, shift, metersPerUnit: metersOf(stop) };
    // Arrive from a close orbit of the subject (Liberty) or from above (Times Square), then settle exactly at the station.
    const approach = smoothstep(.12, .78, t);
    const start = stop.id === 'liberty'
      ? add(at.look, orbit([0, 0, 0], 2.3 + t * 1.6 + state.dragAzimuth, .32 + state.dragElevation, 2.4))
      : add(at.pos, [0, 3.4 - t, 2.2]);
    const startLook = stop.id === 'liberty' ? at.look : mix3(at.pos, at.look, .04);
    const pos = mix3(start, at.pos, approach), look = mix3(startLook, at.look, approach);
    atlasPhoto = { stop, at, mix: smoothstep(.72, .9, t), print: t > .9 };
    return { pos, look, focal: Math.exp(lerp(Math.log(35), Math.log(at.fit.focal), approach)), aperture: 8, focus: Math.max(.2, length(sub(at.look, pos))), shift, metersPerUnit: metersOf(stop) };
  }
  const print = $('#lab-print'), printImage = $('#lab-print-image');
  function showPrint(view) {
    const shown = active === 'atlas' && atlasPhoto && atlasPhoto.print && length(sub(view.pos, atlasPhoto.at.pos)) < .02;
    if (shown) {
      const { stop, at } = atlasPhoto;
      if (printImage.dataset.photo !== stop.photo.id) { printImage.src = stop.photo.url; printImage.dataset.photo = stop.photo.id; }
      const w = at.fit.tanX / at.fit.viewTanX * innerWidth, h = at.fit.tanY / at.fit.viewTanY * innerHeight;
      const cx = (.5 + view.shift[0] / 2) * innerWidth, cy = (.5 - view.shift[1] / 2) * innerHeight;
      print.style.cssText = 'width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;transform:translate(' + (cx - w / 2).toFixed(1) + 'px,' + (cy - h / 2).toFixed(1) + 'px)';
    }
    print.classList.toggle('is-shown', Boolean(shown));
    const current = active === 'atlas' ? stopAt(progress).id : null;
    for (const item of document.querySelectorAll('[data-stop]')) item.classList.toggle('is-current', item.dataset.stop === current);
  }
  const order = ['intro', 'ignite', 'sculpt', 'develop', 'atlas'];
  const sections = order.map(id => ({ id, element: document.querySelector('[data-chapter="' + id + '"]') }));
  let active = 'intro';
  let activePhase = '';
  let progress = 0;
  let wanted = null;

  function measure() {
    const middle = innerHeight * .5;
    let found = sections[0], found_p = 0;
    for (const section of sections) {
      const rect = section.element.getBoundingClientRect();
      if (rect.top <= middle) { found = section; found_p = clamp((middle - rect.top) / rect.height, 0, 1); }
    }
    const phase = chapters[found.id].phase ? chapters[found.id].phase(found_p) : '';
    const changed = found.id !== active || phase !== activePhase;
    if (found.id !== active) state.dragAzimuth = state.dragElevation = 0;
    active = found.id;
    activePhase = phase;
    progress = found_p;
    if (changed) retarget();
  }

  // Requests the active chapter's targets; a stale answer (the reader has moved on) is dropped.
  function retarget() {
    const token = wanted = active + ':' + activePhase + ':' + state.shape.id + ':' + state.photo + ':' + count();
    chapters[active].targets().then(set => {
      if (wanted !== token || set.count !== particles.count || set === particles.toSet) return;
      particles.retarget(set, { speed: reduced.matches ? 50 : .5, sweep: active === 'develop' ? [0, -.18, 0, .55] : active === 'atlas' ? [0, 0, .12, .4] : [.22, 0, 0, .35] });
      if (reduced.matches) snap = 2;
    }).catch(error => console.error(error));
    // Warm the neighbours so the next morph starts without waiting.
    const next = order[order.indexOf(active) + 1];
    if (next) chapters[next].targets(0).catch(() => {});
    const following = active === 'atlas' && stops[stops.indexOf(stopAt(progress)) + 1];
    if (following && following.cloud) cityTargets(following).catch(() => {});
  }

  // ---- Input ----------------------------------------------------------------------------------
  const pointer = { x: 0, y: 0, active: 0, down: null, moved: false };
  const shocks = [];
  addEventListener('pointermove', event => {
    pointer.x = event.clientX / innerWidth * 2 - 1;
    pointer.y = 1 - event.clientY / innerHeight * 2;
    pointer.active = 1;
    if (pointer.down && event.pointerType === 'mouse' && chapters[active].drag) {
      const dx = event.clientX - pointer.down.x, dy = event.clientY - pointer.down.y;
      if (Math.hypot(dx, dy) > 4) pointer.moved = true;
      if (pointer.moved) {
        state.dragAzimuth = pointer.down.azimuth - dx / innerWidth * 3.2;
        state.dragElevation = clamp(pointer.down.elevation + dy / innerHeight * 1.6, -.8, .9);
      }
    }
  }, { passive: true });
  const interactive = target => target.closest('a, button, select, input, label, fieldset, .lab-panel');
  addEventListener('pointerdown', event => {
    if (interactive(event.target)) return;
    pointer.x = event.clientX / innerWidth * 2 - 1;
    pointer.y = 1 - event.clientY / innerHeight * 2;
    pointer.active = 1;
    pointer.down = { x: event.clientX, y: event.clientY, azimuth: state.dragAzimuth, elevation: state.dragElevation };
    pointer.moved = false;
  });
  addEventListener('pointerup', event => {
    if (pointer.down && !pointer.moved && chapters[active].pointer && !reduced.matches && !state.paused) shock();
    pointer.down = null;
    if (event.pointerType !== 'mouse') setTimeout(() => { pointer.active = 0; }, 600);
  });
  document.addEventListener('pointerleave', () => { pointer.active = 0; });
  function shock() {
    if (!frame) return;
    const ray = camera.ray(frame.inverse, pointer.x, pointer.y);
    const look = camera.value.look;
    const t = Math.max(0, dot(sub(look, ray.origin), ray.dir));
    shocks.push({ at: add(ray.origin, scale(ray.dir, t)), age: 0 });
    if (shocks.length > 4) shocks.shift();
  }

  // ---- Controls -------------------------------------------------------------------------------
  const shapeSelect = $('#lab-shape');
  shapeSelect.disabled = false;
  shapeSelect.addEventListener('change', () => {
    state.shape = config.shapes.find(shape => shape.id === shapeSelect.value);
    if (active === 'ignite' || active === 'sculpt') retarget();
  });
  const shutterStops = [[1 / 60, '1/60'], [1 / 30, '1/30'], [1 / 15, '1/15'], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 2, '1/2'], [1, '1"'], [2, '2"'], [4, '4"']];
  const shutterInput = $('#lab-shutter');
  shutterInput.disabled = false;
  const shutterTime = () => Math.exp(lerp(Math.log(1 / 60), Math.log(4), state.shutter / 100));
  const nearest = (stops, value) => stops.reduce((best, stop) => Math.abs(Math.log(stop[0] / value)) < Math.abs(Math.log(best[0] / value)) ? stop : best);
  const shutterLabel = () => nearest(shutterStops, shutterTime())[1];
  shutterInput.addEventListener('input', () => { state.shutter = Number(shutterInput.value); $('#lab-shutter-out').textContent = shutterLabel(); });
  const apertureStops = [1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16].map(value => [value, 'ƒ/' + value]);
  const apertureInput = $('#lab-aperture');
  apertureInput.disabled = false;
  apertureInput.addEventListener('input', () => {
    state.aperture = Math.exp(lerp(Math.log(1.2), Math.log(16), Number(apertureInput.value) / 100));
    $('#lab-aperture-out').textContent = nearest(apertureStops, state.aperture)[1];
  });
  for (const button of document.querySelectorAll('[data-focal]')) {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const focal = Number(button.dataset.focal);
      state.focal = state.focal === focal ? null : focal;
      for (const other of document.querySelectorAll('[data-focal]')) other.setAttribute('aria-pressed', String(Number(other.dataset.focal) === state.focal));
    });
  }
  const photoLabel = $('#lab-photo-label');
  const showPhoto = () => {
    const photo = developPhotos[state.photo];
    photoLabel.textContent = 'Frame ' + photo.frame + ' · ' + photo.place;
  };
  showPhoto();
  const stepPhoto = delta => {
    state.photo = (state.photo + delta + developPhotos.length) % developPhotos.length;
    state.dragAzimuth = state.dragElevation = 0;
    showPhoto();
    if (active === 'develop') retarget();
  };
  $('#lab-photo-prev').addEventListener('click', () => stepPhoto(-1));
  $('#lab-photo-next').addEventListener('click', () => stepPhoto(1));
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      for (const other of document.querySelectorAll('[data-mode]')) other.setAttribute('aria-pressed', String(other === button));
    });
  }
  const motion = $('#lab-motion');
  motion.hidden = false;
  const syncMotion = () => {
    motion.textContent = reduced.matches ? 'Motion reduced' : state.paused ? 'Play' : 'Pause';
    motion.disabled = reduced.matches;
    motion.setAttribute('aria-pressed', String(state.paused || reduced.matches));
  };
  motion.addEventListener('click', () => { state.paused = !state.paused; syncMotion(); });
  reduced.addEventListener('change', syncMotion);
  syncMotion();
  for (const control of document.querySelectorAll('[data-needs-gl] [disabled]')) control.disabled = false;

  // ---- Viewfinder readout ----------------------------------------------------------------------
  const read = {
    chapter: $('#lab-read-chapter'), focal: $('#lab-read-focal'), aperture: $('#lab-read-aperture'),
    shutter: $('#lab-read-shutter'), focus: $('#lab-read-focus'), count: $('#lab-read-count'), af: $('#lab-af')
  };
  const labels = { intro: 'Lab', ignite: '00 Ignite', sculpt: '01 Sculpt', develop: '02 Develop', atlas: '03 Atlas' };
  function readout(view, matrices) {
    read.chapter.textContent = labels[active];
    read.focal.textContent = Math.round(view.focal);
    read.aperture.textContent = nearest(apertureStops, view.aperture)[1];
    read.shutter.textContent = active === 'ignite' ? shutterLabel() : '1/60';
    const meters = view.focus * view.metersPerUnit;
    read.focus.textContent = meters > 1e5 ? '∞' : meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : meters >= 10 ? Math.round(meters) + ' m' : meters.toFixed(1) + ' m';
    read.count.textContent = particles.count.toLocaleString('en-US') + ' points';
    const forward = sub(view.look, view.pos);
    const focusPoint = add(view.pos, scale(forward, view.focus / (length(forward) || 1)));
    const [x, y] = project(matrices.viewProjection, focusPoint);
    read.af.style.transform = 'translate(' + ((x + 1) / 2 * innerWidth).toFixed(1) + 'px,' + ((1 - y) / 2 * innerHeight).toFixed(1) + 'px)';
    for (const link of document.querySelectorAll('[data-index]')) {
      if (link.dataset.index === active) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current');
    }
  }

  // ---- Frame loop -----------------------------------------------------------------------------
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, tier >= 4 ? 1.75 : 2);
    viewWidth = Math.max(1, Math.round(canvas.clientWidth * dpr));
    viewHeight = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = viewWidth;
    canvas.height = viewHeight;
    post.resize(viewWidth, viewHeight);
    // Photo gains depend on how many screen pixels the frame covers.
    for (const photo of developPhotos) {
      const cached = cache.get('photo:' + photo.id + '@' + count());
      if (cached) cached.then(set => { set.gain = photoGain(set, photo); }).catch(() => {});
    }
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let frame = null;
  let snap = 0;
  let last = performance.now();
  let time = 0;
  const timing = { sum: 0, frames: -60, changing: false, ceiling: tiers.length - 1 };
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const queries = [];

  function changeTier(next) {
    tier = next;
    timing.changing = true;
    resize();
    chapters[active].targets().then(set => {
      particles.allocate(set.count, set);
      wanted = null;
      retarget();
    }).catch(error => console.error(error)).finally(() => { timing.changing = false; timing.frames = -60; timing.sum = 0; });
  }

  // Grow toward a million points while the GPU has headroom; shrink when it has none, and never grow back past a tier that failed.
  // GPU time comes from timer queries where the browser offers them; otherwise frame intervals stand in, which also
  // include time a background tab was throttled, so they are only taken while the page is visible.
  function record(ms, gpu) {
    if (timing.changing || ++timing.frames <= 0) return;
    timing.sum += ms;
    if (timing.frames < 90) return;
    const average = timing.sum / timing.frames;
    timing.sum = timing.frames = 0;
    if ((gpu ? average > 11 : average > 30) && tier > 0) { timing.ceiling = tier - 1; changeTier(tier - 1); }
    else if ((gpu ? average < 4.5 : average < 17.5) && tier < timing.ceiling) changeTier(tier + 1);
  }
  function measureGpu(interval) {
    if (!timer) { if (!document.hidden && interval < 250) record(interval, false); return; }
    while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = queries.shift();
      const valid = !gl.getParameter(timer.GPU_DISJOINT_EXT);
      const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
      if (valid) record(ms, true);
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const interval = now - last;
    last = now;
    if (!particles.count) return;
    measureGpu(interval);
    const query = timer && queries.length < 4 ? gl.createQuery() : null;
    if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    const moving = !state.paused && !reduced.matches;
    const dt = Math.min(.05, interval / 1000);
    if (moving) time += dt;
    measure();
    const chapter = chapters[active];
    const desired = chapter.camera(progress, time);
    const view = camera.follow(desired, dt, reduced.matches ? 30 : 3.2);
    frame = camera.matrices(viewWidth, viewHeight);

    // Pointer as a cylinder of force around the ray under the cursor.
    const ray = camera.ray(frame.inverse, pointer.x, pointer.y);
    for (const s of shocks) s.age += moving ? dt : 0;
    while (shocks.length && shocks[0].age > 2.5) shocks.shift();
    const shockData = new Float32Array(16).fill(-1);
    shocks.forEach((s, i) => shockData.set([...s.at, s.age], i * 4));
    const sim = chapter.sim;
    const reach = view.focus * .034;
    particles.step(moving ? dt : 0, {
      uTime: time, uStiffness: sim.stiffness, uDamping: sim.damping, uTurbulence: sim.turbulence, uFlightTurbulence: sim.flight, uNoiseScale: sim.noiseScale,
      uRayOrigin: ray.origin, uRayDir: ray.dir, uRayRadius: Math.max(.08, reach), uRayForce: chapter.pointer && moving && pointer.active ? 34 : 0,
      uShock: shockData, uShockSpeed: 2.4, uShockWidth: .24, uShockForce: 26, uSnap: snap > 0 ? 1 : 0
    });
    if (snap > 0) snap--;

    // Long exposure: the chosen shutter in Ignite, and a short automatic one while particles are in flight so morphs leave light trails.
    const flight = moving ? particles.flight : 0;
    const exposureTime = Math.max(active === 'ignite' && moving ? shutterTime() : 0, flight * .16);
    const decay = exposureTime > 1 / 50 ? Math.exp(-dt / exposureTime) : 0;
    const contourTarget = active === 'develop' && state.mode !== 'photo' ? 1 : 0;
    state.contours += (contourTarget - state.contours) * Math.min(1, dt * 4);
    post.begin();
    particles.draw({
      uView: frame.view, uProjection: frame.projection, uCoc: frame.coc, uFocus: view.focus, uBase: base(), uMaxSize: Math.min(64, 26 * dpr),
      uGain: 1, uDustGain: .8, uTime: time, uNear: .05, uBlades: 9, uRoundness: smoothstep(5.6, 2, view.aperture) * .85, uCatEye: .32 * smoothstep(8, 2, view.aperture),
      uMode: state.mode === 'depth' ? 2 : 1, uContours: state.contours, uContourOrigin: [0, 0, 0],
      uPhoto: atlasPhoto ? photoTexture(atlasPhoto.stop.photo) : blank, uPhotoMatrix: atlasPhoto ? atlasPhoto.at.matrix : frame.viewProjection,
      uPhotoMix: active === 'atlas' && atlasPhoto && particles.morph >= 1 ? atlasPhoto.mix : 0
    });
    showPrint(view);
    post.finish({
      decay, exposure: 1, bloom: .055, halation: .03, grain: .02, tanCorner: frame.tanCorner, aberration: .0035,
      inner: [.0042, .0052, .0068], outer: [.0012, .0014, .002]
    });
    if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); }
    if (Math.round(now / 66) !== Math.round((now - interval) / 66)) readout(view, frame);
  }

  addEventListener('scroll', measure, { passive: true });
  measure();
  introTargets().then(set => {
    particles.allocate(set.count, set, { burst: !reduced.matches });
    retarget();
    requestAnimationFrame(loop);
  }).catch(error => { console.error(error); root.classList.remove('lab-gl'); });
}
