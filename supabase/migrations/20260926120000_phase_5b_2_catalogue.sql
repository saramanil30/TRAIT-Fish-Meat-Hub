-- Phase 5B.2 Catalogue. Forward-only extension of the deployed staff-access model.
-- No Auth/Storage DDL, seeds, orders, payments or customers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run as postgres'; END IF;
 IF to_regclass('app.staff_admin_grants') IS NULL OR to_regprocedure('api.update_daily_product(uuid,integer,bigint,boolean)') IS NULL
 THEN RAISE EXCEPTION 'Deployed staff-access foundation required'; END IF;
 IF to_regclass('app.product_images') IS NOT NULL OR to_regclass('app.preparation_options') IS NOT NULL
 THEN RAISE EXCEPTION 'Unexpected catalogue state'; END IF;
END;
$preflight$;

ALTER TABLE app.products
 ADD COLUMN featured boolean NOT NULL DEFAULT false,
 ADD COLUMN sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE app.categories
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE app.product_store_settings
 ADD COLUMN is_active boolean NOT NULL DEFAULT true,
 ADD COLUMN featured_override boolean,
 ADD COLUMN sort_override integer CHECK(sort_override >= 0);
CREATE INDEX categories_parent_idx ON app.categories(business_id,parent_id,sort_order);
CREATE INDEX products_display_idx ON app.products(business_id,category_id,is_active,sort_order);
CREATE INDEX offerings_store_idx ON app.product_store_settings(business_id,store_id,is_active);
CREATE INDEX prices_effective_idx ON app.product_prices(offering_id,effective_from DESC,offering_version DESC);

CREATE TABLE app.preparation_options (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100 AND name=btrim(name)),
 is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(business_id,id)
);
CREATE UNIQUE INDEX preparations_name_key ON app.preparation_options(business_id,lower(name));
CREATE TABLE app.product_preparation_options (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 product_id uuid NOT NULL,
 preparation_option_id uuid NOT NULL,
 cleaning_loss_percent numeric CHECK(cleaning_loss_percent >= 0 AND cleaning_loss_percent < 100),
 is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id),
 FOREIGN KEY(business_id,preparation_option_id) REFERENCES app.preparation_options(business_id,id),
 UNIQUE(business_id,product_id,preparation_option_id)
);
CREATE INDEX product_preparation_option_idx ON app.product_preparation_options(business_id,preparation_option_id);
CREATE TABLE app.product_allowed_weights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 product_id uuid NOT NULL,
 raw_weight_grams integer NOT NULL CHECK(raw_weight_grams BETWEEN 1 AND 100000),
 is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id),
 UNIQUE(business_id,product_id,raw_weight_grams)
);
CREATE TABLE app.product_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 product_id uuid NOT NULL,
 asset_path text,
 storage_bucket text,
 storage_object_path text,
 alt_text text NOT NULL DEFAULT '' CHECK(length(alt_text)<=240),
 is_primary boolean NOT NULL DEFAULT false,
 is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
 legacy boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id),
 CHECK(
  (asset_path IS NOT NULL AND storage_bucket IS NULL AND storage_object_path IS NULL
   AND length(asset_path)<=500 AND asset_path ~ '^/assets/[a-zA-Z0-9/_ .-]+\.(jpg|jpeg|png|webp)$' AND position('..' in asset_path)=0)
  OR
  (asset_path IS NULL AND storage_bucket IS NOT NULL AND storage_bucket='product-images' AND storage_object_path IS NOT NULL
   AND storage_object_path ~ ('^' || business_id::text || '/' || product_id::text || '/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$'))
 )
);
CREATE UNIQUE INDEX product_images_primary_key ON app.product_images(business_id,product_id) WHERE is_primary AND is_active;
CREATE UNIQUE INDEX product_images_legacy_key ON app.product_images(business_id,product_id) WHERE legacy;
CREATE INDEX product_images_display_idx ON app.product_images(business_id,product_id,is_active,sort_order);

