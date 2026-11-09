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
const allowedRoots = new Set(['index.html', '404.html', 'favicon.svg', 'robots.txt', 'sitemap.xml', 'CNAME', '.nojekyll', 'assets', 'photos', 'guestbook', 'Photo', 'phantom', 'mountain', 'legacy', 'eras', 'strata']);
for (const file of files) assert(allowedRoots.has(file.split('/')[0]), 'Unexpected published file: ' + file);
assert.equal(report.photoCount, photos.length, 'Build report must match the current manifest.');
assert.equal(report.photos.length, photos.length);
const htmlFiles = files.filter(file => file.endsWith('.html'));
const htmlByFile = new Map(await Promise.all(htmlFiles.map(async file => [file, await readFile(path.join(dist, file), 'utf8')])));

function targetFor(value, from) {
  // /api/ is answered by Workers (the guestbook, the hunt), not by files.
  if (/^(?:https?:|mailto:|tel:|data:)/i.test(value) || value.startsWith('/api/')) return null;
  const url = new URL(value.replaceAll('&amp;', '&'), 'https://site.test/' + from);
  const target = decodeURIComponent(url.pathname).replace(/^\//, '');
  return { target: target.endsWith('/') || !target ? target + 'index.html' : target, hash: decodeURIComponent(url.hash.slice(1)) };
}
let checkedLinks = 0;
for (const [file, html] of htmlByFile) {
  assert(!/\{\{[A-Z_]+\}\}/.test(html), 'Unresolved template in ' + file);
  assert(/<html lang="[^"]+"/i.test(html), 'Missing document language: ' + file);
  // Case-insensitive throughout: the pages under /eras/ for the early years are written in upper-case HTML.
  assert(/<title>[^<]+<\/title>/i.test(html), 'Missing title: ' + file);
  const ids = [...html.matchAll(/\bid="([^"]+)"/gi)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate element ID: ' + file);
  const references = [...html.matchAll(/\b(?:href|src|background)="([^"]+)"/gi)].map(match => match[1]);
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
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    assert(/\balt="[^"]*"/i.test(match[0]), 'Image missing alt: ' + file);
    assert(/\bwidth="\d+"/i.test(match[0]) && /\bheight="\d+"/i.test(match[0]), 'Image dimensions missing: ' + file);
  }
}
const home = htmlByFile.get('index.html');
const gallery = htmlByFile.get('photos/index.html');
assert.equal([...gallery.matchAll(/\bdata-photo="/g)].length, photos.length, 'Every photo needs a static gallery link.');
assert(/<dialog\b/.test(gallery) && /id="dialog-close"/.test(gallery), 'Gallery dialog controls are missing.');
const legacy = htmlByFile.get('legacy/index.html');
assert(/id="phantom-shape" disabled/.test(legacy), 'No-JavaScript shape selector must be disabled.');
// The earlier home page stays reachable at /legacy/ but out of sight: not indexed, not in the sitemap, linked only from /eras/ (as 2025).
assert(legacy.includes('name="robots" content="noindex"'), 'The legacy home page must not be indexed.');
assert(!(await readFile(path.join(dist, 'sitemap.xml'), 'utf8')).includes('/legacy/'), 'The legacy home page stays out of the sitemap.');
for (const [file, html] of htmlByFile) if (!file.startsWith('eras/')) assert(!/href="\/legacy\//i.test(html), 'Only the other years link to the legacy home page: ' + file);
assert(home.includes('name="description"') && gallery.includes('rel="canonical"'), 'SEO metadata is missing.');
assert(htmlByFile.get('Photo/gallery.html').includes('http-equiv="refresh"'), 'Old gallery must work without JavaScript.');
assert(htmlByFile.get('404.html').includes('name="robots" content="noindex"'), 'The 404 page must not be indexed.');
// The mountain is the home page; /mountain/ only forwards to it, keeping the camp in the hash.
const mountainPage = home;
const moved = htmlByFile.get('mountain/index.html');
assert(moved.includes('http-equiv="refresh" content="0;url=/"') && moved.includes('name="robots" content="noindex"') && /<script src="\/assets\/moved-[0-9a-f]+\.js">/.test(moved), 'The old mountain address must forward to the home page.');
const mountainCamps = JSON.parse(await readFile(path.join(root, 'content/mountain.json'), 'utf8')).camps;
assert(home.includes('class="mountain-page"') && !home.includes('noindex') && home.includes('rel="canonical" href="' + new URL('/', site.url).href + '"'), 'The home page is the mountain, indexed at the root.');
assert(!(await readFile(path.join(dist, 'sitemap.xml'), 'utf8')).includes('/mountain/'), 'The old mountain address stays out of the sitemap.');
const mountainImage = /property="og:image" content="https?:\/\/[^/]+\/([^"]+)"/.exec(mountainPage)?.[1];
assert(mountainImage && exactFiles.has(mountainImage), 'The mountain page needs its share image.');
assert.equal([...mountainPage.matchAll(/<li id="/g)].length, mountainCamps.length, 'Every camp needs a plain link for readers without WebGL.');
const labPage = htmlByFile.get('phantom/index.html');
assert(!labPage.includes('noindex') && (await readFile(path.join(dist, 'sitemap.xml'), 'utf8')).includes(new URL('/phantom/', site.url).href), 'The lab page is public: indexed and in the sitemap.');
assert(gallery.includes('href="/phantom/"') && home.includes('href="/phantom/"'), 'The navigation and the mountain link to the lab.');
const labConfig = JSON.parse(labPage.match(/<script type="application\/json" id="lab-config">([^<]*)<\/script>/)[1]);
for (const url of JSON.stringify(labConfig).match(/\/assets\/[^"]+/g)) assert(exactFiles.has(url.slice(1)), 'Lab config points at a missing file: ' + url);
assert(labConfig.shapes.length === site.phantom.shapes.length, 'Every Phantom shape belongs in the lab.');
for (const stop of labConfig.atlas.stops) {
  if (stop.vantage) assert(labConfig.atlas.frames.stops[stop.id], 'Atlas stop has no solved camera (run tools/phantom-data atlas.mjs frames): ' + stop.id);
  if (stop.cloud) assert(labConfig.atlas.clouds[stop.cloud], 'Atlas stop has no point cloud: ' + stop.id);
  if (stop.photos) assert(stop.photos.every(photo => photo && photo.url), 'Atlas strip has a missing print: ' + stop.id);
}
// Every photograph has its own page (Develop, and Atlas where its city is live), linked from the gallery and the sitemap.
for (const photo of photos) {
  const page = htmlByFile.get('photos/' + photo.id + '/index.html');
  assert(page && /id="lab-config"/.test(page) && /data-chapter="develop"/.test(page), 'Photograph page is missing: ' + photo.id);
  assert(gallery.includes('href="/photos/' + photo.id + '/"'), 'The gallery must link to the page of ' + photo.id);
  assert((await readFile(path.join(dist, 'sitemap.xml'), 'utf8')).includes(new URL('/photos/' + photo.id + '/', site.url).href), 'Sitemap misses the page of ' + photo.id);
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

// Other years: every year has a home page, its pages stay out of search results, the dial links to each year, and
// the scripts that show guestbook notes never turn note text into HTML.
const eraYears = JSON.parse(await readFile(path.join(root, 'content/eras.json'), 'utf8')).eras.map(era => era.year);
const dial = htmlByFile.get('eras/index.html');
assert(dial && sitemap.includes(new URL('/eras/', site.url).href) && !dial.includes('noindex'), 'The /eras/ dial is public and in the sitemap.');
for (const year of eraYears) {
  assert(htmlByFile.has('eras/' + year + '/index.html'), 'Year without a home page: ' + year);
  assert(dial.includes('href="/eras/' + year + '/"'), 'The dial does not link to ' + year);
}
// The ring ends on the site's own versions: 2025 is the earlier home page, 2026 the mountain.
const eraVersions = JSON.parse(await readFile(path.join(root, 'content/eras.json'), 'utf8')).versions;
assert.deepEqual(eraVersions.map(version => [version.year, version.href]), [[2025, '/legacy/'], [2026, '/']], 'The last two years are the legacy page (2025) and the home page (2026).');
for (const version of eraVersions) assert(dial.includes('href="' + version.href + '"'), 'The dial does not link to ' + version.year);
for (const [file, html] of htmlByFile) {
  if (file.startsWith('eras/') && file !== 'eras/index.html') assert(/<meta name="robots" content="noindex"/i.test(html), 'Pages of other years are not indexed: ' + file);
}
for (const file of files.filter(file => file.startsWith('eras/') && file.endsWith('.js'))) {
  assert.doesNotMatch(await readFile(path.join(dist, file), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, 'Era scripts must not build HTML from strings: ' + file);
}

// Strata (/strata/), the hunt: its hub stays out of the index and the sitemap and is reached from /eras/. The puzzle
// data comes from the private solution book; the repository holds only keyed hashes of the answers.
const strataRows = JSON.parse(await readFile(path.join(root, 'content/strata.json'), 'utf8')).rows;
const hub = htmlByFile.get('strata/index.html');
assert(hub && hub.includes('name="robots" content="noindex"') && !sitemap.includes('/strata/'), 'The Strata hub is out of the index and the sitemap.');
assert(dial.includes('href="/strata/"'), 'The /eras/ dial leads to Strata.');
assert.equal([...hub.matchAll(/<li class="stratum /g)].length, strataRows.length, 'One stratum on the hub per row of content/strata.json.');
assert((await readFile(path.join(dist, 'robots.txt'), 'utf8')).includes('Disallow: /eras/1996/private/') && htmlByFile.has('eras/1996/private/index.html'), 'robots.txt points at the private folder, and it exists.');
const answerHashes = await readFile(path.join(root, 'hunt/src/answers.js'), 'utf8');
for (const row of strataRows) assert(new RegExp('"' + row.id + '": "[0-9a-f]{64}"').test(answerHashes), 'No answer hash for ' + row.id);

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
