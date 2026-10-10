-- Delivery slots and same-day stock. Forward-only; no existing migration edited.
-- Slots: per store, in India wall-clock time. Customers pick a date (today and the next two days) and a slot; checkout
-- checks the slot is active, before its cutoff (same day only) and not full, under a row lock on the slot so two
-- checkouts can never overfill it. The chosen slot is part of the quote digest and the order's fulfillment snapshot.
-- Stock: only orders for today reserve (deduct) stock; orders for a later day do not. "Reserved" = today's open orders
-- not yet dispatched (PLACED, CONFIRMED, PREPARING, READY). The morning stock entry is the physical count in the shop;
-- the server stores available = count - reserved.
-- New table: RLS enabled and forced, no policies, no table grants; reached only through the role-checked functions below.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE TABLE app.delivery_slots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 store_id uuid NOT NULL,
 name text NOT NULL CHECK(app.valid_plain_text(name,40)),
 starts_at time NOT NULL,
 ends_at time NOT NULL,
 cutoff_at time NOT NULL,
 max_orders integer NOT NULL CHECK(max_orders BETWEEN 1 AND 1000),
 is_active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid,
 CHECK(starts_at<ends_at AND cutoff_at<ends_at),
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,updated_by) REFERENCES app.staff_profiles(business_id,id)
);
CREATE INDEX delivery_slots_store_idx ON app.delivery_slots(business_id,store_id,starts_at);
ALTER TABLE app.delivery_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.delivery_slots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.delivery_slots FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;

-- Defaults for every existing store: Morning 07-11 (order by 09), Evening 16-20 (order by 18), 20 orders each.
INSERT INTO app.delivery_slots(business_id,store_id,name,starts_at,ends_at,cutoff_at,max_orders)
SELECT s.business_id,s.id,v.name,v.starts_at,v.ends_at,v.cutoff_at,20 FROM app.stores s
CROSS JOIN (VALUES ('Morning','07:00'::time,'11:00'::time,'09:00'::time),('Evening','16:00'::time,'20:00'::time,'18:00'::time)) v(name,starts_at,ends_at,cutoff_at)
WHERE s.deleted_at IS NULL;

-- Orders made before this migration have no slot; their day is the IST day they were placed.
ALTER TABLE app.orders ADD COLUMN delivery_slot_id uuid, ADD COLUMN delivery_date date,
 ADD CONSTRAINT orders_slot_pair CHECK((delivery_slot_id IS NULL)=(delivery_date IS NULL)),
 ADD CONSTRAINT orders_delivery_slot_fk FOREIGN KEY(business_id,delivery_slot_id) REFERENCES app.delivery_slots(business_id,id);
CREATE INDEX orders_slot_day_idx ON app.orders(business_id,store_id,delivery_date,delivery_slot_id) WHERE delivery_date IS NOT NULL;

CREATE FUNCTION app.ist_today() RETURNS date LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
$fn$;

