-- Proposed only: do not apply to hosted Supabase without a separate deployment instruction.
-- Existing foundation and constraints remain intact. ADMIN is an explicit, private
-- elevation of an active staff profile; only migration administrators can grant it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
BEGIN
 IF CURRENT_USER <> 'postgres' THEN RAISE EXCEPTION 'Run as postgres'; END IF;
 IF pg_catalog.to_regclass('app.staff_profiles') IS NULL THEN RAISE EXCEPTION 'Foundation required'; END IF;
END;
$preflight$;

CREATE TABLE app.staff_admin_grants (
 staff_profile_id uuid PRIMARY KEY REFERENCES app.staff_profiles(id) ON DELETE RESTRICT,
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp()
);
COMMENT ON TABLE app.staff_admin_grants IS 'Business-scoped ADMIN elevation. Provisioned only by postgres, never by staff APIs or Auth metadata. Requires an active staff profile and business.';

CREATE FUNCTION app.current_staff_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
 SELECT CASE WHEN EXISTS (SELECT 1 FROM app.staff_admin_grants g WHERE g.staff_profile_id = sp.id AND g.is_active)
 THEN 'ADMIN' ELSE sp.role END
 FROM app.staff_profiles sp WHERE sp.id = app.current_staff_profile_id()
$fn$;
CREATE FUNCTION app.require_staff(allowed_roles text[]) RETURNS app.staff_profiles
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 SELECT * INTO actor FROM app.staff_profiles WHERE id = app.current_staff_profile_id();
 IF actor.id IS NULL OR NOT (app.current_staff_role() = ANY(allowed_roles)) THEN
  RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
 END IF;
 RETURN actor;
END;
$fn$;
CREATE OR REPLACE FUNCTION app.can_access_store(target_business_id uuid, target_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
 SELECT EXISTS (
 SELECT 1 FROM app.stores s JOIN app.staff_profiles sp ON sp.business_id = s.business_id
 WHERE s.business_id = target_business_id AND s.id = target_store_id
 AND s.is_active AND s.deleted_at IS NULL AND sp.id = app.current_staff_profile_id()
 AND (app.current_staff_role() IN ('ADMIN','OWNER') OR app.is_store_employee(target_business_id,target_store_id)))
$fn$;

CREATE TABLE app.categories (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
 parent_id uuid,
 sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
 is_active boolean NOT NULL DEFAULT true,
 UNIQUE(business_id,id), UNIQUE(business_id,name),
 FOREIGN KEY(business_id,parent_id) REFERENCES app.categories(business_id,id),
 CHECK(parent_id IS DISTINCT FROM id)
);
CREATE FUNCTION app.valid_product_configuration(weights jsonb, preparations jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE item jsonb;
BEGIN
 IF jsonb_typeof(weights) IS DISTINCT FROM 'array' OR jsonb_typeof(preparations) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(weights) NOT BETWEEN 1 AND 50 OR jsonb_array_length(preparations) NOT BETWEEN 1 AND 50 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(weights) LOOP
  IF jsonb_typeof(item) <> 'number' OR item::text !~ '^[0-9]+$' OR (item::text)::numeric NOT BETWEEN 1 AND 100000 THEN RETURN false; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(weights)) <> jsonb_array_length(weights) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(preparations) LOOP
  IF jsonb_typeof(item) <> 'object' OR (item - 'name' - 'cleaning_loss_percent') <> '{}'::jsonb
   OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  IF item ? 'cleaning_loss_percent' THEN
   IF jsonb_typeof(item->'cleaning_loss_percent') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
   IF (item->>'cleaning_loss_percent')::numeric < 0 OR (item->>'cleaning_loss_percent')::numeric >= 100 THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN (SELECT count(DISTINCT lower(btrim(value->>'name'))) FROM jsonb_array_elements(preparations)) = jsonb_array_length(preparations);
END;
$fn$;
CREATE TABLE app.products (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 category_id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 local_name text NOT NULL DEFAULT '' CHECK(length(local_name) <= 160),
 description text NOT NULL DEFAULT '' CHECK(length(description) <= 4000),
 image_path text NOT NULL DEFAULT '' CHECK(length(image_path) <= 500 AND (image_path = '' OR image_path ~ '^/assets/[a-zA-Z0-9/_ .-]+$')),
 allowed_weights jsonb NOT NULL DEFAULT '[500,1000,1500,2000]',
 preparations jsonb NOT NULL DEFAULT '[{"name":"Whole"}]',
 is_active boolean NOT NULL DEFAULT true,
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,category_id) REFERENCES app.categories(business_id,id),
 CHECK(app.valid_product_configuration(allowed_weights,preparations))
);
CREATE TABLE app.product_store_settings (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 business_id uuid NOT NULL,
 store_id uuid NOT NULL,
 product_id uuid NOT NULL,
 available boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
 UNIQUE(business_id,id), UNIQUE(business_id,store_id,product_id),
 FOREIGN KEY(business_id,store_id) REFERENCES app.stores(business_id,id),
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id)
);
CREATE TABLE app.product_prices (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 business_id uuid NOT NULL,
 offering_id uuid NOT NULL,
 price_per_kg_paise bigint NOT NULL CHECK(price_per_kg_paise BETWEEN 1 AND 100000000),
 offering_version integer NOT NULL,
 effective_from timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 created_by uuid NOT NULL,
 FOREIGN KEY(business_id,offering_id) REFERENCES app.product_store_settings(business_id,id),
 FOREIGN KEY(business_id,created_by) REFERENCES app.staff_profiles(business_id,id),
 UNIQUE(offering_id,offering_version)
);
CREATE INDEX product_prices_current_idx ON app.product_prices(offering_id,offering_version DESC);
CREATE TABLE app.staff_access_audit (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 actor_id uuid NOT NULL,
 action text NOT NULL,
 target_id uuid NOT NULL,
 detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 FOREIGN KEY(business_id,actor_id) REFERENCES app.staff_profiles(business_id,id)
);
CREATE FUNCTION app.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN RAISE EXCEPTION 'History is immutable' USING ERRCODE = '42501'; END;
$fn$;
CREATE TRIGGER prices_immutable BEFORE UPDATE OR DELETE ON app.product_prices FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER access_audit_immutable BEFORE UPDATE OR DELETE ON app.staff_access_audit FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();

