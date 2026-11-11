import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile, writeFile, mkdir, rm, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { validatePhotos } from './photo-data.mjs';
import { buildEras } from './eras/index.mjs';
import { buildStrata } from './strata/index.mjs';
import { ridgePaths } from './mountain-ridge.mjs';
import { FOV } from '../src/mountain/camera.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const cache = path.join(root, '.cache', 'images');
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const transform = { sharp: sharp.versions.sharp, avif: { quality: 60, effort: 4 }, webp: { quality: 80, effort: 4 }, jpeg: { quality: 86, mozjpeg: true }, autoOrient: true, maxWidth: 1920 };
const widths = [320, 480, 640, 960, 1280, 1920];
const transformHash = digest(JSON.stringify(transform));
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// Rendered image widths per layout; they mirror the grid rules and breakpoints in src/styles.css.
const sizes = {
  hero: '(max-width: 760px) calc(100vw - 40px), (max-width: 1080px) calc((100vw - 104px) / 2.05), (max-width: 1432px) calc((100vw - 168px) / 2.05), 616px',
  featured: '(max-width: 760px) calc(100vw - 40px), (max-width: 1080px) calc((100vw - 128px) / 3), (max-width: 1432px) calc((100vw - 168px) / 3), 421px',
  grid: '(max-width: 760px) calc((100vw - 52px) / 2), (max-width: 1080px) calc((100vw - 96px) / 2), (max-width: 1432px) calc((100vw - 160px) / 3), 424px',
  large: '(max-width: 760px) calc(100vw - 40px), (max-width: 1080px) min(calc(100vw - 72px), 850px), (max-width: 1432px) calc((100vw - 144px) / 2), 644px'
};

