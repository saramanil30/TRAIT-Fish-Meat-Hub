BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Homepage redesign, ADMIN and OWNER only, own business/store only, every save audited:
--  1. Homepage text gains the hero's four trust labels and the footer banner title (same plain-text rules).
--  2. Instagram / Facebook links per store (https only, on that site's own domain); the header shows an icon only when set.
--  3. Today's Specials per store: up to 12 chosen products, each with an optional badge and an optional "Was ₹" price.
--  4. A photo per category for the "Shop by Category" circles, in the public "category-images" bucket.
-- New tables are closed to every API role (RLS enabled and forced, no grants); reads and writes go through the
-- SECURITY DEFINER functions below. Storage gets one new insert-only policy for its own new bucket. No existing
-- RLS, grant or Storage policy is changed.

-- 1. New homepage text keys. Existing rows stay valid: keys are only added.
CREATE OR REPLACE FUNCTION app.homepage_text_limits() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT '{"badge":40,"headline":60,"highlight":40,"subtitle":200,"button":30,
 "leftLabel":24,"leftTitle":50,"leftSubtitle":80,"rightLabel":24,"rightTitle":50,"rightSubtitle":80,
 "trust1":30,"trust2":30,"trust3":30,"trust4":30,"bannerTitle":60}'::jsonb
$fn$;

-- 2. Social links: https, the network's own domain, no credentials, spaces or angle brackets.
CREATE FUNCTION app.valid_social_url(value text,network text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT value IS NULL OR (length(value) BETWEEN 1 AND 300 AND value !~ '[[:space:][:cntrl:]<>"''\\]' AND CASE network
  WHEN 'instagram' THEN value ~* '^https://(www\.)?instagram\.com/[^@]*$'
  WHEN 'facebook' THEN value ~* '^https://((www|m|web)\.)?(facebook\.com|fb\.com)/[^@]*$'
  ELSE false END)
$fn$;

CREATE TABLE app.store_homepage_content(
 store_id uuid PRIMARY KEY, business_id uuid NOT NULL,
 instagram_url text CHECK(app.valid_social_url(instagram_url,'instagram')),
 facebook_url text CHECK(app.valid_social_url(facebook_url,'facebook')),
 -- Separate versions so the links and specials forms never block each other (0 = never saved).
 links_version integer NOT NULL DEFAULT 0 CHECK(links_version>=0),
 specials_version integer NOT NULL DEFAULT 0 CHECK(specials_version>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL,
 UNIQUE(business_id,store_id),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,updated_by) REFERENCES app.staff_profiles(business_id,id)
);
CREATE TABLE app.store_homepage_specials(
 store_id uuid NOT NULL, business_id uuid NOT NULL, product_id uuid NOT NULL,
 badge text CHECK(badge IN ('TODAY_SPECIAL','PREMIUM_QUALITY','LIMITED_STOCK')),
 was_price_paise bigint CHECK(was_price_paise BETWEEN 1 AND 100000000),
 sort_order integer NOT NULL CHECK(sort_order BETWEEN 0 AND 11),
 PRIMARY KEY(store_id,product_id), UNIQUE(store_id,sort_order),
 FOREIGN KEY(business_id,store_id) REFERENCES app.store_homepage_content(business_id,store_id),
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id)
);
CREATE TABLE app.category_photos(
 category_id uuid PRIMARY KEY, business_id uuid NOT NULL,
 object_path text CHECK(object_path IS NULL OR object_path ~ ('^'||business_id::text||'/'||category_id::text||'/[0-9a-f]{64}\.webp$')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL,
 FOREIGN KEY(business_id,category_id) REFERENCES app.categories(business_id,id),
 FOREIGN KEY(business_id,updated_by) REFERENCES app.staff_profiles(business_id,id)
);
ALTER TABLE app.store_homepage_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_homepage_content FORCE ROW LEVEL SECURITY;
ALTER TABLE app.store_homepage_specials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_homepage_specials FORCE ROW LEVEL SECURITY;
ALTER TABLE app.category_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.category_photos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.store_homepage_content,app.store_homepage_specials,app.category_photos
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;

-- Storefront: links, specials (in order) and category photos of the published store. Empty when the store or
-- business is inactive. Products are filtered again by the storefront catalogue, so only products on sale show.
CREATE FUNCTION api.homepage_content(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE((SELECT jsonb_strip_nulls(jsonb_build_object(
  'instagram',h.instagram_url,'facebook',h.facebook_url)) FROM app.store_homepage_content h WHERE h.store_id=s.id),'{}'::jsonb)
 || jsonb_build_object(
  'specials',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('productId',x.product_id,'badge',x.badge,'wasPaise',x.was_price_paise)) ORDER BY x.sort_order)
   FROM app.store_homepage_specials x JOIN app.products p ON p.id=x.product_id AND p.business_id=x.business_id
   WHERE x.store_id=s.id AND p.is_active),'[]'::jsonb),
  'categoryPhotos',COALESCE((SELECT jsonb_object_agg(c.id,f.object_path)
   FROM app.category_photos f JOIN app.categories c ON c.id=f.category_id AND c.business_id=f.business_id
   WHERE f.business_id=s.business_id AND c.is_active AND f.object_path IS NOT NULL),'{}'::jsonb))
 FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL
