# Final integration Part 1

The application now uses server-only Supabase RPC adapters for catalogue, staff, orders and tracking. The previous browser-only order placement is not reachable from checkout. No real users, catalogue records, orders, payments or business policy values were seeded.

## Deployment configuration

Set these in the deployment environment, never in a client-prefixed variable:

| Variable | Required purpose |
| --- | --- |
| SUPABASE_URL | Project API URL for igiujohtycixboaohjby |
| SUPABASE_PUBLISHABLE_KEY | Project publishable API key |
| TRAIT_STORE_ID | Approved active store UUID |
| TRAIT_STAFF_ENABLED | true when staff Auth is ready |
| TRAIT_CHECKOUT_DATABASE_URL | Separate TLS connection inheriting only trait_checkout; no table grants, BYPASSRLS, CREATEROLE or verifier membership |
| TRAIT_CHECKOUT_ENVELOPE_KEY | Operator-generated 32-byte key encoded as 64 hexadecimal characters; retain it across deploys while retry envelopes exist |
| TRAIT_TRACKING_EXPIRY_DAYS | Approved token lifetime, integer 1–365 |
| TRAIT_RATE_LIMIT_REST_URL | HTTPS Redis-compatible REST endpoint supporting atomic EVAL |
| TRAIT_RATE_LIMIT_REST_TOKEN | Server-only limiter credential |
| TRAIT_TRUSTED_IP_HEADER | Optional header overwritten by trusted ingress; without it requests share a conservative global limit |
| SUPABASE_AUTH_ADMIN_KEY | Server-only Supabase Auth administration credential for creating staff identities |
| TRAIT_AUTH_RECOVERY_URL | HTTPS application URL ending in /admin/recovery, allowlisted in Supabase Auth |

The default is fail-closed for checkout, staff login and tracking when required runtime protection is missing. Catalogue is empty when no store is configured. Do not deploy a postgres, service-role or payment-verifier database connection as the checkout connection. TLS certificate verification is enabled; configure a trusted CA through the runtime trust store if required.

Expose the api schema to PostgREST in Supabase API settings while preserving the existing function EXECUTE grants and private app schema. Keep app tables unexposed. Supabase Auth Site URL, redirect allowlist, email delivery and password recovery need real deployment configuration.

Provision the dedicated checkout LOGIN using an operator-approved identity and secret through a secure administrative channel. Grant only membership in the existing trait_checkout group and database CONNECT; do not grant private tables, sequences, verifier membership, role administration or BYPASSRLS. The application verifies this capability isolation before quote/place calls. The payment verifier stays unprovisioned for this integration.

## Staff

The common login validates the access token with Supabase Auth, then reloads active staff membership and store assignments. Sessions use HttpOnly, SameSite=Strict cookies, Secure in production, and expire after at most one hour. Expired sessions require sign-in again; refresh-token sessions are not implemented. Logout invalidates the session and removes the cookie. Production preview routes are disabled.

An existing ADMIN can create OWNER or EMPLOYEE Auth identities and memberships. OWNER can create only EMPLOYEE membership. These identities have no invented password. Supabase Auth recovery/invitation setup is needed to let the real person establish credentials. A failed membership step leaves an unbound Auth identity with no TRAIT authority; an operator should reconcile it before retrying.

For the first ADMIN (or operator-provisioned OWNER/EMPLOYEE), use scripts/provision-staff.mjs after creating the approved identity in Supabase Auth. Supply TRAIT_PROVISION_DATABASE_URL, TRAIT_STAFF_AUTH_USER_ID, TRAIT_STAFF_BUSINESS_ID, TRAIT_STAFF_STORE_ID, TRAIT_STAFF_NAME and TRAIT_STAFF_ROLE only in the operator process. The script checks tenant/store membership, inserts the profile and assignment atomically, grants ADMIN only through the existing private grant table, and appends audit. Never configure its administrative connection in the web application.

The existing conservative database guard continues to forbid removing any active OWNER. It therefore protects the final OWNER. Multi-owner retirement/demotion is not enabled. Employee names, store assignments and active state use version-checked staff updates. OWNER sees and edits employees only; ADMIN can also manage OWNER profiles within the existing removal guard. Invitations and recovery-email requests are wired through Supabase Auth, with password completion at /admin/recovery. Real email delivery and recovery require the environment and Auth configuration above.

## Ordering

Catalogue, preparations, integer raw weights and preparation-specific loss estimates come from the public projection. Prices in the cart are display-only. Checkout constructs a choices-only payload, obtains a fresh database quote, and requires explicit review. Placement repeats validation atomically. The server generates the random tracking token, stores its digest through the database RPC and keeps the original inside an authenticated encrypted retry envelope. Pending submissions keep only this encrypted envelope in tab storage; retries preserve request identity and payload. Invalidated quotes require review again.

Cash and Online/UPI remain PENDING until their respective secured backend operations. No provider adapter or client-side PAID path exists. Tracking/confirmation show only the permitted minimal response; they are not detailed PII receipts.

Order queues show the latest 100 scoped records. Reports support rolling 1, 7, 30 and 365 day UTC periods. Intake uses order creation time; fulfilled sales and cancellations use status-event time; collections and completed refunds use payment-event time. Product/category intake and store-scoped staff activity are included. Current payment states and outstanding balances explicitly cover all dates. Custom date ranges, calendar/timezone reporting and historical queue pagination remain for Part 2.

## Database deployment

