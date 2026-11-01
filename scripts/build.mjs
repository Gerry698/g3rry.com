import { createHash } from 'node:crypto';
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
  if (camp.href !== undefined && !/^\/(?!\/)/.test(camp.href)) throw new Error('Camp links must be site paths: ' + camp.id);
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
const particleScript = await asset('particles.js', 'particles');
// The mountain is a folder of ES modules (plus its fonts); hashing the folder as a whole keeps relative
// imports and url()s intact.
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
  'instrument-serif.woff2': 'node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2',
  'jetbrains-mono.woff2': 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2'
});
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
function render(body, { title, description, route, pageClass, script = '', noindex = false }) {
  return replace(layout, {
    LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape(title),
    DESCRIPTION: escape(description), CANONICAL: escape(new URL(route, origin).href),
    SOCIAL_IMAGE: escape(new URL(hero.large, origin).href), SOCIAL_ALT: escape(hero.alt),
    SOCIAL_WIDTH: hero.width, SOCIAL_HEIGHT: hero.height,
    STYLES: styles, PAGE_CLASS: pageClass, BODY: body, YEAR: new Date().getUTCFullYear(),
    HOME_CURRENT: route === '/' ? 'aria-current="page"' : '',
    PHOTOS_CURRENT: route === '/photos/' ? 'aria-current="page"' : '',
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

await output('404.html', render(
  '<section class="simple-page wrap"><p class="eyebrow">404 / A small detour</p><h1>This frame is missing.</h1><p>The page may have moved. There are still plenty of moments to explore.</p><a class="text-link" href="/photos/">Explore the photographs ↗</a></section>',
  { title: 'Page not found — ' + site.name, description: 'Find your way back to the photographs.', route: '/404.html', pageClass: 'error-page', noindex: true }));
// The mountain page has its own full-screen shell but shares the site's Content-Security-Policy.
const mountainScript = mountainFiles.find(file => file.endsWith('/main.js'));
const camps = mountain.camps.map((camp, index) => '<li id="' + camp.id + '" data-kicker="' + escape(camp.kicker || 'Camp ' + numerals[index]) + '"' + (camp.time ? ' data-time="' + camp.time + '"' : '') + '>'
  + '<a href="' + escape(camp.href || '#' + camp.id) + '"' + (camp.href ? '' : ' data-pending') + '><span class="camp-number">' + numerals[index] + '</span><span class="camp-title">' + escape(camp.title) + '</span></a>'
  + '<p>' + escape(camp.description) + '</p></li>');
await output('mountain/index.html', replace(await readFile(path.join(root, 'src/mountain/page.html'), 'utf8'), {
  LANGUAGE: escape(site.language), NAME: escape(site.name), TITLE: escape(mountain.title), DESCRIPTION: escape(mountain.description),
  CANONICAL: escape(new URL('/mountain/', origin).href), CSP: layout.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0],
  STYLES: mountainFiles.find(file => file.endsWith('.css')), SCRIPT: mountainScript,
  PRELOADS: [...mountainFiles.filter(file => file.endsWith('.woff2')).map(file => '<link rel="preload" href="' + file + '" as="font" type="font/woff2" crossorigin>'),
    ...mountainFiles.filter(file => file.endsWith('.js') && file !== mountainScript).map(file => '<link rel="modulepreload" href="' + file + '">')].join('\n  '),
  INTRO_KICKER: escape(mountain.intro.kicker), INTRO_TITLE: escape(mountain.intro.title), INTRO_DESCRIPTION: escape(mountain.intro.description),
  INTRO_HINT: escape(mountain.intro.hint), CAMPS: camps.join('\n        ')
}));
await output('Photo/gallery.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta http-equiv="refresh" content="0;url=/photos/"><meta name="robots" content="noindex"><link rel="canonical" href="' + escape(new URL('/photos/', origin).href) + '">'
  + '<title>Photography — ' + escape(site.name) + '</title></head><body><h1>The gallery has moved.</h1><p><a href="/photos/">Explore the photography collection</a></p></body></html>');
await output('robots.txt', 'User-agent: *\nAllow: /\nSitemap: ' + new URL('/sitemap.xml', origin).href + '\n');
await output('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + escape(origin.href) + '</loc></url><url><loc>' + escape(new URL('/photos/', origin).href) + '</loc></url></urlset>\n');
await output('CNAME', origin.hostname + '\n');
await output('.nojekyll', '');

// Drop cached encodes no longer referenced, so the local and CI caches do not grow forever.
for (const name of await readdir(cache)) if (!usedCache.has(name)) await rm(path.join(cache, name), { force: true });

const report = { originalBytes, displayImageBytes: imageBytes, photoCount: generated.length, photos: generated.map(({ id, source, originalSha256, large, versions }) => ({ id, source, originalSha256, large, versions })) };
await writeFile(path.join(root, '.cache/build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Built ' + generated.length + ' photographs. Display images: ' + (imageBytes / 1048576).toFixed(2) + ' MiB; masters: ' + (originalBytes / 1048576).toFixed(2) + ' MiB.');
