# TRAIT Fish & Meat Hub --- Technical Requirements Document (TRD)

**Version:** 1.0\
**Prepared:** September 2026\
**Status:** Living technical specification

> This is a living technical document for developers and Codex. Update
> it when an approved architecture or implementation decision changes.
> Do not silently change product/business rules; keep this document
> aligned with `PRD.md` and record material changes in the Change Log.

## 1. Architecture

Production request path:

`Browser -> Next.js trusted server boundary on Vercel -> Supabase PostgreSQL/Auth/Storage`

The browser is never authoritative for:

-   Prices
-   Totals
-   Staff roles
-   Order ownership
-   Payment completion
-   Availability
-   Delivery eligibility

### Technology

  -----------------------------------------------------------------------
  Layer                   Technology              Responsibility
  ----------------------- ----------------------- -----------------------
  Frontend                Next.js 16, React 19,   Mobile-first
                          TypeScript, Tailwind    customer/admin UI
                          CSS

  Trusted application     Next.js server          Validation,
                          routes/actions on       authorization,
                          Vercel                  repricing, controlled
                                                  DB calls, payment
                                                  integration

  Database                Supabase PostgreSQL 17  Relational state,
                                                  constraints,
                                                  transactions, RLS,
                                                  controlled functions,
                                                  audit

  Authentication          Supabase Auth           Staff identity,
                                                  password hashing,
                                                  sessions,
                                                  recovery/invitations

  Storage                 Supabase Storage        Validated product
                                                  images

  Hosting                 Vercel                  Next.js deployment,
                                                  TLS, server runtime,
                                                  environment variables

  Payments                Third-party gateway /   Payment initiation and
                          merchant UPI            trusted settlement
                                                  verification
  -----------------------------------------------------------------------

## 2. Supabase Schema Strategy

-   Private `app` schema for application tables.
-   Small `api` schema for approved database entry-point functions where
    needed.
-   UUID primary keys.
-   `timestamptz` timestamps.
-   Money stored as `bigint` paise.
-   Weight stored as integer grams.
-   `business_id` / `store_id` retained where appropriate for future
    branches.
-   Composite foreign keys protect tenant/store integrity.
-   Historical order/financial/audit data is immutable through normal
    application operations.
-   RLS plus explicit `REVOKE`/`GRANT`.
-   Browser roles do not receive arbitrary application-table DML.
-   Security-definer helpers, where unavoidable, use narrow behavior,
    fixed/empty `search_path`, fully-qualified objects and tightly
    restricted `EXECUTE`.

## 3. Core Database Model

### Business and Staff

#### `app.businesses`

Business identity and lifecycle.

Key fields: - `id uuid` - `slug` - `display_name` - `legal_name` -
`currency` - `is_active` - `deleted_at` - timestamps

#### `app.stores`

Operational store/branch.

Key fields: - `id uuid` - `business_id` - `code` - `name` - `timezone` -
structured address - `pincode` - `contact_mobile_e164` - opening hours -
`delivery_enabled` - `pickup_enabled` - `is_active`

#### `app.business_settings`

Typed business policies such as operational limits and revisions.

#### `app.staff_profiles`

TRAIT staff authorization linked to `auth.users`.

Key fields: - `id uuid` - `business_id` - `auth_user_id` -
`display_name` - base `role` (`OWNER` / `EMPLOYEE`) - active/disabled
metadata

#### `app.staff_store_assignments`

EMPLOYEE-to-store authorization.

#### app.staff_admin_grants

Private, migration-provisioned ADMIN elevation of an active staff profile.
Effective role is ADMIN when an active grant exists, otherwise the base role.
This preserves the already-applied Phase 5B.1 constraint without dropping or
rewriting an existing object. Disabled membership/business always denies access.
ADMIN is scoped to the provisioned business; no implicit cross-business access.

### Catalogue

#### `app.categories`

Hierarchical catalogue taxonomy.

Supports: - Fish - Freshwater - Sea Fish - Seafood/Prawns - Chicken -
Mutton - Future categories

Key fields include `business_id`, `parent_category_id`, `code`, `name`,
`sort_order`, `is_active`.

#### `app.products`

Catalogue master: category, display/local names, description,
active/featured/sort/retirement metadata.

