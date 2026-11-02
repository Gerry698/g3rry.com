import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const photos = JSON.parse(await readFile(path.join(root, 'content/photos.json'), 'utf8'));
const site = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
const report = JSON.parse(await readFile(path.join(root, '.cache/build-report.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), name + '/'));
    else if (entry.isFile()) files.push(name);
    else throw new Error('Unexpected output entry: ' + name);
  }
  return files;
}
const files = await walk(dist);
const exactFiles = new Set(files);
const allowedRoots = new Set(['index.html', '404.html', 'favicon.svg', 'robots.txt', 'sitemap.xml', 'CNAME', '.nojekyll', 'assets', 'photos', 'guestbook', 'Photo', 'phantom', 'mountain']);
for (const file of files) assert(allowedRoots.has(file.split('/')[0]), 'Unexpected published file: ' + file);
assert.equal(report.photoCount, photos.length, 'Build report must match the current manifest.');
assert.equal(report.photos.length, photos.length);
const htmlFiles = files.filter(file => file.endsWith('.html'));
const htmlByFile = new Map(await Promise.all(htmlFiles.map(async file => [file, await readFile(path.join(dist, file), 'utf8')])));

function targetFor(value, from) {
  if (/^(?:https?:|mailto:|tel:|data:)/i.test(value)) return null;
  const url = new URL(value.replaceAll('&amp;', '&'), 'https://site.test/' + from);
  const target = decodeURIComponent(url.pathname).replace(/^\//, '');
  return { target: target.endsWith('/') || !target ? target + 'index.html' : target, hash: decodeURIComponent(url.hash.slice(1)) };
}
let checkedLinks = 0;
for (const [file, html] of htmlByFile) {
  assert(!/\{\{[A-Z_]+\}\}/.test(html), 'Unresolved template in ' + file);
  assert(/<html lang="[^"]+"/.test(html), 'Missing document language: ' + file);
  assert(/<title>[^<]+<\/title>/.test(html), 'Missing title: ' + file);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate element ID: ' + file);
  const references = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  for (const match of html.matchAll(/\bsrcset="([^"]+)"/g)) references.push(...match[1].split(',').map(candidate => candidate.trim().split(/\s+/)[0]));
  for (const reference of references) {
    const result = targetFor(reference, file);
    if (!result) continue;
    assert(exactFiles.has(result.target), 'Missing or incorrectly cased link in ' + file + ': ' + reference);
    if (result.hash && htmlByFile.has(result.target)) {
      assert(htmlByFile.get(result.target).includes('id="' + result.hash + '"'), 'Missing anchor: ' + reference);
    }
    checkedLinks++;
  }
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    assert(/\balt="[^"]*"/.test(match[0]), 'Image missing alt: ' + file);
    assert(/\bwidth="\d+"/.test(match[0]) && /\bheight="\d+"/.test(match[0]), 'Image dimensions missing: ' + file);
  }
}
const home = htmlByFile.get('index.html');
const gallery = htmlByFile.get('photos/index.html');
assert.equal([...gallery.matchAll(/\bdata-photo="/g)].length, photos.length, 'Every photo needs a static gallery link.');
assert(/<dialog\b/.test(gallery) && /id="dialog-close"/.test(gallery), 'Gallery dialog controls are missing.');
assert(/id="phantom-shape" disabled/.test(home), 'No-JavaScript shape selector must be disabled.');
assert(home.includes('name="description"') && gallery.includes('rel="canonical"'), 'SEO metadata is missing.');
assert(htmlByFile.get('Photo/gallery.html').includes('http-equiv="refresh"'), 'Old gallery must work without JavaScript.');
assert(htmlByFile.get('404.html').includes('name="robots" content="noindex"'), 'The 404 page must not be indexed.');
const mountainPage = htmlByFile.get('mountain/index.html');
const mountainCamps = JSON.parse(await readFile(path.join(root, 'content/mountain.json'), 'utf8')).camps;
assert(!mountainPage.includes('noindex') && (await readFile(path.join(dist, 'sitemap.xml'), 'utf8')).includes(new URL('/mountain/', site.url).href), 'The mountain page is public: indexed and in the sitemap.');
assert(home.includes('href="/mountain/"'), 'The site navigation links to the mountain.');
const mountainImage = /property="og:image" content="https?:\/\/[^/]+\/([^"]+)"/.exec(mountainPage)?.[1];
assert(mountainImage && exactFiles.has(mountainImage), 'The mountain page needs its share image.');
assert.equal([...mountainPage.matchAll(/<li id="/g)].length, mountainCamps.length, 'Every camp needs a plain link for readers without WebGL.');
const labPage = htmlByFile.get('phantom/index.html');
assert(!labPage.includes('noindex') && (await readFile(path.join(dist, 'sitemap.xml'), 'utf8')).includes(new URL('/phantom/', site.url).href), 'The lab page is public: indexed and in the sitemap.');
assert(home.includes('href="/phantom/"'), 'The home page links to the lab.');
const labConfig = JSON.parse(labPage.match(/<script type="application\/json" id="lab-config">([^<]*)<\/script>/)[1]);
for (const url of JSON.stringify(labConfig).match(/\/assets\/[^"]+/g)) assert(exactFiles.has(url.slice(1)), 'Lab config points at a missing file: ' + url);
assert(labConfig.shapes.length === site.phantom.shapes.length, 'Every Phantom shape belongs in the lab.');
for (const stop of labConfig.atlas.stops) {
  if (stop.vantage) assert(labConfig.atlas.frames.stops[stop.id], 'Atlas stop has no solved camera (run tools/phantom-data atlas.mjs frames): ' + stop.id);
  if (stop.cloud) assert(labConfig.atlas.clouds[stop.cloud], 'Atlas stop has no point cloud: ' + stop.id);
  if (stop.photos) assert(stop.photos.every(photo => photo && photo.url), 'Atlas strip has a missing print: ' + stop.id);
}
assert.deepEqual(files.filter(file => file.startsWith('Photo/')), ['Photo/gallery.html'], 'Only the old gallery redirect belongs under Photo/.');
assert.equal((await readFile(path.join(dist, 'CNAME'), 'utf8')).trim(), new URL(site.url).hostname);
const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
assert(sitemap.includes(new URL('/photos/', site.url).href) && sitemap.includes(new URL('/guestbook/', site.url).href), 'Sitemap is incomplete.');

// Guestbook: Turnstile is allowed on that page only, its script never parses HTML, and a release never ships a dummy key.
const guestbook = htmlByFile.get('guestbook/index.html');
const siteKey = /id="note-form" data-sitekey="([0-9A-Za-z_-]+)"/.exec(guestbook ?? '')?.[1];
assert(siteKey, 'Guestbook form is missing.');
for (const [file, html] of htmlByFile) {
  if (file === 'Photo/gallery.html') continue;
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  assert(policy.includes("default-src 'self'") && policy.includes("object-src 'none'"), 'Missing CSP: ' + file);
  assert.equal(policy.includes('challenges.cloudflare.com'), file === 'guestbook/index.html', 'Turnstile belongs only to the guestbook page: ' + file);
}
const guestbookScript = files.find(file => /^assets\/guestbook-[0-9a-f]{12}\.js$/.test(file));
assert(guestbookScript, 'Guestbook script is missing.');
assert.doesNotMatch(await readFile(path.join(dist, guestbookScript), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, 'The guestbook script must not build HTML from strings.');
// Cloudflare's dummy site keys pass every visitor in the browser and are refused by the production secret.
if (process.env.CI) assert(!/^[123]x0{20}/.test(siteKey), 'The guestbook still uses a Turnstile testing key.');

let derivedBytes = 0;
for (const photo of photos) {
  const generated = report.photos.find(item => item.id === photo.id);
  assert(generated, 'Missing built photo: ' + photo.id);
  assert.equal(sha(await readFile(path.join(root, photo.source))), generated.originalSha256, 'Source changed since build: ' + photo.source);
  for (const file of [generated.large, ...generated.versions.flatMap(version => [version.avif, version.webp])]) {
    assert(exactFiles.has(file.slice(1)), 'Missing derived photo: ' + file);
    const bytes = await readFile(path.join(dist, file.slice(1)));
    const metadata = await sharp(bytes).metadata();
    assert(metadata.width <= 1920, 'Derived photo is oversized: ' + file);
    assert(!metadata.exif && !metadata.iptc && !metadata.xmp, 'Photo metadata was retained: ' + file);
    derivedBytes += bytes.length;
  }
}
assert.equal(derivedBytes, report.displayImageBytes, 'Image-size report is stale.');
for (const pathname of ['scripts', 'src', 'content', 'docs', 'node_modules', 'package.json', '.git']) {
  assert(!files.some(file => file === pathname || file.startsWith(pathname + '/')), 'Private build/source material was published.');
}
const totalBytes = (await Promise.all(files.map(async file => (await stat(path.join(dist, file))).size))).reduce((sum, size) => sum + size, 0);
console.log('Checked ' + photos.length + ' photos, ' + checkedLinks + ' local references, ' + files.length + ' published files (' + (totalBytes / 1048576).toFixed(2) + ' MiB).');
