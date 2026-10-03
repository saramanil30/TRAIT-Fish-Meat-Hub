BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Coupon-style offers: each offer has a code; checkout discounts only when the customer applies it.
ALTER TABLE app.offers ADD COLUMN code text;
UPDATE app.offers o SET code=x.code FROM (
 SELECT id,base||CASE WHEN n>1 THEN n::text ELSE '' END AS code
 FROM (SELECT id,base,row_number() OVER (PARTITION BY store_id,base ORDER BY starts_at,id) AS n
  FROM (SELECT id,store_id,starts_at,CASE discount_kind WHEN 'PERCENT' THEN 'SAVE' ELSE 'FLAT' END||floor(discount_value/100)::text AS base FROM app.offers) b) r
) x WHERE x.id=o.id;
ALTER TABLE app.offers ALTER COLUMN code SET NOT NULL;
ALTER TABLE app.offers ADD CONSTRAINT offers_code_format CHECK(code ~ '^[A-Z0-9]{3,20}$');
CREATE UNIQUE INDEX offers_store_code_key ON app.offers(store_id,code);

DROP FUNCTION api.save_offer(uuid,uuid,integer,text,text,text,bigint,timestamptz,timestamptz,text,uuid[],uuid[],boolean);
CREATE FUNCTION api.save_offer(target_id uuid,target_store uuid,expected_version integer,offer_title text,offer_message text,
 kind text,amount bigint,start_time timestamptz,end_time timestamptz,target_scope text,products uuid[],categories uuid[],active boolean,offer_code text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid; code_value text:=upper(btrim(offer_code));
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('offers:'||target_store::text,0));
 IF code_value IS NULL OR code_value !~ '^[A-Z0-9]{3,20}$' THEN RAISE EXCEPTION 'Invalid offer code' USING ERRCODE='22023'; END IF;
 IF products IS NULL OR categories IS NULL OR array_position(products,NULL) IS NOT NULL OR array_position(categories,NULL) IS NOT NULL
 OR EXISTS(SELECT 1 FROM unnest(products) p WHERE NOT EXISTS(SELECT 1 FROM app.products x WHERE x.id=p AND x.business_id=actor.business_id))
 OR EXISTS(SELECT 1 FROM unnest(categories) c WHERE NOT EXISTS(SELECT 1 FROM app.categories x WHERE x.id=c AND x.business_id=actor.business_id))
 THEN RAISE EXCEPTION 'Invalid offer targets' USING ERRCODE='22023'; END IF;
 IF target_id IS NULL THEN
  INSERT INTO app.offers(business_id,store_id,title,message,discount_kind,discount_value,starts_at,ends_at,scope,product_ids,category_ids,is_active,code)
  VALUES(actor.business_id,target_store,btrim(offer_title),offer_message,kind,amount,start_time,end_time,target_scope,products,categories,active,code_value) RETURNING id INTO result;
 ELSE
  UPDATE app.offers SET title=btrim(offer_title),message=offer_message,discount_kind=kind,discount_value=amount,starts_at=start_time,ends_at=end_time,
  scope=target_scope,product_ids=products,category_ids=categories,is_active=active,code=code_value,version=version+1
  WHERE id=target_id AND business_id=actor.business_id AND store_id=target_store AND version=expected_version RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Offer changed or unavailable; reload' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'OFFER_SAVED',result,jsonb_build_object('active',active,'code',code_value));
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION api.store_offers(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'message',o.message,'code',o.code,'kind',o.discount_kind,'value',o.discount_value,
 'endsAt',o.ends_at,'scope',o.scope,'products',o.product_ids,'categories',o.category_ids,
 'targetNames',CASE o.scope WHEN 'PRODUCTS' THEN (SELECT jsonb_agg(p.name ORDER BY p.name) FROM app.products p WHERE p.id=ANY(o.product_ids))
 WHEN 'CATEGORIES' THEN (SELECT jsonb_agg(c.name ORDER BY c.name) FROM app.categories c WHERE c.id=ANY(o.category_ids)) ELSE '[]'::jsonb END) ORDER BY o.ends_at,o.id),'[]'::jsonb)
 FROM app.offers o JOIN app.stores s ON s.id=o.store_id JOIN app.businesses b ON b.id=o.business_id
 WHERE o.store_id=target_store AND o.is_active AND o.starts_at<=statement_timestamp() AND o.ends_at>statement_timestamp()
 AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL
