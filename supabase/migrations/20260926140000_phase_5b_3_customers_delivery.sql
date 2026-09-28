-- Phase 5B.3: private customers, addresses and store-aware fulfillment.
-- No seeds, Auth/Storage changes, customer login, orders or payments.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run as postgres'; END IF;
 IF to_regprocedure('api.catalogue(uuid,uuid)') IS NULL OR to_regclass('app.product_images') IS NULL
 THEN RAISE EXCEPTION 'Phase 5B.2 required'; END IF;
 IF to_regclass('app.customers') IS NOT NULL OR to_regclass('app.customer_addresses') IS NOT NULL
 OR to_regclass('app.delivery_areas') IS NOT NULL THEN RAISE EXCEPTION 'Unexpected Phase 5B.3 state'; END IF;
END;
$preflight$;

-- Formatting normalization is not phone ownership verification.
CREATE FUNCTION app.normalize_indian_mobile(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE digits text;
BEGIN
 IF value IS NULL OR length(value)>40 OR value !~ '^[+0-9 ()-]+$' THEN
  RAISE EXCEPTION 'Invalid Indian mobile number' USING ERRCODE='22023'; END IF;
 digits:=regexp_replace(value,'[ ()-]','','g');
 IF digits ~ '^[6-9][0-9]{9}$' THEN RETURN '+91'||digits;
 ELSIF digits ~ '^0[6-9][0-9]{9}$' THEN RETURN '+91'||substr(digits,2);
 ELSIF digits ~ '^91[6-9][0-9]{9}$' THEN RETURN '+'||digits;
 ELSIF digits ~ '^\+91[6-9][0-9]{9}$' THEN RETURN digits; END IF;
 RAISE EXCEPTION 'Invalid Indian mobile number' USING ERRCODE='22023';
END;
$fn$;

CREATE TABLE app.customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 mobile_e164 text NOT NULL CHECK(mobile_e164 ~ '^\+91[6-9][0-9]{9}$'),
 mobile_verified_at timestamptz,
 display_name text CHECK(length(display_name) BETWEEN 1 AND 160 AND display_name=btrim(display_name) AND display_name ~ '[^[:space:]]'),
 is_active boolean NOT NULL DEFAULT true,
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(business_id,id),
 CHECK((auth_user_id IS NULL AND mobile_verified_at IS NULL) OR (auth_user_id IS NOT NULL AND mobile_verified_at IS NOT NULL)),
 CHECK(deleted_at IS NULL OR NOT is_active),
 CHECK(updated_at>=created_at)
);
CREATE UNIQUE INDEX customers_auth_identity_key ON app.customers(business_id,auth_user_id) WHERE auth_user_id IS NOT NULL;
-- Nonunique: possession of a phone string never identifies an account.
CREATE INDEX customers_mobile_idx ON app.customers(business_id,mobile_e164);
CREATE INDEX customers_auth_user_idx ON app.customers(auth_user_id) WHERE auth_user_id IS NOT NULL;
COMMENT ON TABLE app.customers IS 'Private future identity. Guest checkout does not create or resolve this row. Auth linking and verification timestamps require a future trusted verification workflow; phone matching is never authorization.';

