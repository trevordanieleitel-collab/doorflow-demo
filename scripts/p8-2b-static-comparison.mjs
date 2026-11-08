// Exact inverse of the approved cache edits, solely for historical comparisons.
// Any other cache behavior change remains visible to the original smoke suites.
export function withoutEnvironmentCacheSafety(source) {
  // The foundation milestone bumps only the shell cache version. Keep the
  // exact prior behavior comparison and its mutation negative controls.
  return source.replace('const CACHE_NAME = "doorflow-cache-v32";', 'const CACHE_NAME = "doorflow-cache-v31";')
    .replace('const CACHE_NAME = "doorflow-cache-v31";', 'const CACHE_NAME = "doorflow-cache-v30";')
    .replace('    const cache = await caches.open(CACHE_NAME);\n    return (await cache.match(request)) || (await cache.match("/index.html")) || Response.error();',
      '    return (await caches.match(request)) || (await caches.match("/index.html")) || Response.error();')
    .replace('  // Shared config and its validator stay network-only; no offline backend default.\n  if (url.pathname === "/public-config.js" || url.pathname === "/api/doorflow-public-config.json") return;\n\n','')
    .replace('caches.open(CACHE_NAME).then(cache => cache.match(request)).then(cached => {','caches.match(request).then(cached => {');
}
export function extractAppRuntime(source) {
  const marker = /(?:const|let) SUPABASE_URL\b/.exec(source);
  if (!marker) return "";
  const start=source.lastIndexOf("<script>",marker.index), end=source.indexOf("</script>",marker.index);
  return start<0||end<0?"":source.slice(start+8,end).trim();
}
export function withoutConfigRestoreListener(source) {
  return source.replaceAll('window.addEventListener("pageshow", event => {\n  if (event.persisted) window.location.reload();\n});', '');
}
export function withoutConfigBootstrapHeader(source) {
  return source.replace('  <meta name="doorflow-config-binding" content="DOORFLOW_CONFIG_BINDING">\n  <script src="/public-config.js"></script>\n','');
}
export const stagingSafetyFiles = [
  ".gitignore", "netlify.toml", "public-config.js", "scripts/build-public.mjs",
  "scripts/p8-2b-config-fixture.mjs", "scripts/p8-2b-config.browser.test.mjs", "scripts/p8-2b-public-config.test.mjs",
  "scripts/p8-2b-static-comparison.mjs", "scripts/p8-2b-cache.test.mjs",
  "supabase/review/phase_8_2b_single_venue_staff_review.sql", "docs/PHASE_8_2B_STAGING_SAFETY.md"
];
