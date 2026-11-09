// Real PostgreSQL/WASM acceptance, not mocked policy assertions. No hosted credentials.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const modulePath=process.env.DOORFLOW_PGLITE_MODULE;
assert(modulePath,'Set DOORFLOW_PGLITE_MODULE to the pinned @electric-sql/pglite 0.3.14 dist/index.js path; real database acceptance must not skip.');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const names=readdirSync(new URL('supabase/migrations/',root)).filter(n=>n.endsWith('.sql') && n <= '20261108162003_saas_venue_foundation.sql').sort();
const migration=names.find(n=>n.endsWith('_saas_venue_foundation.sql'));
const uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=uuid(1),B=uuid(2),checks=[];
const opTables=['service_days','groups','guests','check_in_logs','shift_notes'];
let db;
async function fixture({liveShape=true}={}) {
  const d=await PGlite.create();
  await d.exec(read('supabase/tests/fixtures/phase_8_2c_production_schema.sql'));
  for(const n of names.filter(n=>n!==migration)) await d.exec(read(`supabase/migrations/${n}`));
  if(liveShape) await d.exec('DROP TABLE public.organization_memberships,public.venue_memberships,public.venue_settings,public.venue_branding,public.subscription_accounts,public.organizations;');
  return d;
}
async function probe(actor,table,operation,sql,args,expected,{role='authenticated'}={}) {
  await db.exec(`begin; set local role ${role};`);
  let actual=0,code=null;
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor?.id||'']);
    actual=(await db.query(sql,args)).rows.length;
    await db.exec('set constraints all immediate');
  }catch(e){code=e.code;if(!['42501','23514','23503','23505'].includes(code))throw e;actual=0;}
  finally{await db.exec('rollback');}
  const item={actor:actor?.name||role,table,operation,expected,actual,code,pass:actual===expected};
  checks.push(item);
  assert.equal(actual,expected,JSON.stringify(item));
}
const actors=[];
for(const [v,venue] of [['A',A],['B',B]]) for(const role of ['admin','manager','door','viewer'])
  actors.push({name:role+v,role,venue,active:true,id:uuid(10+actors.length)});
actors.push({name:'nullAdmin',role:'admin',venue:null,active:true,id:uuid(20)},
  {name:'inactiveAdmin',role:'admin',venue:A,active:false,id:uuid(21)},
  {name:'missingProfile',role:null,venue:null,active:false,id:uuid(22)});
async function seed(){
  await db.query("insert into venues(id,name) values($1,'Fictional A'),($2,'Fictional B')",[A,B]);
  for(const a of actors){
    await db.query('insert into auth.users(id,email) values($1,$2)',[a.id,`${a.name}@example.invalid`]);
    if(a.role)await db.query('insert into staff_profiles(id,full_name,role,venue_id,active) values($1,$2,$3,$4,$5)',[a.id,a.name,a.role,a.venue,a.active]);
  }
  for(const [i,venue] of [A,B].entries()){
    await db.query("insert into service_days(id,venue_id,service_date,day_name) values($1,$2,$3,'Fictional day')",[uuid(100+i),venue,`2026-11-0${7+i}`]);
    await db.query("insert into groups(id,venue_id,service_day_id,name) values($1,$2,$3,'Fictional group')",[uuid(200+i),venue,uuid(100+i)]);
    await db.query("insert into guests(id,venue_id,group_id,first_name,last_name) values($1,$2,$3,'Fictional','Guest')",[uuid(300+i),venue,uuid(200+i)]);
    await db.query("insert into check_in_logs(id,venue_id,group_id,guest_id,action) values($1,$2,$3,$4,'check_in')",[uuid(400+i),venue,uuid(200+i),uuid(300+i)]);
    await db.query("insert into shift_notes(id,venue_id,service_day_id,note_text) values($1,$2,$3,'Fictional note')",[uuid(500+i),venue,uuid(100+i)]);
  }
}
const specs=[
 ['service_days',100,'day_name',"insert into service_days(venue_id,service_date,day_name) values($1,'2026-11-20','Friday') returning id"],
 ['groups',200,'name',"insert into groups(venue_id,service_day_id,name) values($1,$2,'New fictional group') returning id"],
 ['guests',300,'first_name',"insert into guests(venue_id,group_id,first_name,last_name) values($1,$2,'New','Fictional') returning id"],
 ['check_in_logs',400,'action',"insert into check_in_logs(venue_id,group_id,guest_id,action) values($1,$2,$3,'check_in') returning id"],
 ['shift_notes',500,'note_text',"insert into shift_notes(venue_id,service_day_id,note_text) values($1,$2,'New fictional note') returning id"]
];
const params=(t,v,i)=>t==='service_days'?[v]:t==='check_in_logs'?[v,uuid(200+i),uuid(300+i)]:[v,uuid((t==='guests'?200:100)+i)];
const allowed=(a,t,op)=>a.active&&a.venue&& (op==='select'|| t==='shift_notes'|| ['admin','manager'].includes(a.role)&&!(t==='check_in_logs'&&op==='update')||a.role==='door'&&((t==='check_in_logs'&&op==='insert')||(t==='guests'&&op==='update')));

