BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Orders page search: by order number (e.g. "TFM-000016" or "16"), customer phone (4+ digits) or customer name.
-- Same visibility as api.order_queue_page: store access is checked, and an EMPLOYEE sees only the configured
-- recent history. Read-only; no grant or RLS change. Newest first, at most 25 rows, same row shape as the queue.
CREATE FUNCTION api.order_search(target_store uuid,search_text text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; history_days integer; term text:=btrim(search_text); pattern text; digits text;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF term IS NULL OR length(term) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023'; END IF;
 -- Typed text is matched literally: LIKE wildcards are escaped.
 pattern:='%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%';
 digits:=regexp_replace(term,'\D','','g');
 SELECT employee_operational_history_days INTO history_days FROM app.business_settings WHERE business_id=actor.business_id;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id DESC) FROM
 (SELECT id,order_number,status,fulfillment_method,payment_method,total_paise,version,created_at,delivery_date,fulfillment_snapshot->'slot' AS slot FROM app.orders
 WHERE business_id=actor.business_id AND store_id=target_store
 AND (order_number ILIKE pattern
  OR (length(digits)>=4 AND fulfillment_snapshot->>'mobileE164' LIKE '%'||digits||'%')
  OR fulfillment_snapshot->>'name' ILIKE pattern)
 AND (app.current_staff_role()<>'EMPLOYEE' OR created_at>=statement_timestamp()-make_interval(days=>history_days))
 ORDER BY created_at DESC,id DESC LIMIT 25) q),'[]'::jsonb);
END $fn$;

REVOKE ALL ON FUNCTION api.order_search(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION api.order_search(uuid,text) TO authenticated;
COMMIT;
