import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
const names = [
  '20260924220909_phase_8_2c_production_prerequisites.sql',
  '20260924221018_phase_8_2c_staff_invitations.sql',
  '20260924221024_phase_8_2c_single_venue_staff.sql',
  '20260924221030_phase_8_2c_advisor_hardening.sql',
];
const migrations = names.map(name => read(`supabase/migrations/${name}`));
const tables = ['check_in_logs', 'groups', 'guests', 'service_days', 'shift_notes', 'staff_profiles', 'venues'];
const fixture = read('supabase/tests/fixtures/phase_8_2c_production_schema.sql');

test('CLI-generated migration order is explicit and contains no staging bootstrap', () => {
  // Phase 8.2C is an immutable prefix of the new release. Its replay below
  // intentionally remains a historical compatibility check; the SaaS database
  // acceptance suite replays that prefix plus the foundation migration.
  const foundation = '20261108162003_saas_venue_foundation.sql';
  const inventory = readdirSync(resolve(root, 'supabase/migrations')).filter(x => x.endsWith('.sql')).sort();
  assert.deepEqual(inventory, [...names, foundation, '20261109034248_phase_9_venue_onboarding.sql', '20261109040314_phase_9_lifecycle_boundaries.sql']);
  assert(inventory.indexOf(foundation) === names.length);
  assert.deepEqual([...names].sort(), names);
  assert(names.every(name => /^\d{14}_phase_8_2c_/.test(name)));
  assert(!names.some(name => /staging|bootstrap/.test(name)));
});

for (const [index, review, expectedHash] of [
  [1, 'phase_8_2a_staff_invitations_review.sql', '419e306d7aba0566fbb112c659a66ca585ec7cea7ca40aaae407f8dbb1e4d8e5'],
  [2, 'phase_8_2b_single_venue_staff_review.sql', 'e81456174e414bcad1324a4584838cb48c2289bd8457680ade5f23b68a78e768'],
]) {
  test(`migration preserves the hosted-tested body: ${review}`, () => {
    const source = read(`supabase/review/${review}`);
    const body = migrations[index].split('-- BEGIN VERIFIED REVIEW SOURCE\n')[1]?.split('\n-- END VERIFIED REVIEW SOURCE\n')[0];
    assert.equal(hash(source), expectedHash);
    assert.equal(body, source);
  });
}

test('compatibility correction and single-venue checks remain present', () => {
  assert.match(migrations[1], /select auth_user\.id, auth_user\.email::text, auth_user\.email_confirmed_at/);
  assert.match(migrations[2], /venue_id IS NOT NULL AND public\.doorflow_has_venue_role/);
  assert.match(migrations[2], /FOR UPDATE TO authenticated[\s\S]+USING[\s\S]+WITH CHECK/);
  assert.match(migrations[2], /Unexpected staff policy inventory/);
});

