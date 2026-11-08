import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../app.js',import.meta.url),'utf8');
function harness() {
 const root={innerHTML:'',setAttribute(){}}; const timers=[]; const requests=[];const channels=[];let session=null,held=null,authCallback=null;
 const profiles={A:{id:'A',full_name:'Admin A',role:'admin',active:true,venue_id:'venue-A'},B:{id:'B',full_name:'Admin B',role:'admin',active:true,venue_id:'venue-B'}};
 const rows={venues:['A','B'].map(x=>({id:'venue-'+x,name:'Venue '+x})),staff_profiles:Object.values(profiles),
 service_days:['A','B'].map(x=>({id:'day-'+x,venue_id:'venue-'+x,service_date:'2026-11-08',day_name:'Sunday'})),
 groups:['A','B'].map(x=>({id:'group-'+x,venue_id:'venue-'+x,service_day_id:'day-'+x,name:'General Guest List',group_type:'General Guest List'})),
 guests:['A','B'].map(x=>({id:'guest-'+x,venue_id:'venue-'+x,group_id:'group-'+x,first_name:'Guest',last_name:x,total_allowed:1,checked_in_count:0})),
 check_in_logs:['A','B'].map(x=>({id:'log-'+x,venue_id:'venue-'+x,group_id:'group-'+x,guest_id:'guest-'+x,action:'Check In 1',amount:1})),
 shift_notes:['A','B'].map(x=>({id:'note-'+x,venue_id:'venue-'+x,service_day_id:'day-'+x,note_text:'Note '+x}))};
 const db={auth:{onAuthStateChange(fn){authCallback=fn;return {data:{subscription:{unsubscribe(){}}}}},async getSession(){return {data:{session},error:null}},async getUser(){return {data:{user:session?.user},error:null}},async signOut(){session=null;return {error:null}}},
 realtime:{setAuth(){}},removeChannel(channel){channel.removed=true},channel(name){const ch={name,events:[],on(type,filter,callback){this.events.push({type,filter,callback});return this},subscribe(callback){this.status=callback;return this}};channels.push(ch);return ch},
 from(table){let operation='select',values,single=false;const filters=[];const q={select(){return this},eq(k,v){filters.push(['eq',k,v]);return this},in(k,v){filters.push(['in',k,v]);return this},order(){return this},limit(){return this},maybeSingle(){single=true;return this},insert(v){operation='insert';values=v;return this},update(v){operation='update';values=v;return this},delete(){operation='delete';return this},then(resolve,reject){
 const request={table,operation,values,filters:[...filters]};requests.push(request);
 let data=table==='staff_profiles' ? Object.values(profiles) : rows[table]||[];
 data=data.filter(row=>filters.every(([op,k,v])=>op==='eq'?row[k]===v:v.includes(row[k])));
 if(operation==='insert')data=(Array.isArray(values)?values:[values]).map((row,i)=>({id:'created-'+i,...row}));
 if(operation==='update')data=data.map(row=>({...row,...values}));
 const result={data:single?data[0]||null:data,error:null};
 if(held&&held.table===table&&(!held.operation||held.operation===operation)) {const gate=held;held=null;gate.started();return gate.promise.then(()=>result).then(resolve,reject);}
 return Promise.resolve(result).then(resolve,reject);
 }};return q;}};
 const sandbox={console:{...console,error(){},warn(){}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(){},setInterval(){return 1},clearInterval(){},AbortController,fetch(){throw Error('Unexpected external fetch')},URL,URLSearchParams,FormData,Date,Blob,Object,JSON,Promise,Error,localStorage:{removeItem(){}},navigator:{onLine:true},alert(){},confirm(){return true},document:{getElementById(id){return id==='app'?root:null},addEventListener(){},querySelector(){return null},querySelectorAll(){return []},hidden:false,body:{},documentElement:{},activeElement:null},window:{innerWidth:1200,innerHeight:900,matchMedia(){return {matches:false,addEventListener(){}}},addEventListener(){},setTimeout(fn,ms){timers.push({fn,ms});return timers.length}}};
 const ctx=vm.createContext(sandbox);vm.runInContext(source.slice(0,source.indexOf('// No client, login or operational work')),ctx);
 ctx.fixtureDb=db;vm.runInContext('db=fixtureDb; render=()=>{}; refreshLiveSurfaces=()=>true; refreshCheckActionSurfaces=()=>{};',ctx);
 const run=code=>vm.runInContext(code,ctx);
 return {run,profiles,requests,channels,root,timers,async emit(event){authCallback(event,session);const queued=timers.filter(x=>x.ms===0);for(const x of queued){timers.splice(timers.indexOf(x),1);x.fn();}for(let i=0;i<6;i++)await new Promise(setImmediate);},async signIn(id){session=id?{user:{id,email:id+'@example.invalid'},access_token:'fictional',expires_at:4102444800}:null;ctx.newSession=session;run('acceptAuthSession(newSession)');return id?await run('loadStaffProfile(newSession.user)'):null},hold(table,operation){let release,started;const promise=new Promise(r=>release=r),began=new Promise(r=>started=r);held={table,operation,promise,started};return {release,began}},state(){return run('JSON.parse(JSON.stringify(state))')}};
}
test('profile venue is sole authority; missing/inactive/unknown profiles cannot issue operational requests',async()=>{
 const h=harness();await h.signIn('B');assert.equal((await h.run('ensureVenue()')).id,'venue-B');
 assert.deepEqual(h.requests.filter(x=>x.table==='venues').map(x=>x.filters),[[['eq','id','venue-B'],['eq','id','venue-B']]]);
 for(const change of [{venue_id:null},{active:false},{role:'unexpected'}]){Object.assign(h.profiles.A,{id:'A',full_name:'A',role:'admin',active:true,venue_id:'venue-A'},change);await h.signIn('A');assert.equal(h.run('auth.currentUser'),null);assert.equal(h.state().venue,null);assert.equal(h.state().guests.length,0);assert.throws(()=>h.run('venueTable("guests")'));}
 assert.equal(h.requests.some(x=>x.table==='venues'&&x.operation==='insert'),false);
});
test('all operational reads, bulk inserts, updates and deletes carry assigned venue',async()=>{
 const h=harness();await h.signIn('A');await h.run('loadDataForDate("2026-11-08")');assert.deepEqual(h.state().guests.map(x=>x.id),['guest-A']);assert.deepEqual(h.state().logs.map(x=>x.id),['log-A']);assert.deepEqual(h.state().shiftNotes.map(x=>x.id),['note-A']);
 await h.run('loadStaffProfilesForAdmin()');assert.deepEqual(h.state().staffProfiles.map(x=>x.id),['A']);
 await h.run('venueTable("guests").insert([{first_name:"One"},{first_name:"Two"}])');
 await h.run('venueTable("guests").update({notes:"Updated"}).eq("id","guest-A")');
 await h.run('venueTable("guests").delete().eq("id","guest-A")');
 for(const r of h.requests.filter(r=>r.table!=='staff_profiles'||!r.filters.some(f=>f[1]==='id'))){if(r.operation==='insert')assert.ok(r.values.every(x=>x.venue_id==='venue-A'));else assert.ok(r.filters.some(f=>f[1]===(r.table==='venues'?'id':'venue_id')&&f[2]==='venue-A'),JSON.stringify(r));}
 assert.throws(()=>h.run('venueTable("guests").insert({venue_id:"venue-B"})'));
 assert.throws(()=>h.run('venueTable("guests").update({venue_id:"venue-A"})'));
});
test('A to B and B to A clear all lists, reports, selections, drafts, hash and channels synchronously',async()=>{
 const h=harness();await h.signIn('A');await h.run('loadDataForDate("2026-11-08")');h.run('state.staffInviteDraft.email="private-A";state.modal="bulk";state.importMessage="A draft";state.selectedGroupId="group-A";subscribeRealtime()');
 const old=h.channels[0];const pending=h.signIn('B');const cleared=h.state();for(const key of ['groups','guests','logs','shiftNotes','staffProfiles','staffInvitations'])assert.deepEqual(cleared[key],[]);assert.equal(cleared.venue,null);assert.equal(cleared.serviceDay,null);assert.equal(cleared.lastDataHash,'');assert.equal(cleared.modal,null);assert.equal(cleared.staffInviteDraft.email,'');assert.equal(old.removed,true);await pending;
 await h.run('loadDataForDate("2026-11-08")');assert.deepEqual(h.state().guests.map(x=>x.id),['guest-B']);assert.ok(!h.run('renderReports()').includes('Guest A'));
 await h.signIn('A');await h.run('loadDataForDate("2026-11-08")');assert.deepEqual(h.state().guests.map(x=>x.id),['guest-A']);
 await h.run('logout()');for(const key of ['groups','guests','logs','shiftNotes','staffProfiles'])assert.deepEqual(h.state()[key],[]);assert.equal(h.state().venue,null);assert.equal(h.state().lastDataHash,'');
});
test('held A profile/data/mutation results cannot restore after B login',async()=>{
 for(const kind of ['profile','data','mutation']){const h=harness();await h.signIn('A');const gate=h.hold(kind==='profile'?'staff_profiles':'guests',kind==='mutation'?'update':undefined);let work;
 if(kind==='profile')work=h.run('loadStaffProfile(auth.session.user)');
 else if(kind==='data')work=h.run('loadDataForDate("2026-11-08")');
 else work=h.run('(async()=>{const result=await venueTable("guests").update({notes:"A result"}).eq("id","guest-A");state.guests=result.data})()');
 const settled=Promise.resolve(work).catch(e=>e);await gate.began;await h.signIn('B');gate.release();await settled;assert.equal(h.run('auth.currentUser.id'),'B');assert.deepEqual(h.state().guests,[]);assert.equal(h.state().error,'');}
});
test('profile role/venue/active changes revalidate on TOKEN_REFRESHED and old realtime cannot touch new context',async()=>{
 const h=harness();await h.signIn('A');await h.run('loadDataForDate("2026-11-08");');h.run('subscribeRealtime()');const old=h.channels[0];
 assert.ok(old.events.filter(x=>x.filter.table!=='staff_profiles'||x.filter.event==='*').every(x=>x.filter.filter==='venue_id=eq.venue-A'));
 Object.assign(h.profiles.A,{venue_id:'venue-B',role:'manager'});await h.run('handleAuthenticatedSession("TOKEN_REFRESHED",auth.session)');assert.equal(h.run('auth.profile.venue_id'),'venue-B');assert.equal(h.run('auth.currentUser.role'),'manager');assert.deepEqual(h.state().guests.map(x=>x.id),['guest-B']);
 const before=h.state();old.status('CHANNEL_ERROR');old.events[0].callback({new:{venue_id:'venue-A',group_id:'group-A'}});assert.deepEqual(h.state(),before);
 h.profiles.A.active=false;await h.run('handleAuthenticatedSession("TOKEN_REFRESHED",auth.session)');assert.equal(h.run('auth.currentUser'),null);assert.deepEqual(h.state().guests,[]);assert.match(h.state().error,/inactive/);
});

test('registered TOKEN_REFRESHED hook revalidates database profile; unchanged authority keeps current ownership',async()=>{
 const h=harness();await h.signIn('A');await h.run('initAuth()');const before=h.run('captureAuthenticatedContext()');await h.emit('TOKEN_REFRESHED');assert.equal(h.run('authenticatedContextGeneration'),before.generation);
 Object.assign(h.profiles.A,{venue_id:'venue-B',role:'viewer'});await h.emit('TOKEN_REFRESHED');assert.equal(h.run('auth.currentUser.role'),'viewer');assert.equal(h.run('auth.profile.venue_id'),'venue-B');assert.deepEqual(h.state().guests.map(x=>x.id),['guest-B']);assert.ok(h.run('authenticatedContextGeneration')>before.generation);
});
test('ordinary Admin staff read always rejects its old response after account switch',async()=>{
 const h=harness();await h.signIn('A');const gate=h.hold('staff_profiles');const work=h.run('loadStaffProfilesForAdmin()').catch(e=>e);await gate.began;await h.signIn('B');gate.release();await work;assert.deepEqual(h.state().staffProfiles,[]);assert.equal(h.run('auth.currentUser.id'),'B');
});
test('logout clears immediately even when provider request never completes',async()=>{
 const h=harness();await h.signIn('A');await h.run('loadDataForDate("2026-11-08")');h.run('db.auth.signOut=()=>new Promise(()=>{});logout();');assert.equal(h.run('auth.currentUser'),null);assert.equal(h.state().venue,null);assert.equal(h.state().serviceDay,null);assert.deepEqual(h.state().shiftNotes,[]);assert.equal(h.state().lastDataHash,'');
});
test('inline runtime is identical to app.js',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');const start=html.indexOf('let SUPABASE_URL;'),end=html.indexOf('</script>',start);assert.equal(html.slice(start,end).trim(),source.trim());
});
test('same-user SIGNED_IN on tab refocus preserves Staff while revalidating authority and enforcing changed permissions',async()=>{
 const h=harness();await h.signIn('A');await h.run('initAuth()');h.run('state.view="users"');
 const generation=h.run('authenticatedContextGeneration');const profileReads=h.requests.filter(x=>x.table==='staff_profiles').length;
 await h.emit('SIGNED_IN');
 assert.equal(h.state().view,'users','A refocus SIGNED_IN must retain the permitted Staff view');
 assert.equal(h.run('authenticatedContextGeneration'),generation,'Unchanged authority retains the current generation');
 assert.ok(h.requests.filter(x=>x.table==='staff_profiles').length>profileReads,'Refocus still revalidates the database profile');
 assert.deepEqual(h.state().guests.map(x=>x.id),['guest-A']);
 h.profiles.A.role='viewer';await h.emit('SIGNED_IN');
 assert.equal(h.state().view,'reports','The old Staff view must be dropped after permission loss');
 assert.ok(h.run('authenticatedContextGeneration')>generation);
 await h.signIn('B');assert.equal(h.state().view,'door','A different account starts at its allowed default view');
});
