-- Forward-only explicit raw, net and tray/unit pricing. No existing migration edited.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE app.products
 ADD COLUMN pricing_basis text NOT NULL DEFAULT 'RAW_WEIGHT' CHECK(pricing_basis IN ('RAW_WEIGHT','NET_WEIGHT','UNIT','TRAY')),
 ADD COLUMN price_unit_grams integer DEFAULT 1000,
 ADD COLUMN units_per_pack integer,
 ADD COLUMN sale_quantities jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN catalogue_price_paise bigint CHECK(catalogue_price_paise BETWEEN 1 AND 100000000),
 ADD COLUMN catalogue_published boolean NOT NULL DEFAULT false;
ALTER TABLE app.products DROP CONSTRAINT products_check;
ALTER TABLE app.products ADD CONSTRAINT products_sale_configuration CHECK(
 (pricing_basis='RAW_WEIGHT' AND price_unit_grams=1000 AND units_per_pack IS NULL AND sale_quantities='[]' AND app.valid_product_configuration(allowed_weights,preparations)) OR
 (pricing_basis='NET_WEIGHT' AND price_unit_grams BETWEEN 1 AND 100000 AND units_per_pack IS NULL AND allowed_weights='[]' AND app.valid_product_configuration(sale_quantities,preparations)) OR
 (pricing_basis IN ('UNIT','TRAY') AND price_unit_grams IS NULL AND units_per_pack BETWEEN 1 AND 1000 AND allowed_weights='[]' AND app.valid_product_configuration(sale_quantities,preparations))
);
ALTER TABLE app.product_prices ALTER COLUMN price_per_kg_paise DROP NOT NULL,
 ADD COLUMN pricing_basis text NOT NULL DEFAULT 'RAW_WEIGHT',
 ADD COLUMN unit_price_paise bigint,
 ADD COLUMN price_unit_grams integer DEFAULT 1000,
 ADD COLUMN units_per_pack integer;
ALTER TABLE app.product_prices ADD CONSTRAINT prices_sale_unit CHECK(
 (pricing_basis='RAW_WEIGHT' AND price_per_kg_paise IS NOT NULL AND unit_price_paise IS NULL AND price_unit_grams=1000 AND units_per_pack IS NULL) OR
 (pricing_basis='NET_WEIGHT' AND price_per_kg_paise IS NULL AND unit_price_paise BETWEEN 1 AND 100000000 AND unit_price_paise IS NOT NULL AND price_unit_grams BETWEEN 1 AND 100000 AND price_unit_grams IS NOT NULL AND units_per_pack IS NULL) OR
 (pricing_basis IN ('UNIT','TRAY') AND price_per_kg_paise IS NULL AND unit_price_paise BETWEEN 1 AND 100000000 AND unit_price_paise IS NOT NULL AND price_unit_grams IS NULL AND units_per_pack BETWEEN 1 AND 1000 AND units_per_pack IS NOT NULL)
);
ALTER TABLE app.order_items ALTER COLUMN raw_weight_grams DROP NOT NULL, ALTER COLUMN price_per_kg_paise DROP NOT NULL,
 ADD COLUMN pricing_basis text NOT NULL DEFAULT 'RAW_WEIGHT', ADD COLUMN sale_quantity integer,
 ADD COLUMN unit_price_paise bigint, ADD COLUMN price_unit_grams integer DEFAULT 1000, ADD COLUMN units_per_pack integer;
