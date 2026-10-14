BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- New-order alerts for EMPLOYEE too. Store scope is unchanged: app.can_access_store limits an EMPLOYEE to the stores
-- they are assigned to (ADMIN/OWNER: every active store of their business). Still read-only; no grant or RLS change.
CREATE OR REPLACE FUNCTION api.new_order_alerts(after_time timestamptz DEFAULT NULL,after_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; latest record; found_orders jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF (after_time IS NULL)<>(after_id IS NULL) THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023'; END IF;
 IF after_time IS NULL THEN
  SELECT o.created_at,o.id INTO latest FROM app.orders o JOIN app.stores s ON s.id=o.store_id AND s.business_id=o.business_id
  WHERE o.business_id=actor.business_id AND app.can_access_store(actor.business_id,o.store_id)
  ORDER BY o.created_at DESC,o.id DESC LIMIT 1;
  RETURN jsonb_build_object('cursor',CASE WHEN latest.id IS NULL THEN NULL ELSE jsonb_build_object('at',latest.created_at,'id',latest.id) END,'orders','[]'::jsonb);
 END IF;
 -- Oldest first, at most 20 per poll; the next poll continues from the last one returned.
 SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id) INTO found_orders FROM
 (SELECT o.id,o.store_id,s.name AS store_name,o.order_number,o.total_paise,o.fulfillment_method,o.created_at,o.fulfillment_snapshot->'slot' AS slot
  FROM app.orders o JOIN app.stores s ON s.id=o.store_id AND s.business_id=o.business_id
  WHERE o.business_id=actor.business_id AND app.can_access_store(actor.business_id,o.store_id)
  AND (o.created_at,o.id)>(after_time,after_id)
  ORDER BY o.created_at,o.id LIMIT 20) q;
 IF found_orders IS NULL THEN RETURN jsonb_build_object('cursor',jsonb_build_object('at',after_time,'id',after_id),'orders','[]'::jsonb); END IF;
 RETURN jsonb_build_object('cursor',jsonb_build_object('at',found_orders->-1->'created_at','id',found_orders->-1->'id'),'orders',found_orders);
END $fn$;

COMMIT;