$fn$;

-- Settings: links and specials with their versions, plus every top-level category with its photo.
CREATE FUNCTION api.homepage_content_settings(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; h app.store_homepage_content;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM app.store_homepage_content x WHERE x.store_id=target_store AND x.business_id=actor.business_id;
 RETURN jsonb_build_object('instagram',h.instagram_url,'facebook',h.facebook_url,
  'linksVersion',COALESCE(h.links_version,0),'specialsVersion',COALESCE(h.specials_version,0),
  'specials',COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',x.product_id,'badge',x.badge,'wasPaise',x.was_price_paise) ORDER BY x.sort_order)
   FROM app.store_homepage_specials x WHERE x.store_id=target_store AND x.business_id=actor.business_id),'[]'::jsonb),
  'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.is_active,'photo',f.object_path,'version',COALESCE(f.version,0)) ORDER BY c.sort_order,c.name)
   FROM app.categories c LEFT JOIN app.category_photos f ON f.category_id=c.id AND f.business_id=c.business_id
   WHERE c.business_id=actor.business_id AND c.parent_id IS NULL),'[]'::jsonb));
END $fn$;

-- Creates the store's row on first use (versions 0) so both saves can compare versions the same way.
CREATE FUNCTION app.homepage_content_row(business uuid,target_store uuid,actor uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path='' AS $fn$
 INSERT INTO app.store_homepage_content(store_id,business_id,updated_by) VALUES(target_store,business,actor) ON CONFLICT(store_id) DO NOTHING
$fn$;

CREATE FUNCTION api.save_homepage_links(target_store uuid,expected_version integer,instagram text,facebook text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result integer; before app.store_homepage_content;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF NOT app.valid_social_url(instagram,'instagram') OR NOT app.valid_social_url(facebook,'facebook') THEN
  RAISE EXCEPTION 'Invalid social link' USING ERRCODE='22023'; END IF;
 PERFORM app.homepage_content_row(actor.business_id,target_store,actor.id);
 SELECT * INTO before FROM app.store_homepage_content h WHERE h.store_id=target_store AND h.business_id=actor.business_id FOR UPDATE;
 UPDATE app.store_homepage_content h SET instagram_url=instagram,facebook_url=facebook,links_version=h.links_version+1,updated_at=clock_timestamp(),updated_by=actor.id
 WHERE h.store_id=target_store AND h.business_id=actor.business_id AND h.links_version=COALESCE(expected_version,0) RETURNING h.links_version INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'Social links changed; reload' USING ERRCODE='40001'; END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'HOMEPAGE_LINKS_SAVED',target_store,
  jsonb_build_object('instagram',jsonb_build_object('from',before.instagram_url,'to',instagram),'facebook',jsonb_build_object('from',before.facebook_url,'to',facebook),'version',result));
 RETURN result;
END $fn$;

-- One specials entry; CASE keeps each check from running on a value of the wrong JSON type.
CREATE FUNCTION app.valid_homepage_special(e jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE WHEN jsonb_typeof(e)<>'object' THEN false
  WHEN EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('product','badge','wasPaise')) THEN false
  WHEN jsonb_typeof(e->'product') IS DISTINCT FROM 'string' OR (e->>'product') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
  WHEN COALESCE(jsonb_typeof(e->'badge'),'null')<>'null' AND (jsonb_typeof(e->'badge')<>'string' OR (e->>'badge') NOT IN ('TODAY_SPECIAL','PREMIUM_QUALITY','LIMITED_STOCK')) THEN false
  WHEN COALESCE(jsonb_typeof(e->'wasPaise'),'null')='null' THEN true
  WHEN jsonb_typeof(e->'wasPaise')<>'number' OR (e->>'wasPaise') !~ '^[0-9]{1,9}$' THEN false
  ELSE (e->>'wasPaise')::bigint BETWEEN 1 AND 100000000 END
$fn$;

-- specials: [{"product":uuid,"badge":null|"TODAY_SPECIAL"|"PREMIUM_QUALITY"|"LIMITED_STOCK","wasPaise":null|integer}], at most 12,
-- each an active product of the caller's business, listed once. The array order is the display order; it replaces the list.
CREATE FUNCTION api.save_homepage_specials(target_store uuid,expected_version integer,specials jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result integer; before jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF (CASE WHEN specials IS NULL OR jsonb_typeof(specials)<>'array' THEN true ELSE jsonb_array_length(specials)>12
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(specials) e WHERE NOT app.valid_homepage_special(e)) END)
 THEN RAISE EXCEPTION 'Invalid specials' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT e->>'product') FROM jsonb_array_elements(specials) e)<>jsonb_array_length(specials)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(specials) e WHERE NOT EXISTS(
  SELECT 1 FROM app.products p WHERE p.id=(e->>'product')::uuid AND p.business_id=actor.business_id AND p.is_active))
 THEN RAISE EXCEPTION 'Invalid specials' USING ERRCODE='22023'; END IF;
 PERFORM app.homepage_content_row(actor.business_id,target_store,actor.id);
 UPDATE app.store_homepage_content h SET specials_version=h.specials_version+1,updated_at=clock_timestamp(),updated_by=actor.id
 WHERE h.store_id=target_store AND h.business_id=actor.business_id AND h.specials_version=COALESCE(expected_version,0) RETURNING h.specials_version INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'Specials changed; reload' USING ERRCODE='40001'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('product',x.product_id,'badge',x.badge,'wasPaise',x.was_price_paise) ORDER BY x.sort_order),'[]'::jsonb) INTO before
 FROM app.store_homepage_specials x WHERE x.store_id=target_store;
 -- The list is replaced as a whole; the previous list is kept in the audit entry.
 DELETE FROM app.store_homepage_specials x WHERE x.store_id=target_store AND x.business_id=actor.business_id;
 INSERT INTO app.store_homepage_specials(store_id,business_id,product_id,badge,was_price_paise,sort_order)
 SELECT target_store,actor.business_id,(e->>'product')::uuid,e->>'badge',(e->>'wasPaise')::bigint,(n-1)::integer
 FROM jsonb_array_elements(specials) WITH ORDINALITY AS t(e,n);
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'HOMEPAGE_SPECIALS_SAVED',target_store,
  jsonb_build_object('from',before,'to',specials,'version',result));
 RETURN result;
