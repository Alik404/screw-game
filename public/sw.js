// Service worker: the site always comes from the network (a game must match the server it talks to);
// only when there is no network at all, a small "no internet" page is shown instead of the browser's error.
const CACHE = 'friends-games-v1';
const OFFLINE = ['/offline.html', '/icons/icon.svg', '/icons/icon-192.png', '/tokens.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  // the offline page's own files, when the network is gone
  const url = new URL(req.url);
  if (url.origin === self.location.origin && OFFLINE.indexOf(url.pathname) >= 0) {
    e.respondWith(fetch(req).catch(() => caches.match(url.pathname)));
  }
});
