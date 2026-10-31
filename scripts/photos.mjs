import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { sourcePattern, validatePhotos } from './photo-data.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const masterEdge = 3200;
const help = `Photo collection commands (run from the repository):
  npm run photos -- list
  npm run photos -- add "path/to/photo.jpg" --alt "Describe the actual frame" [--featured] [--dry-run]
  npm run photos -- move p16 --before p03 [--dry-run]
  npm run photos -- move p16 --after p03 [--dry-run]
  npm run photos -- feature p16 true|false [--dry-run]
  npm run photos -- alt p16 "New description" [--dry-run]
New photos are stored as web masters (long edge ≤ ${masterEdge}px, orientation applied, metadata removed);
keep camera originals outside this public repository. IDs and photo links survive reordering.
No command commits, pushes or publishes.`;
const serialize = photos => '[\n' + photos.map(photo => '  ' + JSON.stringify(photo)).join(',\n') + '\n]\n';

function parse(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) positional.push(arg);
    else {
      if (!['--dry-run', '--featured', '--alt', '--before', '--after'].includes(arg) || arg in flags) throw new Error('Unknown or repeated option: ' + arg);
      if (['--dry-run', '--featured'].includes(arg)) flags[arg] = true;
      else {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
        flags[arg] = value;
      }
    }
  }
  const [command, ...values] = positional;
  const allowed = { list: [], add: ['--alt', '--featured', '--dry-run'], move: ['--before', '--after', '--dry-run'], feature: ['--dry-run'], alt: ['--dry-run'] };
  if (!Object.hasOwn(allowed, command)) throw new Error(help);
  for (const flag of Object.keys(flags)) if (!allowed[command].includes(flag)) throw new Error(flag + ' is not valid for ' + command);
  if (values.length !== ({ list: 0, add: 1, move: 1, feature: 2, alt: 2 })[command]) throw new Error('Incorrect arguments.\n' + help);
  return { command, values, flags };
}

async function containedDirectory(root, name) {
  const actualRoot = await realpath(root);
  const directory = await realpath(path.join(root, name));
  if (!directory.startsWith(actualRoot + path.sep)) throw new Error('Directory must stay inside the repository: ' + name);
  return directory;
}

