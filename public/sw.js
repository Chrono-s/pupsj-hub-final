const CACHE_NAME = 'pupsj-hub-v7';
const STATIC_ASSETS = [
  '/',
  '/css/app.css',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Always go to network for API calls
  if (event.request.url.includes('/api/') || event.request.url.includes('/uploads/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For static assets: network first, fall back to cache
  // This ensures updated JS/CSS is always picked up without a hard refresh
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Clone and cache the fresh response
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