END $fn$;

-- Sets (or, with NULL, clears) a category's photo: an uploaded {business}/{category}/{sha256}.webp under the caller's business.
CREATE FUNCTION api.save_category_photo(category uuid,expected_version integer,object_path text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result integer; previous text; uploaded boolean;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 PERFORM 1 FROM app.categories c WHERE c.id=category AND c.business_id=actor.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF object_path IS NOT NULL THEN
  IF object_path !~ ('^'||actor.business_id::text||'/'||category::text||'/[0-9a-f]{64}\.webp$') THEN RAISE EXCEPTION 'Invalid category photo' USING ERRCODE='22023'; END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=''category-images'' AND name=$1)' INTO uploaded USING object_path;
   IF NOT uploaded THEN RAISE EXCEPTION 'Invalid category photo' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 SELECT f.object_path INTO previous FROM app.category_photos f WHERE f.category_id=category;
 IF COALESCE(expected_version,0)=0 THEN
  INSERT INTO app.category_photos(category_id,business_id,object_path,updated_by) VALUES(category,actor.business_id,object_path,actor.id)
  ON CONFLICT(category_id) DO NOTHING RETURNING version INTO result;
 ELSE
  UPDATE app.category_photos f SET object_path=save_category_photo.object_path,version=f.version+1,updated_at=clock_timestamp(),updated_by=actor.id
  WHERE f.category_id=category AND f.business_id=actor.business_id AND f.version=expected_version RETURNING f.version INTO result;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Category photo changed; reload' USING ERRCODE='40001'; END IF;
 PERFORM app.core_audit(actor.business_id,NULL,actor.id,app.current_staff_role(),'CATEGORY_PHOTO_SAVED',category,
  jsonb_build_object('from',previous,'to',object_path,'version',result));
 RETURN result;
END $fn$;

-- Storage upload check for the "category-images" INSERT policy: ADMIN or OWNER, own business, existing category.
CREATE FUNCTION api.can_upload_category_image(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'
 AND app.current_staff_role() IN ('ADMIN','OWNER')
 AND EXISTS(SELECT 1 FROM app.categories c JOIN app.staff_profiles sp ON sp.business_id=c.business_id
  WHERE sp.id=app.current_staff_profile_id()
  AND c.business_id::text=split_part(object_name,'/',1) AND c.id::text=split_part(object_name,'/',2))
$fn$;

REVOKE ALL ON FUNCTION app.valid_social_url(text,text),app.valid_homepage_special(jsonb),app.homepage_content_row(uuid,uuid,uuid),api.homepage_content(uuid),
 api.homepage_content_settings(uuid),api.save_homepage_links(uuid,integer,text,text),api.save_homepage_specials(uuid,integer,jsonb),
 api.save_category_photo(uuid,integer,text),api.can_upload_category_image(text)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.homepage_content(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION api.homepage_content_settings(uuid),api.save_homepage_links(uuid,integer,text,text),api.save_homepage_specials(uuid,integer,jsonb),
 api.save_category_photo(uuid,integer,text),api.can_upload_category_image(text) TO authenticated;
COMMENT ON FUNCTION api.homepage_content(uuid) IS 'Published store social links, homepage specials and category photo paths only; no staff data.';

-- Storage exists only on Supabase (not in the local PGlite test database). Public bucket; insert only, no update/delete.
DO $do$
BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('category-images','category-images',true,1048576,ARRAY['image/webp']) ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ADMIN and OWNER upload category images') THEN
   CREATE POLICY "ADMIN and OWNER upload category images" ON storage.objects FOR INSERT TO authenticated
   WITH CHECK (bucket_id='category-images' AND api.can_upload_category_image(name));
  END IF;
 END IF;
END $do$;
NOTIFY pgrst,'reload schema';
COMMIT;
