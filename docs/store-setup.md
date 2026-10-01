# Approved store setup — 2026-10-02

Migration `supabase/migrations/20261002000000_trait_store_setup.sql` turns the 23 imported products into an orderable store.

## What it creates

- Store `kokapet` — TRAIT Fish & Meat Hub, Pipeline Road, Kokapet, Hyderabad, Telangana 500075, +91 8686146562, Asia/Kolkata. Open 07:00–20:30 every day. Pickup and Home Delivery enabled. Fixed ID `111ac620-b8ea-485d-9cd3-07fb10b65fe7`.
- Delivery area 500075 (Kokapet): ₹40 fee, no minimum order.
- Business settings: employees see 30 days of operations, ₹5,000 employee cash limit per order, payment required before completion, maximum 20 items and ₹50,000 per order.
- One available store offering per published product, priced at its approved catalogue price in its existing unit (RAW_WEIGHT/kg, NET_WEIGHT/500 g, TRAY/30 eggs). The first price record is attributed to the business ADMIN profile; the setup is audited as `SYSTEM` / `APPROVED_STORE_SETUP`. Products themselves are not changed.

## Safety

- One transaction with an advisory lock; re-running changes nothing and never overwrites existing settings, prices or availability.
- Aborts and rolls back unless all 23 published products end up with a priced store offering.
- Skips with a notice when the TRAIT business has no active ADMIN, so fresh/test databases are unaffected.

## Applying to the hosted project

1. Supabase dashboard → SQL editor for the TRAIT project → paste the whole migration file → Run.
2. Only after it succeeds, set `TRAIT_STORE_ID=111ac620-b8ea-485d-9cd3-07fb10b65fe7` in `.env.local` and in Vercel (Preview and Production). Setting it earlier makes the storefront show no products.
3. Verify with `api.catalogue('111ac620-b8ea-485d-9cd3-07fb10b65fe7')`: 23 products, all `orderable`.

Applied through the SQL editor, the change is not recorded under version 20261002000000 in the hosted migration history.

Validated locally on PGlite: skip without ADMIN, idempotent re-run, 23 orderable products at approved prices (21 raw weight, 1 net weight, 1 tray), pickup quote ₹2,850 and Home Delivery quote ₹2,890 for Pomfret 1 kg + King Fish 500 g + 1 egg tray, delivery outside 500075 refused, and rollback when a product is missing.