New local migration: 20260927000000_application_integration.sql.
Hosted version: 20260927095820_application_integration.
Hosted SQL MD5: 0233c6dabf8298f53b9a2aeda3c6b956.

Adds only business_policy, save_business_policy, provision_staff and integration_report. Policy writes use expected revision and business-row serialization; staff and policy changes write through existing immutable audit. No old migration was edited. Hosted verification found 30 forced-RLS tables and zero direct app-table grants for public, staff or runtime capability roles.

The additional local migration 20260927010000_staff_reporting_integration.sql adds versioned staff editing, scoped staff directory and event-based operations reporting. It passes isolated integration/reporting validation. Its hosted application status has not been verified in this resumed session; Part 2 must inspect migration history and apply it only if absent. No hosted SQL or migration was executed during this resumed session.

## Validation and remaining acceptance

The isolated database suites cover staff roles, catalogue, delivery, atomic placement, replay, token expiry/revocation, store isolation, payment evidence, refunds and audit. Added server tests cover encryption, tampering, stable retry arguments and fail-closed limiting. Browser tests use a test-process-only fetch fixture, never production records. They cover responsive cart interactions and live checkout failing closed without a database connection, invalid tracking, and unauthenticated route protection.

Real Supabase Auth sessions and successful browser-to-hosted-checkout acceptance cannot be verified until environment credentials, staff, approved catalogue, store/delivery values and operational policy are supplied. Real multi-connection race/load testing remains a staging acceptance requirement. No commit or push was performed.

## Checks recorded by the previous session

- Unit/authorization suite: 30 passing before the added checkout tests; added checkout suite: 3 passing.
- Staff security: 17 groups; catalogue: 26 groups; delivery/customer boundary: 15 groups; core orders/payments: 29 groups.
- Additive migration authorization/revision/provisioning/report/audit test passed.
- Nonsuperuser hosted-owner compatibility passed.
- Typecheck and production build passed.
- Cart browser tests passed across 320, 390, 768, 1024 and 1440px and landscape drawers.
- Checkout/storefront/protected-route browser checks passed at 390, 768 and 1440px using isolated fixtures, including no mock fallback and no tracking PII.
- Production credentials and successful real hosted checkout remain unverified.

## Resumed Part 1 validation (2026-09-27)

The reporting harness imported the core validator through a data URL but left its checkout-envelope import relative. Resolving that import against the validator directory fixes ERR_UNSUPPORTED_RESOLVE_REQUEST without changing application or database behavior. Run it with `npm run test:reporting-db`.

- `npm test`: all 33 tests passed.
- `npm run test:integration-db`: both integration and staff/reporting groups passed.
- Reporting validator: all 29 core groups plus event-ledger reconciliation and report access scope passed.
- `npm run typecheck` and `npm run build`: passed.
- `npm run lint`: zero errors; its one unused test-helper warning was removed and that file passed a targeted ESLint check.
- Cart browser checks: passed at 320, 390, 768, 1024 and 1440px, including landscape drawer checks.
- Checkout browser checks: passed at 390, 768 and 1440px; missing backend fails closed, invalid tracking exposes no PII, and protected routes reject unauthenticated access.

- Admin browser checks: ADMIN, OWNER and EMPLOYEE pages/role navigation passed at 390 and 1440px using isolated RPC fixtures; recovery-page rendering also passed.

Existing Supabase/frontend work is preserved. Historical migrations were loaded only into disposable in-memory validation databases; none were rerun against the hosted database. No database reset/drop, commit or push was performed.

## FINAL Part 2 remaining work

1. Verify hosted migration history and the definitions/grants for staff_directory, save_staff_profile and operations_report. Deploy only the missing forward staff/reporting migration; never replay prior migrations. Recheck forced RLS, API schema exposure and grants after deployment.
2. Configure deployment secrets and infrastructure from the table above: isolated checkout login/TLS, encryption key, approved tracking lifetime, distributed limiter, trusted ingress header, store ID and staff Auth settings. Provision approved staff identities and first ADMIN securely. Configure Auth email delivery, HTTPS recovery redirect and allowlist; exercise invitations and password recovery with real accounts.
3. Enter approved commerce data and policies: store contact/address/hours, catalogue/images/prices/preparations/weights/loss estimates, delivery areas/fees/minimums, employee visibility/cash limits, cancellation/refund rules, tax/invoice requirements and data retention. No production values have been invented.
4. Select and implement the payment provider: initiation, merchant configuration, signature-verified webhook/server verification, idempotent settlement and refund handling using the isolated verifier capability. Current Online/UPI preference and reference evidence do not collect or settle money.
5. Implement secure ADMIN image uploads and lifecycle management, including decoded-format/pixel/size validation, generated paths, authorization and orphan cleanup. Current image integration uses configured asset/object references only.
6. Complete operational enhancements: historical order pagination, custom/calendar date ranges and timezone reporting, and any approved multi-owner retirement workflow (the current guard blocks all active OWNER removal). Replace catalogue JSON-entry controls with suitable staff-facing editors before operational rollout.
7. Run staging acceptance with real Auth and the complete browser-to-database path: successful delivery/pickup cash checkout, quote-change review, retries, cross-device tracking, role restrictions, staff revocation, order fulfillment, payment/refund reporting and recovery. Run independent-connection concurrency/race/load tests; PGlite and mocked browser RPCs do not establish those guarantees.
8. Validate production headers/log redaction, backup/restore and monitoring, review real catalogue/content and mobile accessibility, then deploy and perform launch smoke tests. Deployment, real payment settlement and production acceptance remain incomplete.
