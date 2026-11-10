// Bundles the Worker with `wrangler deploy --dry-run`, so tests run the same code a deploy would upload.
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
await rm(build, { recursive: true, force: true });
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--outdir', build], {
  cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
});
if (result.status !== 0) {
  process.stderr.write(result.stdout + result.stderr);
  throw new Error('Bundling the hunt Worker failed.');
}
console.log('Built the hunt Worker in build/.');
