-- Per-pincode delivery mode. "SHOP" (as before: the shop's fixed fee) or "RAPIDO": the parcel goes by Rapido, our fee is 0,
-- the customer pays Rapido separately (owner-written estimate text), and optionally advance payment is required (no cash).
-- The mode, estimate and advance flag travel in the quote's fulfillment.deliveryRule, so every order snapshot keeps the rule
-- it was placed under. ADMIN/OWNER can attach a Rapido tracking link to a Rapido order (a separate table: order snapshots stay
-- immutable). No table grant, no RLS change: every new table has RLS enabled and forced, and is reached only through functions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
BEGIN
 IF to_regprocedure('api.save_delivery_area(uuid,uuid,bigint,text,text,bigint,bigint,boolean)') IS NULL
 OR to_regprocedure('app.build_slotted_quote(uuid,jsonb,boolean)') IS NULL
 OR to_regprocedure('api.online_payment(uuid,uuid)') IS NULL
 OR to_regclass('app.order_rapido_tracking') IS NOT NULL
 THEN RAISE EXCEPTION 'Unexpected state for the Rapido delivery migration'; END IF;
END $preflight$;

ALTER TABLE app.delivery_areas
 ADD COLUMN delivery_mode text NOT NULL DEFAULT 'SHOP' CHECK(delivery_mode IN ('SHOP','RAPIDO')),
 ADD COLUMN rapido_estimate text CHECK(app.valid_plain_text(rapido_estimate,120)),
 ADD COLUMN advance_payment_required boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT delivery_areas_mode_rules CHECK(
  (delivery_mode='SHOP' AND rapido_estimate IS NULL AND NOT advance_payment_required)
  OR (delivery_mode='RAPIDO' AND delivery_fee_paise=0));
COMMENT ON COLUMN app.delivery_areas.delivery_mode IS 'SHOP: our fixed delivery_fee_paise. RAPIDO: fee 0 in our total; the customer pays Rapido separately.';

-- Same as 20260926140000, plus mode, estimate and advance. A Rapido rule always stores fee 0.
DROP FUNCTION api.save_delivery_area(uuid,uuid,bigint,text,text,bigint,bigint,boolean);
CREATE FUNCTION api.save_delivery_area(target_id uuid,target_store uuid,expected_version bigint,
 area_pincode text,area_name text,fee_paise bigint,minimum_paise bigint,active boolean,
 mode text DEFAULT 'SHOP',estimate text DEFAULT NULL,advance_required boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles; previous app.delivery_areas; result app.delivery_areas;
 rapido boolean:=mode='RAPIDO'; note text:=NULLIF(btrim(regexp_replace(COALESCE(estimate,''),'\s+',' ','g')),'');
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF mode IS NULL OR mode NOT IN ('SHOP','RAPIDO') OR advance_required IS NULL OR NOT app.valid_plain_text(note,120)
 THEN RAISE EXCEPTION 'Invalid delivery mode' USING ERRCODE='22023'; END IF;
 IF target_id IS NULL THEN
  IF expected_version IS NOT NULL THEN RAISE EXCEPTION 'New rule must not supply a version' USING ERRCODE='22023'; END IF;
  INSERT INTO app.delivery_areas(business_id,store_id,pincode,name,delivery_fee_paise,minimum_order_paise,is_active,delivery_mode,rapido_estimate,advance_payment_required)
  VALUES(actor.business_id,target_store,area_pincode,btrim(area_name),CASE WHEN rapido THEN 0 ELSE fee_paise END,minimum_paise,active,
   mode,CASE WHEN rapido THEN note END,rapido AND advance_required) RETURNING * INTO result;
 ELSE
  SELECT * INTO previous FROM app.delivery_areas WHERE id=target_id AND business_id=actor.business_id AND store_id=target_store FOR UPDATE;
  IF previous.id IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF expected_version IS NULL OR previous.version<>expected_version THEN RAISE EXCEPTION 'Delivery rule changed; reload' USING ERRCODE='40001'; END IF;
  UPDATE app.delivery_areas SET pincode=area_pincode,name=btrim(area_name),delivery_fee_paise=CASE WHEN rapido THEN 0 ELSE fee_paise END,
   minimum_order_paise=minimum_paise,is_active=active,delivery_mode=mode,rapido_estimate=CASE WHEN rapido THEN note END,
   advance_payment_required=rapido AND advance_required
  WHERE id=previous.id RETURNING * INTO result;
 END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail)
 VALUES(actor.business_id,actor.id,'DELIVERY_AREA_SAVED',result.id,
 jsonb_build_object('storeId',target_store,'pincode',result.pincode,'oldFeePaise',previous.delivery_fee_paise,
 'feePaise',result.delivery_fee_paise,'oldMinimumPaise',previous.minimum_order_paise,'minimumPaise',result.minimum_order_paise,
 'wasActive',previous.is_active,'active',result.is_active,'version',result.version,
 'oldMode',previous.delivery_mode,'mode',result.delivery_mode,'advanceRequired',result.advance_payment_required));
 RETURN result.id;
END;
$fn$;

-- Same as 20260926140000, plus mode, rapidoEstimate and advanceRequired on the rule (and so on every quote and order snapshot).
CREATE OR REPLACE FUNCTION api.fulfillment_options(target_store uuid,delivery_pincode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
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
 'feePaise',area.delivery_fee_paise,'minimumOrderPaise',area.minimum_order_paise,'version',area.version,
 'mode',area.delivery_mode,'rapidoEstimate',area.rapido_estimate,'advanceRequired',area.advance_payment_required) ELSE NULL END);