#### `app.product_store_settings`

Store-specific offering and availability.

Key behavior: - active/inactive - available/out of stock - featured/sort
overrides

#### `app.product_images`

Product image metadata and storage object reference.

#### `app.preparation_options`

Reusable preparation/cut definitions such as Whole, Cleaned, Curry Cut,
Fry Cut, Boneless, Skinless.

#### `app.product_preparation_options`

Product-specific preparation availability and optional cleaning-loss
percentage.

#### `app.product_allowed_weights`

Allowed raw weights per product.

#### `app.product_prices`

Immutable/effective-dated price history.

Key concepts: - store/product offering - `price_per_kg_paise` -
`effective_from` - `created_by` - cancellation/supersession metadata

Never rewrite old order prices when current price changes.

### Customers and Delivery

#### `app.customers`

Future verified customer identity. Mobile number is not the primary key.

#### `app.customer_addresses`

Future saved addresses.

#### `app.delivery_areas`

Explicit store delivery eligibility, pincode/area, delivery fee, minimum
order and active state.

### Orders

#### `app.orders`

Order header with: - UUID internal ID - human order number -
business/store - nullable customer link - delivery method - payment
preference - order status - customer/delivery snapshots - trusted
totals - timestamps/version

#### `app.order_items`

Immutable purchased item snapshots: - product provenance -
product/category name snapshot - preparation snapshot - unit price
snapshot - raw weight grams - cleaning-loss estimate where applicable -
special instructions - line total

#### `app.order_item_fulfillment`

Optional actual cleaned/dispatch weight and staff/timestamp.

Actual cleaned weight is record-only and does not automatically reprice.

#### `app.order_status_history`

Append-only workflow transition history with actor and timestamp.

#### `app.order_access_tokens`

Tracking/receipt authorization.

Store token digest only, not raw token.

#### `app.order_requests`

Durable checkout idempotency records.

### Payments

#### `app.payments`

Payment attempts and state: - order - method - amount - `PENDING` /
`VERIFYING` / `PAID` / `FAILED` / `REFUNDED` - provider/reference
evidence - verification metadata

#### `app.payment_refunds`

Refund operations.

#### `app.refund_allocations`

Refund allocation to items/fees.

#### `app.payment_events`

Append-only payment event history and provider event identity.

### Audit

#### `app.audit_logs`

Immutable sensitive-change audit: - business/store - actor - action -
target - request/correlation ID - timestamp - allowlisted before/after
values

Do not copy secrets, full Auth records or raw payment webhook payloads
into audit data.

## 4. Catalogue Filtering

The UI exposes:

`All | Fish | Chicken | Mutton`

These filters are backed by database categories, not hardcoded product
arrays.

-   **All:** all eligible active products for selected store.
-   **Fish:** Fish category tree.
-   **Chicken:** Chicken category tree.
-   **Mutton:** Mutton category tree.

Future categories can be created by ADMIN without schema changes.

Catalogue projection resolves: - Product - Category - Current store
availability - Effective price - Primary image - Preparations - Allowed
weights

## 5. Cart Duplicate Rule

Canonical duplicate identity:

`product_id + preparation_option_id + raw_weight_grams + trim(normalize(instructions))`

Rules: - Client rejects exact duplicate for UX. - Server repeats
validation. - Different preparation, weight or instructions creates a
valid separate line.

## 6. Raw-Weight Pricing

Trusted line calculation:

`line_total_paise = round(price_per_kg_paise * raw_weight_grams / 1000)`

Rules: - Server ignores client-supplied price, delivery fee and
totals. - Effective price comes from current effective price history. -
Order item stores price provenance plus immutable price snapshot. -
Cleaning estimate is informational. - Actual cleaned/dispatch grams do
not automatically reprice.

## 7. Order Placement Transaction

Order placement must be atomic.

1.  Validate request shape, origin/CSRF controls, rate limits and
    idempotency key.
2.  Claim idempotency record and compare payload digest.
3.  Validate active business/store.
4.  Validate delivery method and delivery-area eligibility.
5.  Validate each product, store availability, preparation and allowed
    raw weight.
6.  Lock required catalogue/store rows and resolve effective prices at
    one pricing timestamp.
