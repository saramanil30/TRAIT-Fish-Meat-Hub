BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- "Change photo" replaces the main photo instead of adding one: the current main photo is soft-removed
-- (is_active=false, its Storage object stays) and the new photo takes its place in the gallery order.
-- With no main photo, the new one becomes main at the front. A product already at 5 photos can still change
-- its main photo (the old main is deactivated before the insert, so app.limit_product_photos passes).
-- Same caller rules as before: ADMIN or OWNER, own business, an uploaded {business}/{product}/{sha256}.webp.
-- No RLS, grant or Storage policy changes.
CREATE OR REPLACE FUNCTION api.set_product_photo(product uuid,object_path text,alternate_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid; current_main app.product_images; uploaded boolean; position integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 PERFORM 1 FROM app.products p WHERE p.id=product AND p.business_id=actor.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF object_path IS NULL OR object_path !~ ('^'||actor.business_id::text||'/'||product::text||'/[0-9a-f]{64}\.webp$') THEN
  RAISE EXCEPTION 'Invalid product photo' USING ERRCODE='22023'; END IF;
 IF to_regclass('storage.objects') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=''product-images'' AND name=$1)' INTO uploaded USING object_path;
  IF NOT uploaded THEN RAISE EXCEPTION 'Invalid product photo' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT * INTO current_main FROM app.product_images i
 WHERE i.product_id=product AND i.business_id=actor.business_id AND i.is_active AND i.is_primary ORDER BY i.sort_order,i.id LIMIT 1;
 -- The same picture again: nothing to change.
 IF current_main.id IS NOT NULL AND current_main.storage_object_path=object_path THEN RETURN current_main.id; END IF;
 IF EXISTS(SELECT 1 FROM app.product_images i WHERE i.product_id=product AND i.is_active AND i.storage_object_path=object_path) THEN
  RAISE EXCEPTION 'This photo is already in the gallery' USING ERRCODE='22023'; END IF;
 IF current_main.id IS NOT NULL THEN
  UPDATE app.product_images i SET is_active=false,is_primary=false WHERE i.id=current_main.id;
  position:=current_main.sort_order;
 ELSE
  -- No main photo: the new one goes first; the others keep their order behind it.
  UPDATE app.product_images i SET sort_order=i.sort_order+1 WHERE i.product_id=product AND i.is_active;
  position:=0;
 END IF;
 INSERT INTO app.product_images(business_id,product_id,asset_path,storage_bucket,storage_object_path,alt_text,is_primary,is_active,sort_order)
 VALUES(actor.business_id,product,NULL,'product-images',object_path,left(coalesce(alternate_text,''),240),true,true,position) RETURNING id INTO result;
 PERFORM app.core_audit(actor.business_id,NULL,actor.id,app.current_staff_role(),'PRODUCT_PHOTO_SAVED',product,
  jsonb_build_object('image',result,'from',COALESCE(current_main.storage_object_path,current_main.asset_path),'to',object_path,'replaced',current_main.id));
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION api.set_product_photo(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION api.set_product_photo(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
