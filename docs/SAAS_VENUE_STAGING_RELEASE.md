# SaaS / Venue Foundation staging checkpoint — 2026-11-08

Candidate branch: `release/saas-venue-foundation`, based on exact production candidate `51dafad34e930e9b5993b7e9eedfcb3a30340634`. Main, the preserved staging branch and `.codex` are outside this change.

Staging project: `ktvmihmkdfvzmgubsqqc`. Migration `20261108162003_saas_venue_foundation.sql`, SHA-256 `79c52da5b8bc5171fa162b2c5c8f8d17b05d1877dbebfe88273a40998396c815`, is installed as hosted version `20261108162003`. Exact reviewed source was recorded in migration history inside the same transaction. The original four migration files remain unchanged.

The controlled preview is `https://saas-foundation--doorflow-thebob.netlify.app`, final deployment `6af0aa6b88e0ca22ae1a11e3` (initial checkpoint `6af0a675230a6f9644135a2f`). All 19 served artifact files match their recorded hashes. Configuration targets staging only and binds to this exact preview origin. The worker cache is v32.

Acceptance evidence:

- Real PostgreSQL/PGlite: 1,340 approved requirements passed; five atomic drift-refusal scenarios passed.
- Original 277-operation matrix: 277 passed. Of the old 128 failures, 122 were isolation defects repaired and six were incorrect expectations denying existing same-venue Door/Viewer note permissions, now explicitly corrected.
- Node suites: 276 passed; Deno runtime: 587 passed; browser fixtures: 47 passed; nine operational smoke scripts: 803 reusable assertions passed, including 44 check-in race assertions.
- Application/test and unexpected Deno diagnostics: zero. Raw checking retains only external TS2724 and TS2430 at the exact documented fingerprints.
- Hosted staging API: 814 passed. Hosted real browser: 42 passed, including real password logins A → B → A, isolated lists/reports/CSV/staff, stale actual response rejection, obsolete Realtime callbacks, foreign events, null/inactive denial, safe `/auth/`, and disabled invitation GET/CORS behavior. The additional same-user `SIGNED_IN` refocus check preserves Staff and revalidates unchanged account/role/venue authority; initial account changes and permission loss still select an allowed view.
- Staging catalog: six validated composite FKs, four unique keys and five private guards match source. Staff/invitation contracts and nullability are preserved.
- Advisors: zero errors and zero unresolved in-scope blockers; 11 warnings and 24 informational findings are classified in the external evidence.

Provisioning remains disabled. No invitation POST or email-sending endpoint was used. Existing invitation/attempt/audit/provider counters were 1/2/7/1 and are checked separately for preservation. Test users and operational fixtures are recognizably fictional and staging-only; their credentials never enter repository files or reports.

The two previously configured staging frontend origins were verified against the live digest and preserved when adding this preview to `DOORFLOW_ALLOWED_ORIGINS`. `DOORFLOW_STAFF_PROVISIONING_ENABLED=false` was explicitly retained.

Full evidence is stored outside the repository in the project workspace's `saas-venue-evidence/` directory. See `SAAS_VENUE_DATABASE.md` for integrity, replay, compatibility and recovery details, and `SAAS_FOUNDATION_REGRESSION.md` for historical harness replacements. Production requires its own read-only compatibility/data preflight and hosting/function checkpoints before release. Multi-venue Admin, invitations activation, email, billing and POS remain deferred.