CREATE TABLE app.customer_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 label text CHECK(length(label) BETWEEN 1 AND 80 AND label=btrim(label) AND label ~ '[^[:space:]]'),
 recipient_name text NOT NULL CHECK(length(recipient_name) BETWEEN 1 AND 160 AND recipient_name=btrim(recipient_name) AND recipient_name ~ '[^[:space:]]'),
 recipient_mobile_e164 text NOT NULL CHECK(recipient_mobile_e164 ~ '^\+91[6-9][0-9]{9}$'),
 address_line1 text NOT NULL CHECK(length(address_line1) BETWEEN 1 AND 240 AND address_line1=btrim(address_line1) AND address_line1 ~ '[^[:space:]]'),
 address_line2 text CHECK(length(address_line2) BETWEEN 1 AND 240 AND address_line2=btrim(address_line2) AND address_line2 ~ '[^[:space:]]'),
 locality text CHECK(length(locality) BETWEEN 1 AND 120 AND locality=btrim(locality) AND locality ~ '[^[:space:]]'),
 city text NOT NULL CHECK(length(city) BETWEEN 1 AND 120 AND city=btrim(city) AND city ~ '[^[:space:]]'),
 state text NOT NULL CHECK(length(state) BETWEEN 1 AND 120 AND state=btrim(state) AND state ~ '[^[:space:]]'),
 country_code text NOT NULL DEFAULT 'IN' CHECK(country_code='IN'),
 pincode text NOT NULL CHECK(pincode ~ '^[1-9][0-9]{5}$'),
 is_active boolean NOT NULL DEFAULT true,
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(business_id,customer_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id) ON DELETE RESTRICT,
 CHECK(deleted_at IS NULL OR NOT is_active),
 CHECK(updated_at>=created_at)
);
COMMENT ON TABLE app.customer_addresses IS 'Private reusable saved-address foundation; no customer/staff endpoint yet. Revalidate eligibility for the selected store at checkout. Never resolve ownership by recipient phone.';

CREATE TABLE app.delivery_areas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 store_id uuid NOT NULL,
 pincode text NOT NULL CHECK(pincode ~ '^[1-9][0-9]{5}$'),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160 AND name=btrim(name) AND name ~ '[^[:space:]]'),
 delivery_fee_paise bigint NOT NULL CHECK(delivery_fee_paise BETWEEN 0 AND 1000000000000),
 minimum_order_paise bigint NOT NULL CHECK(minimum_order_paise BETWEEN 0 AND 1000000000000),
 is_active boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(business_id,id),
 UNIQUE(business_id,store_id,id),
 UNIQUE(business_id,store_id,pincode),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id) ON DELETE RESTRICT,
 CHECK(updated_at>=created_at)
);
COMMENT ON TABLE app.delivery_areas IS 'One explicit whole-pincode rule per store. No rule means no Home Delivery. Fees/minimums have no seeded defaults. Recheck revisions in the future order transaction.';

CREATE FUNCTION app.guard_customer_delivery_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
 IF TG_TABLE_NAME='customers' THEN
  NEW.mobile_e164:=app.normalize_indian_mobile(NEW.mobile_e164);
  IF TG_OP='UPDATE' AND OLD.auth_user_id IS NOT NULL AND
   (NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id OR NEW.mobile_e164 IS DISTINCT FROM OLD.mobile_e164
    OR NEW.mobile_verified_at IS DISTINCT FROM OLD.mobile_verified_at) THEN
   RAISE EXCEPTION 'Verified identity changes require a reviewed recovery workflow' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='customer_addresses' THEN
  NEW.recipient_mobile_e164:=app.normalize_indian_mobile(NEW.recipient_mobile_e164);
  IF TG_OP='UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
   RAISE EXCEPTION 'Address owner is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND (NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.pincode IS DISTINCT FROM OLD.pincode) THEN
   RAISE EXCEPTION 'Delivery rule identity is immutable; deactivate and create a new rule' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN NEW.version:=1; ELSE NEW.version:=OLD.version+1; END IF;
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER customers_identity BEFORE INSERT OR UPDATE ON app.customers FOR EACH ROW EXECUTE FUNCTION app.guard_customer_delivery_identity();
CREATE TRIGGER customers_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.customers FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER customer_addresses_identity BEFORE INSERT OR UPDATE ON app.customer_addresses FOR EACH ROW EXECUTE FUNCTION app.guard_customer_delivery_identity();
CREATE TRIGGER customer_addresses_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.customer_addresses FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER delivery_areas_identity BEFORE INSERT OR UPDATE ON app.delivery_areas FOR EACH ROW EXECUTE FUNCTION app.guard_customer_delivery_identity();
CREATE TRIGGER delivery_areas_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.delivery_areas FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();

CREATE FUNCTION api.delivery_areas(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.pincode) FROM app.delivery_areas d
 WHERE d.business_id=actor.business_id AND d.store_id=target_store),'[]'::jsonb);
END;
$fn$;

