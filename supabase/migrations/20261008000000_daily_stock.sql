-- Daily stock per store offering. Forward-only; no existing migration edited.
-- Stock lives in its own table so checkout's FOR SHARE locks on offerings never contend with stock writes.
-- Unit ("measure"): GRAMS for RAW_WEIGHT/NET_WEIGHT products, PACKS (units or trays) for UNIT/TRAY.
-- No row, or on_hand NULL, means unlimited (behaviour before this migration).
-- Lock order everywhere: product_store_settings (admin save / checkout quote) -> offering_stock by offering_id.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE TABLE app.offering_stock(
 offering_id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 store_id uuid NOT NULL,
 on_hand integer CHECK(on_hand BETWEEN 0 AND 100000000),
 measure text NOT NULL CHECK(measure IN ('GRAMS','PACKS')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,offering_id) REFERENCES app.product_store_settings(business_id,id),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id)
);
-- Append-only ledger: every admin set, order deduction and cancellation restore.
CREATE TABLE app.stock_movements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 store_id uuid NOT NULL,
 offering_id uuid NOT NULL,
 order_id uuid,
 kind text NOT NULL CHECK(kind IN ('SET','ORDER','CANCEL_RESTORE')),
 measure text NOT NULL CHECK(measure IN ('GRAMS','PACKS')),
 change integer,
 on_hand_before integer,
 on_hand_after integer,
 note text CHECK(length(note)<=200),
 actor_id uuid,
 actor_role text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='SET')=(order_id IS NULL)),
 FOREIGN KEY(business_id,offering_id) REFERENCES app.product_store_settings(business_id,id),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES app.staff_profiles(business_id,id)
);
CREATE INDEX stock_movements_order_idx ON app.stock_movements(business_id,order_id) WHERE order_id IS NOT NULL;
CREATE INDEX stock_movements_offering_idx ON app.stock_movements(business_id,offering_id,created_at DESC);
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON app.stock_movements FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
ALTER TABLE app.offering_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.offering_stock FORCE ROW LEVEL SECURITY;
ALTER TABLE app.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_movements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.offering_stock,app.stock_movements FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;

