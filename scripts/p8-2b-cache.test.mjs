import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withoutEnvironmentCacheSafety, extractAppRuntime } from "./p8-2b-static-comparison.mjs";
const source=readFileSync(new URL("../sw.js",import.meta.url),"utf8").replaceAll("\r\n","\n");
const git=(revision)=>execFileSync("git",["-c",`safe.directory=${fileURLToPath(new URL("../",import.meta.url))}`,"show",`${revision}:sw.js`],{encoding:"utf8"}).replaceAll("\r\n","\n");
function fixture(){
 const handlers={},stores=new Map();const requested=[];let online=true;
 const key=x=>new URL(typeof x==="string"?x:x.url,"https://fictional.example.invalid").href;
 const caches={async keys(){return [...stores.keys()]},async delete(n){return stores.delete(n)},async open(n){
   if(!stores.has(n))stores.set(n,new Map());const data=stores.get(n);
   return {async keys(){return [...data.keys()].map(url=>({url}))},async delete(r){return data.delete(key(r))},
     async match(r){return data.get(key(r))},async put(r,v){data.set(key(r),v)},async addAll(paths){paths.forEach(p=>data.set(key(p),{url:key(p),body:"shell"}))}};
 }};
 vm.runInNewContext(source,{URL,Set,Promise,Response,caches,self:{location:{origin:"https://fictional.example.invalid"},clients:{claim:async()=>{}},addEventListener(n,fn){handlers[n]=fn}},
 fetch:async r=>{requested.push(key(r));if(!online)throw Error("offline");return {ok:true,type:"basic",body:"fresh",clone(){return this}}}});
 return {caches,stores,requested,offline(){online=false},async lifecycle(n){let p;handlers[n]({waitUntil(x){p=x}});await p},async request(path,mode="navigate"){
  let p;const pending=[];handlers.fetch({request:{url:key(path),method:"GET",mode},respondWith(x){p=x},waitUntil(x){pending.push(x)}});
  const value=await p;await Promise.all(pending);return value;
 }};
}
test("install precaches safe shell only; activation removes legacy environment and credentials",async()=>{
 const f=fixture();await (await f.caches.open("doorflow-cache-v30")).put("/",{body:"legacy"});
 await f.lifecycle("install");const cache=await f.caches.open("doorflow-cache-v33");await cache.put("/?token_hash=fictional",{});
 await f.lifecycle("activate");assert.deepEqual(await f.caches.keys(),["doorflow-cache-v33"]);
 const paths=(await cache.keys()).map(x=>new URL(x.url).pathname);assert.ok(paths.includes("/index.html"));
 assert.ok(!paths.some(x=>/config|auth|api/.test(x)));assert.ok(!(await cache.keys()).some(x=>x.url.includes("token_hash")));
});
for(const path of ["/api/doorflow-public-config.json","/public-config.js","/auth/","/?access_token=fictional","https://abcdefghijklmnopqrst.supabase.co/rest/v1/staff_profiles"])test(`SW never supplies ${path}`,async()=>{
 const f=fixture();f.offline();assert.equal(await f.request(path),undefined);assert.deepEqual(f.requested,[]);
});
test("offline shell only reads active cache, never another build cache",async()=>{
 const f=fixture();await (await f.caches.open("doorflow-cache-v30")).put("/index.html",{body:"legacy"});f.offline();
 assert.equal((await f.request("/")).type,"error");
 await (await f.caches.open("doorflow-cache-v33")).put("/index.html",{body:"safe gated shell"});
 assert.equal((await f.request("/")).body,"safe gated shell");
});
test("foundation shell cache bump changes only the cache version",()=>{
 assert.equal(source.replace('const CACHE_NAME = "doorflow-cache-v33";','const CACHE_NAME = "doorflow-cache-v31";'),git("51dafad34e930e9b5993b7e9eedfcb3a30340634"));
 assert.match(source,/const CACHE_NAME = "doorflow-cache-v33";/);
});
test("exact SW comparison detects unrelated changes (negative control)",()=>{
 const prior=git("dff47553e9134c08e0defa5280dd5808d8fb1a56");
 assert.equal(withoutEnvironmentCacheSafety(source),prior);
 assert.notEqual(withoutEnvironmentCacheSafety(source.replace('request.method !== "GET"','request.method !== "POST"')),prior);
});
test("inline runtime parity and negative control",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8").replaceAll("\r\n","\n");
 const app=readFileSync(new URL("../app.js",import.meta.url),"utf8").replaceAll("\r\n","\n").trim();
 assert.equal(extractAppRuntime(html),app);
 assert.notEqual(extractAppRuntime(html.replace("let SUPABASE_URL;","let SUPABASE_URL = 'wrong';")),app);
});
