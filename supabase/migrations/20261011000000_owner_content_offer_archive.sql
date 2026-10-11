BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- 1. OWNER may change a product's photo, local name and description (own business only).
--    Every other product field, category and pricing stays ADMIN-only (save_product, save_product_image,
--    configure_product_pricing and catalogue_master are unchanged).
CREATE FUNCTION api.product_content() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'local_name',p.local_name,'description',p.description,'image_path',p.image_path,'is_active',p.is_active,
  'category',(SELECT c.name FROM app.categories c WHERE c.id=p.category_id),
  'photo',(SELECT i.storage_object_path FROM app.product_images i WHERE i.product_id=p.id AND i.is_primary AND i.is_active AND i.storage_bucket='product-images' ORDER BY i.sort_order,i.id LIMIT 1))
  ORDER BY p.sort_order,p.name) FROM app.products p WHERE p.business_id=actor.business_id),'[]'::jsonb);
END $fn$;

CREATE FUNCTION api.save_product_content(product uuid,local_name text,description text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; before app.products;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 SELECT * INTO before FROM app.products p WHERE p.id=product AND p.business_id=actor.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF local_name IS NULL OR description IS NULL THEN RAISE EXCEPTION 'Invalid product content' USING ERRCODE='22023'; END IF;
 UPDATE app.products p SET local_name=btrim(save_product_content.local_name),description=save_product_content.description WHERE p.id=product;
 PERFORM app.core_audit(actor.business_id,NULL,actor.id,app.current_staff_role(),'PRODUCT_CONTENT_SAVED',product,
  jsonb_build_object('localName',jsonb_build_object('from',before.local_name,'to',btrim(save_product_content.local_name)),
   'description',jsonb_build_object('from',before.description,'to',save_product_content.description)));
 RETURN product;
END $fn$;

-- Makes an uploaded product-images object the product's main photo. Narrower than save_product_image:
-- the path must be {business}/{product}/{sha256}.webp under the caller's own business and already uploaded.
CREATE FUNCTION api.set_product_photo(product uuid,object_path text,alternate_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid; previous text; uploaded boolean;
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
 SELECT i.storage_object_path INTO previous FROM app.product_images i WHERE i.product_id=product AND i.is_primary AND i.is_active ORDER BY i.sort_order,i.id LIMIT 1;
 UPDATE app.product_images i SET is_primary=false WHERE i.product_id=product AND i.is_primary;
 INSERT INTO app.product_images(business_id,product_id,asset_path,storage_bucket,storage_object_path,alt_text,is_primary,is_active,sort_order)
 VALUES(actor.business_id,product,NULL,'product-images',object_path,left(coalesce(alternate_text,''),240),true,true,0) RETURNING id INTO result;
 PERFORM app.core_audit(actor.business_id,NULL,actor.id,app.current_staff_role(),'PRODUCT_PHOTO_SAVED',product,
  jsonb_build_object('image',result,'from',previous,'to',object_path));
 RETURN result;
END $fn$;

-- Storage upload check (used by the "product-images" INSERT policy): ADMIN or OWNER, own business, existing product.
CREATE OR REPLACE FUNCTION api.can_upload_product_image(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'
 AND app.current_staff_role() IN ('ADMIN','OWNER')
 AND EXISTS(SELECT 1 FROM app.products p JOIN app.staff_profiles sp ON sp.business_id=p.business_id
  WHERE sp.id=app.current_staff_profile_id()
  AND p.business_id::text=split_part(object_name,'/',1) AND p.id::text=split_part(object_name,'/',2))
$fn$;

-- 2. Offers: "Delete" archives (no hard deletes). An archived offer is never active, so the storefront
--    (store_offers) and checkout (offer_discount), which already require is_active, stop it immediately.
--    The row stays, so its code stays reserved by offers_store_code_key.
ALTER TABLE app.offers ADD COLUMN archived_at timestamptz;
ALTER TABLE app.offers ADD CONSTRAINT offers_archived_inactive CHECK(archived_at IS NULL OR NOT is_active);

CREATE OR REPLACE FUNCTION api.save_offer(target_id uuid,target_store uuid,expected_version integer,offer_title text,offer_message text,
 kind text,amount bigint,start_time timestamptz,end_time timestamptz,target_scope text,products uuid[],categories uuid[],active boolean,offer_code text,
 min_order bigint,max_discount bigint,image text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
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
  -- Archived offers are read-only until restored.
  UPDATE app.offers SET title=btrim(offer_title),message=offer_message,discount_kind=kind,discount_value=amount,starts_at=start_time,ends_at=end_time,
  scope=target_scope,product_ids=products,category_ids=categories,is_active=active,code=code_value,
  min_order_paise=min_order,max_discount_paise=max_discount,image_path=image,version=version+1
  WHERE id=target_id AND business_id=actor.business_id AND store_id=target_store AND version=expected_version AND archived_at IS NULL RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Offer changed or unavailable; reload' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'OFFER_SAVED',result,
  jsonb_build_object('active',active,'code',code_value,'minOrderPaise',min_order,'maxDiscountPaise',max_discount,'image',image IS NOT NULL));
 RETURN result;
END $fn$;

-- operation: ARCHIVE (delete: stops now, hidden), RESTORE (back to the list, inactive), STOP (end time = now).
CREATE FUNCTION api.change_offer_state(target_id uuid,target_store uuid,expected_version integer,operation text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; before app.offers; now_at timestamptz:=statement_timestamp();
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF operation IS NULL OR operation NOT IN ('ARCHIVE','RESTORE','STOP') THEN RAISE EXCEPTION 'Invalid offer action' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('offers:'||target_store::text,0));
 SELECT * INTO before FROM app.offers o WHERE o.id=target_id AND o.business_id=actor.business_id AND o.store_id=target_store AND o.version=expected_version FOR UPDATE;
 IF NOT FOUND OR (operation='RESTORE')<>(before.archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Offer changed or unavailable; reload' USING ERRCODE='40001'; END IF;
 IF operation='ARCHIVE' THEN
  UPDATE app.offers SET archived_at=now_at,is_active=false,version=version+1 WHERE id=target_id;
 ELSIF operation='RESTORE' THEN
  UPDATE app.offers SET archived_at=NULL,version=version+1 WHERE id=target_id;
 ELSE
  IF before.ends_at<=now_at THEN RAISE EXCEPTION 'Offer already ended' USING ERRCODE='22023'; END IF;
  -- An offer that has not started yet keeps a valid window (start before end).
  UPDATE app.offers SET ends_at=now_at,starts_at=LEAST(starts_at,now_at-interval '1 second'),version=version+1 WHERE id=target_id;
 END IF;
 PERFORM app.core_audit(actor.business_id,target_store,actor.id,app.current_staff_role(),'OFFER_'||CASE operation WHEN 'ARCHIVE' THEN 'ARCHIVED' WHEN 'RESTORE' THEN 'RESTORED' ELSE 'STOPPED' END,target_id,
  jsonb_build_object('code',before.code,'wasActive',before.is_active,'startsAt',before.starts_at,'endsAt',before.ends_at,'at',now_at));
 RETURN target_id;
END $fn$;

REVOKE ALL ON FUNCTION api.product_content(),api.save_product_content(uuid,text,text),api.set_product_photo(uuid,text,text),
 api.can_upload_product_image(text),api.change_offer_state(uuid,uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION api.product_content(),api.save_product_content(uuid,text,text),api.set_product_photo(uuid,text,text),
 api.can_upload_product_image(text),api.change_offer_state(uuid,uuid,integer,text) TO authenticated;
COMMIT;
