BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Offer conditions and banner images:
--  * min_order_paise: the coupon applies only when its eligible subtotal reaches this (0 = no minimum).
--  * max_discount_paise: caps a percent discount (NULL = no cap; flat offers never have one).
--  * image_path: optional WebP banner in the public offer-images bucket at {business}/{sha256}.webp.
-- Amounts are whole rupees stored as paise.
ALTER TABLE app.offers ADD COLUMN min_order_paise bigint NOT NULL DEFAULT 0
 CHECK(min_order_paise>=0 AND min_order_paise<=100000000 AND min_order_paise%100=0);
ALTER TABLE app.offers ADD COLUMN max_discount_paise bigint
 CHECK(max_discount_paise IS NULL OR (max_discount_paise>0 AND max_discount_paise<=100000000 AND max_discount_paise%100=0));
ALTER TABLE app.offers ADD CONSTRAINT offers_max_discount_percent_only CHECK(max_discount_paise IS NULL OR discount_kind='PERCENT');
ALTER TABLE app.offers ADD COLUMN image_path text
 CHECK(image_path IS NULL OR image_path ~ ('^'||business_id::text||'/[0-9a-f]{64}\.webp$'));

DROP FUNCTION api.save_offer(uuid,uuid,integer,text,text,text,bigint,timestamptz,timestamptz,text,uuid[],uuid[],boolean,text);
CREATE FUNCTION api.save_offer(target_id uuid,target_store uuid,expected_version integer,offer_title text,offer_message text,
 kind text,amount bigint,start_time timestamptz,end_time timestamptz,target_scope text,products uuid[],categories uuid[],active boolean,offer_code text,
 min_order bigint,max_discount bigint,image text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid; code_value text:=upper(btrim(offer_code)); found boolean;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('offers:'||target_store::text,0));
 IF code_value IS NULL OR code_value !~ '^[A-Z0-9]{3,20}$' THEN RAISE EXCEPTION 'Invalid offer code' USING ERRCODE='22023'; END IF;
 IF min_order IS NULL OR min_order<0 OR min_order%100<>0 OR (max_discount IS NOT NULL AND (kind<>'PERCENT' OR max_discount<=0 OR max_discount%100<>0))
 OR (kind='FIXED' AND amount%100<>0) THEN RAISE EXCEPTION 'Invalid offer conditions' USING ERRCODE='22023'; END IF;
 -- The banner must sit under the caller's own business and already be uploaded.
 IF image IS NOT NULL THEN
  IF image !~ ('^'||actor.business_id::text||'/[0-9a-f]{64}\.webp$') THEN RAISE EXCEPTION 'Invalid offer image' USING ERRCODE='22023'; END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=''offer-images'' AND name=$1)' INTO found USING image;
   IF NOT found THEN RAISE EXCEPTION 'Invalid offer image' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 IF products IS NULL OR categories IS NULL OR array_position(products,NULL) IS NOT NULL OR array_position(categories,NULL) IS NOT NULL
 OR EXISTS(SELECT 1 FROM unnest(products) p WHERE NOT EXISTS(SELECT 1 FROM app.products x WHERE x.id=p AND x.business_id=actor.business_id))
 OR EXISTS(SELECT 1 FROM unnest(categories) c WHERE NOT EXISTS(SELECT 1 FROM app.categories x WHERE x.id=c AND x.business_id=actor.business_id))
 THEN RAISE EXCEPTION 'Invalid offer targets' USING ERRCODE='22023'; END IF;
 IF target_id IS NULL THEN
  INSERT INTO app.offers(business_id,store_id,title,message,discount_kind,discount_value,starts_at,ends_at,scope,product_ids,category_ids,is_active,code,min_order_paise,max_discount_paise,image_path)
  VALUES(actor.business_id,target_store,btrim(offer_title),offer_message,kind,amount,start_time,end_time,target_scope,products,categories,active,code_value,min_order,max_discount,image) RETURNING id INTO result;
 ELSE
  UPDATE app.offers SET title=btrim(offer_title),message=offer_message,discount_kind=kind,discount_value=amount,starts_at=start_time,ends_at=end_time,
  scope=target_scope,product_ids=products,category_ids=categories,is_active=active,code=code_value,
  min_order_paise=min_order,max_discount_paise=max_discount,image_path=image,version=version+1
  WHERE id=target_id AND business_id=actor.business_id AND store_id=target_store AND version=expected_version RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Offer changed or unavailable; reload' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'OFFER_SAVED',result,
  jsonb_build_object('active',active,'code',code_value,'minOrderPaise',min_order,'maxDiscountPaise',max_discount,'image',image IS NOT NULL));
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION api.store_offers(target_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'message',o.message,'code',o.code,'kind',o.discount_kind,'value',o.discount_value,
 'endsAt',o.ends_at,'scope',o.scope,'products',o.product_ids,'categories',o.category_ids,
 'minOrderPaise',o.min_order_paise,'maxDiscountPaise',o.max_discount_paise,'imagePath',o.image_path,
 'targetNames',CASE o.scope WHEN 'PRODUCTS' THEN (SELECT jsonb_agg(p.name ORDER BY p.name) FROM app.products p WHERE p.id=ANY(o.product_ids))
 WHEN 'CATEGORIES' THEN (SELECT jsonb_agg(c.name ORDER BY c.name) FROM app.categories c WHERE c.id=ANY(o.category_ids)) ELSE '[]'::jsonb END) ORDER BY o.ends_at,o.id),'[]'::jsonb)
 FROM app.offers o JOIN app.stores s ON s.id=o.store_id JOIN app.businesses b ON b.id=o.business_id
 WHERE o.store_id=target_store AND o.is_active AND o.starts_at<=statement_timestamp() AND o.ends_at>statement_timestamp()
 AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL
