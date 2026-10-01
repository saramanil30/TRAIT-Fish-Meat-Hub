BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE app.offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id), store_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160), message text NOT NULL DEFAULT '' CHECK(length(message)<=1000),
 discount_kind text NOT NULL CHECK(discount_kind IN ('PERCENT','FIXED')),
 discount_value bigint NOT NULL CHECK(discount_value>0 AND discount_value<=100000000),
 starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)), ends_at timestamptz NOT NULL CHECK(isfinite(ends_at) AND ends_at>starts_at),
 scope text NOT NULL CHECK(scope IN ('STORE','PRODUCTS','CATEGORIES')),
 product_ids uuid[] NOT NULL DEFAULT '{}', category_ids uuid[] NOT NULL DEFAULT '{}',
 is_active boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 CHECK(discount_kind<>'PERCENT' OR discount_value<=10000),
 CHECK((scope='STORE' AND cardinality(product_ids)=0 AND cardinality(category_ids)=0)
 OR (scope='PRODUCTS' AND cardinality(product_ids)>0 AND cardinality(category_ids)=0)
 OR (scope='CATEGORIES' AND cardinality(category_ids)>0 AND cardinality(product_ids)=0)),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id)
);
COMMENT ON COLUMN app.offers.discount_value IS 'PERCENT uses basis points (1000 = 10%); FIXED uses paise. Single best offer; merchandise only.';
ALTER TABLE app.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.offers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.offers FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
CREATE INDEX offers_business_store_idx ON app.offers(business_id,store_id);
CREATE INDEX offers_store_idx ON app.offers(store_id);
CREATE INDEX offers_store_current_idx ON app.offers(store_id,starts_at,ends_at) WHERE is_active;
CREATE FUNCTION api.save_offer(target_id uuid,target_store uuid,expected_version integer,offer_title text,offer_message text,
 kind text,amount bigint,start_time timestamptz,end_time timestamptz,target_scope text,products uuid[],categories uuid[],active boolean) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('offers:'||target_store::text,0));
 IF products IS NULL OR categories IS NULL OR array_position(products,NULL) IS NOT NULL OR array_position(categories,NULL) IS NOT NULL
 OR EXISTS(SELECT 1 FROM unnest(products) p WHERE NOT EXISTS(SELECT 1 FROM app.products x WHERE x.id=p AND x.business_id=actor.business_id))
 OR EXISTS(SELECT 1 FROM unnest(categories) c WHERE NOT EXISTS(SELECT 1 FROM app.categories x WHERE x.id=c AND x.business_id=actor.business_id))
 THEN RAISE EXCEPTION 'Invalid offer targets' USING ERRCODE='22023'; END IF;
 IF target_id IS NULL THEN
  INSERT INTO app.offers(business_id,store_id,title,message,discount_kind,discount_value,starts_at,ends_at,scope,product_ids,category_ids,is_active)
  VALUES(actor.business_id,target_store,btrim(offer_title),offer_message,kind,amount,start_time,end_time,target_scope,products,categories,active) RETURNING id INTO result;
 ELSE
  UPDATE app.offers SET title=btrim(offer_title),message=offer_message,discount_kind=kind,discount_value=amount,starts_at=start_time,ends_at=end_time,
  scope=target_scope,product_ids=products,category_ids=categories,is_active=active,version=version+1
  WHERE id=target_id AND business_id=actor.business_id AND store_id=target_store AND version=expected_version RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Offer changed or unavailable; reload' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'OFFER_SAVED',result,jsonb_build_object('active',active));
 RETURN result;
END $fn$;
CREATE FUNCTION api.store_offers(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'message',o.message,'kind',o.discount_kind,'value',o.discount_value,
 'endsAt',o.ends_at,'scope',o.scope,'products',o.product_ids,'categories',o.category_ids,
 'targetNames',CASE o.scope WHEN 'PRODUCTS' THEN (SELECT jsonb_agg(p.name ORDER BY p.name) FROM app.products p WHERE p.id=ANY(o.product_ids))
 WHEN 'CATEGORIES' THEN (SELECT jsonb_agg(c.name ORDER BY c.name) FROM app.categories c WHERE c.id=ANY(o.category_ids)) ELSE '[]'::jsonb END) ORDER BY o.ends_at,o.id),'[]'::jsonb)
 FROM app.offers o JOIN app.stores s ON s.id=o.store_id JOIN app.businesses b ON b.id=o.business_id
 WHERE o.store_id=target_store AND o.is_active AND o.starts_at<=statement_timestamp() AND o.ends_at>statement_timestamp()
 AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL
$fn$;
CREATE FUNCTION api.offer_workspace(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF app.current_staff_role()='EMPLOYEE' THEN RETURN jsonb_build_object('current',api.store_offers(target_store)); END IF;
 RETURN jsonb_build_object('offers',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.starts_at DESC,o.id) FROM app.offers o WHERE o.store_id=target_store),'[]'::jsonb),
 'products',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name) FROM app.products p WHERE p.business_id=actor.business_id AND p.is_active),'[]'::jsonb),
 'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name) FROM app.categories c WHERE c.business_id=actor.business_id AND app.category_is_visible(c.id,actor.business_id)),'[]'::jsonb));