$fn$;

-- The applied coupon's offer, discounting only its eligible lines. Whole rupees: rounded to the nearest rupee, never above
-- the eligible amount (floored to a rupee), always leaving merchandise payable. Mirrored in src/lib/cart-offer.ts.
CREATE FUNCTION app.offer_discount(target_store uuid,lines jsonb,pricing_at timestamptz,coupon text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH RECURSIVE ancestors AS (
 SELECT c.id,c.id AS ancestor,c.parent_id FROM app.categories c JOIN app.stores s ON s.business_id=c.business_id WHERE s.id=target_store
 UNION SELECT a.id,c.id,c.parent_id FROM ancestors a JOIN app.categories c ON c.id=a.parent_id
 ), candidate AS (
 SELECT o.*,COALESCE((SELECT sum((line->>'lineTotalPaise')::bigint) FROM jsonb_array_elements(lines) line
 WHERE o.scope='STORE' OR (o.scope='PRODUCTS' AND (line->>'productId')::uuid=ANY(o.product_ids))
 OR (o.scope='CATEGORIES' AND EXISTS(SELECT 1 FROM ancestors a WHERE a.id=(line->'snapshot'->>'categoryId')::uuid AND a.ancestor=ANY(o.category_ids)))),0)::bigint AS eligible,
 (SELECT COALESCE(sum((line->>'lineTotalPaise')::bigint),0) FROM jsonb_array_elements(lines) line)::bigint AS subtotal
 FROM app.offers o WHERE o.store_id=target_store AND o.code=coupon AND o.is_active AND o.starts_at<=pricing_at AND o.ends_at>pricing_at
 ), discounts AS (
 SELECT *,LEAST(
  round((CASE WHEN discount_kind='PERCENT' THEN floor(eligible::numeric*discount_value/10000) ELSE discount_value END)/100.0)*100,
  floor(eligible/100.0)*100,
  floor(GREATEST(subtotal-1,0)/100.0)*100)::bigint AS discount FROM candidate
 )
 SELECT jsonb_build_object('id',id,'title',title,'code',code,'version',version,'kind',discount_kind,'value',discount_value,'eligibleSubtotalPaise',eligible,'discountPaise',discount)
 FROM discounts WHERE discount>0
$fn$;

CREATE OR REPLACE FUNCTION app.build_order_quote(target_store uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE shop app.stores; settings app.business_settings; item jsonb; selection record;
 product app.products; prep app.preparation_options; choice app.product_preparation_options;
 offering app.product_store_settings; price app.product_prices;
 lines jsonb:='[]'; seen text[]:='{}'; identity_key text; instructions text;
 grams integer; line_total bigint; unit_price bigint; subtotal bigint:=0; fee bigint:=0; total bigint; fulfillment jsonb; result jsonb; pricing_at timestamptz; offer jsonb; discount bigint:=0;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>250000
 OR (payload-ARRAY['items','method','mobile','name','address','paymentMethod','couponCode'])<>'{}'::jsonb
 OR (payload ? 'couponCode' AND (jsonb_typeof(payload->'couponCode') IS DISTINCT FROM 'string' OR payload->>'couponCode' !~ '^[A-Z0-9]{3,20}$'))
 OR jsonb_typeof(payload->'items') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'mobile') IS DISTINCT FROM 'string'
 OR (payload ? 'name' AND jsonb_typeof(payload->'name') NOT IN ('string','null'))
 OR (payload->>'paymentMethod') IS NULL OR payload->>'paymentMethod' NOT IN ('CASH','ONLINE','UPI')
 THEN RAISE EXCEPTION 'Invalid checkout choices' USING ERRCODE='22023'; END IF;
 SELECT s.* INTO shop FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL FOR SHARE OF s,b;
 IF shop.id IS NULL THEN RAISE EXCEPTION 'Store unavailable' USING ERRCODE='22023'; END IF;
 SELECT * INTO settings FROM app.business_settings WHERE business_id=shop.business_id FOR SHARE;
 IF settings.id IS NULL THEN RAISE EXCEPTION 'Operational policy must be configured before checkout' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(payload->'items') NOT BETWEEN 1 AND settings.max_order_items THEN RAISE EXCEPTION 'Invalid cart size' USING ERRCODE='22023'; END IF;
 -- Deterministic locks respect the catalogue writer's products-before-options
 -- order. MVP business-wide read locks avoid multi-item lock-order races.
 PERFORM id FROM app.products WHERE business_id=shop.business_id ORDER BY id FOR SHARE;
 PERFORM id FROM app.categories WHERE business_id=shop.business_id ORDER BY id FOR SHARE;
 PERFORM id FROM app.preparation_options WHERE business_id=shop.business_id ORDER BY id FOR SHARE;
 PERFORM id FROM app.product_preparation_options WHERE business_id=shop.business_id ORDER BY id FOR SHARE;
 PERFORM id FROM app.product_allowed_weights WHERE business_id=shop.business_id ORDER BY id FOR SHARE;
 PERFORM id FROM app.product_store_settings WHERE business_id=shop.business_id AND store_id=shop.id ORDER BY id FOR SHARE;
 PERFORM id FROM app.delivery_areas WHERE business_id=shop.business_id AND store_id=shop.id ORDER BY id FOR SHARE;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('offers:'||target_store::text,0));
 pricing_at:=clock_timestamp();
 FOR item IN SELECT value FROM jsonb_array_elements(payload->'items') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (item-ARRAY['productId','preparationId','rawWeightGrams','quantity','instructions'])<>'{}'::jsonb
  OR NOT(item ?& ARRAY['productId','preparationId']) OR ((item ? 'rawWeightGrams') = (item ? 'quantity'))
  OR jsonb_typeof(item->'productId') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'preparationId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(COALESCE(item->'rawWeightGrams',item->'quantity')) IS DISTINCT FROM 'number' OR COALESCE(item->>'rawWeightGrams',item->>'quantity') !~ '^[0-9]{1,6}$'
  OR (item ? 'instructions' AND jsonb_typeof(item->'instructions') IS DISTINCT FROM 'string')
  THEN RAISE EXCEPTION 'Invalid cart line' USING ERRCODE='22023'; END IF;
  grams:=COALESCE(item->>'rawWeightGrams',item->>'quantity')::integer;
  instructions:=normalize(regexp_replace(COALESCE(item->>'instructions',''),'^[[:space:]]+|[[:space:]]+$','','g'),NFC);
  IF length(instructions)>300 THEN RAISE EXCEPTION 'Instructions too long' USING ERRCODE='22023'; END IF;
  identity_key:=jsonb_build_array((item->>'productId')::uuid,(item->>'preparationId')::uuid,grams,instructions)::text;
  IF identity_key=ANY(seen) THEN RAISE EXCEPTION 'Duplicate cart selection' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,identity_key);
  SELECT * INTO product FROM app.products WHERE id=(item->>'productId')::uuid AND business_id=shop.business_id AND is_active;
  IF product.id IS NULL OR NOT app.category_is_visible(product.category_id,shop.business_id) THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='22023'; END IF;
  SELECT * INTO offering FROM app.product_store_settings WHERE business_id=shop.business_id AND store_id=shop.id AND product_id=product.id AND is_active AND available;
  IF offering.id IS NULL THEN RAISE EXCEPTION 'Product sold out or unavailable' USING ERRCODE='22023'; END IF;
  SELECT * INTO prep FROM app.preparation_options WHERE business_id=shop.business_id AND id=(item->>'preparationId')::uuid AND is_active;
  SELECT * INTO choice FROM app.product_preparation_options WHERE business_id=shop.business_id AND product_id=product.id AND preparation_option_id=prep.id AND is_active;
  IF choice.id IS NULL OR (product.pricing_basis='RAW_WEIGHT' AND (NOT(item ? 'rawWeightGrams') OR NOT EXISTS(SELECT 1 FROM app.product_allowed_weights WHERE business_id=shop.business_id AND product_id=product.id AND raw_weight_grams=grams AND is_active))) OR (product.pricing_basis<>'RAW_WEIGHT' AND (NOT(item ? 'quantity') OR NOT product.sale_quantities @> jsonb_build_array(grams)))
  THEN RAISE EXCEPTION 'Preparation or weight unavailable' USING ERRCODE='22023'; END IF;
  SELECT * INTO price FROM app.product_prices WHERE offering_id=offering.id AND effective_from<=pricing_at ORDER BY effective_from DESC,offering_version DESC LIMIT 1;
  IF price.id IS NULL THEN RAISE EXCEPTION 'Price unavailable' USING ERRCODE='22023'; END IF;
  IF (price.pricing_basis,price.price_unit_grams,price.units_per_pack) IS DISTINCT FROM (product.pricing_basis,product.price_unit_grams,product.units_per_pack) THEN RAISE EXCEPTION 'Price unit changed' USING ERRCODE='40001'; END IF;
  unit_price:=COALESCE(price.unit_price_paise,price.price_per_kg_paise);
  line_total:=round(unit_price::numeric*grams/COALESCE(product.price_unit_grams,1))::bigint;
  subtotal:=subtotal+line_total;
  lines:=lines||jsonb_build_array(jsonb_build_object('productId',product.id,'preparationId',prep.id,'priceId',price.id,
   'rawWeightGrams',CASE WHEN product.pricing_basis='RAW_WEIGHT' THEN grams END,'quantity',CASE WHEN product.pricing_basis<>'RAW_WEIGHT' THEN grams END,'pricingBasis',product.pricing_basis,'pricePaise',unit_price,'priceUnitGrams',product.price_unit_grams,'unitsPerPack',product.units_per_pack,'pricePerKgPaise',price.price_per_kg_paise,'lineTotalPaise',line_total,
   'instructions',instructions,'snapshot',jsonb_build_object('productName',product.name,'localName',product.local_name,
   'categoryId',product.category_id,'categoryName',(SELECT name FROM app.categories WHERE id=product.category_id),
   'preparationName',prep.name,'cleaningLossPercent',choice.cleaning_loss_percent,
   'estimatedCleanedWeightGrams',CASE WHEN product.pricing_basis='RAW_WEIGHT' AND choice.cleaning_loss_percent IS NOT NULL THEN round(grams*(1-choice.cleaning_loss_percent/100)) END,
   'pricingBasis',product.pricing_basis,'priceUnitGrams',product.price_unit_grams,'unitsPerPack',product.units_per_pack,'offeringId',offering.id,'offeringVersion',offering.version)));
 END LOOP;
 fulfillment:=app.validate_guest_fulfillment(shop.id,payload->>'method',payload->>'mobile',payload->>'name',payload->'address',subtotal);
 fee:=COALESCE((fulfillment->'deliveryRule'->>'feePaise')::bigint,0);
 -- Coupon-style: a discount applies only when the customer sends a code, and only to that offer's eligible lines.
 IF payload ? 'couponCode' THEN
  offer:=app.offer_discount(target_store,lines,pricing_at,payload->>'couponCode');
  IF offer IS NULL THEN RAISE EXCEPTION 'Coupon not valid for this cart' USING ERRCODE='22023'; END IF;
 END IF;
 discount:=LEAST(COALESCE((offer->>'discountPaise')::bigint,0),GREATEST(subtotal-1,0));
 IF discount=0 THEN offer:=NULL; ELSE offer:=offer||jsonb_build_object('discountPaise',discount); END IF;
 total:=subtotal-discount+fee;
 IF total NOT BETWEEN 1 AND settings.max_order_total_paise THEN RAISE EXCEPTION 'Order total outside configured limits' USING ERRCODE='22023'; END IF;
 fulfillment:=fulfillment||jsonb_build_object('store',jsonb_build_object('name',shop.name,'addressLine1',shop.address_line1,'addressLine2',shop.address_line2,
 'locality',shop.locality,'city',shop.city,'state',shop.state,'pincode',shop.pincode,'contactMobile',shop.contact_mobile_e164));
 result:=jsonb_build_object('businessId',shop.business_id,'storeId',shop.id,'items',lines,'fulfillment',fulfillment,
 'paymentMethod',payload->>'paymentMethod','currency','INR','subtotalPaise',subtotal,'discountPaise',discount,'offer',offer,'deliveryFeePaise',fee,'totalPaise',total,'policyRevision',settings.revision);
 RETURN result||jsonb_build_object('quoteDigest',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
END;
$fn$;
DROP FUNCTION app.offer_discount(uuid,jsonb,timestamptz);

REVOKE ALL ON FUNCTION api.save_offer(uuid,uuid,integer,text,text,text,bigint,timestamptz,timestamptz,text,uuid[],uuid[],boolean,text),app.offer_discount(uuid,jsonb,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.save_offer(uuid,uuid,integer,text,text,text,bigint,timestamptz,timestamptz,text,uuid[],uuid[],boolean,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
