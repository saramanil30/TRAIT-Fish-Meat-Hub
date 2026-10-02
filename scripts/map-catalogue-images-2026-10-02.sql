-- Map the six verified catalogue photos added on 2026-10-02 (see config/catalogue-image-sources.json).
-- Run once in the Supabase SQL editor after the assets are deployed. Only touches these products, and only
-- while they still have no image, so it is safe to re-run.
begin;
with picks(product_id, asset) as (values
 ('b6a9fbbf-ee2b-4cca-ad1e-91615db11956'::uuid, '/assets/catalogue/murrel-korrameenu.webp'),
 ('7722b11d-b212-48f3-825d-51d3166166ed'::uuid, '/assets/catalogue/bommidayalu.webp'),
 ('180c09f3-c0a4-48cc-b466-9ab33eb44624'::uuid, '/assets/catalogue/roopchand.webp'),
 ('1eeaaf1d-e676-4183-91d1-14bb862bc8ad'::uuid, '/assets/catalogue/anchovies-nettali.webp'),
 ('00117894-456a-4eff-81af-118f18c0e524'::uuid, '/assets/catalogue/red-snapper.webp'),
 ('13da957b-38fe-45a7-9c95-b9004cdd94a3'::uuid, '/assets/catalogue/apollo-basa-boneless.webp'))
insert into app.product_images(business_id, product_id, asset_path, alt_text, is_primary, is_active, sort_order)
select p.business_id, p.id, picks.asset, p.name, true, true, 0
from picks join app.products p on p.id = picks.product_id
where not exists (select 1 from app.product_images i where i.product_id = p.id)
returning product_id, asset_path, alt_text;
commit;
