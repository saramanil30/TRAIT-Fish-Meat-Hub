# Phase 5B.1 security review, staging execution and closeout

Status: **applied; closeout complete with behavioral testing gaps** on
2026-09-23. Post-execution catalog and effective-privilege verification passed.
Project reference: `igiujohtycixboaohjby`. Behavioral tests requiring identities or
data mutations remain unperformed; this is not approval for production use.

## Scope and source of truth

The user's final-review message supplies the approved Phase 5A.1 rules; the earlier
missing-architecture-document qualification is resolved. Application data stays
private in app, api remains empty, and Next.js is the trusted application boundary.
Only OWNER/EMPLOYEE exist. No application code, Auth/Storage objects, managed
configuration, credentials, seed data or Phase 5B.2 objects are changed.

Files:

- `supabase/migrations/20260923041240_phase_5b_1_foundation.sql`
- `supabase/validation/check-phase-5b-1.mjs`
- This implementation/review note.

The one-time transaction requires current_user=postgres and absent app/api.
It creates two schemas, five tables, ten functions, nine triggers and four explicit
indexes (in addition to primary/unique indexes), sets scoped defaults/ACLs and
forced RLS, then asserts the resulting security state before commit.
An existing schema causes failure instead of silent reuse. No custom role,
login, membership, extension, API endpoint or production data is created.

## Final checklist

PASS in this checklist records the final local SQL/design review. Actual execution
and post-execution verification results are recorded at the end of this note.

| Section | Result | Evidence / conclusion |
| --- | --- | --- |
| A Ownership | PASS | app/api and created objects belong to existing postgres; browser/service roles have no schema CREATE/USAGE or owner membership. No hosted custom-role assumption. |
| B RLS | PASS | All five tables explicitly ENABLE and FORCE RLS, no policies. Postgres BYPASSRLS is intentional and trusted; FORCE does not constrain it. |
| C Privileges | PASS | PUBLIC, anon, authenticated, service_role lose schema/table/sequence/function access; only postgres has explicit helper EXECUTE. Final assertions check inherited/table-column privileges too. |
| D Authorization | PASS, corrected | Four scalar helpers now SECURITY DEFINER under postgres, with empty search_path, fixed qualified queries and no browser grants. Six validation/trigger functions stay INVOKER. |
| E Last OWNER | PASS, interim restriction | Existing guard prevents all active-OWNER authority removal without a counting race. Adding/promoting another OWNER is allowed. Controlled demotion/disablement requires the atomic admin-phase replacement below. |
| F Tenant integrity | PASS | All eight FKs reviewed; assignments reference (business_id, store_id)/(business_id, staff_profile_id), disabled_by references (business_id, id). Tenant and assignment identities are immutable. |
| G Auth uniqueness | PASS | Globally unique non-null auth_user_id, including disabled profiles; no accidental simultaneous staff identities across businesses. |
| H Settings | PASS | Typed, bounded integer/bigint values, no operational defaults/secrets; positive database-controlled revision. Limits explained below. |
| I Stores | PASS, corrected | Canonical Indian mobile constraint, valid database timezone, six-digit pincode, bounded address/hours data; pickup/delivery default off. |
| J Timestamps/revision | PASS | Insert timestamps overridden, created_at preserved, updated_at controlled, settings revision forced to 1 then old+1. Triggers convey no authorization. |
| K Deletion | PASS | Application roles cannot DELETE/TRUNCATE; lifecycle guard rejects row deletion. Privileged maintenance can explicitly change/reinstate the particular trigger in a reviewed transaction. |
| L Supabase | PASS, metadata verified | Read-only PostgreSQL 17.6 metadata confirms assumptions; auto-RLS covers public only, so explicit app RLS is essential. Final assertions detect unexpected resulting grants. |
| M Validator | PASS, strengthened | 18 static contracts and 22 in-memory unsafe-mutation checks pass; statement inventory, ordered privilege checks, exact FK mappings and scalar-query allowlist. |

## Issues and exact corrections

1. **Future caller-context dependency.** The original INVOKER helpers worked under
   postgres (including inside a postgres-owned DEFINER entry point), but an ordinary
   caller would fail ACL checks, or see zero rows if SELECT were granted without a
   policy. A future staff function must not accidentally depend on that hidden
   ownership condition. Converted only current_staff_profile_id,
   is_business_owner, is_store_employee and can_access_store to SECURITY DEFINER.
   Each reads private tables itself, hence each needs that boundary. Execution
   remains private; no broad authenticated SELECT or other access was introduced.