-- Original JSON inputs stay supported. Normalized rows preserve IDs when
-- removed/re-added; all master writers serialize on the product row.
CREATE FUNCTION app.sync_product_catalogue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE item jsonb; ordinal bigint; prep uuid;
BEGIN
 IF TG_OP='INSERT' OR NEW.allowed_weights IS DISTINCT FROM OLD.allowed_weights THEN
 UPDATE app.product_allowed_weights SET is_active=false WHERE product_id=NEW.id AND business_id=NEW.business_id;
 FOR item,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(NEW.allowed_weights) WITH ORDINALITY LOOP
  INSERT INTO app.product_allowed_weights(business_id,product_id,raw_weight_grams,sort_order)
  VALUES(NEW.business_id,NEW.id,(item::text)::integer,ordinal::integer-1)
  ON CONFLICT(business_id,product_id,raw_weight_grams) DO UPDATE SET is_active=true,sort_order=EXCLUDED.sort_order;
 END LOOP;
 END IF;
 IF TG_OP='INSERT' OR NEW.preparations IS DISTINCT FROM OLD.preparations THEN
 UPDATE app.product_preparation_options SET is_active=false WHERE product_id=NEW.id AND business_id=NEW.business_id;
 FOR item,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(NEW.preparations) WITH ORDINALITY LOOP
  INSERT INTO app.preparation_options(business_id,name)
  VALUES(NEW.business_id,btrim(item->>'name'))
  ON CONFLICT(business_id,lower(name)) DO NOTHING;
  SELECT id INTO prep FROM app.preparation_options WHERE business_id=NEW.business_id AND lower(name)=lower(btrim(item->>'name'));
  INSERT INTO app.product_preparation_options(business_id,product_id,preparation_option_id,cleaning_loss_percent,sort_order)
  VALUES(NEW.business_id,NEW.id,prep,(item->>'cleaning_loss_percent')::numeric,ordinal::integer-1)
  ON CONFLICT(business_id,product_id,preparation_option_id) DO UPDATE
  SET is_active=true,cleaning_loss_percent=EXCLUDED.cleaning_loss_percent,sort_order=EXCLUDED.sort_order;
 END LOOP;
 END IF;
 IF TG_OP='INSERT' OR NEW.image_path IS DISTINCT FROM OLD.image_path THEN
  UPDATE app.product_images SET is_active=false,is_primary=false WHERE product_id=NEW.id AND legacy;
  IF NEW.image_path<>'' THEN
   UPDATE app.product_images SET is_primary=false WHERE product_id=NEW.id AND is_primary;
   INSERT INTO app.product_images(business_id,product_id,asset_path,alt_text,is_primary,legacy)
   VALUES(NEW.business_id,NEW.id,NEW.image_path,NEW.name,true,true)
   ON CONFLICT(business_id,product_id) WHERE legacy DO UPDATE
   SET asset_path=EXCLUDED.asset_path,alt_text=EXCLUDED.alt_text,is_active=true,is_primary=true;
  END IF;
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER products_catalogue_sync AFTER INSERT OR UPDATE OF allowed_weights,preparations,image_path ON app.products
FOR EACH ROW EXECUTE FUNCTION app.sync_product_catalogue();

-- Forward conversion only of already-existing master data, not product seeding.
INSERT INTO app.preparation_options(business_id,name)
SELECT business_id,min(btrim(item->>'name')) FROM app.products p CROSS JOIN LATERAL jsonb_array_elements(p.preparations) item
GROUP BY business_id,lower(btrim(item->>'name'));
INSERT INTO app.product_preparation_options(business_id,product_id,preparation_option_id,cleaning_loss_percent,sort_order)
SELECT p.business_id,p.id,o.id,(item->>'cleaning_loss_percent')::numeric,ordinality::integer-1
FROM app.products p CROSS JOIN LATERAL jsonb_array_elements(p.preparations) WITH ORDINALITY AS items(item,ordinality)
JOIN app.preparation_options o ON o.business_id=p.business_id AND lower(o.name)=lower(btrim(item->>'name'));
INSERT INTO app.product_allowed_weights(business_id,product_id,raw_weight_grams,sort_order)
SELECT p.business_id,p.id,(item::text)::integer,ordinality::integer-1
FROM app.products p CROSS JOIN LATERAL jsonb_array_elements(p.allowed_weights) WITH ORDINALITY AS items(item,ordinality);
INSERT INTO app.product_images(business_id,product_id,asset_path,alt_text,is_primary,legacy)
SELECT business_id,id,image_path,name,true,true FROM app.products WHERE image_path<>'';

-- Lifecycle checks prevent destructive removal and tenant/identity reassignment.
CREATE TRIGGER categories_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.categories FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER products_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.products FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER preparation_options_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.preparation_options FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER product_preparations_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.product_preparation_options FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER product_weights_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.product_allowed_weights FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER product_images_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.product_images FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();

