-- Backfill: a store offering, at the catalogue reference price and available, for every
-- published TRAIT product that has none yet in an active store. Existing offerings are
-- never changed. Safe to re-run: a second run creates nothing. Run in the Supabase SQL editor.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('trait-backfill-store-offerings',0));
DO $backfill$
DECLARE business uuid; admin uuid; shop uuid; product app.products; offering uuid; created integer:=0;
BEGIN
 SELECT id INTO business FROM app.businesses WHERE slug='trait-fish-meat-hub' AND is_active AND deleted_at IS NULL;
 IF business IS NULL THEN RAISE EXCEPTION 'TRAIT business not found'; END IF;
 SELECT sp.id INTO admin FROM app.staff_profiles sp JOIN app.staff_admin_grants g ON g.staff_profile_id=sp.id AND g.is_active
 WHERE sp.business_id=business AND sp.is_active ORDER BY sp.created_at,sp.id LIMIT 1;
 IF admin IS NULL THEN RAISE EXCEPTION 'No active TRAIT ADMIN to record the prices'; END IF;
 FOR shop IN SELECT id FROM app.stores WHERE business_id=business AND is_active AND deleted_at IS NULL ORDER BY created_at,id LOOP
  FOR product IN SELECT * FROM app.products WHERE business_id=business AND catalogue_published AND catalogue_price_paise IS NOT NULL ORDER BY sort_order,id LOOP
   INSERT INTO app.product_store_settings(business_id,store_id,product_id,available) VALUES(business,shop,product.id,true)
   ON CONFLICT(business_id,store_id,product_id) DO NOTHING RETURNING id INTO offering;
   IF offering IS NOT NULL THEN
    INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by,pricing_basis,unit_price_paise,price_unit_grams,units_per_pack)
    VALUES(business,offering,CASE WHEN product.pricing_basis='RAW_WEIGHT' THEN product.catalogue_price_paise END,1,admin,product.pricing_basis,
     CASE WHEN product.pricing_basis<>'RAW_WEIGHT' THEN product.catalogue_price_paise END,product.price_unit_grams,product.units_per_pack);
    created:=created+1;
    RAISE NOTICE 'Offering created: %', product.name;
   END IF;
  END LOOP;
 END LOOP;
 IF created>0 THEN
  PERFORM app.core_audit(business,NULL,NULL,'SYSTEM','STORE_OFFERINGS_BACKFILLED',business,jsonb_build_object('offeringsCreated',created,'priceRecordedBy',admin));
 END IF;
 RAISE NOTICE 'Offerings created: %', created;
END; $backfill$;
COMMIT;
