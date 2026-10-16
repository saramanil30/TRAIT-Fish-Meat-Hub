BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Customers by mobile (no OTP). Every order upserts one guest customer per business and mobile, and saves its
-- delivery address when new. Checkout (server-only trait_checkout connection, rate limited per IP and per number)
-- can list a number's saved addresses MASKED only, and an order can name a saved address by id: the full address
-- is resolved here, never sent to the browser. Staff (ADMIN/OWNER) get a Customers list.
-- Typing a mobile number is not proof of owning it: lookups return masked text only, and an id works only together
-- with the mobile it belongs to. No table grant, no RLS change. Past orders stay immutable (customer_id stays NULL);
-- staff totals match orders by the mobile in their snapshot, so history counts too.

ALTER TABLE app.customer_addresses ADD COLUMN last_used_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE UNIQUE INDEX customers_guest_mobile_key ON app.customers(business_id,mobile_e164) WHERE auth_user_id IS NULL AND deleted_at IS NULL;
CREATE INDEX customer_addresses_owner_idx ON app.customer_addresses(business_id,customer_id,last_used_at DESC) WHERE is_active;
COMMENT ON TABLE app.customers IS 'One guest row per business and mobile, upserted by checkout (name only). Mobile matching shows masked addresses only; it is never authorization for anything else.';
COMMENT ON TABLE app.customer_addresses IS 'Delivery addresses saved by checkout. Leaves the database only masked (checkout) or to ADMIN/OWNER staff; checkout resolves a chosen id server-side.';

