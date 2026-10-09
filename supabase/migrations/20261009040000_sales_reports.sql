-- Sales reports for Reports (ADMIN/OWNER). Forward-only; no existing migration edited. Read-only: no tables, policies or grants on tables change.
-- api.sales_report(store, from_day, until_day): IST calendar days, both inclusive, at most 366 days.
-- Orders are the cohort placed in the period; revenue and averages exclude cancelled orders.
-- Day-end cash uses when cash changed hands (CASH_RECEIVED events and completed cash refunds), by staff member.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE FUNCTION api.sales_report(target_store uuid,from_day date,until_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; from_at timestamptz; until_at timestamptz;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF from_day IS NULL OR until_day IS NULL OR until_day<from_day OR until_day-from_day>365 THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
 from_at:=from_day::timestamp AT TIME ZONE 'Asia/Kolkata';
 until_at:=(until_day+1)::timestamp AT TIME ZONE 'Asia/Kolkata';
 RETURN (WITH o AS (
   SELECT o.id,o.order_number,o.status,o.fulfillment_method,o.total_paise,o.discount_paise,o.delivery_fee_paise,o.offer_snapshot,o.created_at,
    (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,o.status='CANCELLED' AS cancelled
   FROM app.orders o WHERE o.business_id=actor.business_id AND o.store_id=target_store AND o.created_at>=from_at AND o.created_at<until_at),
  live AS (SELECT * FROM o WHERE NOT cancelled),
  -- Each order's latest payment attempt.
  pay AS (SELECT o.id AS order_id,o.cancelled,p.method,p.status,p.amount_paise,p.refunded_paise FROM o
   JOIN LATERAL (SELECT method,status,amount_paise,refunded_paise FROM app.payments WHERE business_id=actor.business_id AND order_id=o.id ORDER BY attempt_number DESC LIMIT 1) p ON true),
  items AS (SELECT i.product_id,i.product_snapshot->>'productName' AS product,COALESCE(i.product_snapshot->>'categoryName','Uncategorised') AS category,i.order_id,i.line_total_paise,
    CASE WHEN i.pricing_basis='RAW_WEIGHT' THEN i.raw_weight_grams WHEN i.pricing_basis='NET_WEIGHT' THEN i.sale_quantity ELSE 0 END AS grams,
    CASE WHEN i.pricing_basis IN ('UNIT','TRAY') THEN i.sale_quantity ELSE 0 END AS packs,i.pricing_basis
   FROM app.order_items i JOIN live ON live.id=i.order_id WHERE i.business_id=actor.business_id),
  cash AS (SELECT (e.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,e.actor_id,
    CASE WHEN e.kind='CASH_RECEIVED' THEN e.amount_paise ELSE 0 END AS received,
    CASE WHEN e.kind='REFUND_RESULT' THEN e.amount_paise ELSE 0 END AS refunded,(e.kind='CASH_RECEIVED')::int AS collections
   FROM app.payment_events e JOIN app.payments p ON p.business_id=e.business_id AND p.id=e.payment_id JOIN app.orders ord ON ord.business_id=e.business_id AND ord.id=e.order_id
   WHERE e.business_id=actor.business_id AND ord.store_id=target_store AND p.method='CASH' AND e.created_at>=from_at AND e.created_at<until_at
    AND (e.kind='CASH_RECEIVED' OR (e.kind='REFUND_RESULT' AND e.to_status='COMPLETED')))
 SELECT jsonb_build_object('from',from_day,'until',until_day,
  'summary',(SELECT jsonb_build_object('orders',count(*) FILTER(WHERE NOT cancelled),
    'revenuePaise',COALESCE(sum(total_paise) FILTER(WHERE NOT cancelled),0),
    'discountPaise',COALESCE(sum(discount_paise) FILTER(WHERE NOT cancelled),0),
    'deliveryFeePaise',COALESCE(sum(delivery_fee_paise) FILTER(WHERE NOT cancelled),0),
    'cancelled',count(*) FILTER(WHERE cancelled),'cancelledPaise',COALESCE(sum(total_paise) FILTER(WHERE cancelled),0)) FROM o),
  'daily',(SELECT jsonb_agg(jsonb_build_object('day',d.day::date,'orders',COALESCE(t.orders,0),'revenuePaise',COALESCE(t.revenue,0)) ORDER BY d.day)
   FROM generate_series(from_day,until_day,interval '1 day') d(day)
   LEFT JOIN (SELECT day,count(*) AS orders,sum(total_paise) AS revenue FROM live GROUP BY day) t ON t.day=d.day::date),
  -- Item sales are line totals before order-level discounts.
  'products',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q."revenuePaise" DESC,q.name) FROM
   (SELECT max(product) AS name,max(category) AS category,sum(grams) AS grams,sum(packs) AS packs,bool_or(pricing_basis='TRAY') AS trays,
     count(DISTINCT order_id) AS orders,sum(line_total_paise) AS "revenuePaise" FROM items GROUP BY product_id) q),'[]'::jsonb),
  'categories',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q."revenuePaise" DESC,q.name) FROM
   (SELECT category AS name,sum(grams) AS grams,sum(packs) AS packs,count(DISTINCT order_id) AS orders,sum(line_total_paise) AS "revenuePaise" FROM items GROUP BY category) q),'[]'::jsonb),
  'payments',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.method) FROM
   (SELECT method,count(*) AS orders,
     COALESCE(sum(amount_paise-refunded_paise) FILTER(WHERE status IN ('PAID','REFUNDED')),0) AS "collectedPaise",
     COALESCE(sum(amount_paise) FILTER(WHERE status IN ('PENDING','VERIFYING','FAILED')),0) AS "pendingPaise",
     COALESCE(sum(refunded_paise),0) AS "refundedPaise"
    FROM pay WHERE NOT cancelled OR refunded_paise>0 GROUP BY method) q),'[]'::jsonb),
  'fulfilment',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.method) FROM
   (SELECT fulfillment_method AS method,count(*) AS orders,sum(total_paise) AS "revenuePaise",sum(delivery_fee_paise) AS "deliveryFeePaise" FROM live GROUP BY fulfillment_method) q),'[]'::jsonb),
  'coupons',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.uses DESC,q.title) FROM
   (SELECT offer_snapshot->>'code' AS code,max(offer_snapshot->>'title') AS title,count(*) AS uses,sum(discount_paise) AS "discountPaise",sum(total_paise) AS "revenuePaise"
    FROM live WHERE jsonb_typeof(offer_snapshot)='object' GROUP BY offer_snapshot->>'id',offer_snapshot->>'code') q),'[]'::jsonb),
  'cancellations',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q."cancelledAt" DESC) FROM
   (SELECT o.order_number AS "orderNumber",o.created_at AS "placedAt",o.total_paise AS "amountPaise",h.reason,h.created_at AS "cancelledAt",
     COALESCE(s.display_name,'Customer / system') AS "by",h.actor_role AS role
    FROM o JOIN LATERAL (SELECT reason,created_at,actor_id,actor_role FROM app.order_status_history WHERE business_id=actor.business_id AND order_id=o.id AND to_status='CANCELLED' ORDER BY created_at DESC LIMIT 1) h ON true
    LEFT JOIN app.staff_profiles s ON s.business_id=actor.business_id AND s.id=h.actor_id
    WHERE o.cancelled ORDER BY h.created_at DESC LIMIT 1000) q),'[]'::jsonb),
  'cash',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.day,q.staff) FROM
   (SELECT c.day,COALESCE(s.display_name,'Unknown') AS staff,sum(c.collections) AS collections,sum(c.received) AS "receivedPaise",sum(c.refunded) AS "refundedPaise"
    FROM cash c LEFT JOIN app.staff_profiles s ON s.business_id=actor.business_id AND s.id=c.actor_id GROUP BY c.day,c.actor_id,s.display_name) q),'[]'::jsonb)));
END $fn$;
REVOKE ALL ON FUNCTION api.sales_report(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION api.sales_report(uuid,date,date) TO authenticated;
COMMENT ON FUNCTION api.sales_report(uuid,date,date) IS 'Read-only sales report for ADMIN/OWNER: IST inclusive days; summary, daily trend, products, categories, payments, fulfilment, coupons, cancellations, day-end cash.';
NOTIFY pgrst,'reload schema';
COMMIT;
