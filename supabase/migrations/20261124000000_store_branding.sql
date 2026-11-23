BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Header logos per store (ADMIN and OWNER, own business, a store they can access, audited):
--  * desktop logo: wide PNG/WebP (at least 1.5x as wide as tall, 40-600 px tall, at most 2400 px wide, <= 512 KB);
--  * mobile logo: square PNG/WebP (192-1024 px, <= 512 KB), with a 32x32 favicon and a 180x180 home-screen icon
--    (PNG, generated from it in the browser; all three are saved or cleared together).
-- Files sit in the public "brand-images" bucket at {business}/{store}/{sha256}.png|webp. The app reads sizes from the
-- file headers before upload; this migration checks paths, the stored object's type and byte size, and the sizes again.
-- Missing logos fall back to the built-in logo. The new table is closed to every API role (RLS enabled and forced,
-- no grants); access is through the SECURITY DEFINER functions below. Storage gets one insert-only policy for its own
-- new bucket. No existing RLS policy, table grant or Storage policy is changed.
CREATE TABLE app.store_branding(
 store_id uuid PRIMARY KEY, business_id uuid NOT NULL,
 desktop_logo_path text, desktop_logo_width integer, desktop_logo_height integer,
 mobile_logo_path text, mobile_logo_size integer, favicon_path text, touch_icon_path text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL,
 CHECK(desktop_logo_path IS NULL OR desktop_logo_path ~ ('^'||business_id::text||'/'||store_id::text||'/[0-9a-f]{64}\.(png|webp)$')),
 CHECK(mobile_logo_path IS NULL OR mobile_logo_path ~ ('^'||business_id::text||'/'||store_id::text||'/[0-9a-f]{64}\.(png|webp)$')),
 CHECK(favicon_path IS NULL OR favicon_path ~ ('^'||business_id::text||'/'||store_id::text||'/[0-9a-f]{64}\.png$')),
 CHECK(touch_icon_path IS NULL OR touch_icon_path ~ ('^'||business_id::text||'/'||store_id::text||'/[0-9a-f]{64}\.png$')),
 CHECK((desktop_logo_path IS NULL AND desktop_logo_width IS NULL AND desktop_logo_height IS NULL)
  OR (desktop_logo_path IS NOT NULL AND desktop_logo_height BETWEEN 40 AND 600 AND desktop_logo_width BETWEEN 60 AND 2400
      AND desktop_logo_width*2>=desktop_logo_height*3)),
 CHECK((mobile_logo_path IS NULL AND mobile_logo_size IS NULL AND favicon_path IS NULL AND touch_icon_path IS NULL)
  OR (mobile_logo_path IS NOT NULL AND mobile_logo_size BETWEEN 192 AND 1024 AND favicon_path IS NOT NULL AND touch_icon_path IS NOT NULL)),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,updated_by) REFERENCES app.staff_profiles(business_id,id)
);
ALTER TABLE app.store_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_branding FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.store_branding FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;

