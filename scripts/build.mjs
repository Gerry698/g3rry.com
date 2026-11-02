import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile, writeFile, mkdir, rm, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { validatePhotos } from './photo-data.mjs';

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
const times = ['dawn', 'morning', 'noon', 'golden', 'dusk', 'night'];
if (!Array.isArray(mountain.camps) || mountain.camps.length < 3 || mountain.camps.length > numerals.length) throw new Error('The mountain needs 3 to 9 camps.');
const campIds = new Set();
for (const camp of mountain.camps) {
  if (!/^[a-z][a-z0-9-]*$/.test(camp.id) || campIds.has(camp.id) || !camp.title || !camp.description) throw new Error('Invalid mountain camp: ' + camp.id);
  if (camp.href !== undefined && !/^\/(?!\/)|^https:\/\/[a-z0-9.-]+\.g3rry\.com\//.test(camp.href)) throw new Error('Camp links must be site paths or g3rry.com subdomains: ' + camp.id);
  if (camp.model !== undefined && !['trailhead', 'photography', 'phantom', 'mailboxes', 'summit'].includes(camp.model)) throw new Error('Unknown camp model: ' + camp.model);
  if (camp.time !== undefined && !times.includes(camp.time)) throw new Error('Unknown camp time "' + camp.time + '"; use one of ' + times.join(', '));
  campIds.add(camp.id);
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
for (const id of lab.develop) {
  if (!photos.some(photo => photo.id === id) || !lab.photos[id]) throw new Error('Develop photo needs a manifest entry and lab metadata: ' + id);
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

async function asset(source, name) {
  const bytes = await readFile(path.join(root, 'src', source));
  const url = '/assets/' + name + '-' + digest(bytes) + path.extname(source);
  await output(url.slice(1), bytes);
  return url;
}
const styles = await asset('styles.css', 'site');
const galleryScript = await asset('gallery.js', 'gallery');
const guestbookScript = await asset('guestbook.js', 'guestbook');
const particleScript = await asset('particles.js', 'particles');
// The mountain and the lab are folders of ES modules (the mountain also carries its fonts); hashing a folder
// as a whole keeps relative imports and url()s intact.
async function assetFolder(source, name, extra = {}) {
  const directory = path.join(root, 'src', source);
  const sources = Object.fromEntries((await readdir(directory)).filter(file => /\.(js|css)$/.test(file)).map(file => [file, path.join(directory, file)]));
  for (const [file, from] of Object.entries(extra)) sources[file] = path.join(root, from);
  const files = Object.keys(sources).sort();
  const contents = await Promise.all(files.map(file => readFile(sources[file])));
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
function render(body, { title, description, route, pageClass, script = '', noindex = false, csp = policy() }) {
  return replace(layout, {
    CSP: csp,
    LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape(title),
    DESCRIPTION: escape(description), CANONICAL: escape(new URL(route, origin).href),
    SOCIAL_IMAGE: escape(new URL(hero.large, origin).href), SOCIAL_ALT: escape(hero.alt),
    SOCIAL_WIDTH: hero.width, SOCIAL_HEIGHT: hero.height,
    STYLES: styles, PAGE_CLASS: pageClass, BODY: body, YEAR: new Date().getUTCFullYear(),
    HOME_CURRENT: route === '/' ? 'aria-current="page"' : '',
    PHOTOS_CURRENT: route === '/photos/' ? 'aria-current="page"' : '',
    GUESTBOOK_CURRENT: route === '/guestbook/' ? 'aria-current="page"' : '',
    HEAD_EXTRA: noindex ? '<meta name="robots" content="noindex">' : '',
    SCRIPTS: script ? '<script type="module" src="' + script + '"></script>' : ''
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
await output('index.html', render(home, { title: site.title, description: site.description, route: '/', pageClass: 'home-page', script: particleScript }));

const galleryPhotos = generated.map((photo, index) =>
  '<figure class="photo-card" id="photo-' + photo.id + '"><a data-photo="' + photo.id + '" data-srcset="' + photo.srcset.webp + '"'
  + ' data-width="' + photo.width + '" data-height="' + photo.height + '" href="' + photo.large + '" aria-label="View photograph: ' + escape(photo.alt) + '">'
  + picture(photo, 'grid', index === 0 ? 'high' : index < 3 ? 'eager' : '') + '</a><figcaption><span>' + frame(index) + '</span><span>View photograph ↗</span></figcaption></figure>');
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
  '<section class="simple-page wrap"><p class="eyebrow">404 / A small detour</p><h1>This frame is missing.</h1><p>The page may have moved. There are still plenty of moments to explore.</p><a class="text-link" href="/photos/">Explore the photographs ↗</a></section>',
  { title: 'Page not found — ' + site.name, description: 'Find your way back to the photographs.', route: '/404.html', pageClass: 'error-page', noindex: true }));
// The full-screen pages (mountain, lab) have their own shells but share the site's Content-Security-Policy.
const mountainScript = mountainFiles.find(file => file.endsWith('/main.js'));
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
    return '<a href="/photos/#photo-' + photo.id + '"><img src="' + version.webp + '" alt="' + escape(photo.alt) + '" width="' + version.width + '" height="' + Math.round(photo.height * version.width / photo.width) + '" loading="lazy" decoding="async"></a>';
  }).join('') + '</div>'
};
const campData = {
  photography: () => ' data-prints="' + printColors.join(',') + '"',
  phantom: async () => ' data-shape="' + await phantomPoints(site.phantom.shapes[0].source) + '"'
};
const camps = await Promise.all(mountain.camps.map(async (camp, index) => '<li id="' + camp.id + '" data-kicker="' + escape(camp.kicker || 'Camp ' + numerals[index]) + '"' + (camp.time ? ' data-time="' + camp.time + '"' : '')
  + (camp.model ? ' data-model="' + camp.model + '"' + (campData[camp.model] ? await campData[camp.model]() : '') : '') + '>'
  + '<a href="' + escape(camp.href || '#' + camp.id) + '"' + (camp.href ? '' : ' data-pending') + '><span class="camp-number">' + numerals[index] + '</span><span class="camp-title">' + escape(camp.title) + '</span></a>'
  + '<p>' + escape(camp.description) + '</p>' + (campExtras[camp.model] ? campExtras[camp.model]() : '') + '</li>'));
await output('mountain/index.html', replace(await readFile(path.join(root, 'src/mountain/page.html'), 'utf8'), {
  LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape(mountain.title), DESCRIPTION: escape(mountain.description),
  CANONICAL: escape(new URL('/mountain/', origin).href), CSP: '<meta http-equiv="Content-Security-Policy" content="' + policy() + '">',
  SOCIAL_IMAGE: escape(new URL(mountainSocial, origin).href), STYLES: mountainFiles.find(file => file.endsWith('.css')), SCRIPT: mountainScript,
  PRELOADS: [...mountainFiles.filter(file => file.endsWith('.woff2')).map(file => '<link rel="preload" href="' + file + '" as="font" type="font/woff2" crossorigin>'),
    ...mountainFiles.filter(file => file.endsWith('.js') && file !== mountainScript && !file.endsWith('/worker.js')).map(file => '<link rel="modulepreload" href="' + file + '">')].join('\n  '),
  INTRO_KICKER: escape(mountain.intro.kicker), INTRO_TITLE: lines(mountain.intro.title), INTRO_DESCRIPTION: escape(mountain.intro.description),
  INTRO_HINT: escape(mountain.intro.hint), CAMPS: camps.join('\n        ')
}));
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
const labConfig = {
  shapes: shapes.map(({ id, label, url, width, height }) => ({ id, label, url, width, height })),
  develop: await Promise.all(lab.develop.map(async id => {
    const header = await readFile(path.join(root, 'content/phantom/scenes', id + '.bin')).then(file => { const raw = gunzipSync(file); return JSON.parse(raw.subarray(4, 4 + raw.readUInt32LE(0))); });
    return { ...labPhoto(id), scene: await labData('scenes/' + id + '.bin'), subject: scenes[id].subject, nearest: header.nearest, note: scenes[id].note };
  })),
  sites: lab.sites.map(({ id, name, lat, lon, period, status, origin }) => ({ id, name, lat, lon, period, status, origin })), trips: lab.trips,
  atlas: {
    land: await labData('atlas/land.bin'),
    frames: JSON.parse(await readFile(path.join(root, 'content/phantom/atlas/frames.json'), 'utf8').catch(() => '{"clouds":{},"stops":{}}')),
    clouds: Object.fromEntries(await Promise.all(lab.sites.flatMap(item => item.lidar ? item.lidar.clouds : []).map(async cloud => [cloud.id, await labData('atlas/' + cloud.id + '.bin')]))),
    terrain: Object.fromEntries(lab.sites.flatMap(item => item.lidar ? item.lidar.clouds : []).filter(cloud => cloud.terrain).map(cloud => [cloud.id, cloud.terrain])),
    stops: lab.atlas.stops.map(stop => ({
      ...stop, photo: stop.photo ? labPhoto(stop.photo) : null, photos: stop.photos ? stop.photos.map(labPhoto) : null,
      // The sun as it stood when the stop's photograph was taken, seen from where it was taken.
      light: stop.vantage && (stop.photo || stop.photos) ? { ...capturedAt(stop.photo || stop.photos[0]), where: (stop.vantage.at || stop.vantage.target).slice(0, 2) } : null
    }))
  }
};
const chapterTokens = Object.fromEntries(lab.chapters.flatMap(chapter => {
  const key = chapter.id.toUpperCase();
  return [[key + '_KICKER', escape(chapter.kicker)], [key + '_TITLE', lines(chapter.title)], [key + '_TEXT', escape(chapter.text)]];
}));
const developHero = generated.find(photo => photo.id === lab.develop[0]);
await output('phantom/index.html', replace(await readFile(path.join(root, 'src/phantom/page.html'), 'utf8'), {
  LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape(lab.title), DESCRIPTION: escape(lab.description),
  CANONICAL: escape(new URL('/phantom/', origin).href), CSP: '<meta http-equiv="Content-Security-Policy" content="' + policy() + '">',
  STYLES: labFiles.find(file => file.endsWith('.css')), SCRIPT: labScript,
  PRELOADS: labFiles.filter(file => file.endsWith('.js') && file !== labScript && !file.endsWith('/worker.js')).map(file => '<link rel="modulepreload" href="' + file + '">').join('\n  '),
  INTRO_KICKER: escape(lab.intro.kicker), INTRO_TITLE: lines(lab.intro.title), INTRO_TEXT: escape(lab.intro.text), INTRO_HINT: escape(lab.intro.hint),
  ...chapterTokens,
  SHAPE_OPTIONS: shapes.map(shape => '<option value="' + shape.id + '">' + escape(shape.label) + '</option>').join(''),
  SHAPE_FALLBACK: '<img src="' + shapes[0].url + '" alt="The ' + escape(shapes[0].label) + ' mark" width="' + shapes[0].width + '" height="' + shapes[0].height + '" loading="lazy" decoding="async">',
  DEVELOP_FALLBACK: picture(developHero, 'large'),
  ATLAS_SITES: lab.sites.map(item => '<li data-site="' + item.id + '"' + (item.status === 'live' ? '' : ' class="is-soon"') + '><span>' + escape(item.name) + '</span><span>'
    + (item.status === 'live' ? escape(item.period || '') : 'Soon') + '</span></li>').join(''),
  CREDITS: lab.credits.map(line => '<li>' + escape(line) + '</li>').join(''),
  ATLAS_STOPS: lab.atlas.stops.map(stop => '<li data-stop="' + stop.id + '"><b>' + escape(stop.title) + '</b><span>' + escape(stop.caption) + '</span></li>').join(''),
  CONFIG: JSON.stringify(labConfig).replace(/</g, '\\u003c')
}));
await output('Photo/gallery.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta http-equiv="refresh" content="0;url=/photos/"><meta name="robots" content="noindex"><link rel="canonical" href="' + escape(new URL('/photos/', origin).href) + '">'
  + '<title>Photography — ' + escape(site.name) + '</title></head><body><h1>The gallery has moved.</h1><p><a href="/photos/">Explore the photography collection</a></p></body></html>');
await output('robots.txt', 'User-agent: *\nAllow: /\nSitemap: ' + new URL('/sitemap.xml', origin).href + '\n');
await output('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + escape(origin.href) + '</loc></url><url><loc>' + escape(new URL('/photos/', origin).href) + '</loc></url><url><loc>' + escape(new URL('/phantom/', origin).href) + '</loc></url><url><loc>' + escape(new URL('/guestbook/', origin).href) + '</loc></url><url><loc>' + escape(new URL('/mountain/', origin).href) + '</loc></url></urlset>\n');
await output('CNAME', origin.hostname + '\n');
await output('.nojekyll', '');

// Drop cached encodes no longer referenced, so the local and CI caches do not grow forever.
for (const name of await readdir(cache)) if (!usedCache.has(name)) await rm(path.join(cache, name), { force: true });

const report = { originalBytes, displayImageBytes: imageBytes, photoCount: generated.length, photos: generated.map(({ id, source, originalSha256, large, versions }) => ({ id, source, originalSha256, large, versions })) };
await writeFile(path.join(root, '.cache/build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Built ' + generated.length + ' photographs. Display images: ' + (imageBytes / 1048576).toFixed(2) + ' MiB; masters: ' + (originalBytes / 1048576).toFixed(2) + ' MiB.');
