import { createContext, imageTexture, texture, program, use, depthTarget, bindTarget } from './gl.js';
import { Particles, ROW } from './particles.js';
import { Post } from './post.js';
import { Camera, orbit, framingDistance } from './camera.js';
import { clamp, lerp, smoothstep, catmull, project, sub, dot, add, scale, length, normalize, cross, mix3, perspective, lookAt, multiply } from './math.js';
import { dustCount } from './targets.js';
import { sunVertex, sunFragment, lineVertex, lineFragment } from './shaders.js';

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
  // Metric depth for a photograph (tools/phantom-data/depth.mjs): gzip of a JSON header and row-delta uint16 log depths
  // spaced evenly between the header's near and far, in metres.
  async function loadScene(url) {
    const response = await fetch(url);
    const buffer = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const length = new DataView(buffer).getUint32(0, true);
    const { width, height, near, far } = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length)));
    const deltas = new Uint16Array(buffer.slice(4 + length, 4 + length + width * height * 2));
    const values = new Uint16Array(width * height);
    for (let i = 0; i < deltas.length; i++) values[i] = (i % width ? values[i - 1] : i >= width ? values[i - width] : 0) + deltas[i];
    const span = Math.log(far / near) / 65520;
    return { depth: Float32Array.from(values, value => near * Math.exp(value * span)), depthWidth: width, depthHeight: height };
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
  // Built target sets are kept for reuse, the most recent ten only: at a million points each holds about 20 MB, and with
  // eighteen photographs, their atlas placements and the clouds, keeping every one would run to gigabytes.
  function setFor(key, make) {
    const full = key + '@' + count();
    const found = cache.get(full) || make().catch(error => { cache.delete(full); throw error; });
    cache.delete(full);
    cache.set(full, found);
    while (cache.size > 10) cache.delete(cache.keys().next().value);
    return found;
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
  // In Develop a photograph stands in its own camera space at its own scale; at an atlas stop the same points are placed
  // at the solved station, in the stop's scale and orientation, so they line up with the LiDAR around them.
  function photoTargets(photo, placement = null) {
    return setFor('photo:' + photo.id + (placement ? '@' + placement.key : ''), async () => {
      const [image, scene] = await Promise.all([loadImage(photo.url), loadScene(photo.scene)]);
      const points = count() - dustCount(count());
      const side = Math.min(1280, Math.round(Math.sqrt(points * Math.max(photo.width / photo.height, photo.height / photo.width))));
      const sample = pixelsOf(image, side);
      const fit = photoFit(photo);
      const spacing = Math.sqrt(fit.screenArea / Math.min(points, sample.width * sample.height));
      const sizeFlag = Math.max(1, spacing * 1.15 / base());
      const unit = placement ? placement.unit : photo.unit;
      const set = await build('photo', {
        count: count(), ...sample, ...scene, tanX: fit.tanX, tanY: fit.tanY, unit, sizeFlag, frame: placement && placement.frame
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

  // ---- Layout ---------------------------------------------------------------------------------
  const wide = () => viewWidth / viewHeight > 1.15 && innerWidth > 860;
  // Lens shift that keeps the subject clear of the text: right of centre on wide screens, above it on narrow ones.
  const subjectShift = () => wide() ? [.28, 0] : [0, .22];

  // ---- Chapters -------------------------------------------------------------------------------
  const state = {
    shape: config.shapes[0], shutter: 0, focal: null, aperture: null, photo: 0, mode: 'photo', contours: 0,
    dragAzimuth: 0, dragElevation: 0, paused: false, ev: 0, sun: 0, cursor: 's'
  };
  // Each photograph keeps its own metric scale. The subject sits at least 6 scene units out, and the nearest content at least
  // .3, clear of the lens's near plane; a beach 3 m away under a bridge 1.5 km off needs the second rule.
  // `sway` limits how far the camera steps aside to a fraction of the nearest distance, so near things shift, not fly.
  const developPhotos = config.develop.map(photo => {
    const unit = Math.max(6 / photo.subject, .3 / photo.nearest);
    return { ...photo, unit, pivot: photo.subject * unit, sway: Math.min(1, .15 * photo.nearest / (.11 * photo.subject)) };
  });

  function rail(keys, p) {
    const n = keys.length - 1;
    const x = clamp(p, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(x));
    const t = smoothstep(0, 1, x - i);
    const at = k => keys[clamp(k, 0, n)];
    return catmull(at(i - 1), at(i), at(i + 1), at(i + 2), t);
  }

  // Sculpt's camera keys: azimuth, elevation, focal length, f-number.
  const SCULPT_KEYS = [[0, .02, 50, 4], [.62, .14, 35, 2.8], [1.15, .22, 135, 2.8], [2.2, -.1, 85, 2], [3.0, .08, 70, 2.8], [Math.PI * 2 - .2, .04, 50, 4]];
  const chapters = {
    intro: {
      steps: () => [],
      pace: .5,
      targets: introTargets,
      sim: { stiffness: 6, damping: .9, turbulence: .1, flight: 2.2, noiseScale: .35 },
      pointer: true,
      camera(p, time) {
        const distance = 8.6 - p * 1.4;
        const pos = orbit([0, 0, 0], Math.sin(time * .05) * .12, .1 + Math.sin(time * .037) * .03, distance);
        return { pos, look: [0, 0, 0], focal: 35, aperture: 1.6, focus: distance - .2, shift: [0, wide() ? .02 : .08], metersPerUnit: .5 };
      }
    },
    ignite: {
      steps: () => [.3, .75],
      pace: .4,
      targets: () => markTargets(state.shape, false),
      sim: { stiffness: 14, damping: .8, turbulence: 0, flight: 3, noiseScale: .55 },
      pointer: true,
      camera(p, time) {
        const still = state.shutter > 20 ? 0 : 1;
        const distance = 8.2 - p * .6;
        const pos = [Math.sin(time * .13) * .04 * still, Math.sin(time * .1) * .02 * still, distance];
        return { pos, look: [pos[0] * .5, pos[1] * .5, 0], focal: 50, aperture: 4, focus: distance, shift: subjectShift(), metersPerUnit: .5 };
      }
    },
    sculpt: {
      // One resting step per camera key, each in focus; the moves between them carry the depth of field.
      steps: () => SCULPT_KEYS.map((_, k) => (k + .5) / SCULPT_KEYS.length),
      pace: .12,
      targets: () => markTargets(state.shape, true),
      sim: { stiffness: 16, damping: .85, turbulence: 0, flight: 3, noiseScale: .5 },
      pointer: true,
      drag: true,
      camera(p, time) {
        const keys = SCULPT_KEYS.length;
        const [azimuth, elevation, railFocal, railAperture] = rail(SCULPT_KEYS, clamp((p * keys - .5) / (keys - 1), 0, 1));
        const focal = state.focal || railFocal;
        const aperture = state.aperture || railAperture;
        const distance = framingDistance(wide() ? 4.4 : 4.9, focal);
        const look = [0, 0, 0];
        const pos = orbit(look, azimuth + state.dragAzimuth + Math.sin(time * .1) * .008, clamp(elevation + state.dragElevation, -.9, 1.2), distance);
        return { pos, look, focal, aperture, focus: Math.max(.5, distance), shift: subjectShift(), metersPerUnit: .6 };
      }
    },
    develop: {
      steps: () => [.15, .5, .85],
      pace: .3,
      targets: () => photoTargets(developPhotos[state.photo]),
      sim: { stiffness: 18, damping: .9, turbulence: 0, flight: 2.4, noiseScale: .3 },
      pointer: false,
      drag: true,
      camera(p) {
        const photo = developPhotos[state.photo];
        const fit = photoFit(photo);
        const pivot = [0, 0, -photo.pivot];
        // At the start the camera stands exactly where the photograph was taken; then it steps aside, around the subject.
        const away = smoothstep(.12, .7, p);
        const azimuth = (Math.sin(p * Math.PI * 1.5) * .11 * away + state.dragAzimuth) * photo.sway;
        const elevation = (.045 * away + state.dragElevation) * photo.sway;
        const pos = orbit(pivot, azimuth, elevation, photo.pivot * (1 - away * .067 * photo.sway));
        // The same entrance pupil as the real lens (f-number scaled with focal length), focused where it was: the blur
        // in the scene matches the blur in the print, and changes the same way as the camera moves.
        const aperture = clamp(photo.aperture * fit.focal / photo.focal, 1.2, 32);
        return { pos, look: pivot, focal: fit.focal, aperture, focus: length(sub(pos, pivot)), shift: subjectShift(), metersPerUnit: 1 / photo.unit };
      }
    },
    atlas: {
      // Per stop: arrived (globe, overview); or the light at the moment, the photograph set in place, and the print.
      steps: () => stops.flatMap((stop, i) => (!stop.vantage ? [.82] : sceneOf(stop) ? [.44, .74, .94] : [.6, .93]).map(t => (i + t) / stops.length)),
      pace: .035,
      phase: p => stopAt(p).id + (developed(stopAt(p), stopProgress(p)) ? ':photo' : ''),
      targets: (p = shown.p) => {
        const stop = stopAt(p);
        if (developed(stop, stopProgress(p))) return placedPhotoTargets(stop);
        return stop.cloud ? cityTargets(stop) : globeTargets();
      },
      sim: { stiffness: 10, damping: .9, turbulence: 0, flight: 2.6, noiseScale: .3 },
      pointer: false,
      drag: true,
      camera(p, time) { return atlasCamera(stopAt(p), stopProgress(p), time); }
    }
  };

  // ---- Atlas: globes, then each site's LiDAR clouds; a stop's scale is how many metres one scene unit spans -------
  const atlas = config.atlas;
  const stops = atlas.stops;
  const siteOf = id => config.sites.find(item => item.id === id);
  const home = siteOf(stops.find(stop => stop.kind === 'globe')?.site) || config.sites[0];
  const GLOBE = 1.6;
  const rad = Math.PI / 180;
  const stopAt = p => stops[Math.min(stops.length - 1, Math.floor(clamp(p, 0, .9999) * stops.length))];
  const stopProgress = p => clamp(p * stops.length - stops.indexOf(stopAt(p)), 0, 1);
  const metersOf = stop => stop.scale || 100;
  const atlasSection = $('#atlas');
  atlasSection.style.minHeight = stops.length * 90 + 'vh';
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
  // Stops on the same cloud at the same scale share one set, so the camera flies between them without a morph.
  function cityTargets(stop) {
    return setFor('city:' + stop.cloud + ':' + metersOf(stop), async () => {
      if (!clouds.has(stop.cloud)) clouds.set(stop.cloud, inflate(atlas.clouds[stop.cloud]));
      const data = (await clouds.get(stop.cloud)).slice(0);
      const set = await build('city', { count: count(), data, centre: atlas.frames.clouds[stop.cloud].center, metersPerUnit: metersOf(stop), terrain: atlas.terrain?.[stop.cloud] || 1 }, [data]);
      set.gain = markGain(set.count) * 2.6;
      return set;
    });
  }
  // East-north-up metres around the site origin -> this stop's scene units (x east, y up, z south).
  function world(stop, [east, north, up]) {
    const centre = atlas.frames.clouds[stop.cloud].center, u = 1 / metersOf(stop);
    return [(east - centre[0]) * u, up * u, -(north - centre[1]) * u];
  }
  const enu = (stop, [x, y, z]) => {
    const centre = atlas.frames.clouds[stop.cloud].center, m = metersOf(stop);
    return [x * m + centre[0], -z * m + centre[1], y * m];
  };
  const photoTextures = new Map();
  const blank = texture(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array(4) });
  function photoTexture(photo) {
    if (!photoTextures.has(photo.id)) {
      photoTextures.set(photo.id, null);
      loadImage(photo.url).then(image => photoTextures.set(photo.id, imageTexture(gl, image))).catch(() => {});
    }
    return photoTextures.get(photo.id) || blank;
  }
  // Where the stop's photograph was taken, in scene units, with the matrix that projects it. A stop that shows a strip
  // of prints instead of one photograph is framed like a 35 mm view.
  function station(stop) {
    const solved = atlas.frames.stops[stop.id];
    if (!solved) return null;
    const pos = world(stop, solved.camera), look = world(stop, solved.look);
    const fit = photoFit(stop.photo || { width: 3, height: 2, focal: 35 });
    const matrix = multiply(perspective(2 * Math.atan(fit.tanY), fit.tanX / fit.tanY, .01, 4000), lookAt(pos, look));
    return { pos, look, fit, matrix };
  }
  // Stops whose photograph has a depth model (Develop) can become that photograph, set at the station.
  const sceneOf = stop => stop.photo && developPhotos.find(item => item.id === stop.photo.id);
  const developed = (stop, t) => Boolean(sceneOf(stop)) && atlas.frames.stops[stop.id] && t >= .6;
  function placedPhotoTargets(stop) {
    const at = station(stop);
    const forward = normalize(sub(at.look, at.pos)), right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward);
    return photoTargets(sceneOf(stop), { key: stop.id, unit: 1 / metersOf(stop), frame: { pos: at.pos, right, up, forward } });
  }
  // ---- The sun at the moment of exposure ----------------------------------------------------------------------
  // NOAA's solar position (a few hundredths of a degree), with refraction, which holds the sun on the horizon while it is
  // truly just below it (Saemundsson).
  function sunAt(ms, lat, lon) {
    const jd = ms / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * .0003032)) % 360, M = 357.52911 + T * (35999.05029 - .0001537 * T);
    const e = .016708634 - T * (.000042037 + .0000001267 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (.004817 + .000014 * T)) + Math.sin(2 * M * rad) * (.019993 - .000101 * T) + Math.sin(3 * M * rad) * .000289;
    const omega = 125.04 - 1934.136 * T, lambda = L0 + C - .00569 - .00478 * Math.sin(omega * rad);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (.00059 - T * .001813))) / 60) / 60 + .00256 * Math.cos(omega * rad);
    const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)), y = Math.tan(eps * rad / 2) ** 2;
    const eqTime = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - .5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
    const date = new Date(ms), minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const ha = (((minutes + eqTime + 4 * lon) / 4 - 180) % 360 + 540) % 360 - 180;
    const zen = Math.acos(clamp(Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha * rad), -1, 1));
    const azimuth = Math.acos(clamp((Math.sin(lat * rad) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(lat * rad) * Math.sin(zen)), -1, 1)) / rad;
    const altitude = 90 - zen / rad;
    const refraction = altitude > -1 ? 1.02 / Math.tan((altitude + 10.3 / (altitude + 5.11)) * rad) / 60 : 0;
    return { azimuth: ha > 0 ? (azimuth + 180) % 360 : (540 - azimuth) % 360, altitude: altitude + refraction };
  }
  // A direction in the scene (x east, y up, z south) from azimuth and altitude in degrees.
  const skyward = (azimuth, altitude) => [Math.sin(azimuth * rad) * Math.cos(altitude * rad), Math.sin(altitude * rad), -Math.cos(azimuth * rad) * Math.cos(altitude * rad)];
  const ortho = (l, r, b, t, n, f) => new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  const SHADOW = 2048;
  const shadowMap = depthTarget(gl, SHADOW);
  const sunProgram = program(gl, sunVertex, sunFragment);
  let sunNow = null;
  const lineProgram = program(gl, lineVertex, lineFragment);
  const lineBuffer = gl.createBuffer(), lineArray = gl.createVertexArray();
  gl.bindVertexArray(lineArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, 16 * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  // The photograph's camera as a frustum: from the station to its frame at a distance scaled to how far away we stand.
  function drawStation(view, viewProjection) {
    if (active !== 'atlas' || !atlasPhoto || !atlasPhoto.stop.vantage) return;
    const { at } = atlasPhoto, away = length(sub(view.pos, at.pos)), reach = length(sub(at.look, at.pos));
    const fade = smoothstep(.02, .12, away / reach);
    if (fade <= 0) return;
    const forward = normalize(sub(at.look, at.pos)), right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const depth = Math.min(reach * .5, away * .12), w = at.fit.tanX * depth, h = at.fit.tanY * depth;
    const corner = (sx, sy) => add(at.pos, add(scale(forward, depth), add(scale(right, sx * w), scale(up, sy * h))));
    const c = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const segments = [at.pos, c[0], at.pos, c[1], at.pos, c[2], at.pos, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]];
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(segments.flat()));
    use(lineProgram, { uViewProjection: viewProjection, uColor: [3.2, 2.5, 1.4].map(v => v * fade) });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(lineArray);
    gl.drawArrays(gl.LINES, 0, 16);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
  // A small north-up map: the photograph's station and view cone (gold), the current view (white), the subject between.
  const minimap = $('#lab-minimap'), mini = minimap.getContext('2d');
  function drawMinimap(view) {
    const on = active === 'atlas' && atlasPhoto && atlasPhoto.stop.vantage;
    minimap.classList.toggle('is-shown', Boolean(on));
    if (!on) return;
    const size = minimap.width, ratio = size / minimap.clientWidth || 1, { at, stop } = atlasPhoto;
    const points = [at.pos, at.look, view.pos];
    const xs = points.map(p => p[0]), zs = points.map(p => p[2]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), .05) * 1.35;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2, k = size / span;
    const map = p => [size / 2 + (p[0] - cx) * k, size / 2 + (p[2] - cz) * k];
    mini.clearRect(0, 0, size, size);
    const cone = (from, toward, half, colour) => {
      const [x, y] = map(from), heading = Math.atan2(toward[0] - from[0], toward[2] - from[2]), r = size * .22;
      mini.fillStyle = colour;
      mini.beginPath(); mini.moveTo(x, y);
      mini.arc(x, y, r, Math.PI / 2 - heading - half, Math.PI / 2 - heading + half);
      mini.closePath(); mini.fill();
    };
    cone(at.pos, at.look, Math.atan(at.fit.tanX), 'rgba(201, 175, 119, .32)');
    cone(view.pos, view.look, Math.atan(18 / view.focal), 'rgba(238, 233, 223, .16)');
    const dot = (p, r, colour) => { const [x, y] = map(p); mini.fillStyle = colour; mini.beginPath(); mini.arc(x, y, r * ratio, 0, Math.PI * 2); mini.fill(); };
    dot(at.look, 2.2, 'rgba(238, 233, 223, .6)');
    dot(at.pos, 3.2, '#c9af77');
    dot(view.pos, 2.6, '#eee9df');
    // North arrow and a scale bar in metres.
    mini.fillStyle = 'rgba(163, 171, 177, .9)';
    mini.font = (10 * ratio) + 'px ui-monospace, Menlo, Consolas, monospace';
    mini.fillText('N ↑', 6 * ratio, 14 * ratio);
    const metres = span * view.metersPerUnit / 4, nice = [1, 2, 5].flatMap(m => [m, m * 10, m * 100, m * 1000]).sort((a, b) => a - b).reduce((best, v) => v <= metres ? v : best, 1);
    const bar = nice / view.metersPerUnit * k;
    mini.fillRect(6 * ratio, size - 10 * ratio, bar, 1.5 * ratio);
    mini.fillText(nice >= 1000 ? nice / 1000 + ' km' : nice + ' m', 6 * ratio, size - 14 * ratio);
  }

  // The globe turns so a site faces the camera: its longitude relative to the globe's centre, its latitude as elevation.
  const facing = site => [(site.lon - home.lon) * rad, site.lat * rad];
  let atlasPhoto = null;
  function atlasCamera(stop, t, time) {
    const { view, photo } = stopView(stop, t, time);
    atlasPhoto = photo;
    return view;
  }
  function stopView(stop, t, time) {
    const shift = subjectShift(), index = stops.indexOf(stop);
    if (stop.kind === 'globe') {
      const [azimuth, elevation] = facing(siteOf(stop.site) || home);
      // The first globe swings in from space; a later one carries the camera from the previous site to this one.
      const before = stops.slice(0, index).reverse().find(item => item.site && item.site !== stop.site);
      const k = smoothstep(0, .85, t);
      const [fromAzimuth, fromElevation] = before ? facing(siteOf(before.site)) : [azimuth - 1.2, .12];
      const distance = before ? 5.4 + Math.sin(Math.PI * k) * 2.6 : lerp(8.6, 5.4, smoothstep(0, 1, t));
      const pos = orbit([0, 0, 0], lerp(fromAzimuth, azimuth, k) + Math.sin(time * .05) * .04 + state.dragAzimuth, lerp(fromElevation, elevation, k) + state.dragElevation, distance);
      return { view: { pos, look: [0, 0, 0], focal: 50, aperture: 4, focus: distance - GLOBE, shift, metersPerUnit: 6371000 / GLOBE }, photo: null };
    }
    const m = metersOf(stop);
    if (stop.kind === 'overview') {
      // Drift over the site toward the next stop's subject; the orbit is azimuth, elevation and distance in metres.
      const k = smoothstep(0, 1, t);
      const next = stops[index + 1];
      const start = stop.look ? world(stop, stop.look) : [0, 0, -.6];
      const target = next && atlas.frames.stops[next.id] ? world(stop, atlas.frames.stops[next.id].look) : start;
      const look = mix3(start, [lerp(start[0], target[0], .6), start[1], lerp(start[2], target[2], .6)], k);
      const path = stop.orbit || { from: [-.35, .62, 10250], to: [-.9, .42, 6500] };
      const pos = add(look, orbit([0, 0, 0], lerp(path.from[0], path.to[0], k) + state.dragAzimuth, lerp(path.from[1], path.to[1], k) + state.dragElevation, lerp(path.from[2], path.to[2], k) / m));
      // The light of the next photograph, two hours before it was taken; that stop then runs it on to the exposure.
      const sun = next && next.light ? { ...next.light, when: Date.parse(next.light.when) - 7200000, strength: smoothstep(0, .3, t) } : null;
      return { view: { pos, look, focal: lerp(35, 45, k), aperture: 5.6, focus: length(sub(pos, look)), shift, metersPerUnit: m, sun }, photo: null };
    }
    const at = station(stop);
    if (!at) return { view: { pos: [0, 3, 6], look: [0, 0, 0], focal: 35, aperture: 5.6, focus: 6.7, shift, metersPerUnit: m }, photo: null };
    // Arrive at the station from an orbit of the subject, from above, down through the street (for what LiDAR cannot see),
    // or straight on from the previous stop's camera, then settle exactly where the photograph was taken.
    // With a depth model the stop goes one step further: once the camera has arrived and the photograph has been projected
    // onto the LiDAR, the cloud condenses into the photograph's own points, placed in the world, before the print.
    const own = sceneOf(stop);
    const k = smoothstep(.08, own ? .5 : .62, t);
    const previous = stop.approach === 'previous' && stops[index - 1]?.cloud ? stopView(stops[index - 1], 1, time).view : null;
    let pos, look, focal = Math.exp(lerp(Math.log(35), Math.log(at.fit.focal), k)), aperture = 8, ev = lerp(0, stop.exposure || 0, k);
    if (previous) {
      const before = stops[index - 1];
      const from = p => before.cloud === stop.cloud && metersOf(before) === m ? p : world(stop, enu(before, p));
      const p0 = from(previous.pos), l0 = from(previous.look);
      // A long hop rises in an arc, like a drone crossing the strait, instead of skimming the terrain.
      pos = add(mix3(p0, at.pos, k), [0, Math.sin(Math.PI * k) * (stop.arc || 0) / m, 0]);
      const reach = Math.exp(lerp(Math.log(length(sub(l0, p0))), Math.log(length(sub(at.look, at.pos))), k));
      look = add(pos, scale(normalize(mix3(normalize(sub(l0, p0)), normalize(sub(at.look, at.pos)), k)), reach));
      focal = Math.exp(lerp(Math.log(previous.focal), Math.log(at.fit.focal), k));
      aperture = lerp(previous.aperture, 8, k);
      ev = lerp(previous.ev || 0, stop.exposure || 0, k);
    } else {
      const [start, startLook] = stop.approach === 'orbit'
        ? [add(at.look, orbit([0, 0, 0], 2.3 + t * 1.6 + state.dragAzimuth, .32 + state.dragElevation, 2.4)), at.look]
        : stop.approach === 'below'
          ? [add(at.pos, [0, 2.4 - t * .6, 1.4]), add(at.pos, [0, 0, -.3])]
          : [add(at.pos, [0, 3.4 - t, 2.2]), mix3(at.pos, at.look, .04)];
      pos = mix3(start, at.pos, k);
      look = mix3(startLook, at.look, k);
    }
    // Dragging turns the view around what the photograph looks at, to show where it was taken; the next step brings it back.
    if (state.dragAzimuth || state.dragElevation) {
      const offset = sub(pos, look), r = length(offset);
      const azimuth = Math.atan2(offset[0], offset[2]) + state.dragAzimuth;
      const elevation = clamp(Math.asin(clamp(offset[1] / r, -1, 1)) + state.dragElevation, -.15, 1.35);
      pos = add(look, orbit([0, 0, 0], azimuth, elevation, r));
    }
    let mix = stop.project === false ? 0 : smoothstep(.58, .76, t), print = t > .8;
    if (own) {
      const settle = smoothstep(.58, .66, t);
      mix = stop.project === false ? 0 : smoothstep(.44, .56, t) * (1 - settle);
      ev *= 1 - settle;
      // The real lens's entrance pupil, as in Develop, so the condensed photograph carries the photograph's own blur.
      aperture = lerp(aperture, clamp(own.aperture * at.fit.focal / own.focal, 1.2, 32), settle);
      print = t > .86;
    }
    const photo = { stop, at, mix, print };
    // The sun runs from two hours before the exposure to the exposure itself as the camera arrives, then gives way to the
    // photograph, which carries the real light.
    const sun = stop.light ? { ...stop.light, when: Date.parse(stop.light.when) - 7200000 * (1 - smoothstep(.05, own ? .48 : .55, t)), strength: 1 - smoothstep(own ? .44 : .56, own ? .56 : .7, t) } : null;
    return { view: { pos, look, focal, aperture, focus: Math.max(.2, length(sub(look, pos))), shift, metersPerUnit: m, ev, sun }, photo };
  }

  // Prints fade in over the scene once the camera has settled: one photograph exactly over its projection, or a strip.
  const prints = $('#lab-prints');
  const printImages = new Map();
  function printOf(photo) {
    if (!printImages.has(photo.id)) {
      const image = document.createElement('img');
      Object.assign(image, { alt: '', decoding: 'async', className: 'lab-print', width: photo.width, height: photo.height, src: photo.url });
      prints.append(image);
      printImages.set(photo.id, image);
    }
    return printImages.get(photo.id);
  }
  const place = (image, x, y, w, h, delay) => {
    Object.assign(image.style, { width: w.toFixed(1) + 'px', height: h.toFixed(1) + 'px', transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)', transitionDelay: delay + 's' });
  };
  function showPrint(view) {
    const visible = new Set();
    const settled = active === 'atlas' && atlasPhoto && atlasPhoto.print && length(sub(view.pos, atlasPhoto.at.pos)) < .02;
    if (settled) {
      const { stop, at } = atlasPhoto;
      const cx = (.5 + view.shift[0] / 2) * innerWidth, cy = (.5 - view.shift[1] / 2) * innerHeight;
      if (stop.photo) {
        const w = at.fit.tanX / at.fit.viewTanX * innerWidth, h = at.fit.tanY / at.fit.viewTanY * innerHeight;
        place(printOf(stop.photo), cx - w / 2, cy - h / 2, w, h, 0);
        visible.add(stop.photo.id);
      } else if (stop.photos) {
        // Side by side beside the text on wide screens, stacked above it on narrow ones.
        const row = wide(), gap = Math.min(innerWidth, innerHeight) * .025, n = stop.photos.length;
        const [roomW, roomH] = row ? [innerWidth * .56, innerHeight * .46] : [innerWidth * .9, innerHeight * .54];
        const aspects = stop.photos.map(photo => photo.width / photo.height);
        const h = row ? Math.min(roomH, (roomW - gap * (n - 1)) / aspects.reduce((s, a) => s + a, 0)) : Math.min((roomH - gap * (n - 1)) / n, roomW / Math.max(...aspects));
        let x = cx - (row ? aspects.reduce((s, a) => s + a * h, 0) + gap * (n - 1) : 0) / 2, y = cy - (row ? h : n * h + gap * (n - 1)) / 2;
        stop.photos.forEach((photo, i) => {
          const w = aspects[i] * h;
          place(printOf(photo), row ? x : cx - w / 2, y, w, h, i * .18);
          if (row) x += w + gap; else y += h + gap;
          visible.add(photo.id);
        });
      }
    }
    for (const [id, image] of printImages) image.classList.toggle('is-shown', visible.has(id));
    const current = active === 'atlas' ? stopAt(shown.p) : null;
    for (const item of document.querySelectorAll('[data-stop]')) item.classList.toggle('is-current', item.dataset.stop === current?.id);
    for (const item of document.querySelectorAll('[data-site]')) item.classList.toggle('is-current', item.dataset.site === current?.site);
    atlasSection.classList.toggle('is-travelling', stops.indexOf(current) > 0);
  }
  const order = ['intro', 'ignite', 'sculpt', 'develop', 'atlas'];
  const sections = order.map(id => ({ id, element: document.querySelector('[data-chapter="' + id + '"]') }));
  const developSection = $('#develop');
  let active = 'intro';
  let activePhase = '';
  let progress = 0;
  // Where the view is on its way to: the scroll sets `progress`, the view follows at the chapter's pace.
  const shown = { p: 0 };
  let wanted = null;

  function measure() {
    const middle = innerHeight * .5;
    let found = sections[0], found_p = 0;
    for (const section of sections) {
      const rect = section.element.getBoundingClientRect();
      if (rect.top <= middle) { found = section; found_p = clamp((middle - rect.top) / rect.height, 0, 1); }
    }
    progress = found_p;
    developSection.classList.toggle('is-travelling', found.id === 'develop' && progress > .06);
    if (found.id !== active) {
      state.dragAzimuth = state.dragElevation = 0;
      active = found.id;
      shown.p = progress;
      activePhase = chapters[active].phase ? chapters[active].phase(shown.p) : '';
      retarget();
    }
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
    const following = active === 'atlas' && stops[stops.indexOf(stopAt(shown.p)) + 1];
    if (following) (following.cloud ? cityTargets(following) : globeTargets()).catch(() => {});
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
    if (pointer.down && !pointer.moved && chapters[active].pointer && !reduced.matches && !state.paused && state.cursor !== 'off') shock();
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
  const photoLabel = $('#lab-photo-label'), depthNote = $('#lab-depth-note');
  const showPhoto = () => {
    const photo = developPhotos[state.photo];
    photoLabel.textContent = 'Frame ' + photo.frame + ' · ' + photo.place;
    depthNote.textContent = photo.note;
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
  // Cursor size, shared by both chapters' controls and remembered in this browser.
  try { state.cursor = ['off', 's', 'm', 'l'].includes(localStorage.getItem('lab-cursor')) ? localStorage.getItem('lab-cursor') : 's'; } catch {}
  const syncCursor = () => { for (const button of document.querySelectorAll('[data-cursor]')) button.setAttribute('aria-pressed', String(button.dataset.cursor === state.cursor)); };
  for (const button of document.querySelectorAll('[data-cursor]')) {
    button.addEventListener('click', () => { state.cursor = button.dataset.cursor; syncCursor(); try { localStorage.setItem('lab-cursor', state.cursor); } catch {} });
  }
  syncCursor();
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
    shutter: $('#lab-read-shutter'), focus: $('#lab-read-focus'), count: $('#lab-read-count'), af: $('#lab-af'), sun: $('#lab-read-sun')
  };
  const labels = { intro: 'Lab', ignite: '00 Ignite', sculpt: '01 Sculpt', develop: '02 Develop', atlas: '03 Atlas' };
  function readout(view, matrices) {
    read.chapter.textContent = labels[active];
    // The sun's bearing and height, and the local time the light is shown at (the exposure itself once the camera arrives).
    if (sunNow) {
      const [, sign, hh, mm] = sunNow.light.utcOffset.match(/^([+-])(\d\d):(\d\d)$/), offset = (sign === '-' ? -1 : 1) * (+hh * 60 + +mm);
      const local = new Date(sunNow.light.when + offset * 60000).toISOString().slice(11, 16);
      read.sun.textContent = 'Sun ' + Math.round(sunNow.azimuth) + '° ' + (sunNow.altitude >= 0 ? '▲' : '▼') + Math.abs(sunNow.altitude).toFixed(1) + '° · ' + local + ' UTC' + (sign === '-' ? '−' : '+') + Number(hh) + (+mm ? ':' + mm : '');
    } else read.sun.textContent = '';
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
    // One resolution at every tier: a change of particle count must not also change the picture's sharpness.
    dpr = Math.min(devicePixelRatio || 1, 2);
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
      particles.allocate(set.count, set, { carry: true });
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
    // Growing waits until the opening burst has landed and nothing is mid-morph, so it never interrupts a transition.
    else if ((gpu ? average < 4.5 : average < 17.5) && tier < timing.ceiling && time > 6 && particles.morph >= 1 && particles.flight < .05) changeTier(tier + 1);
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
    // Toward the scrolled-to step at the chapter's pace (faster across long jumps), so every move plays out and then rests.
    const gap = progress - shown.p, pace = chapter.pace || .3;
    shown.p = reduced.matches ? progress : shown.p + Math.sign(gap) * Math.min(Math.abs(gap), Math.max(pace, Math.abs(gap) * 1.5) * dt);
    if (chapter.phase) {
      const phase = chapter.phase(shown.p);
      if (phase !== activePhase) {
        activePhase = phase;
        if (active === 'atlas') state.dragAzimuth = state.dragElevation = 0;
        retarget();
      }
    }
    const desired = chapter.camera(shown.p, time);
    const view = camera.follow(desired, dt, reduced.matches ? 30 : 3.2);
    // Exposure compensation: a close view of a sparse cloud spreads few points over the frame, so it is opened up, like a lens.
    state.ev += ((desired.ev || 0) - state.ev) * Math.min(1, dt * (reduced.matches ? 30 : 3.2));
    frame = camera.matrices(viewWidth, viewHeight);

    // Pointer as a cylinder of force around the ray under the cursor.
    const ray = camera.ray(frame.inverse, pointer.x, pointer.y);
    for (const s of shocks) s.age += moving ? dt : 0;
    while (shocks.length && shocks[0].age > 2.5) shocks.shift();
    const shockData = new Float32Array(16).fill(-1);
    shocks.forEach((s, i) => shockData.set([...s.at, s.age], i * 4));
    const sim = chapter.sim;
    // The pointer's reach: small by default, chosen in Ignite and Sculpt, and gentler on the sculpted relief.
    const cursorScale = { off: 0, s: .4, m: 1, l: 1.8 }[state.cursor] * (active === 'sculpt' ? .6 : 1);
    const reach = view.focus * .034 * cursorScale;
    particles.step(moving ? dt : 0, {
      uTime: time, uStiffness: sim.stiffness, uDamping: sim.damping, uTurbulence: sim.turbulence, uFlightTurbulence: sim.flight, uNoiseScale: sim.noiseScale,
      uRayOrigin: ray.origin, uRayDir: ray.dir, uRayRadius: Math.max(.03, reach), uRayForce: chapter.pointer && moving && pointer.active && cursorScale > 0 ? 34 : 0,
      uShock: shockData, uShockSpeed: 2.4, uShockWidth: .24, uShockForce: 26, uSnap: snap > 0 ? 1 : 0
    });
    if (snap > 0) snap--;

    // Long exposure: the chosen shutter in Ignite, and a short automatic one while particles are in flight so morphs leave light trails.
    const flight = moving ? particles.flight : 0;
    const exposureTime = Math.max(active === 'ignite' && moving ? shutterTime() : 0, flight * .05);
    const decay = exposureTime > 1 / 50 ? Math.exp(-dt / exposureTime) : 0;
    const contourTarget = active === 'develop' && state.mode !== 'photo' ? 1 : 0;
    state.contours += (contourTarget - state.contours) * Math.min(1, dt * 4);
    // The sun of the stop's photograph: its depth map over the cloud, then its light in the points and its disc in the sky.
    const light = active === 'atlas' ? desired.sun : null;
    const sun = light ? sunAt(light.when, light.where[0], light.where[1]) : null;
    state.sun += ((light ? light.strength * smoothstep(-.8, 1.2, sun.altitude) : 0) - state.sun) * Math.min(1, dt * (reduced.matches ? 30 : 3));
    sunNow = light && { ...sun, light };
    const bounds = particles.toSet && particles.toSet.bounds;
    let sunlight = { uSun: 0, uShadow: shadowMap.texture };
    if (sun && state.sun > .01 && bounds) {
      // A sun on the horizon would graze the map edge-on; half a degree up keeps it readable and the shadows still run long.
      const dir = skyward(sun.azimuth, clamp(sun.altitude, .5, 85)), r = bounds.radius;
      const sunMatrix = multiply(ortho(-r, r, -r, r, r * .5, r * 3.5), lookAt(add(bounds.center, scale(dir, 2 * r)), bounds.center));
      bindTarget(gl, shadowMap);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      particles.shadow({ uSunMatrix: sunMatrix, uSplat: clamp(1.8 * bounds.spacing * SHADOW / (2 * r), 2, 12) });
      gl.disable(gl.DEPTH_TEST);
      const warm = smoothstep(0, 20, sun.altitude);
      sunlight = { uSun: state.sun, uShadow: shadowMap.texture, uSunMatrix: sunMatrix, uSunColor: [1.25, lerp(.62, .95, warm), lerp(.3, .82, warm)], uShadowBias: 1.5 * bounds.spacing / (3 * r) };
    }
    post.begin();
    particles.draw({
      ...sunlight,
      uView: frame.view, uProjection: frame.projection, uCoc: frame.coc, uFocus: view.focus, uBase: base(), uMaxSize: Math.min(64, 26 * dpr),
      uGain: 2 ** state.ev, uDustGain: .8 / 2 ** state.ev, uTime: time, uNear: Math.min(.05, .3 / view.metersPerUnit), uBlades: 9, uRoundness: smoothstep(5.6, 2, view.aperture) * .85, uCatEye: .32 * smoothstep(8, 2, view.aperture),
      uMode: state.mode === 'depth' ? 2 : 1, uContours: state.contours, uContourOrigin: [0, 0, 0], uContourUnit: view.metersPerUnit,
      uPhoto: atlasPhoto && atlasPhoto.stop.photo ? photoTexture(atlasPhoto.stop.photo) : blank, uPhotoMatrix: atlasPhoto ? atlasPhoto.at.matrix : frame.viewProjection,
      uPhotoMix: active === 'atlas' && atlasPhoto && atlasPhoto.stop.photo && particles.morph >= 1 ? atlasPhoto.mix : 0
    });
    if (sun && state.sun > .01 && sun.altitude > -1) {
      // Half a degree across, drawn far out along its true direction; the bloom does the rest.
      const across = .0093 * frame.projection[5] * viewHeight / 2, size = clamp(across * 9, 10, 256), warm = smoothstep(0, 20, sun.altitude);
      use(sunProgram, { uViewProjection: frame.viewProjection, uEye: view.pos, uDir: skyward(sun.azimuth, sun.altitude), uDistance: 2000, uSize: size, uDisc: across / size,
        uColor: [1, lerp(.55, .93, warm), lerp(.25, .8, warm)].map(c => c * state.sun * lerp(.35, 1, smoothstep(0, 8, sun.altitude))) });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, 1);
      gl.disable(gl.BLEND);
    }
    drawStation(view, frame.viewProjection);
    drawMinimap(view);
    showPrint(view);
    post.finish({
      decay, exposure: 1, bloom: .055, halation: .03, grain: .02, tanCorner: frame.tanCorner, aberration: .0035,
      inner: [.0042, .0052, .0068], outer: [.0012, .0014, .002]
    });
    if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); }
    if (Math.round(now / 66) !== Math.round((now - interval) / 66)) readout(view, frame);
  }

  for (const { id, element } of sections) {
    for (const p of chapters[id].steps()) {
      const mark = document.createElement('i');
      mark.className = 'lab-snap';
      mark.setAttribute('aria-hidden', 'true');
      mark.style.top = (p * 100).toFixed(3) + '%';
      element.append(mark);
    }
  }
  // One wheel gesture or key press, one step. The wheel is read as intent (accumulated past a small threshold) and the page
  // glides to the next resting step; a short lock keeps a trackpad's long tail of small deltas from skipping steps.
  // Touch keeps the browser's own snapping, which already moves a swipe to the next point.
  const restingTops = () => {
    const tops = [0, document.documentElement.scrollHeight - innerHeight];
    for (const mark of document.querySelectorAll('.lab-snap')) tops.push(mark.getBoundingClientRect().top + scrollY - innerHeight / 2);
    return tops.map(Math.round).sort((a, b) => a - b);
  };
  let wheelAccumulated = 0, wheelLockedUntil = 0;
  const step = direction => {
    const tops = restingTops(), here = scrollY;
    const next = direction > 0 ? tops.find(top => top > here + 4) : [...tops].reverse().find(top => top < here - 4);
    if (next === undefined) return;
    scrollTo({ top: next, behavior: reduced.matches ? 'auto' : 'smooth' });
    wheelLockedUntil = performance.now() + 650;
  };
  addEventListener('wheel', event => {
    if (event.ctrlKey || event.defaultPrevented) return;
    event.preventDefault();
    if (performance.now() < wheelLockedUntil) { wheelAccumulated = 0; return; }
    wheelAccumulated += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (Math.abs(wheelAccumulated) < 30) return;
    step(Math.sign(wheelAccumulated));
    wheelAccumulated = 0;
  }, { passive: false });
  addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('input, select, textarea, button')) return;
    const direction = { ArrowDown: 1, PageDown: 1, ' ': event.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1 }[event.key];
    if (!direction) return;
    event.preventDefault();
    step(direction);
  });
  addEventListener('scroll', measure, { passive: true });
  measure();
  introTargets().then(set => {
    particles.allocate(set.count, set, { burst: !reduced.matches });
    retarget();
    requestAnimationFrame(loop);
  }).catch(error => { console.error(error); root.classList.remove('lab-gl'); });
}