-- The customer's slot choice {"id","date"} checked against the store's slots. NULL choice is allowed only when the
-- store has no active slots. With lock, the slot row is locked so the capacity count is exact until commit.
CREATE FUNCTION app.check_delivery_slot(target_store uuid,business uuid,choice jsonb,lock boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s app.delivery_slots; d date; today date:=app.ist_today(); booked integer;
BEGIN
 IF choice IS NULL OR choice='null'::jsonb THEN
  IF EXISTS(SELECT 1 FROM app.delivery_slots WHERE business_id=business AND store_id=target_store AND is_active)
  THEN RAISE EXCEPTION 'Delivery slot unavailable: choose a slot' USING ERRCODE='22023'; END IF;
  RETURN NULL;
 END IF;
 IF jsonb_typeof(choice) IS DISTINCT FROM 'object' OR (choice-ARRAY['id','date'])<>'{}'::jsonb
 OR jsonb_typeof(choice->'id') IS DISTINCT FROM 'string' OR choice->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR jsonb_typeof(choice->'date') IS DISTINCT FROM 'string' OR choice->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION 'Invalid checkout choices' USING ERRCODE='22023'; END IF;
 BEGIN d:=(choice->>'date')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid checkout choices' USING ERRCODE='22023'; END;
 IF d<today OR d>today+2 THEN RAISE EXCEPTION 'Delivery slot unavailable: date' USING ERRCODE='22023'; END IF;
 IF lock THEN SELECT * INTO s FROM app.delivery_slots WHERE id=(choice->>'id')::uuid AND business_id=business AND store_id=target_store FOR UPDATE;
 ELSE SELECT * INTO s FROM app.delivery_slots WHERE id=(choice->>'id')::uuid AND business_id=business AND store_id=target_store; END IF;
 IF s.id IS NULL OR NOT s.is_active THEN RAISE EXCEPTION 'Delivery slot unavailable: closed' USING ERRCODE='22023'; END IF;
 IF d=today AND (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::time>=s.cutoff_at THEN RAISE EXCEPTION 'Delivery slot unavailable: closed' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO booked FROM app.orders WHERE business_id=business AND store_id=target_store AND delivery_slot_id=s.id AND delivery_date=d AND status<>'CANCELLED';
 IF booked>=s.max_orders THEN RAISE EXCEPTION 'Delivery slot unavailable: full' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('id',s.id,'date',d,'name',s.name,'startsAt',to_char(s.starts_at,'HH24:MI'),'endsAt',to_char(s.ends_at,'HH24:MI'));
END $fn$;

-- The existing quote (unchanged) plus the checked slot in fulfillment; the digest is recomputed so it covers the slot.
CREATE FUNCTION app.build_slotted_quote(target_store uuid,payload jsonb,lock boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE quote jsonb; slot jsonb;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid checkout choices' USING ERRCODE='22023'; END IF;
 quote:=app.build_order_quote(target_store,payload-'slot');
 slot:=app.check_delivery_slot(target_store,(quote->>'businessId')::uuid,payload->'slot',lock);
 IF slot IS NULL THEN RETURN quote; END IF;
 quote:=jsonb_set(quote-'quoteDigest','{fulfillment,slot}',slot);
 RETURN quote||jsonb_build_object('quoteDigest',encode(sha256(convert_to(quote::text,'UTF8')),'hex'));
END $fn$;

-- Today's open, not-yet-dispatched order quantities per offering, in stock units (grams or packs).
CREATE FUNCTION app.reserved_today(business uuid,target_store uuid) RETURNS TABLE(offering_id uuid,measure text,qty bigint)
LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT (i.product_snapshot->>'offeringId')::uuid,app.stock_measure(i.pricing_basis),sum(COALESCE(i.raw_weight_grams,i.sale_quantity))::bigint
 FROM app.orders o JOIN app.order_items i ON i.business_id=o.business_id AND i.order_id=o.id
 WHERE o.business_id=business AND o.store_id=target_store AND o.status IN ('PLACED','CONFIRMED','PREPARING','READY')
 AND (o.delivery_date=app.ist_today() OR (o.delivery_date IS NULL
  AND o.created_at>=app.ist_today()::timestamp AT TIME ZONE 'Asia/Kolkata' AND o.created_at<(app.ist_today()+1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
 AND i.product_snapshot ? 'offeringId'
 GROUP BY 1,2
$fn$;

-- Same as 20261008000000_daily_stock.sql, plus the slot; only same-day orders are checked against stock.
CREATE OR REPLACE FUNCTION api.checkout_quote(target_store uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE quote jsonb;
BEGIN
 quote:=app.build_slotted_quote(target_store,payload,false);
 IF COALESCE((quote->'fulfillment'->'slot'->>'date')::date,app.ist_today())=app.ist_today() THEN PERFORM app.apply_quote_stock(quote,NULL); END IF;
 RETURN quote;
END;
$fn$;

-- Same as 20261008000000_daily_stock.sql, plus: the slot is re-checked under lock and stored on the order,
-- and stock is deducted only for same-day orders.
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
 quote:=app.build_slotted_quote(target_store,payload,true);
 IF quote->>'quoteDigest' IS DISTINCT FROM accepted_quote_digest THEN RAISE EXCEPTION 'Quote changed; review a fresh quote' USING ERRCODE='40001'; END IF;
 number_value:=nextval('app.order_number_seq'::regclass)::text;
 INSERT INTO app.orders(business_id,store_id,order_number,fulfillment_method,fulfillment_snapshot,payment_method,subtotal_paise,delivery_fee_paise,total_paise,discount_paise,offer_snapshot,delivery_slot_id,delivery_date)
 VALUES(business,target_store,'TFM-'||lpad(number_value,GREATEST(6,length(number_value)),'0'),payload->>'method',quote->'fulfillment',payload->>'paymentMethod',
 (quote->>'subtotalPaise')::bigint,(quote->>'deliveryFeePaise')::bigint,(quote->>'totalPaise')::bigint,(quote->>'discountPaise')::bigint,quote->'offer',
 (quote->'fulfillment'->'slot'->>'id')::uuid,(quote->'fulfillment'->'slot'->>'date')::date) RETURNING * INTO result;
 FOR line IN SELECT value FROM jsonb_array_elements(quote->'items') LOOP
  line_no:=line_no+1;
  INSERT INTO app.order_items(business_id,order_id,line_number,product_id,preparation_id,price_id,product_snapshot,raw_weight_grams,price_per_kg_paise,line_total_paise,instructions,pricing_basis,sale_quantity,unit_price_paise,price_unit_grams,units_per_pack)
  VALUES(business,result.id,line_no,(line->>'productId')::uuid,(line->>'preparationId')::uuid,(line->>'priceId')::uuid,line->'snapshot',
   (line->>'rawWeightGrams')::integer,(line->>'pricePerKgPaise')::bigint,(line->>'lineTotalPaise')::bigint,line->>'instructions',line->>'pricingBasis',(line->>'quantity')::integer,CASE WHEN line->>'pricingBasis'<>'RAW_WEIGHT' THEN (line->>'pricePaise')::bigint END,(line->>'priceUnitGrams')::integer,(line->>'unitsPerPack')::integer);
 END LOOP;
 IF COALESCE(result.delivery_date,app.ist_today())=app.ist_today() THEN PERFORM app.apply_quote_stock(quote,result.id); END IF;
 INSERT INTO app.payments(business_id,order_id,method,amount_paise) VALUES(business,result.id,result.payment_method,result.total_paise) RETURNING id INTO payment;
 INSERT INTO app.payment_events(business_id,order_id,payment_id,actor_role,kind,to_status,amount_paise)
 VALUES(business,result.id,payment,'CHECKOUT','PAYMENT_CREATED','PENDING',result.total_paise);
 INSERT INTO app.order_access_tokens(business_id,order_id,token_digest,expires_at)
 VALUES(business,result.id,decode(tracking_digest,'hex'),tracking_expires_at);
 INSERT INTO app.order_status_history(business_id,order_id,to_status,actor_role) VALUES(business,result.id,'PLACED','CHECKOUT');
 UPDATE app.order_requests r SET order_id=result.id WHERE r.business_id=business AND r.store_id=target_store AND r.request_id=place_order.request_id;
 PERFORM app.core_audit(business,target_store,NULL,'CHECKOUT','ORDER_PLACED',result.id,jsonb_build_object('totalPaise',result.total_paise,'method',result.fulfillment_method,'requestId',request_id,'slotId',result.delivery_slot_id,'slotDate',result.delivery_date));
 RETURN jsonb_build_object('id',result.id,'orderNumber',result.order_number,'totalPaise',result.total_paise,'replayed',false);
END;
$fn$;

-- Replaces 20261008000000_daily_stock.sql's version. A cancelled order gives stock back only when its quantity is still
-- held in on_hand: today's order, not yet dispatched, and either deducted since the last stock entry or counted as
-- reserved by today's stock entry. Later-day orders never held stock. Skips are recorded as before.
CREATE OR REPLACE FUNCTION app.restore_cancelled_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record; s app.offering_stock; actor uuid:=app.current_staff_profile_id(); role_name text:=COALESCE(app.current_staff_role(),'SYSTEM');
 today date:=app.ist_today(); service_day date:=COALESCE(NEW.delivery_date,(NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date);
 last_set timestamptz; deducted boolean; held boolean; why text;
BEGIN
 IF service_day>today THEN RETURN NULL; END IF;
 FOR r IN SELECT (i.product_snapshot->>'offeringId')::uuid AS offering_id,app.stock_measure(min(i.pricing_basis)) AS measure,sum(COALESCE(i.raw_weight_grams,i.sale_quantity))::integer AS qty
  FROM app.order_items i WHERE i.business_id=NEW.business_id AND i.order_id=NEW.id AND i.product_snapshot ? 'offeringId' GROUP BY 1 ORDER BY 1 LOOP
  SELECT * INTO s FROM app.offering_stock WHERE offering_id=r.offering_id FOR UPDATE;
  SELECT max(created_at) INTO last_set FROM app.stock_movements WHERE business_id=NEW.business_id AND offering_id=r.offering_id AND kind='SET';
  SELECT EXISTS(SELECT 1 FROM app.stock_movements WHERE business_id=NEW.business_id AND order_id=NEW.id AND offering_id=r.offering_id AND kind='ORDER'),
   EXISTS(SELECT 1 FROM app.stock_movements WHERE business_id=NEW.business_id AND order_id=NEW.id AND offering_id=r.offering_id AND kind='ORDER' AND (last_set IS NULL OR created_at>last_set))
   OR (service_day=today AND last_set>=today::timestamp AT TIME ZONE 'Asia/Kolkata' AND NEW.created_at<last_set)
  INTO deducted,held;
  CONTINUE WHEN NOT deducted AND NOT held;
  why:=CASE WHEN service_day<today THEN 'Not restored: order was for an earlier day'
   WHEN OLD.status NOT IN ('PLACED','CONFIRMED','PREPARING','READY') THEN 'Not restored: order had already left the shop'
   WHEN s.on_hand IS NULL OR s.measure<>r.measure THEN 'Not restored: stock is unlimited or its unit changed'
   WHEN NOT held THEN 'Not restored: stock was recounted after this order' END;
  IF why IS NOT NULL THEN
   INSERT INTO app.stock_movements(business_id,store_id,offering_id,order_id,kind,measure,change,on_hand_before,on_hand_after,note,actor_id,actor_role)
   VALUES(NEW.business_id,NEW.store_id,r.offering_id,NEW.id,'CANCEL_RESTORE',r.measure,0,s.on_hand,s.on_hand,why,actor,role_name);
  ELSE
   UPDATE app.offering_stock SET on_hand=LEAST(on_hand+r.qty,100000000),version=version+1,updated_at=clock_timestamp() WHERE offering_id=r.offering_id;
   INSERT INTO app.stock_movements(business_id,store_id,offering_id,order_id,kind,measure,change,on_hand_before,on_hand_after,actor_id,actor_role)
   VALUES(NEW.business_id,NEW.store_id,r.offering_id,NEW.id,'CANCEL_RESTORE',r.measure,LEAST(r.qty,100000000-s.on_hand),s.on_hand,LEAST(s.on_hand+r.qty,100000000),actor,role_name);
  END IF;
 END LOOP;
 RETURN NULL;
END;
$fn$;

-- Replaces 20261008000000_daily_stock.sql's version. "stock" is now the physical count in the shop (blank = unlimited);
-- the stored on_hand is what is still available: count minus today's reserved quantity, never below 0.
CREATE OR REPLACE FUNCTION api.save_daily_product(offering uuid,expected_version integer,price_paise bigint,is_available boolean,expected_stock_version integer,stock integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; o app.product_store_settings; s app.offering_stock; unit text; held bigint; available integer;
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
 -- Read after the stock row lock: a checkout that deducted before us has committed and is counted here.
 SELECT COALESCE(sum(r.qty),0) INTO held FROM app.reserved_today(o.business_id,o.store_id) r WHERE r.offering_id=offering AND r.measure=unit;
 available:=CASE WHEN stock IS NOT NULL THEN GREATEST(stock-held,0)::integer END;
 IF s.offering_id IS NULL THEN
  IF stock IS NULL THEN RETURN; END IF;
  INSERT INTO app.offering_stock(offering_id,business_id,store_id,on_hand,measure) VALUES(offering,o.business_id,o.store_id,available,unit);
 ELSIF s.on_hand IS NOT DISTINCT FROM available AND s.measure=unit THEN RETURN;
 ELSE
  UPDATE app.offering_stock SET on_hand=available,measure=unit,version=version+1,updated_at=clock_timestamp() WHERE offering_id=offering;
 END IF;
 INSERT INTO app.stock_movements(business_id,store_id,offering_id,kind,measure,change,on_hand_before,on_hand_after,note,actor_id,actor_role)
 VALUES(o.business_id,o.store_id,offering,'SET',unit,CASE WHEN s.measure=unit THEN available-s.on_hand END,CASE WHEN s.measure=unit THEN s.on_hand END,available,
  CASE WHEN stock IS NOT NULL THEN 'In shop '||stock||', reserved '||held END,actor.id,app.current_staff_role());
 PERFORM app.core_audit(o.business_id,o.store_id,actor.id,app.current_staff_role(),'STOCK_SET',offering,
  jsonb_build_object('before',s.on_hand,'beforeMeasure',s.measure,'after',available,'inShop',stock,'reserved',held,'measure',unit));
END;
$fn$;

-- Same as 20261008000000_daily_stock.sql, plus 'reserved' (today's open orders not yet dispatched, in stock units).
-- 'stock' stays the available quantity; in shop = stock + reserved.
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
 'stockNeedsRecount',st.on_hand IS NOT NULL AND st.measure<>app.stock_measure(p.pricing_basis),
 'reserved',COALESCE(rv.qty,0)) ORDER BY c.sort_order,p.name)
 FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id
 JOIN app.categories c ON c.id=p.category_id
 LEFT JOIN app.offering_stock st ON st.offering_id=o.id
 LEFT JOIN app.reserved_today(actor.business_id,target_store) rv ON rv.offering_id=o.id AND rv.measure=app.stock_measure(p.pricing_basis)
 LEFT JOIN LATERAL (SELECT price_per_kg_paise,unit_price_paise FROM app.product_prices pr WHERE pr.offering_id=o.id ORDER BY offering_version DESC LIMIT 1) price ON true
 WHERE o.business_id=actor.business_id AND o.store_id=target_store AND p.is_active AND c.is_active AND o.is_active AND app.category_is_visible(p.category_id,p.business_id)), '[]'::jsonb);
END;
$fn$;

-- Checkout (server-only connection): today and the next two days with each active slot's status.
-- Status only (open / closed / full); booked counts and capacity stay private. [] = the store has no active slots.
CREATE FUNCTION api.delivery_slot_options(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE business uuid; today date:=app.ist_today(); now_time time:=(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::time;
BEGIN
 SELECT s.business_id INTO business FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL;
 IF business IS NULL OR NOT EXISTS(SELECT 1 FROM app.delivery_slots WHERE business_id=business AND store_id=target_store AND is_active) THEN RETURN '[]'::jsonb; END IF;
 RETURN (SELECT jsonb_agg(jsonb_build_object('date',d.day,'slots',(SELECT jsonb_agg(jsonb_build_object('id',ds.id,'name',ds.name,
  'startsAt',to_char(ds.starts_at,'HH24:MI'),'endsAt',to_char(ds.ends_at,'HH24:MI'),'cutoffAt',to_char(ds.cutoff_at,'HH24:MI'),
  'status',CASE WHEN d.day=today AND now_time>=ds.cutoff_at THEN 'closed'
   WHEN (SELECT count(*) FROM app.orders o WHERE o.business_id=business AND o.store_id=target_store AND o.delivery_slot_id=ds.id AND o.delivery_date=d.day AND o.status<>'CANCELLED')>=ds.max_orders THEN 'full'
   ELSE 'open' END) ORDER BY ds.starts_at,ds.name)
  FROM app.delivery_slots ds WHERE ds.business_id=business AND ds.store_id=target_store AND ds.is_active)) ORDER BY d.day)
 FROM (SELECT today+n AS day FROM generate_series(0,2) n) d);
END $fn$;

-- Settings → Delivery slots (ADMIN and OWNER).
CREATE FUNCTION api.delivery_slots(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'startsAt',to_char(starts_at,'HH24:MI'),'endsAt',to_char(ends_at,'HH24:MI'),
  'cutoffAt',to_char(cutoff_at,'HH24:MI'),'maxOrders',max_orders,'active',is_active,'version',version) ORDER BY is_active DESC,starts_at,name)
 FROM app.delivery_slots WHERE business_id=actor.business_id AND store_id=target_store),'[]'::jsonb);
END $fn$;
CREATE FUNCTION api.save_delivery_slot(target_store uuid,target_slot uuid,expected_version integer,slot_name text,starts text,ends text,cutoff text,capacity integer,active boolean) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid; hhmm text:='^([01][0-9]|2[0-3]):[0-5][0-9]$';
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF slot_name IS NULL OR NOT app.valid_plain_text(slot_name,40) OR starts IS NULL OR starts !~ hhmm OR ends IS NULL OR ends !~ hhmm
 OR cutoff IS NULL OR cutoff !~ hhmm OR capacity IS NULL OR capacity NOT BETWEEN 1 AND 1000 OR active IS NULL
 OR starts::time>=ends::time OR cutoff::time>=ends::time
 THEN RAISE EXCEPTION 'Invalid delivery slot' USING ERRCODE='22023'; END IF;
 IF target_slot IS NULL THEN
  INSERT INTO app.delivery_slots(business_id,store_id,name,starts_at,ends_at,cutoff_at,max_orders,is_active,updated_by)
  VALUES(actor.business_id,target_store,slot_name,starts::time,ends::time,cutoff::time,capacity,active,actor.id) RETURNING id INTO result;
 ELSE
  UPDATE app.delivery_slots d SET name=slot_name,starts_at=starts::time,ends_at=ends::time,cutoff_at=cutoff::time,max_orders=capacity,is_active=active,
   version=d.version+1,updated_at=clock_timestamp(),updated_by=actor.id
  WHERE d.id=target_slot AND d.business_id=actor.business_id AND d.store_id=target_store AND d.version=expected_version RETURNING d.id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Delivery slot changed; reload' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'DELIVERY_SLOT_SAVED',result,
  jsonb_build_object('name',slot_name,'startsAt',starts,'endsAt',ends,'cutoffAt',cutoff,'maxOrders',capacity,'active',active));
 RETURN result;
END $fn$;

-- Same as 20261009030000_admin_dashboard.sql, except: today's slots are the store's real delivery slots (plus orders
-- without a slot), and 'scheduled' lists later-day orders by date and slot with the quantity per product to prepare.
CREATE OR REPLACE FUNCTION api.admin_dashboard(target_store uuid,period text DEFAULT 'today') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; staff_role text; history_days integer; today date:=app.ist_today();
 day_start timestamptz; span interval; from_at timestamptz; until_at timestamptz;
 needs jsonb; slots jsonb; scheduled jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF period IS NULL OR period NOT IN ('today','yesterday','7d','30d') THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
 staff_role:=app.current_staff_role();
 SELECT employee_operational_history_days INTO history_days FROM app.business_settings WHERE business_id=actor.business_id;
 day_start:=today::timestamp AT TIME ZONE 'Asia/Kolkata';

 -- Open orders by status; employees count only what their Orders list shows.
 SELECT jsonb_object_agg(s.status,(SELECT count(*) FROM app.orders o WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.status=s.status
  AND (staff_role<>'EMPLOYEE' OR o.created_at>=statement_timestamp()-make_interval(days=>history_days))))
 INTO needs FROM unnest(ARRAY['PLACED','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY']) s(status);

 -- Today's non-cancelled orders per slot (active slots, and inactive ones that still have orders today),
 -- then today's orders placed without a slot.
 SELECT COALESCE(jsonb_agg(to_jsonb(t)-'ord' ORDER BY t.ord,t."startsAt",t.name),'[]'::jsonb) INTO slots FROM (
  SELECT 0 AS ord,ds.id,ds.name,to_char(ds.starts_at,'HH24:MI') AS "startsAt",to_char(ds.ends_at,'HH24:MI') AS "endsAt",ds.max_orders AS "maxOrders",
   count(o.id) AS booked,count(o.id) FILTER(WHERE o.fulfillment_method='HOME_DELIVERY') AS delivery,
   count(o.id) FILTER(WHERE o.fulfillment_method='STORE_PICKUP') AS pickup,count(o.id) FILTER(WHERE o.status<>'DELIVERED') AS open
  FROM app.delivery_slots ds LEFT JOIN app.orders o ON o.business_id=ds.business_id AND o.store_id=ds.store_id AND o.delivery_slot_id=ds.id
   AND o.delivery_date=today AND o.status<>'CANCELLED'
   AND (staff_role<>'EMPLOYEE' OR o.created_at>=statement_timestamp()-make_interval(days=>history_days))
  WHERE ds.business_id=actor.business_id AND ds.store_id=target_store
  GROUP BY ds.id HAVING ds.is_active OR count(o.id)>0
  UNION ALL
  SELECT 1,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::integer,count(*),count(*) FILTER(WHERE o.fulfillment_method='HOME_DELIVERY'),
   count(*) FILTER(WHERE o.fulfillment_method='STORE_PICKUP'),count(*) FILTER(WHERE o.status<>'DELIVERED')
  FROM app.orders o WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.delivery_date IS NULL AND o.status<>'CANCELLED'
   AND o.created_at>=day_start AND o.created_at<day_start+interval '1 day'
   AND (staff_role<>'EMPLOYEE' OR o.created_at>=statement_timestamp()-make_interval(days=>history_days))
  HAVING count(*)>0) t;

 -- Later days: orders per date and slot, with what to prepare (grams for weighed items, packs for units/trays).
 SELECT COALESCE(jsonb_agg(jsonb_build_object('date',g.delivery_date,'slotId',g.id,'name',g.name,'startsAt',to_char(g.starts_at,'HH24:MI'),'endsAt',to_char(g.ends_at,'HH24:MI'),
  'orders',g.orders,'delivery',g.delivery,'pickup',g.pickup,
  'products',(SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.name),'[]'::jsonb) FROM
   (SELECT max(i.product_snapshot->>'productName') AS name,i.pricing_basis AS "pricingBasis",max(i.units_per_pack) AS "unitsPerPack",sum(COALESCE(i.raw_weight_grams,i.sale_quantity)) AS quantity
    FROM app.order_items i JOIN app.orders o ON o.business_id=i.business_id AND o.id=i.order_id
    WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.delivery_slot_id=g.id AND o.delivery_date=g.delivery_date AND o.status<>'CANCELLED'
     AND (staff_role<>'EMPLOYEE' OR o.created_at>=statement_timestamp()-make_interval(days=>history_days))
    GROUP BY i.product_id,i.pricing_basis) q)) ORDER BY g.delivery_date,g.starts_at,g.name),'[]'::jsonb) INTO scheduled
 FROM (SELECT o.delivery_date,ds.id,ds.name,ds.starts_at,ds.ends_at,count(*) AS orders,
   count(*) FILTER(WHERE o.fulfillment_method='HOME_DELIVERY') AS delivery,count(*) FILTER(WHERE o.fulfillment_method='STORE_PICKUP') AS pickup
  FROM app.orders o JOIN app.delivery_slots ds ON ds.business_id=o.business_id AND ds.id=o.delivery_slot_id
  WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.delivery_date>today AND o.status<>'CANCELLED'
   AND (staff_role<>'EMPLOYEE' OR o.created_at>=statement_timestamp()-make_interval(days=>history_days))
  GROUP BY o.delivery_date,ds.id) g;

 IF staff_role='EMPLOYEE' THEN RETURN jsonb_build_object('today',today,'needsAction',needs,'slots',slots,'scheduled',scheduled); END IF;

 span:=CASE period WHEN '7d' THEN interval '7 days' WHEN '30d' THEN interval '30 days' ELSE interval '1 day' END;
 from_at:=CASE period WHEN 'yesterday' THEN day_start-interval '1 day' ELSE day_start+interval '1 day'-span END;
 until_at:=CASE period WHEN 'yesterday' THEN day_start ELSE statement_timestamp() END;

 RETURN jsonb_build_object('today',today,'needsAction',needs,'slots',slots,'scheduled',scheduled,'period',period,'from',from_at,'until',until_at,
 -- Revenue and averages exclude cancelled orders; money uses each order's latest payment attempt.
 'summary',(WITH w(name,f,u) AS (VALUES ('current',from_at,until_at),('previous',from_at-span,until_at-span)),
  o AS (SELECT w.name,o.id,o.total_paise,p.method,p.status AS pay_status,p.amount_paise,p.refunded_paise FROM w
   LEFT JOIN app.orders o ON o.business_id=actor.business_id AND o.store_id=target_store AND o.status<>'CANCELLED' AND o.created_at>=w.f AND o.created_at<w.u
   LEFT JOIN LATERAL (SELECT method,status,amount_paise,refunded_paise FROM app.payments WHERE business_id=actor.business_id AND order_id=o.id ORDER BY attempt_number DESC LIMIT 1) p ON true)
  SELECT jsonb_object_agg(name,jsonb_build_object('orders',n,'revenuePaise',revenue,'averagePaise',CASE WHEN n>0 THEN round(revenue::numeric/n) ELSE 0 END,
   'collectedPaise',collected,'cashCollectedPaise',cash,'pendingPaise',pending))
  FROM (SELECT name,count(id) AS n,COALESCE(sum(total_paise),0) AS revenue,
   COALESCE(sum(amount_paise-refunded_paise) FILTER(WHERE pay_status IN ('PAID','REFUNDED')),0) AS collected,
   COALESCE(sum(amount_paise-refunded_paise) FILTER(WHERE pay_status IN ('PAID','REFUNDED') AND method='CASH'),0) AS cash,
   COALESCE(sum(amount_paise) FILTER(WHERE pay_status IN ('PENDING','VERIFYING','FAILED')),0) AS pending
   FROM o GROUP BY name) t),
 -- Same "low" line as the storefront's "Only X left": at most 2 kg, or at most 2 units/trays; 0 is sold out.
 'lowStock',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.name,'onHand',k.on_hand,'measure',k.measure,'pricingBasis',p.pricing_basis) ORDER BY k.on_hand::numeric/CASE k.measure WHEN 'GRAMS' THEN 2000 ELSE 2 END,p.name)
  FROM app.offering_stock k JOIN app.product_store_settings s ON s.business_id=k.business_id AND s.id=k.offering_id JOIN app.products p ON p.business_id=s.business_id AND p.id=s.product_id
  WHERE k.business_id=actor.business_id AND k.store_id=target_store AND s.available AND p.is_active AND k.on_hand IS NOT NULL
   AND k.on_hand<=CASE k.measure WHEN 'GRAMS' THEN 2000 ELSE 2 END),'[]'::jsonb),
 'topProducts',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q."revenuePaise" DESC,q.name) FROM
  (SELECT max(i.product_snapshot->>'productName') AS name,count(DISTINCT i.order_id) AS orders,sum(i.line_total_paise) AS "revenuePaise"
   FROM app.order_items i JOIN app.orders o ON o.business_id=i.business_id AND o.id=i.order_id
   WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.status<>'CANCELLED' AND o.created_at>=from_at AND o.created_at<until_at
   GROUP BY i.product_id ORDER BY sum(i.line_total_paise) DESC,max(i.product_snapshot->>'productName') LIMIT 5) q),'[]'::jsonb),
 'recentOrders',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id DESC) FROM
  (SELECT id,order_number,status,fulfillment_method,total_paise,created_at,fulfillment_snapshot->>'name' AS customer FROM app.orders
   WHERE business_id=actor.business_id AND store_id=target_store ORDER BY created_at DESC,id DESC LIMIT 5) q),'[]'::jsonb));