$fn$;

-- The applied coupon's offer, discounting only its eligible lines, and only once they reach the offer's minimum.
-- Whole rupees: rounded to the nearest rupee, capped at the percent maximum, never above the eligible amount (floored
-- to a rupee), always leaving merchandise payable. Mirrored in src/lib/cart-offer.ts. No match returns NULL, which
-- app.build_order_quote reports as 'Coupon not valid for this cart'.
CREATE OR REPLACE FUNCTION app.offer_discount(target_store uuid,lines jsonb,pricing_at timestamptz,coupon text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH RECURSIVE ancestors AS (
 SELECT c.id,c.id AS ancestor,c.parent_id FROM app.categories c JOIN app.stores s ON s.business_id=c.business_id WHERE s.id=target_store
 UNION SELECT a.id,c.id,c.parent_id FROM ancestors a JOIN app.categories c ON c.id=a.parent_id
 ), candidate AS (
 SELECT o.*,COALESCE((SELECT sum((line->>'lineTotalPaise')::bigint) FROM jsonb_array_elements(lines) line
 WHERE o.scope='STORE' OR (o.scope='PRODUCTS' AND (line->>'productId')::uuid=ANY(o.product_ids))
 OR (o.scope='CATEGORIES' AND EXISTS(SELECT 1 FROM ancestors a WHERE a.id=(line->'snapshot'->>'categoryId')::uuid AND a.ancestor=ANY(o.category_ids)))),0)::bigint AS eligible,
 (SELECT COALESCE(sum((line->>'lineTotalPaise')::bigint),0) FROM jsonb_array_elements(lines) line)::bigint AS subtotal
 FROM app.offers o WHERE o.store_id=target_store AND o.code=coupon AND o.is_active AND o.starts_at<=pricing_at AND o.ends_at>pricing_at
 ), discounts AS (
 SELECT *,LEAST(
  round((CASE WHEN discount_kind='PERCENT' THEN floor(eligible::numeric*discount_value/10000) ELSE discount_value END)/100.0)*100,
  CASE WHEN discount_kind='PERCENT' THEN max_discount_paise END, -- LEAST ignores NULL: no cap
  floor(eligible/100.0)*100,
  floor(GREATEST(subtotal-1,0)/100.0)*100)::bigint AS discount FROM candidate WHERE eligible>=min_order_paise
 )
 SELECT jsonb_build_object('id',id,'title',title,'code',code,'version',version,'kind',discount_kind,'value',discount_value,
  'minOrderPaise',min_order_paise,'maxDiscountPaise',max_discount_paise,'eligibleSubtotalPaise',eligible,'discountPaise',discount)
 FROM discounts WHERE discount>0
$fn$;

REVOKE ALL ON FUNCTION api.save_offer(uuid,uuid,integer,text,text,text,bigint,timestamptz,timestamptz,text,uuid[],uuid[],boolean,text,bigint,bigint,text),
 app.offer_discount(uuid,jsonb,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.save_offer(uuid,uuid,integer,text,text,text,bigint,timestamptz,timestamptz,text,uuid[],uuid[],boolean,text,bigint,bigint,text) TO authenticated;

-- Offer banner uploads: an active ADMIN or OWNER, only under their own business folder.
-- Lives in api because authenticated has no usage on app; it only answers yes/no for the caller.
CREATE FUNCTION api.can_upload_offer_image(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT object_name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'
 AND app.current_staff_role() IN ('ADMIN','OWNER')
 AND EXISTS(SELECT 1 FROM app.staff_profiles sp WHERE sp.id=app.current_staff_profile_id() AND sp.business_id::text=split_part(object_name,'/',1))
$fn$;
REVOKE ALL ON FUNCTION api.can_upload_offer_image(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION api.can_upload_offer_image(text) TO authenticated;

-- Storage exists only on Supabase (the local PGlite test database has no storage schema).
-- Public bucket: the storefront reads banners by public URL, so no read policy is needed. Insert only; no update/delete.
DO $do$
BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('offer-images','offer-images',true,1048576,ARRAY['image/webp']) ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ADMIN and OWNER upload offer images') THEN
   CREATE POLICY "ADMIN and OWNER upload offer images" ON storage.objects FOR INSERT TO authenticated
   WITH CHECK (bucket_id='offer-images' AND api.can_upload_offer_image(name));
  END IF;
 END IF;
END $do$;
NOTIFY pgrst,'reload schema';
COMMIT;
