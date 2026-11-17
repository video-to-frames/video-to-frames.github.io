const CACHE_NAME = 'vtf-offline-dev-v1';
const PRECACHE_URLS = [
  '/',
  '/how-it-works/',
  '/privacy/',
  '/faq/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response && response.ok) {
              await cache.put(url, response);
            }
          } catch {
            // Ignore unreachable URLs during dev install
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('vtf-offline-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function normalizeCandidates(requestUrl) {
  const url = new URL(requestUrl);
  const path = url.pathname;
  const candidates = [path];
  if (path !== '/' && !path.endsWith('/') && !path.includes('.')) {
    candidates.push(`${path}/`);
  }
  if (path !== '/' && path.endsWith('/')) {
    candidates.push(path.slice(0, -1));
  }
  if (path === '/index.html') {
    candidates.push('/');
  }
  return candidates;
}

async function matchFromCache(cache, request) {
  const exact = await cache.match(request, { ignoreSearch: true });
  if (exact) return exact;

  for (const candidate of normalizeCandidates(request.url)) {
    const matched = await cache.match(candidate, { ignoreSearch: true });
    if (matched) return matched;
  }
  return null;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Immutable hashed Astro assets & static icons: Cache-First
  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // Navigation requests & pages: Network-First with reliable offline cache fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cached = await matchFromCache(cache, request);
          if (cached) return cached;
          const rootFallback = await cache.match('/');
          return rootFallback || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })
    );
    return;
  }

  // Other same-origin static files: Stale-While-Revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await matchFromCache(cache, request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      return cached || (await networkPromise) || new Response('', { status: 504 });
    })
  );
});
