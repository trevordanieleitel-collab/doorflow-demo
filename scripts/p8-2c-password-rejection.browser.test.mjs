import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fixtureConfig, bindFixtureHtml } from "./p8-2b-config-fixture.mjs";

// Only the SDK transport is fictional. The served acceptance UI and core are
// repository source. No Auth request, credential or email leaves this fixture.
// --serve permits the same fixture to be exercised with a supported UI driver.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
const SAFE_ERROR = "That password does not meet the sign-in service's security requirements. Choose a stronger password and try again.";
const FAKE_SDK = `export function createClient() {
  const user = { id:"fictional-password-user", email:"password-test@example.invalid", invited_at:"2026-01-01T00:00:00Z" };
  const probe = window.passwordFixture = { getUserCalls:0, updateCalls:0, signOutCalls:0, disposeCalls:0 };
  return { auth:{
    async setSession(){ return {data:{session:{user,access_token:"fictional-local-session"}},error:null}; },
    async getUser(){ probe.getUserCalls++; return {data:{user},error:null}; },
    async updateUser(){
      probe.updateCalls++;
      if(probe.updateCalls === 1) return {data:{user:null},error:{code:"weak_password",status:422,
        message:"DO_NOT_RENDER_PROVIDER_DETAIL token=fictional",reasons:["pwned"]}};
      if(probe.updateCalls === 2) return {data:{user},error:null};
      throw new Error("Unexpected third password update");
    },
    async signOut(){ probe.signOutCalls++; return {error:null}; },
    stopAutoRefresh(){},
    async dispose(){ probe.disposeCalls++; }
  }};
}`;

export async function createPasswordRejectionFixture() {
  const allowed = new Set(["auth/index.html", "auth/accept-invite.js", "auth/accept-invite.css",
    "auth/invite-acceptance-core.mjs", "public-config.js"]);
  const unexpected = [];
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const config = await fixtureConfig(`http://127.0.0.1:${server.address().port}`);
      response.setHeader("Cache-Control", "no-store");
      if (request.method !== "GET") {
        unexpected.push(`${request.method} ${path}`);
        response.writeHead(405); response.end(); return;
      }
      if (path === "/api/doorflow-public-config.json") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(config)); return;
      }
      if (path === "/__fixture/sdk.mjs") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(FAKE_SDK); return;
      }
      if (path === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      const file = path === "/auth/" ? "auth/index.html" : path.slice(1);
      if (!allowed.has(file)) {
        unexpected.push(`${request.method} ${path}`);
        response.writeHead(404); response.end(); return;
      }
      let body = await readFile(join(ROOT, file), "utf8");
      if (file.endsWith(".html")) body = bindFixtureHtml(body, config);
      if (file === "auth/accept-invite.js") {
        assert.equal(body.split(SDK_URL).length, 2, "The reviewed SDK import must occur exactly once");
        body = body.replace(SDK_URL, "/__fixture/sdk.mjs");
      }
      response.setHeader("Content-Type", ({".html":"text/html", ".js":"text/javascript",
        ".mjs":"text/javascript", ".css":"text/css"})[extname(file)]);
      response.end(body);
    } catch {
      unexpected.push("fixture handler failed");
      response.writeHead(500); response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, unexpected,
    url:`${origin}/auth/#access_token=fictional-access&refresh_token=fictional-refresh&type=invite` };
}

