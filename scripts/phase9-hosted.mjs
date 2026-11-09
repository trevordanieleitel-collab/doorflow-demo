import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createOperator} from './venue-operator.mjs';
import {launchBrowser,disposeBrowser,evaluate} from './p8-2a-browser-resources.mjs';
export async function runPhase9Staging({secret,publicKey,origin,reportPath}) {
 const ref='ktvmihmkdfvzmgubsqqc',base=`https://${ref}.supabase.co`;
 assert.equal(origin,'https://saas-foundation--doorflow-thebob.netlify.app');
 const op=createOperator({projectRef:ref,secret});
 const report={runId:'p9-'+randomBytes(5).toString('hex'),project:ref,checks:[],fixtures:[],emailsSent:0,complete:false};
 const record=(label,value)=>{report.checks.push({label,pass:Boolean(value)});assert(value,label);};
 const sessions={},browserSessions={},browserCredentials={};
 async function req(path,{actor,body,method=body?'POST':'GET'}={}){
  assert(!/invite|recover|resend|magiclink/.test(path)||path.startsWith('/functions/')||path.startsWith('/rest/'));
  const key=actor?publicKey:secret;
  const r=await fetch(base+path,{method,headers:{apikey:key,Authorization:'Bearer '+(actor?sessions[actor]:secret),'Content-Type':'application/json',Prefer:'return=representation',Origin:origin},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json().catch(()=>null);return {status:r.status,data,ok:r.ok};
 }
 const rpc=(name,args,actor)=>req('/rest/v1/rpc/'+name,{actor,body:args});
 let resource;
 try {
  for(const letter of ['A','B','C']){
   const input={customerRequestId:randomUUID(),requestId:randomUUID(),customerName:report.runId+' Customer '+letter,venueName:report.runId+' Venue '+letter,email:`${report.runId}-admin-${letter.toLowerCase()}@example.invalid`,fullName:'Fictional Admin '+letter,timezone:letter==='B'?'America/Los_Angeles':'America/Chicago'};
   const r=await op.onboard(input);record(letter+' customer and venue created',Boolean(r.venue_id));
   record(letter+' onboarding retry retains venue',(await op.onboard(input)).venue_id===r.venue_id);
   const password=randomBytes(30).toString('base64url')+'aA7!';
   browserCredentials[letter]={email:input.email,password};
   const user=await op.createStagingUser(input,password);await op.bootstrap({requestId:input.requestId,authUserId:user.authUserId});
   await op.bootstrap({requestId:input.requestId,authUserId:user.authUserId});record(letter+' first Admin bootstrap retry',true);
   await op.lifecycle({venueId:r.venue_id,status:'active',subscriptionStatus:'trial',reason:'Fictional Phase 9 acceptance'});
   const login=await req('/auth/v1/token?grant_type=password',{body:{email:input.email,password}});record(letter+' Admin password login',login.ok&&!!login.data.access_token);sessions[letter]=login.data.access_token;browserSessions[letter]=login.data;
   const doorInput={email:`${report.runId}-door-${letter.toLowerCase()}@example.invalid`,fullName:'Fictional Door '+letter};
   browserCredentials["door"+letter]={email:doorInput.email,password};
   const door=await op.createStagingUser(doorInput,password);
   const profile=await req('/rest/v1/staff_profiles',{body:{id:door.authUserId,venue_id:r.venue_id,full_name:doorInput.fullName,role:'door',active:true}});record(letter+' Door profile',profile.ok);
   const doorLogin=await req('/auth/v1/token?grant_type=password',{body:{email:doorInput.email,password}});record(letter+' Door login',doorLogin.ok);sessions['door'+letter]=doorLogin.data.access_token;browserSessions['door'+letter]=doorLogin.data;
   const f={letter,venue:r.venue_id,organization:r.organization_id,admin:user.authUserId,door:door.authUserId,request:input.requestId,email:input.email};report.fixtures.push(f);
   const settings=await req(`/rest/v1/venue_settings?venue_id=eq.${f.venue}`,{actor:letter});record(letter+' correct timezone',settings.data?.[0]?.timezone===input.timezone);
   const edit=await rpc('doorflow_update_venue_settings',{p_name:input.venueName,p_timezone:input.timezone,p_door:'Fictional West Door',p_rollover:'05:00',p_logo:null},letter);record(letter+' own settings edit',edit.ok);
   const deny=await rpc('doorflow_update_venue_settings',{p_name:'Forbidden',p_timezone:'UTC',p_door:'Door',p_rollover:'04:00',p_logo:null},'door'+letter);record(letter+' Door settings edit denied',!deny.ok);
   const day=await req('/rest/v1/service_days',{actor:letter,body:{venue_id:f.venue,service_date:'2026-11-08',day_name:'Sunday'}});record(letter+' operational day created',day.ok);f.day=day.data[0].id;
   const group=await req('/rest/v1/groups',{actor:letter,body:{venue_id:f.venue,service_day_id:f.day,name:'General Guest List'}});record(letter+' list created',group.ok);f.group=group.data[0].id;
   const guest=await req('/rest/v1/guests',{actor:letter,body:{venue_id:f.venue,group_id:f.group,first_name:'Fictional',last_name:letter,total_allowed:1}});record(letter+' guest created',guest.ok);f.guest=guest.data[0].id;
   const disabled=await req('/functions/v1/staff-invitations',{actor:letter});record(letter+' invitation provisioning disabled',disabled.status===503&&disabled.data?.error?.code==='provisioning_disabled');
  }
  for(const a of report.fixtures)for(const b of report.fixtures)if(a!==b){
   for(const table of ['venue_settings','venue_branding','staff_profiles','service_days','groups','guests','check_in_logs','shift_notes']){
    const x=await req(`/rest/v1/${table}?venue_id=eq.${b.venue}`,{actor:a.letter});record(a.letter+' cannot read '+b.letter+' '+table,x.ok&&x.data.length===0);
   }
   const org=await req('/rest/v1/organizations?id=eq.'+b.organization,{actor:a.letter});record(a.letter+' customer records closed',!org.ok||org.data.length===0);
   const create=await rpc('doorflow_onboard_venue',{p_request_id:randomUUID(),p_organization_id:b.organization,p_name:'Forbidden',p_timezone:'UTC',p_email:'forbidden@example.invalid',p_full_name:'No',p_address:{}},a.letter);record(a.letter+' cannot create arbitrary venue',!create.ok);
  }
  // Real hosted browser: supported Auth session tokens stay only in this test process/browser.
  const server=createServer((q,r)=>{r.writeHead(404);r.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));resource=await launchBrowser(server);
  const {cdp}=resource;resource.targetId=(await cdp.send('Target.createTarget',{url:'about:blank'})).targetId;resource.sessionId=(await cdp.send('Target.attachToTarget',{targetId:resource.targetId,flatten:true})).sessionId;
  const sid=resource.sessionId;await cdp.send('Page.enable',{},sid);await cdp.send('Runtime.enable',{},sid);await cdp.send('Page.navigate',{url:origin},sid);
  const run=expression=>evaluate(cdp,sid,expression);
  async function until(expression){for(let n=0;n<80;n++){if(await run(expression))return;await new Promise(r=>setTimeout(r,250));}throw Error('Browser readiness timeout');}
  await until('typeof db !== "undefined" && !!db');
  // Authenticate the real browser with the supported session API; tokens stay in memory.
  for(const f of report.fixtures){
   await run('logout()');
   const session=browserSessions[f.letter];
   await run(`db.auth.signInWithPassword(${JSON.stringify(browserCredentials[f.letter])})`);
   await until(`auth.profile?.venue_id===${JSON.stringify(f.venue)} && state.venue?.id===${JSON.stringify(f.venue)} && !state.loading`);
   await run('switchView("settings")');
   record(f.letter+' hosted settings page',await run('document.body.innerText.includes("Venue Settings") && document.body.innerText.includes("'+f.letter+'")'));
   await run("document.querySelector('input[name=\"door\"]').value=\"Browser Door\"; document.querySelector('input[name=\"door\"]').form.requestSubmit()");
   await until('state.venueSettings?.default_door_location==="Browser Door"');
   record(f.letter+' settings form saves',true);
   record(f.letter+' generic brand',await run('currentVenueBrand().appName===state.venue.name && venueBoothOptions().length===0'));
   record(f.letter+' account switch isolated',await run(`state.guests.every(g=>g.venue_id===${JSON.stringify(f.venue)})`));
  }
  await run('logout()');
  await run(`db.auth.signInWithPassword(${JSON.stringify(browserCredentials.doorA)})`);
  await until('auth.profile?.role==="door" && !!state.venue');
  record('Door A cannot navigate settings',await run('!viewAllowedForRole("settings") && !renderTabs().includes("Venue Settings")'));
  await run('logout()');
  await run(`db.auth.signInWithPassword(${JSON.stringify(browserCredentials.C)})`);
  await until('auth.profile?.role==="admin" && state.venue?.id==='+JSON.stringify(report.fixtures[2].venue));
  const c=report.fixtures[2];
  for(const status of ['suspended','canceled']){
   await op.lifecycle({venueId:c.venue,status,subscriptionStatus:status,reason:'Fictional lifecycle acceptance'});
   const denied=await req('/rest/v1/service_days?venue_id=eq.'+c.venue,{actor:'C'});record(status+' operations hidden',denied.ok&&denied.data.length===0);
   const write=await req('/rest/v1/guests?id=eq.'+c.guest,{actor:'C',method:'PATCH',body:{first_name:'Forbidden'}});record(status+' operational write denied',!write.ok||write.data.length===0);
   const reserve=await rpc('doorflow_reserve_staff_invitation',{p_actor_user_id:c.admin,p_venue_id:c.venue,p_email:report.runId+'-reserved@example.invalid',p_normalized_email:report.runId+'-reserved@example.invalid',p_full_name:'Fictional Reserved',p_requested_role:'door',p_idempotency_key:randomUUID(),p_request_fingerprint:'fictional',p_request_id:randomUUID()});record(status+' invitation reservation refused',reserve.data?.decision_code==='forbidden');
   await run('ensureVenue().then(()=>render())');await run('switchView("door"); render()');record(status+' hosted status screen',await run('state.venueOperational===false && document.body.innerText.includes("Venue operations unavailable")'));
   const preserved=await req('/rest/v1/guests?id=eq.'+c.guest);record(status+' history preserved',preserved.data?.[0]?.first_name==='Fictional');
   await op.lifecycle({venueId:c.venue,status:'active',subscriptionStatus:'active',reason:'Restore fictional acceptance venue'});
   const restored=await req('/rest/v1/guests?id=eq.'+c.guest,{actor:'C'});record(status+' reactivation restores data',restored.data?.length===1);
  }
  await run('logout()');report.complete=true;
 }finally{
  if(resource)report.browserCleanup=await disposeBrowser(resource);
  report.passed=report.checks.filter(x=>x.pass).length;report.failed=report.checks.filter(x=>!x.pass).length;
  await writeFile(reportPath,JSON.stringify(report,null,2));
 }
 return report;
}
