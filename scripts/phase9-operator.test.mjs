import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createOperator} from './venue-operator.mjs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
test('new venue service date follows venue timezone and rollover, including DST',()=>{
 const state={venue:{legacy_presentation:false},venueSettings:{timezone:'America/New_York',service_day_rollover_time:'04:00:00'}};
 const ctx=vm.createContext({state,Intl,Date,getLocalTodayDateString:()=> 'legacy-date'});
 vm.runInContext(source.slice(source.indexOf('function venueServiceDateNow('),source.indexOf('function currentVenueBrand(')),ctx);
 assert.equal(vm.runInContext("venueServiceDateNow(new Date('2026-11-08T08:59:00Z'))",ctx),'2026-11-07');
 assert.equal(vm.runInContext("venueServiceDateNow(new Date('2026-11-08T09:00:00Z'))",ctx),'2026-11-08');
 assert.equal(vm.runInContext("venueServiceDateNow(new Date('2026-03-08T07:30:00Z'))",ctx),'2026-03-07');
 state.venue.legacy_presentation=true;assert.equal(vm.runInContext('venueServiceDateNow()',ctx),'legacy-date');
});
test('trusted operator cannot create a temporary-password production user',async()=>{
 let calls=0;const op=createOperator({projectRef:'wdlgkwzowapzhurbbavf',secret:'fictional',fetchImpl:()=>{calls++;throw Error('Forbidden')}});
 await assert.rejects(op.createStagingUser({email:'fake@example.invalid'},'A'.repeat(30)),/staging/);assert.equal(calls,0);
});
test('staging confirmed user creation uses only the no-email Auth admin API',async()=>{
 const calls=[];const op=createOperator({projectRef:'ktvmihmkdfvzmgubsqqc',secret:'fictional',fetchImpl:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json({id:'fictional-user'});}});
 assert.deepEqual(await op.createStagingUser({email:'fake@example.invalid',fullName:'Fictional'},'A'.repeat(30)),{authUserId:'fictional-user'});
 assert.equal(calls.length,1);assert(calls[0].url.endsWith('/auth/v1/admin/users'));assert.equal(calls[0].body.email_confirm,true);
 await assert.rejects(op.createStagingUser({email:'employee@real.example'},'A'.repeat(30)),/fictional/);
 assert.equal(calls.length,1);
});
test('lifecycle empty success response is accepted and bootstrap requires explicit identity',async()=>{
 const op=createOperator({projectRef:'ktvmihmkdfvzmgubsqqc',secret:'fictional',fetchImpl:async()=>new Response(null,{status:204})});
 assert.equal(await op.lifecycle({venueId:'test',status:'active',reason:'Test'}),null);
 await assert.rejects(op.bootstrap({requestId:'test'}),/Explicit confirmed/);
});
