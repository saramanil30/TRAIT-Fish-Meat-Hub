-- Core backend: orders/tracking, provider-neutral payments/refunds and audit.
-- Forward-only. No seeds, Auth users, Storage changes or provider integration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SET LOCAL createrole_self_grant='';
DO $preflight$
BEGIN
 IF current_user<>'postgres' OR to_regprocedure('app.validate_guest_fulfillment(uuid,text,text,text,jsonb,bigint)') IS NULL
 THEN RAISE EXCEPTION 'postgres and deployed Phase 5B.3 required'; END IF;
 IF to_regclass('app.orders') IS NOT NULL OR to_regclass('app.payments') IS NOT NULL OR to_regclass('app.audit_logs') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('trait_checkout','trait_payment_verifier'))
 THEN RAISE EXCEPTION 'Unexpected core backend state'; END IF;
END;
$preflight$;
-- Capability groups only. No login, credentials, authenticator membership or
-- service-role elevation. Runtime provisioning is a separate deployment step.
CREATE ROLE trait_checkout NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE trait_payment_verifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE TABLE app.audit_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 store_id uuid,
 actor_id uuid,
 actor_role text NOT NULL,
 action text NOT NULL,
 target_id uuid NOT NULL,
 context jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(context)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES app.staff_profiles(business_id,id)
);
CREATE INDEX audit_scope_idx ON app.audit_logs(business_id,store_id,created_at DESC,id);
CREATE SEQUENCE app.order_number_seq AS bigint MINVALUE 1 NO CYCLE;
CREATE TABLE app.orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 store_id uuid NOT NULL,
 customer_id uuid,
 order_number text NOT NULL UNIQUE CHECK(order_number ~ '^TFM-[0-9]{6,}$'),
 fulfillment_method text NOT NULL CHECK(fulfillment_method IN ('HOME_DELIVERY','STORE_PICKUP')),
 fulfillment_snapshot jsonb NOT NULL CHECK(jsonb_typeof(fulfillment_snapshot)='object'),
 payment_method text NOT NULL CHECK(payment_method IN ('CASH','ONLINE','UPI')),
 currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 subtotal_paise bigint NOT NULL CHECK(subtotal_paise>=0),
 delivery_fee_paise bigint NOT NULL CHECK(delivery_fee_paise>=0),
 total_paise bigint NOT NULL CHECK(total_paise>0 AND total_paise=subtotal_paise+delivery_fee_paise),
 status text NOT NULL DEFAULT 'PLACED' CHECK(status IN ('PLACED','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,id),
 UNIQUE(business_id,store_id,id),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id)
);
CREATE INDEX orders_queue_idx ON app.orders(business_id,store_id,created_at DESC,id);
CREATE INDEX orders_status_idx ON app.orders(business_id,store_id,status,created_at DESC);
CREATE INDEX orders_customer_idx ON app.orders(business_id,customer_id) WHERE customer_id IS NOT NULL;
CREATE TABLE app.order_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 line_number integer NOT NULL CHECK(line_number>0),
 product_id uuid NOT NULL,
 preparation_id uuid NOT NULL,
 price_id uuid NOT NULL REFERENCES app.product_prices(id),
 product_snapshot jsonb NOT NULL CHECK(jsonb_typeof(product_snapshot)='object'),
 raw_weight_grams integer NOT NULL CHECK(raw_weight_grams>0),
 price_per_kg_paise bigint NOT NULL CHECK(price_per_kg_paise>0),
 line_total_paise bigint NOT NULL CHECK(line_total_paise=round(price_per_kg_paise::numeric*raw_weight_grams/1000)),
 instructions text NOT NULL CHECK(length(instructions)<=300),
 UNIQUE(business_id,order_id,id),
 UNIQUE(order_id,line_number),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id),
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id),
 FOREIGN KEY(business_id,preparation_id) REFERENCES app.preparation_options(business_id,id)
);
CREATE INDEX order_items_product_idx ON app.order_items(business_id,product_id);
CREATE INDEX order_items_price_idx ON app.order_items(price_id);
CREATE INDEX order_items_preparation_idx ON app.order_items(business_id,preparation_id);
CREATE TABLE app.order_item_fulfillment(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 order_item_id uuid NOT NULL,
 actual_weight_grams integer NOT NULL CHECK(actual_weight_grams BETWEEN 1 AND 100000),
 actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,order_id,order_item_id) REFERENCES app.order_items(business_id,order_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES app.staff_profiles(business_id,id)
);
CREATE INDEX fulfillment_item_idx ON app.order_item_fulfillment(business_id,order_id,order_item_id,created_at DESC);
CREATE TABLE app.order_status_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 from_status text,
 to_status text NOT NULL,
 actor_id uuid,
 actor_role text NOT NULL,
 reason text CHECK(length(reason)<=300),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES app.staff_profiles(business_id,id)
);
CREATE INDEX order_history_idx ON app.order_status_history(business_id,order_id,created_at,id);
CREATE TABLE app.order_access_tokens(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
 scope text NOT NULL DEFAULT 'TRACKING' CHECK(scope='TRACKING'),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id),
 CHECK(expires_at>created_at)
);
CREATE INDEX order_tokens_order_idx ON app.order_access_tokens(business_id,order_id);
CREATE TABLE app.order_requests(
 business_id uuid NOT NULL,
 store_id uuid NOT NULL,
 request_id uuid NOT NULL,
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 order_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(business_id,store_id,request_id),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,store_id,order_id) REFERENCES app.orders(business_id,store_id,id)
);
CREATE INDEX order_requests_order_idx ON app.order_requests(business_id,store_id,order_id);
CREATE TABLE app.payment_provider_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 provider text NOT NULL CHECK(provider ~ '^[a-z0-9_-]{1,80}$'),
 merchant_reference text NOT NULL CHECK(length(merchant_reference) BETWEEN 1 AND 200),
 currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 is_active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,id),
 UNIQUE(provider,merchant_reference)
);
COMMENT ON TABLE app.payment_provider_accounts IS 'Private merchant identity allowlist only; never credentials. No accounts seeded. Configure after provider review.';
CREATE TABLE app.payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number>0),
 method text NOT NULL CHECK(method IN ('CASH','ONLINE','UPI')),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFYING','PAID','FAILED','REFUNDED')),
 amount_paise bigint NOT NULL CHECK(amount_paise>0),
 refunded_paise bigint NOT NULL DEFAULT 0 CHECK(refunded_paise BETWEEN 0 AND amount_paise),
 currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 provider_account_id uuid,
 provider_payment_reference text CHECK(length(provider_payment_reference) BETWEEN 1 AND 200),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,id),
 UNIQUE(business_id,order_id,id),
 UNIQUE(order_id,attempt_number),
 UNIQUE(provider_account_id,provider_payment_reference),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id),
 FOREIGN KEY(business_id,provider_account_id) REFERENCES app.payment_provider_accounts(business_id,id),
 CHECK((provider_account_id IS NULL)=(provider_payment_reference IS NULL)),
 CHECK(method<>'CASH' OR provider_account_id IS NULL),
 CHECK(status<>'REFUNDED' OR refunded_paise=amount_paise),
 CHECK(refunded_paise=0 OR status IN ('PAID','REFUNDED'))
);
CREATE TABLE app.payment_refunds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 payment_id uuid NOT NULL,
 request_id uuid NOT NULL,
 request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
 amount_paise bigint NOT NULL CHECK(amount_paise>0),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED','FAILED')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 requested_by uuid NOT NULL,
 provider_refund_reference text CHECK(length(provider_refund_reference) BETWEEN 1 AND 200),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,order_id,id),
 UNIQUE(payment_id,request_id),
 UNIQUE(payment_id,provider_refund_reference),
 FOREIGN KEY(business_id,order_id,payment_id) REFERENCES app.payments(business_id,order_id,id),
 FOREIGN KEY(business_id,requested_by) REFERENCES app.staff_profiles(business_id,id)
);
CREATE TABLE app.refund_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 refund_id uuid NOT NULL,
 order_item_id uuid,
 component text NOT NULL CHECK(component IN ('ITEM','DELIVERY')),
 amount_paise bigint NOT NULL CHECK(amount_paise>0),
 FOREIGN KEY(business_id,order_id,refund_id) REFERENCES app.payment_refunds(business_id,order_id,id),
 FOREIGN KEY(business_id,order_id,order_item_id) REFERENCES app.order_items(business_id,order_id,id),
 CHECK((component='ITEM' AND order_item_id IS NOT NULL) OR (component='DELIVERY' AND order_item_id IS NULL))
);
CREATE UNIQUE INDEX refund_item_key ON app.refund_allocations(refund_id,order_item_id) WHERE component='ITEM';
CREATE UNIQUE INDEX refund_delivery_key ON app.refund_allocations(refund_id) WHERE component='DELIVERY';
CREATE INDEX refund_allocation_order_idx ON app.refund_allocations(business_id,order_id,order_item_id);
CREATE TABLE app.payment_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 payment_id uuid NOT NULL,
 refund_id uuid,
 actor_id uuid,
 actor_role text NOT NULL,
 kind text NOT NULL,
 from_status text,
 to_status text,
 amount_paise bigint CHECK(amount_paise>=0),
 evidence_reference text CHECK(length(evidence_reference) BETWEEN 1 AND 100),
 provider_account_id uuid,
 provider_event_id text CHECK(length(provider_event_id) BETWEEN 1 AND 200),
 payload_digest bytea CHECK(octet_length(payload_digest)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(provider_account_id,provider_event_id),
 FOREIGN KEY(business_id,order_id,payment_id) REFERENCES app.payments(business_id,order_id,id),
 FOREIGN KEY(business_id,order_id,refund_id) REFERENCES app.payment_refunds(business_id,order_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES app.staff_profiles(business_id,id),
 FOREIGN KEY(business_id,provider_account_id) REFERENCES app.payment_provider_accounts(business_id,id),
 CHECK((provider_account_id IS NULL AND provider_event_id IS NULL AND payload_digest IS NULL)
 OR (provider_account_id IS NOT NULL AND provider_event_id IS NOT NULL AND payload_digest IS NOT NULL))
);
CREATE INDEX payment_events_order_idx ON app.payment_events(business_id,order_id,created_at,id);

CREATE FUNCTION app.core_audit(business uuid,store uuid,actor uuid,role_name text,event_action text,target uuid,detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $fn$
 INSERT INTO app.audit_logs(business_id,store_id,actor_id,actor_role,action,target_id,context)
 VALUES(business,store,actor,role_name,event_action,target,detail)
$fn$;
CREATE FUNCTION app.bridge_staff_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE store uuid; role_name text;
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM app.staff_admin_grants g WHERE g.staff_profile_id=NEW.actor_id AND g.is_active)
 THEN 'ADMIN' ELSE sp.role END INTO role_name FROM app.staff_profiles sp WHERE sp.id=NEW.actor_id;
 SELECT store_id INTO store FROM app.product_store_settings WHERE id=NEW.target_id AND business_id=NEW.business_id;
 IF store IS NULL THEN SELECT id INTO store FROM app.stores WHERE id=NEW.target_id AND business_id=NEW.business_id; END IF;
 IF store IS NULL THEN SELECT store_id INTO store FROM app.delivery_areas WHERE id=NEW.target_id AND business_id=NEW.business_id; END IF;
 PERFORM app.core_audit(NEW.business_id,store,NEW.actor_id,role_name,NEW.action,NEW.target_id,NEW.detail||jsonb_build_object('sourceAuditId',NEW.id));
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER core_staff_audit AFTER INSERT ON app.staff_access_audit FOR EACH ROW EXECUTE FUNCTION app.bridge_staff_audit();

CREATE FUNCTION app.guard_core_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path=''
AS $fn$
DECLARE allowed text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Historical record deletion forbidden' USING ERRCODE='23514'; END IF;
 allowed:=CASE TG_TABLE_NAME
 WHEN 'orders' THEN ARRAY['status','version','updated_at']
 WHEN 'payments' THEN ARRAY['status','refunded_paise','provider_account_id','provider_payment_reference','version','updated_at']
 WHEN 'payment_refunds' THEN ARRAY['status','provider_refund_reference','version','updated_at']
 WHEN 'order_access_tokens' THEN ARRAY['revoked_at']
 WHEN 'order_requests' THEN ARRAY['order_id']
 WHEN 'payment_provider_accounts' THEN ARRAY['is_active'] END;
 IF (to_jsonb(OLD)-allowed) IS DISTINCT FROM (to_jsonb(NEW)-allowed) THEN RAISE EXCEPTION 'Historical snapshot is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='order_requests' AND (to_jsonb(OLD)->>'order_id') IS NOT NULL AND (to_jsonb(NEW)->>'order_id') IS DISTINCT FROM (to_jsonb(OLD)->>'order_id') THEN
 RAISE EXCEPTION 'Completed request is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='order_access_tokens' AND (to_jsonb(OLD)->>'revoked_at') IS NOT NULL AND (to_jsonb(NEW)->>'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)->>'revoked_at') THEN
 RAISE EXCEPTION 'Token revocation is permanent' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='payments' AND (to_jsonb(OLD)->>'provider_account_id') IS NOT NULL AND
 ((to_jsonb(NEW)->>'provider_account_id') IS DISTINCT FROM (to_jsonb(OLD)->>'provider_account_id') OR (to_jsonb(NEW)->>'provider_payment_reference') IS DISTINCT FROM (to_jsonb(OLD)->>'provider_payment_reference')) THEN
 RAISE EXCEPTION 'Provider identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;