const site = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
const photos = JSON.parse(await readFile(path.join(root, 'content/photos.json'), 'utf8'));
const mountain = JSON.parse(await readFile(path.join(root, 'content/mountain.json'), 'utf8'));
const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
if (!Array.isArray(mountain.camps) || mountain.camps.length < 3 || mountain.camps.length > numerals.length) throw new Error('The mountain needs 3 to 9 camps.');
const campIds = new Set();
for (const camp of mountain.camps) {
  if (!/^[a-z][a-z0-9-]*$/.test(camp.id) || campIds.has(camp.id) || !camp.title || !camp.description) throw new Error('Invalid mountain camp: ' + camp.id);
  if (camp.href !== undefined && !/^\/(?!\/)|^https:\/\/[a-z0-9.-]+\.g3rry\.com\//.test(camp.href)) throw new Error('Camp links must be site paths or g3rry.com subdomains: ' + camp.id);
  if (camp.model !== undefined && !['trailhead', 'photography', 'phantom', 'mailboxes', 'summit'].includes(camp.model)) throw new Error('Unknown camp model: ' + camp.model);
  campIds.add(camp.id);
}
// Two chapters off the trail: one inside the mountain (below), one past the summit (above). Each is a stop of its own
// with a card; it gets an "Enter" once it has an href, and until then shows its own "pending" line.
const beyondSides = ['above', 'below'];
for (const side of beyondSides) {
  const chapter = mountain.beyond?.[side];
  if (!chapter) continue;
  if (!/^[a-z][a-z0-9-]*$/.test(chapter.id) || campIds.has(chapter.id) || !chapter.title || !chapter.description) throw new Error('Invalid chapter off the trail: ' + side);
  if (chapter.href !== undefined && !/^\/(?!\/)|^https:\/\/[a-z0-9.-]+\.g3rry\.com\//.test(chapter.href)) throw new Error('Chapter links must be site paths or g3rry.com subdomains: ' + chapter.id);
  if (chapter.eras !== undefined && !(Number.isInteger(chapter.eras) && chapter.eras >= 0 && chapter.eras <= 8)) throw new Error('A chapter keeps 0 to 8 eras: ' + chapter.id);
  campIds.add(chapter.id);
}
const origin = new URL(site.url);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('site.url must be an HTTPS origin.');
await validatePhotos(root, photos, site.hero.photoId);
if (!Array.isArray(site.phantom.shapes) || !site.phantom.shapes.length) throw new Error('At least one Phantom shape is required.');
const imageNames = await readdir(path.join(root, 'image'));
const shapeIds = new Set();
for (const shape of site.phantom.shapes) {
  if (!/^[a-z][a-z0-9-]*$/.test(shape.id) || shapeIds.has(shape.id) || !/^image\/[A-Za-z0-9._-]+\.(png|jpg)$/i.test(shape.source) || !shape.label) throw new Error('Invalid Phantom shape.');
  if (!imageNames.includes(path.basename(shape.source))) throw new Error('Shape filename case does not match: ' + shape.source);
  shapeIds.add(shape.id);
}
const lab = JSON.parse(await readFile(path.join(root, 'content/phantom.json'), 'utf8'));
const labChapters = ['ignite', 'sculpt', 'develop', 'atlas'];
if (!Array.isArray(lab.chapters) || lab.chapters.map(chapter => chapter.id).join() !== labChapters.join()) throw new Error('phantom.json chapters must be ' + labChapters.join(', ') + ' in that order.');
const scenes = JSON.parse(await readFile(path.join(root, 'content/phantom/scenes.json'), 'utf8'));
// Every photograph has its own page with Develop, so each needs lab metadata and a depth model.
if (!lab.example || !lab.photos[lab.example.develop] || !lab.example.atlas.every(id => lab.atlas.stops.some(stop => stop.id === id))) throw new Error('phantom.json example must name a photograph and atlas stops.');
for (const id of photos.map(photo => photo.id)) {
  if (!lab.photos[id]) throw new Error('Photograph needs lab metadata: ' + id);
  if (!scenes[id] || !(scenes[id].subject > 0) || !scenes[id].note) throw new Error('Develop photo needs a scene model with a subject distance and a note: ' + id);
}
for (const site of lab.sites) {
  if (!/^[a-z][a-z0-9-]*$/.test(site.id) || Math.abs(site.lat) > 90 || Math.abs(site.lon) > 180) throw new Error('Invalid atlas site: ' + site.id);
}
for (const stop of lab.atlas.stops) {
  if (stop.site && !lab.sites.some(site => site.id === stop.site)) throw new Error('Atlas stop names an unknown site: ' + stop.id);
  for (const id of [stop.photo, ...(stop.photos || [])].filter(Boolean)) {
    if (!photos.some(photo => photo.id === id) || !lab.photos[id]) throw new Error('Atlas photo needs a manifest entry and lab metadata: ' + id);
  }
}

// Delete only this project's generated dist directory.
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') throw new Error('Unsafe output directory.');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(cache, { recursive: true });
async function output(name, contents) {
  const destination = path.resolve(dist, name);
  if (!destination.startsWith(dist + path.sep)) throw new Error('Output path escapes dist: ' + name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}
const usedCache = new Set();
async function cachedImage(name, produce) {
  usedCache.add(name);
  const filename = path.join(cache, name);
  try { await stat(filename); } catch { await writeFile(filename, await produce()); }
  return readFile(filename);
}

let originalBytes = 0;
let imageBytes = 0;
const generated = [];
for (const photo of photos) {
  const input = await readFile(path.join(root, photo.source));
  const hash = digest(input);
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Unreadable photo: ' + photo.source);
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const sourceWidth = rotated ? metadata.height : metadata.width;
  const sourceHeight = rotated ? metadata.width : metadata.height;
  const resized = width => sharp(input).rotate().resize({ width, withoutEnlargement: true });
  const versions = [];
  for (const width of [...new Set(widths.map(width => Math.min(width, sourceWidth)))]) {
    const version = { width };
    for (const format of ['avif', 'webp']) {
      const name = photo.id + '-' + hash + '-' + transformHash + '-' + width + '.' + format;
      const bytes = await cachedImage(name, () => resized(width)[format](transform[format]).toBuffer());
      await output('assets/photos/' + name, bytes);
      imageBytes += bytes.length;
      version[format] = '/assets/photos/' + name;
    }
    versions.push(version);
  }
  const width = Math.min(1920, sourceWidth);
  const jpegName = photo.id + '-' + hash + '-' + transformHash + '-' + width + '.jpg';
  const jpeg = await cachedImage(jpegName, () => resized(width).jpeg(transform.jpeg).toBuffer());
  await output('assets/photos/' + jpegName, jpeg);
  imageBytes += jpeg.length;
  originalBytes += input.length;
  generated.push({
    ...photo, versions, large: '/assets/photos/' + jpegName, width, height: Math.round(sourceHeight * width / sourceWidth),
    srcset: Object.fromEntries(['avif', 'webp'].map(format => [format, versions.map(version => version[format] + ' ' + version.width + 'w').join(', ')])),
    originalSha256: createHash('sha256').update(input).digest('hex')
  });
}

// Particle masks are sampled to roughly two thousand points, so a small WebP copy (alpha kept) is enough.
const shapes = [];
for (const shape of site.phantom.shapes) {
  const input = await readFile(path.join(root, shape.source));
  const bytes = await sharp(input).resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85, alphaQuality: 100 }).toBuffer();
  const metadata = await sharp(bytes).metadata();
  const url = '/assets/marks/' + shape.id + '-' + digest(bytes) + '.webp';
  await output(url.slice(1), bytes);
  shapes.push({ ...shape, url, width: metadata.width, height: metadata.height });
}

// Every page's stylesheet carries the page-transition rules (src/veil.css) that go with veil.js.
const veilStyles = await readFile(path.join(root, 'src/veil.css'));
const withVeil = (file, bytes) => file.endsWith('.css') ? Buffer.concat([bytes, veilStyles]) : bytes;
async function asset(source, name) {
  const bytes = withVeil(source, await readFile(path.join(root, 'src', source)));
  const url = '/assets/' + name + '-' + digest(bytes) + path.extname(source);
  await output(url.slice(1), bytes);
  return url;
}
const styles = await asset('styles.css', 'site');
const galleryScript = await asset('gallery.js', 'gallery');
const guestbookScript = await asset('guestbook.js', 'guestbook');
const particleScript = await asset('particles.js', 'particles');
// Page transitions; a classic script in every page's head, so a page reached through one starts black.
const veilScript = await asset('veil.js', 'veil');
// The mountain and the lab are folders of ES modules (the mountain also carries its fonts); hashing a folder
// as a whole keeps relative imports and url()s intact.
async function assetFolder(source, name, extra = {}) {
  const directory = path.join(root, 'src', source);
  const sources = Object.fromEntries((await readdir(directory)).filter(file => /\.(js|css)$/.test(file)).map(file => [file, path.join(directory, file)]));
  for (const [file, from] of Object.entries(extra)) sources[file] = path.join(root, from);
  const files = Object.keys(sources).sort();
  const contents = await Promise.all(files.map(async file => withVeil(file, await readFile(sources[file]))));
  const base = '/assets/' + name + '-' + digest(Buffer.concat(files.flatMap((file, i) => [Buffer.from(file + '\0'), contents[i]]))) + '/';
  for (const [i, file] of files.entries()) await output(base.slice(1) + file, contents[i]);
  return files.map(file => base + file);
}
// Latin subsets of two OFL fonts, self-hosted so the page needs nothing from other origins.
const mountainFiles = await assetFolder('mountain', 'mountain', {
  'cormorant-garamond.woff2': 'node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2',
  'jetbrains-mono.woff2': 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
  // Shared preview image; the page also shows it behind the camp list when WebGL is unavailable.
  'social.jpg': 'src/mountain/social.jpg'
});
const mountainSocial = mountainFiles.find(file => file.endsWith('/social.jpg'));
// The mountain's recordings (content/sound, sources in CREDITS.md there), each hashed on its own so a change to the
// page's code does not send them again; the page gets their addresses as a name-to-URL map.
const mountainSounds = {};
for (const file of (await readdir(path.join(root, 'content/sound'))).filter(file => file.endsWith('.mp3')).sort()) {
  const bytes = await readFile(path.join(root, 'content/sound', file)), name = file.slice(0, -4);
  const url = '/assets/sound/' + name + '-' + digest(bytes) + '.mp3';
  await output(url.slice(1), bytes);
  mountainSounds[name] = url;
}
const labFiles = await assetFolder('phantom', 'phantom');
// Lab data (depth maps, point clouds) is optional per item until it has been generated with tools/phantom-data.
async function labData(relative) {
  let bytes;
  try { bytes = await readFile(path.join(root, 'content/phantom', relative)); } catch { return null; }
  const url = '/assets/phantom-data/' + relative.replace(/[\\/]/g, '-').replace(/(\.[a-z0-9]+)$/i, '-' + digest(bytes) + '$1');
  await output(url.slice(1), bytes);
  return url;
}
await copyFile(path.join(root, 'src/favicon.svg'), path.join(dist, 'favicon.svg'));
const layout = await readFile(path.join(root, 'src/layout.html'), 'utf8');

function replace(template, values) {
  const result = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error('Missing template value: ' + key);
    return values[key];
  });
  if (/\{\{[A-Z_]+\}\}/.test(result)) throw new Error('Unresolved template token.');
  return result;
}
// priority: 'high' for the page's likely LCP image, 'eager' for the rest of the first screen, otherwise lazy.
function picture(photo, layoutName, priority) {
  return '<picture>' + ['avif', 'webp'].map(format => '<source type="image/' + format + '" srcset="' + photo.srcset[format] + '" sizes="' + sizes[layoutName] + '">').join('')
    + '<img src="' + photo.large + '" alt="' + escape(photo.alt) + '" width="' + photo.width + '" height="' + photo.height + '"'
    + ' loading="' + (priority ? 'eager' : 'lazy') + '" decoding="async"' + (priority === 'high' ? ' fetchpriority="high"' : '') + '></picture>';
}
const frame = index => String(index + 1).padStart(2, '0');
const hero = generated.find(photo => photo.id === site.hero.photoId);
const lines = value => escape(value).replace(/\n/g, '<br>');
// Pages allow only this site and Cloudflare Web Analytics; the guestbook also needs the Turnstile script and frame.
const policy = extra => "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com" + (extra ? ' ' + extra : '')
  + "; connect-src 'self' https://cloudflareinsights.com; img-src 'self' data:; style-src 'self'" + (extra ? '; frame-src ' + extra : '')
  + "; object-src 'none'; base-uri 'self'; form-action 'none'; upgrade-insecure-requests";