CREATE FUNCTION app.category_is_visible(category uuid, business uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
 WITH RECURSIVE ancestry AS (
 SELECT id,parent_id,is_active FROM app.categories WHERE id=category AND business_id=business
 UNION SELECT c.id,c.parent_id,c.is_active FROM app.categories c JOIN ancestry a ON c.id=a.parent_id WHERE c.business_id=business
 )
 SELECT count(*)>0 AND bool_and(is_active) FROM ancestry
$fn$;

CREATE FUNCTION api.save_preparation_option(target_id uuid, option_name text, active boolean, display_order integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; result uuid;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN']);
 -- Match save_product's lock order (products before preparation records).
 PERFORM 1 FROM app.products WHERE business_id=actor.business_id ORDER BY id FOR UPDATE;
 IF target_id IS NULL THEN
 INSERT INTO app.preparation_options(business_id,name,is_active,sort_order) VALUES(actor.business_id,btrim(option_name),active,display_order) RETURNING id INTO result;
 ELSE
 UPDATE app.preparation_options SET name=btrim(option_name),is_active=active,sort_order=display_order
 WHERE id=target_id AND business_id=actor.business_id RETURNING id INTO result;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 -- Preserve the legacy input cache after a reusable preparation rename.
 UPDATE app.products p SET preparations=(
 SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name',o.name,'cleaning_loss_percent',pp.cleaning_loss_percent)) ORDER BY pp.sort_order,pp.id)
 FROM app.product_preparation_options pp JOIN app.preparation_options o ON o.id=pp.preparation_option_id
 WHERE pp.product_id=p.id AND pp.is_active)
 WHERE p.business_id=actor.business_id AND EXISTS(SELECT 1 FROM app.product_preparation_options pp WHERE pp.product_id=p.id AND pp.preparation_option_id=result AND pp.is_active);
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'PREPARATION_SAVED',result,jsonb_build_object('active',active));
 RETURN result;
END;
$fn$;

CREATE FUNCTION api.set_product_configuration(product uuid, weights jsonb, preparation_choices jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN']);
 UPDATE app.products SET allowed_weights=weights,preparations=preparation_choices WHERE id=product AND business_id=actor.business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'PRODUCT_CONFIGURATION',product,jsonb_build_object('weights',weights,'preparations',preparation_choices));
END;
$fn$;
CREATE FUNCTION api.set_product_display(product uuid, is_featured boolean, display_order integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN']);
 UPDATE app.products SET featured=is_featured,sort_order=display_order WHERE id=product AND business_id=actor.business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'PRODUCT_DISPLAY',product,jsonb_build_object('featured',is_featured,'sort',display_order));
END;
$fn$;
CREATE FUNCTION api.set_offering_display(offering uuid, active boolean, featured boolean, display_order integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN']);
 UPDATE app.product_store_settings SET is_active=active,featured_override=featured,sort_override=display_order,version=version+1,updated_at=clock_timestamp()
 WHERE id=offering AND business_id=actor.business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'OFFERING_DISPLAY',offering,jsonb_build_object('active',active,'featured',featured,'sort',display_order));
END;
$fn$;

CREATE FUNCTION api.save_product_image(target_id uuid, product uuid, local_asset text, bucket text, object_path text, alternate_text text, primary_image boolean, active boolean, display_order integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; result uuid;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN']);
 PERFORM 1 FROM app.products WHERE id=product AND business_id=actor.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.product_images WHERE id=target_id AND product_id=product AND business_id=actor.business_id AND NOT legacy) THEN
 RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF primary_image AND active THEN UPDATE app.product_images SET is_primary=false WHERE product_id=product AND is_primary; END IF;
 IF target_id IS NULL THEN
 INSERT INTO app.product_images(business_id,product_id,asset_path,storage_bucket,storage_object_path,alt_text,is_primary,is_active,sort_order)
 VALUES(actor.business_id,product,local_asset,bucket,object_path,alternate_text,primary_image,active,display_order) RETURNING id INTO result;
 ELSE UPDATE app.product_images SET asset_path=local_asset,storage_bucket=bucket,storage_object_path=object_path,alt_text=alternate_text,is_primary=primary_image,is_active=active,sort_order=display_order
 WHERE id=target_id AND product_id=product AND business_id=actor.business_id RETURNING id INTO result;
 END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'PRODUCT_IMAGE',result,jsonb_build_object('active',active,'primary',primary_image));
 RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION api.daily_products(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'name',p.name,'category',c.name,
 'pricePaise',price.price_per_kg_paise,'available',o.available,'version',o.version,'updatedAt',o.updated_at) ORDER BY c.sort_order,p.name)
 FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id
 JOIN app.categories c ON c.id=p.category_id
 LEFT JOIN LATERAL (SELECT price_per_kg_paise FROM app.product_prices pr WHERE pr.offering_id=o.id ORDER BY offering_version DESC LIMIT 1) price ON true
 WHERE o.business_id=actor.business_id AND o.store_id=target_store AND p.is_active AND c.is_active AND o.is_active AND app.category_is_visible(p.category_id,p.business_id)), '[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION api.update_daily_product(offering uuid, expected_version integer, price_paise bigint, is_available boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; old_row app.product_store_settings; old_price bigint;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 IF price_paise IS NULL OR price_paise NOT BETWEEN 1 AND 100000000 OR is_available IS NULL OR expected_version IS NULL THEN
 RAISE EXCEPTION 'Invalid daily product values' USING ERRCODE='22023'; END IF;
 SELECT o.* INTO old_row FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id JOIN app.categories c ON c.id=p.category_id
 WHERE o.id=offering AND o.business_id=actor.business_id AND p.is_active AND c.is_active AND o.is_active AND app.category_is_visible(p.category_id,p.business_id) FOR UPDATE OF o;
 IF old_row.id IS NULL OR NOT app.can_access_store(actor.business_id,old_row.store_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF old_row.version <> expected_version THEN RAISE EXCEPTION 'Product changed; reload before saving' USING ERRCODE='40001'; END IF;
 SELECT price_per_kg_paise INTO old_price FROM app.product_prices WHERE offering_id=offering ORDER BY offering_version DESC LIMIT 1;
 IF old_price IS NOT DISTINCT FROM price_paise AND old_row.available = is_available THEN RETURN; END IF;
 UPDATE app.product_store_settings SET available=is_available,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=offering;
 IF old_price IS DISTINCT FROM price_paise THEN
 INSERT INTO app.product_prices(business_id,offering_id,price_per_kg_paise,offering_version,created_by)
 VALUES(actor.business_id,offering,price_paise,old_row.version+1,actor.id);
 END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail)
 VALUES(actor.business_id,actor.id,'DAILY_PRODUCT_UPDATED',offering,jsonb_build_object('oldPricePaise',old_price,'pricePaise',price_paise,'wasAvailable',old_row.available,'available',is_available));
