# SaaS / Venue Foundation database contract

The current active `staff_profiles` row, keyed by `auth.uid()`, is the ordinary browser authority. A missing profile, inactive profile, unknown role, or missing venue gives no operational access. Membership tables and editable Auth metadata are not authorization sources.

`20261108162003_saas_venue_foundation.sql` preserves the Phase 8.2C staff policies and invitation RPC/server-only contracts. It changes the existing operational policies in place to require the row's venue and the existing permitted roles. Logs still have no browser UPDATE policy; Admin and Manager retain log DELETE. Active Admin, Manager, Door and Viewer retain same-venue notes CRUD. Venue reads and management are limited to the currently assigned venue. Browser venue creation has no usable authorization path because a new venue ID cannot equal the already assigned venue ID.

The migration begins with transactional compatibility checks for all seven affected tables: columns/defaults/nullability, constraints, policies, profile-helper bodies and operational trigger inventory. It also rejects inconsistent or null-venue linked graphs. It never guesses a backfill. Deferred organization, membership, branding, settings and subscription tables are neither required nor changed; these six tables are absent in live staging even though the older production fixture contains them.

The operational `venue_id` columns stay nullable. Existing venue and parent foreign keys, including their CASCADE and SET NULL delete actions, stay intact. New composite unique keys and six composite foreign keys protect same-venue parent relationships, including the log-to-guest-to-group relationship. PostgreSQL's foreign-key key locking protects these identities across concurrent transactions. The new private trigger derives an omitted insert venue from a parent or the current profile, rejects conflicting parents and explicit venues, and prevents browser venue reassignment. Trusted roles bypass RLS but still pass graph validation and foreign keys. The only nested-trigger exception permits the original venue foreign key's SET NULL action after the referenced venue has actually been deleted.

Private trigger functions have a fixed `pg_catalog` search path, fully qualified object references and no browser or PUBLIC execution/schema grants. The original four autofill triggers are replaced; their historical function definitions are not broadened. Staff policies, current-profile helpers, table grants, Auth identities, provisioning flags and invitation data are unchanged.

## Local proof

The acceptance suite uses pinned `@electric-sql/pglite` 0.3.14 (PostgreSQL 17.5 compiled to WASM). It executes actual PostgreSQL RLS with `SET LOCAL ROLE authenticated` and a real SQL `auth.uid()` context. It does not mock policy decisions, access hosted projects, or use production credentials. Each probe rolls back.

Set `DOORFLOW_PGLITE_MODULE` to the installed pinned package's absolute `dist/index.js` path, then run:

```text
node --test scripts/saas-venue-db.test.mjs
```

Set `DOORFLOW_DB_EVIDENCE` to an output path to save the complete individual requirement results. Missing runtime configuration fails the suite rather than skipping database acceptance.

The suite replays the four unchanged Phase 8.2C migrations against the saved schema fixture, removes the six deferred tables absent in live staging, and then applies the new migration. Five isolated drift scenarios prove refusal before changes. It exercises both venues symmetrically for Admin, Manager, Door and Viewer, plus null-venue, inactive and missing-profile users, anonymous access, backend operations, staff bootstrap/management, explicit conflicts, parent reparenting, venue reassignment, nullable orphan edges and original venue-delete behavior.

The original 277-operation matrix is included. Its 128 historical failures consisted of 122 actual tenant-isolation defects and six incorrect expectations denying Door/Viewer their previously permitted same-venue note INSERT/UPDATE/DELETE. Those six expectations are explicitly corrected to preserve the approved business rule. The repaired baseline is 277 passed, zero failed. The expanded matrix reports its own current total and individual results.

PGlite supports one SQL connection, so this suite proves constraint and trigger behavior, not a multi-connection scheduling experiment. Concurrency protection rests on PostgreSQL's native composite foreign-key key locks, supplemented by parent `FOR KEY SHARE` lookups and guest/log validation. Hosted API/browser acceptance remains a separate deployment gate.

## Deployment and recovery

Apply only this exact versioned migration after local and frontend checks pass, first to staging. Record its SHA-256 and hosted migration version alongside the exact frontend commit. Production requires a fresh catalog/aggregate preflight, staging proof, advisors and a deployment checkpoint.

The migration takes bounded locks and performs no business-row UPDATE, DELETE or TRUNCATE. It is atomic: a failed guard, index, FK or function change rolls the transaction back. Do not restore the old permissive policies as an ordinary rollback. Prefer blocking the affected workflow and applying a reviewed forward fix while retaining venue isolation. Preserve the prior frontend deployment identity for frontend rollback; any older frontend must still operate under the repaired database policies.

Multi-venue Admin and membership-based authority remain deferred. Provisioning must remain disabled and this milestone authorizes no email.