CREATE FUNCTION api.staff_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 RETURN jsonb_build_object('id',actor.id,'businessId',actor.business_id,'role',app.current_staff_role(),'name',actor.display_name,
 'stores',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.name)
 FROM app.stores s WHERE app.can_access_store(s.business_id,s.id)), '[]'::jsonb));
END;
$fn$;
CREATE FUNCTION api.daily_products(target_store uuid) RETURNS jsonb
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
 WHERE o.business_id=actor.business_id AND o.store_id=target_store AND p.is_active AND c.is_active), '[]'::jsonb);
END;
$fn$;
CREATE FUNCTION api.update_daily_product(offering uuid, expected_version integer, price_paise bigint, is_available boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; old_row app.product_store_settings; old_price bigint;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 IF price_paise IS NULL OR price_paise NOT BETWEEN 1 AND 100000000 OR is_available IS NULL OR expected_version IS NULL THEN
 RAISE EXCEPTION 'Invalid daily product values' USING ERRCODE='22023'; END IF;
 SELECT o.* INTO old_row FROM app.product_store_settings o JOIN app.products p ON p.id=o.product_id JOIN app.categories c ON c.id=p.category_id
 WHERE o.id=offering AND o.business_id=actor.business_id AND p.is_active AND c.is_active FOR UPDATE OF o;
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
CREATE FUNCTION api.catalogue_master() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN']);
 RETURN jsonb_build_object('categories',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.sort_order,c.name) FROM app.categories c WHERE c.business_id=actor.business_id),'[]'::jsonb),
 'products',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name) FROM app.products p WHERE p.business_id=actor.business_id),'[]'::jsonb));
END;
$fn$;
CREATE FUNCTION api.save_category(target_id uuid, category_name text, parent uuid, sort integer, active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; result uuid;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN']);
 -- Serialize category hierarchy changes; prevent indirect cycles.
 PERFORM 1 FROM app.businesses WHERE id=actor.business_id FOR UPDATE;
 IF parent IS NOT NULL AND (parent=target_id OR NOT EXISTS(SELECT 1 FROM app.categories WHERE id=parent AND business_id=actor.business_id)) THEN RAISE EXCEPTION 'Invalid parent'; END IF;
 IF target_id IS NOT NULL AND EXISTS (
 WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM app.categories WHERE id=parent AND business_id=actor.business_id
 UNION SELECT c.id,c.parent_id FROM app.categories c JOIN ancestors a ON c.id=a.parent_id)
 SELECT 1 FROM ancestors WHERE id=target_id) THEN RAISE EXCEPTION 'Category cycle'; END IF;
 IF target_id IS NULL THEN
 INSERT INTO app.categories(business_id,name,parent_id,sort_order,is_active) VALUES(actor.business_id,btrim(category_name),parent,sort,active) RETURNING id INTO result;
 ELSE UPDATE app.categories SET name=btrim(category_name),parent_id=parent,sort_order=sort,is_active=active WHERE id=target_id AND business_id=actor.business_id RETURNING id INTO result;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'CATEGORY_SAVED',result,jsonb_build_object('active',active));
 RETURN result;