7.  Reject exact duplicate line identities.
8.  Calculate trusted subtotal, delivery fee and grand total.
9.  If quote changed beyond approved rule, return a re-review response
    rather than silently charging more.
10. Insert order and immutable order-item snapshots.
11. Insert initial `PLACED` history.
12. Insert `PENDING` payment preference.
13. Insert tracking/receipt access-token digests.
14. Complete idempotency record.
15. Commit.

Any failure rolls back the entire logical order.

## 8. Order Number and Tracking Security

-   Human order number: `TFM-######`
-   Internal primary key: UUID
-   Tracking token: at least 256 bits of cryptographically secure
    randomness
-   URL-safe encoded
-   Store only SHA-256 token digest
-   Never use sequential order number as authorization
-   Tracking endpoint returns minimal information
-   Receipt authorization should be separate from public tracking scope
-   Sensitive responses use `no-store`
-   Tokens should be redacted from logs/referrers where practical

## 9. Staff Authentication and Authorization

Supabase Auth owns credentials.

`app.staff_profiles` owns TRAIT authorization.

Conceptual flow:

`Supabase Auth identity -> active staff profile -> ADMIN/OWNER/EMPLOYEE effective role -> store assignment -> permitted operation`

Rules: - ADMIN and OWNER are business-wide within their provisioned business. - EMPLOYEE requires active profile plus
active store assignment. - Role is never accepted from browser input. -
Role is not trusted from editable client/Auth metadata. - Disabling
staff membership removes TRAIT authorization. - Final active OWNER must
be protected by a concurrency-safe controlled mutation. - Historical
staff identity should be logically deactivated rather than destructively
deleted when referenced by audit/order history.

### Employee Creation

OWNER admin workflow may: 1. Create/invite employee Auth identity
through trusted server-side Auth admin capability. 2. Create
corresponding `staff_profiles` record. 3. Create store assignment. 4.
Audit the action.

TRAIT must never store plaintext employee passwords.

## 10. RLS and Privilege Model

  ------------------------------------------------------------------------
  Principal               Direct app-table access Intended capability
  ----------------------- ----------------------- ------------------------
  `anon`                  None                    Safe public
                                                  catalogue/tracking
                                                  projections only

  authenticated customer  None                    Future narrowly scoped
                                                  OTP self-service

  EMPLOYEE                No arbitrary table DML  Permission-checked
                                                  assigned-store
                                                  operations

  ADMIN                   No arbitrary browser    Catalogue-master and
                          table DML               business operations

  OWNER                   No arbitrary browser    Permission-checked
                          table DML               business administration

  Vercel trusted backend  Only controlled         Checkout, public
                          required capability     projections, payment
                                                  callbacks

  migration/admin owner   Administrative          Migrations/maintenance
                                                  only
  ------------------------------------------------------------------------

All application tables enable RLS.

Explicit grants/revokes accompany object creation. Broad Supabase
defaults are not relied upon.

Function `EXECUTE` permissions are explicitly controlled.

## 11. Payment Architecture

Internal model is provider-neutral and supports CASH plus online/UPI.

### Cash

-   Order/payment begins `PENDING`.
-   Permitted staff records receipt according to policy.
-   Audit the transition.

### Online / UPI

Typical flow:

`PENDING -> VERIFYING -> PAID`

or failure:

`PENDING/VERIFYING -> FAILED`

Rules: - Client success never creates `PAID`. - Provider
webhook/callback signature is verified server-side. - Provider event
processing is idempotent. - Expected merchant/account/order/amount are
validated. - UTR alone is not sufficient proof of settlement. - Refund
authority is ADMIN/OWNER only initially. - Provider API/webhook secrets are
server-only. - QR-only flows without trustworthy settlement verification
remain manual-verification workflows.

## 12. Vercel Requirements

-   Deploy Next.js from controlled Git repository.
-   Separate Preview and Production environments.
-   Keep privileged credentials server-only.
-   Never prefix privileged keys with `NEXT_PUBLIC`.
-   Next.js server routes/actions validate and authorize before DB
    mutation.
-   Payment webhook route validates signature and idempotency and avoids
    logging secrets/full sensitive payloads.
-   Apply secure headers, HTTPS, appropriate CSP/referrer policy,
    `no-store` for PII/order endpoints and rate limiting.
