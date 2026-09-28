# Stitch frontend integration

## References discovered

The requested `D:/Projects/trait-stitch-export` directory did not exist. Three supplied ZIPs were found in the real project and extracted into `reference/stitch/`:

| Export | Screen | Result |
| --- | --- | --- |
| stitch_trait_meat_hub_storefront.zip | Homepage | Integrated |
| stitch_trait_meat_hub_storefront (1).zip | Cart | Integrated |
| stitch_trait_meat_hub_storefront (2).zip | Checkout | Integrated |
| No export supplied | Confirmation / Tracking | Existing functionality retained and shared visual system applied |
| No export supplied | Admin Dashboard | Skipped; no authentication or authorization changes |

Both exported screenshots and HTML were inspected. PRD/TRD rules take precedence over unsupported sample content.

## Frontend changes

- `src/app/globals.css`: responsive crimson/charcoal/pale-surface design, cards, cart rows, checkout panels, mobile navigation, product dialog and receipt/tracking styling.
- `src/app/layout.tsx`: locally hosted Oswald and Plus Jakarta Sans with Next.js font optimization.
- `src/app/page.tsx`, `src/app/search/page.tsx`: reusable catalogue filtering and search presentation.
- `src/components/layout/header.tsx`, `footer.tsx`, new `category-navigation.tsx`: shared brand shell and category navigation, official logo retained.
- `src/components/home/hero.tsx`, `category-section.tsx`, `trust-section.tsx`: reference hero composition, category tiles and requirement-supported informational panels.
- New `src/components/product/catalog-browser.tsx`; `catalog-page.tsx`, `product-card.tsx`: prominent All/Fish/Chicken/Mutton controls, Fish/Seafood grouping and product imagery.
- `src/components/cart/cart-content.tsx`, `cart-link.tsx`: responsive cart rows and calculated header subtotal.
- `src/components/checkout/checkout-content.tsx`, `order-summary.tsx`: delivery/details/payment panels and illustrated summary without changing calculation or validation handlers.
- `src/data/catalog.ts`: image paths/alt text only; product prices, available weights, preparations and cleaning-loss configuration unchanged.
- `tests/stitch-browser.mjs`, `package.json`: responsive/browser verification command.
- `tests/cart-browser.mjs`: expected accent updated to DESIGN.md crimson.
- `tests/checkout-browser.mjs`: await the existing requestAnimationFrame focus update before asserting review focus.
- `README.md`: current assets, workflow and validation instructions.

## Assets

Ten supplied food image sources were downloaded under `public/assets/stitch/`, with provenance in `reference/stitch/assets.json`. Nine are used; the mutton category source with embedded webpage text is intentionally unused. Existing illustrated placeholders remain for Pomfret, Sardines and Mutton Chops where appropriate specific photography was not supplied. Eight local font files and their OFL licenses are under `public/fonts/`. No logo recreation, temporary hotlinks, dependencies or payment-provider artwork was introduced.

## Preserved behavior

Cart/order modules and types are unchanged. Automated coverage verifies raw-weight pricing, product-specific loss estimates, preparation/weight choices, duplicate rejection, persistence/reload, cart edit/remove/clear, Indian mobile and address validation, delivery/pickup calculations, payment preferences, mock placement, random tracking links, receipt lookup and status previews. Browser totals remain local display-only values; this is not a live order/payment backend.

## Validation

- `npm.cmd test`: 27/27 passing.
- `npm.cmd run typecheck`: passing.
- `npm.cmd run lint`: passing, no warnings.
- `npm.cmd run build`: passing; all existing routes built.
- `npm.cmd run test:cart-browser`: passing, including duplicate add/edit/restore, configured cleaning visibility, keyboard modal behavior and all five cart widths.
- `npm.cmd run test:checkout-browser`: passing, including delivery/pickup, cash/UPI preference, validation focus, single placement, receipt reload, token mismatch, all statuses and blocked/corrupt storage.
- `npm.cmd run test:stitch-browser`: passing; checks 320/390/768/1024/1440px for all integrated screens plus receipt/tracking, filters/search, image/font loads, viewport overflow, clipped form controls and 44px primary touch targets. Screenshots: `.next/stitch-validation/`.

## Remaining scope

No Admin or Confirmation/Tracking export was available for a page-specific Stitch match. Admin was not created. Live server checkout, Supabase Auth with OWNER/EMPLOYEE authorization, payments and production business data remain the planned later backend/launch work. No Supabase, database, RLS, migrations, MCP or Git configuration was changed. Nothing committed or pushed.
