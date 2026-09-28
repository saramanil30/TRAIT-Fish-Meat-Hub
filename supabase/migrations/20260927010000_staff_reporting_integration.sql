BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE app.staff_profiles ADD COLUMN integration_version bigint NOT NULL DEFAULT 1 CHECK(integration_version>0);
CREATE FUNCTION app.bump_staff_integration_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN NEW.integration_version:=OLD.integration_version+1; RETURN NEW; END $fn$;
CREATE TRIGGER staff_integration_version BEFORE UPDATE ON app.staff_profiles FOR EACH ROW EXECUTE FUNCTION app.bump_staff_integration_version();
REVOKE ALL ON FUNCTION app.bump_staff_integration_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION api.staff_directory() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'authUserId',s.auth_user_id,'name',s.display_name,'role',CASE WHEN g.is_active THEN 'ADMIN' ELSE s.role END,'active',s.is_active,'version',s.integration_version,'storeIds',COALESCE((SELECT jsonb_agg(a.store_id ORDER BY a.store_id) FROM app.staff_store_assignments a WHERE a.staff_profile_id=s.id AND a.is_active),'[]'::jsonb)) ORDER BY s.display_name,s.id)
 FROM app.staff_profiles s LEFT JOIN app.staff_admin_grants g ON g.staff_profile_id=s.id
 WHERE s.business_id=actor.business_id AND (app.current_staff_role()='ADMIN' OR (s.role='EMPLOYEE' AND NOT COALESCE(g.is_active,false)))),'[]'::jsonb);
END $fn$;
CREATE FUNCTION api.save_staff_profile(target_staff uuid, expected_version bigint, staff_name text, store_ids uuid[], active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; target app.staff_profiles; store uuid;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 SELECT * INTO target FROM app.staff_profiles WHERE id=target_staff AND business_id=actor.business_id FOR UPDATE;
 IF target.id IS NULL OR EXISTS(SELECT 1 FROM app.staff_admin_grants WHERE staff_profile_id=target.id AND is_active)
 OR (target.role='OWNER' AND app.current_staff_role()<>'ADMIN') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF expected_version IS DISTINCT FROM target.integration_version THEN RAISE EXCEPTION 'Stale staff profile' USING ERRCODE='40001'; END IF;
 IF active IS NULL OR store_ids IS NULL OR cardinality(store_ids) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Store assignment required' USING ERRCODE='22023'; END IF;
 FOREACH store IN ARRAY store_ids LOOP
  IF store IS NULL OR NOT app.can_access_store(actor.business_id,store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 END LOOP;
 UPDATE app.staff_profiles SET display_name=btrim(staff_name),is_active=active,disabled_at=CASE WHEN active THEN NULL ELSE clock_timestamp() END,disabled_by=CASE WHEN active THEN NULL ELSE actor.id END WHERE id=target.id;
 UPDATE app.staff_store_assignments SET is_active=false WHERE staff_profile_id=target.id AND is_active AND NOT(store_id=ANY(store_ids));
 FOREACH store IN ARRAY store_ids LOOP
  INSERT INTO app.staff_store_assignments(business_id,staff_profile_id,store_id) VALUES(actor.business_id,target.id,store)
  ON CONFLICT(business_id,staff_profile_id,store_id) DO UPDATE SET is_active=true;
 END LOOP;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'STAFF_PROFILE_UPDATED',target.id,jsonb_build_object('active',active,'storeIds',to_jsonb(store_ids),'previousVersion',expected_version));
END $fn$;
CREATE FUNCTION api.operations_report(target_store uuid, from_date timestamptz, until_date timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF from_date IS NULL OR until_date IS NULL OR until_date<=from_date OR until_date-from_date>interval '366 days' THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object(
 'intake',(SELECT jsonb_build_object('count',count(*),'paise',COALESCE(sum(total_paise),0)) FROM app.orders WHERE business_id=actor.business_id AND store_id=target_store AND created_at>=from_date AND created_at<until_date),
 'fulfillment',(SELECT jsonb_build_object('fulfilledPaise',COALESCE(sum(o.total_paise) FILTER(WHERE h.to_status='DELIVERED'),0),'cancelled',count(*) FILTER(WHERE h.to_status='CANCELLED')) FROM app.order_status_history h JOIN app.orders o ON o.id=h.order_id WHERE o.business_id=actor.business_id AND o.store_id=target_store AND h.created_at>=from_date AND h.created_at<until_date),
 'collections',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT p.method,COALESCE(sum(e.amount_paise) FILTER(WHERE e.refund_id IS NULL AND e.to_status='PAID'),0) AS "collectedPaise",COALESCE(sum(e.amount_paise) FILTER(WHERE e.refund_id IS NOT NULL AND e.to_status='COMPLETED'),0) AS "refundedPaise" FROM app.payment_events e JOIN app.payments p ON p.id=e.payment_id JOIN app.orders o ON o.id=e.order_id WHERE o.business_id=actor.business_id AND o.store_id=target_store AND e.created_at>=from_date AND e.created_at<until_date GROUP BY p.method)q),'[]'::jsonb),
 'balances',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT p.status,count(*) AS count,sum(p.amount_paise) AS "amountPaise" FROM app.payments p JOIN app.orders o ON o.id=p.order_id WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.status<>'CANCELLED' GROUP BY p.status)q),'[]'::jsonb),
 'products',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT i.product_snapshot->>'productName' AS name,i.product_snapshot->>'categoryName' AS category,sum(i.raw_weight_grams) AS grams,sum(i.line_total_paise) AS "intakePaise" FROM app.order_items i JOIN app.orders o ON o.id=i.order_id WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.created_at>=from_date AND o.created_at<until_date GROUP BY i.product_snapshot->>'productName',i.product_snapshot->>'categoryName')q),'[]'::jsonb),
 'activity',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT s.display_name AS name,a.action,count(*) AS count FROM app.audit_logs a JOIN app.staff_profiles s ON s.id=a.actor_id WHERE a.business_id=actor.business_id AND a.store_id=target_store AND a.created_at>=from_date AND a.created_at<until_date GROUP BY s.display_name,a.actor_id,a.action)q),'[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION api.staff_directory(),api.save_staff_profile(uuid,bigint,text,uuid[],boolean),api.operations_report(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.staff_directory(),api.save_staff_profile(uuid,bigint,text,uuid[],boolean),api.operations_report(uuid,timestamptz,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