END $fn$;

-- Replaced (not overloaded) so named-argument calls resolve to one function. Adds the order's day/slot filter and fields.
-- date_filter matches the slot date, or the IST day placed for orders without a slot.
DROP FUNCTION api.order_queue_page(uuid,integer,timestamptz,uuid,text);
CREATE FUNCTION api.order_queue_page(target_store uuid,row_limit integer DEFAULT 50,before_time timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL,status_filter text DEFAULT NULL,
 date_filter date DEFAULT NULL,slot_filter uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; history_days integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF row_limit IS NULL OR row_limit NOT BETWEEN 1 AND 100 OR (before_time IS NULL)<>(before_id IS NULL) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 IF status_filter IS NOT NULL AND status_filter NOT IN ('PLACED','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
 SELECT employee_operational_history_days INTO history_days FROM app.business_settings WHERE business_id=actor.business_id;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id DESC) FROM
 (SELECT id,order_number,status,fulfillment_method,payment_method,total_paise,version,created_at,delivery_date,fulfillment_snapshot->'slot' AS slot FROM app.orders
 WHERE business_id=actor.business_id AND store_id=target_store AND (before_time IS NULL OR (created_at,id)<(before_time,before_id))
 AND (status_filter IS NULL OR status=status_filter)
 AND (date_filter IS NULL OR COALESCE(delivery_date,(created_at AT TIME ZONE 'Asia/Kolkata')::date)=date_filter)
 AND (slot_filter IS NULL OR delivery_slot_id=slot_filter)
 AND (app.current_staff_role()<>'EMPLOYEE' OR created_at>=statement_timestamp()-make_interval(days=>history_days))
 ORDER BY created_at DESC,id DESC LIMIT row_limit) q),'[]'::jsonb);
