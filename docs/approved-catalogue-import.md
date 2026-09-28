# Approved catalogue import status

The 23 user-approved products and exact prices are preserved in config/approved-catalogue.json. This is an import manifest, not storefront seed data. It does not silently substitute kilogram prices for trays or net weight. The five requested cuts remain an applicability list; no unsupported cleaning-loss percentages were invented.

Read-only hosted inspection on 2026-09-28 found zero businesses, stores, products, staff profiles and Storage buckets in project igiujohtycixboaohjby. The existing public catalogue requires an active business/store and configured product offerings. Import and storefront visibility therefore require confirmation of the project plus approved initial store details. No rows or schema were changed.

The current catalogue, cart and checkout price exclusively by raw grams. Eggs require a 30-egg tray at INR 450; King Fish requires INR 800 for 500 grams NET. These are retained as TRAY and NET_WEIGHT in the manifest and held for a decision on additive pricing support. They must never be imported as raw-weight products or simulated using fictional gram weights.

Existing ADMIN-only catalogue/image RPC authorization, ADMIN/OWNER price/availability authorization and EMPLOYEE mutation denial remain unchanged. Old migrations and RLS were not edited.

Storage management access was verified successfully using the existing account credential in memory; no key was printed or persisted. Product object paths require real business/product UUIDs. No orphan objects or bucket were created while the target project is awaiting confirmation.

One visually inspected Rohu photograph is prepared as 800x800 WebP, 115440 bytes. Source identity and CC0 public-domain dedication are recorded in config/catalogue-image-sources.json. Remaining image research, optimization and product mapping are unfinished. Images must be species-correct and have verified commercial reuse rights; no generic fish substitutions are approved.

Next steps after the pending answers: provision the approved business/store if this is the intended project; implement approved pricing support or hold the two unsupported products; complete verified imagery; import through scoped/audited operations; configure TRAIT_STORE_ID; validate the public catalogue and affected checkout/role paths.
