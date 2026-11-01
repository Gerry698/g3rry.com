// Guestbook page: lists approved notes and sends new ones for review.
// Notes are visitor text, so they are only ever inserted with textContent, never parsed as HTML.
const endpoint = '/api/guestbook';
const form = document.querySelector('#note-form');
const list = document.querySelector('#note-list');
const notesStatus = document.querySelector('#notes-status');
const more = document.querySelector('#notes-more');
const retry = document.querySelector('#notes-retry');
const dateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
const limits = { name: 40, message: 1000 };
const length = text => [...text].length;

const messages = {
  name: {
    required: 'Please add a name.',
    too_long: 'Names can be up to 40 characters.',
    invalid: 'Please use letters or numbers in your name.',
    reserved: 'That name is reserved. Please choose another.'
  },
  message: {
    required: 'Please write a message.',
    too_long: 'Messages can be up to 1,000 characters.',
    invalid: 'Please write a few words.'
  },
  status: {
    verification_failed: 'The human check did not go through. Please try again.',
    verification_unavailable: 'The human check is unavailable right now. Please try again in a minute.',
    rate_limited: 'That was quick. Please wait a minute before sending another note.',
    daily_limit: 'You have sent plenty of notes today, thank you! Please try again tomorrow.',
    pending_limit: 'Your earlier notes are still waiting to be read. Please send more once they appear.',
    duplicate: 'You have already sent this note. It will appear once I have read it.',
    closed: 'The guestbook is resting for now. Please come back later.',
    busy: 'Lots of notes are waiting to be read. Please try again later.',
    offline: 'The note could not be sent. Check your connection and try again.',
    error: 'Something went wrong. Please try again.'
  }
};

// ---- Notes -------------------------------------------------------------------

let next = null;
let loading = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeElement(milliseconds) {
  const time = element('time', 'note-date', dateFormat.format(milliseconds));
  time.dateTime = new Date(milliseconds).toISOString();
  return time;
}

function renderNote(entry) {
  const item = element('li', 'note');
  item.id = 'note-' + entry.id;
  const article = element('article');
  const header = element('header', 'note-header');
  header.append(element('h3', 'note-name', entry.name), timeElement(entry.date));
  article.append(header, element('p', 'note-message', entry.message));
  if (entry.reply) {
    const reply = element('div', 'note-reply');
    const label = element('p', 'note-reply-label', 'Gerry');
    label.append(element('span', 'gold-dot', '.'), ' replied');
    reply.append(label, element('p', 'note-message', entry.reply.message));
    article.append(reply);
  }
  item.append(article);
  return item;
}

async function loadNotes(append) {
  if (loading) return;
  loading = true;
  more.disabled = true;
  retry.hidden = true;
  notesStatus.textContent = append ? 'Loading older notes…' : 'Loading notes…';
  try {
    const response = await fetch(endpoint + (append && next ? '?cursor=' + encodeURIComponent(next) : ''), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    list.append(...data.entries.map(renderNote));
    next = data.next;
    if (data.open === false) closeForm(messages.status.closed);
    notesStatus.textContent = list.children.length ? '' : 'No notes yet. Yours could be the first.';
  } catch {
    notesStatus.textContent = 'The notes could not load just now.';
    retry.hidden = false;
  } finally {
    loading = false;
    more.disabled = false;
    more.hidden = !next;
  }
}

more.addEventListener('click', () => loadNotes(true));
retry.addEventListener('click', () => loadNotes(list.children.length > 0));

// ---- Form --------------------------------------------------------------------

const nameField = form.elements.namedItem('name');
const messageField = form.elements.namedItem('message');
const trap = form.elements.namedItem('extra');
const send = document.querySelector('#note-send');
const status = document.querySelector('#note-status');
const counter = document.querySelector('#note-message-count');
const slot = document.querySelector('#turnstile-slot');

function closeForm(text) {
  for (const control of form.elements) control.disabled = true;
  status.textContent = text;
}

function setError(field, code) {
  const output = document.querySelector('#' + field.id + '-error');
  output.textContent = code ? messages[field.name][code] ?? messages.status.error : '';
  if (code) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
}

function updateCounter() {
  const count = length(messageField.value);
  counter.textContent = count + ' / ' + limits.message;
  counter.classList.toggle('over', count > limits.message);
}
messageField.addEventListener('input', () => { updateCounter(); setError(messageField, null); });
nameField.addEventListener('input', () => setError(nameField, null));

// Turnstile is loaded only once someone starts writing, so readers never contact the challenge service.
let turnstileReady = null;
let widget = null;
let token = '';
let waiting = [];

function settleToken(value) {
  token = value;
  const callbacks = waiting;
  waiting = [];
  callbacks.forEach(callback => callback(value));
}

function loadTurnstile() {
  turnstileReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.addEventListener('load', resolve);
    script.addEventListener('error', reject);
    document.head.append(script);
  }).then(() => {
    widget = window.turnstile.render(slot, {
      sitekey: form.dataset.sitekey,
      action: 'guestbook',
      theme: 'dark',
      appearance: 'interaction-only',
      callback: settleToken,
      'expired-callback': () => { token = ''; },
      'error-callback': () => { settleToken(''); }
    });
  });
  turnstileReady.catch(() => { turnstileReady = null; });
  return turnstileReady;
}
form.addEventListener('focusin', () => { loadTurnstile().catch(() => {}); }, { once: true });

async function getToken() {
  await loadTurnstile();
  if (token) return token;
  // An interactive check can take a while; give the visitor a minute before giving up.
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(''), 60000);
    waiting.push(value => { clearTimeout(timer); resolve(value); });
  });
}

function resetToken() {
  token = '';
  if (widget !== null) window.turnstile.reset(widget);
}

function validate() {
  const name = nameField.value.trim();
  const message = messageField.value.trim();
  const errors = {
    name: !name ? 'required' : length(name) > limits.name ? 'too_long' : null,
    message: !message ? 'required' : length(message) > limits.message ? 'too_long' : null
  };
  setError(nameField, errors.name);
  setError(messageField, errors.message);
  if (errors.name) nameField.focus();
  else if (errors.message) messageField.focus();
  return !errors.name && !errors.message;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (send.disabled || !validate()) return;
  send.disabled = true;
  try {
    status.textContent = 'Checking you are human…';
    let currentToken;
    try {
      currentToken = await getToken();
    } catch {
      status.textContent = messages.status.verification_unavailable;
      return;
    }
    if (!currentToken) {
      status.textContent = messages.status.verification_failed;
      resetToken();
      return;
    }
    status.textContent = 'Sending…';
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: nameField.value, message: messageField.value, extra: trap.value, token: currentToken })
      });
    } catch {
      status.textContent = messages.status.offline;
      return;
    }
    const data = await response.json().catch(() => ({}));
    // The server checks fields before Turnstile, so the token is still unused after a 422.
    if (response.status === 422 && data.fields) {
      setError(nameField, data.fields.name ?? null);
      setError(messageField, data.fields.message ?? null);
      (data.fields.name ? nameField : messageField).focus();
      status.textContent = '';
      return;
    }
    resetToken();
    if (response.status === 202) {
      form.reset();
      updateCounter();
      status.textContent = 'Thank you! Your note is on its way and will appear here once I have read it.';
      return;
    }
    if (data.error === 'closed') closeForm(messages.status.closed);
    else status.textContent = messages.status[data.error] ?? messages.status.error;
  } finally {
    if (!form.elements.namedItem('name').disabled) send.disabled = false;
  }
});

form.hidden = false;
updateCounter();
loadNotes(false);
