// Bump CACHE when you change any app file so phones pick up the new version
const CACHE = 'cash-calc-v5';
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './db.js', './utils.js', './firebase-config.js',
  './admin.html', './admin.js',
  './manifest.webmanifest', './icon-180.png', './icon-512.png',
  `${SDK}firebase-app.js`, `${SDK}firebase-auth.js`, `${SDK}firebase-firestore.js`,
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser HTTP cache (GitHub Pages sends max-age=600)
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only app files and the Firebase SDK are cached. Firestore/Auth network traffic
// is left alone: Firestore has its own offline cache.
const isCacheable = (url) => url.origin === self.location.origin || url.href.startsWith(SDK);

// Network first (fresh app when online), cache fallback (works offline)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !isCacheable(url)) return;
  // no-cache: always ask the server (cheap 304 if unchanged) so updates show up immediately.
  // Navigation requests can't be cloned with options, so rebuild them from the URL.
  const fresh = event.request.mode === 'navigate'
    ? new Request(event.request.url, { cache: 'no-cache' })
    : new Request(event.request, { cache: 'no-cache' });
  event.respondWith(
    fetch(fresh)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)
        .then((hit) => hit || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