-   Production promotion requires tests, typecheck, lint and build.

## 13. Supabase Storage

Product images may use a dedicated `product-images` bucket.

Rules: - Public read only for intentionally published catalogue
images. - ADMIN-only upload/delete. - No employee/customer arbitrary
upload. - Server-generated path:
`business_uuid/product_uuid/image_uuid.ext` - Allow JPEG/PNG/WebP. -
Reject SVG/HTML/active content. - Enforce byte-size and decoded-pixel
bounds. - Validate actual decoded file type, not only extension/MIME. -
Use new object paths for replacements. - Stage upload/metadata and mark
READY. - Implement orphan cleanup because Storage and PostgreSQL are not
one atomic transaction.

## 14. Server Capability Map

  ------------------------------------------------------------------------------------------------
  Capability              Caller                  Trusted validation
  ----------------------- ----------------------- ------------------------------------------------
  Catalogue browse/filter Public                  Store/category/activity/availability/effective
                                                  price; safe projection

  Checkout quote/place    Guest                   Products, preparations, weights, duplicates,
                                                  delivery, prices, totals, idempotency

  Track order             Guest with token        Token hash, scope, expiry/revocation, minimal
                                                  projection

  Admin login/session     Staff                   Supabase Auth + active staff membership

  Employee management     ADMIN/OWNER             Active membership, Auth admin operation,
                                                  profile/assignment rules, final-owner safeguards

  Catalogue master        ADMIN                   Business scope, validated master fields,
                                                  audit

  Daily price/availability ADMIN/OWNER             Existing offering, immutable price versioning,
                                                  audit

  Order operation         ADMIN/OWNER/EMPLOYEE          Business/store scope, valid transition,
                                                  concurrency/version, audit

  Payment                 ADMIN/OWNER / policy-limited  Evidence, amount, state, provider verification,
  verification/refund     EMPLOYEE                audit

  Payment webhook         Provider                Signature, idempotency,
                                                  merchant/account/order/amount
  ------------------------------------------------------------------------------------------------

## 15. Indexing and Concurrency

Indexes should support: - Active catalogue by business/category/sort -
Store availability - Effective prices by store/product/effective date -
Orders by store/status/placed date - Unique token digest - Staff by
business/active role - Active store assignments

Concurrency controls: - Row locks/version checks for order status
changes - Payment verification - Staff role changes - Price scheduling -
Database constraints for tenant integrity and uniqueness races

## 16. Audit and Observability

-   Audit sensitive mutations in the same transaction as the change.
-   Record actor, business/store, action, target, request ID, timestamp
    and allowlisted before/after values.
-   Do not store full addresses, Auth rows, secrets or raw webhook
    payloads in audit JSON.
-   Application logs use correlation IDs.
-   Redact tracking tokens, credentials, payment secrets and unnecessary
    PII.
-   Monitor failed checkout, payment webhook failures, elevated auth
    failures and migration errors.

## 17. Migration Plan

1.  Security foundation + businesses/stores/settings/staff.
2.  Catalogue + preparations + allowed weights + images + price history.
3.  Customers + addresses + delivery rules.
4.  Orders + items + status history + access tokens + idempotency.
5.  Payments + refunds + events + audit.
6.  Controlled functions + grants/RLS matrix + security/concurrency
    tests.
7.  Approved initial TRAIT seed data + first ADMIN/OWNER bootstrap.
8.  Application integration + payment provider + end-to-end acceptance +
    production launch.

Every migration must leave the database in a secure intermediate state.
Never temporarily expose tables while waiting for a later RLS/grant
migration.

## 18. Security Test Gate

Before production:

-   `anon` cannot read/write private application tables.
-   Authenticated non-staff receives no staff authority.
-   OWNER cannot alter catalogue masters by RPC or direct table access.
-   EMPLOYEE cannot alter catalogue/prices/availability/staff.
-   EMPLOYEE cannot cross assigned-store boundaries.
-   Disabled staff immediately fail application authorization.
-   Forged prices/totals/status/payment completion are rejected.
-   Concurrent duplicate checkout requests create at most one logical
    order.
