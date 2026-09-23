// Shared by the static build, the application and invitation acceptance.
// This file contains policy, never an environment-specific browser key.
(function (root) {
  "use strict";
  const FAILURE = "DoorFlow configuration is unavailable. Contact your administrator.";
  // A deny-list entry, NOT a default connection or permission source.
  const PRODUCTION_PROJECT_REF = "wdlgkwzowapzhurbbavf";
  function validate(input, origin) {
    const fail = () => { throw new Error(FAILURE); };
    if (!input || typeof input !== "object" || Array.isArray(input) || input.schemaVersion !== 1) fail();
    const fields = ["environment", "supabaseUrl", "publishableKey", "projectRef", "allowedOrigin"];
    for (const field of fields) if (typeof input[field] !== "string" || !input[field] || input[field].length > 512 || input[field].trim() !== input[field]) fail();
    const { environment, supabaseUrl, publishableKey, projectRef, allowedOrigin } = input;
    if (!["production", "staging", "development"].includes(environment)) fail();
    if (!/^[a-z0-9]{20}$/.test(projectRef) || supabaseUrl !== `https://${projectRef}.supabase.co`) fail();
    if (environment !== "production" && projectRef === PRODUCTION_PROJECT_REF) fail();
    // Opaque publishable keys cannot be cryptographically associated with a
    // project in the browser. The operator must verify the URL/key pair.
    if (!/^sb_publishable_[A-Za-z0-9_-]{16,200}$/.test(publishableKey)) fail();
    let url;
    try { url = new URL(allowedOrigin); } catch { fail(); }
    if (url.origin !== allowedOrigin || url.username || url.password || url.search || url.hash) fail();
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(environment === "development" && loopback && url.protocol === "http:")) fail();
    if (environment !== "development" && loopback) fail();
    if (url.hostname.includes("*") || (origin !== undefined && origin !== allowedOrigin)) fail();
    return Object.freeze({ schemaVersion:1, environment, supabaseUrl, publishableKey, projectRef, allowedOrigin });
  }
  async function binding(config) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(validate(config))));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function load() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const expected = document.querySelector('meta[name="doorflow-config-binding"]')?.content;
      if (!/^[a-f0-9]{64}$/.test(expected || "")) throw new Error(FAILURE);
      const response = await fetch("/api/doorflow-public-config.json", {
        // Protected hosting may require its own HttpOnly session cookie. Send
        // credentials only to this origin; redirects remain forbidden.
        cache:"no-store", credentials:"same-origin", redirect:"error", referrerPolicy:"no-referrer", signal:controller.signal
      });
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error(FAILURE);
      const text = await response.text();
      if (new TextEncoder().encode(text).length > 8192) throw new Error(FAILURE);
      const raw = JSON.parse(text);
      const config = validate(raw, window.location.origin);
      if (raw.binding !== expected || await binding(config) !== expected) throw new Error(FAILURE);
      return config;
    } catch { throw new Error(FAILURE); }
    finally { clearTimeout(timer); }
  }
  const api = Object.freeze({ validate, binding, load, FAILURE });
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.defineProperty(root, "DoorFlowConfig", { value:api, writable:false, configurable:false });
})(globalThis);