2. **Mobile validation mismatch.** Generic international E.164 allowed values outside
   the initial Indian-mobile contract. Storage now requires `^\+91[6-9][0-9]{9}$`.
   Future application code normalizes input to that form; the DB rejects spaces,
   local formatting and noncanonical numbers. Syntax does not prove phone ownership.
3. **Validator blind spots.** Replaced comment-sensitive matching with lexical
   statement extraction and an approved statement inventory. Added complete FK
   column-mapping checks, full scalar authorization-query/header contracts, ordering
   checks for PUBLIC EXECUTE revocation, and 22 negative mutation controls. A
   commented-out statement cannot satisfy a check, nor can a later GRANT/DISABLE
   escape detection. This remains a deliberately bounded checker, not a SQL engine.
4. Added final in-transaction assertions for table count, owners, ENABLE/FORCE RLS,
   absence of policies, owner membership, and effective schema/table/column/sequence/
   function access for all three application roles (including PUBLIC/inherited
   privileges). Unexpected grants abort the migration. Revoke schema access again
   after object DDL. These assertions executed successfully with the migration;
   subsequent read-only catalog and effective-privilege checks also passed.
5. Schema-qualified the opening-hours C collation and clarified the interim OWNER
   guard, future execution model and maintenance procedure. Removed the obsolete
   missing-architecture qualification.

## Authorization execution contract

- `app.current_staff_profile_id()` returns only the current UUID or null, matching
  auth.uid(), active/not-disabled staff, active/non-retired business.
- `app.is_business_owner(business_uuid)` requires that staff's database OWNER
  role and matching business; no assignment required.
- `app.is_store_employee(business_uuid, store_uuid)` requires EMPLOYEE, matching
  business, active assignment and active/non-retired target store.
- `app.can_access_store(business_uuid, store_uuid)` requires an active matching
  store and either the OWNER or EMPLOYEE check.

All four are STABLE scalar queries owned by the preflight-checked postgres role.
They accept target resources only, never actor/role/SQL input, and return no staff
rowsets. All objects are qualified and search_path is empty. No policy calls them,
so no recursive RLS. Their owner intentionally bypasses RLS to make the checks
independent of the invoking role's table visibility. No general read endpoint exists.

Currently anon/authenticated/service_role cannot call the helpers at all.
Future named staff entry points must receive deliberately reviewed execution
capabilities and separate, appropriately limited mutation privileges/policies.
An approved non-BYPASSRLS entry-point owner can later receive helper EXECUTE without
receiving general staff SELECT: the helpers will evaluate under their own owner.
Do not give browser roles app access or postgres credentials to make this work.
Helper success only answers identity/scope; it does not authorize catalogue,
pricing, staff, settings or audit administration for EMPLOYEE.

auth.uid() reads request context and does not itself verify JWTs. Next.js and the
approved database entry path must preserve a verified Supabase identity; never
construct claims from browser actor IDs/editable metadata. A service key alone is
not a staff identity. Future mutations must also address concurrent authorization
revocation; a STABLE helper is not a row lock or a serialization mechanism.

## OWNER and maintenance transition

The existing guard protects every active OWNER, including the last one, from
disablement, demotion, unlinking or identity replacement. Adding/promoting a second
OWNER is already permitted by the SQL; no admin entry point is exposed yet.
Business retirement suppresses all authority while preserving OWNER records.

The admin phase must **atomically replace** the unconditional guard with its
last-owner invariant and permission-checked mutation functions. Serialize all
OWNER authority-changing operations per business before touching staff, with
consistent lock ordering. A concrete approach is an actual parent-business row
UPDATE as the serialization point, followed by a fresh owner-count check and
mutation in the same transaction. READ COMMITTED must recheck after serialization;
REPEATABLE READ/SERIALIZABLE conflicts must abort and retry the entire transaction.
A plain stale count or caller-controlled bypass flag is not sufficient.
Count active, linked, non-disabled OWNERs; exercise simultaneous demotions,
disablements, unlinking, promotions and bootstrap before releasing this restriction.
The replacement must permit demotion/disablement with another active OWNER and
reject the transition to zero. Never drop the guard without its replacement.

No initial business, settings or OWNER is created. UNIQUE business_settings
guarantees at most one row; later bootstrap creates the business/settings/first
OWNER together. Trusted migration owners retain DDL authority: for exceptional
maintenance, explicitly disable/change only the relevant application trigger and
restore/revalidate it within a reviewed transaction. No runtime bypass flag is
provided. Do not disable managed triggers or use replication settings as a shortcut.

