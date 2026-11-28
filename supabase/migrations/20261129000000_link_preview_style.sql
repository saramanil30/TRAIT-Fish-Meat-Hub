-- Link preview style: "COMPACT" (square image, the default) or "LARGE" (the 1200x630 banner, as before).
-- The compact image is a square JPEG (400-1200 px, <= 300 KB, checked by the app before upload) in the same public
-- share-images bucket at {business}/{sha256}.jpg; by default the form makes it from the square header icon.
-- Both images are kept, so switching style never loses the other one. Existing saved previews that already have a
-- banner stay LARGE, so a live preview does not change until the owner picks Compact. No grant or RLS change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
BEGIN
 IF to_regprocedure('api.save_link_preview(uuid,integer,text,text,text)') IS NULL
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='store_link_preview' AND column_name='style')
 THEN RAISE EXCEPTION 'Unexpected state for the link preview style migration'; END IF;
END $preflight$;

ALTER TABLE app.store_link_preview
 ADD COLUMN style text NOT NULL DEFAULT 'COMPACT' CHECK(style IN ('COMPACT','LARGE')),
 ADD COLUMN square_image_path text CHECK(square_image_path IS NULL OR square_image_path ~ ('^'||business_id::text||'/[0-9a-f]{64}\.jpg$')),
 ADD COLUMN square_image_size integer,
 ADD CONSTRAINT store_link_preview_square_pair CHECK((square_image_path IS NULL AND square_image_size IS NULL)
  OR (square_image_path IS NOT NULL AND square_image_size BETWEEN 400 AND 1200));
UPDATE app.store_link_preview SET style='LARGE' WHERE image_path IS NOT NULL;

-- Same as 20261009020000_link_preview.sql, plus style and the square image.
CREATE OR REPLACE FUNCTION api.link_preview(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE((SELECT jsonb_strip_nulls(jsonb_build_object('title',p.title,'description',p.description,'imagePath',p.image_path,'version',p.version,
  'style',p.style,'squareImagePath',p.square_image_path,'squareImageSize',p.square_image_size))
 FROM app.store_link_preview p JOIN app.stores s ON s.id=p.store_id JOIN app.businesses b ON b.id=s.business_id
 WHERE p.store_id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL),'{}'::jsonb)
$fn$;
CREATE OR REPLACE FUNCTION api.link_preview_settings(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('title',p.title,'description',p.description,'imagePath',p.image_path,'version',p.version,
  'style',p.style,'squareImagePath',p.square_image_path,'squareImageSize',p.square_image_size) INTO result
 FROM app.store_link_preview p WHERE p.store_id=target_store AND p.business_id=actor.business_id;
 RETURN COALESCE(result,jsonb_build_object('version',0,'style','COMPACT'));
END $fn$;

-- An uploaded share image of the caller's business (the storage check runs only where Supabase storage exists).
CREATE FUNCTION app.valid_share_object(business uuid,object_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE found boolean:=true;
BEGIN
 IF object_name IS NULL OR object_name !~ ('^'||business::text||'/[0-9a-f]{64}\.jpg$') THEN RETURN false; END IF;
 IF to_regclass('storage.objects') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=''share-images'' AND name=$1)' INTO found USING object_name;
 END IF;
 RETURN found;
END $fn$;

-- Same as 20261009020000_link_preview.sql, plus style and the square image (with its side in pixels).
DROP FUNCTION api.save_link_preview(uuid,integer,text,text,text);
CREATE FUNCTION api.save_link_preview(target_store uuid,expected_version integer,share_title text,share_description text,image text,
 preview_style text DEFAULT 'COMPACT',square_image text DEFAULT NULL,square_size integer DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF NOT app.valid_plain_text(share_title,70) OR NOT app.valid_plain_text(share_description,200)
 OR preview_style IS NULL OR preview_style NOT IN ('COMPACT','LARGE') THEN RAISE EXCEPTION 'Invalid link preview' USING ERRCODE='22023'; END IF;
 IF image IS NOT NULL AND NOT app.valid_share_object(actor.business_id,image) THEN RAISE EXCEPTION 'Invalid share image' USING ERRCODE='22023'; END IF;
 IF (square_image IS NULL)<>(square_size IS NULL) OR square_size NOT BETWEEN 400 AND 1200
 OR (square_image IS NOT NULL AND NOT app.valid_share_object(actor.business_id,square_image)) THEN RAISE EXCEPTION 'Invalid share image' USING ERRCODE='22023'; END IF;
 IF expected_version IS NULL OR expected_version=0 THEN
  INSERT INTO app.store_link_preview(store_id,business_id,title,description,image_path,style,square_image_path,square_image_size,updated_by)
  VALUES(target_store,actor.business_id,share_title,share_description,image,preview_style,square_image,square_size,actor.id) ON CONFLICT(store_id) DO NOTHING RETURNING version INTO result;
 ELSE
  UPDATE app.store_link_preview p SET title=share_title,description=share_description,image_path=image,style=preview_style,
   square_image_path=square_image,square_image_size=square_size,version=p.version+1,updated_at=clock_timestamp(),updated_by=actor.id
  WHERE p.store_id=target_store AND p.business_id=actor.business_id AND p.version=expected_version RETURNING p.version INTO result;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Link preview changed; reload' USING ERRCODE='40001'; END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'LINK_PREVIEW_SAVED',target_store,
  jsonb_build_object('title',share_title IS NOT NULL,'description',share_description IS NOT NULL,'image',image IS NOT NULL,
  'style',preview_style,'squareImage',square_image IS NOT NULL,'version',result));
 RETURN result;
END $fn$;

REVOKE ALL ON FUNCTION app.valid_share_object(uuid,text),api.save_link_preview(uuid,integer,text,text,text,text,text,integer)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.save_link_preview(uuid,integer,text,text,text,text,text,integer) TO authenticated;

DO $security$
BEGIN
 IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='app.store_link_preview'::regclass)
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','trait_checkout')
  AND (has_table_privilege(r.oid,'app.store_link_preview','SELECT,INSERT,UPDATE,DELETE') OR has_any_column_privilege(r.oid,'app.store_link_preview','SELECT,INSERT,UPDATE')))
 OR has_function_privilege('anon','api.save_link_preview(uuid,integer,text,text,text,text,text,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Unsafe link preview state'; END IF;
END $security$;
NOTIFY pgrst,'reload schema';
COMMIT;
