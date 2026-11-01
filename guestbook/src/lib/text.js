// Visitor text is stored and shown as plain text only. Normalization removes characters that can hide or
// visually reorder text, and caps the tricks that make a note unreadable; validation then checks length.
export const limits = { name: 40, message: 1000, reply: 1000 };

// Bidirectional embeddings, overrides, isolates and marks can make text display in a different order than it is stored.
const bidi = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
// Invisible characters: soft hyphen, combining grapheme joiner, Hangul and Khmer fillers, Mongolian vowel separator,
// zero-width space, word joiner and invisible operators, deprecated format controls, BOM, interlinear annotations,
// and Unicode tag characters (which can smuggle hidden text). ZWJ/ZWNJ stay: emoji and several scripts need them.
const invisible = /[\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180E\u200B\u2060-\u2064\u206A-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]|[\u{E0000}-\u{E007F}]/gu;
// One variation selector is meaningful (emoji presentation); long runs are a known way to hide data.
const variationRuns = /([\uFE00-\uFE0F\u{E0100}-\u{E01EF}])[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]+/gu;
// Real scripts rarely stack more than a few combining marks; "Zalgo" text stacks dozens.
const markRuns = /(\p{M}{4})\p{M}+/gu;
const meaningful = /[\p{L}\p{N}\p{So}]/u;

export function normalizeText(value, { multiline }) {
  let text = value.replace(bidi, '').replace(invisible, '').replace(variationRuns, '$1');
  if (multiline) {
    text = text.replace(/\r\n?|[\u000B\u000C\u0085\u2028\u2029]/g, '\n').replace(/[^\P{Cc}\n]/gu, ' ');
  } else {
    text = text.replace(/[\p{Cc}\u2028\u2029]/gu, ' ');
  }
  text = text.normalize('NFC').replace(markRuns, '$1');
  if (!multiline) return text.replace(/\s+/g, ' ').trim();
  return text.split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const lookalikes = {
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's', '@': 'a', '|': 'l', '!': 'i',
  '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u04CF': 'l', '\u0501': 'd', '\u0261': 'g', '\u0262': 'g', '\u0280': 'r',
  '\u03B1': 'a', '\u03B5': 'e', '\u03BF': 'o', '\u03C1': 'p', '\u03B9': 'i', '\u03B3': 'y', '\u03C5': 'u', '\u03BD': 'v', '\u03BA': 'k', '\u03C4': 't', '\u03C7': 'x'
};
// A rough "what does this name look like" form: compatibility-folded, accents and lookalikes mapped, Latin letters only.
function skeleton(name) {
  return [...name.normalize('NFKD').toLowerCase()].map(character => lookalikes[character] ?? character).join('').replace(/[^a-z]/g, '');
}
const reservedExact = new Set(['admin', 'administrator', 'moderator', 'mod', 'owner', 'siteowner', 'webmaster', 'official', 'system']);
// Only the site owner signs as Gerry; owner replies are shown separately with their own label.
export const isReservedName = name => {
  const form = skeleton(name);
  return form.includes('gerry') || reservedExact.has(form);
};

export function codePoints(text) {
  return [...text].length;
}

// Returns either the cleaned fields or a map of field -> error code.
export function validateNote(input) {
  const errors = {};
  const name = typeof input.name === 'string' && input.name.length <= limits.name * 8 ? normalizeText(input.name, { multiline: false }) : null;
  const message = typeof input.message === 'string' && input.message.length <= limits.message * 8 ? normalizeText(input.message, { multiline: true }) : null;
  if (name === null) errors.name = typeof input.name === 'string' ? 'too_long' : 'required';
  else if (!name) errors.name = 'required';
  else if (codePoints(name) > limits.name) errors.name = 'too_long';
  else if (!meaningful.test(name)) errors.name = 'invalid';
  else if (isReservedName(name)) errors.name = 'reserved';
  if (message === null) errors.message = typeof input.message === 'string' ? 'too_long' : 'required';
  else if (!message) errors.message = 'required';
  else if (codePoints(message) > limits.message) errors.message = 'too_long';
  else if (!meaningful.test(message)) errors.message = 'invalid';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, name, message };
}

export function validateReply(value) {
  if (typeof value !== 'string' || value.length > limits.reply * 8) return null;
  const reply = normalizeText(value, { multiline: true });
  return codePoints(reply) <= limits.reply ? reply : null;
}

const linkPattern = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|xyz|top|ru|cn|info|biz|site|online|shop|link|click|app|dev|me)\b/gi;
// Hints for the moderator; they never reject a note on their own.
export function noteFlags(name, message) {
  const flags = [];
  const links = (name + '\n' + message).match(linkPattern)?.length ?? 0;
  if (links) flags.push(links > 2 ? 'many-links' : 'link');
  if (/(.)\1{15,}/u.test(message)) flags.push('repeat');
  return flags;
}

// Near-duplicate detection key: case, spacing and punctuation do not matter.
export const duplicateKey = message => message.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{So}]/gu, '');