All eight FKs use ON UPDATE/DELETE RESTRICT. Auth deletion requires an explicitly
reviewed staff disable/unlink lifecycle first; auth.users itself is not modified.
Global non-null Auth uniqueness includes disabled rows. Deliberate privileged
unlinking releases that identity; it does not allow two simultaneous profiles.
Inactive assignments and staff stay for attribution. These are mutable lifecycle
records, not append-only audit records.

## Settings, stores and timestamp decisions

- History: 1-365 days; suitable bounded initial operational history, not a retention
  deletion rule. No automatic purge occurs.
- Employee cash limit: nullable bigint, otherwise 1-1,000,000,000,000 paise.
  Null means no additional configured amount ceiling, not permission to collect.
  Zero is intentionally invalid under the original positive-value contract.
- max_order_items: 1-500; max_order_total_paise: 1-1,000,000,000,000.
  These are generous safety caps, not chosen business operating values.
- revision: positive bigint, forced to 1 on insert and incremented on every update;
  caller-supplied revision is ignored. Overflow fails the update.
- No operational settings defaults are selected. INR/country IN are initially fixed.
- Store line 1/city/state are required; line 2/locality/pincode/mobile are nullable.
  Names/addresses have length and nonblank checks. Pincode is six digits with
  nonzero first digit. Timezone must exist in pg_catalog.pg_timezone_names.
- Hours stay a small bounded JSON contract: optional mon-sun keys; zero to four
  sorted nonoverlapping same-day opens/closes intervals, no extra keys; 8 KiB cap.
  Omitted days mean closed, closing 24:00 is allowed, overnight spans split by day.
  The existing deterministic checks use no time parsing, extensions or calendars.
  Application validation should provide friendly errors; no more scheduling
  machinery is added.
- Delivery and pickup default false; both may be false for a setup/inactive store.
- All timestamps are timestamptz. Database insert time overrides supplied
  created_at/updated_at; updates preserve created_at and use the greater of old
  updated_at and statement time. Multiple changes in one statement may share time.
  Settings revision, not timestamp uniqueness, provides a monotonic version.

## Supabase findings and default privileges

Pre-execution read-only MCP inspection on 2026-09-23:

- Connection is supabase_read_only_user; server PostgreSQL 17.6; app/api absent.
- postgres is not superuser but has BYPASSRLS; service_role also bypasses RLS.
  anon/authenticated do not. None of the three application roles belongs to postgres.
- ensure_rls calls public.rls_auto_enable, which only enables RLS for public.
  It neither protects app nor supplies policies/FORCE RLS. Migration explicitly
  sets both flags on all five tables.
- pgrst_ddl_watch notifies schema reload; inspected extension-grant event triggers
  run on CREATE EXTENSION, which this migration never performs.
- Inspected postgres broad default grants are schema-scoped to public/storage;
  there are no recorded global pg_default_acl entries for postgres. PostgreSQL's
  built-in PUBLIC EXECUTE default still applies to new functions.

The three ALTER DEFAULT PRIVILEGES statements affect only postgres-created TABLES,
SEQUENCES and FUNCTIONS in app/api, revoking PUBLIC/anon/authenticated/service_role.
They do not change managed schemas, managed global role properties or global
postgres defaults. Per-schema revokes cannot cancel global PUBLIC EXECUTE.
All-function revocation occurs after function creation and before COMMIT in the same
transaction; only owner EXECUTE is explicitly granted. Future migrations must
follow the same pattern. No standalone sequences or types are created.
FORCE RLS denies ordinary roles without policies but never constrains BYPASSRLS;
service_role is instead denied by explicit SQL ACLs.