test('prerequisite guard is reproducible, read-only, and validates exact reviewed structure', () => {
  assert.equal(migrations[0], read('supabase/preflight/phase_8_2c_production_prerequisites.sql'));
  assert(!/^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\s/im.test(migrations[0]));
  const expected = [...migrations[0].matchAll(/\$expected\$([\s\S]*?)\$expected\$::jsonb/g)].map(match => JSON.parse(match[1]));
  assert.deepEqual(expected.map(rows => rows.length), [64, 23, 20, 17, 4, 11]);
  const venue = expected[0].find(row => row.table === 'staff_profiles' && row.column === 'venue_id');
  assert.equal(venue.nullable, 'YES');
  assert(expected[1].some(row => row.table === 'staff_profiles' && row.definition === 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'));
  assert(expected[1].some(row => row.table === 'staff_profiles' && row.definition === 'FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL'));
  assert.match(migrations[0], /Invitation object collision: stop and review/);
  assert.match(migrations[0], /rolsuper OR rolbypassrls/);
  assert.match(migrations[0], /Helper ownership\/privilege drift/);
});

test('advisor migration preserves the staged SQL, with only reviewed ACL and timeout additions', () => {
  let original = migrations[3]
    .replace('-- Phase 8.2C: tested advisor hardening; preserves table data and policy semantics.', '-- STAGING ONLY. Advisor remediation preserves table data and policy semantics.')
    .replace("SET LOCAL lock_timeout = '5s';\n", '')
    .replace("SET LOCAL statement_timeout = '60s';\n", '')
    .replace('-- Tested staging-bootstrap privilege delta: keep CRUD only, without replacing tables.\n', '')
    .replace('-- PUBLIC receives no table grants; direct CRUD for existing roles is unchanged.\n', '')
    .replace(/^REVOKE ALL ON TABLE .* FROM PUBLIC;\n/m, '')
    .replace(/^REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE .* FROM anon, authenticated, service_role;\n/m, '')
    .replace('BEGIN;\n\n', 'BEGIN;\n');
  assert.equal(hash(original), '805d157cd66886d535259d02d0e71c5da0bb6dc4ff62fc46cdcd641926da16ca');
  const privilegeLine = migrations[3].match(/^REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE (.*) FROM anon, authenticated, service_role;/m);
  assert.deepEqual(privilegeLine[1].split(', '), tables.map(name => `public.${name}`));
  assert.equal((migrations[3].match(/^CREATE INDEX /gm) || []).length, 7);
  assert.equal((migrations[3].match(/^REVOKE EXECUTE ON FUNCTION .* FROM PUBLIC, anon, authenticated;/gm) || []).length, 4);
  assert.equal((migrations[3].match(/^REVOKE EXECUTE ON FUNCTION .* FROM PUBLIC, anon;/gm) || []).length, 7);
  assert.match(migrations[3], /ALTER POLICY "doorflow staff can read own profile".*USING \(id = \(SELECT auth\.uid\(\)\)\)/);
});

test('schema fixture contains no copied business/Auth rows or environment credentials', () => {
  assert.match(fixture, /current_database\(\) NOT LIKE 'doorflow_phase82c_%'/);
  assert.equal((fixture.match(/^CREATE TABLE public\./gm) || []).length, 13);
  assert(!/^\s*(?:INSERT\s+INTO|COPY\s+|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s+)/im.test(fixture));
  assert.match(fixture, /CREATE TABLE auth\.users\(id uuid PRIMARY KEY,email varchar\(255\)/);
  assert(!/sb_(?:secret|publishable)_[A-Za-z0-9]|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|ktvmihmkdfvzmgubsqqc|wdlgkwzowapzhurbbavf/.test(fixture));
});

test('production migrations do not recreate operational tables or modify deferred tables', () => {
  const deferred = ['organizations', 'organization_memberships', 'venue_memberships', 'venue_settings', 'venue_branding', 'subscription_accounts'];
  for (const sql of migrations) {
    assert(!/\bCREATE\s+(?:TABLE|INDEX|SCHEMA|FUNCTION)\s+IF\s+NOT\s+EXISTS\b/i.test(sql), 'no silent DDL collision handling');
    for (const table of [...tables, ...deferred]) assert(!new RegExp(`CREATE TABLE (?:public\\.)?["']?${table}["']?\\b`, 'i').test(sql));
    for (const table of deferred) assert(!new RegExp(`(?:ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE|DELETE FROM)\\s+(?:public\\.)?"?${table}"?\\b`, 'i').test(sql));
    assert(!/^\s*(?:DROP TABLE|TRUNCATE|ALTER PUBLICATION)\b/im.test(sql));
  }
});

// Optional, isolated PostgreSQL-WASM replay. Install the pinned official runtime
// outside the repository, then point this variable at its dist/index.js.
// No connection string, hosted target, or database credentials are accepted.
const pgliteModule = process.env.DOORFLOW_PGLITE_MODULE;
async function newLocalDatabase() {
  const { PGlite } = await import(pathToFileURL(resolve(pgliteModule)).href);
  const db = await PGlite.create({ database: 'doorflow_phase82c_replay', username: 'postgres' });
  try { await db.exec(fixture); }
  catch (error) { await db.close(); throw new Error(`Local schema fixture: ${error.message}`); }
  return db;
}
async function asRole(db, role, userId, sql, parameters = []) {
  assert(['authenticated', 'anon', 'service_role'].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [userId]);
    return await db.query(sql, parameters);
  } finally {
    await db.exec('ROLLBACK;');
  }
}
const deferredSnapshotQuery = `
SELECT jsonb_build_object(
  'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('organizations','organization_memberships','venue_memberships','venue_settings','venue_branding','subscription_accounts')),
  'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,ordinal_position) FROM information_schema.columns c WHERE table_schema='public' AND table_name IN ('organizations','organization_memberships','venue_memberships','venue_settings','venue_branding','subscription_accounts')),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN ('organizations','organization_memberships','venue_memberships','venue_settings','venue_branding','subscription_accounts'))
) AS snapshot`;

test('embedded PostgreSQL replay preserves data and deferred objects and enforces real role permissions', { skip: !pgliteModule }, async t => {
  const db = await newLocalDatabase();
  try {
    t.diagnostic((await db.query('SELECT version() AS version')).rows[0].version);
    const deferredBefore = (await db.query(deferredSnapshotQuery)).rows[0].snapshot;
    const venueA = '10000000-0000-4000-8000-000000000001';
    const venueB = '10000000-0000-4000-8000-000000000002';
    const adminA = '20000000-0000-4000-8000-000000000001';
    const adminB = '20000000-0000-4000-8000-000000000002';
    const doorA = '20000000-0000-4000-8000-000000000003';
    const doorB = '20000000-0000-4000-8000-000000000004';
    const nullAdmin = '20000000-0000-4000-8000-000000000005';
    await db.query('INSERT INTO public.venues(id,name) VALUES ($1,$2),($3,$4)', [venueA, 'Local Test Venue A', venueB, 'Local Test Venue B']);
    for (const [id, role, venue, name] of [[adminA,'admin',venueA,'Admin A'],[adminB,'admin',venueB,'Admin B'],[doorA,'door',venueA,'Door A'],[doorB,'door',venueB,'Door B'],[nullAdmin,'admin',null,'Null Admin']]) {
      await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())', [id, `${id}@local-migration.invalid`]);
      await db.query('INSERT INTO public.staff_profiles(id,full_name,role,venue_id) VALUES ($1,$2,$3,$4)', [id, name, role, venue]);
    }
    const profilesBefore = (await db.query('SELECT jsonb_agg(to_jsonb(s) ORDER BY id) AS profiles FROM public.staff_profiles s')).rows[0].profiles;
    for (const [index, sql] of migrations.entries()) {
      try { await db.exec(sql); }
      catch (error) { throw new Error(`${names[index]}: ${error.message}`); }
    }
    assert.deepEqual((await db.query(deferredSnapshotQuery)).rows[0].snapshot, deferredBefore);
    assert.deepEqual((await db.query('SELECT jsonb_agg(to_jsonb(s) ORDER BY id) AS profiles FROM public.staff_profiles s')).rows[0].profiles, profilesBefore);
    assert.equal((await asRole(db,'authenticated',adminA,'SELECT id FROM staff_profiles')).rows.length, 2);
    assert.equal((await asRole(db,'authenticated',adminB,'SELECT id FROM staff_profiles')).rows.length, 2);
    assert.deepEqual((await asRole(db,'authenticated',nullAdmin,'SELECT id FROM staff_profiles')).rows, [{ id: nullAdmin }]);
    assert.deepEqual((await asRole(db,'authenticated',doorA,'SELECT id FROM staff_profiles')).rows, [{ id: doorA }]);
    assert.equal((await asRole(db,'authenticated',adminA,'UPDATE staff_profiles SET full_name=full_name WHERE id=$1 RETURNING id',[doorA])).rows.length, 1);
    assert.equal((await asRole(db,'authenticated',adminA,'UPDATE staff_profiles SET full_name=full_name WHERE id=$1 RETURNING id',[adminB])).rows.length, 0);
    assert.equal((await asRole(db,'authenticated',nullAdmin,'UPDATE staff_profiles SET full_name=full_name RETURNING id')).rows.length, 0);
    assert.equal((await asRole(db,'authenticated',doorA,'UPDATE staff_profiles SET full_name=full_name WHERE id=$1 RETURNING id',[doorA])).rows.length, 0);
    await assert.rejects(asRole(db,'authenticated',adminA,'UPDATE staff_profiles SET venue_id=$1 WHERE id=$2 RETURNING id',[venueB,doorA]), { code: '42501' });
    await assert.rejects(asRole(db,'authenticated',adminA,'SELECT * FROM staff_invitations'), { code: '42501' });
    await assert.rejects(asRole(db,'anon','', 'SELECT public.doorflow_current_role()'), { code: '42501' });
    for (const table of tables) {
      const privileges = (await db.query("SELECT has_table_privilege('authenticated',$1,'SELECT') AS read,has_table_privilege('authenticated',$1,'TRUNCATE') AS truncate,has_table_privilege('authenticated',$1,'MAINTAIN') AS maintain", [`public.${table}`])).rows[0];
      assert.deepEqual(privileges,{ read:true, truncate:false, maintain:false });
    }
    const helpers = (await db.query("SELECT p.proname,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'doorflow_%' AND p.proname NOT LIKE '%staff_invitation%' ORDER BY p.proname")).rows;
    assert.equal(helpers.length,11);
    for (const helper of helpers) {
      assert.equal(helper.anon_execute,false);
      assert.equal(helper.authenticated_execute,!helper.proname.startsWith('doorflow_autofill_'));
    }
    // The lookup requires an authorized reserved intent, created only inside this
    // local transaction and rolled back with its audit evidence after the check.
    await db.exec('BEGIN; SET LOCAL ROLE service_role;');
    try {
      const email = `${doorA}@local-migration.invalid`;
      const reserved = await db.query('SELECT public.doorflow_reserve_staff_invitation($1,$2,$3,$3,$4,$5,$6,$7,$8) AS result', [adminA,venueA,email,'Local Lookup Test','door','30000000-0000-4000-8000-000000000001','a'.repeat(64),'30000000-0000-4000-8000-000000000002']);
      assert.equal(reserved.rows[0].result.decision_code,'reserved');
      const lookup = await db.query('SELECT * FROM public.doorflow_lookup_staff_invitation_auth_user($1,$2,$3)',[adminA,venueA,email]);
      assert.equal(lookup.rows[0].id,doorA); // Exercises varchar Auth email -> text result compatibility.
    } finally { await db.exec('ROLLBACK;'); }
    const counts = (await db.query('SELECT (SELECT count(*)::int FROM staff_invitations) invitations,(SELECT count(*)::int FROM staff_invitation_attempts) attempts,(SELECT count(*)::int FROM staff_invitation_audit) audits')).rows[0];
    assert.deepEqual(counts,{ invitations:0, attempts:0, audits:0 });
  } finally { await db.close(); }
});

test('embedded PostgreSQL prerequisite rejects drift before creating invitation objects', { skip: !pgliteModule }, async () => {
  const db = await newLocalDatabase();
  try {
    await db.exec('ALTER TABLE public.staff_profiles ALTER COLUMN venue_id SET NOT NULL');
    await assert.rejects(db.exec(migrations[0]), /prerequisite drift: columns/);
    await db.exec('ROLLBACK;');
    assert.equal((await db.query("SELECT to_regclass('public.staff_invitations')::text AS name")).rows[0].name, null);
  } finally { await db.close(); }
});
