import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import configApi from "../public-config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function build(environment, output = resolve(root, "dist")) {
  // Explicit allowlist: never serialize process.env or load .env files.
  const config = configApi.validate({ schemaVersion:1,
    environment:environment.DOORFLOW_ENVIRONMENT,
    supabaseUrl:environment.DOORFLOW_PUBLIC_SUPABASE_URL,
    publishableKey:environment.DOORFLOW_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    projectRef:environment.DOORFLOW_PUBLIC_SUPABASE_PROJECT_REF,
    allowedOrigin:environment.DOORFLOW_PUBLIC_ALLOWED_ORIGIN
  });
  if ((environment.VERCEL_ENV && environment.VERCEL_ENV !== "production"
       || environment.CONTEXT && environment.CONTEXT !== "production") && config.environment === "production") {
    throw new Error(configApi.FAILURE);
  }
  const binding = await configApi.binding(config);
  // Refuse to reuse output. A failed build must never publish stale config.
  await mkdir(output);
  const files = ["index.html", "app.js", "public-config.js", "sw.js", "manifest.webmanifest", "doorflow-operational-theme.css", "_headers",
    "auth/index.html", "auth/accept-invite.js", "auth/accept-invite.css", "auth/invite-acceptance-core.mjs",
    "branding/bob-logo.png", "branding/bob-logo-dark.png", "branding/bob-icon-192.png", "branding/bob-icon-512.png", "branding/bob-icon-maskable-512.png",
    "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"];
  for (const path of files) {
    const destination = resolve(output, path);
    await mkdir(dirname(destination), { recursive:true });
    if (path.endsWith(".html")) {
      let html = await readFile(resolve(root, path), "utf8");
      if (html.split('content="DOORFLOW_CONFIG_BINDING"').length !== 2) throw new Error(configApi.FAILURE);
      html = html.replace('content="DOORFLOW_CONFIG_BINDING"', `content="${binding}"`);
      if (path === "auth/index.html") html = html.replace("connect-src 'self'", `connect-src 'self' ${config.supabaseUrl}`);
      await writeFile(destination, html);
    } else await copyFile(resolve(root, path), destination);
  }
  await mkdir(resolve(output, "api"));
  await writeFile(resolve(output, "api/doorflow-public-config.json"), JSON.stringify({ ...config, binding })+"\n");
  return { binding, files:files.length+1 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await build(process.env); console.log("DoorFlow public build complete."); }
  catch { console.error("DoorFlow build failed. Check the required public configuration and use a fresh output directory."); process.exitCode = 1; }
}
