-- Staff dashboard summary. Forward-only; no existing migration edited. Read-only: no tables, policies or grants on tables change.
-- api.admin_dashboard: one role-checked read. EMPLOYEE gets only "needs action" counts and today's slots (no money);
-- ADMIN/OWNER also get period cards with change vs the previous period, low stock, top products and the last orders.
-- Periods use IST calendar days. "Today" and the rolling periods end now and compare with the same elapsed span before.
-- api.order_queue_page gains an optional status filter (same checks and employee history window) so dashboard counts open a filtered Orders list.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE FUNCTION api.admin_dashboard(target_store uuid,period text DEFAULT 'today') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; staff_role text; history_days integer;
 day_start timestamptz; span interval; from_at timestamptz; until_at timestamptz;
 needs jsonb; slots jsonb;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF period IS NULL OR period NOT IN ('today','yesterday','7d','30d') THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
 staff_role:=app.current_staff_role();
 SELECT employee_operational_history_days INTO history_days FROM app.business_settings WHERE business_id=actor.business_id;
 day_start:=(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata';

 -- Open orders by status; employees count only what their Orders list shows.
 SELECT jsonb_object_agg(s.status,(SELECT count(*) FROM app.orders o WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.status=s.status
  AND (staff_role<>'EMPLOYEE' OR o.created_at>=statement_timestamp()-make_interval(days=>history_days))))
 INTO needs FROM unnest(ARRAY['PLACED','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY']) s(status);

 -- Today's non-cancelled orders by IST time band (customers do not choose slots), split by delivery and pickup.
 SELECT jsonb_agg(to_jsonb(t)-'ord' ORDER BY t.ord) INTO slots FROM (SELECT b.ord,b.slot,
  count(o.id) FILTER(WHERE o.fulfillment_method='HOME_DELIVERY') AS delivery,
  count(o.id) FILTER(WHERE o.fulfillment_method='STORE_PICKUP') AS pickup,
  count(o.id) FILTER(WHERE o.status<>'DELIVERED') AS open
 FROM (VALUES (1,'MORNING',0,12),(2,'AFTERNOON',12,16),(3,'EVENING',16,24)) b(ord,slot,from_hour,until_hour)
 LEFT JOIN app.orders o ON o.business_id=actor.business_id AND o.store_id=target_store AND o.status<>'CANCELLED'
  AND o.created_at>=day_start AND o.created_at<day_start+interval '1 day'
  AND extract(hour FROM o.created_at AT TIME ZONE 'Asia/Kolkata')>=b.from_hour AND extract(hour FROM o.created_at AT TIME ZONE 'Asia/Kolkata')<b.until_hour
  AND (staff_role<>'EMPLOYEE' OR o.created_at>=statement_timestamp()-make_interval(days=>history_days))
 GROUP BY b.ord,b.slot) t;

 IF staff_role='EMPLOYEE' THEN RETURN jsonb_build_object('needsAction',needs,'slots',slots); END IF;

 span:=CASE period WHEN '7d' THEN interval '7 days' WHEN '30d' THEN interval '30 days' ELSE interval '1 day' END;
 from_at:=CASE period WHEN 'yesterday' THEN day_start-interval '1 day' ELSE day_start+interval '1 day'-span END;
 until_at:=CASE period WHEN 'yesterday' THEN day_start ELSE statement_timestamp() END;

 RETURN jsonb_build_object('needsAction',needs,'slots',slots,'period',period,'from',from_at,'until',until_at,
 -- Revenue and averages exclude cancelled orders; money uses each order's latest payment attempt.
 'summary',(WITH w(name,f,u) AS (VALUES ('current',from_at,until_at),('previous',from_at-span,until_at-span)),
  o AS (SELECT w.name,o.id,o.total_paise,p.method,p.status AS pay_status,p.amount_paise,p.refunded_paise FROM w
   LEFT JOIN app.orders o ON o.business_id=actor.business_id AND o.store_id=target_store AND o.status<>'CANCELLED' AND o.created_at>=w.f AND o.created_at<w.u
   LEFT JOIN LATERAL (SELECT method,status,amount_paise,refunded_paise FROM app.payments WHERE business_id=actor.business_id AND order_id=o.id ORDER BY attempt_number DESC LIMIT 1) p ON true)
  SELECT jsonb_object_agg(name,jsonb_build_object('orders',n,'revenuePaise',revenue,'averagePaise',CASE WHEN n>0 THEN round(revenue::numeric/n) ELSE 0 END,
   'collectedPaise',collected,'cashCollectedPaise',cash,'pendingPaise',pending))
  FROM (SELECT name,count(id) AS n,COALESCE(sum(total_paise),0) AS revenue,
   COALESCE(sum(amount_paise-refunded_paise) FILTER(WHERE pay_status IN ('PAID','REFUNDED')),0) AS collected,
   COALESCE(sum(amount_paise-refunded_paise) FILTER(WHERE pay_status IN ('PAID','REFUNDED') AND method='CASH'),0) AS cash,
   COALESCE(sum(amount_paise) FILTER(WHERE pay_status IN ('PENDING','VERIFYING','FAILED')),0) AS pending
   FROM o GROUP BY name) t),
 -- Same "low" line as the storefront's "Only X left": at most 2 kg, or at most 2 units/trays; 0 is sold out.
 'lowStock',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.name,'onHand',k.on_hand,'measure',k.measure,'pricingBasis',p.pricing_basis) ORDER BY k.on_hand::numeric/CASE k.measure WHEN 'GRAMS' THEN 2000 ELSE 2 END,p.name)
  FROM app.offering_stock k JOIN app.product_store_settings s ON s.business_id=k.business_id AND s.id=k.offering_id JOIN app.products p ON p.business_id=s.business_id AND p.id=s.product_id
  WHERE k.business_id=actor.business_id AND k.store_id=target_store AND s.available AND p.is_active AND k.on_hand IS NOT NULL
   AND k.on_hand<=CASE k.measure WHEN 'GRAMS' THEN 2000 ELSE 2 END),'[]'::jsonb),
 'topProducts',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q."revenuePaise" DESC,q.name) FROM
  (SELECT max(i.product_snapshot->>'productName') AS name,count(DISTINCT i.order_id) AS orders,sum(i.line_total_paise) AS "revenuePaise"
   FROM app.order_items i JOIN app.orders o ON o.business_id=i.business_id AND o.id=i.order_id
   WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.status<>'CANCELLED' AND o.created_at>=from_at AND o.created_at<until_at
   GROUP BY i.product_id ORDER BY sum(i.line_total_paise) DESC,max(i.product_snapshot->>'productName') LIMIT 5) q),'[]'::jsonb),
 'recentOrders',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id DESC) FROM
  (SELECT id,order_number,status,fulfillment_method,total_paise,created_at,fulfillment_snapshot->>'name' AS customer FROM app.orders
   WHERE business_id=actor.business_id AND store_id=target_store ORDER BY created_at DESC,id DESC LIMIT 5) q),'[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION api.admin_dashboard(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.admin_dashboard(uuid,text) TO authenticated;
