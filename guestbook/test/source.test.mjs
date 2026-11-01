import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ipKey } from '../src/lib/ip.js';
import { isReservedName, noteFlags, normalizeText, validateReply } from '../src/lib/text.js';
import { startFixture } from './fixture.mjs';

const guestbook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.resolve(guestbook, '..');

async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(full));
    else if (/\.(m?js|html|css|sql|jsonc?)$/.test(entry.name)) found.push(full);
  }
  return found;
}

// "Trojan Source": invisible or direction-changing characters can make code read differently from how it runs.
// Tests and source must spell such characters as escapes.
test('source files contain no invisible or bidirectional control characters', async () => {
  const hidden = /[\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;
  const checked = [
    ...await files(path.join(guestbook, 'src')), ...await files(path.join(guestbook, 'test')), ...await files(path.join(guestbook, 'migrations')),
    ...await files(path.join(site, 'src')), ...await files(path.join(site, 'scripts'))
  ];
  assert(checked.length > 15);
  for (const file of checked) assert.doesNotMatch(await readFile(file, 'utf8'), hidden, path.relative(site, file));
});

test('normalization keeps real writing intact', () => {
  assert.equal(normalizeText('  Zo\u00EB   and  ', { multiline: false }), 'Zo\u00EB and');
  assert.equal(normalizeText('\u4F60\u597D\uFF0C\u4E16\u754C\uFF01', { multiline: false }), '\u4F60\u597D\uFF0C\u4E16\u754C\uFF01');
  assert.equal(normalizeText('Ti\u1EBFng Vi\u1EC7t', { multiline: false }), 'Ti\u1EBFng Vi\u1EC7t');
  const family = String.fromCodePoint(0x1F469, 0x200D, 0x1F467);
  assert.equal(normalizeText(family + ' hi', { multiline: true }), family + ' hi', 'emoji joiners survive');
  const heart = String.fromCodePoint(0x2764, 0xFE0F);
  assert.equal(normalizeText(heart + String.fromCodePoint(0xFE0F, 0xFE0F, 0xFE0F), { multiline: false }), heart, 'variation selector runs collapse');
  assert.equal(normalizeText('a\t\tb\n\n\n\nc  \n', { multiline: true }), 'a b\n\nc');
});

test('reserved names catch the owner name in disguise, not ordinary names', () => {
  const smallCapitalE = String.fromCodePoint(0x1D07);
  const cyrillicGhe = String.fromCodePoint(0x0433);
  for (const name of ['G' + smallCapitalE + 'rry', 'Ge' + cyrillicGhe + cyrillicGhe + 'y']) assert(isReservedName(name), name);
  for (const name of ['Gerry', 'gerry zhao', 'G3rry', 'GERRY!!', 'G\u00E9rry', 'g e r r y', 'ADMIN', 'Owner']) assert(isReservedName(name), name);
  for (const name of ['Jerry', 'Garry', 'Ada', '\u5C0F\u660E', 'Administrator of nothing']) assert(!isReservedName(name), name);
});

test('invisible and stacking tricks are removed', () => {
  const chars = (...codes) => String.fromCodePoint(...codes);
  assert.equal(normalizeText(chars(0x2800, 0x2800), { multiline: false }), '', 'Braille blanks are not a name');
  assert.equal(normalizeText('a' + chars(0x1D173, 0x13430, 0x0600, 0x1BCA0) + 'b', { multiline: false }), 'ab', 'all invisible format characters go');
  const marks = Array.from({ length: 50 }, () => chars(0x0301, 0x200C)).join('');
  assert.equal(normalizeText('Z' + marks, { multiline: false }).length, 5, 'joiners cannot reset the combining-mark cap');
  assert.equal(normalizeText(chars(0x0915, 0x094D, 0x200D, 0x0937), { multiline: false }), chars(0x0915, 0x094D, 0x200D, 0x0937), 'Devanagari conjunct with ZWJ survives');
});

test('replies are normalized and limited like notes', () => {
  assert.equal(validateReply('  Thanks\r\n\r\n\r\nfor visiting  '), 'Thanks\n\nfor visiting');
  assert.equal(validateReply(''), '');
  assert.equal(validateReply('x'.repeat(1001)), null);
  assert.equal(validateReply(null), null);
});

test('flags describe links and repetition', () => {
  assert.deepEqual(noteFlags('Ada', 'Nice shots'), []);
  assert.deepEqual(noteFlags('Ada', 'see example.com'), ['link']);
  assert.deepEqual(noteFlags('spam.xyz', 'http://a.example http://b.example'), ['many-links']);
  assert.deepEqual(noteFlags('Ada', 'wow' + '!'.repeat(30)), ['repeat']);
});

test('address keys group IPv6 by /64 and leave IPv4 whole', () => {
  assert.equal(ipKey('203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('2001:DB8:0:0:1::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('fe80::1::2'), 'fe80::1::2', 'malformed input is hashed as-is');
});

test('the admin Worker stays closed while Access is not configured', async () => {
  const f = await startFixture({ adminVars: { ACCESS_AUD: '' } });
  try {
    assert.equal((await f.admin('/api/summary')).status, 503);
    assert.equal((await f.admin('/')).status, 503);
  } finally {
    await f.mf.dispose();
  }
});