-   Failed order placement rolls back all related records.
-   Historical snapshots remain unchanged after catalogue/price edits.
-   Invalid order status transitions are rejected.
-   Tracking token cannot access another order.
-   Invalid tracking token returns generic response.
-   Client success/UTR alone cannot mark online payment `PAID`.
-   Duplicate provider callbacks are idempotent.
-   Unsupported/active image content is rejected.
-   Audit history cannot be edited through normal application
    privileges.
-   Secrets/PII are absent from browser bundles and ordinary logs.

## 19. Production Configuration Still Required

-   Selected payment gateway / merchant account
-   Production Vercel project/domain/environment variables
-   Real TRAIT store profile
-   Delivery areas/fees/minimums
-   Production
    catalogue/images/prices/preparations/weights/cleaning-loss values
-   First ADMIN/OWNER Auth bootstrap and recovery procedure
-   Backup/recovery and rollback procedure
-   GST/tax/invoice requirements
-   Legal/privacy/terms content

## 20. Codex Maintenance Rules

When Codex works on this project:

1.  Read `PRD.md` and `TRD.md` before a phase that changes product
    behavior or architecture.
2.  Treat approved business rules in `PRD.md` as authoritative.
3.  Treat approved architecture/security rules in `TRD.md` as
    authoritative.
4.  Do not silently weaken security to make implementation easier.
5.  Do not invent business rules where these documents explicitly leave
    a decision open.
6.  If implementation requires a material product/architecture change,
    stop and identify the conflict before changing the documents.
7.  After an approved material change, update the relevant document and
    its Change Log in the same development phase.
8.  Keep implementation, migrations, tests and documentation
    synchronized.
9.  Never write secrets, access tokens, service-role keys, database
    passwords or payment credentials into these Markdown files.
10. Do not treat a TODO or future feature as approved production scope
    unless the PRD says so.

## 21. Change Log

  -----------------------------------------------------------------------
  Version           Date              Change            Approved By
  ----------------- ----------------- ----------------- -----------------
  1.0               2026-09           Initial formal    Project Owner
                                      TRD based on
                                      approved TRAIT
                                      architecture

  -----------------------------------------------------------------------

### Approved access-model implementation (2026-09-26)

- Common /admin login uses Supabase Auth password sign-in; the server validates
  the returned access token with Auth and resolves active membership through
  api.staff_context. Browser-supplied roles and Auth user metadata are ignored.
- Access token is held in an HttpOnly, SameSite=Strict, production Secure cookie
  scoped to /admin. Sessions expire after at most one hour and require sign-in
  again; no refresh token is persisted. Auth rate limits remain in force.
- The staff feature is explicitly disabled until TRAIT_STAFF_ENABLED=true,
  SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are configured after migration review.
  No service-role key is used. Expose only api to the Data API; keep app private.
- Each server mutation revalidates Auth, active profile and section permission.
  Each SQL RPC independently derives its actor with auth.uid() from the verified
  PostgREST JWT. No actor or business identity is trusted from form data.
- New 20260926000000_staff_access.sql is forward-only and unapplied. It adds the
  ADMIN grant, catalogue/offerings, immutable price and access-audit tables,
  and narrow role-checked RPCs. All tables force RLS with no direct browser DML.
- OWNER daily mutation accepts offering ID, expected version, price and boolean
  availability only. Row lock and version check prevent lost updates. Price
  history and audit append atomically; invalid/foreign/retired offerings fail.
- Catalogue master create/edit/retirement and store-offering creation are ADMIN
  only. Logical retirement preserves historical references. Product image
  changes currently select local asset paths; secure uploads remain future work.
- This incremental catalogue uses validated per-product JSON arrays for allowed
  weights/preparations/optional cleaning loss, and an image asset path. The
  normalized preparation, weight and image tables above remain the target for
  the later catalogue/storage phase; they are not silently assumed to exist.
- OWNER employee management currently enables/disables existing EMPLOYEE
  profiles only, excluding ADMIN elevations. Auth invitation/recovery and store
  assignment workflows are not implemented by this phase. The foundation's
  conservative active-OWNER removal guard remains intact.
- Normal store name, opening hours, delivery and pickup settings are exposed by
  a narrow scoped RPC. Platform/security/payment credentials are never owner fields.
- Orders, payments and reports retain their approved role visibility, but live
  execution awaits those backend phases. UTR/browser success cannot settle a payment.
