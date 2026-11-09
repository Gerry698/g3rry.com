// The 2018 copy's own service worker. Like many progressive web apps of its year it promises to work offline,
// and keeps the promise with one saved page: when a page cannot be fetched, the offline page is shown instead.
const CACHE = 'eras-2018-offline-v1';
const SAVED = ['/eras/2018/offline.html', '/eras/2018/app.css'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SAVED)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('eras-2018-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/eras/2018/offline.html')));
  } else if (SAVED.includes(new URL(request.url).pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
  }
});