ALTER TABLE app.order_items ADD CONSTRAINT order_items_sale_unit CHECK(
 (pricing_basis='RAW_WEIGHT' AND raw_weight_grams IS NOT NULL AND price_per_kg_paise IS NOT NULL AND sale_quantity IS NULL AND unit_price_paise IS NULL AND price_unit_grams=1000 AND units_per_pack IS NULL) OR
 (pricing_basis IN ('NET_WEIGHT','UNIT','TRAY') AND raw_weight_grams IS NULL AND price_per_kg_paise IS NULL AND sale_quantity IS NOT NULL AND sale_quantity BETWEEN 1 AND 100000 AND unit_price_paise IS NOT NULL AND unit_price_paise BETWEEN 1 AND 100000000 AND
 ((pricing_basis='NET_WEIGHT' AND price_unit_grams IS NOT NULL AND price_unit_grams BETWEEN 1 AND 100000 AND units_per_pack IS NULL AND line_total_paise=round(unit_price_paise::numeric*sale_quantity/price_unit_grams)) OR
 (pricing_basis IN ('UNIT','TRAY') AND price_unit_grams IS NULL AND units_per_pack IS NOT NULL AND units_per_pack BETWEEN 1 AND 1000 AND line_total_paise=unit_price_paise*sale_quantity)))
);
ALTER TABLE app.products ADD CONSTRAINT products_sale_unit_required CHECK ((pricing_basis IN ('RAW_WEIGHT','NET_WEIGHT') AND price_unit_grams IS NOT NULL) OR (pricing_basis IN ('UNIT','TRAY') AND units_per_pack IS NOT NULL));
CREATE FUNCTION app.guard_sale_basis() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
 IF (NEW.pricing_basis,NEW.price_unit_grams,NEW.units_per_pack) IS DISTINCT FROM (OLD.pricing_basis,OLD.price_unit_grams,OLD.units_per_pack)
 AND EXISTS(SELECT 1 FROM app.product_prices pr JOIN app.product_store_settings o ON o.id=pr.offering_id WHERE o.product_id=OLD.id)
 THEN RAISE EXCEPTION 'Retire the product and create a new one to change a priced unit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $fn$;
CREATE TRIGGER products_sale_basis BEFORE UPDATE ON app.products FOR EACH ROW EXECUTE FUNCTION app.guard_sale_basis();
CREATE FUNCTION api.configure_product_pricing(product uuid,basis text,unit_grams integer,pack_count integer,quantities jsonb,reference_price bigint,published boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN']);
 UPDATE app.products SET pricing_basis=basis,price_unit_grams=unit_grams,units_per_pack=pack_count,
 allowed_weights=CASE WHEN basis='RAW_WEIGHT' THEN quantities ELSE '[]'::jsonb END,
 sale_quantities=CASE WHEN basis='RAW_WEIGHT' THEN '[]'::jsonb ELSE quantities END,
 catalogue_price_paise=reference_price,catalogue_published=published WHERE id=product AND business_id=actor.business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'PRODUCT_PRICING_CONFIGURED',product,jsonb_build_object('basis',basis));
END; $fn$;
CREATE OR REPLACE FUNCTION api.update_daily_product(offering uuid, expected_version integer, price_paise bigint, is_available boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; old_row app.product_store_settings; old_price bigint; product_row app.products;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 IF price_paise IS NULL OR price_paise NOT BETWEEN 1 AND 100000000 OR is_available IS NULL OR expected_version IS NULL THEN
 RAISE EXCEPTION 'Invalid daily product values' USING ERRCODE='22023'; END IF;
 SELECT o.* INTO old_row FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id JOIN app.categories c ON c.id=p.category_id
 WHERE o.id=offering AND o.business_id=actor.business_id AND p.is_active AND c.is_active AND o.is_active AND app.category_is_visible(p.category_id,p.business_id) FOR UPDATE OF o;
 IF old_row.id IS NULL OR NOT app.can_access_store(actor.business_id,old_row.store_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF old_row.version <> expected_version THEN RAISE EXCEPTION 'Product changed; reload before saving' USING ERRCODE='40001'; END IF;
 SELECT * INTO product_row FROM app.products WHERE id=old_row.product_id;
 SELECT COALESCE(unit_price_paise,price_per_kg_paise) INTO old_price FROM app.product_prices WHERE offering_id=offering ORDER BY offering_version DESC LIMIT 1;
 IF old_price IS NOT DISTINCT FROM price_paise AND old_row.available = is_available THEN RETURN; END IF;
 UPDATE app.product_store_settings SET available=is_available,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=offering;
 IF old_price IS DISTINCT FROM price_paise THEN
 INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by,pricing_basis,unit_price_paise,price_unit_grams,units_per_pack)
 VALUES(actor.business_id,offering,CASE WHEN product_row.pricing_basis='RAW_WEIGHT' THEN price_paise END,old_row.version+1,actor.id,product_row.pricing_basis,CASE WHEN product_row.pricing_basis<>'RAW_WEIGHT' THEN price_paise END,product_row.price_unit_grams,product_row.units_per_pack);
 END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail)
 VALUES(actor.business_id,actor.id,'DAILY_PRODUCT_UPDATED',offering,jsonb_build_object('oldPricePaise',old_price,'pricePaise',price_paise,'wasAvailable',old_row.available,'available',is_available));
