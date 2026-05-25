// Prime Lift — Service Worker
const CACHE = "primelift-v5";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./firebase-config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never cache Firebase API / auth — always go to network
  if (url.hostname.includes("firebaseapp.com") ||
      url.hostname.includes("googleapis.com") ||
      url.hostname.includes("firestore.googleapis.com") ||
      url.hostname.includes("identitytoolkit.googleapis.com") ||
      url.hostname.includes("gstatic.com")) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (e.request.method === "GET" && resp.status === 200 && url.origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
