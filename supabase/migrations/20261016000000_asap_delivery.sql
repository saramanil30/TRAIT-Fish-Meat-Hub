BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Optional delivery slot: "Deliver now (ASAP)" is allowed while the shop is open. An ASAP order has no slot
-- (delivery_slot_id and delivery_date stay NULL, as orders_slot_pair already allows) and fulfillment.asap=true.
-- When the shop is closed and the store has active slots, a slot is still required. No grant on tables, no RLS change.

-- Open now: the current time in the store's time zone falls inside one of today's opening_hours intervals
-- (e.g. {"mon":[{"opens":"07:00","closes":"20:30"}]}). A day with no intervals is closed.
CREATE FUNCTION app.store_open_now(target_store uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM app.stores s,
  LATERAL (SELECT statement_timestamp() AT TIME ZONE s.timezone AS local_now) n,
  LATERAL jsonb_array_elements(COALESCE(s.opening_hours->to_char(n.local_now,'dy'),'[]'::jsonb)) h
  WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL
  AND to_char(n.local_now,'HH24:MI') COLLATE "C">=(h->>'opens') COLLATE "C"
  AND to_char(n.local_now,'HH24:MI') COLLATE "C"<(h->>'closes') COLLATE "C")
$fn$;

-- Same as 20261010000000_delivery_slots.sql, except a NULL choice (ASAP) is also allowed while the shop is open.
CREATE OR REPLACE FUNCTION app.check_delivery_slot(target_store uuid,business uuid,choice jsonb,lock boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s app.delivery_slots; d date; today date:=app.ist_today(); booked integer;
BEGIN
 IF choice IS NULL OR choice='null'::jsonb THEN
  IF NOT app.store_open_now(target_store)
  AND EXISTS(SELECT 1 FROM app.delivery_slots WHERE business_id=business AND store_id=target_store AND is_active)
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

-- Same as 20261010000000_delivery_slots.sql, except an order without a slot is marked fulfillment.asap=true
-- (stored on the order's fulfillment_snapshot). The digest is recomputed so it covers the slot or the ASAP mark.
CREATE OR REPLACE FUNCTION app.build_slotted_quote(target_store uuid,payload jsonb,lock boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE quote jsonb; slot jsonb;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid checkout choices' USING ERRCODE='22023'; END IF;
 quote:=app.build_order_quote(target_store,payload-'slot');
 slot:=app.check_delivery_slot(target_store,(quote->>'businessId')::uuid,payload->'slot',lock);
 IF slot IS NULL THEN quote:=jsonb_set(quote-'quoteDigest','{fulfillment,asap}','true'::jsonb);
 ELSE quote:=jsonb_set(quote-'quoteDigest','{fulfillment,slot}',slot); END IF;
 RETURN quote||jsonb_build_object('quoteDigest',encode(sha256(convert_to(quote::text,'UTF8')),'hex'));
END $fn$;

-- Checkout (server-only connection): whether "Deliver now (ASAP)" can be offered right now.
CREATE FUNCTION api.checkout_asap_available(target_store uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT app.store_open_now(target_store)
$fn$;

REVOKE ALL ON FUNCTION app.store_open_now(uuid),api.checkout_asap_available(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.checkout_asap_available(uuid) TO trait_checkout;
COMMENT ON FUNCTION api.checkout_asap_available(uuid) IS 'Server-only (trait_checkout): true while the store is open, so checkout may offer ASAP.';
COMMIT;
