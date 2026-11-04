BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- 1. OWNER may change a product's weight options (allowed raw weights, or sale quantities for NET / tray / unit
--    products) and publish / unpublish it with its catalogue reference price. Own business only, audited.
--    Pricing basis, unit grams, pack size, preparations (cuts), category, name, status, create and retire stay
--    ADMIN-only: save_product, configure_product_pricing, save_category and catalogue_master are unchanged.
-- 2. Homepage hero slides per store (ADMIN and OWNER): up to 5 WebP photos, at least 1600 px wide and at most 1 MB,
--    in the public "hero-images" bucket. Reorder; remove is soft (the row and the Storage object stay). Audited.
-- New table is closed to every API role (RLS enabled and forced, no grants); access goes through the SECURITY
-- DEFINER functions below. Storage gets one new insert-only policy for its own new bucket. No existing RLS policy,
-- table grant or Storage policy is changed.

-- 1a. Product list for the OWNER catalogue page gains the sale fields (existing keys unchanged).
CREATE OR REPLACE FUNCTION api.product_content() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'local_name',p.local_name,'description',p.description,'image_path',p.image_path,'is_active',p.is_active,
  'category',(SELECT c.name FROM app.categories c WHERE c.id=p.category_id),
  'photo',(SELECT i.storage_object_path FROM app.product_images i WHERE i.product_id=p.id AND i.is_primary AND i.is_active AND i.storage_bucket='product-images' ORDER BY i.sort_order,i.id LIMIT 1),
  'pricing_basis',p.pricing_basis,'price_unit_grams',p.price_unit_grams,'units_per_pack',p.units_per_pack,
  'quantities',CASE WHEN p.pricing_basis='RAW_WEIGHT' THEN p.allowed_weights ELSE p.sale_quantities END,
  'catalogue_price_paise',p.catalogue_price_paise,'catalogue_published',p.catalogue_published)
  ORDER BY p.sort_order,p.name) FROM app.products p WHERE p.business_id=actor.business_id),'[]'::jsonb);
END $fn$;

-- 1b. quantities: the product's choices in its existing unit (raw grams, NET grams, trays or items), 1–50 unique whole
--     numbers 1..100000. Publishing needs a reference price and, like ADMIN publishing, gives each accessible store
--     without an offering one at that price (available). Existing offerings and their prices are never touched.
CREATE FUNCTION api.save_product_sale_options(product uuid,quantities jsonb,reference_price bigint,published boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; before app.products; after app.products; shop uuid; offering uuid; created jsonb:='[]';
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 SELECT * INTO before FROM app.products p WHERE p.id=product AND p.business_id=actor.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF published IS NULL OR NOT app.valid_product_configuration(quantities,before.preparations)
 OR (reference_price IS NOT NULL AND reference_price NOT BETWEEN 1 AND 100000000) OR (published AND reference_price IS NULL)
 THEN RAISE EXCEPTION 'Invalid sale options' USING ERRCODE='22023'; END IF;
 UPDATE app.products p SET
  allowed_weights=CASE WHEN p.pricing_basis='RAW_WEIGHT' THEN quantities ELSE '[]'::jsonb END,
  sale_quantities=CASE WHEN p.pricing_basis='RAW_WEIGHT' THEN '[]'::jsonb ELSE quantities END,
  catalogue_price_paise=reference_price,catalogue_published=published
 WHERE p.id=product RETURNING * INTO after;
 IF published THEN
  FOR shop IN SELECT s.id FROM app.stores s WHERE s.business_id=actor.business_id AND s.is_active AND s.deleted_at IS NULL
   AND app.can_access_store(actor.business_id,s.id) ORDER BY s.created_at,s.id LOOP
   offering:=NULL;
   INSERT INTO app.product_store_settings(business_id,store_id,product_id,available) VALUES(actor.business_id,shop,product,true)
   ON CONFLICT(business_id,store_id,product_id) DO NOTHING RETURNING id INTO offering;
   IF offering IS NOT NULL THEN
    INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by,pricing_basis,unit_price_paise,price_unit_grams,units_per_pack)
    VALUES(actor.business_id,offering,CASE WHEN after.pricing_basis='RAW_WEIGHT' THEN reference_price END,1,actor.id,after.pricing_basis,
     CASE WHEN after.pricing_basis<>'RAW_WEIGHT' THEN reference_price END,after.price_unit_grams,after.units_per_pack);
    created:=created||jsonb_build_array(jsonb_build_object('store',shop,'offering',offering));
   END IF;
  END LOOP;
 END IF;
 PERFORM app.core_audit(actor.business_id,NULL,actor.id,app.current_staff_role(),'PRODUCT_SALE_OPTIONS_SAVED',product,jsonb_build_object(
  'basis',before.pricing_basis,
  'quantities',jsonb_build_object('from',CASE WHEN before.pricing_basis='RAW_WEIGHT' THEN before.allowed_weights ELSE before.sale_quantities END,'to',quantities),
  'referencePricePaise',jsonb_build_object('from',before.catalogue_price_paise,'to',reference_price),
  'published',jsonb_build_object('from',before.catalogue_published,'to',published),
  'offeringsCreated',created));
 RETURN product;