END;
$fn$;

-- Same as 20261016000000_asap_delivery.sql, except a Rapido area that requires advance payment rejects cash.
CREATE OR REPLACE FUNCTION app.build_slotted_quote(target_store uuid,payload jsonb,lock boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE quote jsonb; slot jsonb;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid checkout choices' USING ERRCODE='22023'; END IF;
 quote:=app.build_order_quote(target_store,payload-'slot');
 IF quote->>'paymentMethod'='CASH' AND COALESCE((quote->'fulfillment'->'deliveryRule'->>'advanceRequired')::boolean,false)
 THEN RAISE EXCEPTION 'Advance payment required for this area' USING ERRCODE='22023'; END IF;
 slot:=app.check_delivery_slot(target_store,(quote->>'businessId')::uuid,payload->'slot',lock);
 IF slot IS NULL THEN quote:=jsonb_set(quote-'quoteDigest','{fulfillment,asap}','true'::jsonb);
 ELSE quote:=jsonb_set(quote-'quoteDigest','{fulfillment,slot}',slot); END IF;
 RETURN quote||jsonb_build_object('quoteDigest',encode(sha256(convert_to(quote::text,'UTF8')),'hex'));
END $fn$;

-- Same as 20261002010000_store_contact_details.sql, plus each area's mode, estimate and advance flag.
CREATE OR REPLACE FUNCTION api.storefront_info(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT jsonb_build_object('name',s.name,'address',jsonb_strip_nulls(jsonb_build_object('line1',s.address_line1,'line2',s.address_line2,'locality',s.locality,'city',s.city,'state',s.state,'pincode',s.pincode)),
 'phone',s.contact_mobile_e164,'whatsapp',s.whatsapp_e164,'timezone',s.timezone,'hours',s.opening_hours,'pickup',s.pickup_enabled,
 'pickupInstructions',CASE WHEN s.pickup_enabled THEN s.pickup_instructions END,'delivery',s.delivery_enabled,
 'areas',COALESCE((SELECT jsonb_agg(jsonb_build_object('pincode',a.pincode,'name',a.name,'feePaise',a.delivery_fee_paise,'minimumPaise',a.minimum_order_paise,
  'mode',a.delivery_mode,'rapidoEstimate',a.rapido_estimate,'advanceRequired',a.advance_payment_required) ORDER BY a.pincode)
 FROM app.delivery_areas a WHERE a.business_id=s.business_id AND a.store_id=s.id AND a.is_active AND s.delivery_enabled),'[]'::jsonb))
 FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL
$fn$;

-- One Rapido tracking link per Rapido order, set by ADMIN/OWNER and shown to the customer on tracking.
CREATE TABLE app.order_rapido_tracking(
 order_id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 tracking_url text NOT NULL CHECK(length(tracking_url)<=500 AND tracking_url ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]<>"'']*)?$'),
 updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,updated_by) REFERENCES app.staff_profiles(business_id,id),
 CHECK(updated_at>=created_at)
);
ALTER TABLE app.order_rapido_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_rapido_tracking FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.order_rapido_tracking FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
COMMENT ON TABLE app.order_rapido_tracking IS 'Rapido tracking link for a Rapido delivery order. Written only by api.set_rapido_tracking (ADMIN/OWNER, audited).';

-- ADMIN/OWNER: set (https link) or clear (blank) the Rapido tracking link of a Rapido delivery order.
CREATE FUNCTION api.set_rapido_tracking(target_order uuid,link_url text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; order_row app.orders; link text:=NULLIF(btrim(link_url),'');
BEGIN
 PERFORM app.require_staff(ARRAY['ADMIN','OWNER']);
 actor:=app.require_order_staff(target_order);
 SELECT * INTO order_row FROM app.orders WHERE id=target_order AND business_id=actor.business_id;
 IF order_row.fulfillment_method<>'HOME_DELIVERY' OR COALESCE(order_row.fulfillment_snapshot->'deliveryRule'->>'mode','SHOP')<>'RAPIDO'
 THEN RAISE EXCEPTION 'Not a Rapido delivery' USING ERRCODE='22023'; END IF;
 IF link IS NOT NULL AND (length(link)>500 OR link !~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]<>"'']*)?$')
 THEN RAISE EXCEPTION 'Invalid tracking link' USING ERRCODE='22023'; END IF;
 IF link IS NULL THEN DELETE FROM app.order_rapido_tracking WHERE order_id=order_row.id;
 ELSE
  INSERT INTO app.order_rapido_tracking(order_id,business_id,tracking_url,updated_by) VALUES(order_row.id,order_row.business_id,link,actor.id)
  ON CONFLICT (order_id) DO UPDATE SET tracking_url=EXCLUDED.tracking_url,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
 END IF;
 PERFORM app.core_audit(order_row.business_id,order_row.store_id,actor.id,app.current_staff_role(),'RAPIDO_TRACKING_SET',order_row.id,jsonb_build_object('url',link));
END $fn$;

-- Same as 20261125000000_razorpay_payments.sql, plus the Rapido tracking link.
CREATE OR REPLACE FUNCTION api.order_detail(target_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_order_staff(target_order);
 RETURN jsonb_build_object('order',(SELECT to_jsonb(o) FROM app.orders o WHERE id=target_order),
 'rapidoTrackingUrl',(SELECT t.tracking_url FROM app.order_rapido_tracking t WHERE t.order_id=target_order AND t.business_id=actor.business_id),
 'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY line_number) FROM app.order_items i WHERE order_id=target_order),
 'fulfillment',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY created_at) FROM app.order_item_fulfillment f WHERE order_id=target_order),'[]'::jsonb),
 'payments',(SELECT jsonb_agg(jsonb_build_object('id',p.id,'method',p.method,'status',p.status,'amountPaise',p.amount_paise,'refundedPaise',p.refunded_paise,'version',p.version,
   'providerReference',p.provider_payment_reference,
   'chargeReference',(SELECT e.evidence_reference FROM app.payment_events e WHERE e.payment_id=p.id AND e.kind='PROVIDER_CHARGE' ORDER BY e.created_at DESC LIMIT 1),
   'pendingRefundPaise',(SELECT COALESCE(sum(r.amount_paise),0) FROM app.payment_refunds r WHERE r.payment_id=p.id AND r.status='PENDING'),
   'unsentRefund',EXISTS(SELECT 1 FROM app.payment_refunds r WHERE r.payment_id=p.id AND r.status='PENDING' AND r.provider_refund_reference IS NULL),
   'payUntil',CASE WHEN p.method='ONLINE' THEN (SELECT o.created_at+app.online_pay_window() FROM app.orders o WHERE o.id=p.order_id) END)) FROM app.payments p WHERE p.order_id=target_order),
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at,'actorId',actor_id) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=target_order),
 'stock',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'productName',p.name,'measure',m.measure,'change',m.change,'before',m.on_hand_before,'after',m.on_hand_after,'note',m.note,'at',m.created_at) ORDER BY m.created_at,m.id)
  FROM app.stock_movements m JOIN app.product_store_settings o ON o.id=m.offering_id JOIN app.products p ON p.id=o.product_id
  WHERE m.business_id=actor.business_id AND m.order_id=target_order),'[]'::jsonb));
