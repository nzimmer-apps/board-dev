// Minimal service worker: makes the app installable and loads the shell offline.
// Data always comes live from Supabase; only same-origin GETs are cached.
const CACHE = 'board-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Network first so new deploys show up immediately; fall back to cache offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? './' : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req.mode === 'navigate' ? './' : req)),
  );
});

// Web push: show the reminder the server sent, even with no Board tab open.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Board', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Board', {
    body: d.body || '', tag: d.tag, icon: './icon-192.png', badge: './icon-192.png', data: { itemId: d.itemId },
  }));
});

// Clicking it opens Board (or brings an open tab forward).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = tabs.find((c) => new URL(c.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if (open) return open.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
