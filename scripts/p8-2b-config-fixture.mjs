// Fictional transport data, not an alternate implementation of validation.
import configApi from "../public-config.js";
export async function fixtureConfig(origin) {
  const config = configApi.validate({ schemaVersion:1, environment:origin.startsWith("http:") ? "development" : "staging",
    supabaseUrl:"https://abcdefghijklmnopqrst.supabase.co", projectRef:"abcdefghijklmnopqrst",
    publishableKey:"sb_publishable_fictional_browser_key_123456", allowedOrigin:origin });
  return { ...config, binding:await configApi.binding(config) };
}
export function bindFixtureHtml(html, config) {
  return html.replace('content="DOORFLOW_CONFIG_BINDING"', `content="${config.binding}"`)
    .replace("connect-src 'self'", `connect-src 'self' ${config.supabaseUrl}`);
}
