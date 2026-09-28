BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE FUNCTION api.storefront_info(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT jsonb_build_object('name',s.name,'address',jsonb_strip_nulls(jsonb_build_object('line1',s.address_line1,'line2',s.address_line2,'locality',s.locality,'city',s.city,'state',s.state,'pincode',s.pincode)),
 'phone',s.contact_mobile_e164,'timezone',s.timezone,'hours',s.opening_hours,'pickup',s.pickup_enabled,'delivery',s.delivery_enabled,
 'areas',COALESCE((SELECT jsonb_agg(jsonb_build_object('pincode',a.pincode,'name',a.name,'feePaise',a.delivery_fee_paise,'minimumPaise',a.minimum_order_paise) ORDER BY a.pincode)
 FROM app.delivery_areas a WHERE a.business_id=s.business_id AND a.store_id=s.id AND a.is_active AND s.delivery_enabled),'[]'::jsonb))
 FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL
$fn$;
REVOKE ALL ON FUNCTION api.storefront_info(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.storefront_info(uuid) TO anon,authenticated;
COMMENT ON FUNCTION api.storefront_info(uuid) IS 'Published active store contact, hours and delivery rules only; no customer or staff data.';
CREATE FUNCTION api.order_queue_page(target_store uuid,row_limit integer DEFAULT 50,before_time timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; history_days integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF row_limit IS NULL OR row_limit NOT BETWEEN 1 AND 100 OR (before_time IS NULL)<>(before_id IS NULL) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 SELECT employee_operational_history_days INTO history_days FROM app.business_settings WHERE business_id=actor.business_id;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id DESC) FROM
 (SELECT id,order_number,status,fulfillment_method,payment_method,total_paise,version,created_at FROM app.orders
 WHERE business_id=actor.business_id AND store_id=target_store AND (before_time IS NULL OR (created_at,id)<(before_time,before_id))
 AND (app.current_staff_role()<>'EMPLOYEE' OR created_at>=statement_timestamp()-make_interval(days=>history_days))
 ORDER BY created_at DESC,id DESC LIMIT row_limit) q),'[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION api.order_queue_page(uuid,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.order_queue_page(uuid,integer,timestamptz,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