END $fn$;

-- Same as 20260929000000_store_offers.sql, plus the order's slot.
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
 'slot',order_row.fulfillment_snapshot->'slot',
 'paymentStatus',(SELECT status FROM app.payments WHERE order_id=order_row.id ORDER BY attempt_number DESC LIMIT 1),
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=order_row.id));
END;
$fn$;

REVOKE ALL ON FUNCTION app.ist_today(),app.check_delivery_slot(uuid,uuid,jsonb,boolean),app.build_slotted_quote(uuid,jsonb,boolean),app.reserved_today(uuid,uuid),
 api.delivery_slot_options(uuid),api.delivery_slots(uuid),api.save_delivery_slot(uuid,uuid,integer,text,text,text,text,integer,boolean),
 api.order_queue_page(uuid,integer,timestamptz,uuid,text,date,uuid)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.delivery_slot_options(uuid) TO trait_checkout;
GRANT EXECUTE ON FUNCTION api.delivery_slots(uuid),api.save_delivery_slot(uuid,uuid,integer,text,text,text,text,integer,boolean),
 api.order_queue_page(uuid,integer,timestamptz,uuid,text,date,uuid) TO authenticated;
COMMENT ON FUNCTION api.delivery_slot_options(uuid) IS 'Server-only (trait_checkout): slot statuses for today and the next two days; no counts or capacity.';
NOTIFY pgrst,'reload schema';
COMMIT;