function render(body, { title, description, route, pageClass, script = '', classicScripts = [], head = '', noindex = false, csp = policy() }) {
  return replace(layout, {
    CSP: csp,
    LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape(title),
    DESCRIPTION: escape(description), CANONICAL: escape(new URL(route, origin).href),
    SOCIAL_IMAGE: escape(new URL(hero.large, origin).href), SOCIAL_ALT: escape(hero.alt),
    SOCIAL_WIDTH: hero.width, SOCIAL_HEIGHT: hero.height,
    STYLES: styles, VEIL: veilScript, PAGE_CLASS: pageClass, BODY: body, YEAR: new Date().getUTCFullYear(),
    HOME_CURRENT: route === '/' ? 'aria-current="page"' : '',
    PHOTOS_CURRENT: route === '/photos/' ? 'aria-current="page"' : '',
    GUESTBOOK_CURRENT: route === '/guestbook/' ? 'aria-current="page"' : '',
    HEAD_EXTRA: (noindex ? '<meta name="robots" content="noindex">' : '') + head,
    SCRIPTS: (script ? '<script type="module" src="' + script + '"></script>' : '') + classicScripts.map(src => '<script src="' + src + '"></script>').join('')
  });
}

const featuredPhotos = generated.filter(photo => photo.featured).map(photo =>
  '<figure class="featured-card"><a href="/photos/#photo-' + photo.id + '" aria-label="View photograph: ' + escape(photo.alt) + '">' + picture(photo, 'featured') + '</a>'
  + '<figcaption><span>Frame ' + frame(generated.indexOf(photo)) + '</span><span aria-hidden="true">↗</span></figcaption></figure>');