END $fn$;
CREATE FUNCTION app.offer_discount(target_store uuid,lines jsonb,pricing_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH RECURSIVE ancestors AS (
 SELECT c.id,c.id AS ancestor,c.parent_id FROM app.categories c JOIN app.stores s ON s.business_id=c.business_id WHERE s.id=target_store
 UNION SELECT a.id,c.id,c.parent_id FROM ancestors a JOIN app.categories c ON c.id=a.parent_id
 ), candidates AS (
 SELECT o.*,COALESCE((SELECT sum((line->>'lineTotalPaise')::bigint) FROM jsonb_array_elements(lines) line
 WHERE o.scope='STORE' OR (o.scope='PRODUCTS' AND (line->>'productId')::uuid=ANY(o.product_ids))
 OR (o.scope='CATEGORIES' AND EXISTS(SELECT 1 FROM ancestors a WHERE a.id=(line->'snapshot'->>'categoryId')::uuid AND a.ancestor=ANY(o.category_ids)))),0)::bigint AS eligible
 FROM app.offers o WHERE o.store_id=target_store AND o.is_active AND o.starts_at<=pricing_at AND o.ends_at>pricing_at
 ), discounts AS (
 SELECT *,LEAST(eligible,CASE WHEN discount_kind='PERCENT' THEN floor(eligible::numeric*discount_value/10000)::bigint ELSE discount_value END) AS discount FROM candidates
 )
 SELECT jsonb_build_object('id',id,'title',title,'version',version,'kind',discount_kind,'value',discount_value,'eligibleSubtotalPaise',eligible,'discountPaise',discount)
 FROM discounts WHERE discount>0 ORDER BY discount DESC,id LIMIT 1
$fn$;
ALTER TABLE app.orders ADD COLUMN discount_paise bigint NOT NULL DEFAULT 0 CHECK(discount_paise>=0 AND discount_paise<=subtotal_paise);
ALTER TABLE app.orders ADD COLUMN offer_snapshot jsonb;
ALTER TABLE app.orders DROP CONSTRAINT orders_check;
ALTER TABLE app.orders ADD CONSTRAINT orders_total_paise_check CHECK(total_paise>0 AND total_paise=subtotal_paise-discount_paise+delivery_fee_paise);

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
 offer:=app.offer_discount(target_store,lines,pricing_at);
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
 INSERT INTO app.orders(business_id,store_id,order_number,fulfillment_method,fulfillment_snapshot,payment_method,subtotal_paise,delivery_fee_paise,total_paise,discount_paise,offer_snapshot)
 VALUES(business,target_store,'TFM-'||lpad(number_value,GREATEST(6,length(number_value)),'0'),payload->>'method',quote->'fulfillment',payload->>'paymentMethod',
 (quote->>'subtotalPaise')::bigint,(quote->>'deliveryFeePaise')::bigint,(quote->>'totalPaise')::bigint,(quote->>'discountPaise')::bigint,quote->'offer') RETURNING * INTO result;
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

REVOKE ALL ON FUNCTION api.save_offer(uuid,uuid,integer,text,text,text,bigint,timestamptz,timestamptz,text,uuid[],uuid[],boolean),api.store_offers(uuid),api.offer_workspace(uuid),app.offer_discount(uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.save_offer(uuid,uuid,integer,text,text,text,bigint,timestamptz,timestamptz,text,uuid[],uuid[],boolean),api.offer_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.store_offers(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION api.track_order(tracking_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE order_row app.orders;
BEGIN
 IF tracking_token IS NULL OR tracking_token !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT o.* INTO order_row FROM app.order_access_tokens t JOIN app.orders o ON o.id=t.order_id JOIN app.businesses b ON b.id=o.business_id
 WHERE t.token_digest=sha256(convert_to(tracking_token,'UTF8')) AND t.scope='TRACKING' AND t.revoked_at IS NULL
 AND t.expires_at>statement_timestamp() AND b.is_active AND b.deleted_at IS NULL;
 IF order_row.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('orderNumber',order_row.order_number,'status',order_row.status,'method',order_row.fulfillment_method,'placedAt',order_row.created_at,
 'subtotalPaise',order_row.subtotal_paise,'discountPaise',order_row.discount_paise,'deliveryFeePaise',order_row.delivery_fee_paise,'totalPaise',order_row.total_paise,'offerTitle',order_row.offer_snapshot->>'title',
 'paymentStatus',(SELECT status FROM app.payments WHERE order_id=order_row.id ORDER BY attempt_number DESC LIMIT 1),
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=order_row.id));
END;
$fn$;
NOTIFY pgrst,'reload schema';
COMMIT;