if (process.argv.includes("--serve")) {
  const fixture = await createPasswordRejectionFixture();
  console.log(JSON.stringify({url:fixture.url, instructions:[
    "Enter matching fictional passwords and submit once.",
    "Expect a security-requirements message, the same usable form, and no success panel.",
    "Enter matching different fictional passwords and submit again.",
    "Expect Password set, cleared password fields, and Sign in to DoorFlow."
  ]}));
  const close = () => {
    fixture.server.closeAllConnections?.();
    fixture.server.close(() => {
      console.log(JSON.stringify({unexpectedRequests:fixture.unexpected}));
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} else {
  test("acceptance weak-password rejection preserves retry and a successful retry finishes setup", async () => {
    const { launchBrowser, disposeBrowser, evaluate } = await import("./p8-2a-browser-resources.mjs");
    const fixture = await createPasswordRejectionFixture();
    let resource;
    const external = [];
    try {
      resource = await launchBrowser(fixture.server);
      const { cdp } = resource;
      const { targetId } = await cdp.send("Target.createTarget", {url:"about:blank"});
      resource.targetId = targetId;
      const { sessionId } = await cdp.send("Target.attachToTarget", {targetId,flatten:true});
      resource.sessionId = sessionId;
      cdp.on(sessionId, "Fetch.requestPaused", request => {
        const local = new URL(request.request.url).origin === fixture.origin;
        if (!local) external.push(request.request.url);
        cdp.send(local ? "Fetch.continueRequest" : "Fetch.failRequest", {
          requestId:request.requestId, ...(local ? {} : {errorReason:"BlockedByClient"})
        }, sessionId).catch(error => external.push(error.message));
      });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Fetch.enable", {patterns:[{urlPattern:"*",requestStage:"Request"}]}, sessionId);
      await cdp.send("Page.navigate", {url:fixture.url}, sessionId);
      const run = expression => evaluate(cdp, sessionId, expression);
      const waitFor = condition => run(`new Promise((resolve,reject)=>{const deadline=Date.now()+8000;
        function check(){if(${condition})resolve();else if(Date.now()>deadline)reject(new Error("UI condition timed out"));
        else requestAnimationFrame(check);}check();})`);
      await waitFor('window.passwordFixture && !document.getElementById("password-form").hidden');
      const submit = value => run(`document.getElementById("new-password").value=${JSON.stringify(value)};
        document.getElementById("confirm-password").value=${JSON.stringify(value)};
        document.getElementById("password-form").requestSubmit(); void 0;`);
      await submit("fictional-rejected-password");
      await waitFor('!document.getElementById("form-error").hidden && !document.getElementById("set-password-button").disabled');
      const rejected = await run(`({message:document.getElementById("form-error").textContent,
        formHidden:document.getElementById("password-form").hidden,
        successHidden:document.getElementById("success-panel").hidden,
        inputDisabled:document.getElementById("new-password").disabled,
        probe:window.passwordFixture,text:document.body.textContent})`);
      assert.equal(rejected.message, SAFE_ERROR);
      assert.equal(rejected.formHidden, false);
      assert.equal(rejected.successHidden, true);
      assert.equal(rejected.inputDisabled, false);
      assert.equal(rejected.probe.updateCalls, 1);
      assert.equal(rejected.probe.signOutCalls, 0);
      assert.doesNotMatch(rejected.text, /DO_NOT_RENDER_PROVIDER_DETAIL|token=fictional/);
      await submit("fictional-successful-password");
      await waitFor('!document.getElementById("success-panel").hidden && window.passwordFixture.signOutCalls === 1');
      const accepted = await run(`({formHidden:document.getElementById("password-form").hidden,
        passwordLength:document.getElementById("new-password").value.length,
        confirmationLength:document.getElementById("confirm-password").value.length,
        probe:window.passwordFixture})`);
      assert.equal(accepted.formHidden, true);
      assert.equal(accepted.passwordLength, 0);
      assert.equal(accepted.confirmationLength, 0);
      assert.equal(accepted.probe.updateCalls, 2);
      assert.equal(accepted.probe.getUserCalls, 3, "Identity is verified initially and before each update");
      assert.deepEqual(external, []);
      assert.deepEqual(fixture.unexpected, []);
    } finally {
      if (resource) await disposeBrowser(resource);
      else if (fixture.server.listening) {
        fixture.server.closeAllConnections?.();
        await new Promise(resolve => fixture.server.close(resolve));
      }
    }
  });
}