COMMENT ON FUNCTION api.admin_dashboard(uuid,text) IS 'Read-only staff dashboard. EMPLOYEE: open-order counts and today''s slots only. ADMIN/OWNER: plus money cards, low stock, top products, recent orders.';

-- Replaced (not overloaded) so PostgREST calls with four named arguments still resolve to one function.
DROP FUNCTION api.order_queue_page(uuid,integer,timestamptz,uuid);
CREATE FUNCTION api.order_queue_page(target_store uuid,row_limit integer DEFAULT 50,before_time timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL,status_filter text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; history_days integer;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER','EMPLOYEE']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF row_limit IS NULL OR row_limit NOT BETWEEN 1 AND 100 OR (before_time IS NULL)<>(before_id IS NULL) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 IF status_filter IS NOT NULL AND status_filter NOT IN ('PLACED','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
 SELECT employee_operational_history_days INTO history_days FROM app.business_settings WHERE business_id=actor.business_id;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id DESC) FROM
 (SELECT id,order_number,status,fulfillment_method,payment_method,total_paise,version,created_at FROM app.orders
 WHERE business_id=actor.business_id AND store_id=target_store AND (before_time IS NULL OR (created_at,id)<(before_time,before_id))
 AND (status_filter IS NULL OR status=status_filter)
 AND (app.current_staff_role()<>'EMPLOYEE' OR created_at>=statement_timestamp()-make_interval(days=>history_days))
 ORDER BY created_at DESC,id DESC LIMIT row_limit) q),'[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION api.order_queue_page(uuid,integer,timestamptz,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.order_queue_page(uuid,integer,timestamptz,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