END $fn$;

-- 2. Hero slides.
CREATE TABLE app.store_hero_slides(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL, store_id uuid NOT NULL,
 object_path text NOT NULL CHECK(object_path ~ ('^'||business_id::text||'/'||store_id::text||'/[0-9a-f]{64}\.webp$')),
 width_px integer NOT NULL CHECK(width_px BETWEEN 1600 AND 16383),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 1048576),
 alt_text text NOT NULL DEFAULT '' CHECK(length(alt_text)<=160 AND alt_text !~ '[<>[:cntrl:]]'),
 sort_order integer NOT NULL CHECK(sort_order BETWEEN 0 AND 4),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by uuid NOT NULL,
 removed_at timestamptz, removed_by uuid,
 CHECK((is_active AND removed_at IS NULL AND removed_by IS NULL) OR (NOT is_active AND removed_at IS NOT NULL AND removed_by IS NOT NULL)),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,created_by) REFERENCES app.staff_profiles(business_id,id),
 FOREIGN KEY(business_id,removed_by) REFERENCES app.staff_profiles(business_id,id)
);
CREATE UNIQUE INDEX store_hero_slides_active_path ON app.store_hero_slides(store_id,object_path) WHERE is_active;
CREATE INDEX store_hero_slides_active_order ON app.store_hero_slides(store_id,sort_order) WHERE is_active;
ALTER TABLE app.store_hero_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_hero_slides FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.store_hero_slides FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;

-- Storefront: the published store's active slides in order (path and alt text only). Empty when the store or
-- business is inactive or none are set; the homepage then shows its built-in images.
CREATE FUNCTION api.hero_slides(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('path',h.object_path,'alt',h.alt_text) ORDER BY h.sort_order,h.created_at,h.id)
  FROM app.store_hero_slides h JOIN app.stores s ON s.id=h.store_id AND s.business_id=h.business_id JOIN app.businesses b ON b.id=s.business_id
  WHERE h.store_id=target_store AND h.is_active AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL),'[]'::jsonb)
$fn$;

CREATE FUNCTION app.hero_editor(target_store uuid) RETURNS app.staff_profiles
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF target_store IS NULL OR NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 -- One writer per store at a time, so the 5-slide limit and the order stay consistent.
 PERFORM pg_advisory_xact_lock(hashtextextended('hero-slides:'||target_store::text,0));
 RETURN actor;
END $fn$;

CREATE FUNCTION api.hero_slide_settings(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'path',h.object_path,'alt',h.alt_text,'width',h.width_px,'sizeBytes',h.size_bytes,'createdAt',h.created_at) ORDER BY h.sort_order,h.created_at,h.id)
  FROM app.store_hero_slides h WHERE h.store_id=target_store AND h.business_id=actor.business_id AND h.is_active),'[]'::jsonb);
END $fn$;

-- Adds an uploaded {business}/{store}/{sha256}.webp at the end. The app checks the WebP header (width >= 1600) and
-- size before uploading; here the path, width, size and limit are checked again, and on Supabase the Storage object
-- must exist with that exact size and the WebP type.
CREATE FUNCTION api.add_hero_slide(target_store uuid,object_path text,width integer,size_bytes integer,alternate_text text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid; slots integer; stored_size bigint; stored_type text;
BEGIN
 actor:=app.hero_editor(target_store);
 IF object_path IS NULL OR object_path !~ ('^'||actor.business_id::text||'/'||target_store::text||'/[0-9a-f]{64}\.webp$')
 OR width IS NULL OR width NOT BETWEEN 1600 AND 16383 OR size_bytes IS NULL OR size_bytes NOT BETWEEN 1 AND 1048576
 OR length(COALESCE(alternate_text,''))>160 OR COALESCE(alternate_text,'') ~ '[<>[:cntrl:]]'
 THEN RAISE EXCEPTION 'Invalid hero photo' USING ERRCODE='22023'; END IF;
 IF to_regclass('storage.objects') IS NOT NULL THEN
  EXECUTE 'SELECT (metadata->>''size'')::bigint,metadata->>''mimetype'' FROM storage.objects WHERE bucket_id=''hero-images'' AND name=$1'
   INTO stored_size,stored_type USING object_path;
  IF stored_size IS DISTINCT FROM size_bytes::bigint OR stored_type IS DISTINCT FROM 'image/webp' THEN
   RAISE EXCEPTION 'Invalid hero photo' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT count(*) INTO slots FROM app.store_hero_slides h WHERE h.store_id=target_store AND h.is_active;
 IF slots>=5 THEN RAISE EXCEPTION 'The homepage banner can have at most 5 slides' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM app.store_hero_slides h WHERE h.store_id=target_store AND h.is_active AND h.object_path=add_hero_slide.object_path) THEN
  RAISE EXCEPTION 'This photo is already a slide' USING ERRCODE='22023'; END IF;
 INSERT INTO app.store_hero_slides(business_id,store_id,object_path,width_px,size_bytes,alt_text,sort_order,created_by)
 VALUES(actor.business_id,target_store,object_path,width,size_bytes,btrim(COALESCE(alternate_text,'')),
  COALESCE((SELECT max(h.sort_order)+1 FROM app.store_hero_slides h WHERE h.store_id=target_store AND h.is_active),0),actor.id)
 RETURNING id INTO result;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'HERO_SLIDE_ADDED',result,
  jsonb_build_object('path',object_path,'width',width,'sizeBytes',size_bytes,'position',slots+1));
 RETURN result;
