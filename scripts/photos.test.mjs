import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { masterEdge, runPhotos } from './photos.mjs';
import { validatePhotos } from './photo-data.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'g3rry-photos-'));
  t.after(() => rm(root, { recursive: true, force: true })); // Only this freshly-created test directory.
  await mkdir(path.join(root, 'Photo'));
  await mkdir(path.join(root, 'content'));
  const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#c9af77' } }).jpeg().toBuffer();
  await writeFile(path.join(root, 'Photo/first.jpg'), jpeg);
  await writeFile(path.join(root, 'Photo/second.JPG'), jpeg);
  const photos = [
    { id: 'p01', source: 'Photo/first.jpg', alt: 'A first test frame.', featured: true },
    { id: 'p02', source: 'Photo/second.JPG', alt: 'A second test frame.', featured: false }
  ];
  await writeFile(path.join(root, 'content/photos.json'), JSON.stringify(photos) + '\n');
  await writeFile(path.join(root, 'content/site.json'), JSON.stringify({ hero: { photoId: 'p01' } }));
  const run = args => runPhotos(args, { root, log() {} });
  const read = async () => JSON.parse(await readFile(path.join(root, 'content/photos.json'), 'utf8'));
  return { root, photos, jpeg, run, read };
}
async function tree(root, prefix = '') {
  const result = {};
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await tree(root, name + '/'));
    else result[name] = (await readFile(path.join(root, name))).toString('base64');
  }
  return result;
}

test('dry-run validates imports but changes no file and creates no cache', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'new.jpg'), f.jpeg);
  const before = await tree(f.root);
  await f.run(['add', path.join(f.root, 'new.jpg'), '--alt', 'A real description.', '--dry-run']);
  await f.run(['move', 'p02', '--before', 'p01', '--dry-run']);
  assert.deepEqual(await tree(f.root), before);
});

for (const format of ['jpeg', 'png', 'webp']) {
  test('import ' + format + ' verifies content and stores a stripped JPEG web master', async t => {
    const f = await fixture(t);
    const bytes = await sharp({ create: { width: 24, height: 40, channels: 4, background: '#44556688' } }).withMetadata({ exif: { IFD0: { Artist: 'Test' } } })[format]().toBuffer();
    const input = path.join(f.root, 'Fresh image.' + format);
    await writeFile(input, bytes);
    await f.run(['add', input, '--alt', 'A vertical test frame.', '--featured']);
    const actual = await f.read();
    assert.deepEqual(actual.slice(0, 2), f.photos);
    assert.equal(actual[2].id, 'p03');
    assert.equal(actual[2].featured, true);
    assert.equal(actual[2].source, 'Photo/p03-fresh-image.jpg');
    const master = await sharp(await readFile(path.join(f.root, actual[2].source))).metadata();
    assert.equal(master.format, 'jpeg');
    assert.equal(master.width, 24);
    assert(!master.exif, 'Web masters must not keep camera metadata.');
    await validatePhotos(f.root, actual, 'p01');
    await assert.rejects(f.run(['add', path.join(f.root, actual[2].source), '--alt', 'Duplicate']), /already in the collection/);
    assert.deepEqual(await f.read(), actual);
    assert(!('photos.lock' in await tree(path.join(f.root, '.cache'))));
  });
}

test('large imports are reduced to the web master size', async t => {
  const f = await fixture(t);
  const input = path.join(f.root, 'wide.jpg');
  await writeFile(input, await sharp({ create: { width: 3600, height: 40, channels: 3, background: '#223344' } }).jpeg().toBuffer());
  await f.run(['add', input, '--alt', 'A very wide test frame.']);
  const master = await sharp(await readFile(path.join(f.root, (await f.read()).at(-1).source))).metadata();
  assert.equal(master.width, masterEdge);
});

test('move changes only ordering; stable IDs, descriptions and featured stay intact', async t => {
  const f = await fixture(t);
  await f.run(['move', 'p02', '--before', 'p01']);
  assert.deepEqual(await f.read(), [f.photos[1], f.photos[0]]);
  await f.run(['move', 'p02', '--after', 'p01']);
  assert.deepEqual(await f.read(), f.photos);
  await f.run(['feature', 'p02', 'true']);
  const description = '雨中的街道 — “光影” & <reflections> ☂';
  await f.run(['alt', 'p02', description]);
  assert.deepEqual((await f.read())[1], { ...f.photos[1], featured: true, alt: description });
});

test('invalid files, unknown IDs/options and last-feature removal leave originals/list untouched', async t => {
  const f = await fixture(t);
  const bad = path.join(f.root, 'broken.jpg');
  await writeFile(bad, 'not an image');
  const before = await tree(f.root);
  for (const args of [
    ['add', bad, '--alt', 'Invalid'], ['add', bad, '--alt', ''],
    ['move', 'p99', '--before', 'p01'], ['move', 'p01', '--before', 'p99'],
    ['move', 'p01', '--before', 'p01'], ['move', 'p01', '--before', 'p02', '--after', 'p02'],
    ['feature', 'p01', 'false'], ['feature', 'p02', 'yes'], ['alt', 'p01', ' '],
    ['list', '--featured'], ['add', bad, '--unknown']
  ]) await assert.rejects(f.run(args));
  assert.deepEqual(await tree(f.root), before);
});

test('reserved original names are never overwritten or reused for a stable ID', async t => {
  const f = await fixture(t);
  const reserved = path.join(f.root, 'Photo/p03-fresh.jpg');
  await writeFile(reserved, 'unlisted original stays untouched');
  const input = path.join(f.root, 'fresh.jpg');
  await writeFile(input, f.jpeg);
  await f.run(['add', input, '--alt', 'New frame']);
  assert.equal((await f.read()).at(-1).id, 'p04');
  assert.equal(await readFile(reserved, 'utf8'), 'unlisted original stays untouched');
});

test('an active edit lock rejects a concurrent writer without changing the manifest', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, '.cache'));
  await writeFile(path.join(f.root, '.cache/photos.lock'), 'owned by another edit');
  await assert.rejects(f.run(['move', 'p02', '--before', 'p01']), /Another photo edit/);
  assert.deepEqual(await f.read(), f.photos);
  assert.equal(await readFile(path.join(f.root, '.cache/photos.lock'), 'utf8'), 'owned by another edit');
});

test('shared validation rejects escaping, wrong-case and case-conflicting source paths', async t => {
  const f = await fixture(t);
  for (const source of ['Photo/../first.jpg', 'photo/first.jpg', 'Photo/FIRST.jpg']) {
    await assert.rejects(validatePhotos(f.root, [{ ...f.photos[0], source }], 'p01'));
  }
  await assert.rejects(validatePhotos(f.root, [f.photos[0], { ...f.photos[1], source: 'Photo/FIRST.jpg' }], 'p01'));
});
