-- Chicken catalogue photos (2026-11-26). Sources and licences: config/catalogue-image-sources.json.
-- Run once in the Supabase SQL editor after the deploy that adds public/assets/catalogue/chicken-*.webp. Safe to re-run.
-- Products are matched by name. Their existing photos are hidden (is_active=false, nothing deleted),
-- and the listed photo becomes the main photo. Liver, Keema and Leg Boneless are illustrations until real shop photos exist.
begin;
create temp table chicken_photos(name text, asset text) on commit drop;
insert into chicken_photos values
 ('Chicken Premium Regular Curry Cut','/assets/catalogue/chicken-curry-cut.webp'),
 ('Chicken Premium Biriyani Cut','/assets/catalogue/chicken-curry-cut.webp'),
 ('Chicken Chest Boneless','/assets/catalogue/chicken-breast-boneless.webp'),
 ('Chicken Chest Fillet','/assets/catalogue/chicken-breast-boneless.webp'),
 ('Chicken Leg Boneless','/assets/catalogue/chicken-leg-boneless.webp'),
 ('Chicken Keema / Mince','/assets/catalogue/chicken-keema.webp'),
 ('Chicken Lollipop','/assets/catalogue/chicken-lollipop.webp'),
 ('Chicken Wings','/assets/catalogue/chicken-wings.webp'),
 ('Chicken Liver','/assets/catalogue/chicken-liver.webp'),
 ('Chicken Drumsticks','/assets/catalogue/chicken-drumsticks.webp'),
 ('Chicken Full Legs','/assets/catalogue/chicken-full-legs.webp'),
 ('Farm Country Chicken','/assets/catalogue/chicken-whole.webp'),
 ('Original Country Chicken','/assets/catalogue/chicken-whole.webp'),
 ('Smoked Chicken','/assets/catalogue/chicken-smoked.webp'),
 ('Marinated Chicken','/assets/catalogue/chicken-marinated.webp');
create temp table picks on commit drop as
select p.id product_id, p.business_id, p.name, c.asset
from app.products p join chicken_photos c on lower(trim(p.name))=lower(c.name)
where p.business_id='645494dc-959f-4048-a3c8-1db863ed3ba1';
select p.id from app.products p where p.id in (select product_id from picks) for update;
update app.product_images i set is_primary=false, is_active=false
 where i.product_id in (select product_id from picks) and i.is_active
 and not exists (select 1 from picks s where s.product_id=i.product_id and s.asset=i.asset_path);
update app.product_images i set is_primary=true, is_active=true, sort_order=0
 from picks s where i.product_id=s.product_id and i.asset_path=s.asset;
insert into app.product_images(business_id,product_id,asset_path,alt_text,is_primary,is_active,sort_order)
select s.business_id, s.product_id, s.asset, s.name, true, true, 0 from picks s
where not exists (select 1 from app.product_images i where i.product_id=s.product_id and i.asset_path=s.asset);
-- report: every listed name, and whether a product was found for it
select c.name, s.product_id is not null as found, s.asset from chicken_photos c left join picks s on lower(c.name)=lower(s.name) order by c.name;
commit;