END;
$fn$;

-- Same as 20261125000000_razorpay_payments.sql, plus the delivery mode and Rapido note from the order's snapshot and its tracking link.
CREATE OR REPLACE FUNCTION api.track_order(tracking_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE order_row app.orders; pay app.payments; rule jsonb;
BEGIN
 IF tracking_token IS NULL OR tracking_token !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT o.* INTO order_row FROM app.order_access_tokens t JOIN app.orders o ON o.id=t.order_id JOIN app.businesses b ON b.id=o.business_id
 WHERE t.token_digest=sha256(convert_to(tracking_token,'UTF8')) AND t.scope='TRACKING' AND t.revoked_at IS NULL
 AND t.expires_at>statement_timestamp() AND b.is_active AND b.deleted_at IS NULL;
 IF order_row.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO pay FROM app.payments WHERE order_id=order_row.id ORDER BY attempt_number DESC LIMIT 1;
 rule:=order_row.fulfillment_snapshot->'deliveryRule';
 RETURN jsonb_build_object('orderNumber',order_row.order_number,'status',order_row.status,'method',order_row.fulfillment_method,'placedAt',order_row.created_at,
 'subtotalPaise',order_row.subtotal_paise,'discountPaise',order_row.discount_paise,'deliveryFeePaise',order_row.delivery_fee_paise,'totalPaise',order_row.total_paise,'offerTitle',order_row.offer_snapshot->>'title',
 'slot',order_row.fulfillment_snapshot->'slot',
 'paymentStatus',pay.status,'paymentMethod',pay.method,
 'onlinePaymentId',CASE WHEN pay.method='ONLINE' AND pay.status IN ('PENDING','FAILED') AND order_row.status<>'CANCELLED' THEN pay.id END,
 'payUntil',CASE WHEN pay.method='ONLINE' THEN order_row.created_at+app.online_pay_window() END,
 'deliveryMode',CASE WHEN order_row.fulfillment_method='HOME_DELIVERY' THEN COALESCE(rule->>'mode','SHOP') END,
 'rapidoEstimate',CASE WHEN rule->>'mode'='RAPIDO' THEN rule->>'rapidoEstimate' END,
 'advanceRequired',COALESCE((rule->>'advanceRequired')::boolean,false),
 'rapidoTrackingUrl',(SELECT r.tracking_url FROM app.order_rapido_tracking r WHERE r.order_id=order_row.id),
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=order_row.id));
END;
$fn$;

REVOKE ALL ON FUNCTION api.save_delivery_area(uuid,uuid,bigint,text,text,bigint,bigint,boolean,text,text,boolean),api.set_rapido_tracking(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.save_delivery_area(uuid,uuid,bigint,text,text,bigint,bigint,boolean,text,text,boolean),api.set_rapido_tracking(uuid,text) TO authenticated;

DO $security$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'
 AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'Unsafe table state'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE r.rolname IN ('anon','authenticated','service_role','trait_checkout','trait_payment_verifier') AND n.nspname='app' AND c.relname IN ('delivery_areas','order_rapido_tracking')
 AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE'))) THEN RAISE EXCEPTION 'Unexpected direct table access'; END IF;
 IF has_function_privilege('anon','api.set_rapido_tracking(uuid,text)','EXECUTE') OR has_function_privilege('trait_checkout','api.set_rapido_tracking(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Unsafe Rapido capability'; END IF;
END $security$;
NOTIFY pgrst,'reload schema';
COMMIT;
