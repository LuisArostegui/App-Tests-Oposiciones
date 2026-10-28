const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'opostest-';
const STATIC_CACHE_NAME = `opostest-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE_NAME = `opostest-dynamic-${CACHE_VERSION}`;
const VERSIONED_STATIC_ASSET = /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:avif|css|gif|ico|jpe?g|js|mjs|otf|png|svg|ttf|webp|woff2?)$/i;
const SAFE_STATIC_CONTENT_TYPES = new Set([
  'application/font-woff',
  'application/javascript',
  'application/vnd.ms-fontobject',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/x-icon',
  'text/css',
  'text/javascript',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/manifest.json',
      ]);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    migrateAndCleanCaches()
  );
});

async function migrateAndCleanCaches() {
  const cacheNames = await caches.keys();
  const staticCache = await caches.open(STATIC_CACHE_NAME);
  const oldAppCaches = cacheNames.filter((name) => name.startsWith(CACHE_PREFIX)
    && name !== STATIC_CACHE_NAME
    && name !== DYNAMIC_CACHE_NAME);

  for (const cacheName of oldAppCaches) {
    if (!cacheName.startsWith(`${CACHE_PREFIX}static-`) && !cacheName.startsWith(`${CACHE_PREFIX}dynamic-`)) {
      continue;
    }
    const oldCache = await caches.open(cacheName);
    for (const request of await oldCache.keys()) {
      const url = new URL(request.url);
      if (request.method !== 'GET'
        || request.mode === 'navigate'
        || url.origin !== self.location.origin
        || url.pathname === '/api'
        || url.pathname.startsWith('/api/')
        || !VERSIONED_STATIC_ASSET.test(url.pathname)) continue;

      const response = await oldCache.match(request);
      if (!response?.ok) continue;
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (!contentType || !SAFE_STATIC_CONTENT_TYPES.has(contentType)) continue;
      if (await staticCache.match(request)) continue;

      await staticCache.put(request, response);
    }
  }

  await Promise.all(oldAppCaches.map((name) => caches.delete(name)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function navigationHandler(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      await cache.put('/', networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const staticCache = await caches.open(STATIC_CACHE_NAME);
    const dynamicCache = await caches.open(DYNAMIC_CACHE_NAME);
    const cachedResponse = await dynamicCache.match('/') || await staticCache.match('/');
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response(getOfflineHTML(), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const staticCache = await caches.open(STATIC_CACHE_NAME);
  const dynamicCache = await caches.open(DYNAMIC_CACHE_NAME);
  const cachedResponse = await staticCache.match(request) || await dynamicCache.match(request);
  
  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      const responseClone = networkResponse.clone();
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        cache.put(request, responseClone);
      });
    }
    return networkResponse;
  }).catch(() => null);

  return cachedResponse || await fetchPromise || new Response('Offline', { status: 503 });
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ message: 'Sin conexión. Comprueba la conexión y vuelve a intentarlo.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }
}

function getOfflineHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OposTest Pro - Sin Conexión</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
      padding: 20px;
    }
    .container { max-width: 400px; }
    .icon { font-size: 64px; margin-bottom: 24px; opacity: 0.8; }
    h1 { font-size: 24px; margin-bottom: 16px; font-weight: 600; }
    p { color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 24px; }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 12px 32px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📡</div>
    <h1>Sin Conexión</h1>
    <p>No tienes conexión a Internet. Comprueba tu conexión y vuelve a intentarlo.</p>
    <button onclick="location.reload()">Reintentar</button>
  </div>
</body>
</html>`;
}
