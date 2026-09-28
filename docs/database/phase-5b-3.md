# Phase 5B.3 — Customers & Delivery

Migration: `20260926140000_phase_5b_3_customers_delivery.sql`.
Target: TRAIT Supabase project `igiujohtycixboaohjby`.

## Model

- `app.customers`: UUID identity scoped to a business; canonical +91 Indian mobile;
  optional Auth link paired with a verification timestamp. Contact numbers are
  nonunique and never authorize access. Linking is reserved for a future trusted
  verification workflow. No login, customer creation, phone lookup or self-service
  RPC is implemented.
- `app.customer_addresses`: structured Indian address, recipient name/mobile,
  lifecycle metadata and composite business/customer FK. Addresses are reusable
  across stores, but each future checkout must revalidate the selected store.
  Customer ownership cannot be reassigned.
- `app.delivery_areas`: one explicit whole-pincode rule per store, required
  integer-paise fee/minimum, active state and revision. No real rules or fees
  are seeded. Store/pincode identity is immutable; deactivate obsolete rules.
- Existing store delivery/pickup flags remain authoritative. Home Delivery
  requires an active business, store and matching active pincode rule. Pickup
  requires the store pickup flag and does not require a delivery address.

## Capabilities

- `api.delivery_areas` and `api.save_delivery_area`: ADMIN/OWNER only,
  scoped through active membership and the selected store. Updates use a row lock
  and expected revision. Audit appends atomically to existing immutable history.
  EMPLOYEE has no delivery-configuration authority.
- `api.fulfillment_options`: safe public, read-only configuration projection,
  taking only store/pincode. No customer data, phone input or customer lookup.
  This is advisory configuration, not a binding quote.
- `app.normalize_indian_mobile`: private normalization accepting national
  10-digit, leading 0, 91 or +91 forms with spaces, parentheses and hyphens.
  Formatting checks do not prove number allocation, reachability or ownership.
- `app.validate_guest_fulfillment`: private future checkout helper.
  Requires mobile for both methods, name/address for Home Delivery, validates
  configured minimum against a trusted subtotal, and returns normalized contact
  and configuration data without customer creation or linking.
  Future order placement MUST calculate subtotal server-side, lock/recheck
  store/area configuration in its transaction, and persist fulfillment snapshots.
  No orders, payments, customer-facing routes or checkout integration are added.

## Security and validation

All three new tables enable and force RLS, with no policies and no direct
anon/authenticated/service-role access. Private helpers have no client EXECUTE.
Only the safe public projection is anonymous; staff RPCs repeat authorization.
No customer or saved-address endpoint exists, including for staff. Future account
access must derive verified Auth identity and active business/customer scope;
neither a phone string, supplied customer UUID nor editable metadata is proof.

Previous migration SQL fingerprints match hosted migration records. Read-only
schema comparison covers columns/nullability, constraints, indexes, triggers,
function definitions/ACLs, table ownership/RLS/ACLs and policies. Local PGlite
reports extra NOT NULL constraint catalogue rows; the corresponding NOT NULL
column flags match the hosted PostgreSQL 17.6 database exactly.

Run `node supabase/validation/check-phase-5b-3.mjs`.
The script uses disposable in-memory PostgreSQL and synthetic identities only.
It verifies prior migration fingerprints and runs 15 behavioral/security groups.
Generated baseline/expected JSON files contain schema metadata only, no real PII.

Deployment status: deployed successfully as 20260926174742 on 2026-09-26. Read-only verification found an exact SQL match (MD5 2675ac36595a07550e14747730547730), no schema differences, 18 tables with forced RLS, zero unsafe direct table grants, and zero customers/addresses/delivery-area rows. Previous migrations were neither changed nor rerun. No Auth users, Storage changes, orders, payments, commits or pushes were made.
