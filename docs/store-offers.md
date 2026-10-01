# Store offers

Implemented in `20260929000000_store_offers.sql` and applied to the connected Supabase project on 2026-09-29.

## Staff workflow

Open **Offers** in the OWNER or ADMIN workspace and select an existing store. Create or edit a title/message, percentage or fixed rupee discount, UTC start/end time, whole-store/product/category scope, and active status. Category offers include descendants. EMPLOYEE can view only current offers for assigned stores; the database and Server Action reject employee mutations.

Offers require a configured store. The connected project currently has no store and no offers; no store details or promotions were invented. Set the existing application's `TRAIT_STORE_ID` after the actual store is configured. The homepage pane is omitted when there are no current offers and appears immediately before the hero section otherwise.

## Pricing rules

- The database applies the single eligible offer giving the largest merchandise discount; offers do not stack. UUID order breaks equal-discount ties consistently.
- Percentage values use basis points and discounts round down to whole paise. Fixed discounts apply once per order and cannot exceed eligible merchandise.
- Existing positive-payment constraints remain intact: merchandise payable is at least one paise. This cap is disclosed in both the storefront and staff form, including for 100% offers.
- Delivery fees are excluded. Delivery minimum eligibility continues to use the pre-discount merchandise subtotal.
- Eligibility uses server time: start inclusive, end exclusive. Checkout checks current product availability and selling prices before computing the offer.
- Quote digests include the chosen offer ID, version, discount and resulting total. Placement recomputes them; edited, expired or deactivated offers require a fresh review when the accepted quote changes.
- Order snapshots preserve the applied offer and discount. Payment amounts use the final order total. Existing idempotent retries return the same committed order even after an offer changes.
- Checkout review, order confirmation/tracking and staff order detail show the discount and final total. Line prices remain pre-discount; order-level totals are net of discounts.

## Security and validation

Offers use the existing business/store staff authorization, audit log and RPC-only database access. The table has forced RLS and no direct client-role privileges. Public RPC access returns only active, current offers for active stores/businesses. No client-supplied offer, discount or total is accepted by checkout.

Validation: `npm test`, `npm run test:offers-db`, `node tests/sale-units-db.mjs`, typecheck, production build, and checkout/staff browser checks. Database tests cover management roles, tenant isolation, expiry, stale versions/quotes, product/category scope, integer rounding, capped fixed discounts, unchanged delivery fees/minimum checks, payment amounts, immutable snapshots and retry behavior. Browser tests use isolated fixtures and do not create live orders or offers.

Hosted verification: 23 catalogue products preserved; before/after row fingerprint `e3baa9fcbf569db2718944a887a4de95`. Offers table is empty, forced RLS is enabled, and direct table access is denied to anon/authenticated/service_role/checkout/payment-verifier roles. Frontend publishing was not performed.