END $fn$;

-- slides: every active slide of the store exactly once, in the new display order.
CREATE FUNCTION api.arrange_hero_slides(target_store uuid,slides uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; before uuid[];
BEGIN
 actor:=app.hero_editor(target_store);
 SELECT COALESCE(array_agg(h.id ORDER BY h.sort_order,h.created_at,h.id),'{}') INTO before
 FROM app.store_hero_slides h WHERE h.store_id=target_store AND h.business_id=actor.business_id AND h.is_active;
 IF slides IS NULL OR array_position(slides,NULL) IS NOT NULL OR cardinality(slides)<>cardinality(before)
 OR (SELECT count(DISTINCT x) FROM unnest(slides) x)<>cardinality(before) OR NOT (slides <@ before)
 THEN RAISE EXCEPTION 'Slides changed; reload' USING ERRCODE='40001'; END IF;
 UPDATE app.store_hero_slides h SET sort_order=t.n-1 FROM unnest(slides) WITH ORDINALITY AS t(id,n) WHERE h.id=t.id;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'HERO_SLIDES_ARRANGED',target_store,
  jsonb_build_object('from',to_jsonb(before),'to',to_jsonb(slides)));
END $fn$;

-- Soft remove: the slide leaves the homepage; the row and its Storage object stay. The rest close the gap.
CREATE FUNCTION api.remove_hero_slide(target_store uuid,slide uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; before app.store_hero_slides;
BEGIN
 actor:=app.hero_editor(target_store);
 SELECT * INTO before FROM app.store_hero_slides h WHERE h.id=slide AND h.store_id=target_store AND h.business_id=actor.business_id AND h.is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Slides changed; reload' USING ERRCODE='40001'; END IF;
 UPDATE app.store_hero_slides h SET is_active=false,removed_at=clock_timestamp(),removed_by=actor.id WHERE h.id=slide;
 UPDATE app.store_hero_slides h SET sort_order=t.n-1
 FROM (SELECT x.id,row_number() OVER (ORDER BY x.sort_order,x.created_at,x.id) AS n FROM app.store_hero_slides x WHERE x.store_id=target_store AND x.is_active) t
 WHERE h.id=t.id;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'HERO_SLIDE_REMOVED',slide,
  jsonb_build_object('path',before.object_path,'position',before.sort_order+1));
END $fn$;

-- Storage upload check for the "hero-images" INSERT policy: ADMIN or OWNER, own business, a store they can access.
CREATE FUNCTION api.can_upload_hero_image(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'
 AND app.current_staff_role() IN ('ADMIN','OWNER')
 AND EXISTS(SELECT 1 FROM app.stores s JOIN app.staff_profiles sp ON sp.business_id=s.business_id
  WHERE sp.id=app.current_staff_profile_id() AND s.deleted_at IS NULL
  AND s.business_id::text=split_part(object_name,'/',1) AND s.id::text=split_part(object_name,'/',2)
  AND app.can_access_store(s.business_id,s.id))
$fn$;

REVOKE ALL ON FUNCTION api.save_product_sale_options(uuid,jsonb,bigint,boolean),api.hero_slides(uuid),app.hero_editor(uuid),
 api.hero_slide_settings(uuid),api.add_hero_slide(uuid,text,integer,integer,text),api.arrange_hero_slides(uuid,uuid[]),
 api.remove_hero_slide(uuid,uuid),api.can_upload_hero_image(text)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.hero_slides(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION api.save_product_sale_options(uuid,jsonb,bigint,boolean),api.hero_slide_settings(uuid),
 api.add_hero_slide(uuid,text,integer,integer,text),api.arrange_hero_slides(uuid,uuid[]),api.remove_hero_slide(uuid,uuid),
 api.can_upload_hero_image(text) TO authenticated;
COMMENT ON FUNCTION api.hero_slides(uuid) IS 'Published store hero slide paths and alt text only; no staff data.';

-- Storage exists only on Supabase (not in the local PGlite test database). Public bucket; insert only, no update/delete.
DO $do$
BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('hero-images','hero-images',true,1048576,ARRAY['image/webp']) ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ADMIN and OWNER upload hero images') THEN
   CREATE POLICY "ADMIN and OWNER upload hero images" ON storage.objects FOR INSERT TO authenticated
   WITH CHECK (bucket_id='hero-images' AND api.can_upload_hero_image(name));
  END IF;
 END IF;
END $do$;
NOTIFY pgrst,'reload schema';
COMMIT;
