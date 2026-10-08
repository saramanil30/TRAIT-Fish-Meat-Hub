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

## Minimum order, maximum discount and banner images

Added in `20261009000000_offer_conditions_images.sql` (run it once in the SQL editor).

- **Discount type**: "Percent (%)" (stored in basis points) or "Flat amount (₹)" (whole rupees, stored in paise). The server converts rupees to paise.
- **Minimum order (₹)**: optional. The coupon applies only when the offer's *eligible* items reach it. Below it, the cart and checkout show "Add ₹X more to use CODE"; coupon rows show "On orders above ₹999".
- **Maximum discount (₹)**: optional, percent offers only. Flat discounts never exceed the eligible amount. Everything rounds to whole rupees (`app.offer_discount`, mirrored in `src/lib/cart-offer.ts`).
- **Banner image**: optional. The browser converts it to WebP; the server checks the WebP signature and the 1 MB limit, then uploads with the staff session to `offer-images/{business}/{sha256}.webp`. The `offer-images` bucket is public-read and WebP-only (1 MB); the insert policy allows only active ADMIN/OWNER staff, under their own business folder. `api.save_offer` also checks the path belongs to the caller's business and the object exists.
- **Dates**: a date with no time starts at 00:00 IST and ends at 23:59 IST.
- **Homepage band**: one slide per active offer (image left, details right; image above on phones; centred text without an image). It shares one 5-second clock with the header strip, so both show the same offer; hovering, touching or focusing either pauses both.
