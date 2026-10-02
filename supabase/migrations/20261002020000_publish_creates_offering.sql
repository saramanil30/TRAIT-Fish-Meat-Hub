-- Publishing a product (new or existing) gives it a store offering at the catalogue
-- reference price, available by default, so it shows in Prices & Availability and on
-- the storefront. Existing offerings are never touched. Same ADMIN-only permission.
CREATE OR REPLACE FUNCTION api.configure_product_pricing(product uuid, basis text, unit_grams integer, pack_count integer, quantities jsonb, reference_price bigint, published boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor app.staff_profiles; product_row app.products; shop uuid; offering uuid;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN']);
 UPDATE app.products SET pricing_basis=basis,price_unit_grams=unit_grams,units_per_pack=pack_count,
 allowed_weights=CASE WHEN basis='RAW_WEIGHT' THEN quantities ELSE '[]'::jsonb END,
 sale_quantities=CASE WHEN basis='RAW_WEIGHT' THEN '[]'::jsonb ELSE quantities END,
 catalogue_price_paise=reference_price,catalogue_published=published WHERE id=product AND business_id=actor.business_id
 RETURNING * INTO product_row;
 IF product_row.id IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'PRODUCT_PRICING_CONFIGURED',product,jsonb_build_object('basis',basis));
 IF published AND reference_price IS NOT NULL THEN
  FOR shop IN SELECT s.id FROM app.stores s WHERE s.business_id=actor.business_id AND s.is_active AND s.deleted_at IS NULL
   AND app.can_access_store(actor.business_id,s.id) ORDER BY s.created_at,s.id LOOP
   INSERT INTO app.product_store_settings(business_id,store_id,product_id,available) VALUES(actor.business_id,shop,product,true)
   ON CONFLICT(business_id,store_id,product_id) DO NOTHING RETURNING id INTO offering;
   IF offering IS NOT NULL THEN
    INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by,pricing_basis,unit_price_paise,price_unit_grams,units_per_pack)
    VALUES(actor.business_id,offering,CASE WHEN product_row.pricing_basis='RAW_WEIGHT' THEN reference_price END,1,actor.id,product_row.pricing_basis,
     CASE WHEN product_row.pricing_basis<>'RAW_WEIGHT' THEN reference_price END,product_row.price_unit_grams,product_row.units_per_pack);
    INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'OFFERING_CREATED',offering,jsonb_build_object('source','publish'));
   END IF;
  END LOOP;
 END IF;
END; $function$;
