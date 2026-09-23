import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { bounded, launchBrowser, disposeBrowser, evaluate } from "./p8-2a-browser-resources.mjs";
import { fixtureConfig } from "./p8-2b-config-fixture.mjs";

// Real HTTP requests: the config endpoint requires a host-only HttpOnly cookie,
// like Vercel Preview protection. No Supabase or real account is involved.
for (const mode of ["protected", "missing host session", "redirect"]) {
  test(`configuration behind hosting protection: ${mode}`, {timeout:25000}, async () => {
    let config, origin, configRequests=0, redirectRequests=0, cookieReceived=false;
    const source=await readFile(new URL("../public-config.js",import.meta.url),"utf8");
    const server=createServer((req,res)=>{
      res.setHeader("Cache-Control","no-store");
      if(req.url==="/") {
        if(mode!=="missing host session")res.setHeader("Set-Cookie","preview_session=fictional; HttpOnly; SameSite=Lax; Path=/");
        res.setHeader("Content-Type","text/html");
        return res.end(`<meta name="doorflow-config-binding" content="${config.binding}"><script src="/public-config.js"></script><script>DoorFlowConfig.load().then(c=>window.result={ok:true,ref:c.projectRef},()=>window.result={ok:false})</script>`);
      }
      if(req.url==="/public-config.js") {res.setHeader("Content-Type","text/javascript");return res.end(source);}
      if(req.url==="/api/doorflow-public-config.json") {
        configRequests++;
        cookieReceived=req.headers.cookie==="preview_session=fictional";
        if(!cookieReceived){res.writeHead(401);return res.end("Host authentication required");}
        if(mode==="redirect"){res.writeHead(302,{Location:origin.replace("127.0.0.1","localhost")+"/redirect-target"});return res.end();}
        res.setHeader("Content-Type","application/json");return res.end(JSON.stringify(config));
      }
      if(req.url==="/redirect-target")redirectRequests++;
      res.writeHead(404);res.end();
    });
    await bounded(new Promise(resolve=>server.listen(0,"127.0.0.1",resolve)),"HTTP bind");
    origin=`http://127.0.0.1:${server.address().port}`;
    config=await fixtureConfig(origin);
    const resource=await launchBrowser(server);
    try {
      const {cdp}=resource;
      const {targetId}=await cdp.send("Target.createTarget",{url:"about:blank"});resource.targetId=targetId;
      const {sessionId}=await cdp.send("Target.attachToTarget",{targetId,flatten:true});resource.sessionId=sessionId;
      await cdp.send("Page.enable",{},sessionId);
      await cdp.send("Page.navigate",{url:origin},sessionId);
      const result=await evaluate(cdp,sessionId,`new Promise((resolve,reject)=>{const end=Date.now()+8000;function check(){if(window.result)resolve(window.result);else if(Date.now()>end)reject(Error('No config result'));else requestAnimationFrame(check)}check()})`);
      assert.equal(result.ok,mode==="protected");
      assert.equal(configRequests,1);
      assert.equal(cookieReceived,mode!=="missing host session");
      assert.equal(redirectRequests,0,"Never follow a config redirect to another origin");
      if(result.ok)assert.equal(result.ref,config.projectRef);
    } finally {await disposeBrowser(resource);}
  });
}
