// DoorFlow P6 release-candidate service worker.
// Operational data always requires a live Supabase connection and is never cached here.

const CACHE_PREFIX = "doorflow-cache-";
const CACHE_NAME = "doorflow-cache-v30";
const APP_SHELL = [
  "/",
  "/index.html",
  "/doorflow-operational-theme.css",
  "/manifest.webmanifest",
  "/branding/bob-logo.png",
  "/branding/bob-logo-dark.png",
  "/branding/bob-icon-192.png",
  "/branding/bob-icon-512.png",
  "/branding/bob-icon-maskable-512.png"
];

const APP_SHELL_PATHS = new Set(APP_SHELL);

self.addEventListener("install", event => {
  // Do not call skipWaiting(). A new release waits until existing DoorFlow windows close.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirstNavigation(request, pathname) {
  try {
    const response = await fetch(request, { cache:"no-store" });
    if (response && response.ok && response.type === "basic" && (pathname === "/" || pathname === "/index.html")) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
      await cache.put("/index.html", response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || (await caches.match("/index.html")) || Response.error();
  }
}

async function refreshStaticAsset(request) {
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Same-origin API-style paths remain network-owned and never enter the shell cache.
  if (
    url.pathname.includes("/rest/")
    || url.pathname.includes("/auth/")
    || url.pathname.includes("/realtime/")
    || url.pathname.includes("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(networkFirstNavigation(request, url.pathname));
    return;
  }

  // Only the explicit same-origin shell allowlist uses cache-first with revalidation.
  if (!APP_SHELL_PATHS.has(url.pathname)) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const refresh = refreshStaticAsset(request);
      if (cached) {
        event.waitUntil(refresh.catch(() => undefined));
        return cached;
      }
      return refresh;
    })
  );
});