export async function runPhotos(args, { root = projectRoot, log = console.log } = {}) {
  if (!args.length || args.includes('--help')) { log(help); return; }
  const { command, values, flags } = parse(args);
  const dryRun = Boolean(flags['--dry-run']);
  root = path.resolve(root);
  const manifest = path.join(root, 'content/photos.json');
  const cache = path.join(root, '.cache');
  const lockPath = path.join(cache, 'photos.lock');
  let lock;
  let temporary;
  let imported;
  try {
    await containedDirectory(root, 'content');
    const photoDirectory = await containedDirectory(root, 'Photo');
    if (command !== 'list' && !dryRun) {
      await mkdir(cache, { recursive: true });
      await containedDirectory(root, '.cache');
      try { lock = await open(lockPath, 'wx'); }
      catch (error) {
        if (error.code === 'EEXIST') throw new Error('Another photo edit is running (.cache/photos.lock). After an interrupted command, remove that lock only when no photo command is running.');
        throw error;
      }
    }
    const before = await readFile(manifest, 'utf8');
    const photos = JSON.parse(before);
    const site = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
    await validatePhotos(root, photos, site.hero.photoId);
    if (command === 'list') {
      log(photos.map((photo, index) => `${String(index + 1).padStart(2, '0')}  ${photo.id.padEnd(8)} ${photo.featured ? '*' : ' '} ${photo.source}\n    ${photo.alt}`).join('\n'));
      return;
    }
    let message;
    let addition;
    if (command === 'add') {
      if (!flags['--alt']?.trim()) throw new Error('Add a truthful description with --alt.');
      const inputPath = await realpath(path.resolve(values[0]));
      const info = await stat(inputPath);
      if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error('Choose an image file no larger than 100 MiB.');
      const bytes = await readFile(inputPath);
      const input = sharp(bytes, { failOn: 'error', limitInputPixels: 100000000 });
      const metadata = await input.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw new Error('Choose a single-frame JPEG, PNG or WebP image.');
      await input.stats(); // Decode the complete image, not just its file extension/header.
      const names = await readdir(photoDirectory);
      const serials = [...photos.map(photo => photo.id), ...names].map(name => Number(/^p(\d+)(?:[-.]|$)/i.exec(name)?.[1] ?? 0));
      const id = 'p' + String(Math.max(0, ...serials) + 1).padStart(2, '0');
      if (photos.some(photo => photo.id === id)) throw new Error('Generated photo ID already exists.');
      const alreadyInside = path.dirname(inputPath) === photoDirectory;
      let source;
      if (alreadyInside && sourcePattern.test('Photo/' + path.basename(inputPath))) {
        source = 'Photo/' + path.basename(inputPath);
        if (photos.some(photo => photo.source.toLowerCase() === source.toLowerCase())) throw new Error('This original is already in the collection.');
      } else {
        const slug = path.basename(inputPath, path.extname(inputPath)).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'frame';
        source = 'Photo/' + id + '-' + slug + '.jpg';
        if (names.some(name => name.toLowerCase() === path.basename(source).toLowerCase())) throw new Error('Original filename already exists: ' + source);
        const master = await sharp(bytes).rotate().resize({ width: masterEdge, height: masterEdge, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#101a24' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
        addition = { bytes: master, destination: path.join(root, source) };
      }
      photos.push({ id, source, alt: flags['--alt'].trim(), featured: Boolean(flags['--featured']) });
      message = `Add ${id}: ${source}${flags['--featured'] ? ' (featured)' : ''}`;
    } else {
      const index = photos.findIndex(photo => photo.id === values[0]);
      if (index === -1) throw new Error('Unknown photo ID: ' + values[0]);
      if (command === 'move') {
        if (Boolean(flags['--before']) === Boolean(flags['--after'])) throw new Error('Choose exactly one of --before or --after.');
        const targetId = flags['--before'] ?? flags['--after'];
        if (targetId === values[0]) throw new Error('Choose a different destination photo.');
        if (!photos.some(photo => photo.id === targetId)) throw new Error('Unknown destination photo: ' + targetId);
        const [photo] = photos.splice(index, 1);
        const destination = photos.findIndex(item => item.id === targetId) + (flags['--after'] ? 1 : 0);
        photos.splice(destination, 0, photo);
        message = `Move ${photo.id} ${flags['--before'] ? 'before' : 'after'} ${targetId}; IDs and URLs unchanged`;
      } else if (command === 'feature') {
        if (!['true', 'false'].includes(values[1])) throw new Error('Feature value must be true or false.');
        photos[index].featured = values[1] === 'true';
        message = `Featured ${values[0]}: ${values[1]}`;
      } else {
        if (!values[1].trim()) throw new Error('A real description is required.');
        photos[index].alt = values[1].trim();
        message = `Update description for ${values[0]}`;
      }
    }
    await validatePhotos(root, photos, site.hero.photoId, addition ? [path.basename(addition.destination)] : []);
    if (dryRun) { log('[dry-run] ' + message + '\nNo files changed.'); return; }
    if (addition) {
      // Write the master made from the bytes decoded above; the input may have changed meanwhile.
      const destination = await open(addition.destination, 'wx');
      imported = addition.destination;
      try { await destination.writeFile(addition.bytes); }
      finally { await destination.close(); }
      await validatePhotos(root, photos, site.hero.photoId);
    }
    temporary = path.join(root, 'content', '.photos-' + randomUUID() + '.tmp');
    await writeFile(temporary, serialize(photos), { flag: 'wx' });
    if (await readFile(manifest, 'utf8') !== before) throw new Error('Photo list changed while editing; retry after reviewing the other edit.');
    await rename(temporary, manifest);
    temporary = null;
    imported = null;
    log(message + '\nRun npm run dev to preview, or npm run verify before publishing.');
  } finally {
    if (temporary) await rm(temporary, { force: true });
    if (imported) await rm(imported, { force: true });
    if (lock) { await lock.close(); await rm(lockPath, { force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runPhotos(process.argv.slice(2)); }
  catch (error) { console.error('Photo edit failed: ' + error.message); process.exitCode = 1; }
}