CREATE FUNCTION app.stock_measure(basis text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE WHEN basis IN ('UNIT','TRAY') THEN 'PACKS' ELSE 'GRAMS' END
$fn$;

-- Checks (reserve_for NULL) or deducts (reserve_for = new order) stock for every quote line.
-- Rows are locked in offering_id order so concurrent checkouts never deadlock; the re-read under
-- FOR UPDATE makes the on_hand >= qty test exact, so stock can never go negative.
CREATE FUNCTION app.apply_quote_stock(quote jsonb,reserve_for uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record; s app.offering_stock;
BEGIN
 FOR r IN SELECT (l->'snapshot'->>'offeringId')::uuid AS offering,min(l->>'pricingBasis') AS basis,min(l->'snapshot'->>'productName') AS name,
  sum(COALESCE((l->>'rawWeightGrams')::integer,(l->>'quantity')::integer))::integer AS qty
  FROM jsonb_array_elements(quote->'items') l GROUP BY 1 ORDER BY 1 LOOP
  IF reserve_for IS NULL THEN SELECT * INTO s FROM app.offering_stock WHERE offering_id=r.offering;
  ELSE SELECT * INTO s FROM app.offering_stock WHERE offering_id=r.offering FOR UPDATE; END IF;
  CONTINUE WHEN s.offering_id IS NULL OR s.on_hand IS NULL;
  IF s.measure<>app.stock_measure(r.basis) THEN RAISE EXCEPTION 'Not enough stock for %',r.name USING ERRCODE='22023',DETAIL='Stock unit changed; recount required'; END IF;
  IF s.on_hand<r.qty THEN RAISE EXCEPTION 'Not enough stock for %',r.name USING ERRCODE='22023'; END IF;
  IF reserve_for IS NOT NULL THEN
   UPDATE app.offering_stock SET on_hand=on_hand-r.qty,version=version+1,updated_at=clock_timestamp() WHERE offering_id=r.offering;
   INSERT INTO app.stock_movements(business_id,store_id,offering_id,order_id,kind,measure,change,on_hand_before,on_hand_after,actor_role)
   VALUES(s.business_id,s.store_id,s.offering_id,reserve_for,'ORDER',s.measure,-r.qty,s.on_hand,s.on_hand-r.qty,'CHECKOUT');
  END IF;
 END LOOP;
END;
$fn$;

-- Quotes fail early when stock is short; place_order re-checks under lock.
CREATE OR REPLACE FUNCTION api.checkout_quote(target_store uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE quote jsonb;
BEGIN
 quote:=app.build_order_quote(target_store,payload);
 PERFORM app.apply_quote_stock(quote,NULL);
 RETURN quote;
END;
$fn$;

-- Same as 20260929000000_store_offers.sql, plus the stock deduction after the lines are written.
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
 PERFORM app.apply_quote_stock(quote,result.id);
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

-- Any path that cancels an order puts its deducted stock back. Skipped (but recorded) when the
-- offering was switched to unlimited or to a different unit since the order.
CREATE FUNCTION app.restore_cancelled_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record; s app.offering_stock; actor uuid:=app.current_staff_profile_id(); role_name text:=COALESCE(app.current_staff_role(),'SYSTEM');
BEGIN
 FOR r IN SELECT offering_id,min(measure) AS measure,-sum(change)::integer AS qty FROM app.stock_movements
  WHERE business_id=NEW.business_id AND order_id=NEW.id AND kind='ORDER' GROUP BY offering_id ORDER BY offering_id LOOP
  SELECT * INTO s FROM app.offering_stock WHERE offering_id=r.offering_id FOR UPDATE;
  IF s.on_hand IS NULL OR s.measure<>r.measure THEN
   INSERT INTO app.stock_movements(business_id,store_id,offering_id,order_id,kind,measure,change,on_hand_before,on_hand_after,note,actor_id,actor_role)
   VALUES(NEW.business_id,NEW.store_id,r.offering_id,NEW.id,'CANCEL_RESTORE',r.measure,0,s.on_hand,s.on_hand,'Not restored: stock is unlimited or its unit changed',actor,role_name);
  ELSE
   UPDATE app.offering_stock SET on_hand=LEAST(on_hand+r.qty,100000000),version=version+1,updated_at=clock_timestamp() WHERE offering_id=r.offering_id;
   INSERT INTO app.stock_movements(business_id,store_id,offering_id,order_id,kind,measure,change,on_hand_before,on_hand_after,actor_id,actor_role)
   VALUES(NEW.business_id,NEW.store_id,r.offering_id,NEW.id,'CANCEL_RESTORE',r.measure,LEAST(r.qty,100000000-s.on_hand),s.on_hand,LEAST(s.on_hand+r.qty,100000000),actor,role_name);
  END IF;
 END LOOP;
 RETURN NULL;
END;
$fn$;
CREATE TRIGGER orders_cancel_restores_stock AFTER UPDATE OF status ON app.orders FOR EACH ROW
 WHEN (NEW.status='CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED') EXECUTE FUNCTION app.restore_cancelled_stock();

-- One atomic save for the Prices & Availability row: price/availability (existing rules) then stock.
-- expected_stock_version 0 = "no stock row yet". stock NULL = unlimited.
CREATE FUNCTION api.save_daily_product(offering uuid,expected_version integer,price_paise bigint,is_available boolean,expected_stock_version integer,stock integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; o app.product_store_settings; s app.offering_stock; unit text;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF expected_stock_version IS NULL OR expected_stock_version<0 OR (stock IS NOT NULL AND stock NOT BETWEEN 0 AND 100000000)
 THEN RAISE EXCEPTION 'Invalid stock value' USING ERRCODE='22023'; END IF;
 -- Validates access and locks the offering row first (same order as checkout).
 PERFORM api.update_daily_product(offering,expected_version,price_paise,is_available);
 SELECT * INTO o FROM app.product_store_settings WHERE id=offering AND business_id=actor.business_id;
 SELECT app.stock_measure(pricing_basis) INTO unit FROM app.products WHERE id=o.product_id;
 SELECT * INTO s FROM app.offering_stock WHERE offering_id=offering FOR UPDATE;
 IF COALESCE(s.version,0)<>expected_stock_version THEN RAISE EXCEPTION 'Stock changed since you loaded it; reload before saving' USING ERRCODE='40001'; END IF;
 IF s.offering_id IS NULL THEN
  IF stock IS NULL THEN RETURN; END IF;
  INSERT INTO app.offering_stock(offering_id,business_id,store_id,on_hand,measure) VALUES(offering,o.business_id,o.store_id,stock,unit);
 ELSIF s.on_hand IS NOT DISTINCT FROM stock AND s.measure=unit THEN RETURN;
 ELSE
  UPDATE app.offering_stock SET on_hand=stock,measure=unit,version=version+1,updated_at=clock_timestamp() WHERE offering_id=offering;
 END IF;
 INSERT INTO app.stock_movements(business_id,store_id,offering_id,kind,measure,change,on_hand_before,on_hand_after,actor_id,actor_role)
 VALUES(o.business_id,o.store_id,offering,'SET',unit,CASE WHEN s.measure=unit THEN stock-s.on_hand END,CASE WHEN s.measure=unit THEN s.on_hand END,stock,actor.id,app.current_staff_role());
 PERFORM app.core_audit(o.business_id,o.store_id,actor.id,app.current_staff_role(),'STOCK_SET',offering,
  jsonb_build_object('before',s.on_hand,'beforeMeasure',s.measure,'after',stock,'measure',unit));
END;
$fn$;

-- Same as 20260928010000_catalogue_sale_units.sql, plus stock fields.
CREATE OR REPLACE FUNCTION api.daily_products(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'name',p.name,'category',c.name,
 'pricePaise',COALESCE(price.unit_price_paise,price.price_per_kg_paise),'pricingBasis',p.pricing_basis,'priceUnitGrams',p.price_unit_grams,'unitsPerPack',p.units_per_pack,'available',o.available,'version',o.version,'updatedAt',o.updated_at,
 'stock',CASE WHEN st.measure=app.stock_measure(p.pricing_basis) THEN st.on_hand END,'stockVersion',COALESCE(st.version,0),
 'stockNeedsRecount',st.on_hand IS NOT NULL AND st.measure<>app.stock_measure(p.pricing_basis)) ORDER BY c.sort_order,p.name)
 FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id
 JOIN app.categories c ON c.id=p.category_id
 LEFT JOIN app.offering_stock st ON st.offering_id=o.id
 LEFT JOIN LATERAL (SELECT price_per_kg_paise,unit_price_paise FROM app.product_prices pr WHERE pr.offering_id=o.id ORDER BY offering_version DESC LIMIT 1) price ON true
 WHERE o.business_id=actor.business_id AND o.store_id=target_store AND p.is_active AND c.is_active AND o.is_active AND app.category_is_visible(p.category_id,p.business_id)), '[]'::jsonb);
END;
$fn$;

-- Same as 20260928010000_catalogue_sale_units.sql, plus: sold out when tracked stock is below the
-- smallest sellable quantity; 'stockLeft' only when low (<=2 kg or <=2 packs) so exact stock stays private.
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
 'pricingBasis',p.pricing_basis,'pricePaise',COALESCE(price.unit_price_paise,price.price_per_kg_paise),'priceUnitGrams',p.price_unit_grams,'unitsPerPack',p.units_per_pack,'saleQuantities',p.sale_quantities,'orderable',true,
 'available',o.available AND NOT stock.sold_out,
 'stockLeft',CASE WHEN NOT stock.sold_out AND stock.on_hand<=CASE WHEN stock.measure='GRAMS' THEN 2000 ELSE 2 END THEN stock.on_hand END,
 'featured',COALESCE(o.featured_override,p.featured),
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
 LEFT JOIN app.offering_stock st ON st.offering_id=o.id AND st.on_hand IS NOT NULL
 CROSS JOIN LATERAL (SELECT st.on_hand,st.measure,
  st.on_hand IS NOT NULL AND (st.measure<>app.stock_measure(p.pricing_basis) OR st.on_hand<COALESCE(
   CASE WHEN p.pricing_basis='RAW_WEIGHT' THEN (SELECT min(w.raw_weight_grams) FROM app.product_allowed_weights w WHERE w.product_id=p.id AND w.is_active)
   ELSE (SELECT min(q::integer) FROM jsonb_array_elements_text(p.sale_quantities) q) END,1)) AS sold_out) stock
 WHERE o.business_id=business AND o.store_id=target_store AND o.is_active AND p.is_active AND app.category_is_visible(c.id,business)
 AND (category_filter IS NULL OR p.category_id IN (SELECT id FROM selected))
 AND (p.pricing_basis<>'RAW_WEIGHT' OR EXISTS(SELECT 1 FROM app.product_allowed_weights w WHERE w.product_id=p.id AND w.is_active))
 AND EXISTS(SELECT 1 FROM app.product_preparation_options pp JOIN app.preparation_options opt ON opt.id=pp.preparation_option_id WHERE pp.product_id=p.id AND pp.is_active AND opt.is_active)
 ),'[]'::jsonb));