const home = replace(await readFile(path.join(root, 'src/index.html'), 'utf8'), {
  HERO_EYEBROW: escape(site.hero.eyebrow), HERO_TITLE: lines(site.hero.title), HERO_DESCRIPTION: escape(site.hero.description),
  HERO_PICTURE: picture(hero, 'hero', 'high'), FEATURED_TITLE: lines(site.photography.featuredTitle), FEATURED_PHOTOS: featuredPhotos.join('\n'),
  PHANTOM_TITLE: escape(site.phantom.title), PHANTOM_DESCRIPTION: escape(site.phantom.description),
  PHANTOM_OPTIONS: shapes.map(shape => '<option value="' + shape.id + '" data-src="' + shape.url + '">' + escape(shape.label) + '</option>').join(''),
  PHANTOM_DEFAULT: shapes[0].url, PHANTOM_WIDTH: shapes[0].width, PHANTOM_HEIGHT: shapes[0].height
});
// The earlier home page (hero, featured photographs, the particle toy) is kept at /legacy/: out of the index, the
// sitemap and the navigation. The mountain is the home page now (below).
await output('legacy/index.html', render(home, { title: site.title, description: site.description, route: '/legacy/', pageClass: 'home-page', script: particleScript, noindex: true }));

const galleryPhotos = generated.map((photo, index) =>
  '<figure class="photo-card" id="photo-' + photo.id + '"><a data-photo="' + photo.id + '" data-srcset="' + photo.srcset.webp + '" data-large="' + photo.large + '"'
  + ' data-width="' + photo.width + '" data-height="' + photo.height + '" href="/photos/' + photo.id + '/" aria-label="Open photograph: ' + escape(photo.alt) + '">'
  + picture(photo, 'grid', index === 0 ? 'high' : index < 3 ? 'eager' : '') + '</a><figcaption><span>' + frame(index) + (lab.photos[photo.id] ? ' · ' + escape(lab.photos[photo.id].place) : '') + '</span>'
  + '<span>' + (lab.atlas.stops.some(stop => stop.vantage && (stop.photo === photo.id || stop.photos?.includes(photo.id))) ? 'Depth · Placed' : 'Depth') + ' ↗</span></figcaption></figure>');
const gallery = replace(await readFile(path.join(root, 'src/photos.html'), 'utf8'), {
  PHOTO_COUNT: String(generated.length).padStart(2, '0'), COLLECTION_TITLE: escape(site.photography.title), COLLECTION_DESCRIPTION: escape(site.photography.description),
  SIZES_GRID: sizes.grid, SIZES_LARGE: sizes.large, GALLERY_PHOTOS: galleryPhotos.join('\n')
});
await output('photos/index.html', render(gallery, { title: site.photography.title + ' — ' + site.name, description: site.photography.description, route: '/photos/', pageClass: 'gallery-page', script: galleryScript }));

// The Turnstile site key is public; GUESTBOOK_SITEKEY swaps in Cloudflare's dummy keys for local testing.
const notes = site.guestbook;
const siteKey = process.env.GUESTBOOK_SITEKEY || notes.turnstileSiteKey;
if (!/^[0-9A-Za-z_-]{10,64}$/.test(siteKey)) throw new Error('Invalid Turnstile site key.');
if (!/^[a-z0-9._-]+@g3rry\.com$/.test(notes.contact)) throw new Error('The guestbook contact must be a g3rry.com address.');
const guestbook = replace(await readFile(path.join(root, 'src/guestbook.html'), 'utf8'), {
  GUESTBOOK_EYEBROW: escape(notes.eyebrow), GUESTBOOK_HEADING: escape(notes.heading), GUESTBOOK_DESCRIPTION: escape(notes.description),
  TURNSTILE_SITEKEY: escape(siteKey), GUESTBOOK_CONTACT: escape(notes.contact)
});
await output('guestbook/index.html', render(guestbook, {
  title: notes.title + ' — ' + site.name, description: notes.description, route: '/guestbook/', pageClass: 'guestbook-page',
  script: guestbookScript, csp: policy('https://challenges.cloudflare.com')
}));

await output('404.html', render(
  '<!-- Some people come here on purpose. They are usually looking for /strata/. --><section class="simple-page wrap"><p class="eyebrow">404 / A small detour</p><h1>This frame is missing.</h1><p>The page may have moved. There are still plenty of moments to explore.</p><a class="text-link" href="/photos/">Explore the photographs ↗</a></section>',
  { title: 'Page not found — ' + site.name, description: 'Find your way back to the photographs.', route: '/404.html', pageClass: 'error-page', noindex: true }));
// The full-screen pages (mountain, lab) have their own shells but share the site's Content-Security-Policy.
const mountainScript = mountainFiles.find(file => file.endsWith('/main.js'));
// The skyline of the mountain's first view for the loading line, one per field of view (portrait and landscape
// screens), with the camps' ledges cut in as on the page. Tracing it takes a few seconds, so it is cached with the image
// encodes, keyed by the code that shapes it and the number of camps.
const ridgeSources = await Promise.all(['src/mountain/terrain.js', 'src/mountain/water.js', 'src/mountain/camera.js', 'src/mountain/math.js', 'scripts/mountain-ridge.mjs'].map(file => readFile(path.join(root, file))));
const ridge = JSON.parse(await cachedImage('mountain-ridge-' + digest(Buffer.concat([...ridgeSources, Buffer.from('camps ' + mountain.camps.length)])) + '.json',
  async () => Buffer.from(JSON.stringify({ portrait: ridgePaths(FOV.portrait, 1.05, mountain.camps.length), landscape: ridgePaths(FOV.landscape, 3, mountain.camps.length) }))));
