// Visitor text is stored and shown as plain text only. Normalization removes characters that can hide or
// visually reorder text, and caps the tricks that make a note unreadable; validation then checks length.
export const limits = { name: 40, message: 1000, reply: 1000 };

// Format characters (Unicode category Cf) are invisible by definition: bidirectional overrides and isolates that
// reorder text, zero-width spaces, word joiners, BOMs, interlinear annotations, tag characters that can smuggle
// hidden text, and more. ZWNJ and ZWJ stay, because emoji sequences and several scripts need them.
const formatCharacters = /[^\P{Cf}\u200C\u200D]/gu;
// Invisible characters outside Cf: combining grapheme joiner, Hangul and Khmer fillers, Braille blank.
const blanks = /[\u034F\u115F\u1160\u17B4\u17B5\u2800\u3164\uFFA0]/g;
// One variation selector is meaningful (emoji presentation); long runs are a known way to hide data.
const variationRuns = /([\uFE00-\uFE0F\u{E0100}-\u{E01EF}])[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]+/gu;
// Real scripts rarely stack more than a few combining marks; "Zalgo" text stacks dozens. Joiners count as part of
// a run so they cannot be slipped between marks to reset the count.
const markRuns = /((?:\p{M}|\u200C|\u200D){4})(?:\p{M}|\u200C|\u200D)+/gu;
const meaningful = /[\p{L}\p{N}\p{So}]/u;

export function normalizeText(value, { multiline }) {
  let text = value.replace(formatCharacters, '').replace(blanks, '').replace(variationRuns, '$1');
  if (multiline) {
    text = text.replace(/\r\n?|[\u000B\u000C\u0085\u2028\u2029]/g, '\n').replace(/[^\P{Cc}\n]/gu, ' ');
  } else {
    text = text.replace(/[\p{Cc}\u2028\u2029]/gu, ' ');
  }
  text = text.normalize('NFC').replace(markRuns, '$1');
  if (!multiline) return text.replace(/\s+/g, ' ').trim();
  return text.split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const symbolLookalikes = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's', '@': 'a', '|': 'l', '!': 'i' };
// Cyrillic, Greek and Latin small-capital letters that look like Latin ones. Listed by code point so the source
// itself contains no lookalike characters.
const letterLookalikes = new Map([
  [0x0430, 'a'], [0x0433, 'r'], [0x0435, 'e'], [0x043E, 'o'], [0x0440, 'p'], [0x0441, 'c'], [0x0443, 'y'], [0x0445, 'x'],
  [0x0456, 'i'], [0x0458, 'j'], [0x04CF, 'l'], [0x0501, 'd'], [0x051B, 'q'], [0x051D, 'w'],
  [0x03B1, 'a'], [0x03B3, 'y'], [0x03B5, 'e'], [0x03B9, 'i'], [0x03BA, 'k'], [0x03BD, 'v'], [0x03BF, 'o'], [0x03C1, 'p'],
  [0x03C4, 't'], [0x03C5, 'u'], [0x03C7, 'x'],
  [0x1D00, 'a'], [0x0299, 'b'], [0x1D04, 'c'], [0x1D05, 'd'], [0x1D07, 'e'], [0xA730, 'f'], [0x0261, 'g'], [0x0262, 'g'],
  [0x029C, 'h'], [0x026A, 'i'], [0x1D0A, 'j'], [0x1D0B, 'k'], [0x029F, 'l'], [0x1D0D, 'm'], [0x0274, 'n'], [0x1D0F, 'o'],
  [0x1D18, 'p'], [0x0280, 'r'], [0xA731, 's'], [0x1D1B, 't'], [0x1D1C, 'u'], [0x1D20, 'v'], [0x1D21, 'w'], [0x028F, 'y'],
  [0x1D22, 'z']
]);
// A rough "what does this name look like" form: compatibility-folded, accents and lookalikes mapped, Latin letters
// only. It catches casual impersonation; moderation catches the rest.
function skeleton(name) {
  return [...name.normalize('NFKD').toLowerCase()]
    .map(character => symbolLookalikes[character] ?? letterLookalikes.get(character.codePointAt(0)) ?? character)
    .join('').replace(/[^a-z]/g, '');
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

// Lone UTF-16 surrogates (possible through JSON escapes) are not text; they would be stored as replacement characters.
function prepare(value, limit, multiline) {
  if (typeof value !== 'string') return { error: 'required' };
  if (value.length > limit * 8) return { error: 'too_long' };
  if (!value.isWellFormed()) return { error: 'invalid' };
  return { text: normalizeText(value, { multiline }) };
}

function check(field, limit) {
  if (field.error) return field.error;
  if (!field.text) return 'required';
  if (codePoints(field.text) > limit) return 'too_long';
  if (!meaningful.test(field.text)) return 'invalid';
  return null;
}

// Returns either the cleaned fields or a map of field -> error code.
export function validateNote(input) {
  const name = prepare(input.name, limits.name, false);
  const message = prepare(input.message, limits.message, true);
  const errors = {};
  const nameError = check(name, limits.name) ?? (isReservedName(name.text) ? 'reserved' : null);
  const messageError = check(message, limits.message);
  if (nameError) errors.name = nameError;
  if (messageError) errors.message = messageError;
  return nameError || messageError ? { ok: false, errors } : { ok: true, name: name.text, message: message.text };
}

export function validateReply(value) {
  const reply = prepare(value, limits.reply, true);
  return reply.error || codePoints(reply.text) > limits.reply ? null : reply.text;
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