END;
$fn$;
CREATE OR REPLACE FUNCTION api.daily_products(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'name',p.name,'category',c.name,
 'pricePaise',COALESCE(price.unit_price_paise,price.price_per_kg_paise),'pricingBasis',p.pricing_basis,'priceUnitGrams',p.price_unit_grams,'unitsPerPack',p.units_per_pack,'available',o.available,'version',o.version,'updatedAt',o.updated_at) ORDER BY c.sort_order,p.name)
 FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id
 JOIN app.categories c ON c.id=p.category_id
 LEFT JOIN LATERAL (SELECT price_per_kg_paise,unit_price_paise FROM app.product_prices pr WHERE pr.offering_id=o.id ORDER BY offering_version DESC LIMIT 1) price ON true
 WHERE o.business_id=actor.business_id AND o.store_id=target_store AND p.is_active AND c.is_active AND o.is_active AND app.category_is_visible(p.category_id,p.business_id)), '[]'::jsonb);
END;
$fn$;
CREATE OR REPLACE FUNCTION api.catalogue(target_store uuid, category_filter uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE business uuid;
BEGIN
 SELECT s.business_id INTO business FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL;
 IF business IS NULL THEN RETURN jsonb_build_object('categories','[]'::jsonb,'products','[]'::jsonb); END IF;
 RETURN jsonb_build_object(
 'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'parentId',c.parent_id,'name',c.name,'sortOrder',c.sort_order) ORDER BY c.sort_order,c.name,c.id)
 FROM app.categories c WHERE c.business_id=business AND app.category_is_visible(c.id,business)),'[]'::jsonb),
 'products',COALESCE((
 WITH RECURSIVE selected AS (
 SELECT id FROM app.categories WHERE id=category_filter AND business_id=business
 UNION SELECT c.id FROM app.categories c JOIN selected t ON c.parent_id=t.id WHERE c.business_id=business
 )
 SELECT jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'localName',p.local_name,'description',p.description,
 'categoryId',p.category_id,'category',c.name,'pricePerKgPaise',price.price_per_kg_paise,
 'pricingBasis',p.pricing_basis,'pricePaise',COALESCE(price.unit_price_paise,price.price_per_kg_paise),'priceUnitGrams',p.price_unit_grams,'unitsPerPack',p.units_per_pack,'saleQuantities',p.sale_quantities,'orderable',true,'available',o.available,'featured',COALESCE(o.featured_override,p.featured),
 'sortOrder',COALESCE(o.sort_override,p.sort_order),
 'images',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'assetPath',i.asset_path,'bucket',i.storage_bucket,'objectPath',i.storage_object_path,'alt',i.alt_text,'primary',i.is_primary) ORDER BY i.is_primary DESC,i.sort_order,i.id),'[]'::jsonb)
 FROM app.product_images i WHERE i.product_id=p.id AND i.is_active),
 'weightsGrams',(SELECT jsonb_agg(w.raw_weight_grams ORDER BY w.sort_order,w.raw_weight_grams) FROM app.product_allowed_weights w WHERE w.product_id=p.id AND w.is_active),
 'preparations',(SELECT jsonb_agg(jsonb_build_object('id',opt.id,'name',opt.name,'cleaningLossPercent',pp.cleaning_loss_percent) ORDER BY pp.sort_order,opt.sort_order,opt.id)
 FROM app.product_preparation_options pp JOIN app.preparation_options opt ON opt.id=pp.preparation_option_id
 WHERE pp.product_id=p.id AND pp.is_active AND opt.is_active))
 ORDER BY COALESCE(o.featured_override,p.featured) DESC,COALESCE(o.sort_override,p.sort_order),p.name,p.id)
 FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id JOIN app.categories c ON c.id=p.category_id
 JOIN LATERAL (SELECT price_per_kg_paise,unit_price_paise FROM app.product_prices pr WHERE pr.offering_id=o.id AND pr.effective_from<=statement_timestamp() ORDER BY pr.effective_from DESC,pr.offering_version DESC LIMIT 1) price ON true
 WHERE o.business_id=business AND o.store_id=target_store AND o.is_active AND p.is_active AND app.category_is_visible(c.id,business)
 AND (category_filter IS NULL OR p.category_id IN (SELECT id FROM selected))
 AND (p.pricing_basis<>'RAW_WEIGHT' OR EXISTS(SELECT 1 FROM app.product_allowed_weights w WHERE w.product_id=p.id AND w.is_active))
 AND EXISTS(SELECT 1 FROM app.product_preparation_options pp JOIN app.preparation_options opt ON opt.id=pp.preparation_option_id WHERE pp.product_id=p.id AND pp.is_active AND opt.is_active)
 ),'[]'::jsonb));
