# Core backend — Orders, tracking, payments, refunds and audit

Migration: `20260926200000_core_orders_payments_audit.sql`.
Target: TRAIT `igiujohtycixboaohjby`.
Status: deployed successfully as 20260926181526 on 2026-09-26. Read-only verification found an exact SQL match (MD5 82ba1e0002f2130bf80017e313233c3e), zero schema differences, all 30 app tables with forced RLS, and zero unsafe direct table grants. Both capability roles remain NOLOGIN with only automatic postgres administrative membership (INHERIT/SET false). Orders, payments, refunds, customers and provider accounts remain empty.

## Objects and security

Adds 12 private tables: orders, order_items, order_item_fulfillment,
order_status_history, order_access_tokens, order_requests,
payment_provider_accounts, payments, payment_refunds, refund_allocations,
payment_events and audit_logs. Adds an order-number sequence and an additive
tenant key on existing immutable product_prices. Historical migrations and
existing functions remain unchanged. All 30 app tables force RLS with no policies.
Browser, service and new capability roles have no direct table/sequence access.

Every definer RPC has an empty search_path, explicit EXECUTE grants, qualified
application objects and business/store checks where staff identity is used.
ADMIN > OWNER > EMPLOYEE remains unchanged. Employees require active assignments
and the configured operational history window. Nonstaff gets no staff capability.

