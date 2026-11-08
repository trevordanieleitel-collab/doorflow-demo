import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { extractAppRuntime } from "./p8-2b-static-comparison.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
const app = read("app.js");
const html = read("index.html");
function block(name) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`,"m").exec(app);
  assert(start, `Function ${name} exists`);
  const rest = app.slice(start.index);
  const next = /\n(?:async )?function [\w$]+\(/.exec(rest.slice(start[0].length));
  return next ? rest.slice(0, start[0].length + next.index).trim() : rest;
}

test("the complete active inline runtime equals app.js and both parse", () => {
  const runtime = extractAppRuntime(html);
  assert.equal(runtime, app.trim());
  new vm.Script(app, { filename:"app.js" });
  new vm.Script(runtime, { filename:"index.html inline runtime" });
  assert(!/<script[^>]+src=["'](?:\.\/)?app\.js["']/i.test(html));
});

test("all four existing business roles retain their permission matrix", () => {
  const roleDeclaration = /const roles = \{[\s\S]*?\n\};/.exec(app)?.[0];
  assert(roleDeclaration);
  const evaluate = new Function("auth", `${roleDeclaration}\n${block("currentUser")}\n${block("perms")}\nreturn perms();`);
  const expected = {
    admin:[true,true,true,true], manager:[true,true,false,true],
    door:[true,false,false,false], viewer:[false,false,false,true]
  };
  for (const [role, rights] of Object.entries(expected)) {
    const permissions = evaluate({currentUser:{role}});
    assert.deepEqual([permissions.door,permissions.manage,permissions.users,permissions.reports], rights, role);
  }
  assert.equal(evaluate({currentUser:null}), null);
});

test("sync status and tone are derived truthfully for live, pending and failed work", () => {
  const present = new Function("state", "formatClock", "syncClassName", `${block("currentSyncPresentation")}\nreturn currentSyncPresentation();`);
  for (const [state,status,tone] of [
    [{},"Live","good"], [{loading:true},"Syncing","warn"],
    [{error:"Fictional failure",loading:true},"Error","bad"],
    [{syncStatus:"Saving"},"Saving","warn"],
    [{syncStatus:"Failed"},"Failed","bad"],
    [{syncStatus:"Offline"},"Offline","bad"],
    [{syncStatus:"Pending"},"Pending","warn"]
  ]) {
    const result = present(state,()=>"12:00",()=>"good");
    assert.equal(result.status,status);
    assert.equal(result.tone,tone);
    assert.equal(result.last,"12:00");
  }
});

test("the current release uses one versioned local theme and only pinned approved script dependencies", () => {
  assert.equal((html.match(/<link[^>]+href="\/doorflow-operational-theme\.css\?v=[^"]+"/g)||[]).length,1);
  const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1]);
  // This is the approved candidate's dependency inventory at 51dafad, including
  // the already-existing CSV/spreadsheet import support.
  assert.deepEqual(scripts,["https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js","/public-config.js","https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0"]);
  assert(!/googletagmanager|mixpanel|segment\.io/i.test(html+app));
});
