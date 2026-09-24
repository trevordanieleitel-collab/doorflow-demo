import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fixtureConfig, bindFixtureHtml } from "./p8-2b-config-fixture.mjs";
import { bounded, disposeBrowser, evaluate, launchBrowser } from "./p8-2a-browser-resources.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ids = { A:"30000000-0000-4000-8000-000000000001", B:"30000000-0000-4000-8000-000000000002" };
function receipt(actor, name = actor) {
  return { id:ids[actor], full_name:`Fictional ${name}`, email:`${name.toLowerCase()}@example.invalid`, role:"door",
    status:"sent", send_state:"provider_accepted", profile_state:"created", attempt_count:1,
    created_at:"2026-01-01T00:00:00Z", last_attempt_at:"2026-01-01T00:00:00Z", last_sent_at:"2026-01-01T00:00:00Z",
    accepted_at:null, failure_code:null, failure_message:null, can_retry:false, can_resend:true, retry_after_seconds:0 };
}
// Only transport/auth is fictional. The browser executes the untouched repository
// HTML, including its real UI, auth callback, endpoint and invitation functions.
const SDK = `window.supabase = { createClient() {
  let callback, session = null;
  const profiles = Object.fromEntries(['A','B'].map(id => [id, {id, full_name:'Admin '+id, role:'admin', active:true, venue_id:'venue-1'}]));
  const probe = window.fixture = { profiles, requests:[], sessionGate:null,
    expireWithoutNotification() { session = null; },
    async emit(id, event = id ? 'SIGNED_IN' : 'SIGNED_OUT') {
      session = id ? {user:{id,email:id+'@example.invalid'},access_token:'fictional-'+id,expires_at:4102444800} : null;
      await callback(event, session);
    },
    holdSession() { this.sessionGate = {}; this.sessionGate.promise = new Promise(resolve => this.sessionGate.release = resolve); },
    holdProfileRead() {
      this.profileGate = {};
      this.profileGate.promise = new Promise(resolve => this.releaseProfileRead = resolve);
      this.profileStarted = new Promise(resolve => this.profileGate.started = resolve);
    },
    releaseSession() { const gate=this.sessionGate; this.sessionGate=null; gate.release(); }
  };
  const channel = {on(){return this},subscribe(){return this}};
  return { auth:{
    async getSession(){if(probe.sessionGate) await probe.sessionGate.promise; return {data:{session},error:null}},
    onAuthStateChange(fn){callback=fn;probe.ready=true;return {data:{subscription:{unsubscribe(){}}}}},
    async signOut(){await probe.emit(null);return {error:null}}
  }, channel(){return channel}, removeChannel(){}, from(table) {
    let single=false; const filters={};
    const query = {select(){return this},eq(key,value){filters[key]=value;return this},order(){return this},limit(){return this},in(){return this},
      maybeSingle(){single=true;return this},then(resolve,reject){
        probe.requests.push(table);
        let data;
        if(table==='staff_profiles') data=filters.id ? [profiles[filters.id]].filter(Boolean) : [profiles[session?.user.id]].filter(Boolean);
        else if(table==='venues') data=[{id:probe.venue || 'venue-1',name:'EVE'}];
        else if(table==='service_days') data=[{id:'day-1',venue_id:probe.venue || 'venue-1',service_date:filters.service_date,day_name:'Monday'}];
        else if(table==='groups') data=[{id:'group-1',name:'General Guest List',group_type:'General Guest List',service_day_id:'day-1'}];
        else if(['guests','check_in_logs','shift_notes'].includes(table)) data=[];
        else return Promise.reject(new Error('Unconfigured fictional table')).then(resolve,reject);
        const result={data:single ? data[0] || null : data,error:null};
        if(table==='staff_profiles' && !filters.id && probe.profileGate) {
          const gate=probe.profileGate;probe.profileGate=null;gate.started();
          return gate.promise.then(()=>result).then(resolve,reject);
        }
        return Promise.resolve(result).then(resolve,reject);
      }};
    return query;
  }};
}};`;

