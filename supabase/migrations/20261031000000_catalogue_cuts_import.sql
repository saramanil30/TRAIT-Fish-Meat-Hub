-- Owner's catalogue (docs/catalogue-cuts.md, Oct 2026). Forward-only; data only (no schema, grants or RLS change).
-- Fish/seafood: an existing active product matching by name keeps its name, price, category and offerings and gets
-- the listed cut options (old ones are deactivated by the sync trigger, so past orders keep their preparation).
-- Unmatched fish are created unpublished with no price, so they stay off the storefront until the owner prices them.
-- Mutton/chicken: one product per item, published at the listed price with an offering per active store; an existing
-- product of the same name is left untouched. Name match ignores case, punctuation and a plural "s", per "/"-part.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtextextended('trait-catalogue-cuts-20261031',0));

CREATE FUNCTION pg_temp.name_keys(n text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $fn$
 SELECT COALESCE(array_agg(DISTINCT k),'{}') FROM (
  SELECT regexp_replace(btrim(regexp_replace(lower(part),'[^a-z0-9]+',' ','g')),'s$','') k
  FROM unnest(array_append(string_to_array(n,'/'),n)) part) keys WHERE k<>''
$fn$;

DO $import$
DECLARE
 business uuid; admin uuid; item jsonb; ordinal bigint; cat uuid; product uuid; matches uuid[]; shop uuid; offering uuid;
 claimed uuid[]:='{}'; changed text[]:='{}'; unchanged text[]:='{}'; created_fish text[]:='{}'; created_meat text[]:='{}'; kept_meat text[]:='{}';
 offerings_created integer:=0;
BEGIN
 SELECT id INTO business FROM app.businesses WHERE slug='trait-fish-meat-hub' AND is_active AND deleted_at IS NULL FOR UPDATE;
 IF business IS NULL THEN RAISE NOTICE 'TRAIT business not found; catalogue import skipped'; RETURN; END IF;
 SELECT sp.id INTO admin FROM app.staff_profiles sp JOIN app.staff_admin_grants g ON g.staff_profile_id=sp.id AND g.is_active
 WHERE sp.business_id=business AND sp.is_active ORDER BY sp.created_at,sp.id LIMIT 1;
 -- Same lock order as the catalogue writers (products before preparation records).
 PERFORM 1 FROM app.products WHERE business_id=business ORDER BY id FOR UPDATE;

 INSERT INTO app.categories(business_id,name,sort_order)
 VALUES(business,'River Fish',1),(business,'Sea Fish',2),(business,'Prawns',3),(business,'Crabs & Lobsters',4),(business,'Chicken',5),(business,'Mutton',6)
 ON CONFLICT(business_id,name) DO NOTHING;

 -- "cuts" are the product's preparations, in display order; "aliases" are extra names an existing product may carry.
 FOR item,ordinal IN SELECT value,ordinality FROM jsonb_array_elements($json$[
 {"category":"River Fish","name":"Rohu / Rahu","aliases":["Rohu Big"],"cuts":["Round cut – with head","Round cut – without head","Bengali cut – with head","Bengali cut – without head","Skinless curry cut"]},
 {"category":"River Fish","name":"Catla / Boche","cuts":["Round fry cut – with head","Round fry cut – without head","Bengali cut – with head","Bengali cut – without head","Skinless curry cut"]},
 {"category":"River Fish","name":"Murrel / Korrameenu","cuts":["Round curry cut – with skin","Round curry cut – skinless","Round fry cut – with skin","Round fry cut – skinless","Fillet cut (boneless, skinless)"]},
 {"category":"River Fish","name":"Basa fish","aliases":["Apollo/Basa Boneless"],"cuts":["Curry cut","Skinless boneless fillet / medium pieces"]},
 {"category":"River Fish","name":"Tilapia","cuts":["Curry cut","Full fish fry cut","Boneless fillet"]},
 {"category":"River Fish","name":"Valugu / Boal fish","cuts":["Round cut","Bengali cut"]},
 {"category":"River Fish","name":"Aar fish","cuts":["Round cut","Bengali cut"]},
 {"category":"River Fish","name":"Tengra / Chinna Jallalu","cuts":["Cleaned"]},
 {"category":"River Fish","name":"Pabda","cuts":["Cleaned"]},
 {"category":"River Fish","name":"Seabass / Betki / Pandugappa","cuts":["Round cut","Bengali cut","Fillet","Skinless & boneless medium pieces"]},
 {"category":"River Fish","name":"Bommidayalu","cuts":["Cleaned"]},
 {"category":"River Fish","name":"Gold fish / Bangaru Teega","cuts":["Round cut","Bengali cut","Skinless curry cut"]},
 {"category":"Sea Fish","name":"White Pomfret","cuts":["Thin slices fry cut","Curry cut (medium slices)","Full fish fry cut with slits"]},
 {"category":"Sea Fish","name":"Black Pomfret","cuts":["Round fry cut","Curry cut (medium)"]},
 {"category":"Sea Fish","name":"King Fish / Vanjaram / Seer fish","cuts":["Round fry cut (thin slices)","Curry cut (cubes)"]},
 {"category":"Sea Fish","name":"Red Snapper","cuts":["Round curry cut","Bengali curry/fry cut","Fillet cut","Full fish for grill"]},
 {"category":"Sea Fish","name":"White Snapper","cuts":["Round cut","Bengali cut","Fillet cut"]},
 {"category":"Sea Fish","name":"Mackerel / Bangada","cuts":["Full fish fry cut – with head","Full fish fry cut – without head","Curry cut – with head","Curry cut – without head"]},
 {"category":"Sea Fish","name":"Sardines / Mathi","cuts":["Cleaned with head","Cleaned without head"]},
 {"category":"Sea Fish","name":"Anchovies","cuts":["Cleaned"]},
 {"category":"Sea Fish","name":"Bombay Duck","cuts":["Cleaned","Butterfly cut"]},
 {"category":"Sea Fish","name":"Lady Fish","cuts":["Full fish fry cut","Curry cut"]},
 {"category":"Sea Fish","name":"Indian Salmon / Maghalu","cuts":["Curry cut","Fry cut","Fillet cut","Boneless medium pieces"]},
 {"category":"Sea Fish","name":"Pink Perch / Senkara","cuts":["Curry cut","Fry cut – with head","Fry cut – without head"]},
 {"category":"Sea Fish","name":"Malabar Trevally / Para","cuts":["Curry cut","Fry cut","Skinless curry cut","Fillet cut"]},
 {"category":"Sea Fish","name":"Yellow Para","cuts":["Curry cut","Fry cut","Boneless fillet"]},
 {"category":"Sea Fish","name":"Mullet / Koingalu","cuts":["Curry cut (round pieces)"]},
 {"category":"Sea Fish","name":"Katta Perugulu / Parch Mach","cuts":["Cleaned with head","Cleaned without head"]},
 {"category":"Sea Fish","name":"Squids","cuts":["Cleaned & rings cut"]},
 {"category":"Sea Fish","name":"Mahi Mahi","cuts":["Boneless fillet","Curry cut"]},
 {"category":"Sea Fish","name":"Norway Salmon / Atlantic Salmon","cuts":["Fillet cut","Round fry cut","Boneless cubes"]},
 {"category":"Sea Fish","name":"Yellow Fin Tuna","cuts":["Curry cut","Fillet cut","Boneless cubes"]},
 {"category":"Sea Fish","name":"Skipjack Tuna","cuts":["Curry cut","Boneless cubes","Fillet"]},
 {"category":"Sea Fish","name":"Silver Belly Fish","cuts":["Curry cut","Fry cut"]},
 {"category":"Crabs & Lobsters","name":"Blue Crabs","cuts":["Cleaned"]},
 {"category":"Crabs & Lobsters","name":"Mud Crabs","cuts":["Cleaned"]},
 {"category":"Crabs & Lobsters","name":"Dotted Crabs","cuts":["Cleaned"]},
 {"category":"Prawns","name":"Prawns Medium","cuts":["Cleaned & deveined"]},
 {"category":"Prawns","name":"Prawns Small","cuts":["Deshelled"]},
 {"category":"Prawns","name":"Tiger Prawns Medium","cuts":["Cleaned & deveined"]},
 {"category":"Prawns","name":"Tiger Prawns River (Big)","cuts":["Cleaned & deveined"]},
 {"category":"Prawns","name":"Tiger Jumbo Prawns","cuts":["Cleaned & deveined"]},
 {"category":"Prawns","name":"Sea White Prawns","cuts":["Cleaned & deveined"]},
 {"category":"Prawns","name":"Red Shrimps Medium","cuts":["Cleaned & deveined"]},
 {"category":"Mutton","name":"Mutton Premium Curry Cut","pricePaise":110000},
 {"category":"Mutton","name":"Mutton Biriyani Cut","pricePaise":110000},
 {"category":"Mutton","name":"Mutton Boneless","pricePaise":150000},
 {"category":"Mutton","name":"Mutton Keema","pricePaise":150000},
 {"category":"Mutton","name":"Mutton Chops","pricePaise":110000},
 {"category":"Mutton","name":"Mutton Liver","pricePaise":110000},
 {"category":"Mutton","name":"Mutton Nalli Bones / Soup Bones","pricePaise":70000},
 {"category":"Mutton","name":"Mutton Curry Cut Bengali Style","description":"30–40 g pieces.","pricePaise":110000},
 {"category":"Mutton","name":"Mutton Paya","description":"Price per set of 4 legs.","pricePaise":45000,"unitsPerPack":4},
 {"category":"Chicken","name":"Chicken Premium Regular Curry Cut","pricePaise":32000},
 {"category":"Chicken","name":"Chicken Chest Boneless","pricePaise":56000},
 {"category":"Chicken","name":"Chicken Leg Boneless","pricePaise":60000},
 {"category":"Chicken","name":"Chicken Keema / Mince","pricePaise":56000},
 {"category":"Chicken","name":"Chicken Chest Fillet","pricePaise":56000},
 {"category":"Chicken","name":"Chicken Premium Biriyani Cut","pricePaise":32000},
 {"category":"Chicken","name":"Chicken Lollipop","pricePaise":44000},
 {"category":"Chicken","name":"Chicken Wings","pricePaise":40000},
 {"category":"Chicken","name":"Chicken Liver","pricePaise":20000},
 {"category":"Chicken","name":"Chicken Drumsticks","pricePaise":44000},
 {"category":"Chicken","name":"Chicken Full Legs","pricePaise":44000},
 {"category":"Chicken","name":"Farm Country Chicken","description":"Priced on live weight.","pricePaise":56000},
 {"category":"Chicken","name":"Smoked Chicken","pricePaise":38000}
 ]$json$::jsonb) WITH ORDINALITY LOOP
  SELECT id INTO cat FROM app.categories WHERE business_id=business AND name=item->>'category';
  SELECT COALESCE(array_agg(p.id ORDER BY p.id),'{}') INTO matches FROM app.products p
  WHERE p.business_id=business AND p.is_active AND pg_temp.name_keys(p.name) && (
   SELECT array_agg(k) FROM (SELECT unnest(pg_temp.name_keys(item->>'name')) k
    UNION SELECT unnest(pg_temp.name_keys(a)) FROM jsonb_array_elements_text(COALESCE(item->'aliases','[]')) a) keys);
  IF cardinality(matches)>1 THEN RAISE EXCEPTION 'Several products match "%"; review required',item->>'name'; END IF;
  product:=matches[1];
  IF product=ANY(claimed) THEN RAISE EXCEPTION 'A product matches "%" and another catalogue item; review required',item->>'name'; END IF;
  claimed:=claimed||matches;

  IF item ? 'cuts' THEN
   IF product IS NOT NULL THEN
    UPDATE app.products SET preparations=(SELECT jsonb_agg(jsonb_build_object('name',c) ORDER BY n) FROM jsonb_array_elements_text(item->'cuts') WITH ORDINALITY cuts(c,n))
    WHERE id=product AND preparations IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('name',c) ORDER BY n) FROM jsonb_array_elements_text(item->'cuts') WITH ORDINALITY cuts(c,n));
    IF FOUND THEN changed:=changed||(SELECT name FROM app.products WHERE id=product); ELSE unchanged:=unchanged||(SELECT name FROM app.products WHERE id=product); END IF;
   ELSE
    INSERT INTO app.products(business_id,category_id,name,allowed_weights,preparations,pricing_basis,price_unit_grams,catalogue_published,sort_order)
    VALUES(business,cat,item->>'name','[1000]',(SELECT jsonb_agg(jsonb_build_object('name',c) ORDER BY n) FROM jsonb_array_elements_text(item->'cuts') WITH ORDINALITY cuts(c,n)),
     'RAW_WEIGHT',1000,false,100+ordinal::integer);
    created_fish:=created_fish||(item->>'name');
   END IF;
  ELSIF product IS NOT NULL THEN
   kept_meat:=kept_meat||(SELECT name FROM app.products WHERE id=product);
  ELSE
   -- Customised cuts go in the cart line's cutting instructions, so one preparation each.
   INSERT INTO app.products(business_id,category_id,name,description,allowed_weights,preparations,pricing_basis,price_unit_grams,units_per_pack,sale_quantities,catalogue_price_paise,catalogue_published,sort_order)
   VALUES(business,cat,item->>'name',btrim(COALESCE(item->>'description','')||' Need it cut differently? Add cutting instructions to your order.'),
    CASE WHEN item ? 'unitsPerPack' THEN '[]' ELSE '[500,1000,1500,2000]' END::jsonb,
    CASE WHEN item ? 'unitsPerPack' THEN '[{"name":"Cleaned"}]' ELSE '[{"name":"Standard cut"}]' END::jsonb,
    CASE WHEN item ? 'unitsPerPack' THEN 'UNIT' ELSE 'RAW_WEIGHT' END,
    CASE WHEN item ? 'unitsPerPack' THEN NULL ELSE 1000 END,(item->>'unitsPerPack')::integer,
    CASE WHEN item ? 'unitsPerPack' THEN '[1,2,3,4]' ELSE '[]' END::jsonb,
    (item->>'pricePaise')::bigint,true,100+ordinal::integer)
   RETURNING id INTO product;
   created_meat:=created_meat||(item->>'name');
   -- Same offering + first price as publishing from the admin (api.configure_product_pricing).
   IF admin IS NOT NULL THEN
    FOR shop IN SELECT s.id FROM app.stores s WHERE s.business_id=business AND s.is_active AND s.deleted_at IS NULL ORDER BY s.created_at,s.id LOOP
     INSERT INTO app.product_store_settings(business_id,store_id,product_id,available) VALUES(business,shop,product,true) RETURNING id INTO offering;
     INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by,pricing_basis,unit_price_paise,price_unit_grams,units_per_pack)
     SELECT business,offering,CASE WHEN p.pricing_basis='RAW_WEIGHT' THEN p.catalogue_price_paise END,1,admin,p.pricing_basis,
      CASE WHEN p.pricing_basis<>'RAW_WEIGHT' THEN p.catalogue_price_paise END,p.price_unit_grams,p.units_per_pack FROM app.products p WHERE p.id=product;
     offerings_created:=offerings_created+1;
    END LOOP;
   END IF;
  END IF;
 END LOOP;

 IF admin IS NULL AND cardinality(created_meat)>0 THEN RAISE NOTICE 'No active TRAIT ADMIN profile; new mutton/chicken products have no store offering yet'; END IF;
 RAISE NOTICE 'Cuts replaced: %', changed;
 RAISE NOTICE 'Cuts already current: %', unchanged;
 RAISE NOTICE 'New fish (unpublished, no price): %', created_fish;
 RAISE NOTICE 'New mutton/chicken (published): %; store offerings created: %', created_meat, offerings_created;
 RAISE NOTICE 'Existing mutton/chicken left as is: %', kept_meat;
 PERFORM app.core_audit(business,NULL,NULL,'SYSTEM','CATALOGUE_CUTS_IMPORTED',business,jsonb_build_object(
  'cutsReplaced',to_jsonb(changed),'fishCreated',to_jsonb(created_fish),'meatCreated',to_jsonb(created_meat),
  'meatKept',to_jsonb(kept_meat),'offeringsCreated',offerings_created,'source','docs/catalogue-cuts.md Oct 2026'));
END; $import$;

DROP FUNCTION pg_temp.name_keys(text);
NOTIFY pgrst,'reload schema';
COMMIT;
