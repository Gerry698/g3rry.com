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
const transform = { sharp: sharp.versions.sharp, webp: { quality: 80, effort: 4 }, jpeg: { quality: 86, mozjpeg: true }, autoOrient: true, maxWidth: 1920 };
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
async function cachedImage(name, produce) {
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
  for (const width of [...new Set([640, 1280, 1920].map(width => Math.min(width, sourceWidth)))]) {
    const name = photo.id + '-' + hash + '-' + transformHash + '-' + width + '.webp';
    const bytes = await cachedImage(name, () => resized(width).webp(transform.webp).toBuffer());
    await output('assets/photos/' + name, bytes);
    imageBytes += bytes.length;
    versions.push({ width, url: '/assets/photos/' + name });
  }
  const width = Math.min(1920, sourceWidth);
  const jpegName = photo.id + '-' + hash + '-' + transformHash + '-' + width + '.jpg';
  const jpeg = await cachedImage(jpegName, () => resized(width).jpeg(transform.jpeg).toBuffer());
  await output('assets/photos/' + jpegName, jpeg);
  imageBytes += jpeg.length;
  originalBytes += input.length;
  generated.push({
    ...photo, versions, large: '/assets/photos/' + jpegName, width, height: Math.round(sourceHeight * width / sourceWidth),
    srcset: versions.map(version => version.url + ' ' + version.width + 'w').join(', '),
    originalSha256: createHash('sha256').update(input).digest('hex')
  });
}

// Particle masks are sampled to roughly two thousand points, so a small, palette-reduced copy is enough.
const shapes = [];
for (const shape of site.phantom.shapes) {
  const input = await readFile(path.join(root, shape.source));
  const extension = path.extname(shape.source).toLowerCase();
  const image = sharp(input).resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true });
  const bytes = extension === '.png' ? await image.png({ palette: true, compressionLevel: 9 }).toBuffer() : await image.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  const metadata = await sharp(bytes).metadata();
  const url = '/assets/marks/' + shape.id + '-' + digest(bytes) + extension;
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
function picture(photo, layoutName) {
  const hero = layoutName === 'hero';
  return '<picture><source type="image/webp" srcset="' + photo.srcset + '" sizes="' + sizes[layoutName] + '">'
    + '<img src="' + photo.large + '" alt="' + escape(photo.alt) + '" width="' + photo.width + '" height="' + photo.height + '"'
    + ' loading="' + (hero ? 'eager' : 'lazy') + '" decoding="async"' + (hero ? ' fetchpriority="high"' : '') + '></picture>';
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
  HERO_PICTURE: picture(hero, 'hero'), FEATURED_TITLE: lines(site.photography.featuredTitle), FEATURED_PHOTOS: featuredPhotos.join('\n'),
  PHANTOM_TITLE: escape(site.phantom.title), PHANTOM_DESCRIPTION: escape(site.phantom.description),
  PHANTOM_OPTIONS: shapes.map(shape => '<option value="' + shape.id + '" data-src="' + shape.url + '">' + escape(shape.label) + '</option>').join(''),
  PHANTOM_DEFAULT: shapes[0].url, PHANTOM_WIDTH: shapes[0].width, PHANTOM_HEIGHT: shapes[0].height
});
await output('index.html', render(home, { title: site.title, description: site.description, route: '/', pageClass: 'home-page', script: particleScript }));

const galleryPhotos = generated.map((photo, index) =>
  '<figure class="photo-card" id="photo-' + photo.id + '"><a data-photo="' + photo.id + '" data-srcset="' + photo.srcset + '"'
  + ' data-width="' + photo.width + '" data-height="' + photo.height + '" href="' + photo.large + '" aria-label="View photograph: ' + escape(photo.alt) + '">'
  + picture(photo, 'grid') + '</a><figcaption><span>' + frame(index) + '</span><span>View photograph ↗</span></figcaption></figure>');
const gallery = replace(await readFile(path.join(root, 'src/photos.html'), 'utf8'), {
  PHOTO_COUNT: String(generated.length).padStart(2, '0'), COLLECTION_TITLE: escape(site.photography.title), COLLECTION_DESCRIPTION: escape(site.photography.description),
  SIZES_GRID: sizes.grid, SIZES_LARGE: sizes.large, GALLERY_PHOTOS: galleryPhotos.join('\n')
});
await output('photos/index.html', render(gallery, { title: site.photography.title + ' — ' + site.name, description: site.photography.description, route: '/photos/', pageClass: 'gallery-page', script: galleryScript }));

await output('404.html', render(
  '<section class="simple-page wrap"><p class="eyebrow">404 / A small detour</p><h1>This frame is missing.</h1><p>The page may have moved. There are still plenty of moments to explore.</p><a class="text-link" href="/photos/">Explore the photographs ↗</a></section>',
  { title: 'Page not found — ' + site.name, description: 'Find your way back to the photographs.', route: '/404.html', pageClass: 'error-page', noindex: true }));
await output('Photo/gallery.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta http-equiv="refresh" content="0;url=/photos/"><meta name="robots" content="noindex"><link rel="canonical" href="' + escape(new URL('/photos/', origin).href) + '">'
  + '<title>Photography — ' + escape(site.name) + '</title></head><body><h1>The gallery has moved.</h1><p><a href="/photos/">Explore the photography collection</a></p></body></html>');
await output('robots.txt', 'User-agent: *\nAllow: /\nSitemap: ' + new URL('/sitemap.xml', origin).href + '\n');
await output('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + escape(origin.href) + '</loc></url><url><loc>' + escape(new URL('/photos/', origin).href) + '</loc></url></urlset>\n');
await output('CNAME', origin.hostname + '\n');
await output('.nojekyll', '');

const report = { originalBytes, displayImageBytes: imageBytes, photoCount: generated.length, photos: generated.map(({ id, source, originalSha256, large, versions }) => ({ id, source, originalSha256, large, versions })) };
await writeFile(path.join(root, '.cache/build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Built ' + generated.length + ' photographs. Display images: ' + (imageBytes / 1048576).toFixed(2) + ' MiB; masters: ' + (originalBytes / 1048576).toFixed(2) + ' MiB.');