-- "Flat 402, Sunrise Road" -> "Flat 4**, ******* Road": generic address words stay, numbers keep their first digit,
-- every other word is starred. Locality and pincode are shown separately, in full.
CREATE FUNCTION app.mask_address_line(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT string_agg(CASE
  WHEN lower(t.m[1])=ANY(ARRAY['flat','house','h','no','door','plot','road','rd','street','st','lane','ln','colony','nagar','block','floor','apartment','apartments','apts','apt','tower','phase','sector','main','cross','layout','enclave','residency','society','villa','villas','gate','wing']) THEN t.m[1]
  WHEN t.m[1] ~ '^[0-9]' THEN left(t.m[1],1)||repeat('*',length(t.m[1])-1)
  WHEN t.m[1] ~ '^[[:alnum:]]' THEN repeat('*',length(t.m[1]))
  ELSE t.m[1] END,'' ORDER BY t.n)
 FROM regexp_matches(value,'[[:alnum:]]+|[^[:alnum:]]+','g') WITH ORDINALITY AS t(m,n)
$fn$;

-- Same address regardless of case and spacing.
CREATE FUNCTION app.address_key(line1 text,line2 text,locality text,pincode text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT lower(regexp_replace(concat_ws('|',btrim(line1),btrim(COALESCE(line2,'')),btrim(COALESCE(locality,'')),btrim(pincode)),'\s+',' ','g'))
$fn$;

-- Checkout payload extras, removed before quoting: addressLabel (Home/Office/Other for a new address) and
-- savedAddressId (delivery to a saved address of this mobile; it becomes the full address here).
CREATE FUNCTION app.resolve_checkout_payload(target_store uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE saved app.customer_addresses;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
 OR (payload ? 'addressLabel' AND (jsonb_typeof(payload->'addressLabel') IS DISTINCT FROM 'string' OR payload->>'addressLabel' NOT IN ('Home','Office','Other')))
 THEN RAISE EXCEPTION 'Invalid checkout choices' USING ERRCODE='22023'; END IF;
 IF NOT payload ? 'savedAddressId' THEN RETURN payload-'addressLabel'; END IF;
 IF jsonb_typeof(payload->'savedAddressId') IS DISTINCT FROM 'string'
 OR payload->>'savedAddressId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR payload->>'method' IS DISTINCT FROM 'HOME_DELIVERY' OR payload ? 'address'
 OR jsonb_typeof(payload->'mobile') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'Invalid checkout choices' USING ERRCODE='22023'; END IF;
 SELECT a.* INTO saved FROM app.customer_addresses a
 JOIN app.customers c ON c.business_id=a.business_id AND c.id=a.customer_id
 JOIN app.stores s ON s.business_id=a.business_id
 WHERE s.id=target_store AND a.id=(payload->>'savedAddressId')::uuid AND a.is_active
 AND c.is_active AND c.deleted_at IS NULL AND c.auth_user_id IS NULL AND c.mobile_e164=app.normalize_indian_mobile(payload->>'mobile');
 IF saved.id IS NULL THEN RAISE EXCEPTION 'Saved address unavailable' USING ERRCODE='22023'; END IF;
 RETURN (payload-ARRAY['savedAddressId','addressLabel'])||jsonb_build_object('address',jsonb_strip_nulls(jsonb_build_object(
  'line1',saved.address_line1,'line2',saved.address_line2,'locality',saved.locality,'city',saved.city,
  'state',saved.state,'pincode',saved.pincode,'countryCode',saved.country_code)));
END $fn$;

-- Upserts the customer from a validated fulfillment snapshot (mobileE164, name, address) and saves the address
-- if new, or marks it last used. A new Home/Office address replaces the old one with that label.
CREATE FUNCTION app.save_order_customer(business uuid,fulfillment jsonb,address_label text,used_at timestamptz) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE customer uuid; addr jsonb:=fulfillment->'address'; found uuid; label_value text;
BEGIN
 IF fulfillment->>'mobileE164' IS NULL THEN RETURN NULL; END IF;
 INSERT INTO app.customers(business_id,mobile_e164,display_name)
 VALUES(business,fulfillment->>'mobileE164',NULLIF(btrim(fulfillment->>'name'),''))
 ON CONFLICT (business_id,mobile_e164) WHERE auth_user_id IS NULL AND deleted_at IS NULL
 DO UPDATE SET display_name=COALESCE(EXCLUDED.display_name,app.customers.display_name)
 RETURNING id INTO customer;
 IF jsonb_typeof(addr) IS DISTINCT FROM 'object' OR NULLIF(btrim(fulfillment->>'name'),'') IS NULL THEN RETURN customer; END IF;
 SELECT a.id INTO found FROM app.customer_addresses a WHERE a.business_id=business AND a.customer_id=customer AND a.is_active
 AND app.address_key(a.address_line1,a.address_line2,a.locality,a.pincode)=app.address_key(addr->>'line1',addr->>'line2',addr->>'locality',addr->>'pincode')
 ORDER BY a.last_used_at DESC LIMIT 1;
 IF found IS NOT NULL THEN
  UPDATE app.customer_addresses SET last_used_at=GREATEST(last_used_at,used_at),recipient_name=btrim(fulfillment->>'name') WHERE id=found;
  RETURN customer;
 END IF;
 label_value:=COALESCE(address_label,(SELECT l FROM unnest(ARRAY['Home','Office','Other']) WITH ORDINALITY u(l,n)
  WHERE l='Other' OR NOT EXISTS(SELECT 1 FROM app.customer_addresses a WHERE a.business_id=business AND a.customer_id=customer AND a.is_active AND a.label=u.l)
  ORDER BY n LIMIT 1));
 IF label_value IN ('Home','Office') THEN
  UPDATE app.customer_addresses SET is_active=false WHERE business_id=business AND customer_id=customer AND is_active AND label=label_value;
 END IF;
 INSERT INTO app.customer_addresses(business_id,customer_id,label,recipient_name,recipient_mobile_e164,address_line1,address_line2,locality,city,state,country_code,pincode,last_used_at)
 VALUES(business,customer,label_value,btrim(fulfillment->>'name'),fulfillment->>'mobileE164',addr->>'line1',addr->>'line2',addr->>'locality',addr->>'city',addr->>'state','IN',addr->>'pincode',used_at);
 RETURN customer;
END $fn$;

-- Same as 20261010000000_delivery_slots.sql, except the payload's checkout extras are resolved first.
CREATE OR REPLACE FUNCTION api.checkout_quote(target_store uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE quote jsonb;
BEGIN
 quote:=app.build_slotted_quote(target_store,app.resolve_checkout_payload(target_store,payload),false);
 IF COALESCE((quote->'fulfillment'->'slot'->>'date')::date,app.ist_today())=app.ist_today() THEN PERFORM app.apply_quote_stock(quote,NULL); END IF;
 RETURN quote;
END;
$fn$;

-- Same as 20261010000000_delivery_slots.sql, except: checkout extras are resolved before quoting, and the
-- customer is upserted (address saved) in the same transaction and linked on the new order.
CREATE OR REPLACE FUNCTION api.place_order(target_store uuid,request_id uuid,payload jsonb,accepted_quote_digest text,
 tracking_digest text,tracking_expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE business uuid; fingerprint bytea; request app.order_requests; quote jsonb; result app.orders;
 line jsonb; line_no integer:=0; payment uuid; number_value text; customer uuid;
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
 quote:=app.build_slotted_quote(target_store,app.resolve_checkout_payload(target_store,payload),true);
 IF quote->>'quoteDigest' IS DISTINCT FROM accepted_quote_digest THEN RAISE EXCEPTION 'Quote changed; review a fresh quote' USING ERRCODE='40001'; END IF;
 customer:=app.save_order_customer(business,quote->'fulfillment',payload->>'addressLabel',clock_timestamp());
 number_value:=nextval('app.order_number_seq'::regclass)::text;
 INSERT INTO app.orders(business_id,store_id,customer_id,order_number,fulfillment_method,fulfillment_snapshot,payment_method,subtotal_paise,delivery_fee_paise,total_paise,discount_paise,offer_snapshot,delivery_slot_id,delivery_date)
 VALUES(business,target_store,customer,'TFM-'||lpad(number_value,GREATEST(6,length(number_value)),'0'),payload->>'method',quote->'fulfillment',payload->>'paymentMethod',
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

-- Checkout (server-only, after rate limiting): a mobile's saved addresses, last used first, masked only.
CREATE FUNCTION api.checkout_saved_addresses(target_store uuid,mobile text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'label',COALESCE(a.label,'Saved'),
  'masked',app.mask_address_line(a.address_line1)||', '||concat_ws(' ',a.locality,a.pincode)) ORDER BY a.last_used_at DESC),'[]'::jsonb)
 FROM (SELECT a.* FROM app.customer_addresses a
  JOIN app.customers c ON c.business_id=a.business_id AND c.id=a.customer_id
  JOIN app.stores s ON s.business_id=a.business_id
  WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND a.is_active
  AND c.is_active AND c.deleted_at IS NULL AND c.auth_user_id IS NULL AND c.mobile_e164=app.normalize_indian_mobile(mobile)
  ORDER BY a.last_used_at DESC LIMIT 5) a
$fn$;

-- Staff Customers page (ADMIN/OWNER): customers who ordered at this store, last order first, at most 500.
-- Orders and spend are matched by mobile, so orders from before this migration count; spend excludes cancelled.
CREATE FUNCTION api.store_customers(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'name',q.display_name,'mobile',q.mobile_e164,'orders',q.orders,
  'spentPaise',q.spent,'lastOrderAt',q.last_at,'addresses',q.addresses) ORDER BY q.last_at DESC) FROM
  (SELECT c.id,c.display_name,c.mobile_e164,o.orders,o.spent,o.last_at,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('label',a.label,'text',concat_ws(', ',a.address_line1,a.address_line2,a.locality,a.city,a.pincode)) ORDER BY a.last_used_at DESC)
    FROM app.customer_addresses a WHERE a.business_id=c.business_id AND a.customer_id=c.id AND a.is_active),'[]'::jsonb) AS addresses
  FROM app.customers c
  JOIN LATERAL (SELECT count(*) AS orders,COALESCE(sum(r.total_paise) FILTER (WHERE r.status<>'CANCELLED'),0) AS spent,max(r.created_at) AS last_at
   FROM app.orders r WHERE r.business_id=c.business_id AND r.store_id=target_store AND r.fulfillment_snapshot->>'mobileE164'=c.mobile_e164) o ON o.orders>0
  WHERE c.business_id=actor.business_id AND c.deleted_at IS NULL
  ORDER BY o.last_at DESC LIMIT 500) q),'[]'::jsonb);