Two NOLOGIN capability groups are deliberately not provisioned to any runtime:
trait_checkout (quote/place only) and trait_payment_verifier (provider binding and
verified event recording only). They have no BYPASSRLS, superuser, database or
role-creation authority. Supabase's nonsuperuser postgres receives only the
automatic administrative membership (no INHERIT/SET); this is accounted for in
the deployment assertions. See [PostgreSQL role attributes](https://www.postgresql.org/docs/17/role-attributes.html).
No credentials, Auth users, authenticator memberships or service-role grants
are created.

## Orders and tracking

The trusted server calls checkout_quote with store and choices. Payloads contain
only items (productId, preparationId, rawWeightGrams, instructions), method, mobile,
name, address and paymentMethod. Prices/totals/fees from clients are rejected.
Raw-weight totals use integer paise and numeric rounding. Product, preparation,
allowed weight, current price, availability, active category ancestry and delivery
configuration are revalidated. Cart identity uses UUIDs, integer grams and
NFC-normalized/trimmed instructions. Distinct variants remain valid.

The quote digest covers current purchase/configuration data. Any quote change
requires review. place_order repeats the calculation under transaction-held
locks and requires the accepted digest. Business-wide catalogue read locks use
deterministic order for the current single-store/MVP scale; revisit lock breadth
under production load. Mutable catalogue writers take incompatible row locks.
Price provenance also checks the product, store, tenant and unit price.

Creation atomically writes the request claim, order, immutable item and
fulfillment snapshots, PLACED history, PENDING payment, payment event, token digest
and audit. A unique request key plus row lock protects retries. Changed request
content cannot reuse the key. Late failures roll back all writes. Sequence gaps
after rollback are expected and have no authorization meaning.

Use the Node-only supabase/runtime/checkout-envelope.mjs utility to create a
random UUID request key and a 32-byte random hex tracking token. Keep the envelope
stable and protected across retries. Pass its SHA-256 digest to place_order;
never put the raw token into database rows, logs or audit. Expiry is explicit
policy supplied by the trusted server. Tracking exposes only order number,
fulfillment/status/payment status and transition timestamps. No name, phone,
address, internal order UUID or staff identity is returned. Invalid, expired and
revoked tokens return the same null result. Receipt access is not implemented
and must use a separate scope/token in a later phase.

Staff queue/detail RPCs enforce scope. Status changes use expected order versions.
Home Delivery follows PLACED -> CONFIRMED -> PREPARING -> READY ->
OUT_FOR_DELIVERY -> DELIVERED. Store Pickup completes directly from READY.
Only ADMIN/OWNER may cancel a nonterminal order with a reason; no automatic refund
or customer cancellation policy is invented. Configured payment-before-completion
is enforced. Actual fulfilled weight is append-only and cannot reprice an order.

## Payments and refunds

One initial payment attempt is created per order, with schema support for attempt
numbering. No retry-attempt creation API is enabled yet, preventing accidental
double collection until provider retry/reconciliation policy is reviewed.

CASH starts pending. Staff must explicitly record full receipt; employees require
a configured sufficient cash limit. Online/UPI references create VERIFYING evidence
only. Even ADMIN/OWNER cannot call the provider settlement functions.

The future isolated provider adapter must verify signatures/server lookup and
merchant identity before invoking the verifier capability. A configured active
merchant allowlist, bound provider payment reference, exact amount and INR currency
must match. Provider event identity plus payload digest reject conflicting replay.
Failure events cannot reverse settled funds. No gateway is integrated and no
merchant account is seeded, so online completion is not operational yet.

ADMIN/OWNER requests a refund with expected payment version, idempotency key,
reason and allocations to purchased items and/or delivery fee. Pending and
completed allocations reserve capacity under a payment lock; over-refunding and
cross-order allocations are rejected. Requests do not themselves move funds.
Cash completion is an explicit ADMIN/OWNER acknowledgement. Online completion
requires the isolated verifier and matching provider refund identity/amount.
Partial refunds retain PAID plus refunded_paise; full refunds become REFUNDED.
FAILED refunds release reservations; retry requires a new approved refund request.
Conflicting terminal provider results fail closed and require reconciliation.

All payment/refund mutations lock order, then payment, then refund. This
serializes settlement/refunds against completion and cancellation. Staff financial
history is ADMIN/OWNER only. UTR evidence is stored in protected payment events,
not copied to the general audit log.

## Audit

Append-only status, fulfillment, payment, refund-allocation and general audit
records preserve actors/timestamps and financial snapshots. Existing price,
availability, catalogue, delivery and relevant staff/settings RPCs continue using
their original audit table; a new AFTER INSERT trigger also writes future changes
to the unified audit stream. Historical entries stay in the original immutable
table without fabricating historical roles or rewriting them. Audit context omits
contact/address snapshots and raw tracking tokens.

## Validation

- node supabase/validation/check-core-backend.mjs: 29 passing behavioral/security
  groups, including late-failure rollback, stale quote/version rejection, replay
  conflicts, normalized duplicate choices, store/tenant isolation, employee limits,
  provider verification boundaries, refund caps, revoked/expired tokens, snapshot
  immutability, safe public tracking, exact capability grants and token generation.
- node supabase/validation/check-core-hosted-role.mjs: passes under an equivalent
  nonsuperuser CREATEROLE/BYPASSRLS owner. PGlite reserves its bootstrap role, so
  this test substitutes the owner name only in memory; disk SQL is unchanged.
- Prior migration fingerprints match hosted records. Schema comparison covers
  columns/nullability, constraints, indexes, triggers, definitions/ACLs, ownership,
  forced RLS and policies. Extra local NOT NULL catalogue entries are normalized
  using the equivalent column flags.
- PGlite is a single-session engine. Real multi-connection concurrency/load tests
  remain a staging integration gate; local tests verify sequential replay,
  transaction rollback and stale versions, not production throughput.

## Required before production integration

Provision separate least-privilege server connections for checkout and provider
verification. Never put either capability credential in a client bundle. Add the
trusted Vercel routes with request size/schema checks, Origin/CSRF controls,
durable rate limiting, no-store responses, token redaction and secure retry-envelope
handling. No public checkout HTTP route is introduced in this backend phase.

Configure real store/catalogue/delivery rules and mandatory business_settings:
max items/total, employee visibility/cash limits and payment-completion policy.
The hosted project currently has no business_settings row, so checkout fails closed.
Select and configure the merchant provider, implement verified callbacks and
reconciliation, and approve cancellation/refund, tax/invoice, retention and token
expiry policies. Run staging end-to-end and multi-connection concurrency tests.
Saved accounts/history/addresses remain closed pending verified customer access.
