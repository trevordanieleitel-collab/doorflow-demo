// DoorFlow P6 release-candidate service worker.
// Operational data always requires a live Supabase connection and is never cached here.

const CACHE_PREFIX = "doorflow-cache-";
const CACHE_NAME = "doorflow-cache-v33";
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
const AUTH_CREDENTIAL_KEYS = new Set([
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "token_hash",
  "token",
  "code",
  "error",
  "error_code",
  "error_description",
  "type"
]);

function hasAuthCredentialParameters(url) {
  return [...url.searchParams.keys()].some(key => {
    const normalized = String(key || "").toLowerCase();
    return AUTH_CREDENTIAL_KEYS.has(normalized) || normalized.endsWith("_token");
  });
}

async function purgeCredentialBearingCacheEntries(cacheName) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter(request => hasAuthCredentialParameters(new URL(request.url)))
      .map(request => cache.delete(request))
  );
}

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
      .then(() => purgeCredentialBearingCacheEntries(CACHE_NAME))
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
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request)) || (await cache.match("/index.html")) || Response.error();
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

  const isNavigation = request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html";

  // Credential-bearing navigations stay network-owned and never enter or read
  // the shell cache. URL fragments are not visible to service workers; the
  // root document synchronously scrubs both query and fragment credentials.
  if (isNavigation && hasAuthCredentialParameters(url)) return;

  // Shared config and its validator stay network-only; no offline backend default.
  if (url.pathname === "/public-config.js" || url.pathname === "/api/doorflow-public-config.json") return;

  // Same-origin API-style paths remain network-owned and never enter the shell cache.
  if (
    url.pathname.includes("/rest/")
    || url.pathname.includes("/auth/")
    || url.pathname.includes("/realtime/")
    || url.pathname.includes("/api/")
  ) {
    return;
  }

  if (isNavigation) {
    event.respondWith(networkFirstNavigation(request, url.pathname));
    return;
  }

  // Only the explicit same-origin shell allowlist uses cache-first with revalidation.
  if (!APP_SHELL_PATHS.has(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => cache.match(request)).then(cached => {
      const refresh = refreshStaticAsset(request);
      if (cached) {
        event.waitUntil(refresh.catch(() => undefined));
        return cached;
      }
      return refresh;
    })
  );
});