// Two layers: the faint outline with the summit light, and the bright line that is uncovered from both edges.
const ridgeLayer = draw => Object.entries(ridge).map(([kind, line]) => '<g class="ridge ridge-' + kind + '">' + draw(line) + '</g>').join('');
const ridgeBase = ridgeLayer(({ left, right, summit }) => '<path class="ridge-base" d="' + left + '"/><path class="ridge-base" d="' + right + '"/>'
  + '<circle class="ridge-halo" cx="' + summit[0] + '" cy="' + summit[1] + '" r=".05"/><circle class="ridge-summit" cx="' + summit[0] + '" cy="' + summit[1] + '" r=".0075"/>');
const ridgeLine = ridgeLayer(({ left, right }) => [left, right].map(d => '<path class="ridge-glow" d="' + d + '"/><path class="ridge-line" d="' + d + '"/>').join(''));
// The Phantom camp floats the first Phantom mark as a cloud of points: its bright, opaque pixels, sampled once here.
async function phantomPoints(source, count = 2600) {
  const { data, info } = await sharp(path.join(root, source)).resize({ width: 120, height: 120, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lit = [], half = Math.max(info.width, info.height) / 2;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4, luma = (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255;
    if (data[i + 3] > 128 && luma > .35) lit.push([(x + .5 - info.width / 2) / half, (info.height / 2 - y - .5) / half]);
  }
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const points = Array.from({ length: Math.min(count, lit.length * 4) }, () => { const [x, y] = lit[Math.floor(next() * lit.length)]; return [x + (next() - .5) / half, y + (next() - .5) / half]; });
  const bytes = Buffer.from(JSON.stringify(points.flat().map(value => Math.round(value * 1000) / 1000)));
  const url = '/assets/mountain-phantom-' + digest(bytes) + '.json';
  await output(url.slice(1), bytes);
  return url;
}
const featured = generated.filter(photo => photo.featured);
// Each print on the Photography camp's line takes the most vivid tone of one featured photograph (the brightest,
// most saturated twentieth of its pixels), since night photographs are dominated by near-black.
const printColors = await Promise.all(featured.map(async photo => {
  const { data } = await sharp(path.join(dist, photo.large.slice(1))).resize(48, 48, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = [];
  for (let i = 0; i < data.length; i += 3) pixels.push([data[i], data[i + 1], data[i + 2]]);
  const vivid = pixels.map(p => ({ p, score: (Math.max(...p) - Math.min(...p)) * Math.max(...p) })).sort((a, b) => b.score - a.score).slice(0, Math.ceil(pixels.length / 20));
  return '#' + [0, 1, 2].map(c => Math.round(vivid.reduce((sum, { p }) => sum + p[c], 0) / vivid.length).toString(16).padStart(2, '0')).join('');
}));
const campExtras = {
  photography: () => '<div class="camp-extra camp-photos">' + featured.map(photo => {
    const version = photo.versions[0];
    return '<a href="/photos/' + photo.id + '/"><img src="' + version.webp + '" alt="' + escape(photo.alt) + '" width="' + version.width + '" height="' + Math.round(photo.height * version.width / photo.width) + '" loading="lazy" decoding="async"></a>';
  }).join('') + '</div>'
};
const campData = {
  photography: () => ' data-prints="' + printColors.join(',') + '"',
  phantom: async () => ' data-shape="' + await phantomPoints(site.phantom.shapes[0].source) + '"'
};
const camps = await Promise.all(mountain.camps.map(async (camp, index) => '<li id="' + camp.id + '" data-kicker="' + escape(camp.kicker || 'Camp ' + numerals[index]) + '"' 
  + (camp.model ? ' data-model="' + camp.model + '"' + (campData[camp.model] ? await campData[camp.model]() : '') : '') + '>'
  + '<a href="' + escape(camp.href || '#' + camp.id) + '"' + (camp.href ? '' : ' data-pending') + '><span class="camp-number">' + numerals[index] + '</span><span class="camp-title">' + escape(camp.title) + '</span></a>'
  + '<p>' + escape(camp.description) + '</p>' + (campExtras[camp.model] ? campExtras[camp.model]() : '') + '</li>'));
const beyondMarks = { above: '↑', below: '↓' };
const beyond = beyondSides.filter(side => mountain.beyond?.[side]).map(side => {
  const chapter = mountain.beyond[side];
  return '<li id="' + chapter.id + '" class="beyond-' + side + '" data-beyond="' + side + '" data-kicker="' + escape(chapter.kicker || '') + '"'
    + (chapter.pending ? ' data-pending-text="' + escape(chapter.pending) + '"' : '') + (chapter.eras !== undefined ? ' data-eras="' + chapter.eras + '"' : '') + '>'
    + '<a href="' + escape(chapter.href || '#' + chapter.id) + '"' + (chapter.href ? '' : ' data-pending') + '><span class="camp-number">' + beyondMarks[side] + '</span><span class="camp-title">' + escape(chapter.title) + '</span></a>'
    + '<p>' + escape(chapter.description) + '</p></li>';
});
await output('index.html', replace(await readFile(path.join(root, 'src/mountain/page.html'), 'utf8'), {
  LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape(mountain.title), DESCRIPTION: escape(mountain.description),
  CANONICAL: escape(origin.href), CSP: '<meta http-equiv="Content-Security-Policy" content="' + policy() + '">',
  SOCIAL_IMAGE: escape(new URL(mountainSocial, origin).href), STYLES: mountainFiles.find(file => file.endsWith('.css')), SCRIPT: mountainScript, VEIL: veilScript, RIDGE_BASE: ridgeBase, RIDGE_LINE: ridgeLine,
  PRELOADS: [...mountainFiles.filter(file => file.endsWith('.woff2')).map(file => '<link rel="preload" href="' + file + '" as="font" type="font/woff2" crossorigin>'),
    ...mountainFiles.filter(file => file.endsWith('.js') && file !== mountainScript && !file.endsWith('/worker.js')).map(file => '<link rel="modulepreload" href="' + file + '">')].join('\n  '),
  INTRO_KICKER: escape(mountain.intro.kicker), INTRO_TITLE: lines(mountain.intro.title), INTRO_DESCRIPTION: escape(mountain.intro.description),
  INTRO_HINT: escape(mountain.intro.hint), CAMPS: camps.join('\n        '), BEYOND: beyond.join('\n        '), SOUNDS: escape(JSON.stringify(mountainSounds))
}));
// The mountain used to live at /mountain/: old links, camp links (#photography) included, land on the home page.
const movedCode = Buffer.from("location.replace('/' + location.hash);\n");
const movedScript = '/assets/moved-' + digest(movedCode) + '.js';
await output(movedScript.slice(1), movedCode);
await output('mountain/index.html', '<!doctype html><html lang="' + escape(site.language) + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta http-equiv="Content-Security-Policy" content="' + policy() + '"><meta name="robots" content="noindex"><link rel="canonical" href="' + escape(origin.href) + '">'
  + '<meta http-equiv="refresh" content="0;url=/"><title>' + escape(mountain.title) + '</title><script src="' + movedScript + '"></script></head>'
  + '<body><p>The mountain is the home page now: <a href="/">' + escape(origin.hostname) + '</a></p></body></html>');
const labScript = labFiles.find(file => file.endsWith('/main.js'));
function labPhoto(id) {
  const photo = generated.find(item => item.id === id);
  const version = photo.versions.filter(item => item.width <= 1280).at(-1);
  return { id, alt: photo.alt, frame: frame(generated.indexOf(photo)), url: version.webp, width: version.width, height: Math.round(photo.height * version.width / photo.width), ...lab.photos[id] };
}
// When a photograph was taken, in UTC: EXIF records camera-clock time, which each trip corrects to local time.
function capturedAt(id) {
  const meta = lab.photos[id], trip = meta && lab.trips.find(item => item.id === meta.trip);
  if (!meta || !meta.exif || !trip) return null;
  const [, sign, hours, minutes] = trip.utcOffset.match(/^([+-])(\d\d):(\d\d)$/);
  const offset = (sign === '-' ? -1 : 1) * (+hours * 60 + +minutes);
  const correction = (trip.cameraClockBehindMinutes || 0) - (trip.cameraClockAheadMinutes || 0);
  return { when: new Date(Date.parse(meta.exif + 'Z') + (correction - offset) * 60000).toISOString(), utcOffset: trip.utcOffset };
}
// The lab and every photograph's page run one engine; a page's config holds only what its chapters show.
const sceneEntry = async id => {
  const header = await readFile(path.join(root, 'content/phantom/scenes', id + '.bin')).then(file => { const raw = gunzipSync(file); return JSON.parse(raw.subarray(4, 4 + raw.readUInt32LE(0))); });
  return { ...labPhoto(id), scene: await labData('scenes/' + id + '.bin'), subject: scenes[id].subject, nearest: header.nearest, note: scenes[id].note };
};
const resolveStop = stop => ({
  ...stop, photo: stop.photo ? labPhoto(stop.photo) : null, photos: stop.photos ? stop.photos.map(labPhoto) : null,
  // The sun as it stood when the stop's photograph was taken, seen from where it was taken.
  light: stop.light || (stop.vantage && (stop.photo || stop.photos) ? { ...capturedAt(stop.photo || stop.photos[0]), where: (stop.vantage.at || stop.vantage.target).slice(0, 2) } : null)
});
const atlasData = {
  land: await labData('atlas/land.bin'),
  frames: JSON.parse(await readFile(path.join(root, 'content/phantom/atlas/frames.json'), 'utf8').catch(() => '{"clouds":{},"stops":{}}')),
  clouds: Object.fromEntries(await Promise.all(lab.sites.flatMap(item => item.lidar ? item.lidar.clouds : []).map(async cloud => [cloud.id, await labData('atlas/' + cloud.id + '.bin')]))),
  terrain: Object.fromEntries(lab.sites.flatMap(item => item.lidar ? item.lidar.clouds : []).filter(cloud => cloud.terrain).map(cloud => [cloud.id, cloud.terrain]))
};
async function pageConfig(developIds, stops) {
  const sceneIds = [...new Set(stops.map(stop => stop.photo).filter(id => id && scenes[id] && !developIds.includes(id)))];
  return {
    shapes: shapes.map(({ id, label, url, width, height }) => ({ id, label, url, width, height })),
    develop: await Promise.all(developIds.map(sceneEntry)), scenes: await Promise.all(sceneIds.map(sceneEntry)),
    sites: lab.sites.map(({ id, name, lat, lon, period, status, origin }) => ({ id, name, lat, lon, period, status, origin })), trips: lab.trips,
    atlas: stops.length ? { ...atlasData, stops: stops.map(resolveStop) } : null
  };
}
const stopById = id => {
  const stop = lab.atlas.stops.find(item => item.id === id);
  if (!stop) throw new Error('Unknown atlas stop: ' + id);
  return stop;
};
const labConfig = await pageConfig([lab.example.develop], lab.example.atlas.map(stopById));
const chapterTokens = Object.fromEntries(lab.chapters.flatMap(chapter => {
  const key = chapter.id.toUpperCase();
  return [[key + '_KICKER', escape(chapter.kicker)], [key + '_TITLE', lines(chapter.title)], [key + '_TEXT', escape(chapter.text)]];
}));
const developHero = generated.find(photo => photo.id === lab.example.develop);
await output('phantom/index.html', replace(await readFile(path.join(root, 'src/phantom/page.html'), 'utf8'), {
  LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape(lab.title), DESCRIPTION: escape(lab.description),
  CANONICAL: escape(new URL('/phantom/', origin).href), CSP: '<meta http-equiv="Content-Security-Policy" content="' + policy() + '">',
  STYLES: labFiles.find(file => file.endsWith('.css')), SCRIPT: labScript, VEIL: veilScript,
  PRELOADS: labFiles.filter(file => file.endsWith('.js') && file !== labScript && !file.endsWith('/worker.js')).map(file => '<link rel="modulepreload" href="' + file + '">').join('\n  '),
  INTRO_KICKER: escape(lab.intro.kicker), INTRO_TITLE: lines(lab.intro.title), INTRO_TEXT: escape(lab.intro.text), INTRO_HINT: escape(lab.intro.hint),
  ...chapterTokens,
  SHAPE_OPTIONS: shapes.map(shape => '<option value="' + shape.id + '">' + escape(shape.label) + '</option>').join(''),
  SHAPE_FALLBACK: '<img src="' + shapes[0].url + '" alt="The ' + escape(shapes[0].label) + ' mark" width="' + shapes[0].width + '" height="' + shapes[0].height + '" loading="lazy" decoding="async">',
  DEVELOP_FALLBACK: picture(developHero, 'large'),
  ATLAS_SITES: lab.sites.map(item => '<li data-site="' + item.id + '"' + (item.status === 'live' ? '' : ' class="is-soon"') + '><span>' + escape(item.name) + '</span><span>'
    + (item.status === 'live' ? escape(item.period || '') : 'Soon') + '</span></li>').join(''),
  CREDITS: lab.credits.map(line => '<li>' + escape(line) + '</li>').join(''),
  ATLAS_STOPS: lab.example.atlas.map(stopById).map(stop => '<li data-stop="' + stop.id + '"><b>' + escape(stop.title) + '</b><span>' + escape(stop.caption) + '</span></li>').join(''),
  CONFIG: JSON.stringify(labConfig).replace(/</g, '\\u003c')
}));
// ---- One page per photograph: the print, its depth (02 Develop) and where it was taken (03 Atlas) ----------------
const photoTemplate = await readFile(path.join(root, 'src/phantom/photo.html'), 'utf8');
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function takenLine(id) {
  const at = capturedAt(id);
  if (!at) return '';
  const [, sign, hh, mm] = at.utcOffset.match(/^([+-])(\d\d):(\d\d)$/);
  const local = new Date(Date.parse(at.when) + (sign === '-' ? -1 : 1) * (+hh * 60 + +mm) * 60000);
  return local.getUTCDate() + ' ' + months[local.getUTCMonth()] + ' ' + local.getUTCFullYear() + ' · ' + local.toISOString().slice(11, 16) + ' UTC' + (sign === '-' ? '−' : '+') + Number(hh);
}
// A photograph's own stop when it has one; otherwise the LiDAR around a solved stop at the same place; otherwise its city.
function photoStops(id) {
  const meta = lab.photos[id], site = lab.trips.find(trip => trip.id === meta.trip)?.site;
  if (!site || !lab.sites.find(item => item.id === site && item.status === 'live')) return { stops: [], kind: 'none' };
  const globe = { ...lab.atlas.stops.find(stop => stop.kind === 'globe' && stop.site === site), title: 'The whole planet' };
  globe.caption = 'From the whole planet down to ' + lab.sites.find(item => item.id === site).name + '.';
  const overview = lab.atlas.stops.find(stop => stop.kind === 'overview' && stop.site === site);
  const own = lab.atlas.stops.find(stop => stop.vantage && (stop.photo === id || stop.photos?.includes(id)));
  if (own) return { stops: [globe, overview, own], kind: 'own' };
  const near = meta.located && lab.atlas.stops.find(stop => stop.vantage && [stop.photo, ...(stop.photos || [])].some(other => other && lab.photos[other].place === meta.place));
  if (near && atlasData.frames.stops[near.id]) {
    // The solved station of the other frame from the same place, without that frame: the street, at this frame's hour.
    const area = { ...near, photo: null, photos: null, project: false, title: 'Around ' + meta.place,
      caption: 'The street from a frame taken nearby. Where exactly this one was taken is not solved yet.',
      light: { ...capturedAt(id), where: (near.vantage.at || near.vantage.target).slice(0, 2) } };
    return { stops: [globe, overview, area], kind: 'near' };
  }
  return { stops: [globe, overview], kind: 'city' };
}
const atlasText = { own: 'The camera comes down from the whole planet to where I stood, through public airborne LiDAR, with the sun where it stood at that moment. Drag to look around the spot.',
  near: 'The camera comes down from the whole planet to the place, rebuilt from public airborne LiDAR. This frame is not yet set at its exact spot.',
  city: 'The camera comes down from the whole planet to the city, rebuilt from public airborne LiDAR. This frame is not yet placed.' };
const photoLink = (photo, rel) => '<a href="/photos/' + photo.id + '/" rel="' + rel + '">' + (rel === 'prev' ? '<span aria-hidden="true">←</span> Frame ' : 'Frame ') + frame(generated.indexOf(photo)) + (rel === 'next' ? ' <span aria-hidden="true">→</span>' : '') + '</a>';
for (const [index, photo] of generated.entries()) {
  const meta = lab.photos[photo.id];
  if (!meta || !scenes[photo.id]) throw new Error('Every photograph needs lab metadata and a depth model: ' + photo.id);
  const { stops, kind } = photoStops(photo.id);
  const config = await pageConfig([photo.id], stops);
  const route = '/photos/' + photo.id + '/';
  const atlasSection = stops.length ? '<section class="lab-chapter" id="atlas" data-chapter="atlas" aria-labelledby="atlas-title"><div class="lab-panel">'
    + '<p class="lab-kicker">03 / Atlas</p><h2 id="atlas-title">Where the light<br>was.</h2><p class="lab-text">' + escape(atlasText[kind]) + '</p>'
    + '<ol class="lab-stops" id="lab-stops">' + stops.map(stop => '<li data-stop="' + stop.id + '"><b>' + escape(stop.title) + '</b><span>' + escape(stop.caption || '') + '</span></li>').join('') + '</ol></div></section>' : '';
  await output('photos/' + photo.id + '/index.html', replace(photoTemplate, {
    LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape('Frame ' + frame(index) + ', ' + meta.place + ' — ' + site.name), DESCRIPTION: escape(photo.alt),
    CANONICAL: escape(new URL(route, origin).href), CSP: '<meta http-equiv="Content-Security-Policy" content="' + policy() + '">', SOCIAL_IMAGE: escape(new URL(photo.large, origin).href),
    STYLES: labFiles.find(file => file.endsWith('.css')), SCRIPT: labScript, VEIL: veilScript,
    PRELOADS: labFiles.filter(file => file.endsWith('.js') && file !== labScript && !file.endsWith('/worker.js')).map(file => '<link rel="modulepreload" href="' + file + '">').join('\n  '),
    FRAME: frame(index), COUNT: frame(generated.length - 1), PLACE: escape(meta.place), HEADING: escape(meta.place) + '<span class="lab-dot" aria-hidden="true">.</span>',
    TAKEN: escape(takenLine(photo.id)), EXPOSURE: escape([meta.focal + ' mm', 'ƒ/' + meta.aperture, meta.shutter, 'ISO ' + meta.iso].join(' · ')),
    NOTE: escape(scenes[photo.id].note || ''), LARGE: photo.large, PICTURE: picture(photo, 'large', 'high'),
    ATLAS_INDEX: stops.length ? '<a href="#atlas" data-index="atlas"><span>03</span> Atlas</a>' : '', ATLAS_SECTION: atlasSection,
    PREVIOUS: index > 0 ? photoLink(generated[index - 1], 'prev') : '', NEXT: index < generated.length - 1 ? photoLink(generated[index + 1], 'next') : '',
    CONFIG: JSON.stringify(config).replace(/</g, '\\u003c')
  }));
}
// Other years: the same site rebuilt in earlier years of the web (scripts/eras/).
await buildEras({ root, dist, output, cachedImage, digest, escape, policy, render, site, lab, photos: generated });
await buildStrata({ root, dist, output, render, escape });
await output('Photo/gallery.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta http-equiv="refresh" content="0;url=/photos/"><meta name="robots" content="noindex"><link rel="canonical" href="' + escape(new URL('/photos/', origin).href) + '">'
  + '<title>Photography — ' + escape(site.name) + '</title></head><body><h1>The gallery has moved.</h1><p><a href="/photos/">Explore the photography collection</a></p></body></html>');
// One folder is out of bounds for robots; people are welcome (it belongs to /strata/).
await output('robots.txt', 'User-agent: *\nAllow: /\nDisallow: /eras/1996/private/\nSitemap: ' + new URL('/sitemap.xml', origin).href + '\n');
await output('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + escape(origin.href) + '</loc></url><url><loc>' + escape(new URL('/photos/', origin).href) + '</loc></url><url><loc>' + escape(new URL('/phantom/', origin).href) + '</loc></url><url><loc>' + escape(new URL('/guestbook/', origin).href) + '</loc></url><url><loc>' + escape(new URL('/eras/', origin).href) + '</loc></url>'
  + generated.map(photo => '<url><loc>' + escape(new URL('/photos/' + photo.id + '/', origin).href) + '</loc></url>').join('') + '</urlset>\n');
await output('CNAME', origin.hostname + '\n');
await output('.nojekyll', '');

// Drop cached encodes no longer referenced, so the local and CI caches do not grow forever.
for (const name of await readdir(cache)) if (!usedCache.has(name)) await rm(path.join(cache, name), { force: true });

const report = { originalBytes, displayImageBytes: imageBytes, photoCount: generated.length, photos: generated.map(({ id, source, originalSha256, large, versions }) => ({ id, source, originalSha256, large, versions })) };
await writeFile(path.join(root, '.cache/build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Built ' + generated.length + ' photographs. Display images: ' + (imageBytes / 1048576).toFixed(2) + ' MiB; masters: ' + (originalBytes / 1048576).toFixed(2) + ' MiB.');