END;
$fn$;
CREATE OR REPLACE FUNCTION app.build_order_quote(target_store uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE shop app.stores; settings app.business_settings; item jsonb; selection record;
 product app.products; prep app.preparation_options; choice app.product_preparation_options;
 offering app.product_store_settings; price app.product_prices;
 lines jsonb:='[]'; seen text[]:='{}'; identity_key text; instructions text;
 grams integer; line_total bigint; unit_price bigint; subtotal bigint:=0; fee bigint:=0; total bigint; fulfillment jsonb; result jsonb; pricing_at timestamptz;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>250000
 OR (payload-ARRAY['items','method','mobile','name','address','paymentMethod'])<>'{}'::jsonb
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
 total:=subtotal+fee;
 IF total NOT BETWEEN 1 AND settings.max_order_total_paise THEN RAISE EXCEPTION 'Order total outside configured limits' USING ERRCODE='22023'; END IF;
 fulfillment:=fulfillment||jsonb_build_object('store',jsonb_build_object('name',shop.name,'addressLine1',shop.address_line1,'addressLine2',shop.address_line2,
 'locality',shop.locality,'city',shop.city,'state',shop.state,'pincode',shop.pincode,'contactMobile',shop.contact_mobile_e164));
 result:=jsonb_build_object('businessId',shop.business_id,'storeId',shop.id,'items',lines,'fulfillment',fulfillment,
 'paymentMethod',payload->>'paymentMethod','currency','INR','subtotalPaise',subtotal,'deliveryFeePaise',fee,'totalPaise',total,'policyRevision',settings.revision);
 RETURN result||jsonb_build_object('quoteDigest',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
END;
$fn$;
CREATE OR REPLACE FUNCTION api.place_order(target_store uuid,request_id uuid,payload jsonb,accepted_quote_digest text,
 tracking_digest text,tracking_expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE business uuid; fingerprint bytea; request app.order_requests; quote jsonb; result app.orders;
 line jsonb; line_no integer:=0; payment uuid; number_value text;
BEGIN
 IF request_id IS NULL OR tracking_digest IS NULL OR tracking_digest !~ '^[a-f0-9]{64}$'
 OR accepted_quote_digest IS NULL OR accepted_quote_digest !~ '^[a-f0-9]{64}$'
 OR tracking_expires_at IS NULL OR tracking_expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'Invalid secure checkout envelope' USING ERRCODE='22023'; END IF;
 SELECT s.business_id INTO business FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL FOR SHARE OF s,b;
 IF business IS NULL THEN RAISE EXCEPTION 'Store unavailable' USING ERRCODE='22023'; END IF;
 fingerprint:=sha256(convert_to(jsonb_build_object('payload',payload,'acceptedQuote',accepted_quote_digest,
 'trackingDigest',tracking_digest,'trackingExpires',tracking_expires_at)::text,'UTF8'));
 INSERT INTO app.order_requests(business_id,store_id,request_id,payload_digest)
 VALUES(business,target_store,request_id,fingerprint) ON CONFLICT DO NOTHING;
 SELECT r.* INTO request FROM app.order_requests r WHERE r.business_id=business AND r.store_id=target_store AND r.request_id=place_order.request_id FOR UPDATE;
 IF request.payload_digest IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Idempotency key reused with different input' USING ERRCODE='22023'; END IF;
 IF request.order_id IS NOT NULL THEN
  SELECT * INTO result FROM app.orders WHERE id=request.order_id;
  RETURN jsonb_build_object('id',result.id,'orderNumber',result.order_number,'totalPaise',result.total_paise,'replayed',true);
 END IF;
 quote:=app.build_order_quote(target_store,payload);
 IF quote->>'quoteDigest' IS DISTINCT FROM accepted_quote_digest THEN RAISE EXCEPTION 'Quote changed; review a fresh quote' USING ERRCODE='40001'; END IF;
 number_value:=nextval('app.order_number_seq'::regclass)::text;
 INSERT INTO app.orders(business_id,store_id,order_number,fulfillment_method,fulfillment_snapshot,payment_method,subtotal_paise,delivery_fee_paise,total_paise)
 VALUES(business,target_store,'TFM-'||lpad(number_value,GREATEST(6,length(number_value)),'0'),payload->>'method',quote->'fulfillment',payload->>'paymentMethod',
 (quote->>'subtotalPaise')::bigint,(quote->>'deliveryFeePaise')::bigint,(quote->>'totalPaise')::bigint) RETURNING * INTO result;
 FOR line IN SELECT value FROM jsonb_array_elements(quote->'items') LOOP
  line_no:=line_no+1;
  INSERT INTO app.order_items(business_id,order_id,line_number,product_id,preparation_id,price_id,product_snapshot,raw_weight_grams,price_per_kg_paise,line_total_paise,instructions,pricing_basis,sale_quantity,unit_price_paise,price_unit_grams,units_per_pack)
  VALUES(business,result.id,line_no,(line->>'productId')::uuid,(line->>'preparationId')::uuid,(line->>'priceId')::uuid,line->'snapshot',
   (line->>'rawWeightGrams')::integer,(line->>'pricePerKgPaise')::bigint,(line->>'lineTotalPaise')::bigint,line->>'instructions',line->>'pricingBasis',(line->>'quantity')::integer,CASE WHEN line->>'pricingBasis'<>'RAW_WEIGHT' THEN (line->>'pricePaise')::bigint END,(line->>'priceUnitGrams')::integer,(line->>'unitsPerPack')::integer);
 END LOOP;
 INSERT INTO app.payments(business_id,order_id,method,amount_paise) VALUES(business,result.id,result.payment_method,result.total_paise) RETURNING id INTO payment;
 INSERT INTO app.payment_events(business_id,order_id,payment_id,actor_role,kind,to_status,amount_paise)
 VALUES(business,result.id,payment,'CHECKOUT','PAYMENT_CREATED','PENDING',result.total_paise);
 INSERT INTO app.order_access_tokens(business_id,order_id,token_digest,expires_at)
 VALUES(business,result.id,decode(tracking_digest,'hex'),tracking_expires_at);
 INSERT INTO app.order_status_history(business_id,order_id,to_status,actor_role) VALUES(business,result.id,'PLACED','CHECKOUT');
 UPDATE app.order_requests r SET order_id=result.id WHERE r.business_id=business AND r.store_id=target_store AND r.request_id=place_order.request_id;
 PERFORM app.core_audit(business,target_store,NULL,'CHECKOUT','ORDER_PLACED',result.id,jsonb_build_object('totalPaise',result.total_paise,'method',result.fulfillment_method,'requestId',request_id));
 RETURN jsonb_build_object('id',result.id,'orderNumber',result.order_number,'totalPaise',result.total_paise,'replayed',false);
END;
$fn$;
CREATE OR REPLACE FUNCTION app.guard_order_item_provenance() RETURNS trigger
LANGUAGE plpgsql SET search_path=''
AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.product_prices pr JOIN app.product_store_settings s ON s.id=pr.offering_id
 JOIN app.orders o ON o.id=NEW.order_id AND o.business_id=NEW.business_id
 WHERE pr.id=NEW.price_id AND pr.business_id=NEW.business_id AND s.product_id=NEW.product_id
 AND s.store_id=o.store_id AND pr.price_per_kg_paise IS NOT DISTINCT FROM NEW.price_per_kg_paise
 AND pr.unit_price_paise IS NOT DISTINCT FROM NEW.unit_price_paise AND pr.pricing_basis=NEW.pricing_basis
 AND pr.price_unit_grams IS NOT DISTINCT FROM NEW.price_unit_grams AND pr.units_per_pack IS NOT DISTINCT FROM NEW.units_per_pack)
 THEN RAISE EXCEPTION 'Order item price provenance mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
-- Public, non-orderable business catalogue until a real store is configured.
CREATE FUNCTION api.business_catalogue(target_business uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT jsonb_build_object('categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'parentId',c.parent_id,'name',c.name)) FROM app.categories c WHERE c.business_id=b.id AND app.category_is_visible(c.id,b.id)),'[]'::jsonb),
 'products',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'localName',p.local_name,'description',p.description,'categoryId',p.category_id,
 'pricePaise',p.catalogue_price_paise,'pricePerKgPaise',CASE WHEN p.pricing_basis='RAW_WEIGHT' THEN p.catalogue_price_paise END,'pricingBasis',p.pricing_basis,'priceUnitGrams',p.price_unit_grams,'unitsPerPack',p.units_per_pack,'saleQuantities',p.sale_quantities,'weightsGrams',p.allowed_weights,'available',true,'orderable',false,
 'images',COALESCE((SELECT jsonb_agg(jsonb_build_object('assetPath',i.asset_path,'bucket',i.storage_bucket,'objectPath',i.storage_object_path,'alt',i.alt_text) ORDER BY i.is_primary DESC,i.sort_order) FROM app.product_images i WHERE i.product_id=p.id AND i.is_active),'[]'::jsonb),
 'preparations',(SELECT jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'cleaningLossPercent',pp.cleaning_loss_percent) ORDER BY pp.sort_order) FROM app.product_preparation_options pp JOIN app.preparation_options o ON o.id=pp.preparation_option_id WHERE pp.product_id=p.id AND pp.is_active AND o.is_active)) ORDER BY p.sort_order,p.name)
 FROM app.products p WHERE p.business_id=b.id AND p.is_active AND p.catalogue_published AND p.catalogue_price_paise IS NOT NULL AND app.category_is_visible(p.category_id,b.id)),'[]'::jsonb))
 FROM app.businesses b WHERE b.id=target_business AND b.is_active AND b.deleted_at IS NULL;
$fn$;
REVOKE ALL ON FUNCTION app.guard_sale_basis(),api.configure_product_pricing(uuid,text,integer,integer,jsonb,bigint,boolean),api.business_catalogue(uuid) FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.configure_product_pricing(uuid,text,integer,integer,jsonb,bigint,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION api.business_catalogue(uuid) TO anon,authenticated;
COMMIT;
