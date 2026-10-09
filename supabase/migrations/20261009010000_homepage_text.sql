BEGIN;
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
NOTIFY pgrst,'reload schema';
COMMIT;
