// Photographs open in a dialog; where the browser has view transitions, the thumbnail grows into it.
const viewer = document.querySelector('#viewer');
const image = document.querySelector('#viewer-image');
const caption = document.querySelector('#viewer-caption');
const exif = document.querySelector('#viewer-exif');

const transition = update => document.startViewTransition ? document.startViewTransition(update) : update();

const show = shot => {
  const thumb = shot.querySelector('img');
  thumb.style.viewTransitionName = 'photo';
  transition(() => {
    thumb.style.viewTransitionName = '';
    image.src = shot.href;
    image.width = Number(shot.dataset.width);
    image.height = Number(shot.dataset.height);
    image.alt = thumb.alt;
    caption.textContent = shot.dataset.caption;
    exif.textContent = shot.dataset.exif;
    if (!viewer.open) viewer.showModal();
    history.replaceState(null, '', '#' + shot.id);
  });
};
const hide = () => {
  const shot = document.getElementById(location.hash.slice(1));
  transition(() => {
    viewer.close();
    if (shot) shot.querySelector('img').style.viewTransitionName = 'photo';
  }).finished?.then(() => { if (shot) shot.querySelector('img').style.viewTransitionName = ''; });
  history.replaceState(null, '', location.pathname);
};

for (const shot of document.querySelectorAll('.shot')) shot.addEventListener('click', event => { event.preventDefault(); show(shot); });
document.querySelector('#viewer-close').addEventListener('click', hide);
viewer.addEventListener('click', event => { if (event.target === viewer) hide(); });
viewer.addEventListener('cancel', event => { event.preventDefault(); hide(); });
const deep = location.hash && document.getElementById(location.hash.slice(1));
if (deep?.classList.contains('shot')) show(deep);
