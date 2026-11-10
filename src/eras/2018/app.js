// Gerry Zhao — app.js (ES2015, as Babel would have let us write it)
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const remember = (key, value) => { try { if (value === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, value); } catch (error) { return null; } };
const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Ripples where you press. Each drop of ink removes itself when its animation ends, or soon after if the animation
// never runs; with less motion there is no ink at all.
document.addEventListener('pointerdown', event => {
  const target = event.target.closest('.ripple');
  if (!target || still) return;
  const rect = target.getBoundingClientRect(), size = Math.max(rect.width, rect.height);
  const ink = document.createElement('span');
  ink.className = 'ink';
  Object.assign(ink.style, { width: size + 'px', height: size + 'px', left: (event.clientX - rect.left - size / 2) + 'px', top: (event.clientY - rect.top - size / 2) + 'px' });
  target.appendChild(ink);
  const done = () => ink.remove();
  ink.addEventListener('animationend', done);
  setTimeout(done, 900);
});

// Dialogs: a scrim holding one role="dialog". Opening one moves the focus into it and keeps Tab inside it, Escape
// closes the one on top, and closing gives the focus back to whatever had it before.
const open = [];
const focusable = root => $$('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
  .filter(element => !element.closest('[hidden]') && element.getClientRects().length);
const openDialog = (scrim, close, returnTo = document.activeElement) => {
  if (!scrim.hidden) return;
  scrim.hidden = false;
  open.push({ scrim, close, returnTo });
  const panel = $('[role="dialog"]', scrim), first = focusable(panel)[0];
  if (first) first.focus(); else { panel.tabIndex = -1; panel.focus(); }
};
const closeDialog = scrim => {
  if (scrim.hidden) return;
  scrim.hidden = true;
  const at = open.findIndex(entry => entry.scrim === scrim);
  const [entry] = at < 0 ? [] : open.splice(at, 1);
  if (entry && entry.returnTo && entry.returnTo !== document.body && document.contains(entry.returnTo)) entry.returnTo.focus();
};
document.addEventListener('keydown', event => {
  const top = open[open.length - 1];
  if (!top) return;
  if (event.key === 'Escape') { event.preventDefault(); top.close(); return; }
  if (event.key !== 'Tab') return;
  const items = focusable($('[role="dialog"]', top.scrim));
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1], inside = top.scrim.contains(document.activeElement);
  if (event.shiftKey && (!inside || document.activeElement === first)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (!inside || document.activeElement === last)) { event.preventDefault(); first.focus(); }
});

// The navigation drawer on small screens.
$('#drawer-button').addEventListener('click', () => $('#drawer').classList.toggle('open'));

// The cookie banner, as required by nobody in particular. It remembers being dismissed for this visit only.
const cookies = $('#cookies');
if (!remember('cookies-dismissed')) setTimeout(() => { cookies.hidden = false; }, 900);
const dismissCookies = () => { cookies.hidden = true; remember('cookies-dismissed', '1'); };
$('#cookies-accept').addEventListener('click', dismissCookies);
// Manage opens the consent manager: two tabs of partners, each with a switch. The banner goes away underneath it,
// so the focus comes back to the top of the page.
const consent = $('#consent');
const closeConsent = () => closeDialog(consent);
$('#cookies-manage').addEventListener('click', () => { dismissCookies(); openDialog(consent, closeConsent, $('.app-title')); });
$$('.consent-tabs [role="tab"]').forEach(tab => tab.addEventListener('click', () => {
  $$('.consent-tabs [role="tab"]').forEach(other => other.setAttribute('aria-selected', String(other === tab)));
  $$('.vendors', consent).forEach(panel => { panel.hidden = panel.dataset.panel !== tab.dataset.show; });
}));
// "Reject all". Strata (legitimate-interest): see the private solution book.
$('#consent-reject').addEventListener('click', () => { $$('.toggle[data-tab="consent"]', consent).forEach(toggle => { toggle.checked = false; }); closeConsent(); });
$('#consent-save').addEventListener('click', closeConsent);
consent.addEventListener('click', event => { if (event.target === consent) closeConsent(); });

// A service worker of this year's own, so the site "works offline": without a connection it shows a saved page.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/eras/2018/sw.js', { scope: '/eras/2018/' }).catch(() => {});

// The newsletter modal, once you have read more than half the page. It waits a while after the page opens, never
// comes up while someone is moving through the page with the keyboard, and never takes the focus from anything.
const newsletter = $('#newsletter');
const closeNewsletter = () => { closeDialog(newsletter); remember('newsletter-seen', '1'); };
const arrived = Date.now();
let lastKey = 0;
document.addEventListener('keydown', () => { lastKey = Date.now(); }, true);
window.addEventListener('scroll', () => {
  if (remember('newsletter-seen') || !newsletter.hidden || open.length) return;
  if (Date.now() - arrived < 12000 || Date.now() - lastKey < 5000) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  const read = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
  if (read > 0.6) { openDialog(newsletter, closeNewsletter); remember('newsletter-seen', '1'); }
}, { passive: true });
$('#newsletter-no').addEventListener('click', closeNewsletter);
newsletter.addEventListener('click', event => { if (event.target === newsletter) closeNewsletter(); });

// The photo dialog with EXIF chips. Its image is only fetched when it opens.
const viewer = $('#viewer');
const closeViewer = () => closeDialog(viewer);
const show = (card, opener) => {
  const image = $('#viewer-image');
  image.src = card.dataset.full; image.width = card.dataset.width; image.height = card.dataset.height; image.alt = card.dataset.alt;
  $('#viewer-title').textContent = card.dataset.title;
  $('#viewer-sub').textContent = card.dataset.sub;
  const chips = $('#viewer-chips');
  chips.textContent = '';
  card.dataset.chips.split('|').forEach(text => { const chip = document.createElement('span'); chip.textContent = text; chips.appendChild(chip); });
  openDialog(viewer, closeViewer, opener);
};
$$('.card[data-full]').forEach(card => {
  $$('.card-media, .open', card).forEach(link => link.addEventListener('click', event => { event.preventDefault(); show(card, link); }));
  $('.share', card).addEventListener('click', async event => {
    const button = event.currentTarget, url = new URL(button.dataset.url, location.href).href;
    if (navigator.share) { try { await navigator.share({ title: card.dataset.title, url }); } catch (error) { /* dismissed */ } }
    else if (navigator.clipboard) { await navigator.clipboard.writeText(url).catch(() => {}); button.lastChild.textContent = 'Copied'; }
  });
});
$('#viewer-close').addEventListener('click', closeViewer);
viewer.addEventListener('click', event => { if (event.target === viewer) closeViewer(); });
const deep = location.hash && document.getElementById(location.hash.slice(1));
if (deep && deep.dataset.full) show(deep, null);
