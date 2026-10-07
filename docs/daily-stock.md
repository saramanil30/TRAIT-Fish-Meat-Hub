# Daily stock

Migration: `supabase/migrations/20261008000000_daily_stock.sql`.

- **Where it lives:** `app.offering_stock` (one row per store offering; `on_hand` NULL or no row = unlimited) and `app.stock_movements` (append-only ledger of every SET, ORDER deduction and CANCEL_RESTORE). Both have RLS forced and no direct grants; access is only through the functions below.
- **Units:** grams for raw/NET weight products, packs (trays or units) otherwise. Admin enters kg; the action converts to grams.
- **Admin:** Prices & Availability (ADMIN/OWNER) saves price, availability and "Stock today" in one transaction through `api.save_daily_product`. Stock has its own version, so a save that would overwrite an order placed since the page loaded is rejected with "reload". Each set is also written to `app.audit_logs` as `STOCK_SET`.
- **Checkout:** `api.checkout_quote` fails early on short stock; `api.place_order` re-checks and deducts under `FOR UPDATE`, locking rows in offering-id order so concurrent orders serialise per product and cannot oversell or deadlock. The error names the product ("Not enough stock for …") and checkout shows it.
- **Cancel:** a trigger on `app.orders` restores deducted stock for any path that cancels an order. If the offering was switched to unlimited meanwhile, the restore is logged but not applied.
- **Storefront:** `api.catalogue` reports a product as sold out when tracked stock is below its smallest sellable quantity, and sends `stockLeft` only when stock is low (≤ 2 kg or ≤ 2 packs), so exact stock levels stay private.
- **Order details:** `api.order_detail` returns the order's stock movements; the admin order view shows them under "Stock impact".
- **Stock does not reset by itself.** Update "Stock today" each morning; blank means unlimited.

Test: `npm run test:stock-db` (PGlite, all migrations).
