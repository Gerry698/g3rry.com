// Applies every file in migrations/ in order to a local D1 database, as `wrangler d1 migrations apply` does remotely.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function applyMigrations(db) {
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(path.join(directory, file), 'utf8');
    const statements = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(/;\s*\n/).map(text => text.trim()).filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  }
}
