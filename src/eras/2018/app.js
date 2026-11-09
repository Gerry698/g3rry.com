// Gerry Zhao — app.js (ES2015, as Babel would have let us write it)
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const remember = (key, value) => { try { if (value === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, value); } catch (error) { return null; } };

// Ripples where you press.
document.addEventListener('pointerdown', event => {
  const target = event.target.closest('.ripple');
  if (!target) return;
  const rect = target.getBoundingClientRect(), size = Math.max(rect.width, rect.height);
  const ink = document.createElement('span');
  ink.className = 'ink';
  Object.assign(ink.style, { width: size + 'px', height: size + 'px', left: (event.clientX - rect.left - size / 2) + 'px', top: (event.clientY - rect.top - size / 2) + 'px' });
  target.appendChild(ink);
  ink.addEventListener('animationend', () => ink.remove());
});

// The navigation drawer on small screens.
$('#drawer-button').addEventListener('click', () => $('#drawer').classList.toggle('open'));

// The cookie banner, as required by nobody in particular. It remembers being dismissed for this visit only.
const cookies = $('#cookies');
if (!remember('cookies-dismissed')) setTimeout(() => { cookies.hidden = false; }, 900);
const dismissCookies = () => { cookies.hidden = true; remember('cookies-dismissed', '1'); };
$('#cookies-accept').addEventListener('click', dismissCookies);
$('#cookies-manage').addEventListener('click', dismissCookies);

// The newsletter modal, once you have read half the page.
const newsletter = $('#newsletter');
const closeNewsletter = () => { newsletter.hidden = true; remember('newsletter-seen', '1'); };
window.addEventListener('scroll', () => {
  if (remember('newsletter-seen') || !newsletter.hidden) return;
  const read = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
  if (read > 0.6) { newsletter.hidden = false; remember('newsletter-seen', '1'); }
}, { passive: true });
$('#newsletter-no').addEventListener('click', closeNewsletter);
newsletter.addEventListener('click', event => { if (event.target === newsletter) closeNewsletter(); });

// The photo dialog with EXIF chips.
const viewer = $('#viewer');
const open = card => {
  const image = $('#viewer-image');
  image.src = card.dataset.full; image.width = card.dataset.width; image.height = card.dataset.height; image.alt = card.dataset.alt;
  $('#viewer-title').textContent = card.dataset.title;
  $('#viewer-sub').textContent = card.dataset.sub;
  const chips = $('#viewer-chips');
  chips.textContent = '';
  card.dataset.chips.split('|').forEach(text => { const chip = document.createElement('span'); chip.textContent = text; chips.appendChild(chip); });
  viewer.hidden = false;
};
$$('.card[data-full]').forEach(card => {
  $$('.card-media, .open', card).forEach(link => link.addEventListener('click', event => { event.preventDefault(); open(card); }));
  $('.share', card).addEventListener('click', async event => {
    const button = event.currentTarget, url = new URL(button.dataset.url, location.href).href;
    if (navigator.share) { try { await navigator.share({ title: card.dataset.title, url }); } catch (error) { /* dismissed */ } }
    else if (navigator.clipboard) { await navigator.clipboard.writeText(url).catch(() => {}); button.lastChild.textContent = 'Copied'; }
  });
});
$('#viewer-close').addEventListener('click', () => { viewer.hidden = true; });
viewer.addEventListener('click', event => { if (event.target === viewer) viewer.hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { viewer.hidden = true; closeNewsletter(); } });
const deep = location.hash && document.getElementById(location.hash.slice(1));
if (deep && deep.dataset.full) open(deep);