async function fixture(options = {}) {
  const allowed = new Set(["index.html", "sw.js", "manifest.webmanifest", "doorflow-operational-theme.css",
    "public-config.js",
    "branding/bob-logo.png", "branding/bob-logo-dark.png", "branding/bob-icon-192.png", "branding/bob-icon-512.png", "branding/bob-icon-maskable-512.png"]);
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    const config = await fixtureConfig(`http://127.0.0.1:${server.address().port}`);
    if (path === "api/doorflow-public-config.json") {
      response.writeHead(200, {"Cache-Control":"no-store", "Content-Type":"application/json"});
      response.end(JSON.stringify(config)); return;
    }
    if (!allowed.has(path)) { response.writeHead(404); response.end(); return; }
    try {
      response.writeHead(200, { "Cache-Control":"no-store", "Content-Type":({".html":"text/html", ".js":"text/javascript", ".css":"text/css"})[extname(path)] || "application/octet-stream" });
      const body = await readFile(join(ROOT, path));
      response.end(path.endsWith(".html") ? bindFixtureHtml(body.toString(), config) : body);
    } catch { response.writeHead(500); response.end(); }
  });
  await bounded(new Promise(resolve => server.listen(0, "127.0.0.1", resolve)), "Loopback server");
  let resource;
  try {
  resource = await launchBrowser(server);
  const { cdp } = resource;
  const { targetId } = await cdp.send("Target.createTarget", { url:"about:blank" });
  resource.targetId = targetId;
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten:true });
  resource.sessionId = sessionId;
  const origin = `http://127.0.0.1:${server.address().port}`;
  const held = [], waiters = [], errors = [], requests = [];
  let holdGet = false;
  const fulfill = (request, payload, status = 200, type = "application/json") => cdp.send("Fetch.fulfillRequest", {
    requestId:request.requestId, responseCode:status, responseHeaders:[{name:"Access-Control-Allow-Origin",value:"*"},
      {name:"Access-Control-Allow-Headers",value:"authorization,apikey,content-type"}, {name:"Content-Type",value:type}],
    body:Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)).toString("base64")
  }, sessionId);
  cdp.on(sessionId, "Fetch.requestPaused", request => {
    const action = async () => {
      const url = new URL(request.request.url);
      if (url.origin === origin) return cdp.send("Fetch.continueRequest", {requestId:request.requestId}, sessionId);
      if (request.request.url === "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0") return fulfill(request, SDK, 200, "text/javascript");
      if (url.hostname === "cdn.sheetjs.com") return fulfill(request, "", 200, "text/javascript");
      if (url.pathname === "/functions/v1/staff-invitations") {
        if (request.request.method === "OPTIONS") return fulfill(request, "");
        const actor = String(request.request.headers.authorization || request.request.headers.Authorization).endsWith("B") ? "B" : "A";
        request.actor = actor;
        requests.push({method:request.request.method,actor});
        if (request.request.method === "POST" || holdGet) {
          if (waiters.length) waiters.shift()(request); else held.push(request);
          return;
        }
        return fulfill(request, {ok:true,invitations:[receipt(actor)]});
      }
      errors.push(`Blocked unexpected external request: ${url.origin}${url.pathname}`);
      return cdp.send("Fetch.failRequest", {requestId:request.requestId,errorReason:"BlockedByClient"}, sessionId);
    };
    action().catch(error => errors.push(error.message));
  });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send("Network.setBypassServiceWorker", {bypass:true}, sessionId);
  await cdp.send("Fetch.enable", {patterns:[{urlPattern:"*",requestStage:"Request"}]}, sessionId);
  if (options.failSetup) throw new Error("Fictional setup failure");
  await cdp.send("Page.navigate", {url:origin}, sessionId);
  const run = expression => evaluate(cdp, sessionId, expression);
  // Readiness is an explicit observed condition, not an ordering sleep.
  await run(`new Promise((resolve,reject) => { const deadline=Date.now()+8000; function check(){
    if(window.fixture?.ready) resolve(); else if(Date.now()>deadline) reject(new Error('App initialization failed')); else requestAnimationFrame(check);
  } check(); })`);
  return { run, requests, holdLists(){holdGet=true}, next:() => bounded(held.length ? Promise.resolve(held.shift()) : new Promise(resolve => waiters.push(resolve)), "Held invitation request"),
    release:(request, actor, failure = false, name = actor) => fulfill(request, failure
      ? {ok:false,error:{code:"fictional_stopped",message:"Fictional old failure"},invitation:receipt(actor,name)}
      : {ok:true,invitation:receipt(actor,name)}, failure ? 409 : 200),
    releaseList:(request, actor, name = actor) => fulfill(request, {ok:true,invitations:[receipt(actor,name)]}),
    async signIn(actor){await run(`fixture.emit(${JSON.stringify(actor)})`); await run(`switchView('users');`); await run("loadStaffInvitationsForAdmin()");},
    async start(actor, variable="oldWork") { await run(`window.${variable}=resendStaffInvitation('${ids[actor]}'); void 0`); return this.next(); },
    state:() => run(`({invitations:state.staffInvitations,notice:state.staffInvitationNotice,busy:state.staffInvitationBusyId,loading:state.staffInvitationsLoading,submitting:state.staffInviteSubmitting,text:document.body.textContent})`),
    async close(){const cleanup=await disposeBrowser(resource); console.log(JSON.stringify({cleanup,requests})); assert.deepEqual(errors, []);}
  };
  } catch (error) {
    try {
      if (resource) {
        const cleanup = await disposeBrowser(resource);
        options.onCleanup?.(cleanup);
        console.log(JSON.stringify({setupFailureCleanup:cleanup}));
      } else if (server.listening) {
        server.closeAllConnections?.();
        await bounded(new Promise((resolve,reject)=>server.close(error=>error ? reject(error) : resolve())), "Setup server cleanup");
      }
    } catch (cleanup) { throw new AggregateError([error,cleanup], "Fixture setup and cleanup failed"); }
    throw error;
  }
}

