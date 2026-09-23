import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { bounded, launchBrowser, disposeBrowser, evaluate } from "./p8-2a-browser-resources.mjs";
import { fixtureConfig, bindFixtureHtml } from "./p8-2b-config-fixture.mjs";

const root = resolve(import.meta.dirname,"..");
const mainSdk = `window.supabase = {createClient(url,key) {
 window.configProbe={url,key,calls:1};
 return {auth:{getSession:async()=>({data:{session:null},error:null}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
}};`;
const acceptanceSdk = `export function createClient(url,key){window.configProbe={url,key,calls:1};throw new Error('Fictional provider stopped');}`;
new Function(mainSdk); // Verify the transport fixture itself before launching.
const cases = ["valid development","valid production","valid staging","missing config","malformed JSON","URL/ref mismatch","origin mismatch","production in staging",
  "missing staging config","main/auth disagreement","stale page","secret key","wrong type","unexpected redirect","unbuilt page"];
for (const name of cases) for (const entry of ["main","auth"]) test(`${entry}: ${name}`, {timeout:25000}, async()=>{
  const server=createServer((_q,r)=>{r.writeHead(404);r.end();});
  await bounded(new Promise(resolve=>server.listen(0,"127.0.0.1",resolve)),"config loopback bind");
  const resource=await launchBrowser(server);
  const {cdp}=resource;const errors=[],backend=[];
  try {
    const {targetId}=await cdp.send("Target.createTarget",{url:"about:blank"});resource.targetId=targetId;
    const {sessionId}=await cdp.send("Target.attachToTarget",{targetId,flatten:true});resource.sessionId=sessionId;
    const origin=name==="valid production"||name==="valid staging" ? "https://browser.example.invalid" : `http://127.0.0.1:${server.address().port}`;
    const config=await fixtureConfig(origin);
    if(name==="valid production") {
      config.environment="production";
      const {default:api}=await import("../public-config.js");config.binding=await api.binding(config);
    }
    let reply={...config};let pageConfig={...config};
    if(name==="URL/ref mismatch")reply.projectRef="bbbbbbbbbbbbbbbbbbbb";
    if(name==="origin mismatch")reply.allowedOrigin="https://other.example.invalid";
    if(name==="production in staging")Object.assign(reply,{environment:"staging",projectRef:"wdlgkwzowapzhurbbavf",supabaseUrl:"https://wdlgkwzowapzhurbbavf.supabase.co"});
    if(name==="missing staging config")delete reply.environment;
    if(name==="main/auth disagreement")reply.binding="b".repeat(64);
    if(name==="stale page")pageConfig.binding="c".repeat(64);
    if(name==="secret key")reply.publishableKey="sb_secret_fictional_never_valid";
    if(name==="wrong type")reply.supabaseUrl=[];
    const fulfill=(request,body,type="text/javascript",code=200,headers=[])=>cdp.send("Fetch.fulfillRequest",{requestId:request.requestId,responseCode:code,
      responseHeaders:[{name:"Content-Type",value:type},{name:"Cache-Control",value:"no-store"},{name:"Access-Control-Allow-Origin",value:"*"},...headers],
      body:Buffer.from(body).toString("base64")},sessionId);
    cdp.on(sessionId,"Fetch.requestPaused",request=>{
      (async()=>{
        const url=new URL(request.request.url);
        if(url.hostname.endsWith(".supabase.co")){backend.push(url.pathname);return cdp.send("Fetch.failRequest",{requestId:request.requestId,errorReason:"BlockedByClient"},sessionId);}
        if(url.origin!==origin){
          if(url.hostname==="cdn.jsdelivr.net")return fulfill(request,entry==="main"?mainSdk:acceptanceSdk);
          if(url.hostname==="cdn.sheetjs.com")return fulfill(request,"");
          return cdp.send("Fetch.failRequest",{requestId:request.requestId,errorReason:"BlockedByClient"},sessionId);
        }
        if(url.pathname==="/api/doorflow-public-config.json"){
          if(name==="unexpected redirect")return fulfill(request,"","application/json",302,[{name:"Location",value:"https://external.example.invalid/config"}]);
          return fulfill(request,name==="malformed JSON"?"{":JSON.stringify(reply),"application/json",name==="missing config"?404:200);
        }
        // This suite owns document transport only; real SW execution is tested
        // by acceptance-browser and the dedicated cache policy suite.
        if(url.pathname==="/sw.js")return cdp.send("Fetch.failRequest",{requestId:request.requestId,errorReason:"BlockedByClient"},sessionId);
        const file=url.pathname==="/"?"index.html":url.pathname==="/auth/"?"auth/index.html":url.pathname.slice(1);
        const allowed=["index.html","auth/index.html","public-config.js","auth/accept-invite.js","auth/invite-acceptance-core.mjs","auth/accept-invite.css","doorflow-operational-theme.css","manifest.webmanifest","branding/bob-logo.png"];
        if(!allowed.includes(file))return fulfill(request,"","text/plain",404);
        let body=await readFile(resolve(root,file));
        if(file.endsWith(".html"))body=Buffer.from(name==="unbuilt page"?body.toString():bindFixtureHtml(body.toString(),pageConfig));
        return fulfill(request,body,({".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".png":"image/png"})[extname(file)]||"application/json");
      })().catch(error=>errors.push(error.message));
    });
    await cdp.send("Page.enable",{},sessionId);
    await cdp.send("Network.enable",{},sessionId);
    await cdp.send("Network.setBypassServiceWorker",{bypass:true},sessionId);
    await cdp.send("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]},sessionId);
    await cdp.send("Page.navigate",{url:origin+(entry==="auth"?"/auth/#access_token=fictional&refresh_token=fictional&type=invite":"/")},sessionId);
    const state=await evaluate(cdp,sessionId,`new Promise((resolve,reject)=>{const limit=Date.now()+8000;function check(){
      const failure=(document.getElementById('app')?.textContent || document.getElementById('status-message')?.textContent || '').includes('DoorFlow configuration is unavailable');
      if(window.configProbe||failure)resolve({probe:window.configProbe||null,failure,url:location.href,text:document.body.textContent});
      else if(Date.now()>limit)reject(Error('Configuration boundary did not settle'));else requestAnimationFrame(check);
    }check()})`);
    assert.equal(state.probe?.calls||0,name.startsWith("valid ")?1:0);
    assert.equal(state.failure,!name.startsWith("valid "));
    if(state.probe)assert.equal(state.probe.url,config.supabaseUrl);
    if(entry==="auth")assert.equal(state.url,origin+"/auth/");
    assert.deepEqual(backend,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({entry,case:name,clientCreations:state.probe?.calls||0,backendRequests:backend.length}));
  } finally {console.log(JSON.stringify({cleanup:await disposeBrowser(resource)}));}
});