END;
$fn$;

CREATE OR REPLACE FUNCTION api.catalogue_master() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN']);
 RETURN jsonb_build_object(
 'categories',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.sort_order,c.name) FROM app.categories c WHERE c.business_id=actor.business_id),'[]'::jsonb),
 'products',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sort_order,p.name) FROM app.products p WHERE p.business_id=actor.business_id),'[]'::jsonb),
 'images',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order,i.id) FROM app.product_images i WHERE i.business_id=actor.business_id),'[]'::jsonb),
 'preparationOptions',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.sort_order,o.name) FROM app.preparation_options o WHERE o.business_id=actor.business_id),'[]'::jsonb),
 'productPreparations',COALESCE((SELECT jsonb_agg(to_jsonb(pp) ORDER BY pp.sort_order,pp.id) FROM app.product_preparation_options pp WHERE pp.business_id=actor.business_id),'[]'::jsonb),
 'allowedWeights',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.sort_order,w.id) FROM app.product_allowed_weights w WHERE w.business_id=actor.business_id),'[]'::jsonb));
END;
$fn$;

-- Safe display projection. Sold-out products remain visible; inactive products,
-- ancestors, stores, businesses and incomplete configurations do not.
CREATE FUNCTION api.catalogue(target_store uuid, category_filter uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE business uuid;
BEGIN
 SELECT s.business_id INTO business FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL;
 IF business IS NULL THEN RETURN jsonb_build_object('categories','[]'::jsonb,'products','[]'::jsonb); END IF;
 RETURN jsonb_build_object(
 'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'parentId',c.parent_id,'name',c.name,'sortOrder',c.sort_order) ORDER BY c.sort_order,c.name,c.id)
 FROM app.categories c WHERE c.business_id=business AND app.category_is_visible(c.id,business)),'[]'::jsonb),
 'products',COALESCE((
 WITH RECURSIVE selected AS (
 SELECT id FROM app.categories WHERE id=category_filter AND business_id=business
 UNION SELECT c.id FROM app.categories c JOIN selected t ON c.parent_id=t.id WHERE c.business_id=business
 )
 SELECT jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'localName',p.local_name,'description',p.description,
 'categoryId',p.category_id,'category',c.name,'pricePerKgPaise',price.price_per_kg_paise,
 'pricingBasis','RAW_WEIGHT','available',o.available,'featured',COALESCE(o.featured_override,p.featured),
 'sortOrder',COALESCE(o.sort_override,p.sort_order),
 'images',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'assetPath',i.asset_path,'bucket',i.storage_bucket,'objectPath',i.storage_object_path,'alt',i.alt_text,'primary',i.is_primary) ORDER BY i.is_primary DESC,i.sort_order,i.id),'[]'::jsonb)
 FROM app.product_images i WHERE i.product_id=p.id AND i.is_active),
 'weightsGrams',(SELECT jsonb_agg(w.raw_weight_grams ORDER BY w.sort_order,w.raw_weight_grams) FROM app.product_allowed_weights w WHERE w.product_id=p.id AND w.is_active),
 'preparations',(SELECT jsonb_agg(jsonb_build_object('id',opt.id,'name',opt.name,'cleaningLossPercent',pp.cleaning_loss_percent) ORDER BY pp.sort_order,opt.sort_order,opt.id)
 FROM app.product_preparation_options pp JOIN app.preparation_options opt ON opt.id=pp.preparation_option_id
 WHERE pp.product_id=p.id AND pp.is_active AND opt.is_active))
 ORDER BY COALESCE(o.featured_override,p.featured) DESC,COALESCE(o.sort_override,p.sort_order),p.name,p.id)
 FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id JOIN app.categories c ON c.id=p.category_id
 JOIN LATERAL (SELECT price_per_kg_paise FROM app.product_prices pr WHERE pr.offering_id=o.id AND pr.effective_from<=statement_timestamp() ORDER BY pr.effective_from DESC,pr.offering_version DESC LIMIT 1) price ON true
 WHERE o.business_id=business AND o.store_id=target_store AND o.is_active AND p.is_active AND app.category_is_visible(c.id,business)
 AND (category_filter IS NULL OR p.category_id IN (SELECT id FROM selected))
 AND EXISTS(SELECT 1 FROM app.product_allowed_weights w WHERE w.product_id=p.id AND w.is_active)
 AND EXISTS(SELECT 1 FROM app.product_preparation_options pp JOIN app.preparation_options opt ON opt.id=pp.preparation_option_id WHERE pp.product_id=p.id AND pp.is_active AND opt.is_active)
 ),'[]'::jsonb));