for (const failure of [false, true]) {
  test(`actual application: A late ${failure ? "error" : "success"} cannot write B state or clear B work`, async () => {
    const f = await fixture();
    try {
      await f.signIn("A"); const old = await f.start("A");
      await f.run("fixture.emit(null)"); await f.signIn("B"); const current = await f.start("B", "newWork");
      const requestCount = f.requests.length;
      await f.release(old, "A", failure); await f.run("oldWork");
      const observed = await f.state();
      console.log(JSON.stringify({case:"late A",failure,ids:observed.invitations.map(row=>row.id),busy:observed.busy,notice:observed.notice}));
      assert.equal(observed.invitations.some(row=>row.id===ids.A), false);
      assert.equal(observed.text.includes("a@example.invalid"), false);
      assert.equal(observed.busy, ids.B);
      assert.equal(observed.notice.tone, "loading");
      assert.equal(f.requests.length,requestCount,"An obsolete result cannot initiate follow-up reads or retries");
      await f.release(current, "B"); await f.run("newWork");
      assert.equal((await f.state()).busy, "");
    } finally { await f.close(); }
  });
}

for (const transition of ["same-account relogin", "venue", "demotion", "inactive", "operational venue"]) {
  test(`actual application: ${transition} invalidates earlier work even after returning to A`, async () => {
    const f = await fixture();
    try {
      await f.signIn("A"); const old = await f.start("A");
      if (transition === "same-account relogin") { await f.run("logout()"); await f.signIn("A"); }
      else if (transition === "operational venue") {
        await f.run("fixture.venue='venue-2'; ensureServiceDay(state.activeDate)");
        await f.run("fixture.venue='venue-1'; ensureServiceDay(state.activeDate)");
      } else {
        const field = transition === "venue" ? "venue_id" : transition === "demotion" ? "role" : "active";
        const value = transition === "venue" ? "venue-2" : transition === "demotion" ? "viewer" : false;
        await f.run(`fixture.profiles.A.${field}=${JSON.stringify(value)}; fixture.emit('A','USER_UPDATED')`);
        await f.run(`fixture.profiles.A.${field}=${JSON.stringify(transition === "venue" ? "venue-1" : transition === "demotion" ? "admin" : true)}; fixture.emit('A','USER_UPDATED')`);
      }
      await f.run("loadStaffInvitationsForAdmin()");
      await f.release(old, "A", true, "Obsolete"); await f.run("oldWork");
      const state = await f.state();
      assert.equal(state.invitations.some(row=>row.email==='obsolete@example.invalid'), false);
      assert.equal(state.text.includes("obsolete@example.invalid"), false);
      assert.notEqual(state.notice?.message, "Fictional old failure");
    } finally { await f.close(); }
  });
}

test("actual application: same-session token refresh retains current response ownership", async () => {
  const f = await fixture();
  try {
    await f.signIn("A"); const pending = await f.start("A");
    await f.run("fixture.emit('A','TOKEN_REFRESHED')");
    await f.release(pending, "A", true, "Current"); await f.run("oldWork");
    const state = await f.state();
    assert.equal(state.invitations[0].email, "current@example.invalid");
    assert.equal(state.text.includes("current@example.invalid"), true);
    assert.equal(state.notice.message, "Fictional old failure");
    assert.equal(state.busy, "");
  } finally { await f.close(); }
});

for (const order of ["old first", "new first"]) {
  test(`actual application: ordered list ownership (${order})`, async () => {
    const f = await fixture();
    try {
      await f.signIn("A"); f.holdLists();
      await f.run("window.oldList=loadStaffInvitationsForAdmin(); void 0"); const old = await f.next();
      await f.run("window.newList=loadStaffInvitationsForAdmin(); void 0"); const current = await f.next();
      if (order === "old first") {
        await f.releaseList(old,"A","Obsolete"); await f.run("oldList");
        assert.equal((await f.state()).loading,true);
      }
      await f.releaseList(current,"A","Current"); await f.run("newList");
      if (order === "new first") { await f.releaseList(old,"A","Obsolete"); await f.run("oldList"); }
      const state = await f.state();
      assert.equal(state.invitations[0].email,"current@example.invalid");
      assert.equal(state.loading,false);
    } finally { await f.close(); }
  });
}

