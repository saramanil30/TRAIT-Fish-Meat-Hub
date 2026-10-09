BEGIN;
-- Homepage hero text and the link preview (Open Graph / Twitter card) that ADMIN and OWNER edit in Settings.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Editable homepage hero text, one row per store. Plain text only: each field is optional (missing = the storefront's
-- built-in text), trimmed, 1..limit characters, with no control characters and no angle brackets.
-- Written only through api.save_homepage_text (ADMIN/OWNER, audited); the table itself stays closed to every API role.
CREATE FUNCTION app.homepage_text_limits() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT '{"badge":40,"headline":60,"highlight":40,"subtitle":200,"button":30,
 "leftLabel":24,"leftTitle":50,"leftSubtitle":80,"rightLabel":24,"rightTitle":50,"rightSubtitle":80}'::jsonb
$fn$;
CREATE FUNCTION app.valid_homepage_text(content jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT jsonb_typeof(content)='object' AND NOT EXISTS(SELECT 1 FROM jsonb_each(content) e WHERE
  NOT (app.homepage_text_limits() ? e.key) OR jsonb_typeof(e.value)<>'string'
  OR length(e.value#>>'{}') NOT BETWEEN 1 AND (app.homepage_text_limits()->>e.key)::integer
  OR (e.value#>>'{}')<>btrim(e.value#>>'{}') OR (e.value#>>'{}') ~ '[[:cntrl:]<>]')
$fn$;
CREATE TABLE app.store_homepage_text(
 store_id uuid PRIMARY KEY, business_id uuid NOT NULL,
 content jsonb NOT NULL DEFAULT '{}' CHECK(app.valid_homepage_text(content)),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL,
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,updated_by) REFERENCES app.staff_profiles(business_id,id)
);
ALTER TABLE app.store_homepage_text ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_homepage_text FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.store_homepage_text FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;

-- Storefront: the published store's custom text, or {} (use built-in text).
CREATE FUNCTION api.homepage_text(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE((SELECT h.content FROM app.store_homepage_text h JOIN app.stores s ON s.id=h.store_id JOIN app.businesses b ON b.id=s.business_id
 WHERE h.store_id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL),'{}'::jsonb)
$fn$;

-- Settings form: current text and version (0 = never saved).
CREATE FUNCTION api.homepage_text_settings(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('content',h.content,'version',h.version) INTO result
 FROM app.store_homepage_text h WHERE h.store_id=target_store AND h.business_id=actor.business_id;
 RETURN COALESCE(result,jsonb_build_object('content','{}'::jsonb,'version',0));
END $fn$;

CREATE FUNCTION api.save_homepage_text(target_store uuid,expected_version integer,content jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF content IS NULL OR NOT app.valid_homepage_text(content) THEN RAISE EXCEPTION 'Invalid homepage text' USING ERRCODE='22023'; END IF;
 IF expected_version IS NULL OR expected_version=0 THEN
  INSERT INTO app.store_homepage_text(store_id,business_id,content,updated_by) VALUES(target_store,actor.business_id,content,actor.id)
  ON CONFLICT(store_id) DO NOTHING RETURNING version INTO result;
 ELSE
  UPDATE app.store_homepage_text h SET content=save_homepage_text.content,version=h.version+1,updated_at=clock_timestamp(),updated_by=actor.id
  WHERE h.store_id=target_store AND h.business_id=actor.business_id AND h.version=expected_version RETURNING h.version INTO result;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Homepage text changed; reload' USING ERRCODE='40001'; END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'HOMEPAGE_TEXT_SAVED',target_store,
  jsonb_build_object('fields',(SELECT COALESCE(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM jsonb_object_keys(content) k),'version',result));
 RETURN result;
END $fn$;

REVOKE ALL ON FUNCTION app.homepage_text_limits(),app.valid_homepage_text(jsonb),api.homepage_text(uuid),api.homepage_text_settings(uuid),
 api.save_homepage_text(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.homepage_text(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION api.homepage_text_settings(uuid),api.save_homepage_text(uuid,integer,jsonb) TO authenticated;
COMMENT ON FUNCTION api.homepage_text(uuid) IS 'Published store homepage hero text overrides only; no staff data.';

-- Link preview for shared links: title, description and a 1200x630 JPEG (<=300 KB, checked by the app before upload)
-- in the public share-images bucket at {business}/{sha256}.jpg. Missing values use the site's built-in preview.
CREATE FUNCTION app.valid_plain_text(value text,max_length integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT value IS NULL OR (length(value) BETWEEN 1 AND max_length AND value=btrim(value) AND value !~ '[[:cntrl:]<>]')
$fn$;
CREATE TABLE app.store_link_preview(
 store_id uuid PRIMARY KEY, business_id uuid NOT NULL,
 title text CHECK(app.valid_plain_text(title,70)), description text CHECK(app.valid_plain_text(description,200)),
 image_path text CHECK(image_path IS NULL OR image_path ~ ('^'||business_id::text||'/[0-9a-f]{64}\.jpg$')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL,
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,updated_by) REFERENCES app.staff_profiles(business_id,id)
);
ALTER TABLE app.store_link_preview ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_link_preview FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.store_link_preview FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;

-- Storefront metadata: the published store's preview ({} = built-in). version lets the image URL change on every save.
CREATE FUNCTION api.link_preview(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE((SELECT jsonb_strip_nulls(jsonb_build_object('title',p.title,'description',p.description,'imagePath',p.image_path,'version',p.version))
 FROM app.store_link_preview p JOIN app.stores s ON s.id=p.store_id JOIN app.businesses b ON b.id=s.business_id
 WHERE p.store_id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL),'{}'::jsonb)
$fn$;
CREATE FUNCTION api.link_preview_settings(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('title',p.title,'description',p.description,'imagePath',p.image_path,'version',p.version) INTO result
 FROM app.store_link_preview p WHERE p.store_id=target_store AND p.business_id=actor.business_id;
 RETURN COALESCE(result,jsonb_build_object('version',0));
END $fn$;
CREATE FUNCTION api.save_link_preview(target_store uuid,expected_version integer,share_title text,share_description text,image text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result integer; found boolean;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF NOT app.valid_plain_text(share_title,70) OR NOT app.valid_plain_text(share_description,200) THEN RAISE EXCEPTION 'Invalid link preview' USING ERRCODE='22023'; END IF;
 -- The image must sit under the caller's own business and already be uploaded.
 IF image IS NOT NULL THEN
  IF image !~ ('^'||actor.business_id::text||'/[0-9a-f]{64}\.jpg$') THEN RAISE EXCEPTION 'Invalid share image' USING ERRCODE='22023'; END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=''share-images'' AND name=$1)' INTO found USING image;
   IF NOT found THEN RAISE EXCEPTION 'Invalid share image' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 IF expected_version IS NULL OR expected_version=0 THEN
  INSERT INTO app.store_link_preview(store_id,business_id,title,description,image_path,updated_by)
  VALUES(target_store,actor.business_id,share_title,share_description,image,actor.id) ON CONFLICT(store_id) DO NOTHING RETURNING version INTO result;
 ELSE
  UPDATE app.store_link_preview p SET title=share_title,description=share_description,image_path=image,version=p.version+1,updated_at=clock_timestamp(),updated_by=actor.id
  WHERE p.store_id=target_store AND p.business_id=actor.business_id AND p.version=expected_version RETURNING p.version INTO result;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Link preview changed; reload' USING ERRCODE='40001'; END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'LINK_PREVIEW_SAVED',target_store,
  jsonb_build_object('title',share_title IS NOT NULL,'description',share_description IS NOT NULL,'image',image IS NOT NULL,'version',result));
 RETURN result;
END $fn$;
-- Share image uploads: an active ADMIN or OWNER, only under their own business folder (yes/no for the caller only).
CREATE FUNCTION api.can_upload_share_image(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT object_name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.jpg$'
 AND app.current_staff_role() IN ('ADMIN','OWNER')
 AND EXISTS(SELECT 1 FROM app.staff_profiles sp WHERE sp.id=app.current_staff_profile_id() AND sp.business_id::text=split_part(object_name,'/',1))
$fn$;
REVOKE ALL ON FUNCTION app.valid_plain_text(text,integer),api.link_preview(uuid),api.link_preview_settings(uuid),
 api.save_link_preview(uuid,integer,text,text,text),api.can_upload_share_image(text) FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.link_preview(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION api.link_preview_settings(uuid),api.save_link_preview(uuid,integer,text,text,text),api.can_upload_share_image(text) TO authenticated;
COMMENT ON FUNCTION api.link_preview(uuid) IS 'Published store link preview title, description and image path only; no staff data.';
-- Storage exists only on Supabase (not in the local PGlite test database). Public bucket for crawlers; insert only, no update/delete.
DO $do$
BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('share-images','share-images',true,307200,ARRAY['image/jpeg']) ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ADMIN and OWNER upload share images') THEN
   CREATE POLICY "ADMIN and OWNER upload share images" ON storage.objects FOR INSERT TO authenticated
   WITH CHECK (bucket_id='share-images' AND api.can_upload_share_image(name));
  END IF;
 END IF;
END $do$;
NOTIFY pgrst,'reload schema';
COMMIT;
