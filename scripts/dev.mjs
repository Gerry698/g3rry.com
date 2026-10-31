import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let closing = false;
let building = false;
let queued = false;
let preview;
let active;
let timer;
const watchers = [];
async function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'inherit' });
    active = child;
    child.once('error', reject);
    child.once('exit', code => {
      active = null;
      if (code === 0) resolve();
      else reject(new Error(script + ' exited with ' + code));
    });
  });
}
async function rebuild() {
  if (closing) return;
  if (building) { queued = true; return; }
  building = true;
  do {
    queued = false;
    try {
      await run('build.mjs');
      await run('check.mjs');
      if (!preview && !closing) {
        preview = spawn(process.execPath, [path.join(root, 'scripts/preview.mjs')], { cwd: root, stdio: 'inherit' });
        preview.once('error', error => { console.error(error.message); stop(1); });
        preview.once('exit', code => { if (!closing) { console.error('Preview stopped. Is port 4173 already in use?'); stop(code || 1); } });
      }
      console.log('Preview ready. Refresh your browser to see changes. Ctrl+C stops the server.');
    } catch (error) { console.error(error.message + '\nFix the source and save to retry.'); }
  } while (queued && !closing);
  building = false;
}
function stop(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  watchers.forEach(watcher => watcher.close());
  active?.kill();
  preview?.kill();
  process.exitCode = code;
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
for (const directory of ['src', 'content', 'Photo', 'image']) {
  watchers.push(watch(path.join(root, directory), () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 200);
  }));
}
await rebuild();
