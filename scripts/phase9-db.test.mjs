import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.env.DOORFLOW_PGLITE_MODULE).href);
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort();
async function setup(missing){const db=await PGlite.create();await db.exec(read('supabase/tests/fixtures/phase_8_2c_production_schema.sql'));for(const file of files){if(missing&&file.includes('saas_venue_foundation'))await db.exec('DROP TABLE public.organization_memberships,public.venue_memberships,public.venue_settings,public.venue_branding,public.subscription_accounts,public.organizations');await db.exec(read('supabase/migrations/'+file));}return db;}
for(const missing of [true,false])test('Phase 9 real RLS and bootstrap; missing old SaaS tables='+missing,async()=>{
 const db=await setup(missing);let probes=0;
 const rpc=async(name,args)=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 async function as(user,sql,args=[],denied=false){await db.exec('begin; set local role authenticated');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);let result=await db.query(sql,args);if(denied)assert.equal(result.rows.length,0);probes++;return result.rows;}catch(e){if(!denied||!['42501','P0001'].includes(e.code))throw e;probes++;}finally{await db.exec('rollback');}}
 try{
 const fixtures=[];
 for(const letter of ['A','B','C']){
 const org=randomUUID(),request=randomUUID(),admin=randomUUID(),door=randomUUID();
 await rpc('doorflow_create_customer',['Fictional '+letter,org]);
 const args=[request,org,'Venue '+letter,'America/Chicago',`admin${letter}@example.invalid`,'Admin '+letter,{}];
 const r=await rpc('doorflow_onboard_venue',args);assert.equal((await rpc('doorflow_onboard_venue',args)).venue_id,r.venue_id);
 await assert.rejects(rpc('doorflow_onboard_venue',[request,org,'Changed','UTC',args[4],args[5],{}]),/idempotency/);
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[admin,args[4].toLowerCase(),door,`door${letter}@example.invalid`]);
 await rpc('doorflow_bootstrap_admin',[request,admin]);await rpc('doorflow_bootstrap_admin',[request,admin]);
 await rpc('doorflow_set_venue_lifecycle',[r.venue_id,'active','trial','Test activation']);
 await db.query("insert into staff_profiles(id,full_name,role,venue_id) values($1,'Door','door',$2)",[door,r.venue_id]);
 await db.query("insert into service_days(venue_id,service_date,day_name) values($1,'2026-11-08','Sunday')",[r.venue_id]);
 fixtures.push({org,request,admin,door,venue:r.venue_id});
 }
 for(const a of fixtures){
 for(const b of fixtures){
 assert.equal((await as(a.admin,'select id from venues where id=$1',[b.venue])).length,a===b?1:0);
 for(const table of ['venue_settings','venue_branding','service_days','staff_profiles'])assert.equal((await as(a.admin,`select * from ${table} where venue_id=$1`,[b.venue])).length,a===b?(table==='staff_profiles'?2:1):0);
 await as(a.admin,'update venues set organization_id=$1 where id=$2 returning id',[a.org,b.venue],true);
 }
 await as(a.admin,'select * from organizations',[],true);
 await as(a.admin,"select doorflow_create_customer('Unauthorized',$1)",[randomUUID()],true);
 await as(a.admin,"select doorflow_update_venue_settings('New name','UTC','West Door','05:00',null)");
 await as(a.door,"select doorflow_update_venue_settings('Changed','UTC','West','05:00',null)",[],true);
 for(const status of ['suspended','canceled']){
 await rpc('doorflow_set_venue_lifecycle',[a.venue,status,status,'Test lifecycle']);
 assert.equal((await as(a.admin,'select * from service_days')).length,0);
 await as(a.admin,"insert into service_days(venue_id,service_date,day_name) values($1,'2026-11-09','Monday') returning id",[a.venue],true);
 assert.equal((await db.query('select count(*)::int n from service_days where venue_id=$1',[a.venue])).rows[0].n,1);
 assert.equal((await rpc('doorflow_reserve_staff_invitation',[a.admin,a.venue,'staff@example.invalid','staff@example.invalid','Staff','door','key','fingerprint',randomUUID()])).decision_code,'forbidden');
 await rpc('doorflow_set_venue_lifecycle',[a.venue,'active','active','Test restore']);
 assert.equal((await as(a.admin,'select * from service_days')).length,1);
 }
 await rpc('doorflow_set_customer_status',[a.org,'suspended','Customer pause test']);
 assert.equal((await as(a.admin,'select * from service_days')).length,0);
 await rpc('doorflow_set_customer_status',[a.org,'active','Customer restore test']);
 assert.equal((await as(a.admin,'select * from service_days')).length,1);
 await assert.rejects(rpc('doorflow_bootstrap_admin',[a.request,fixtures.find(b=>b!==a).admin]),/identity/);
 }
 console.log(JSON.stringify({phase9:true,missing,probes,customers:3}));
 }finally{await db.close();}
});
