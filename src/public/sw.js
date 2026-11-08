/* ARIA Service Worker — PWA shell + offline fallback
   Strategy:
   - API calls: always network (never cached)
   - Navigations: network-first, cached shell when offline
   - Same-origin assets (build output, self-hosted fonts/icons): cache-first,
     refreshed in the background
   The app ships zero third-party requests, so the shell works fully offline.
*/

const CACHE_NAME = 'aria-cache-v6';
const SHELL = [
  '/',
  '/index.html',
  '/logo.svg',
  '/manifest.json',
  '/vendor/fonts/fonts.css',
  '/vendor/icons/tabler-icons.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          SHELL.map((url) =>
            cache.add(url).catch(() => {
              /* a missing optional asset must not break install */
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never cache API traffic (it is POST anyway) or cross-origin POSTs.
  if (url.pathname.startsWith('/api')) return;

  // Page navigations: network first so users always get the newest build.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    );
    return;
  }

  const isStatic = url.origin === self.location.origin;

  if (isStatic) {
    // Cache-first for hashed build assets, revalidate in the background.
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
