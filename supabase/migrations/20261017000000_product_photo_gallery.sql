BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Product photo gallery: up to 5 active photos per product, exactly one of them the main photo.
-- ADMIN and OWNER, own business only. Removing a photo is soft (is_active=false); its Storage object stays.
-- Uploads keep using the existing "product-images" INSERT policy (api.can_upload_product_image); no RLS or
-- Storage policy changes. The storefront catalogues already return every active photo, main first then
-- sort_order, so no reader changes are needed.

-- Backstop for every writer (these functions, set_product_photo, save_product_image, the legacy image_path sync).
-- Writers lock the product row first, so the count cannot race.
CREATE FUNCTION app.limit_product_photos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.is_active AND (TG_OP='INSERT' OR NOT OLD.is_active)
 AND (SELECT count(*) FROM app.product_images i WHERE i.product_id=NEW.product_id AND i.business_id=NEW.business_id AND i.is_active)>5 THEN
  RAISE EXCEPTION 'A product can have at most 5 photos' USING ERRCODE='22023';
 END IF;
 RETURN NULL;
END $fn$;
CREATE TRIGGER product_images_limit AFTER INSERT OR UPDATE OF is_active ON app.product_images
FOR EACH ROW EXECUTE FUNCTION app.limit_product_photos();

-- Every active photo of the caller's business, by product, in display order (main first).
CREATE FUNCTION api.product_photos() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 RETURN COALESCE((SELECT jsonb_object_agg(g.product_id,g.photos) FROM (
  SELECT i.product_id,jsonb_agg(jsonb_build_object('id',i.id,'assetPath',i.asset_path,'objectPath',i.storage_object_path,'alt',i.alt_text,'main',i.is_primary)
   ORDER BY i.is_primary DESC,i.sort_order,i.created_at,i.id) photos
  FROM app.product_images i WHERE i.business_id=actor.business_id AND i.is_active GROUP BY i.product_id) g),'{}'::jsonb);
END $fn$;

-- Adds an uploaded {business}/{product}/{sha256}.webp object to the end of the gallery.
-- It becomes the main photo when the product has none.
CREATE FUNCTION api.add_product_photo(product uuid,object_path text,alternate_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid; uploaded boolean; main boolean; next_order integer;
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
 IF EXISTS(SELECT 1 FROM app.product_images i WHERE i.product_id=product AND i.is_active AND i.storage_object_path=object_path) THEN
  RAISE EXCEPTION 'This photo is already in the gallery' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM app.product_images i WHERE i.product_id=product AND i.is_active)>=5 THEN
  RAISE EXCEPTION 'A product can have at most 5 photos' USING ERRCODE='22023'; END IF;
 SELECT NOT EXISTS(SELECT 1 FROM app.product_images i WHERE i.product_id=product AND i.is_active AND i.is_primary),
  COALESCE((SELECT max(i.sort_order)+1 FROM app.product_images i WHERE i.product_id=product AND i.is_active),0)
 INTO main,next_order;
 INSERT INTO app.product_images(business_id,product_id,asset_path,storage_bucket,storage_object_path,alt_text,is_primary,is_active,sort_order)
 VALUES(actor.business_id,product,NULL,'product-images',object_path,left(coalesce(alternate_text,''),240),main,true,next_order) RETURNING id INTO result;
 PERFORM app.core_audit(actor.business_id,NULL,actor.id,app.current_staff_role(),'PRODUCT_PHOTO_ADDED',product,
  jsonb_build_object('image',result,'path',object_path,'main',main));
 RETURN result;
END $fn$;

-- Sets the gallery order. photos must name every active photo exactly once; the first becomes the main photo.
CREATE FUNCTION api.arrange_product_photos(product uuid,photos uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; before jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 PERFORM 1 FROM app.products p WHERE p.id=product AND p.business_id=actor.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 -- A stale screen reloads instead of guessing.
 IF photos IS NULL OR cardinality(photos)=0 OR array_position(photos,NULL) IS NOT NULL
 OR (SELECT array_agg(x ORDER BY x) FROM unnest(photos) x)
  IS DISTINCT FROM (SELECT array_agg(i.id ORDER BY i.id) FROM app.product_images i WHERE i.product_id=product AND i.business_id=actor.business_id AND i.is_active)
 THEN RAISE EXCEPTION 'Photos changed; reload' USING ERRCODE='40001'; END IF;
 SELECT jsonb_agg(i.id ORDER BY i.is_primary DESC,i.sort_order,i.created_at,i.id) INTO before FROM app.product_images i WHERE i.product_id=product AND i.is_active;
 UPDATE app.product_images i SET is_primary=false WHERE i.product_id=product AND i.is_primary AND i.id<>photos[1];
 UPDATE app.product_images i SET sort_order=x.n::integer-1,is_primary=(x.n=1)
 FROM unnest(photos) WITH ORDINALITY AS x(id,n) WHERE i.id=x.id AND i.product_id=product;
 PERFORM app.core_audit(actor.business_id,NULL,actor.id,app.current_staff_role(),'PRODUCT_PHOTOS_ARRANGED',product,
  jsonb_build_object('from',before,'to',to_jsonb(photos)));
 RETURN photos[1];
END $fn$;

-- Soft-removes one photo. When it was the main photo, the next photo in order takes over.
CREATE FUNCTION api.remove_product_photo(product uuid,photo uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; target app.product_images; successor uuid;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 PERFORM 1 FROM app.products p WHERE p.id=product AND p.business_id=actor.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO target FROM app.product_images i WHERE i.id=photo AND i.product_id=product AND i.business_id=actor.business_id AND i.is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Photos changed; reload' USING ERRCODE='40001'; END IF;
 UPDATE app.product_images i SET is_active=false,is_primary=false WHERE i.id=photo;
 IF target.is_primary THEN
  SELECT i.id INTO successor FROM app.product_images i WHERE i.product_id=product AND i.is_active ORDER BY i.sort_order,i.created_at,i.id LIMIT 1;
  IF successor IS NOT NULL THEN UPDATE app.product_images i SET is_primary=true WHERE i.id=successor; END IF;
 END IF;
 PERFORM app.core_audit(actor.business_id,NULL,actor.id,app.current_staff_role(),'PRODUCT_PHOTO_REMOVED',product,
  jsonb_build_object('image',photo,'path',COALESCE(target.storage_object_path,target.asset_path),'wasMain',target.is_primary,'newMain',successor));
 RETURN photo;
END $fn$;

REVOKE ALL ON FUNCTION app.limit_product_photos() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION api.product_photos(),api.add_product_photo(uuid,text,text),api.arrange_product_photos(uuid,uuid[]),
 api.remove_product_photo(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION api.product_photos(),api.add_product_photo(uuid,text,text),api.arrange_product_photos(uuid,uuid[]),
 api.remove_product_photo(uuid,uuid) TO authenticated;
COMMIT;