END;
$fn$;

ALTER TABLE app.preparation_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.preparation_options FORCE ROW LEVEL SECURITY;
ALTER TABLE app.product_preparation_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_preparation_options FORCE ROW LEVEL SECURITY;
ALTER TABLE app.product_allowed_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_allowed_weights FORCE ROW LEVEL SECURITY;
ALTER TABLE app.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_images FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA app,api FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app,api FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app,api FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SCHEMA app,api FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA api TO anon,authenticated;
GRANT EXECUTE ON FUNCTION api.catalogue(uuid,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION
 api.staff_context(),api.daily_products(uuid),api.update_daily_product(uuid,integer,bigint,boolean),
 api.catalogue_master(),api.save_category(uuid,text,uuid,integer,boolean),
 api.save_product(uuid,uuid,text,text,text,text,jsonb,jsonb,boolean),api.create_offering(uuid,uuid),
 api.employee_access(),api.set_employee_access(uuid,boolean),
 api.store_operations(uuid),api.save_store_operations(uuid,text,boolean,boolean,jsonb),
 api.save_preparation_option(uuid,text,boolean,integer),
 api.set_product_configuration(uuid,jsonb,jsonb),api.set_product_display(uuid,boolean,integer),
 api.set_offering_display(uuid,boolean,boolean,integer),
 api.save_product_image(uuid,uuid,text,text,text,text,boolean,boolean,integer)
TO authenticated;

DO $security$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR pg_get_userbyid(c.relowner)<>'postgres')) THEN RAISE EXCEPTION 'Unsafe table state'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname IN ('anon','authenticated','service_role') AND n.nspname IN ('app','api') AND c.relkind='r' AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN RAISE EXCEPTION 'Unexpected direct table access'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','api') AND (pg_get_userbyid(p.proowner)<>'postgres' OR has_function_privilege('service_role',p.oid,'EXECUTE') OR (has_function_privilege('anon',p.oid,'EXECUTE') AND NOT(n.nspname='api' AND p.proname='catalogue')) OR (n.nspname='app' AND has_function_privilege('authenticated',p.oid,'EXECUTE')))) THEN RAISE EXCEPTION 'Unexpected function grants'; END IF;
END;
$security$;
COMMIT;