CREATE FUNCTION app.build_order_quote(target_store uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE shop app.stores; settings app.business_settings; item jsonb; selection record;
 product app.products; prep app.preparation_options; choice app.product_preparation_options;
 offering app.product_store_settings; price app.product_prices;
 lines jsonb:='[]'; seen text[]:='{}'; identity_key text; instructions text;
 grams integer; subtotal bigint:=0; fee bigint:=0; total bigint; fulfillment jsonb; result jsonb; pricing_at timestamptz;
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
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (item-ARRAY['productId','preparationId','rawWeightGrams','instructions'])<>'{}'::jsonb
  OR NOT(item ?& ARRAY['productId','preparationId','rawWeightGrams'])
  OR jsonb_typeof(item->'productId') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'preparationId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(item->'rawWeightGrams') IS DISTINCT FROM 'number' OR (item->>'rawWeightGrams') !~ '^[0-9]{1,6}$'
  OR (item ? 'instructions' AND jsonb_typeof(item->'instructions') IS DISTINCT FROM 'string')
  THEN RAISE EXCEPTION 'Invalid cart line' USING ERRCODE='22023'; END IF;
  grams:=(item->>'rawWeightGrams')::integer;
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
  IF choice.id IS NULL OR NOT EXISTS(SELECT 1 FROM app.product_allowed_weights WHERE business_id=shop.business_id AND product_id=product.id AND raw_weight_grams=grams AND is_active)
  THEN RAISE EXCEPTION 'Preparation or weight unavailable' USING ERRCODE='22023'; END IF;
  SELECT * INTO price FROM app.product_prices WHERE offering_id=offering.id AND effective_from<=pricing_at ORDER BY effective_from DESC,offering_version DESC LIMIT 1;
  IF price.id IS NULL THEN RAISE EXCEPTION 'Price unavailable' USING ERRCODE='22023'; END IF;
  subtotal:=subtotal+round(price.price_per_kg_paise::numeric*grams/1000)::bigint;
  lines:=lines||jsonb_build_array(jsonb_build_object('productId',product.id,'preparationId',prep.id,'priceId',price.id,
   'rawWeightGrams',grams,'pricePerKgPaise',price.price_per_kg_paise,'lineTotalPaise',round(price.price_per_kg_paise::numeric*grams/1000)::bigint,
   'instructions',instructions,'snapshot',jsonb_build_object('productName',product.name,'localName',product.local_name,
   'categoryId',product.category_id,'categoryName',(SELECT name FROM app.categories WHERE id=product.category_id),
   'preparationName',prep.name,'cleaningLossPercent',choice.cleaning_loss_percent,
   'estimatedCleanedWeightGrams',CASE WHEN choice.cleaning_loss_percent IS NOT NULL THEN round(grams*(1-choice.cleaning_loss_percent/100)) END,
   'pricingBasis','RAW_WEIGHT','offeringId',offering.id,'offeringVersion',offering.version)));
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
CREATE FUNCTION api.checkout_quote(target_store uuid,payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$ SELECT app.build_order_quote(target_store,payload) $fn$;

CREATE FUNCTION api.place_order(target_store uuid,request_id uuid,payload jsonb,accepted_quote_digest text,
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
  INSERT INTO app.order_items(business_id,order_id,line_number,product_id,preparation_id,price_id,product_snapshot,raw_weight_grams,price_per_kg_paise,line_total_paise,instructions)
  VALUES(business,result.id,line_no,(line->>'productId')::uuid,(line->>'preparationId')::uuid,(line->>'priceId')::uuid,line->'snapshot',
   (line->>'rawWeightGrams')::integer,(line->>'pricePerKgPaise')::bigint,(line->>'lineTotalPaise')::bigint,line->>'instructions');
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

CREATE FUNCTION app.require_order_staff(target_order uuid) RETURNS app.staff_profiles
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles; order_row app.orders; history_days integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 SELECT * INTO order_row FROM app.orders WHERE id=target_order AND business_id=actor.business_id;
 IF order_row.id IS NULL OR NOT app.can_access_store(actor.business_id,order_row.store_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF app.current_staff_role()='EMPLOYEE' THEN
  SELECT employee_operational_history_days INTO history_days FROM app.business_settings WHERE business_id=actor.business_id;
  IF history_days IS NULL OR order_row.created_at<statement_timestamp()-make_interval(days=>history_days) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN actor;
END;
$fn$;
CREATE FUNCTION api.order_queue(target_store uuid,row_limit integer DEFAULT 50,before_time timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles; history_days integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF row_limit IS NULL OR row_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='22023'; END IF;
 SELECT employee_operational_history_days INTO history_days FROM app.business_settings WHERE business_id=actor.business_id;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id) FROM
 (SELECT id,order_number,status,fulfillment_method,payment_method,total_paise,version,created_at FROM app.orders
 WHERE business_id=actor.business_id AND store_id=target_store AND (before_time IS NULL OR created_at<before_time)
 AND (app.current_staff_role()<>'EMPLOYEE' OR created_at>=statement_timestamp()-make_interval(days=>history_days))
 ORDER BY created_at DESC,id LIMIT row_limit) q),'[]'::jsonb);
END;
$fn$;
CREATE FUNCTION api.order_detail(target_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_order_staff(target_order);
 RETURN jsonb_build_object('order',(SELECT to_jsonb(o) FROM app.orders o WHERE id=target_order),
 'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY line_number) FROM app.order_items i WHERE order_id=target_order),
 'fulfillment',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY created_at) FROM app.order_item_fulfillment f WHERE order_id=target_order),'[]'::jsonb),
 'payments',(SELECT jsonb_agg(jsonb_build_object('id',id,'method',method,'status',status,'amountPaise',amount_paise,'refundedPaise',refunded_paise,'version',version)) FROM app.payments WHERE order_id=target_order),
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at,'actorId',actor_id) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=target_order));
END;
$fn$;
CREATE FUNCTION api.transition_order(target_order uuid,expected_version bigint,next_status text,reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles; previous app.orders; require_paid boolean;
BEGIN
 actor:=app.require_order_staff(target_order);
 SELECT * INTO previous FROM app.orders WHERE id=target_order FOR UPDATE;
 IF expected_version IS NULL OR previous.version<>expected_version THEN RAISE EXCEPTION 'Order changed; reload' USING ERRCODE='40001'; END IF;
 IF next_status='CANCELLED' THEN
  IF app.current_staff_role() NOT IN ('ADMIN','OWNER') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF previous.status IN ('DELIVERED','CANCELLED') OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Invalid cancellation' USING ERRCODE='22023'; END IF;
 ELSIF NOT COALESCE((previous.status='PLACED' AND next_status='CONFIRMED') OR (previous.status='CONFIRMED' AND next_status='PREPARING')
 OR (previous.status='PREPARING' AND next_status='READY')
 OR (previous.status='READY' AND next_status='OUT_FOR_DELIVERY' AND previous.fulfillment_method='HOME_DELIVERY')
 OR (previous.status='READY' AND next_status='DELIVERED' AND previous.fulfillment_method='STORE_PICKUP')
 OR (previous.status='OUT_FOR_DELIVERY' AND next_status='DELIVERED'),false)
 THEN RAISE EXCEPTION 'Invalid order transition' USING ERRCODE='22023'; END IF;
 IF next_status='DELIVERED' THEN
  SELECT require_payment_before_completion INTO require_paid FROM app.business_settings WHERE business_id=previous.business_id FOR SHARE;
  IF require_paid IS NULL THEN RAISE EXCEPTION 'Operational policy unavailable' USING ERRCODE='22023'; END IF;
  IF require_paid AND NOT EXISTS(SELECT 1 FROM app.payments WHERE order_id=previous.id AND status='PAID' AND refunded_paise=0
   AND NOT EXISTS(SELECT 1 FROM app.payment_refunds WHERE order_id=previous.id AND status='PENDING'))
  THEN RAISE EXCEPTION 'Verified payment required before completion' USING ERRCODE='22023'; END IF;
 END IF;
 UPDATE app.orders SET status=next_status,version=version+1,updated_at=clock_timestamp() WHERE id=previous.id;
 INSERT INTO app.order_status_history(business_id,order_id,from_status,to_status,actor_id,actor_role,reason)
 VALUES(previous.business_id,previous.id,previous.status,next_status,actor.id,app.current_staff_role(),btrim(reason));
 PERFORM app.core_audit(previous.business_id,previous.store_id,actor.id,app.current_staff_role(),'ORDER_STATUS',previous.id,jsonb_build_object('from',previous.status,'to',next_status));
END;
$fn$;
CREATE FUNCTION api.record_fulfilled_weight(target_order uuid,target_item uuid,expected_version bigint,actual_grams integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles; order_row app.orders;
BEGIN
 actor:=app.require_order_staff(target_order);
 SELECT * INTO order_row FROM app.orders WHERE id=target_order FOR UPDATE;
 IF expected_version IS NULL OR order_row.version<>expected_version THEN RAISE EXCEPTION 'Order changed; reload' USING ERRCODE='40001'; END IF;
 IF order_row.status NOT IN ('PREPARING','READY','OUT_FOR_DELIVERY') THEN RAISE EXCEPTION 'Order is not in preparation/dispatch' USING ERRCODE='22023'; END IF;
 INSERT INTO app.order_item_fulfillment(business_id,order_id,order_item_id,actual_weight_grams,actor_id)
 VALUES(order_row.business_id,order_row.id,target_item,actual_grams,actor.id);
 UPDATE app.orders SET version=version+1,updated_at=clock_timestamp() WHERE id=order_row.id;
 PERFORM app.core_audit(order_row.business_id,order_row.store_id,actor.id,app.current_staff_role(),'FULFILLED_WEIGHT',target_item,jsonb_build_object('grams',actual_grams,'orderId',order_row.id));
END;
$fn$;
CREATE FUNCTION api.track_order(tracking_token text) RETURNS jsonb
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
 'paymentStatus',(SELECT status FROM app.payments WHERE order_id=order_row.id ORDER BY attempt_number DESC LIMIT 1),
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=order_row.id));
END;
$fn$;
CREATE FUNCTION api.revoke_order_tracking(target_order uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles; order_row app.orders;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']); PERFORM app.require_order_staff(target_order);
 SELECT * INTO order_row FROM app.orders WHERE id=target_order FOR UPDATE;
 UPDATE app.order_access_tokens SET revoked_at=clock_timestamp() WHERE order_id=target_order AND revoked_at IS NULL;
 PERFORM app.core_audit(order_row.business_id,order_row.store_id,actor.id,app.current_staff_role(),'TRACKING_REVOKED',target_order,'{}');
END;
$fn$;

-- Every payment/refund mutation locks order first, then payment, then refund.
-- This serializes collection/refunds against completion and cancellation.
CREATE FUNCTION app.lock_order_payment(target_payment uuid) RETURNS app.payments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE payment app.payments; order_id_value uuid;
BEGIN
 SELECT order_id INTO order_id_value FROM app.payments WHERE id=target_payment;
 IF order_id_value IS NULL THEN RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='22023'; END IF;
 PERFORM id FROM app.orders WHERE id=order_id_value FOR UPDATE;
 SELECT * INTO payment FROM app.payments WHERE id=target_payment FOR UPDATE;
 RETURN payment;
END;
$fn$;
CREATE FUNCTION api.receive_cash(target_payment uuid,expected_version bigint) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE payment app.payments; actor app.staff_profiles; order_row app.orders; cash_limit bigint;
BEGIN
 SELECT * INTO payment FROM app.payments WHERE id=target_payment;
 actor:=app.require_order_staff(payment.order_id);
 payment:=app.lock_order_payment(target_payment);
 SELECT * INTO order_row FROM app.orders WHERE id=payment.order_id;
 IF expected_version IS NULL OR payment.version<>expected_version THEN RAISE EXCEPTION 'Payment changed; reload' USING ERRCODE='40001'; END IF;
 IF payment.method<>'CASH' OR payment.status<>'PENDING' OR order_row.status='CANCELLED' THEN RAISE EXCEPTION 'Cash receipt unavailable' USING ERRCODE='22023'; END IF;
 IF app.current_staff_role()='EMPLOYEE' THEN
  SELECT employee_cash_collection_limit_paise INTO cash_limit FROM app.business_settings WHERE business_id=actor.business_id FOR SHARE;
  IF cash_limit IS NULL OR payment.amount_paise>cash_limit THEN RAISE EXCEPTION 'Cash receipt exceeds employee policy' USING ERRCODE='42501'; END IF;
 END IF;
 UPDATE app.payments SET status='PAID',version=version+1,updated_at=clock_timestamp() WHERE id=payment.id;
 INSERT INTO app.payment_events(business_id,order_id,payment_id,actor_id,actor_role,kind,from_status,to_status,amount_paise)
 VALUES(payment.business_id,payment.order_id,payment.id,actor.id,app.current_staff_role(),'CASH_RECEIVED',payment.status,'PAID',payment.amount_paise);
 PERFORM app.core_audit(payment.business_id,order_row.store_id,actor.id,app.current_staff_role(),'CASH_RECEIVED',payment.id,jsonb_build_object('amountPaise',payment.amount_paise));
END;
$fn$;
CREATE FUNCTION api.submit_payment_reference(target_payment uuid,expected_version bigint,reference text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE payment app.payments; actor app.staff_profiles; order_row app.orders;
BEGIN
 SELECT * INTO payment FROM app.payments WHERE id=target_payment;
 actor:=app.require_order_staff(payment.order_id);
 payment:=app.lock_order_payment(target_payment);
 SELECT * INTO order_row FROM app.orders WHERE id=payment.order_id;
 IF expected_version IS NULL OR payment.version<>expected_version THEN RAISE EXCEPTION 'Payment changed; reload' USING ERRCODE='40001'; END IF;
 IF reference IS NULL OR reference !~ '^[a-zA-Z0-9_-]{1,100}$' OR payment.method='CASH'
 OR payment.status NOT IN ('PENDING','VERIFYING','FAILED') OR order_row.status='CANCELLED' THEN RAISE EXCEPTION 'Invalid payment evidence' USING ERRCODE='22023'; END IF;
 UPDATE app.payments SET status='VERIFYING',version=version+1,updated_at=clock_timestamp() WHERE id=payment.id;
 INSERT INTO app.payment_events(business_id,order_id,payment_id,actor_id,actor_role,kind,from_status,to_status,evidence_reference)
 VALUES(payment.business_id,payment.order_id,payment.id,actor.id,app.current_staff_role(),'REFERENCE_SUBMITTED',payment.status,'VERIFYING',reference);
 PERFORM app.core_audit(payment.business_id,order_row.store_id,actor.id,app.current_staff_role(),'PAYMENT_EVIDENCE',payment.id,jsonb_build_object('state','VERIFYING'));
END;
$fn$;

-- Only the isolated verifier role can bind trusted provider identities. Browser
-- roles and normal staff cannot call any provider function, even ADMIN.
CREATE FUNCTION api.bind_provider_payment(target_payment uuid,account_id uuid,provider_reference text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE payment app.payments; account app.payment_provider_accounts; store uuid;
BEGIN
 payment:=app.lock_order_payment(target_payment);
 SELECT * INTO account FROM app.payment_provider_accounts WHERE id=account_id AND business_id=payment.business_id AND is_active FOR SHARE;
 IF account.id IS NULL OR account.currency<>payment.currency OR payment.method='CASH' OR payment.status NOT IN ('PENDING','VERIFYING','FAILED')
 OR provider_reference IS NULL OR length(provider_reference) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid provider binding' USING ERRCODE='22023'; END IF;
 IF payment.provider_account_id IS NOT NULL THEN
  IF payment.provider_account_id=account_id AND payment.provider_payment_reference=provider_reference THEN RETURN; END IF;
  RAISE EXCEPTION 'Provider identity already bound' USING ERRCODE='22023';
 END IF;
 UPDATE app.payments SET provider_account_id=account_id,provider_payment_reference=provider_reference,version=version+1,updated_at=clock_timestamp() WHERE id=payment.id;
 SELECT store_id INTO store FROM app.orders WHERE id=payment.order_id;
 PERFORM app.core_audit(payment.business_id,store,NULL,'PROVIDER','PROVIDER_PAYMENT_BOUND',payment.id,jsonb_build_object('accountId',account_id));
END;
$fn$;
COMMENT ON FUNCTION api.bind_provider_payment(uuid,uuid,text) IS 'Server verifier only, after merchant-bound provider order creation; not callable by browser/staff. No provider integration is installed.';

CREATE FUNCTION api.record_verified_payment(account_id uuid,provider_reference text,event_id text,
 outcome text,verified_amount_paise bigint,verified_currency text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE payment app.payments; account app.payment_provider_accounts; previous_event app.payment_events; fingerprint bytea; store uuid;
BEGIN
 IF event_id IS NULL OR length(event_id) NOT BETWEEN 1 AND 200 OR outcome IS NULL OR outcome NOT IN ('PAID','FAILED') THEN RAISE EXCEPTION 'Invalid provider event' USING ERRCODE='22023'; END IF;
 SELECT * INTO account FROM app.payment_provider_accounts WHERE id=account_id AND is_active FOR SHARE;
 SELECT * INTO payment FROM app.payments WHERE provider_account_id=account.id AND provider_payment_reference=provider_reference;
 IF payment.id IS NULL THEN RAISE EXCEPTION 'Unknown merchant/payment reference' USING ERRCODE='22023'; END IF;
 payment:=app.lock_order_payment(payment.id);
 IF verified_amount_paise IS DISTINCT FROM payment.amount_paise OR verified_currency IS DISTINCT FROM payment.currency
 OR verified_currency IS DISTINCT FROM account.currency THEN RAISE EXCEPTION 'Provider amount/currency mismatch' USING ERRCODE='22023'; END IF;
 fingerprint:=sha256(convert_to(jsonb_build_array(payment.id,outcome,verified_amount_paise,verified_currency)::text,'UTF8'));
 SELECT * INTO previous_event FROM app.payment_events WHERE provider_account_id=account_id AND provider_event_id=event_id;
 IF previous_event.id IS NOT NULL THEN
  IF previous_event.payload_digest IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Provider event reused with different payload' USING ERRCODE='22023'; END IF;
  RETURN;
 END IF;
 IF payment.status IN ('PAID','REFUNDED') AND outcome='FAILED' THEN RAISE EXCEPTION 'Cannot reverse a settled payment with a failure event' USING ERRCODE='22023'; END IF;
 INSERT INTO app.payment_events(business_id,order_id,payment_id,actor_role,kind,from_status,to_status,amount_paise,provider_account_id,provider_event_id,payload_digest)
 VALUES(payment.business_id,payment.order_id,payment.id,'PROVIDER','VERIFIED_PAYMENT',payment.status,
 CASE WHEN payment.status='REFUNDED' THEN 'REFUNDED' ELSE outcome END,verified_amount_paise,account_id,event_id,fingerprint);
 IF payment.status NOT IN ('PAID','REFUNDED') AND payment.status<>outcome THEN
  UPDATE app.payments SET status=outcome,version=version+1,updated_at=clock_timestamp() WHERE id=payment.id;
 END IF;
 SELECT store_id INTO store FROM app.orders WHERE id=payment.order_id;
 PERFORM app.core_audit(payment.business_id,store,NULL,'PROVIDER','VERIFIED_PAYMENT',payment.id,jsonb_build_object('from',payment.status,'outcome',outcome,'amountPaise',verified_amount_paise));
END;
$fn$;
COMMENT ON FUNCTION api.record_verified_payment(uuid,text,text,text,bigint,text) IS 'Trusted verifier capability only. Future adapter MUST verify webhook signature/server lookup, merchant identity, payment reference, amount and currency before calling. No boolean client proof is accepted.';

CREATE FUNCTION api.request_refund(target_payment uuid,expected_version bigint,request_key uuid,allocations jsonb,reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles; payment app.payments; previous app.payment_refunds; result uuid; allocation jsonb;
 total bigint:=0; requested bigint; already bigint; cap bigint; item uuid; fingerprint bytea; store uuid; seen text[]:='{}'; component_key text;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 SELECT * INTO payment FROM app.payments WHERE id=target_payment;
 PERFORM app.require_order_staff(payment.order_id);
 payment:=app.lock_order_payment(target_payment);
 IF request_key IS NULL OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 300
 OR jsonb_typeof(allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(allocations) NOT BETWEEN 1 AND 501 OR octet_length(allocations::text)>150000
 THEN RAISE EXCEPTION 'Invalid refund request' USING ERRCODE='22023'; END IF;
 fingerprint:=sha256(convert_to(jsonb_build_array(allocations,btrim(reason))::text,'UTF8'));
 SELECT * INTO previous FROM app.payment_refunds WHERE payment_id=payment.id AND request_id=request_key;
 IF previous.id IS NOT NULL THEN
  IF previous.request_digest IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Refund key reused with different input' USING ERRCODE='22023'; END IF;
  RETURN previous.id;
 END IF;
 IF expected_version IS NULL OR expected_version<>payment.version THEN RAISE EXCEPTION 'Payment changed; reload' USING ERRCODE='40001'; END IF;
 IF payment.status<>'PAID' THEN RAISE EXCEPTION 'Only settled funds can be refunded' USING ERRCODE='22023'; END IF;
 FOR allocation IN SELECT value FROM jsonb_array_elements(allocations) LOOP
  IF jsonb_typeof(allocation) IS DISTINCT FROM 'object' OR (allocation-ARRAY['itemId','amountPaise'])<>'{}'::jsonb
  OR jsonb_typeof(allocation->'amountPaise') IS DISTINCT FROM 'number' OR (allocation->>'amountPaise') !~ '^[0-9]{1,13}$'
  OR (allocation ? 'itemId' AND jsonb_typeof(allocation->'itemId') NOT IN ('string','null')) THEN RAISE EXCEPTION 'Invalid refund allocation' USING ERRCODE='22023'; END IF;
  requested:=(allocation->>'amountPaise')::bigint; item:=(allocation->>'itemId')::uuid;
  IF requested<=0 THEN RAISE EXCEPTION 'Refund amount must be positive' USING ERRCODE='22023'; END IF;
  component_key:=COALESCE(item::text,'DELIVERY');
  IF component_key=ANY(seen) THEN RAISE EXCEPTION 'Duplicate refund allocation' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,component_key);
  IF item IS NULL THEN SELECT delivery_fee_paise INTO cap FROM app.orders WHERE id=payment.order_id;
  ELSE SELECT line_total_paise INTO cap FROM app.order_items WHERE id=item AND order_id=payment.order_id AND business_id=payment.business_id; END IF;
  SELECT COALESCE(sum(a.amount_paise),0) INTO already FROM app.refund_allocations a JOIN app.payment_refunds r ON r.id=a.refund_id
  WHERE a.order_id=payment.order_id AND a.order_item_id IS NOT DISTINCT FROM item AND r.status IN ('PENDING','COMPLETED');
  IF cap IS NULL OR requested>cap-already THEN RAISE EXCEPTION 'Refund exceeds remaining component amount' USING ERRCODE='22023'; END IF;
  total:=total+requested;
 END LOOP;
 SELECT COALESCE(sum(amount_paise),0) INTO already FROM app.payment_refunds WHERE payment_id=payment.id AND status IN ('PENDING','COMPLETED');
 IF total>payment.amount_paise-already THEN RAISE EXCEPTION 'Refund exceeds remaining settled funds' USING ERRCODE='22023'; END IF;
 INSERT INTO app.payment_refunds(business_id,order_id,payment_id,request_id,request_digest,amount_paise,reason,requested_by)
 VALUES(payment.business_id,payment.order_id,payment.id,request_key,fingerprint,total,btrim(reason),actor.id) RETURNING id INTO result;
 FOR allocation IN SELECT value FROM jsonb_array_elements(allocations) LOOP
  item:=(allocation->>'itemId')::uuid;
  INSERT INTO app.refund_allocations(business_id,order_id,refund_id,order_item_id,component,amount_paise)
  VALUES(payment.business_id,payment.order_id,result,item,CASE WHEN item IS NULL THEN 'DELIVERY' ELSE 'ITEM' END,(allocation->>'amountPaise')::bigint);
 END LOOP;
 UPDATE app.payments SET version=version+1,updated_at=clock_timestamp() WHERE id=payment.id;
 INSERT INTO app.payment_events(business_id,order_id,payment_id,refund_id,actor_id,actor_role,kind,to_status,amount_paise)
 VALUES(payment.business_id,payment.order_id,payment.id,result,actor.id,app.current_staff_role(),'REFUND_REQUESTED','PENDING',total);
 SELECT store_id INTO store FROM app.orders WHERE id=payment.order_id;
 PERFORM app.core_audit(payment.business_id,store,actor.id,app.current_staff_role(),'REFUND_REQUESTED',result,jsonb_build_object('amountPaise',total,'paymentId',payment.id));
 RETURN result;
END;
$fn$;
CREATE FUNCTION app.finish_refund(target_refund uuid,outcome text,actor uuid,role_name text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE refund app.payment_refunds; payment app.payments; store uuid;
BEGIN
 SELECT * INTO refund FROM app.payment_refunds WHERE id=target_refund;
 payment:=app.lock_order_payment(refund.payment_id);
 SELECT * INTO refund FROM app.payment_refunds WHERE id=target_refund FOR UPDATE;
 IF outcome IS NULL OR outcome NOT IN ('COMPLETED','FAILED') OR refund.status<>'PENDING' THEN RAISE EXCEPTION 'Invalid refund transition' USING ERRCODE='22023'; END IF;
 UPDATE app.payment_refunds SET status=outcome,version=version+1,updated_at=clock_timestamp() WHERE id=refund.id;
 IF outcome='COMPLETED' THEN
  IF payment.status<>'PAID' OR payment.refunded_paise+refund.amount_paise>payment.amount_paise THEN RAISE EXCEPTION 'Refund exceeds settled funds' USING ERRCODE='22023'; END IF;
  UPDATE app.payments SET refunded_paise=refunded_paise+refund.amount_paise,
  status=CASE WHEN refunded_paise+refund.amount_paise=amount_paise THEN 'REFUNDED' ELSE 'PAID' END,
  version=version+1,updated_at=clock_timestamp() WHERE id=payment.id;
 ELSE UPDATE app.payments SET version=version+1,updated_at=clock_timestamp() WHERE id=payment.id; END IF;
 INSERT INTO app.payment_events(business_id,order_id,payment_id,refund_id,actor_id,actor_role,kind,from_status,to_status,amount_paise)
 VALUES(payment.business_id,payment.order_id,payment.id,refund.id,actor,role_name,'REFUND_RESULT',refund.status,outcome,refund.amount_paise);
 SELECT store_id INTO store FROM app.orders WHERE id=payment.order_id;
 PERFORM app.core_audit(payment.business_id,store,actor,role_name,'REFUND_RESULT',refund.id,jsonb_build_object('outcome',outcome,'amountPaise',refund.amount_paise));
END;
$fn$;
CREATE FUNCTION api.complete_cash_refund(target_refund uuid,expected_version bigint) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles; refund app.payment_refunds; payment app.payments;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 SELECT * INTO refund FROM app.payment_refunds WHERE id=target_refund;
 PERFORM app.require_order_staff(refund.order_id);
 payment:=app.lock_order_payment(refund.payment_id);
 SELECT * INTO refund FROM app.payment_refunds WHERE id=target_refund FOR UPDATE;
 IF expected_version IS NULL OR refund.version<>expected_version THEN RAISE EXCEPTION 'Refund changed; reload' USING ERRCODE='40001'; END IF;
 IF payment.method<>'CASH' THEN RAISE EXCEPTION 'Online refunds require provider verification' USING ERRCODE='42501'; END IF;
 PERFORM app.finish_refund(refund.id,'COMPLETED',actor.id,app.current_staff_role());
END;
$fn$;
CREATE FUNCTION api.bind_provider_refund(target_refund uuid,provider_reference text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE refund app.payment_refunds; payment app.payments;
BEGIN
 SELECT * INTO refund FROM app.payment_refunds WHERE id=target_refund;
 payment:=app.lock_order_payment(refund.payment_id);
 SELECT * INTO refund FROM app.payment_refunds WHERE id=target_refund FOR UPDATE;
 IF payment.method='CASH' OR payment.provider_account_id IS NULL OR refund.status<>'PENDING'
 OR provider_reference IS NULL OR length(provider_reference) NOT BETWEEN 1 AND 200
 OR NOT EXISTS(SELECT 1 FROM app.payment_provider_accounts WHERE id=payment.provider_account_id AND is_active)
 THEN RAISE EXCEPTION 'Invalid provider refund binding' USING ERRCODE='22023'; END IF;
 IF refund.provider_refund_reference IS NOT NULL THEN
  IF refund.provider_refund_reference=provider_reference THEN RETURN; END IF;
  RAISE EXCEPTION 'Refund identity already bound' USING ERRCODE='22023';
 END IF;
 UPDATE app.payment_refunds SET provider_refund_reference=provider_reference,version=version+1,updated_at=clock_timestamp() WHERE id=refund.id;
 PERFORM app.core_audit(payment.business_id,(SELECT store_id FROM app.orders WHERE id=payment.order_id),NULL,'PROVIDER','PROVIDER_REFUND_BOUND',refund.id,'{}');
END;
$fn$;
CREATE FUNCTION api.record_verified_refund(account_id uuid,provider_payment_reference text,provider_refund_reference text,
 event_id text,outcome text,verified_amount_paise bigint,verified_currency text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE payment app.payments; refund app.payment_refunds; previous_event app.payment_events; fingerprint bytea;
BEGIN
 IF event_id IS NULL OR length(event_id) NOT BETWEEN 1 AND 200 OR outcome IS NULL OR outcome NOT IN ('COMPLETED','FAILED') THEN RAISE EXCEPTION 'Invalid provider event' USING ERRCODE='22023'; END IF;
 SELECT p.* INTO payment FROM app.payments p JOIN app.payment_provider_accounts a ON a.id=p.provider_account_id
 WHERE a.id=account_id AND a.is_active AND p.provider_payment_reference=record_verified_refund.provider_payment_reference;
 IF payment.id IS NULL THEN RAISE EXCEPTION 'Unknown merchant/payment' USING ERRCODE='22023'; END IF;
 payment:=app.lock_order_payment(payment.id);
 SELECT r.* INTO refund FROM app.payment_refunds r WHERE r.payment_id=payment.id AND r.provider_refund_reference=record_verified_refund.provider_refund_reference FOR UPDATE;
 IF refund.id IS NULL OR verified_amount_paise IS DISTINCT FROM refund.amount_paise OR verified_currency IS DISTINCT FROM payment.currency THEN RAISE EXCEPTION 'Refund identity/amount/currency mismatch' USING ERRCODE='22023'; END IF;
 fingerprint:=sha256(convert_to(jsonb_build_array(refund.id,outcome,verified_amount_paise,verified_currency)::text,'UTF8'));
 SELECT * INTO previous_event FROM app.payment_events WHERE provider_account_id=account_id AND provider_event_id=event_id;
 IF previous_event.id IS NOT NULL THEN
  IF previous_event.payload_digest IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Provider event reused with different payload' USING ERRCODE='22023'; END IF;
  RETURN;
 END IF;
 INSERT INTO app.payment_events(business_id,order_id,payment_id,refund_id,actor_role,kind,amount_paise,provider_account_id,provider_event_id,payload_digest)
 VALUES(payment.business_id,payment.order_id,payment.id,refund.id,'PROVIDER','VERIFIED_REFUND',verified_amount_paise,account_id,event_id,fingerprint);
 IF refund.status<>outcome THEN PERFORM app.finish_refund(refund.id,outcome,NULL,'PROVIDER'); END IF;
END;
$fn$;
CREATE FUNCTION api.audit_history(target_store uuid DEFAULT NULL,row_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF target_store IS NOT NULL AND NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF row_limit IS NULL OR row_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='22023'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id) FROM
 (SELECT * FROM app.audit_logs WHERE business_id=actor.business_id AND (target_store IS NULL OR store_id=target_store)
 ORDER BY created_at DESC,id LIMIT row_limit) q),'[]'::jsonb);
END;
$fn$;

DO $protection$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['audit_logs','orders','order_items','order_item_fulfillment','order_status_history','order_access_tokens',
 'order_requests','payment_provider_accounts','payments','payment_refunds','refund_allocations','payment_events'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['audit_logs','order_items','order_item_fulfillment','order_status_history','refund_allocations','payment_events'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['orders','payments','payment_refunds','order_access_tokens','order_requests','payment_provider_accounts'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_snapshot BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_core_snapshot()',name);
 END LOOP;
END;
$protection$;
REVOKE ALL ON SEQUENCE app.order_number_seq FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
-- Revoke only functions created in this migration; preserve prior capabilities.
REVOKE ALL ON FUNCTION
 app.core_audit(uuid,uuid,uuid,text,text,uuid,jsonb),app.bridge_staff_audit(),app.guard_core_snapshot(),
 app.build_order_quote(uuid,jsonb),app.require_order_staff(uuid),app.lock_order_payment(uuid),app.finish_refund(uuid,text,uuid,text),
 api.checkout_quote(uuid,jsonb),api.place_order(uuid,uuid,jsonb,text,text,timestamptz),
 api.order_queue(uuid,integer,timestamptz),api.order_detail(uuid),api.transition_order(uuid,bigint,text,text),
 api.record_fulfilled_weight(uuid,uuid,bigint,integer),api.track_order(text),api.revoke_order_tracking(uuid),
 api.receive_cash(uuid,bigint),api.submit_payment_reference(uuid,bigint,text),
 api.bind_provider_payment(uuid,uuid,text),api.record_verified_payment(uuid,text,text,text,bigint,text),
 api.request_refund(uuid,bigint,uuid,jsonb,text),api.complete_cash_refund(uuid,bigint),
 api.bind_provider_refund(uuid,text),api.record_verified_refund(uuid,text,text,text,text,bigint,text),api.audit_history(uuid,integer)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT USAGE ON SCHEMA api TO trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.checkout_quote(uuid,jsonb),api.place_order(uuid,uuid,jsonb,text,text,timestamptz) TO trait_checkout;
GRANT EXECUTE ON FUNCTION api.bind_provider_payment(uuid,uuid,text),api.record_verified_payment(uuid,text,text,text,bigint,text),
 api.bind_provider_refund(uuid,text),api.record_verified_refund(uuid,text,text,text,text,bigint,text) TO trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.track_order(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION api.order_queue(uuid,integer,timestamptz),api.order_detail(uuid),api.transition_order(uuid,bigint,text,text),
 api.record_fulfilled_weight(uuid,uuid,bigint,integer),api.revoke_order_tracking(uuid),
 api.receive_cash(uuid,bigint),api.submit_payment_reference(uuid,bigint,text),
 api.request_refund(uuid,bigint,uuid,jsonb,text),api.complete_cash_refund(uuid,bigint),api.audit_history(uuid,integer) TO authenticated;

-- Additive key for tenant-safe price provenance; existing price history is intact.
CREATE UNIQUE INDEX product_prices_business_identity_key ON app.product_prices(business_id,id);
ALTER TABLE app.order_items ADD CONSTRAINT order_items_tenant_price_fkey
 FOREIGN KEY(business_id,price_id) REFERENCES app.product_prices(business_id,id);
CREATE FUNCTION app.guard_order_item_provenance() RETURNS trigger
LANGUAGE plpgsql SET search_path=''
AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.product_prices pr JOIN app.product_store_settings s ON s.id=pr.offering_id
 JOIN app.orders o ON o.id=NEW.order_id AND o.business_id=NEW.business_id
 WHERE pr.id=NEW.price_id AND pr.business_id=NEW.business_id AND s.product_id=NEW.product_id
 AND s.store_id=o.store_id AND pr.price_per_kg_paise=NEW.price_per_kg_paise)
 THEN RAISE EXCEPTION 'Order item price provenance mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER order_item_provenance BEFORE INSERT ON app.order_items FOR EACH ROW EXECUTE FUNCTION app.guard_order_item_provenance();
CREATE FUNCTION api.payment_history(target_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 PERFORM app.require_staff(ARRAY['ADMIN','OWNER']);
 PERFORM app.require_order_staff(target_order);
 RETURN jsonb_build_object(
 'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY attempt_number) FROM app.payments p WHERE order_id=target_order),'[]'::jsonb),
 'refunds',COALESCE((SELECT jsonb_agg(to_jsonb(r)-'request_digest' ORDER BY created_at,id) FROM app.payment_refunds r WHERE order_id=target_order),'[]'::jsonb),
 'allocations',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM app.refund_allocations a WHERE order_id=target_order),'[]'::jsonb),
 'events',COALESCE((SELECT jsonb_agg(to_jsonb(e)-'payload_digest' ORDER BY created_at,id) FROM app.payment_events e WHERE order_id=target_order),'[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION app.guard_order_item_provenance(),api.payment_history(uuid)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.payment_history(uuid) TO authenticated;

DO $security$
DECLARE role_name text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'
 AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR pg_get_userbyid(c.relowner)<>'postgres')) THEN RAISE EXCEPTION 'Unsafe table state'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','api')) THEN RAISE EXCEPTION 'Unexpected RLS policy'; END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','trait_checkout','trait_payment_verifier'] LOOP
  IF has_schema_privilege(role_name,'app','USAGE,CREATE') OR has_schema_privilege(role_name,'api','CREATE') OR
  EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','api') AND c.relkind='r'
  AND (has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
  THEN RAISE EXCEPTION 'Unexpected direct access for %',role_name; END IF;
  IF has_sequence_privilege(role_name,'app.order_number_seq','USAGE,SELECT,UPDATE') THEN RAISE EXCEPTION 'Unexpected sequence capability'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','api')
 AND (pg_get_userbyid(p.proowner)<>'postgres' OR (p.prosecdef AND NOT COALESCE('search_path=""'=ANY(p.proconfig),false))
 OR has_function_privilege('service_role',p.oid,'EXECUTE')
 OR (n.nspname='app' AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
 OR has_function_privilege('trait_checkout',p.oid,'EXECUTE') OR has_function_privilege('trait_payment_verifier',p.oid,'EXECUTE')))
 OR (has_function_privilege('anon',p.oid,'EXECUTE') AND p.proname NOT IN ('catalogue','fulfillment_options','track_order'))))
 THEN RAISE EXCEPTION 'Unsafe function capability'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('trait_checkout','trait_payment_verifier') AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb))
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname IN ('trait_checkout','trait_payment_verifier')
 AND (pg_get_userbyid(m.member)<>'postgres' OR m.inherit_option OR m.set_option))
 THEN RAISE EXCEPTION 'Server roles allow only the automatic postgres administrative membership'; END IF;
END;
$security$;
COMMIT;
