-- Approved TRAIT store setup: Kokapet store, delivery area, business policy and
-- store offerings for every published catalogue product at its approved price.
-- Forward-only and idempotent; no existing migration or record is overwritten.
-- Skips itself when the TRAIT business has no active ADMIN (fresh/test databases).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtextextended('trait-store-setup-20261002',0));
DO $setup$
DECLARE
 shop constant uuid:='111ac620-b8ea-485d-9cd3-07fb10b65fe7';
 business uuid; admin uuid; product app.products; offering uuid;
 store_created boolean:=false; settings_created boolean:=false; area_created boolean:=false;
 offerings_created integer:=0; expected integer; ready integer;
BEGIN
 SELECT id INTO business FROM app.businesses WHERE slug='trait-fish-meat-hub' AND is_active AND deleted_at IS NULL FOR UPDATE;
 IF business IS NULL THEN RAISE NOTICE 'TRAIT business not found; store setup skipped'; RETURN; END IF;
 SELECT sp.id INTO admin FROM app.staff_profiles sp JOIN app.staff_admin_grants g ON g.staff_profile_id=sp.id AND g.is_active
 WHERE sp.business_id=business AND sp.is_active ORDER BY sp.created_at,sp.id LIMIT 1;
 IF admin IS NULL THEN RAISE NOTICE 'No active TRAIT ADMIN profile; store setup skipped'; RETURN; END IF;

 IF NOT EXISTS(SELECT 1 FROM app.stores WHERE id=shop) THEN
  IF EXISTS(SELECT 1 FROM app.stores WHERE business_id=business AND code='kokapet') THEN
   RAISE EXCEPTION 'A kokapet store already exists with another identity; review required';
  END IF;
  INSERT INTO app.stores(id,business_id,code,name,timezone,address_line1,locality,city,state,pincode,contact_mobile_e164,opening_hours,delivery_enabled,pickup_enabled)
  VALUES(shop,business,'kokapet','TRAIT Fish & Meat Hub','Asia/Kolkata','Pipeline Road','Kokapet','Hyderabad','Telangana','500075','+918686146562',
   (SELECT jsonb_object_agg(d,'[{"opens":"07:00","closes":"20:30"}]'::jsonb) FROM unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) d),true,true);
  store_created:=true;
 ELSIF NOT EXISTS(SELECT 1 FROM app.stores WHERE id=shop AND business_id=business) THEN
  RAISE EXCEPTION 'Store identity belongs to another business; review required';
 END IF;

 IF NOT EXISTS(SELECT 1 FROM app.business_settings WHERE business_id=business) THEN
  INSERT INTO app.business_settings(business_id,employee_operational_history_days,employee_cash_collection_limit_paise,require_payment_before_completion,max_order_items,max_order_total_paise)
  VALUES(business,30,500000,true,20,5000000);
  settings_created:=true;
 END IF;

 INSERT INTO app.delivery_areas(business_id,store_id,pincode,name,delivery_fee_paise,minimum_order_paise)
 VALUES(business,shop,'500075','Kokapet',4000,0) ON CONFLICT(business_id,store_id,pincode) DO NOTHING;
 area_created:=FOUND;

 FOR product IN SELECT * FROM app.products WHERE business_id=business AND is_active AND catalogue_published AND catalogue_price_paise IS NOT NULL ORDER BY sort_order,id LOOP
  SELECT id INTO offering FROM app.product_store_settings WHERE business_id=business AND store_id=shop AND product_id=product.id;
  IF offering IS NULL THEN
   INSERT INTO app.product_store_settings(business_id,store_id,product_id,available) VALUES(business,shop,product.id,true) RETURNING id INTO offering;
   INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by,pricing_basis,unit_price_paise,price_unit_grams,units_per_pack)
   VALUES(business,offering,CASE WHEN product.pricing_basis='RAW_WEIGHT' THEN product.catalogue_price_paise END,1,admin,product.pricing_basis,
    CASE WHEN product.pricing_basis<>'RAW_WEIGHT' THEN product.catalogue_price_paise END,product.price_unit_grams,product.units_per_pack);
   offerings_created:=offerings_created+1;
  END IF;
 END LOOP;

 SELECT count(*) INTO expected FROM app.products WHERE business_id=business AND is_active AND catalogue_published AND catalogue_price_paise IS NOT NULL;
 SELECT count(*) INTO ready FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id
 WHERE o.business_id=business AND o.store_id=shop AND o.is_active AND p.is_active AND p.catalogue_published
 AND EXISTS(SELECT 1 FROM app.product_prices pr WHERE pr.offering_id=o.id AND pr.pricing_basis=p.pricing_basis);
 IF expected<>23 OR ready<>expected THEN
  RAISE EXCEPTION 'Store setup incomplete: % of % published products priced (23 approved); rolled back',ready,expected;
 END IF;

 IF store_created OR settings_created OR area_created OR offerings_created>0 THEN
  PERFORM app.core_audit(business,shop,NULL,'SYSTEM','APPROVED_STORE_SETUP',shop,jsonb_build_object(
   'storeCreated',store_created,'settingsCreated',settings_created,'deliveryAreaCreated',area_created,
   'offeringsCreated',offerings_created,'priceRecordedBy',admin,'source','Approved store setup 2026-10-02'));
 END IF;
END; $setup$;
COMMIT;