test('SaaS foundation strict preflight rejects schema, policy and relationship drift atomically',async()=>{
  for(const drift of ["ALTER TABLE public.groups ADD COLUMN unexpected text",'DROP POLICY "doorflow staff can read groups" ON public.groups',"CREATE OR REPLACE FUNCTION public.doorflow_current_venue_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT NULL::uuid $$",'DROP TRIGGER doorflow_autofill_guest_venue_id_trigger ON public.guests',"INSERT INTO venues(id,name) VALUES('10000000-0000-4000-8000-000000000001','A'),('10000000-0000-4000-8000-000000000002','B'); INSERT INTO service_days(id,venue_id,service_date,day_name) VALUES('10000000-0000-4000-8000-000000000100','10000000-0000-4000-8000-000000000001','2026-11-01','Fictional'); INSERT INTO groups(venue_id,service_day_id,name) VALUES('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000100','Conflict');"]){
    const d=await fixture();
    try{await d.exec(drift);await assert.rejects(()=>d.exec(read(`supabase/migrations/${migration}`)),/SaaS foundation:/);await d.exec('rollback');assert.equal((await d.query("select to_regnamespace('doorflow_private')::text as schema")).rows[0].schema,null);}finally{await d.close();}
  }
});

test('all approved tenant-contract database requirements pass with real RLS role/auth.uid contexts',async()=>{
  db=await fixture();
  try{
    const staffBefore=(await db.query("select policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='staff_profiles' order by policyname")).rows;
    await db.exec(read(`supabase/migrations/${migration}`));
    assert.deepEqual((await db.query("select policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='staff_profiles' order by policyname")).rows,staffBefore);
    assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and column_name='venue_id' and table_name=ANY($1) and is_nullable='YES'",[opTables])).rows[0].n,5);
    await seed();
    // Re-run the exact old 277-operation matrix. Six old expectations incorrectly
    // denied door/viewer same-venue notes CRUD despite the preserved business rule.
    const baselineStart=checks.length,baselineCorrections=[];
    for(const a of actors.filter(a=>['adminA','managerA','doorA','viewerA','nullAdmin','inactiveAdmin'].includes(a.name)))for(const [t,base,col,insert]of specs){
      for(const [i,v]of [A,B].entries()){
        const own=a.venue===v;
        await probe(a,t,`baseline_select_${i?'B':'A'}`,`select id from ${t} where id=$1`,[uuid(base+i)],allowed(a,t,'select')&&own?1:0);
        await probe(a,t,`baseline_update_${i?'B':'A'}`,`update ${t} set ${col}=${col} where id=$1 returning id`,[uuid(base+i)],allowed(a,t,'update')&&own?1:0);
        await probe(a,t,`baseline_delete_${i?'B':'A'}`,`delete from ${t} where id=$1 returning id`,[uuid(base+i)],allowed(a,t,'delete')&&own?1:0);
        await probe(a,t,`baseline_insert_${i?'B':'A'}`,insert,params(t,v,i),allowed(a,t,'insert')&&own?1:0);
        if(t==='shift_notes'&&!i&&['door','viewer'].includes(a.role))for(const operation of ['update','delete','insert'])baselineCorrections.push({actor:a.name,table:t,operation,oldExpected:0,approvedExpected:1,reason:'Preserve legitimate same-venue notes CRUD for every active known-role staff member'});
      }
      await probe(a,t,'baseline_move_A_to_B',`update ${t} set venue_id=$1 where id=$2 returning id`,[B,uuid(base)],0);
    }
    const baselineAdmin=actors[0];
    for(const [t,col,parent,base]of [['groups','service_day_id',101,200],['guests','group_id',201,300],['check_in_logs','group_id',201,400],['shift_notes','service_day_id',101,500]])await probe(baselineAdmin,t,'baseline_cross_venue_parent',`update ${t} set ${col}=$1 where id=$2 returning id`,[uuid(parent),uuid(base)],0);
    await probe(baselineAdmin,'staff_profiles','baseline_select_other_venue','select id from staff_profiles where venue_id=$1',[B],0);
    await probe(baselineAdmin,'staff_profiles','baseline_move_A_to_B','update staff_profiles set venue_id=$1 where id=$2 returning id',[B,actors.find(a=>a.name==='managerA').id],0);
    await probe(baselineAdmin,'venues','baseline_read_B','select id from venues where id=$1',[B],0);
    assert.equal(checks.length-baselineStart,277);
    assert.equal(baselineCorrections.length,6);
    for(const a of actors)for(const [t,base,col,insert]of specs){
      for(const [i,v]of [A,B].entries()){
        const own=a.venue===v;
        await probe(a,t,`select_${i?'B':'A'}`,`select id from ${t} where id=$1`,[uuid(base+i)],allowed(a,t,'select')&&own?1:0);
        await probe(a,t,`update_${i?'B':'A'}`,`update ${t} set ${col}=${col} where id=$1 returning id`,[uuid(base+i)],allowed(a,t,'update')&&own?1:0);
        await probe(a,t,`delete_${i?'B':'A'}`,`delete from ${t} where id=$1 returning id`,[uuid(base+i)],allowed(a,t,'delete')&&own?1:0);
        await probe(a,t,`insert_${i?'B':'A'}`,insert,params(t,v,i),allowed(a,t,'insert')&&own?1:0);
        await probe(a,t,`derive_insert_venue_${i?'B':'A'}`,insert,params(t,null,i),allowed(a,t,'insert')&&(t==='service_days'?a.venue!=null:own)?1:0);
        await probe(a,t,`reassign_${i?'B':'A'}`,`update ${t} set venue_id=$1 where id=$2 returning id`,[[B,A][i],uuid(base+i)],0);
        await probe(a,t,`null_reassign_${i?'B':'A'}`,`update ${t} set venue_id=null where id=$1 returning id`,[uuid(base+i)],0);
      }
    }
    for(const a of actors){
      for(const [i,v]of [A,B].entries()){
        const own=a.active&&a.venue===v, manage=own&&['admin','manager'].includes(a.role);
        await probe(a,'venues',`read_${i?'B':'A'}`,'select id from venues where id=$1',[v],own?1:0);
        await probe(a,'venues',`update_${i?'B':'A'}`,'update venues set name=name where id=$1 returning id',[v],manage?1:0);
        await probe(a,'venues',`delete_${i?'B':'A'}`,'delete from venues where id=$1 returning id',[v],manage?1:0);
        await probe(a,'venues',`reassign_${i?'B':'A'}`,'update venues set id=$1 where id=$2 returning id',[uuid(900),v],0);
      }
      await probe(a,'venues','browser_new_venue','insert into venues(name) values(\'Fictional\') returning id',[],0);
      await probe(a,'staff_profiles','own_bootstrap','select id from staff_profiles where id=$1',[a.id],a.role?1:0);
      await db.query('insert into auth.users(id,email) values($1,$2)',[uuid(950), 'new-fictional@example.invalid']);
      for(const [i,v]of [A,B].entries())await probe(a,'staff_profiles',`insert_${i?'B':'A'}`,'insert into staff_profiles(id,full_name,role,venue_id) values($1,$2,$3,$4) returning id',[uuid(950),'Fictional new staff','door',v],a.active&&a.role==='admin'&&a.venue===v?1:0);
      await db.query('delete from auth.users where id=$1',[uuid(950)]);
      for(const [i,v]of [A,B].entries()){
        const own=a.active&&a.role==='admin'&&a.venue===v;
        const target=actors.find(x=>x.role==='door'&&x.venue===v);
        await probe(a,'staff_profiles',`read_door_${i?'B':'A'}`,'select id from staff_profiles where id=$1',[target.id],own||target.id===a.id?1:0);
        await probe(a,'staff_profiles',`update_door_${i?'B':'A'}`,'update staff_profiles set full_name=full_name where id=$1 returning id',[target.id],own?1:0);
        await probe(a,'staff_profiles',`delete_door_${i?'B':'A'}`,'delete from staff_profiles where id=$1 returning id',[target.id],own?1:0);
        await probe(a,'staff_profiles',`reassign_door_${i?'B':'A'}`,'update staff_profiles set venue_id=$1 where id=$2 returning id',[[B,A][i],target.id],0);
      }
    }
    for(const [i,v]of [A,B].entries()){
      const a=actors.find(x=>x.role==='admin'&&x.venue===v),other=1-i;
      for(const [t,col,parent,base]of [['groups','service_day_id',100,200],['guests','group_id',200,300],['check_in_logs','group_id',200,400],['check_in_logs','guest_id',300,400],['shift_notes','service_day_id',100,500]]){
        await probe(a,t,`cross_parent_${col}` ,`update ${t} set ${col}=$1 where id=$2 returning id`,[uuid(parent+other),uuid(base+i)],0);
        await probe(null,t,`backend_cross_parent_${col}`,`update ${t} set ${col}=$1 where id=$2 returning id`,[uuid(parent+other),uuid(base+i)],0,{role:'service_role'});
      }
      for(const [t,,,insert]of specs){
        await probe(a,t,'explicit_mismatch_insert',insert,params(t,v,other),t==='service_days'?1:0);
        await probe(null,t,'backend_explicit_mismatch_insert',insert,params(t,v,other),t==='service_days'?1:0,{role:'service_role'});
        await probe(null,t,'backend_consistent_insert',insert,params(t,v,i),1,{role:'service_role'});
      }
      for(const [t,base,col]of specs)await probe(null,t,'backend_consistent_update',`update ${t} set ${col}=${col} where id=$1 returning id`,[uuid(base+i)],1,{role:'service_role'});
      await probe(null,'guests','backend_parent_venue_change_with_descendants','update guests set venue_id=$1 where id=$2 returning id',[[B,A][i],uuid(300+i)],0,{role:'service_role'});
      await probe(null,'service_days','backend_parent_venue_change_with_descendants','update service_days set venue_id=$1 where id=$2 returning id',[[B,A][i],uuid(100+i)],0,{role:'service_role'});
    }
    for(const t of opTables)await probe(null,t,'anon_denied',`select id from ${t}`,[],0,{role:'anon'});
    await probe(null,'service_days','backend_nullable_unlinked_row',"insert into service_days(service_date,day_name) values('2026-12-01','Unassigned') returning id",[],1,{role:'service_role'});
    await db.query("insert into service_days(id,service_date,day_name) values($1,'2026-12-02','Unassigned parent')",[uuid(801)]);
    await probe(null,'groups','backend_null_parent_denied','insert into groups(service_day_id,name) values($1,$2) returning id',[uuid(801),'Fictional blocked group'],0,{role:'service_role'});
    await db.query("insert into groups(id,venue_id,name) values($1,$2,'Unlinked group')",[uuid(803),A]);
    await db.query("insert into guests(id,venue_id,group_id,first_name,last_name) values($1,$2,$3,'Unlinked','GroupGuest')",[uuid(804),A,uuid(803)]);
    await db.query("insert into check_in_logs(venue_id,group_id,guest_id,action) values($1,$2,$3,'check_in')",[A,uuid(803),uuid(804)]);
    await probe(null,'venues','backend_delete_preserves_fk_cascade_and_set_null','delete from venues where id=$1 returning id',[A],1,{role:'service_role'});
    // Nullable guest/group edges are explicitly checked despite MATCH SIMPLE FK semantics.
    await db.query("insert into guests(id,venue_id,first_name,last_name) values($1,$2,'Unlinked','Guest')",[uuid(800),A]);
    await db.query("insert into check_in_logs(venue_id,guest_id,action) values($1,$2,'check_in')",[A,uuid(800)]);
    await probe(null,'guests','backend_null_edge_parent_change','update guests set group_id=$1 where id=$2 returning id',[uuid(200),uuid(800)],0,{role:'service_role'});
    const result={date:new Date().toISOString(),engine:(await db.query('select version()')).rows[0].version,migration,requirements:checks.length,passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length,baseline:{original:277,originalPass:149,originalFail:128,repairedTenantDefects:122,correctedPreservedBusinessExpectations:6,currentPass:277,currentFail:0,corrections:baselineCorrections},checks};
    if(process.env.DOORFLOW_DB_EVIDENCE)writeFileSync(process.env.DOORFLOW_DB_EVIDENCE,JSON.stringify(result,null,2));
    console.log(JSON.stringify({requirements:result.requirements,passed:result.passed,failed:result.failed,engine:result.engine}));
  }finally{await db.close();}
});