CREATE FUNCTION api.save_delivery_area(target_id uuid,target_store uuid,expected_version bigint,
 area_pincode text,area_name text,fee_paise bigint,minimum_paise bigint,active boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; previous app.delivery_areas; result app.delivery_areas;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF target_id IS NULL THEN
  IF expected_version IS NOT NULL THEN RAISE EXCEPTION 'New rule must not supply a version' USING ERRCODE='22023'; END IF;
  INSERT INTO app.delivery_areas(business_id,store_id,pincode,name,delivery_fee_paise,minimum_order_paise,is_active)
  VALUES(actor.business_id,target_store,area_pincode,btrim(area_name),fee_paise,minimum_paise,active) RETURNING * INTO result;
 ELSE
  SELECT * INTO previous FROM app.delivery_areas WHERE id=target_id AND business_id=actor.business_id AND store_id=target_store FOR UPDATE;
  IF previous.id IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF expected_version IS NULL OR previous.version<>expected_version THEN RAISE EXCEPTION 'Delivery rule changed; reload' USING ERRCODE='40001'; END IF;
  UPDATE app.delivery_areas SET pincode=area_pincode,name=btrim(area_name),delivery_fee_paise=fee_paise,minimum_order_paise=minimum_paise,is_active=active
  WHERE id=previous.id RETURNING * INTO result;
 END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail)
 VALUES(actor.business_id,actor.id,'DELIVERY_AREA_SAVED',result.id,
 jsonb_build_object('storeId',target_store,'pincode',result.pincode,'oldFeePaise',previous.delivery_fee_paise,
 'feePaise',result.delivery_fee_paise,'oldMinimumPaise',previous.minimum_order_paise,'minimumPaise',result.minimum_order_paise,
 'wasActive',previous.is_active,'active',result.is_active,'version',result.version));
 RETURN result.id;
END;
$fn$;

