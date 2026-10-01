-- Configure the first TRAIT store from confirmed values (saramanil.txt, 2026-10-02)
-- and connect the 23 approved catalogue products at their existing approved prices/units.
-- Products are not modified. No offers are created. Idempotent: re-running changes nothing.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtextextended('trait-store-setup-20261002',0));
DO $setup$
DECLARE
 business uuid;
 store constant uuid:='111ac620-b8ea-485d-9cd3-07fb10b65fe7';
 actor uuid;
 offerings integer; prices integer;
BEGIN
 SELECT id INTO business FROM app.businesses WHERE slug='trait-fish-meat-hub' AND is_active AND deleted_at IS NULL FOR UPDATE;
 IF business IS NULL THEN RAISE EXCEPTION 'TRAIT business not found; review required'; END IF;
 -- Price history requires a staff author: the single active ADMIN-granted profile.
 -- Fresh/test databases have no staff; skip there so schema validation suites stay unaffected.
 IF (SELECT count(*) FROM app.staff_profiles sp JOIN app.staff_admin_grants g ON g.staff_profile_id=sp.id AND g.is_active
  WHERE sp.business_id=business AND sp.is_active AND sp.disabled_at IS NULL)<>1 THEN
  RAISE NOTICE 'TRAIT store setup skipped: expected exactly one active ADMIN profile';
  RETURN;
 END IF;
 SELECT sp.id INTO STRICT actor FROM app.staff_profiles sp JOIN app.staff_admin_grants g ON g.staff_profile_id=sp.id AND g.is_active
  WHERE sp.business_id=business AND sp.is_active AND sp.disabled_at IS NULL;

 INSERT INTO app.stores(id,business_id,code,name,address_line1,city,state,pincode,contact_mobile_e164,opening_hours,delivery_enabled,pickup_enabled)
 VALUES(store,business,'kokapet','TRAIT Fish & Meat Hub','Kokapet, Pipeline Road','Hyderabad','Telangana','500075','+918686146562',
  jsonb_build_object('mon','[{"opens":"07:00","closes":"20:30"}]'::jsonb,'tue','[{"opens":"07:00","closes":"20:30"}]'::jsonb,
   'wed','[{"opens":"07:00","closes":"20:30"}]'::jsonb,'thu','[{"opens":"07:00","closes":"20:30"}]'::jsonb,
   'fri','[{"opens":"07:00","closes":"20:30"}]'::jsonb,'sat','[{"opens":"07:00","closes":"20:30"}]'::jsonb,
   'sun','[{"opens":"07:00","closes":"20:30"}]'::jsonb),
  true,true)
 ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM app.stores WHERE id=store AND business_id=business) THEN RAISE EXCEPTION 'Store code already used by another store; review required'; END IF;

 -- Home Delivery for pincode 500075: ₹40 fee, no money minimum (every sale choice is already at least 500 g).
 INSERT INTO app.delivery_areas(business_id,store_id,pincode,name,delivery_fee_paise,minimum_order_paise,is_active)
 VALUES(business,store,'500075','Kokapet',4000,0,true)
 ON CONFLICT(business_id,store_id,pincode) DO NOTHING;

 -- Operational policy required by checkout. Suggested values approved 2026-10-02; editable in Settings.
 INSERT INTO app.business_settings(business_id,employee_operational_history_days,employee_cash_collection_limit_paise,
  require_payment_before_completion,max_order_items,max_order_total_paise)
 VALUES(business,30,500000,true,20,5000000)
 ON CONFLICT(business_id) DO NOTHING;

 -- Offer every active, published product at this store and mark it available.
 INSERT INTO app.product_store_settings(business_id,store_id,product_id,available,is_active)
 SELECT business,store,p.id,true,true FROM app.products p
 WHERE p.business_id=business AND p.is_active AND p.catalogue_published AND p.catalogue_price_paise IS NOT NULL
 ON CONFLICT(business_id,store_id,product_id) DO NOTHING;
 GET DIAGNOSTICS offerings=ROW_COUNT;

 -- Initial price = the product's existing approved catalogue price, in its existing unit.
 INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,unit_price_paise,offering_version,created_by,pricing_basis,price_unit_grams,units_per_pack)
 SELECT business,o.id,
  CASE WHEN p.pricing_basis='RAW_WEIGHT' THEN p.catalogue_price_paise END,
  CASE WHEN p.pricing_basis<>'RAW_WEIGHT' THEN p.catalogue_price_paise END,
  o.version,actor,p.pricing_basis,p.price_unit_grams,p.units_per_pack
 FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id
 WHERE o.business_id=business AND o.store_id=store
  AND NOT EXISTS(SELECT 1 FROM app.product_prices pr WHERE pr.offering_id=o.id);
 GET DIAGNOSTICS prices=ROW_COUNT;

 IF (SELECT count(*) FROM app.product_store_settings WHERE store_id=store AND is_active AND available)<>23
  OR (SELECT count(DISTINCT pr.offering_id) FROM app.product_prices pr JOIN app.product_store_settings o ON o.id=pr.offering_id WHERE o.store_id=store)<>23
 THEN RAISE EXCEPTION 'Expected 23 priced, available offerings; review required'; END IF;

 IF offerings>0 OR prices>0 THEN
  PERFORM app.core_audit(business,store,NULL,'SYSTEM','STORE_CONFIGURED',store,
   jsonb_build_object('offeringsCreated',offerings,'pricesCreated',prices,'source','Confirmed store values 2026-10-02'));
 END IF;
END
$setup$;
COMMIT;