END;
$fn$;

-- Same as 20260926200000_core_orders_payments_audit.sql, plus the order's stock movements.
CREATE OR REPLACE FUNCTION api.order_detail(target_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_order_staff(target_order);
 RETURN jsonb_build_object('order',(SELECT to_jsonb(o) FROM app.orders o WHERE id=target_order),
 'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY line_number) FROM app.order_items i WHERE order_id=target_order),
 'fulfillment',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY created_at) FROM app.order_item_fulfillment f WHERE order_id=target_order),'[]'::jsonb),
 'payments',(SELECT jsonb_agg(jsonb_build_object('id',id,'method',method,'status',status,'amountPaise',amount_paise,'refundedPaise',refunded_paise,'version',version)) FROM app.payments WHERE order_id=target_order),
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at,'actorId',actor_id) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=target_order),
 'stock',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'productName',p.name,'measure',m.measure,'change',m.change,'before',m.on_hand_before,'after',m.on_hand_after,'note',m.note,'at',m.created_at) ORDER BY m.created_at,m.id)
  FROM app.stock_movements m JOIN app.product_store_settings o ON o.id=m.offering_id JOIN app.products p ON p.id=o.product_id
  WHERE m.business_id=actor.business_id AND m.order_id=target_order),'[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION app.stock_measure(text),app.apply_quote_stock(jsonb,uuid),app.restore_cancelled_stock(),
 api.save_daily_product(uuid,integer,bigint,boolean,integer,integer)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.save_daily_product(uuid,integer,bigint,boolean,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