END;
$fn$;
CREATE FUNCTION api.save_product(target_id uuid, category uuid, product_name text, local_name text, description text, image_path text, weights jsonb, preparation_choices jsonb, active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; result uuid;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN']);
 IF target_id IS NULL THEN
 INSERT INTO app.products(business_id,category_id,name,local_name,description,image_path,allowed_weights,preparations,is_active)
 VALUES(actor.business_id,category,btrim(product_name),local_name,description,image_path,weights,preparation_choices,active) RETURNING id INTO result;
 ELSE UPDATE app.products p SET category_id=category,name=btrim(product_name),local_name=save_product.local_name,description=save_product.description,
 image_path=save_product.image_path,allowed_weights=weights,preparations=preparation_choices,is_active=active
 WHERE p.id=target_id AND p.business_id=actor.business_id RETURNING p.id INTO result;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'PRODUCT_SAVED',result,jsonb_build_object('active',active));
 RETURN result;
END;
$fn$;
CREATE FUNCTION api.create_offering(product uuid, target_store uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; result uuid;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.product_store_settings(business_id,store_id,product_id) VALUES(actor.business_id,target_store,product) RETURNING id INTO result;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'OFFERING_CREATED',result,'{}');
 RETURN result;
END;
$fn$;
CREATE FUNCTION api.employee_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.display_name,'active',sp.is_active) ORDER BY sp.display_name)
 FROM app.staff_profiles sp WHERE sp.business_id=actor.business_id AND sp.role='EMPLOYEE'
 AND NOT EXISTS(SELECT 1 FROM app.staff_admin_grants g WHERE g.staff_profile_id=sp.id AND g.is_active)), '[]'::jsonb);
END;
$fn$;
CREATE FUNCTION api.set_employee_access(employee uuid, active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles; target app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 SELECT * INTO target FROM app.staff_profiles WHERE id=employee AND business_id=actor.business_id FOR UPDATE;
 IF target.id IS NULL OR target.role <> 'EMPLOYEE' OR target.auth_user_id IS NULL OR active IS NULL
 OR EXISTS(SELECT 1 FROM app.staff_admin_grants WHERE staff_profile_id=employee AND is_active)
 THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 UPDATE app.staff_profiles SET is_active=active,disabled_at=CASE WHEN active THEN NULL ELSE pg_catalog.clock_timestamp() END,
 disabled_by=CASE WHEN active THEN NULL ELSE actor.id END WHERE id=employee;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'EMPLOYEE_ACCESS',employee,jsonb_build_object('active',active));
END;
$fn$;
CREATE FUNCTION api.store_operations(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('name',name,'delivery',delivery_enabled,'pickup',pickup_enabled,'hours',opening_hours) FROM app.stores WHERE id=target_store);
END;
$fn$;
CREATE FUNCTION api.save_store_operations(target_store uuid, store_name text, delivery boolean, pickup boolean, hours jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor := app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 UPDATE app.stores SET name=store_name,delivery_enabled=delivery,pickup_enabled=pickup,opening_hours=hours WHERE id=target_store AND business_id=actor.business_id;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'STORE_OPERATIONS',target_store,jsonb_build_object('delivery',delivery,'pickup',pickup));
END;
$fn$;

-- Default deny. No direct table/column DML or service-role escape hatch.
ALTER TABLE app.staff_admin_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_admin_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE app.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.categories FORCE ROW LEVEL SECURITY;
ALTER TABLE app.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.products FORCE ROW LEVEL SECURITY;
ALTER TABLE app.product_store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_store_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE app.product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE app.staff_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_access_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA app,api FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app,api FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app,api FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SCHEMA app,api FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA api TO authenticated;
GRANT EXECUTE ON FUNCTION
 api.staff_context(), api.daily_products(uuid), api.update_daily_product(uuid,integer,bigint,boolean),
 api.catalogue_master(), api.save_category(uuid,text,uuid,integer,boolean),
 api.save_product(uuid,uuid,text,text,text,text,jsonb,jsonb,boolean), api.create_offering(uuid,uuid),
 api.employee_access(),api.set_employee_access(uuid,boolean),
 api.store_operations(uuid),api.save_store_operations(uuid,text,boolean,boolean,jsonb)
TO authenticated;
COMMIT;