References: [PostgreSQL function security](https://www.postgresql.org/docs/17/sql-createfunction.html),
[row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html),
[default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html),
[effective privilege checks](https://www.postgresql.org/docs/17/functions-info.html).

## Execution and verification

Immediately before execution, `node supabase/validation/check-phase-5b-1.mjs`
passed **18 static contracts and 22 in-memory unsafe-mutation checks**. The reviewed
file's SHA-256 was unchanged:
`93DE04CE74FCB365CDB978251530C4720E4C6A3DC702217E7C13BB07B134316F`.
Fresh read-only preflight confirmed the project, absent app/api schemas and empty
application migration history, and found no material drift in the reviewed roles,
default privileges or event triggers.

Following explicit user confirmation of the target and authorization to execute
only Phase 5B.1, the complete reviewed SQL file was submitted once through the
temporary project-scoped `supabase_phase5b1.apply_migration` connection. It returned
success. All post-execution verification used the original read-only connection.
No ad hoc writable SQL or follow-up repair was performed.

Migration history contains exactly one application migration:

| Local source | Remote recorded version | Remote name |
| --- | --- | --- |
| `20260923000000_phase_5b_1_foundation.sql` | `20260923041240` | `phase_5b_1_foundation` |

The MCP assigned its own version timestamp. Record this mapping before any future
CLI migration workflow: reconcile local/remote history deliberately before running
a CLI push, so this non-idempotent migration is not applied again.
The original mapping above is retained as execution history; the local filename
was subsequently aligned during closeout as recorded below.

Read-only verification passed:

- app/api are owned by postgres; api has no relations or functions. There are no
  sequences in either schema.
- Exactly the five approved tables exist, all owned by postgres, with RLS ENABLED
  and FORCED and no policies. All 56 column types, nullability and default
  expressions match the reviewed SQL.
- All 50 constraints are validated: five primary keys, six unique constraints,
  eight foreign keys and 31 checks. Foreign-key mappings include same-business
  store/staff/assignment/disabled_by integrity; all FK update/delete actions are
  RESTRICT. All 15 indexes are valid and ready.
- All ten installed function bodies match the reviewed source exactly, with the
  approved signatures, volatility and INVOKER/DEFINER modes. Each has an empty
  search_path and owner-only EXECUTE ACL. All nine application triggers are enabled
  and their definitions match the expected lifecycle, identity and validation use.
- Effective privilege checks deny PUBLIC, anon, authenticated and service_role
  schema USAGE/CREATE, all table and column privileges, and function EXECUTE.
  Checks include SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and
  MAINTAIN where applicable. Postgres retains intentional owner access/BYPASSRLS.
- Existing postgres public/storage default ACL entries remain unchanged. Scoped
  app/api default revokes did not create additional pg_default_acl entries; this
  is expected where no schema-specific grants existed. Explicit current-object
  revokes leave the installed objects private, including function PUBLIC EXECUTE.
- The transaction's security assertions passed, and migration history was checked
  twice. The observed hosting event triggers did not leave unexpected grants or
  policies on the new objects.

These are installed-definition and effective-privilege checks, not simulated
application sessions. No test identities, data fixtures or temporary grants were
created. No business, settings or OWNER was seeded. Auth users and Storage were
not modified. No Phase 5B.2, commit/push or dependency installation was performed.

Remaining behavioral validation requires a separately authorized isolated test
environment or fixture plan:

- Actual scalar-helper results with verified missing/nonstaff/disabled/OWNER/
  EMPLOYEE sessions and inactive business/store/assignment combinations.
- Attempted SELECT/DML/TRUNCATE/helper calls as restricted application roles;
  effective ACL denial is verified, but role-session attempts were not run.
- Rejection of cross-tenant rows, duplicate Auth identities and malformed fields/
  hours/timezones; timestamp/revision override behavior, OWNER guard and Auth
  deletion RESTRICT under actual row mutations.
- Concurrent behavior of future controlled OWNER management, which is not
  implemented by this phase and still requires replacing the conservative guard.

The original execution pass left the migration and validator unchanged. Closeout
subsequently aligned the filename and validator reference, preserving SQL bytes.
No MCP configuration was changed or temporary write tool used during closeout.

## Closeout verification (2026-09-23)

Only the original read-only Supabase tools were used. The connection reported
`current_user = supabase_read_only_user` and `transaction_read_only = on`.
History contains exactly `20260923041240 / phase_5b_1_foundation`, with one stored
statement containing the complete SQL. Its MD5 and the local file MD5 both equal
`bfa3e52b3ae8095b84844743b0284fda`. The 22,439-byte local file retains SHA-256
`93DE04CE74FCB365CDB978251530C4720E4C6A3DC702217E7C13BB07B134316F`.
A further read-only query confirmed the remote SQL has the same SHA-256 and
22,439-byte length. After the identity check, the local file was renamed from
`20260923000000_phase_5b_1_foundation.sql` to
`20260923041240_phase_5b_1_foundation.sql`, and the validator reference updated.
Remote history was not changed and the migration was not reapplied.

Fresh catalog inspection reconfirmed both postgres-owned schemas, five expected
ENABLE/FORCE RLS tables, zero policies, 56 columns, 50 validated constraints
(including eight RESTRICT foreign keys), 15 valid/ready indexes, ten owner-only
functions with empty search paths, and nine enabled triggers. Each installed
function body occurs verbatim in the matched recorded SQL; signatures, volatility
and four DEFINER/six INVOKER modes match the design. The api schema remains empty
and neither schema contains sequences. Effective schema, table/column and function
access and postgres membership remain denied to anon, authenticated and
service_role. These are catalog checks, not behavioral role-session tests.
The earlier detailed execution evidence is retained above as history.

No existing isolated database was found: docker, psql and supabase are absent
from PATH; no PostgreSQL/Docker services or processes were found; no listeners
were found on local ports 5432, 5433 or 54322. The repository has no Supabase
local config or container definition and documents no isolated test endpoint.
This is bounded discovery, not proof that no database exists elsewhere.
No dependencies, database, test users, credentials or fixtures were created.

### Required behavioral matrix (NOT RUN)

Run later in a confirmed disposable database with synthetic identities, two
businesses, two stores per business, OWNER/EMPLOYEE staff and active/inactive
assignments. A test-only auth shim can exercise database predicates without Auth
user changes, but cannot verify JWT handling or managed Auth integration; those
need a separately approved integration test. Use rollback/savepoints to isolate
mutations. Never run this matrix against the hosted project.

| Area | Cases and expected results |
| --- | --- |
| Identity | Missing/nonstaff subject returns null staff and false authorization; disabled/inactive staff or inactive/retired business does the same. Active staff returns only its own UUID. |
| Scope | OWNER accesses active stores only in its business without assignments. EMPLOYEE requires an active same-business assignment and active/non-retired store. Cross-business, unassigned, inactive and retired targets deny access; EMPLOYEE never satisfies OWNER. |
| Role access | As anon/authenticated/service_role attempt SELECT, INSERT, UPDATE, DELETE, TRUNCATE and helper EXECUTE: all denied. Exercise helper results separately under a trusted test caller without relaxing hosted ACLs. |
| Tenant integrity | Reject cross-business assignment store/staff and disabled_by references, nonexistent parents, duplicate store codes within one business, duplicate assignments and second settings row. Permit the same code in distinct businesses. |
| Staff lifecycle | Reject duplicate non-null Auth UUIDs including disabled staff and invalid role/lifecycle combinations. Reject active OWNER demotion, disablement, unlink and identity replacement even with another OWNER. Permit adding/promoting another OWNER. Permit inactive non-OWNER unlink; reject identity replacement. Referenced synthetic auth-parent deletion/update is RESTRICT. |
| Identity/deletion | Reject every table's id changes, child business_id changes, assignment store/staff changes and hard deletion. Preserve inactive records. |
| Timestamps/revision | Override supplied insert timestamps; preserve created_at on update; updated_at never decreases. Force settings revision to 1 on insert then old+1 regardless of input; bigint overflow rejects update. |
| Settings | Exercise inclusive endpoints and immediately outside 1..365 history, 1..500 items and 1..1,000,000,000,000 paise totals/cash. Null cash accepted, zero rejected; required fields cannot be null. |
| Stores/hours | Accept canonical +91 mobile and valid timezone; reject malformed mobile/pincode, unknown timezone, blank/overlong text and wrong currency/country. Accept empty hours, omitted days, sorted adjacent intervals and closing 24:00. Reject extra keys, wrong JSON types, invalid times, overlaps, unsorted/overnight spans, >4 intervals/day and >8 KiB. Verify pickup/delivery default false and active+retired inconsistency rejection. |

Concurrent last-OWNER management tests belong to the later admin phase: its
atomic guard replacement must serialize authority changes and test transaction
retries as described above. This feature is not implemented in Phase 5B.1.

Recommended next work: close the isolated behavioral-test gap, then take the
separately approved Phase 5B.2 scope from Phase 5A.1 architecture. Preserve private
app data, the trusted Next.js boundary, OWNER/EMPLOYEE-only authorization and
narrowly reviewed named database entry points. No separate Phase 5B.2 specification
is present in this repository; closeout does not invent or implement its scope.
No hosted writes, Auth/Storage changes, seeds, commit or push occurred in closeout.
Stop at Phase 5B.1.

### Local check results

- `node supabase/validation/check-phase-5b-1.mjs`: PASS, 18 static contracts and
  22 in-memory unsafe-mutation checks using the aligned filename.
- `node --check supabase/validation/check-phase-5b-1.mjs`: PASS.
- `node node_modules/eslint/bin/eslint.js supabase/validation/check-phase-5b-1.mjs`:
  PASS, exit 0 with no diagnostics (completion was slow).
- SQL SHA-256 after rename: unchanged and equal to remote recorded SQL.
- `git diff --check`: PASS for tracked files. docs/ and supabase/ were already
  untracked at task start, so this does not validate their whitespace or represent
  a clean worktree. Their final contents/references were inspected directly.
- No application code changed; application build/browser checks were not run.
  No PostgreSQL behavioral, permission-attempt or concurrency tests were run.