END $fn$;

-- Backfill from past orders, oldest first, so each address's last use is its latest order.
DO $backfill$
DECLARE o record;
BEGIN
 FOR o IN SELECT business_id,fulfillment_snapshot,created_at FROM app.orders WHERE fulfillment_snapshot ? 'mobileE164' ORDER BY created_at,id LOOP
  PERFORM app.save_order_customer(o.business_id,o.fulfillment_snapshot,NULL,o.created_at);
 END LOOP;
END $backfill$;

REVOKE ALL ON FUNCTION app.mask_address_line(text),app.address_key(text,text,text,text),app.resolve_checkout_payload(uuid,jsonb),
 app.save_order_customer(uuid,jsonb,text,timestamptz),api.checkout_saved_addresses(uuid,text),api.store_customers(uuid)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.checkout_saved_addresses(uuid,text) TO trait_checkout;
GRANT EXECUTE ON FUNCTION api.store_customers(uuid) TO authenticated;
COMMENT ON FUNCTION api.checkout_saved_addresses(uuid,text) IS 'Server-only (trait_checkout) after per-IP and per-number rate limiting: masked saved addresses for a mobile.';

DO $security$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'
 AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'Unsafe table state'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE r.rolname IN ('anon','authenticated','service_role','trait_checkout') AND n.nspname='app' AND c.relname IN ('customers','customer_addresses')
 AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE'))) THEN RAISE EXCEPTION 'Unexpected direct table access'; END IF;
END $security$;
COMMIT;
