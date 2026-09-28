# Final integration Part 2 ? implementation and deployment record

## Production status

The database functions and application integration are implemented and locally validated. The complete service is **not launch-ready**: the hosted project contains no approved business, store, catalogue, staff membership or Auth users. There is no configured isolated checkout login, limiter, deployment domain or mail provider. Real hosted sign-in and successful customer checkout cannot be honestly certified without those inputs.

## Hosted changes and verification

- Verified all seven existing migration contents against hosted MD5s; none were changed or replayed.
- Applied only the new local migration 20260928000000_production_storefront.sql, recorded remotely as 20260927171654_production_storefront. MD5: 48a4cfee05375f318818bac81a69b49c.
- Added api.storefront_info: allowlisted active store contact, opening hours, pickup/delivery flags and configured delivery rules; no private customer/staff information.
- Added api.order_queue_page: stable timestamp/UUID pagination with the existing role, business, assigned-store and employee-history checks.
- Supabase exposed schemas are now public,graphql_public,api. The app schema remains unexposed. Public Auth signup is disabled; approved staff are invited/provisioned only.
- Verified all 30 app tables force RLS and zero effective direct app-table grants for anon, authenticated, service_role, trait_checkout and trait_payment_verifier.
- Real HTTPS checks pass for public projections and anonymous rejection of staff/report/order queues and the private schema. These checks write no production rows.
- Security advisories flag SECURITY DEFINER entry points and RLS without policies. These are deliberate architecture choices: private tables deny direct access and narrow, fixed-search-path RPCs enforce capabilities and scope. No broad policies or grants were added to silence advisories. Production review should retain this distinction; the advisor output is not an all-green report.

## Application changes

- Contact/delivery pages use the live public store projection, including configured fees/minimums, address and hours. Missing setup returns an unavailable state, with no fabricated store data.
- Historical order pagination and custom UTC report date ranges are connected. End dates are exclusive; rolling periods remain available. Current outstanding amounts are labeled as all-date metrics.
- Catalogue preparation and raw-weight editors use ordinary form controls instead of JSON input.
- Removed obsolete mock receipt/tracking components and disabled all preview routes. Test-only fixtures remain isolated from production. Existing cart storage keys are retained for compatibility; stored data is selections only.
- Delivery checkout validates city/state before review. Network failures release review/retry controls while preserving a pending request's encrypted identity.
- Added HSTS and a baseline CSP covering base URI, objects, framing and form destinations. This is not a strict script-src nonce policy. Existing no-referrer, no-sniff, private no-store and framing headers remain.
- Payment handling remains provider-neutral. UPI preference/evidence cannot initiate or prove payment. Image upload remains pending because no Storage bucket/configuration exists.

## Safe initial setup

config/initial-store.template.json deliberately has blank identity fields and null policy choices. Fill it with approved values, then run:

    node scripts/provision-initial-store.mjs APPROVED_FILE.json

The default validates only. After configuring TRAIT_PROVISION_DATABASE_URL securely in the operator process, use --apply to create business/store/settings in one transaction. A database advisory lock and existing-slug check prevent accidental duplicate/replay; failures roll back; creation is audited. It does not create Auth users, products or delivery rules and rejects supplied nonempty arrays for those workflows rather than silently discarding them.

Use scripts/provision-staff.mjs with actual Supabase Auth identities to bootstrap the first ADMIN and approved memberships. Thereafter ADMIN/OWNER invitations, staff edits and recovery operate through the protected application. Passwords stay in Supabase Auth. Never put the provisioning connection in the web runtime.

config/catalogue.template.json lists the required approved fields. Enter real categories/products through ADMIN, and prices/availability and delivery rules through permitted ADMIN/OWNER pages. No seed products, users, addresses, prices or policy values were invented.

## Environment and external setup still required

The ignored .env.local contains the existing project URL/public API key only, with staff disabled. No privileged keys were printed, generated or committed. config/environment.example contains variable names with empty values. npm run check:environment reports names of missing/invalid settings without revealing values.

Required inputs:

- Approved business/store identity, address, support mobile, opening hours, delivery/pickup flags.
- Product/category names, approved images, raw weights, preparations/loss estimates, prices/availability; delivery pincodes/fees/minimums.
- Operational policy: employee visibility window/cash limit, require-payment-before-completion, max items/total, tracking lifetime, cancellation/refund/tax/retention policy.
- Real ADMIN, OWNER and EMPLOYEE names/emails and permitted stores.
- Deployment project and HTTPS domain; dedicated checkout database credential inheriting only trait_checkout, stable encryption key, Redis REST URL/token and trusted ingress-header policy. Provision credentials through the deployment secret manager, not chat or source files.
- Server-only Auth administration key, SMTP/email provider, Auth Site URL and exact /admin/recovery redirect allowlist. Hosted Auth Site URL is still localhost and SMTP is not configured.
- Payment provider/merchant credentials and verified webhook integration when selected; Storage setup and secure decoded-image upload workflow when available.
- Real staging acceptance: login/invitation/recovery/revocation across all roles, successful browser-to-hosted checkout, multi-connection races/load, production deployment/monitoring/backups and launch smoke tests. Local PGlite and browser fixtures do not establish hosted end-to-end readiness.

Management API references used for configuration: https://supabase.com/docs/reference/api/v1-update-postgrest-service-config and https://supabase.com/docs/reference/api/v1-update-auth-service-config.

## Validation

Results will be finalized after the remaining browser checks. No commit, push, database reset/drop or production seed-data operation was performed.

## Staging verification completed 2026-09-28

Resumed the existing tree without replaying or changing migrations. Hosted history contains all eight migrations including staff_reporting_integration and production_storefront. Read-only checks reconfirmed 30/30 forced-RLS tables, zero effective direct private-table grants for browser/runtime roles, and fixed search paths on the five reporting/staff/storefront entry points. HTTPS public projection and anonymous/private-schema denial checks passed.

Passed: all 33 unit tests; staff security; catalogue; foundation static/unsafe-mutation checks; delivery/customer isolation; nonsuperuser migration-owner compatibility; integration/staff reporting; core orders/payments and ledger reporting; final storefront/pagination/real server-adapter validation; lint; typecheck; production build. Browser suites passed for cart, checkout, staff role pages and storefront layout. Responsive coverage spans 320, 390, 768, 1024 and 1440 pixels, plus landscape drawers. Public footer login navigation to the sign-in page at /admin passed. The first new test incorrectly expected /admin/login; corrected to the actual /admin contract and rerun successfully.

Added Vercel configuration, upload exclusions and docs/staging-deployment.md. Replaced obsolete mock-behavior README text. Environment files, imported ZIPs, local references and build output are excluded. Secret-pattern review found no embedded credential in candidate source; the validator's secret-detection pattern is not a credential.

Environment readiness intentionally fails: store ID, isolated checkout connection, envelope key, tracking policy, distributed limiter credentials, Auth administration key/recovery URL and enabled staff configuration remain absent. No Vercel CLI/auth file/token is available in this environment, so no deployment URL is claimed. No production domain was connected. Secure Storage uploads remain pending configuration and implementation; configured image references continue to work. Real Auth, email, successful hosted checkout, independent-connection load/race acceptance, backup/restore and monitoring remain required before production launch. Payment remains provider-neutral and cash does not require a gateway.

Prepared on staging/final-part-2 for a dedicated staging commit and GitHub push. No hosted rows were created or modified during this verification.
