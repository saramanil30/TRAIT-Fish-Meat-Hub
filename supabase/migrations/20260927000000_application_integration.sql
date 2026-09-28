BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE FUNCTION api.business_policy() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 RETURN (SELECT to_jsonb(s)-ARRAY['id','business_id','created_at','updated_at'] FROM app.business_settings s WHERE business_id=actor.business_id);
END $fn$;
CREATE FUNCTION api.save_business_policy(expected_revision bigint, history_days integer, cash_limit bigint, payment_required boolean, item_limit integer, total_limit bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; current_revision bigint;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 PERFORM id FROM app.businesses WHERE id=actor.business_id FOR UPDATE;
 SELECT revision INTO current_revision FROM app.business_settings WHERE business_id=actor.business_id FOR UPDATE;
 IF expected_revision IS DISTINCT FROM COALESCE(current_revision,0) THEN RAISE EXCEPTION 'Stale policy' USING ERRCODE='40001'; END IF;
 INSERT INTO app.business_settings(business_id,employee_operational_history_days,employee_cash_collection_limit_paise,require_payment_before_completion,max_order_items,max_order_total_paise)
 VALUES(actor.business_id,history_days,cash_limit,payment_required,item_limit,total_limit)
 ON CONFLICT(business_id) DO UPDATE SET employee_operational_history_days=excluded.employee_operational_history_days,
 employee_cash_collection_limit_paise=excluded.employee_cash_collection_limit_paise,require_payment_before_completion=excluded.require_payment_before_completion,
 max_order_items=excluded.max_order_items,max_order_total_paise=excluded.max_order_total_paise;
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail)
 VALUES(actor.business_id,actor.id,'BUSINESS_POLICY',actor.business_id,jsonb_build_object('previousRevision',current_revision,'historyDays',history_days,'cashLimit',cash_limit,'paymentRequired',payment_required,'itemLimit',item_limit,'totalLimit',total_limit));
END $fn$;

CREATE FUNCTION api.provision_staff(auth_identity uuid, staff_name text, staff_role text, assigned_store uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; result uuid;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF staff_role IS NULL OR staff_role NOT IN ('OWNER','EMPLOYEE') OR (staff_role='OWNER' AND app.current_staff_role()<>'ADMIN')
 THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF assigned_store IS NULL OR NOT app.can_access_store(actor.business_id,assigned_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO app.staff_profiles(business_id,auth_user_id,display_name,role) VALUES(actor.business_id,auth_identity,staff_name,staff_role) RETURNING id INTO result;
 INSERT INTO app.staff_store_assignments(business_id,staff_profile_id,store_id) VALUES(actor.business_id,result,assigned_store);
 INSERT INTO app.staff_access_audit(business_id,actor_id,action,target_id,detail) VALUES(actor.business_id,actor.id,'STAFF_PROVISIONED',result,jsonb_build_object('role',staff_role,'storeId',assigned_store));
 RETURN result;
END $fn$;
CREATE FUNCTION api.integration_report(target_store uuid, from_date timestamptz, until_date timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF from_date IS NULL OR until_date IS NULL OR until_date<=from_date OR until_date-from_date>interval '366 days' THEN RAISE EXCEPTION 'Invalid interval' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('orders',(SELECT jsonb_build_object('count',count(*),'intakePaise',COALESCE(sum(total_paise),0),'fulfilledPaise',COALESCE(sum(total_paise) FILTER(WHERE status='DELIVERED'),0),'cancelled',count(*) FILTER(WHERE status='CANCELLED')) FROM app.orders WHERE business_id=actor.business_id AND store_id=target_store AND created_at>=from_date AND created_at<until_date),
 'payments',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT p.method,p.status,count(*) AS count,sum(p.amount_paise) AS "amountPaise",sum(p.refunded_paise) AS "refundedPaise" FROM app.payments p JOIN app.orders o ON o.id=p.order_id WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.created_at>=from_date AND o.created_at<until_date GROUP BY p.method,p.status) q),'[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION api.business_policy(),api.save_business_policy(bigint,integer,bigint,boolean,integer,bigint),api.provision_staff(uuid,text,text,uuid),api.integration_report(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.business_policy(),api.save_business_policy(bigint,integer,bigint,boolean,integer,bigint),api.provision_staff(uuid,text,text,uuid),api.integration_report(uuid,timestamptz,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