- Static storefront fixtures remain separate from this database-backed workspace;
  production catalogue/checkout integration is a later phase.
- Local security validation uses disposable in-memory PostgreSQL and synthetic
  identities only. Hosted project igiujohtycixboaohjby is not contacted or mutated.

Approved change log entry (2026-09-26, ReadPrompt.txt): ADMIN > OWNER > EMPLOYEE,
ADMIN-only catalogue masters, narrow daily OWNER price/availability, secure common
login, explicit server/RPC checks, immutable history, new forward migration only.

### Phase 5B.2 catalogue extension (2026-09-26)

The new forward migration adds app.product_images, app.preparation_options,
app.product_preparation_options and app.product_allowed_weights. Existing product
JSON configuration inputs remain compatible: a private synchronization trigger
upserts normalized rows and retires removed choices while preserving their IDs.
Reusable preparation renames refresh the legacy input cache under product locks.
The public api.catalogue projection reads normalized active choices, images,
current effective integer-paise price, category ancestry, store availability,
featured/display overrides and optional per-preparation cleaning loss. Pricing
basis is explicitly RAW_WEIGHT; allowed weights are positive integer grams.
No Auth or Storage objects are changed; image records contain validated references
only. Upload decoding/type verification still belongs to a later storage workflow.
All fifteen app tables force RLS. Direct DML remains denied, and only the safe
catalogue projection is executable by anon; staff mutations repeat active-profile,
role and business checks. The original ADMIN elevation and immutable price/audit
history remain in use. No orders, payments or customers are introduced.

Change log: approved Phase 5B.2 catalogue backend, compatibility conversion,
ADMIN-only configuration RPCs, public projection, OWNER boundary preserved.

### Phase 5B.3 customers and delivery (2026-09-26)

A new forward-only migration adds private app.customers, app.customer_addresses and app.delivery_areas. Customer UUIDs and composite business/customer/store keys preserve tenant integrity; normalized +91 contact numbers are not unique account identifiers. Optional Auth linkage and mobile verification metadata are paired, but no linking or self-service endpoint is exposed. Existing Auth/Storage objects are unchanged.

All three tables force RLS with no direct client/service-role privileges. Narrow ADMIN/OWNER delivery RPCs enforce store scope, row-lock/version concurrency and immutable audit. A public fulfillment_options projection exposes store/pincode configuration only. Private phone normalization and guest fulfillment validation require mobile for both delivery and pickup, name/address for Home Delivery, and configured minimums against a trusted subtotal. The future order transaction must lock/recheck configuration and preserve snapshots; this phase does not implement checkout placement, customer login, saved-address access, order history or payments. Existing store flags remain in use; no real fees/pincodes/customers are seeded.

### Core orders, payments and audit backend (ReadPrompt.txt run, 2026-09-26)

A new forward-only migration adds twelve private tables (orders/items/fulfillment/status/tokens/requests, provider accounts/payments/refunds/allocations/events, audit_logs), an order-number sequence and an additive tenant-safe price-history key. All thirty app tables force RLS and deny direct client/service/capability-role access. Existing functions and prior migration files remain unchanged; a new trigger mirrors future existing staff-access audit events into unified audit.

NOLOGIN trait_checkout and trait_payment_verifier roles expose only quote/place or provider binding/verified-event RPCs respectively; no runtime memberships or credentials are provisioned. Checkout locks relevant catalogue/store configuration, calculates raw-weight integer-paise totals, checks a reviewed quote digest, and atomically creates snapshots and pending payment under a unique row-locked request key. A server utility generates 256-bit random tracking tokens; only SHA-256 digests reach the database. Staff RPCs repeat active business/store authorization and configured employee visibility/cash policy. Payment/refund mutations serialize on order/payment/refund locks; bounded allocation reservations and event/request digests prevent over-refunds and conflicting replay. UTR/browser success cannot settle online payment. Real provider proof must be verified by a future isolated adapter before invoking its restricted capability.

Production integration still requires protected/rate-limited server routes, runtime connection provisioning, business_settings and actual commerce data, merchant configuration/provider adapter, secure envelope/token handling, staging multi-connection tests and approved operational/retention/refund policies. PGlite validates local behaviors and rollback; it does not simulate independent concurrent database sessions.
