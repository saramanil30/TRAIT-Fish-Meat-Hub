-- Catalogue additions (Nov 2026). Forward-only; data only (no schema, grants, RLS or policy change).
-- 1. New: "Nattu Crabs / Telangana Crabs" (Crabs & Lobsters, cut Cleaned; unpublished, no price, like the other new
--    seafood) and "Original Country Chicken" (Chicken, Rs 800/kg raw weight, published, with an offering per store).
-- 2. Mud Crabs gets the description "Sold live". Norway Salmon / Atlantic Salmon moves to NET weight at Rs 2,800 per
--    kg net (choices 250 g / 500 g / 1 kg), is published and gets an offering per store that has none.
-- 3. New category "Ready to Cook by TRAIT" (after Dry Fish) with five products, unpublished and unpriced.
-- Matching uses the same rule as 20261031000000 (case, punctuation, plural "s", per "/"-part). An item that already
-- exists is never created again; an item to update that is missing or ambiguous stops the whole migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtextextended('trait-catalogue-additions-20261119',0));

CREATE FUNCTION pg_temp.name_keys(n text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $fn$
 SELECT COALESCE(array_agg(DISTINCT k),'{}') FROM (
  SELECT regexp_replace(btrim(regexp_replace(lower(part),'[^a-z0-9]+',' ','g')),'s$','') k
  FROM unnest(array_append(string_to_array(n,'/'),n)) part) keys WHERE k<>''
$fn$;

DO $import$
DECLARE
 business uuid; admin uuid; item jsonb; ordinal bigint; cat uuid; product uuid; matches uuid[]; shop uuid; offering uuid;
 salmon app.products; created text[]:='{}'; kept text[]:='{}'; offerings_created integer:=0; ready_cat_created boolean:=false;
BEGIN
 SELECT id INTO business FROM app.businesses WHERE slug='trait-fish-meat-hub' AND is_active AND deleted_at IS NULL FOR UPDATE;
 IF business IS NULL THEN RAISE NOTICE 'TRAIT business not found; catalogue additions skipped'; RETURN; END IF;
 SELECT sp.id INTO admin FROM app.staff_profiles sp JOIN app.staff_admin_grants g ON g.staff_profile_id=sp.id AND g.is_active
 WHERE sp.business_id=business AND sp.is_active ORDER BY sp.created_at,sp.id LIMIT 1;
 -- Same lock order as the catalogue writers (products before preparation records).
 PERFORM 1 FROM app.products WHERE business_id=business ORDER BY id FOR UPDATE;

 -- 3. Category (reuse one already named this, ignoring case).
 IF NOT EXISTS(SELECT 1 FROM app.categories WHERE business_id=business AND lower(btrim(name))=lower('Ready to Cook by TRAIT')) THEN
  INSERT INTO app.categories(business_id,name,sort_order)
  VALUES(business,'Ready to Cook by TRAIT',(SELECT COALESCE(max(sort_order),0)+1 FROM app.categories WHERE business_id=business AND parent_id IS NULL));
  ready_cat_created:=true;
 END IF;

 -- 1 + 3. New products; skipped when an active product already matches by name.
 FOR item,ordinal IN SELECT value,ordinality FROM jsonb_array_elements($json$[
 {"category":"Crabs & Lobsters","name":"Nattu Crabs / Telangana Crabs","cuts":["Cleaned"]},
 {"category":"Chicken","name":"Original Country Chicken","description":"Priced on live weight","pricePaise":80000},
 {"category":"Ready to Cook by TRAIT","name":"Marinated Chicken","cuts":["Ready to cook"],"weights":[500,1000]},
 {"category":"Ready to Cook by TRAIT","name":"Marinated Fish","cuts":["Ready to cook"],"weights":[500,1000]},
 {"category":"Ready to Cook by TRAIT","name":"Marinated Prawns","cuts":["Ready to cook"],"weights":[500,1000]},
 {"category":"Ready to Cook by TRAIT","name":"Marinated Mutton","cuts":["Ready to cook"],"weights":[500,1000]},
 {"category":"Ready to Cook by TRAIT","name":"BBQ & Grill Specials","cuts":["Ready to cook"],"weights":[500,1000]}
 ]$json$::jsonb) WITH ORDINALITY LOOP
  SELECT id INTO cat FROM app.categories WHERE business_id=business AND lower(btrim(name))=lower(item->>'category');
  IF cat IS NULL THEN RAISE EXCEPTION 'Category "%" not found; review required',item->>'category'; END IF;
  SELECT COALESCE(array_agg(p.id ORDER BY p.id),'{}') INTO matches FROM app.products p
  WHERE p.business_id=business AND p.is_active AND pg_temp.name_keys(p.name) && pg_temp.name_keys(item->>'name');
  IF cardinality(matches)>0 THEN
   kept:=kept||(SELECT string_agg(name,', ') FROM app.products WHERE id=ANY(matches));
   CONTINUE;
  END IF;

  IF item ? 'pricePaise' THEN
   -- Published meat, same shape as the October chicken items (one cut; custom cuts go in cutting instructions).
   INSERT INTO app.products(business_id,category_id,name,description,allowed_weights,preparations,pricing_basis,price_unit_grams,catalogue_price_paise,catalogue_published,sort_order)
   VALUES(business,cat,item->>'name',item->>'description','[500,1000,1500,2000]','[{"name":"Standard cut"}]','RAW_WEIGHT',1000,(item->>'pricePaise')::bigint,true,
    (SELECT COALESCE(max(sort_order),0)+1 FROM app.products WHERE business_id=business AND category_id=cat))
   RETURNING id INTO product;
   IF admin IS NOT NULL THEN
    FOR shop IN SELECT s.id FROM app.stores s WHERE s.business_id=business AND s.is_active AND s.deleted_at IS NULL ORDER BY s.created_at,s.id LOOP
     INSERT INTO app.product_store_settings(business_id,store_id,product_id,available) VALUES(business,shop,product,true) RETURNING id INTO offering;
     INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by,pricing_basis,unit_price_paise,price_unit_grams,units_per_pack)
     VALUES(business,offering,(item->>'pricePaise')::bigint,1,admin,'RAW_WEIGHT',NULL,1000,NULL);
     offerings_created:=offerings_created+1;
    END LOOP;
   END IF;
  ELSE
   INSERT INTO app.products(business_id,category_id,name,allowed_weights,preparations,pricing_basis,price_unit_grams,catalogue_published,sort_order)
   VALUES(business,cat,item->>'name',COALESCE(item->'weights','[1000]'),
    (SELECT jsonb_agg(jsonb_build_object('name',c) ORDER BY n) FROM jsonb_array_elements_text(item->'cuts') WITH ORDINALITY cuts(c,n)),
    'RAW_WEIGHT',1000,false,(SELECT COALESCE(max(sort_order),0)+1 FROM app.products WHERE business_id=business AND category_id=cat));
  END IF;
  created:=created||(item->>'name');
 END LOOP;

 -- 2a. Mud Crabs description.
 SELECT COALESCE(array_agg(p.id),'{}') INTO matches FROM app.products p
 WHERE p.business_id=business AND p.is_active AND pg_temp.name_keys(p.name) && pg_temp.name_keys('Mud Crabs');
 IF cardinality(matches)<>1 THEN RAISE EXCEPTION 'Expected one active "Mud Crabs" product, found %; review required',cardinality(matches); END IF;
 UPDATE app.products SET description='Sold live' WHERE id=matches[1] AND description IS DISTINCT FROM 'Sold live';

 -- 2b. Salmon to NET weight. The sale-basis guard forbids changing the unit once any price exists, so stop clearly then.
 SELECT COALESCE(array_agg(p.id),'{}') INTO matches FROM app.products p
 WHERE p.business_id=business AND p.is_active AND pg_temp.name_keys(p.name) && pg_temp.name_keys('Norway Salmon / Atlantic Salmon');
 IF cardinality(matches)<>1 THEN RAISE EXCEPTION 'Expected one active "Norway Salmon / Atlantic Salmon" product, found %; review required',cardinality(matches); END IF;
 SELECT * INTO salmon FROM app.products WHERE id=matches[1];
 IF salmon.pricing_basis<>'NET_WEIGHT' OR salmon.price_unit_grams<>1000 THEN
  IF EXISTS(SELECT 1 FROM app.product_prices pr JOIN app.product_store_settings o ON o.id=pr.offering_id WHERE o.product_id=salmon.id) THEN
   RAISE EXCEPTION '"%" already has store prices on % weight; retire it and create a NET-weight product instead',salmon.name,salmon.pricing_basis;
  END IF;
 END IF;
 UPDATE app.products SET pricing_basis='NET_WEIGHT',price_unit_grams=1000,units_per_pack=NULL,allowed_weights='[]',sale_quantities='[250,500,1000]',
  catalogue_price_paise=280000,catalogue_published=true WHERE id=salmon.id;
 IF admin IS NOT NULL THEN
  FOR shop IN SELECT s.id FROM app.stores s WHERE s.business_id=business AND s.is_active AND s.deleted_at IS NULL ORDER BY s.created_at,s.id LOOP
   offering:=NULL;
   INSERT INTO app.product_store_settings(business_id,store_id,product_id,available) VALUES(business,shop,salmon.id,true)
   ON CONFLICT(business_id,store_id,product_id) DO NOTHING RETURNING id INTO offering;
   -- An existing offering with no price yet (never sellable) gets one at its current version; priced ones are untouched.
   IF offering IS NULL THEN
    SELECT o.id INTO offering FROM app.product_store_settings o WHERE o.business_id=business AND o.store_id=shop AND o.product_id=salmon.id
     AND NOT EXISTS(SELECT 1 FROM app.product_prices pr WHERE pr.offering_id=o.id);
   END IF;
   IF offering IS NOT NULL THEN
    INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by,pricing_basis,unit_price_paise,price_unit_grams,units_per_pack)
    SELECT business,o.id,NULL,o.version,admin,'NET_WEIGHT',280000,1000,NULL FROM app.product_store_settings o WHERE o.id=offering;
    offerings_created:=offerings_created+1;
   END IF;
  END LOOP;
 END IF;

 IF admin IS NULL THEN RAISE NOTICE 'No active TRAIT ADMIN profile; published items have no store offering yet (publish them from the admin)'; END IF;
 RAISE NOTICE 'Category "Ready to Cook by TRAIT" created: %', ready_cat_created;
 RAISE NOTICE 'Products created: %', created;
 RAISE NOTICE 'Already present, left as is: %', kept;
 RAISE NOTICE 'Store offerings priced: %', offerings_created;
 PERFORM app.core_audit(business,NULL,NULL,'SYSTEM','CATALOGUE_ADDITIONS_IMPORTED',business,jsonb_build_object(
  'productsCreated',to_jsonb(created),'productsKept',to_jsonb(kept),'readyToCookCategoryCreated',ready_cat_created,
  'mudCrabsDescription','Sold live','salmonNetWeightProduct',salmon.id,'salmonNetPricePerKgPaise',280000,'offeringsPriced',offerings_created,'source','Owner request Nov 2026'));
END; $import$;

DROP FUNCTION pg_temp.name_keys(text);
NOTIFY pgrst,'reload schema';
COMMIT;
