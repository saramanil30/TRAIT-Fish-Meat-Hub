-- Store WhatsApp number and pickup instructions, published through api.storefront_info.
-- Forward-only: nullable columns, no values set here; existing rows are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE app.stores
 ADD COLUMN whatsapp_e164 text CHECK(whatsapp_e164 ~ '^\+91[6-9][0-9]{9}$'),
 ADD COLUMN pickup_instructions text CHECK(length(pickup_instructions) BETWEEN 1 AND 500 AND pickup_instructions=btrim(pickup_instructions) AND pickup_instructions ~ '[^[:space:]]');
CREATE OR REPLACE FUNCTION api.storefront_info(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT jsonb_build_object('name',s.name,'address',jsonb_strip_nulls(jsonb_build_object('line1',s.address_line1,'line2',s.address_line2,'locality',s.locality,'city',s.city,'state',s.state,'pincode',s.pincode)),
 'phone',s.contact_mobile_e164,'whatsapp',s.whatsapp_e164,'timezone',s.timezone,'hours',s.opening_hours,'pickup',s.pickup_enabled,
 'pickupInstructions',CASE WHEN s.pickup_enabled THEN s.pickup_instructions END,'delivery',s.delivery_enabled,
 'areas',COALESCE((SELECT jsonb_agg(jsonb_build_object('pincode',a.pincode,'name',a.name,'feePaise',a.delivery_fee_paise,'minimumPaise',a.minimum_order_paise) ORDER BY a.pincode)
 FROM app.delivery_areas a WHERE a.business_id=s.business_id AND a.store_id=s.id AND a.is_active AND s.delivery_enabled),'[]'::jsonb))
 FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL
$fn$;
REVOKE ALL ON FUNCTION api.storefront_info(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.storefront_info(uuid) TO anon,authenticated;
COMMENT ON FUNCTION api.storefront_info(uuid) IS 'Published active store contact, hours, pickup and delivery rules only; no customer or staff data.';
NOTIFY pgrst,'reload schema';
COMMIT;
