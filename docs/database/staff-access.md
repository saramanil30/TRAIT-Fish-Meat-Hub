# Staff access model ? proposed, not deployed

Prepared 2026-09-26 from ReadPrompt.txt. Hosted project: `igiujohtycixboaohjby`.
No hosted migration, identity creation, configuration change, commit or push was performed.

## Permission matrix

| Capability | ADMIN | OWNER | EMPLOYEE |
| --- | --- | --- | --- |
| Common staff login / role dashboard | Yes | Yes | Yes |
| Catalogue/category master create, edit, retire | Yes | No | No |
| Images, descriptions, local names, preparations, weights, cleaning loss | Yes | No | No |
| Create store/product offerings | Yes | No | No |
| Existing daily selling price / availability | Yes | Yes | No |
| Existing employee activate/deactivate | Yes | Yes, employees only | No |
| Store name/hours/delivery/pickup | Yes | Yes | No |
| Orders | Business scope | Business scope | Assigned stores |
| Payments/reports navigation | Yes | Yes | No |
| Direct private-table DML or audit/history edits | No | No | No |
| Grant ADMIN or promote staff through application | No | No | No |

ADMIN is the developer/platform administrator within the provisioned business.
Its separate private grant requires an active staff profile and active business.
This preserves the original OWNER/EMPLOYEE CHECK constraint and all existing objects.
Only a separately authorized migration/bootstrap operator can provision the grant.

## Delivered boundaries

- `src/lib/admin/server.ts`: Auth token verification, fresh database membership,
  no-store requests, user-token RPC calls and no service-role credential.
- `src/app/admin/actions.ts`: server checks on every action, allowlisted fields,
  validated price and IDs. Role and business fields are never trusted from forms.
- `api.update_daily_product`: ADMIN/OWNER only; existing active offering, business/
  store checks, row lock, expected version, bounded integer paise and boolean.
  Changed prices append immutable history; availability-only edits append audit.
- Catalogue RPCs independently require ADMIN even when called directly through
  Supabase. Private schemas/tables/helpers are inaccessible to browser roles.
- All application tables force RLS. Only explicitly named api functions are
  executable by authenticated. Every function has an empty search_path.
- The applied foundation file is untouched: SHA256
  `93de04ce74fcb365cdb978251530c4720e4c6a3dc702217e7c13bb07b134316f`.

## Frontend and integration limits

The common /admin form determines the destination from authenticated membership:
`/admin/admin/dashboard`, `/admin/owner/dashboard`, or
`/admin/employee/dashboard`. It has no role selector.
Synthetic previews remain explicitly labelled and never grant live authority.
OWNER catalogue/category routes and navigation are denied; reports are visible.

The live daily page has product, category, current price, new price, availability,
last-updated time and Save. Concurrent changes return a reload message rather than
overwriting another operator. Every mutation repeats authorization.

The repository previously contained frontend previews and only the five-table
foundation. Live order/status, payment settlement/refunds, report queries, employee
invitations/recovery/assignment, secure image uploads and storefront/database
integration remain later backend work. Those operations are not falsely enabled
by this change. Existing employee access toggles and normal store settings are wired.
Catalogue removal uses retirement, preserving historical references.

The incremental product model stores validated weights and preparations (including
optional cleaning loss) as JSON arrays and images as local asset paths. This
implementation detail is recorded in TRD; later normalized catalogue/storage work
must migrate this data forward.

## Deployment prerequisites ? not performed

1. Review `20260926000000_staff_access.sql` and separately authorize deployment.
   Do not modify or reapply Phase 5B.1 to the hosted project.
2. After deployment, expose only `api` to the Supabase Data API, retaining `app`
   as private. Do not use broad example table/function grants from setup guides.
3. Provision authorized staff and ADMIN grants using a separately reviewed workflow.
   No real identities, passwords, grants or initial catalogue were created here.
4. Configure server-only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   and `TRAIT_STAFF_ENABLED=true`. The feature is disabled by default.
5. Confirm Supabase Auth rate limits and deployment edge rate limits. Sessions use
   a Secure (production), HttpOnly, SameSite=Strict cookie, scoped to /admin.
   Access-token lifetime is capped at one hour; expiry requires another sign-in.
   No refresh token is stored. No privilege is taken from editable Auth metadata.
6. Validate hosted Auth/PostgREST integration in a separately authorized environment.

Supabase references: [custom schema exposure](https://supabase.com/docs/guides/api/using-custom-schemas),
[Auth sessions](https://supabase.com/docs/guides/auth/sessions), and
[JWT verification](https://supabase.com/docs/guides/auth/jwts).

## Reproducible local validation

The security harness has no hosted connection. It applies the original foundation
and the proposed migration only inside disposable, in-memory PGlite PostgreSQL,
with synthetic auth rows and a mock auth.uid() request context.

```powershell
npm.cmd install --prefix node_modules/.staff-validation --no-package-lock --no-audit --no-fund @electric-sql/pglite@0.5.8
npm.cmd run test:staff-db
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:admin-browser
```

PGlite lives under ignored node_modules and is not a production dependency.
The SQL tests exercise real PostgreSQL privileges, functions and transactions,
but do not substitute for hosted JWT/PostgREST or multi-connection concurrency
testing. Stale-version rejection is tested deterministically.

## Validation results (2026-09-26)

- 30 unit tests passed, including mocked Auth routing for all three roles,
  forged OWNER catalogue actions, EMPLOYEE price denial and disabled membership.
- 17 isolated PostgreSQL security groups passed.
- Unchanged foundation: 18 structural checks and 22 unsafe-mutation checks passed.
- Typecheck, lint and production build passed.
- Production browser suite passed: denied routes, role navigation, employee scope,
  catalogue validation, daily price updates/history, store isolation, settings,
  and layouts at 320/390/768/1440 pixels without uncaught browser errors.
- Desktop daily-operation screenshot visually reviewed. Hosted Auth/PostgREST
  integration and multi-connection lock races were not exercised.
