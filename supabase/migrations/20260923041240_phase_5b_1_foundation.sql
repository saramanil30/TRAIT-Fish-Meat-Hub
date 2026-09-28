-- Phase 5B.1 only. Execute as postgres in one transaction after review.
-- No data, API endpoints, role memberships, or managed-schema changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF CURRENT_USER <> 'postgres' THEN
    RAISE EXCEPTION 'Run this migration as postgres; ownership/default ACLs are explicit';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname IN ('app', 'api')) THEN
    RAISE EXCEPTION 'Expected absent app/api schemas; inspect existing objects before proceeding';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER AND rolbypassrls) THEN
    RAISE EXCEPTION 'Expected reviewed postgres BYPASSRLS capability for private authorization helpers';
  END IF;
END;
$preflight$;

CREATE SCHEMA app AUTHORIZATION postgres;
CREATE SCHEMA api AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;

-- Scoped to TRAIT schemas and their explicit creator, never managed schemas.
-- Per-schema defaults cannot undo global defaults (including PUBLIC EXECUTE).
-- Consequently EVERY migration must revoke object ACLs before COMMIT as below.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app, api
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app, api
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app, api
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- Missing day = closed. Up to four sorted, nonoverlapping same-day intervals.
-- Overnight opening is represented by intervals on the two respective days.
CREATE FUNCTION app.valid_opening_hours(value jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  day_entry record;
  slot jsonb;
  opens text;
  closes text;
  previous_close text;
BEGIN
  IF value IS NULL OR pg_catalog.jsonb_typeof(value) <> 'object'
     OR pg_catalog.octet_length(value::text) > 8192 THEN
    RETURN false;
  END IF;
  FOR day_entry IN SELECT key, val FROM pg_catalog.jsonb_each(value) AS d(key, val) LOOP
    IF day_entry.key NOT IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
       OR pg_catalog.jsonb_typeof(day_entry.val) <> 'array' THEN
      RETURN false;
    END IF;
    IF pg_catalog.jsonb_array_length(day_entry.val) > 4 THEN RETURN false; END IF;
    previous_close := NULL;
    FOR slot IN SELECT v FROM pg_catalog.jsonb_array_elements(day_entry.val) AS s(v) LOOP
      IF pg_catalog.jsonb_typeof(slot) <> 'object' THEN RETURN false; END IF;
      IF NOT (slot ? 'opens' AND slot ? 'closes')
         OR (slot - 'opens' - 'closes') <> '{}'::jsonb
         OR pg_catalog.jsonb_typeof(slot -> 'opens') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(slot -> 'closes') IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;
      opens := slot ->> 'opens';
      closes := slot ->> 'closes';
      IF opens !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR closes !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
         OR opens COLLATE pg_catalog."C" >= closes COLLATE pg_catalog."C"
         OR (previous_close IS NOT NULL AND opens COLLATE pg_catalog."C" < previous_close COLLATE pg_catalog."C") THEN
        RETURN false;
      END IF;
      previous_close := closes;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$function$;

CREATE TABLE app.businesses (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (pg_catalog.length(slug) BETWEEN 1 AND 63 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_name text NOT NULL CHECK (pg_catalog.length(display_name) BETWEEN 1 AND 160 AND display_name = pg_catalog.btrim(display_name) AND display_name ~ '[^[:space:]]'),
  legal_name text CHECK (pg_catalog.length(legal_name) BETWEEN 1 AND 240 AND legal_name = pg_catalog.btrim(legal_name) AND legal_name ~ '[^[:space:]]'),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT businesses_retirement CHECK (deleted_at IS NULL OR NOT is_active),
  CONSTRAINT businesses_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE app.stores (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES app.businesses(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  code text NOT NULL CHECK (pg_catalog.length(code) BETWEEN 1 AND 32 AND code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (pg_catalog.length(name) BETWEEN 1 AND 160 AND name = pg_catalog.btrim(name) AND name ~ '[^[:space:]]'),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (pg_catalog.length(timezone) BETWEEN 1 AND 100 AND timezone = pg_catalog.btrim(timezone)),
  address_line1 text NOT NULL CHECK (pg_catalog.length(address_line1) BETWEEN 1 AND 240 AND address_line1 = pg_catalog.btrim(address_line1) AND address_line1 ~ '[^[:space:]]'),
  address_line2 text CHECK (pg_catalog.length(address_line2) BETWEEN 1 AND 240 AND address_line2 = pg_catalog.btrim(address_line2) AND address_line2 ~ '[^[:space:]]'),
  locality text CHECK (pg_catalog.length(locality) BETWEEN 1 AND 120 AND locality = pg_catalog.btrim(locality) AND locality ~ '[^[:space:]]'),
  city text NOT NULL CHECK (pg_catalog.length(city) BETWEEN 1 AND 120 AND city = pg_catalog.btrim(city) AND city ~ '[^[:space:]]'),
  state text NOT NULL CHECK (pg_catalog.length(state) BETWEEN 1 AND 120 AND state = pg_catalog.btrim(state) AND state ~ '[^[:space:]]'),
  country_code text NOT NULL DEFAULT 'IN' CHECK (country_code = 'IN'),
  pincode text CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  contact_mobile_e164 text CHECK (contact_mobile_e164 ~ '^\+91[6-9][0-9]{9}$'),
  opening_hours jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (app.valid_opening_hours(opening_hours)),
  delivery_enabled boolean NOT NULL DEFAULT false,
  pickup_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT stores_business_code_key UNIQUE (business_id, code),
  CONSTRAINT stores_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT stores_retirement CHECK (deleted_at IS NULL OR NOT is_active),
  CONSTRAINT stores_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE app.business_settings (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES app.businesses(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  employee_operational_history_days integer NOT NULL CHECK (employee_operational_history_days BETWEEN 1 AND 365),
  employee_cash_collection_limit_paise bigint CHECK (employee_cash_collection_limit_paise BETWEEN 1 AND 1000000000000),
  require_payment_before_completion boolean NOT NULL,
  max_order_items integer NOT NULL CHECK (max_order_items BETWEEN 1 AND 500),
  max_order_total_paise bigint NOT NULL CHECK (max_order_total_paise BETWEEN 1 AND 1000000000000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT business_settings_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE app.staff_profiles (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES app.businesses(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  auth_user_id uuid REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (pg_catalog.length(display_name) BETWEEN 1 AND 160 AND display_name = pg_catalog.btrim(display_name) AND display_name ~ '[^[:space:]]'),
  role text NOT NULL CHECK (role IN ('OWNER', 'EMPLOYEE')),
  is_active boolean NOT NULL DEFAULT true,
  disabled_at timestamptz,
  disabled_by uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT staff_profiles_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT staff_profiles_disabled_by_fkey FOREIGN KEY (business_id, disabled_by)
    REFERENCES app.staff_profiles(business_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT staff_profiles_lifecycle CHECK (
    (is_active AND auth_user_id IS NOT NULL AND disabled_at IS NULL AND disabled_by IS NULL)
    OR (NOT is_active AND disabled_at IS NOT NULL)
  ),
  CONSTRAINT staff_profiles_timestamps CHECK (updated_at >= created_at)
);
-- One Auth identity belongs to at most one staff profile, including disabled ones.
CREATE UNIQUE INDEX staff_profiles_auth_user_key ON app.staff_profiles(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX staff_profiles_disabled_by_idx ON app.staff_profiles(business_id, disabled_by) WHERE disabled_by IS NOT NULL;
CREATE INDEX staff_profiles_active_owner_idx ON app.staff_profiles(business_id, id) WHERE is_active AND role = 'OWNER';

CREATE TABLE app.staff_store_assignments (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES app.businesses(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  store_id uuid NOT NULL,
  staff_profile_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT staff_store_assignments_store_fkey FOREIGN KEY (business_id, store_id)
    REFERENCES app.stores(business_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT staff_store_assignments_staff_fkey FOREIGN KEY (business_id, staff_profile_id)
    REFERENCES app.staff_profiles(business_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT staff_store_assignments_staff_store_key UNIQUE (business_id, staff_profile_id, store_id),
  CONSTRAINT staff_store_assignments_timestamps CHECK (updated_at >= created_at)
);
CREATE INDEX staff_store_assignments_store_idx ON app.staff_store_assignments(business_id, store_id);

-- Small shared trigger only for the common five-table lifecycle contract.
CREATE FUNCTION app.guard_row_lifecycle()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Hard deletion is forbidden; retire or deactivate this record' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    NEW.created_at := pg_catalog.statement_timestamp();
    NEW.updated_at := NEW.created_at;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Internal identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME <> 'businesses' THEN
      IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        RAISE EXCEPTION 'Business identity is immutable' USING ERRCODE = '23514';
      END IF;
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := GREATEST(OLD.updated_at, pg_catalog.statement_timestamp());
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION app.guard_store_timezone()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS z WHERE z.name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION app.guard_settings_revision()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.revision := 1;
  ELSE NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$function$;

-- Conservative last-owner foundation: no active OWNER can lose authority yet.
-- This has no count/read race. A later admin migration must replace it with a
-- serialized, concurrency-tested last-owner invariant before allowing retirement.
-- Adding/promoting a second OWNER is allowed now. The later admin migration must
-- atomically replace this guard, not bypass it via caller-set session variables.
CREATE FUNCTION app.guard_staff_authority()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.is_active AND OLD.role = 'OWNER' AND (
    NOT NEW.is_active OR NEW.role <> 'OWNER'
    OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
    OR NEW.disabled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Active OWNER removal is locked until the reviewed admin mutation phase' USING ERRCODE = '23514';
  END IF;
  IF OLD.auth_user_id IS NOT NULL AND NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     AND (NEW.auth_user_id IS NOT NULL OR NEW.is_active) THEN
    RAISE EXCEPTION 'Auth identity may only be unlinked from an inactive profile' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION app.guard_assignment_identity()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.staff_profile_id IS DISTINCT FROM OLD.staff_profile_id THEN
    RAISE EXCEPTION 'Assignment identity is immutable; deactivate it instead' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER businesses_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.businesses
  FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER stores_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.stores
  FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER stores_timezone BEFORE INSERT OR UPDATE ON app.stores
  FOR EACH ROW EXECUTE FUNCTION app.guard_store_timezone();
CREATE TRIGGER business_settings_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.business_settings
  FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER business_settings_revision BEFORE INSERT OR UPDATE ON app.business_settings
  FOR EACH ROW EXECUTE FUNCTION app.guard_settings_revision();
CREATE TRIGGER staff_profiles_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER staff_profiles_authority BEFORE UPDATE ON app.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION app.guard_staff_authority();
CREATE TRIGGER staff_store_assignments_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app.staff_store_assignments
  FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle();
CREATE TRIGGER staff_store_assignments_identity BEFORE UPDATE ON app.staff_store_assignments
  FOR EACH ROW EXECUTE FUNCTION app.guard_assignment_identity();

-- Private scalar authorization boundary. Each helper queries tables denied to
-- normal callers, so INVOKER would fail on ACLs or see zero rows under forced RLS.
-- DEFINER uses the preflight-checked postgres owner with BYPASSRLS. No dynamic SQL,
-- actor parameters, rowsets, or browser EXECUTE. All referenced objects are qualified.
-- Future named entry points must explicitly authorize, preserve verified auth.uid(),
-- and receive reviewed execution/table capabilities; these helpers do not grant DML.
-- No policy calls these functions, avoiding recursive RLS.
-- auth.uid() reads request context; it does NOT itself verify a JWT.
CREATE FUNCTION app.current_staff_profile_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT sp.id
  FROM app.staff_profiles AS sp
  JOIN app.businesses AS b ON b.id = sp.business_id
  WHERE sp.auth_user_id = (SELECT auth.uid())
    AND sp.is_active AND sp.disabled_at IS NULL
    AND b.is_active AND b.deleted_at IS NULL
$function$;

CREATE FUNCTION app.is_business_owner(target_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app.staff_profiles AS sp
    WHERE sp.id = app.current_staff_profile_id()
      AND sp.business_id = target_business_id AND sp.role = 'OWNER'
  )
$function$;

CREATE FUNCTION app.is_store_employee(target_business_id uuid, target_store_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM app.staff_profiles AS sp
    JOIN app.staff_store_assignments AS a
      ON a.business_id = sp.business_id AND a.staff_profile_id = sp.id
    JOIN app.stores AS s ON s.business_id = a.business_id AND s.id = a.store_id
    WHERE sp.id = app.current_staff_profile_id() AND sp.role = 'EMPLOYEE'
      AND sp.business_id = target_business_id AND s.id = target_store_id
      AND a.is_active AND s.is_active AND s.deleted_at IS NULL
  )
$function$;

CREATE FUNCTION app.can_access_store(target_business_id uuid, target_store_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app.stores AS s
    WHERE s.business_id = target_business_id AND s.id = target_store_id
      AND s.is_active AND s.deleted_at IS NULL
      AND (app.is_business_owner(target_business_id)
        OR app.is_store_employee(target_business_id, target_store_id))
  )
$function$;

ALTER TABLE app.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.businesses FORCE ROW LEVEL SECURITY;
ALTER TABLE app.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stores FORCE ROW LEVEL SECURITY;
ALTER TABLE app.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.business_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE app.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE app.staff_store_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_store_assignments FORCE ROW LEVEL SECURITY;
-- Intentionally zero policies: fail closed for all non-BYPASSRLS roles.
-- service_role bypasses RLS but receives no schema/table/function privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  app.valid_opening_hours(jsonb),
  app.guard_row_lifecycle(),
  app.guard_store_timezone(),
  app.guard_settings_revision(),
  app.guard_staff_authority(),
  app.guard_assignment_identity(),
  app.current_staff_profile_id(),
  app.is_business_owner(uuid),
  app.is_store_employee(uuid, uuid),
  app.can_access_store(uuid, uuid)
TO postgres;

-- Repeat schema revocation after all DDL, then verify effective privileges and
-- ownership before committing. These checks also catch inherited grants and
-- unexpected hosted event-trigger effects. No global/default role changes.
REVOKE ALL ON SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;
DO $security_assertions$
DECLARE
  object_row record;
  caller_row record;
BEGIN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r') <> 5 THEN
    RAISE EXCEPTION 'Expected exactly five application tables';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('app', 'api') AND c.relkind IN ('r', 'p')
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
        OR pg_catalog.pg_get_userbyid(c.relowner) <> 'postgres')
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('app', 'api')
  ) THEN
    RAISE EXCEPTION 'Unexpected table ownership, RLS state or policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('app', 'api')
      AND pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace AS n
    WHERE n.nspname IN ('app', 'api')
      AND pg_catalog.pg_get_userbyid(n.nspowner) <> 'postgres'
  ) THEN
    RAISE EXCEPTION 'Unexpected schema or function owner';
  END IF;
  FOR caller_row IN SELECT oid, rolname FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    IF pg_catalog.pg_has_role(caller_row.oid, 'postgres', 'MEMBER')
       OR pg_catalog.has_schema_privilege(caller_row.oid, 'app', 'USAGE,CREATE')
       OR pg_catalog.has_schema_privilege(caller_row.oid, 'api', 'USAGE,CREATE') THEN
      RAISE EXCEPTION 'Unexpected schema/owner capability for %', caller_row.rolname;
    END IF;
    FOR object_row IN
      SELECT c.oid, c.relkind FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('app', 'api') AND c.relkind IN ('r', 'p', 'S')
    LOOP
      IF object_row.relkind = 'S' THEN
        IF pg_catalog.has_sequence_privilege(caller_row.oid, object_row.oid, 'USAGE,SELECT,UPDATE') THEN
          RAISE EXCEPTION 'Unexpected sequence privilege for %', caller_row.rolname;
        END IF;
      ELSIF pg_catalog.has_table_privilege(caller_row.oid, object_row.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR pg_catalog.has_any_column_privilege(caller_row.oid, object_row.oid, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Unexpected table/column privilege for %', caller_row.rolname;
      END IF;
    END LOOP;
    FOR object_row IN
      SELECT p.oid FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('app', 'api')
    LOOP
      IF pg_catalog.has_function_privilege(caller_row.oid, object_row.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Unexpected function execution privilege for %', caller_row.rolname;
      END IF;
    END LOOP;
  END LOOP;
END;
$security_assertions$;

COMMIT;