-- Public configuration only, no phone/address input or customer lookup. Advisory,
-- not a quote or order authorization. Checkout must revalidate transactionally.
CREATE FUNCTION api.fulfillment_options(target_store uuid,delivery_pincode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE shop app.stores; area app.delivery_areas;
BEGIN
 SELECT s.* INTO shop FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL;
 IF shop.id IS NULL THEN RETURN jsonb_build_object('homeDelivery',false,'storePickup',false); END IF;
 IF shop.delivery_enabled AND delivery_pincode ~ '^[1-9][0-9]{5}$' THEN
  SELECT * INTO area FROM app.delivery_areas WHERE business_id=shop.business_id AND store_id=shop.id AND pincode=delivery_pincode AND is_active; END IF;
 RETURN jsonb_build_object('homeDelivery',area.id IS NOT NULL,'storePickup',shop.pickup_enabled,
 'deliveryRule',CASE WHEN area.id IS NOT NULL THEN jsonb_build_object('id',area.id,'pincode',area.pincode,'name',area.name,
 'feePaise',area.delivery_fee_paise,'minimumOrderPaise',area.minimum_order_paise,'version',area.version) ELSE NULL END);
END;
$fn$;

-- Private future checkout helper: subtotal MUST come from trusted repricing.
-- No browser EXECUTE, customer creation or phone lookup. Future order transaction
-- must lock/recheck store and area configuration before committing.
CREATE FUNCTION app.validate_guest_fulfillment(target_store uuid,fulfillment_method text,mobile text,
 customer_name text,delivery_address jsonb,subtotal_paise bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE normalized_mobile text; options jsonb; address jsonb; item record; max_length integer;
BEGIN
 normalized_mobile:=app.normalize_indian_mobile(mobile);
 IF subtotal_paise IS NULL OR subtotal_paise NOT BETWEEN 0 AND 1000000000000 THEN RAISE EXCEPTION 'Invalid trusted subtotal' USING ERRCODE='22023'; END IF;
 IF customer_name IS NOT NULL AND (length(btrim(customer_name))>160 OR customer_name !~ '[^[:space:]]') THEN RAISE EXCEPTION 'Invalid name' USING ERRCODE='22023'; END IF;
 IF fulfillment_method='HOME_DELIVERY' THEN
  IF customer_name IS NULL OR length(btrim(customer_name))=0 THEN RAISE EXCEPTION 'Delivery name required' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(delivery_address) IS DISTINCT FROM 'object' OR octet_length(delivery_address::text)>4096
   OR (delivery_address - ARRAY['line1','line2','locality','city','state','pincode','countryCode'])<>'{}'::jsonb THEN
   RAISE EXCEPTION 'Invalid delivery address' USING ERRCODE='22023'; END IF;
  address:='{}'::jsonb;
  FOR item IN SELECT key,value FROM jsonb_each(delivery_address) LOOP
   IF jsonb_typeof(item.value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Address values must be text' USING ERRCODE='22023'; END IF;
   max_length:=CASE WHEN item.key IN ('line1','line2') THEN 240 ELSE 120 END;
   IF length(btrim(item.value #>> '{}')) NOT BETWEEN 1 AND max_length OR (item.value #>> '{}') !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'Invalid address field' USING ERRCODE='22023'; END IF;
   address:=address||jsonb_build_object(item.key,btrim(item.value #>> '{}'));
  END LOOP;
  IF NOT(address ?& ARRAY['line1','city','state','pincode']) OR (address->>'pincode') !~ '^[1-9][0-9]{5}$'
   OR (address ? 'countryCode' AND address->>'countryCode'<>'IN') THEN RAISE EXCEPTION 'Complete Indian address required' USING ERRCODE='22023'; END IF;
  address:=address||jsonb_build_object('countryCode','IN');
  options:=api.fulfillment_options(target_store,address->>'pincode');
  IF NOT (options->>'homeDelivery')::boolean THEN RAISE EXCEPTION 'Home Delivery unavailable' USING ERRCODE='22023'; END IF;
  IF subtotal_paise<(options->'deliveryRule'->>'minimumOrderPaise')::bigint THEN RAISE EXCEPTION 'Delivery minimum not met' USING ERRCODE='22023'; END IF;
 ELSIF fulfillment_method='STORE_PICKUP' THEN
  options:=api.fulfillment_options(target_store,NULL);
  IF NOT (options->>'storePickup')::boolean THEN RAISE EXCEPTION 'Store Pickup unavailable' USING ERRCODE='22023'; END IF;
  address:=NULL;
 ELSE RAISE EXCEPTION 'Invalid fulfillment method' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('storeId',target_store,'method',fulfillment_method,'mobileE164',normalized_mobile,
 'name',btrim(customer_name),'address',address,'deliveryRule',options->'deliveryRule');
END;
$fn$;

ALTER TABLE app.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE app.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customer_addresses FORCE ROW LEVEL SECURITY;
ALTER TABLE app.delivery_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.delivery_areas FORCE ROW LEVEL SECURITY;
-- Only new objects; preserve every existing capability.
REVOKE ALL ON app.customers,app.customer_addresses,app.delivery_areas FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION app.normalize_indian_mobile(text),app.guard_customer_delivery_identity(),
 app.validate_guest_fulfillment(uuid,text,text,text,jsonb,bigint),api.delivery_areas(uuid),
 api.save_delivery_area(uuid,uuid,bigint,text,text,bigint,bigint,boolean),api.fulfillment_options(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.delivery_areas(uuid),api.save_delivery_area(uuid,uuid,bigint,text,text,bigint,bigint,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION api.fulfillment_options(uuid,text) TO anon,authenticated;

DO $security$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'
 AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR pg_get_userbyid(c.relowner)<>'postgres')) THEN RAISE EXCEPTION 'Unsafe table state'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE r.rolname IN ('anon','authenticated','service_role') AND n.nspname IN ('app','api') AND c.relkind='r'
 AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN RAISE EXCEPTION 'Unexpected direct table access'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','api')
 AND (pg_get_userbyid(p.proowner)<>'postgres' OR has_function_privilege('service_role',p.oid,'EXECUTE')
 OR (has_function_privilege('anon',p.oid,'EXECUTE') AND NOT(n.nspname='api' AND p.proname IN ('catalogue','fulfillment_options')))
 OR (n.nspname='app' AND has_function_privilege('authenticated',p.oid,'EXECUTE')))) THEN RAISE EXCEPTION 'Unexpected function grants'; END IF;
END;
$security$;
COMMIT;