test("actual application: session changes during token lookup cannot dispatch old action as B", async () => {
  const f = await fixture();
  try {
    await f.signIn("A");
    await f.run("fixture.holdSession(); window.oldWork=resendStaffInvitation('"+ids.A+"'); void 0");
    // USER_UPDATED executes the actual auth/profile hook, without a boot session read.
    await f.run("fixture.emit('B','USER_UPDATED')");
    await f.run("fixture.releaseSession(); oldWork");
    assert.equal(f.requests.filter(item=>item.method==='POST').length,0);
    assert.equal((await f.state()).invitations.length,0);
  } finally { await f.close(); }
});

test("actual application: late submit cannot rewrite B's current form or submitting flag", async () => {
  const f = await fixture();
  const submit = variable => f.run(`openStaffInviteModal();
    document.getElementById('staffInviteFullName').value='Fictional Staff';
    document.getElementById('staffInviteEmail').value='fictional@example.invalid';
    window.${variable}=submitStaffInvitation({preventDefault(){},target:document.getElementById('staffInviteForm')}); void 0`);
  try {
    await f.signIn("A"); await submit("oldWork"); const old = await f.next();
    await f.run("logout()"); await f.signIn("B"); await submit("newWork"); const current = await f.next();
    await f.release(old,"A",true,"Obsolete"); await f.run("oldWork");
    assert.equal((await f.state()).submitting,true);
    assert.equal(await f.run("state.staffInvitationModalNotice.tone"),"loading");
    assert.equal(await f.run("document.getElementById('staffInviteEmail').value"),"fictional@example.invalid");
    await f.release(current,"B"); await f.run("newWork");
    assert.equal((await f.state()).submitting,false);
    assert.equal(await f.run("state.modal"),null);
  } finally { await f.close(); }
});

test("actual application: unannounced session expiry clears the visible Admin UI", async () => {
  const f = await fixture();
  try {
    await f.signIn("A");
    await f.run("openStaffInviteModal(); fixture.expireWithoutNotification(); resendStaffInvitation('"+ids.A+"')");
    assert.equal(await f.run("auth.currentUser"),null);
    assert.equal((await f.state()).text.includes("a@example.invalid"),false);
    assert.equal(await f.run("document.getElementById('staffInviteForm') === null"),true);
    assert.equal(f.requests.filter(item=>item.method==='POST').length,0);
  } finally { await f.close(); }
});

test("browser fixture releases only its owned resources after an injected setup failure", async () => {
  let cleanup;
  await assert.rejects(fixture({failSetup:true,onCleanup:value=>cleanup=value}), /Fictional setup failure/);
  assert.equal(cleanup.processExited,true);
  assert.equal(cleanup.httpListenerClosed,true);
  assert.equal(cleanup.debugListenerClosed,true);
  assert.equal(cleanup.profileRemoved,true);
});

test("actual application: stale list error cannot clear B loading or replace its notice", async () => {
  const f = await fixture();
  try {
    await f.signIn("A"); f.holdLists();
    await f.run("window.oldList=loadStaffInvitationsForAdmin(); void 0"); const old=await f.next();
    await f.run("fixture.emit(null)"); await f.run("fixture.emit('B','USER_UPDATED')");
    await f.run("window.newList=loadStaffInvitationsForAdmin(); void 0"); const current=await f.next();
    await f.release(old,"A",true); await f.run("oldList");
    assert.equal((await f.state()).loading,true);
    assert.equal((await f.state()).notice,null);
    await f.releaseList(current,"B"); await f.run("newList");
    assert.equal((await f.state()).invitations[0].id,ids.B);
  } finally { await f.close(); }
});

test("actual application: invitation follow-up profile read cannot overwrite B staff", async () => {
  const f = await fixture();
  try {
    await f.signIn("A"); const old=await f.start("A");
    await f.run("fixture.holdProfileRead()"); f.holdLists();
    await f.release(old,"A"); await f.run("fixture.profileStarted"); const oldList=await f.next();
    await f.run("fixture.emit(null)"); await f.run("fixture.emit('B','USER_UPDATED')");
    await f.run("fixture.releaseProfileRead()"); await f.releaseList(oldList,"A"); await f.run("oldWork");
    assert.deepEqual(await f.run("state.staffProfiles.map(row=>row.id)"),["B"]);
    assert.equal((await f.state()).invitations.length,0);
  } finally { await f.close(); }
});
