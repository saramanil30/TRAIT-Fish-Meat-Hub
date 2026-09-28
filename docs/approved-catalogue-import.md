# Approved catalogue handoff — 2026-09-29

## Completed and verified

- Existing 23 products preserved without re-import. Completed migrations were not edited or reapplied to the hosted database.
- Provisioned Auth UUID fa03cd88-cbbe-4a63-86ee-5a8119dfa5e7 with display name saramanil as business-scoped ADMIN in business 645494dc-959f-4048-a3c8-1db863ed3ba1. Staff profile: a8008558-abb8-4375-9090-1229defd720d. The active OWNER base profile plus private ADMIN grant follows the existing role model. Bootstrap was audited. No store or assignment was invented.
- Verified the hosted authenticated database context returns saramanil / ADMIN and all 23 catalogue products. Verified api.save_product_image using the existing Rohu mapping in a transaction that was rolled back. This proves database permissions; interactive password login was not exercised.
- Eight verified local image mappings are preserved: Rohu Big, White Pomfret, King Fish / Vanjaram, Blue Crab, Indian Salmon, Seabass / Pandugappa, Pink Perch / Senkara and Lady Fish. Provenance and product IDs remain in config/catalogue-image-sources.json. The earlier mapping operations were audited as OPERATOR_VERIFIED_IMAGE.
- Public catalogue verification confirms all 23 exact approved prices and units, including INR 450 per 30-egg tray and INR 800 per 500 g NET King Fish. All products remain non-orderable until store offerings are configured. Eight mapped assets decode as 800x800 WebP. Reproduce with node scripts/verify-approved-catalogue.mjs; it only reads hosted data and local assets.
- Final affected validation passed: 25 cart/ADMIN/checkout application tests; tests/sale-units-db.mjs covering exact units, server pricing, immutable order snapshots, role boundaries and RLS; 26 catalogue database validation groups; typecheck; lint; production build; hosted catalogue/image checks. Local database fixtures are isolated and do not re-import hosted products.

## Pending by explicit instruction

- Store: code, display name, street address, optional address line 2/locality, city, state, pincode, contact mobile, timezone, opening hours, pickup/delivery enablement.
- Offerings: which existing products the store sells, availability, and confirmation that approved reference prices apply as store selling prices (or exact replacements). Any store-specific quantity/cut restrictions require explicit values. No cleaning-loss estimates were invented.
- Delivery, if enabled: served pincodes, area names, delivery fees, minimum order values and active states.
- Business settings: employee operational-history days (1–365), employee cash-collection limit or explicit prohibition, payment-before-completion requirement, maximum order items (1–500), maximum order total.
- Fifteen images: Free Range Brown Eggs, Sea Prawns Big, Bombay Duck, Red Snapper, Anchovies / Nettali, White Snapper, Big Anchovies, Roopchand, Prawns Above Medium, Murrel / Korrameenu, Apollo/Basa Boneless, Bommidayalu, Gold Fish / Bangaaru Teega, Aar Fish and Pabda. Existing Bombay Duck and Pabda candidate files remain unmapped pending species confirmation; the former source includes an identification caveat and the latter depicts Ompok bimaculatus.
- Supabase Storage upload remains pending: the existing management credential returned HTTP 401 before creating any bucket/object. Eight images currently use local assets. Refresh the Storage-capable credential in the environment when uploads resume. scripts/resume-verified-images.mjs is syntax-checked, but its remote upload procedure remains unvalidated because of that credential blocker.
- Real interactive ADMIN login and full store checkout acceptance remain pending. No store/settings/offering records exist. The database now contains one business, one ADMIN staff profile/grant, 23 products and eight active image mappings.

Do not replay scripts/initial-store-data.mjs: it attempts to create the already-existing business. Use the existing business when approved store data is supplied. Do not re-import the products. This handoff is included with the validated work for staging/final-part-2; the final chat records the resulting commit and push status.

Final browser checks passed: cart flows at 320/390/768/1024/1440px and drawer sizes; storefront/checkout/tracking/protected routes at 390/768/1440px, including fail-closed missing-backend behavior. These use isolated fixtures and do not place hosted orders.