-- Storefront header and favicon: the published store's logo paths only ({} = built-in logo).
CREATE FUNCTION api.store_branding(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE((SELECT jsonb_strip_nulls(jsonb_build_object(
  'desktopLogo',CASE WHEN p.desktop_logo_path IS NOT NULL THEN jsonb_build_object('path',p.desktop_logo_path,'width',p.desktop_logo_width,'height',p.desktop_logo_height) END,
  'mobileLogo',p.mobile_logo_path,'favicon',p.favicon_path,'touchIcon',p.touch_icon_path,'version',p.version))
 FROM app.store_branding p JOIN app.stores s ON s.id=p.store_id JOIN app.businesses b ON b.id=s.business_id
 WHERE p.store_id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL),'{}'::jsonb)
$fn$;
CREATE FUNCTION api.store_branding_settings(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('desktopLogo',p.desktop_logo_path,'desktopWidth',p.desktop_logo_width,'desktopHeight',p.desktop_logo_height,
  'mobileLogo',p.mobile_logo_path,'mobileSize',p.mobile_logo_size,'favicon',p.favicon_path,'touchIcon',p.touch_icon_path,'version',p.version) INTO result
 FROM app.store_branding p WHERE p.store_id=target_store AND p.business_id=actor.business_id;
 RETURN COALESCE(result,jsonb_build_object('version',0));
END $fn$;
-- A brand file the caller may reference: under their business and this store, already uploaded, of the expected type
-- (from the extension) and at most max_bytes. Storage exists only on Supabase; the local test database checks paths only.
CREATE FUNCTION app.valid_brand_object(actor_business uuid,target_store uuid,object_path text,png_only boolean,max_bytes bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE stored_size bigint; stored_type text;
BEGIN
 IF object_path IS NULL OR object_path !~ ('^'||actor_business::text||'/'||target_store::text||'/[0-9a-f]{64}\.'||CASE WHEN png_only THEN 'png' ELSE '(png|webp)' END||'$') THEN RETURN false; END IF;
 IF to_regclass('storage.objects') IS NULL THEN RETURN true; END IF;
 EXECUTE 'SELECT (metadata->>''size'')::bigint,metadata->>''mimetype'' FROM storage.objects WHERE bucket_id=''brand-images'' AND name=$1'
  INTO stored_size,stored_type USING object_path;
 RETURN stored_size BETWEEN 1 AND max_bytes AND stored_type IS NOT DISTINCT FROM ('image/'||CASE WHEN object_path LIKE '%.png' THEN 'png' ELSE 'webp' END);
END $fn$;
CREATE FUNCTION api.save_store_branding(target_store uuid,expected_version integer,desktop_logo text,desktop_width integer,desktop_height integer,
 mobile_logo text,mobile_size integer,favicon text,touch_icon text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF desktop_logo IS NOT NULL AND (NOT app.valid_brand_object(actor.business_id,target_store,desktop_logo,false,524288)
   OR desktop_height IS NULL OR desktop_height NOT BETWEEN 40 AND 600 OR desktop_width IS NULL OR desktop_width NOT BETWEEN 60 AND 2400
   OR desktop_width*2<desktop_height*3) THEN RAISE EXCEPTION 'Invalid desktop logo' USING ERRCODE='22023'; END IF;
 IF desktop_logo IS NULL AND (desktop_width IS NOT NULL OR desktop_height IS NOT NULL) THEN RAISE EXCEPTION 'Invalid desktop logo' USING ERRCODE='22023'; END IF;
 IF mobile_logo IS NOT NULL AND (NOT app.valid_brand_object(actor.business_id,target_store,mobile_logo,false,524288)
   OR mobile_size IS NULL OR mobile_size NOT BETWEEN 192 AND 1024
   OR NOT app.valid_brand_object(actor.business_id,target_store,favicon,true,32768)
   OR NOT app.valid_brand_object(actor.business_id,target_store,touch_icon,true,131072)) THEN RAISE EXCEPTION 'Invalid mobile logo' USING ERRCODE='22023'; END IF;
 IF mobile_logo IS NULL AND (mobile_size IS NOT NULL OR favicon IS NOT NULL OR touch_icon IS NOT NULL) THEN RAISE EXCEPTION 'Invalid mobile logo' USING ERRCODE='22023'; END IF;
 IF expected_version IS NULL OR expected_version=0 THEN
  INSERT INTO app.store_branding(store_id,business_id,desktop_logo_path,desktop_logo_width,desktop_logo_height,mobile_logo_path,mobile_logo_size,favicon_path,touch_icon_path,updated_by)
  VALUES(target_store,actor.business_id,desktop_logo,desktop_width,desktop_height,mobile_logo,mobile_size,favicon,touch_icon,actor.id)
  ON CONFLICT(store_id) DO NOTHING RETURNING version INTO result;
 ELSE
  UPDATE app.store_branding p SET desktop_logo_path=desktop_logo,desktop_logo_width=desktop_width,desktop_logo_height=desktop_height,
   mobile_logo_path=mobile_logo,mobile_logo_size=mobile_size,favicon_path=favicon,touch_icon_path=touch_icon,
   version=p.version+1,updated_at=clock_timestamp(),updated_by=actor.id
  WHERE p.store_id=target_store AND p.business_id=actor.business_id AND p.version=expected_version RETURNING p.version INTO result;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Branding changed; reload' USING ERRCODE='40001'; END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'STORE_BRANDING_SAVED',target_store,
  jsonb_build_object('desktopLogo',desktop_logo,'mobileLogo',mobile_logo,'favicon',favicon,'touchIcon',touch_icon,'version',result));
 RETURN result;
END $fn$;
-- Storage upload check for the "brand-images" INSERT policy: ADMIN or OWNER, own business, a store they can access.
CREATE FUNCTION api.can_upload_brand_image(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.(png|webp)$'
 AND app.current_staff_role() IN ('ADMIN','OWNER')
 AND EXISTS(SELECT 1 FROM app.stores s JOIN app.staff_profiles sp ON sp.business_id=s.business_id
  WHERE sp.id=app.current_staff_profile_id() AND s.deleted_at IS NULL
  AND s.business_id::text=split_part(object_name,'/',1) AND s.id::text=split_part(object_name,'/',2)
  AND app.can_access_store(s.business_id,s.id))
$fn$;
REVOKE ALL ON FUNCTION api.store_branding(uuid),api.store_branding_settings(uuid),app.valid_brand_object(uuid,uuid,text,boolean,bigint),
 api.save_store_branding(uuid,integer,text,integer,integer,text,integer,text,text),api.can_upload_brand_image(text)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.store_branding(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION api.store_branding_settings(uuid),api.save_store_branding(uuid,integer,text,integer,integer,text,integer,text,text),
 api.can_upload_brand_image(text) TO authenticated;
COMMENT ON FUNCTION api.store_branding(uuid) IS 'Published store header logo and favicon paths only; no staff data.';

-- Storage exists only on Supabase (not in the local PGlite test database). Public bucket; insert only, no update/delete.
DO $do$
BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('brand-images','brand-images',true,524288,ARRAY['image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ADMIN and OWNER upload brand images') THEN
   CREATE POLICY "ADMIN and OWNER upload brand images" ON storage.objects FOR INSERT TO authenticated
   WITH CHECK (bucket_id='brand-images' AND api.can_upload_brand_image(name));
  END IF;
 END IF;
END $do$;
NOTIFY pgrst,'reload schema';
COMMIT;
