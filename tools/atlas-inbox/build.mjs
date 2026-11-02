// Refreshes the data block in inbox.html from the lab: the land mask the globe uses, the sites, and the atlas stops that
// already place a photograph. The page itself is published as a private claude.ai Artifact (see docs/maintenance.md).
//   node tools/atlas-inbox/build.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const lab = JSON.parse(await readFile(path.join(root, 'content/phantom.json'), 'utf8'));
const land = (await readFile(path.join(root, 'content/phantom/atlas/land.bin'))).toString('base64');
const data = {
  land,
  sites: lab.sites.map(({ id, name, lat, lon, status, period }) => ({ id, name, lat, lon, status, period: period || null })),
  stops: lab.atlas.stops.filter(stop => stop.vantage).map(stop => ({ id: stop.id, title: stop.title, at: (stop.vantage.at || stop.vantage.target).slice(0, 2) }))
};
const file = path.join(here, 'inbox.html');
const html = await readFile(file, 'utf8');
const updated = html.replace(/\/\*DATA\*\/[\s\S]*?\/\*END\*\//, '/*DATA*/' + JSON.stringify(data) + '/*END*/');
if (updated === html && !html.includes('/*DATA*/')) throw new Error('No data block in inbox.html');
await writeFile(file, updated);
console.log('inbox.html data:', data.sites.length, 'sites,', data.stops.length, 'placed photographs,', (land.length / 1024).toFixed(0) + ' KiB land mask');
