import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./build-public.mjs";
import api from "../public-config.js";
import { fixtureConfig } from "./p8-2b-config-fixture.mjs";

const valid = await fixtureConfig("https://stage.example.invalid");
for (const environment of ["production", "staging", "development"]) {
  test(`shared validator accepts complete fictional ${environment}`, () => {
    assert.equal(api.validate({...valid, environment}, valid.allowedOrigin).environment,environment);
  });
}
const invalid = {
  missing:undefined, array:[], "missing URL":{...valid,supabaseUrl:undefined}, "wrong type":{...valid,projectRef:[]},
  "URL/ref mismatch":{...valid,projectRef:"bbbbbbbbbbbbbbbbbbbb"},
  "production in staging":{...valid,projectRef:"wdlgkwzowapzhurbbavf",supabaseUrl:"https://wdlgkwzowapzhurbbavf.supabase.co"},
  "secret key":{...valid,publishableKey:"sb_secret_fictional_not_a_real_key"},
  "legacy privileged JWT":{...valid,publishableKey:"eyJhbGciOiJIUzI1NiJ9.privileged.fictional"},
  "wildcard origin":{...valid,allowedOrigin:"https://*.example.invalid"},
  "origin credentials":{...valid,allowedOrigin:"https://user:fictional@example.invalid"},
  "origin fragment":{...valid,allowedOrigin:valid.allowedOrigin+"#x"},
  "origin query":{...valid,allowedOrigin:valid.allowedOrigin+"?x=1"},
  "origin path":{...valid,allowedOrigin:valid.allowedOrigin+"/auth/"},
  "HTTP staging":{...valid,allowedOrigin:"http://stage.example.invalid"},
  "unknown environment":{...valid,environment:"preview"},
  "missing staging environment":{...valid,environment:""},
  "URL credentials":{...valid,supabaseUrl:"https://user:fictional@abcdefghijklmnopqrst.supabase.co"},
  "URL query":{...valid,supabaseUrl:valid.supabaseUrl+"?x=1"},
};
for (const [name,value] of Object.entries(invalid)) test(`reject ${name} with sanitized error`, () => assert.throws(()=>api.validate(value), {message:api.FAILURE}));
test("actual origin must agree",()=>assert.throws(()=>api.validate(valid,"https://other.example.invalid")));
test("harmless extra fields cannot alter canonical binding",async()=>assert.equal(await api.binding({...valid,extra:"harmless"}),valid.binding));
test("every relevant field changes binding",async()=>{
  for(const change of [{environment:"production"},{publishableKey:valid.publishableKey+"x"},{allowedOrigin:"https://other.example.invalid"}]) assert.notEqual(await api.binding({...valid,...change}),valid.binding);
});
const env = {DOORFLOW_ENVIRONMENT:"staging",DOORFLOW_PUBLIC_SUPABASE_URL:valid.supabaseUrl,
  DOORFLOW_PUBLIC_SUPABASE_PROJECT_REF:valid.projectRef,DOORFLOW_PUBLIC_SUPABASE_PUBLISHABLE_KEY:valid.publishableKey,
  DOORFLOW_PUBLIC_ALLOWED_ORIGIN:valid.allowedOrigin};
for (const field of Object.keys(env)) test(`build missing ${field} fails before output`,async()=>{
  const parent=await mkdtemp(join(tmpdir(),"doorflow-build-missing-"));const input={...env};delete input[field];
  await assert.rejects(build(input,join(parent,"output")));assert.deepEqual(await readdir(parent),[]);
});
test("build emits exact public fields, identical page bindings, no privileged variables",async()=>{
  const parent=await mkdtemp(join(tmpdir(),"doorflow-build-valid-"));const output=join(parent,"output");
  await build({...env,SUPABASE_SERVICE_ROLE_KEY:"FICTIONAL_SECRET_SENTINEL",SMTP_PASSWORD:"FICTIONAL_SECRET_SENTINEL",DATABASE_URL:"FICTIONAL_SECRET_SENTINEL"},output);
  const config=JSON.parse(await readFile(join(output,"api/doorflow-public-config.json"),"utf8"));
  assert.deepEqual(Object.keys(config).sort(),["schemaVersion","environment","supabaseUrl","publishableKey","projectRef","allowedOrigin","binding"].sort());
  for(const file of ["index.html","auth/index.html"]) {
    const html=await readFile(join(output,file),"utf8");assert.ok(html.includes(`content="${config.binding}"`));
    assert.ok(!html.includes("wdlgkwzowapzhurbbavf.supabase.co"));
  }
  for(const path of await readdir(output,{recursive:true})) {
    if(/\.(html|js|mjs|json)$/.test(path)) assert.ok(!(await readFile(join(output,path),"utf8")).includes("FICTIONAL_SECRET_SENTINEL"));
  }
  await assert.rejects(build(env,output),"never reuse an old build directory");
});
for(const context of [{VERCEL_ENV:"preview"},{CONTEXT:"deploy-preview"},{CONTEXT:"branch-deploy"}]) test(`host preview guard ${JSON.stringify(context)}`, async()=>{
  const parent=await mkdtemp(join(tmpdir(),"doorflow-build-context-"));
  await assert.rejects(build({...env,DOORFLOW_ENVIRONMENT:"production",...context},join(parent,"output")));
  assert.deepEqual(await readdir(parent),[]);
});
