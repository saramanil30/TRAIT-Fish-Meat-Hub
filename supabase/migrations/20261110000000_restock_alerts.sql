BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- "Notify me when available" for sold-out products. A shopper leaves a mobile number (and, optionally, a browser
-- push subscription) for one product; one request per number per product per store, expiring after 7 days.
-- Checkout's server-only trait_checkout connection, after per-IP and per-number rate limiting, adds requests and
-- claims the browser pushes that are due once a product is available again. Mobile numbers leave the database only
-- to ADMIN/OWNER staff, who send the WhatsApp message themselves and mark each request notified.
-- The table has RLS forced and no grants: access is only through the functions below.

CREATE TABLE app.restock_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 store_id uuid NOT NULL REFERENCES app.stores(id),
 product_id uuid NOT NULL,
 mobile_e164 text NOT NULL CHECK (mobile_e164 ~ '^\+91[6-9][0-9]{9}$'),
 push_subscription jsonb CHECK (push_subscription IS NULL OR length(push_subscription::text)<=1500),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 pushed_at timestamptz,
 notified_at timestamptz,
 notified_by uuid REFERENCES app.staff_profiles(id),
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id),
 CHECK (expires_at>requested_at),
 CHECK ((notified_at IS NULL)=(notified_by IS NULL)),
 UNIQUE(store_id,product_id,mobile_e164)
);
CREATE INDEX restock_requests_open_idx ON app.restock_requests(store_id,product_id,expires_at);
CREATE INDEX restock_requests_mobile_idx ON app.restock_requests(store_id,mobile_e164,expires_at);
ALTER TABLE app.restock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.restock_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.restock_requests FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
COMMENT ON TABLE app.restock_requests IS 'Back-in-stock requests by mobile (7 days). Mobiles leave the database only to ADMIN/OWNER (api.restock_waiting); push subscriptions only to the server-only checkout connection.';

-- {endpoint,p256dh,auth} from a browser PushSubscription; endpoints only on the major browsers' push services.
CREATE FUNCTION app.valid_push_subscription(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT jsonb_typeof(value)='object' AND (SELECT count(*) FROM jsonb_object_keys(value))=3
 AND jsonb_typeof(value->'endpoint')='string' AND jsonb_typeof(value->'p256dh')='string' AND jsonb_typeof(value->'auth')='string'
 AND length(value->>'endpoint')<=1000
 AND value->>'endpoint' ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)/[!-~]+$'
 AND value->>'p256dh' ~ '^[A-Za-z0-9_-]{86,88}$' AND value->>'auth' ~ '^[A-Za-z0-9_-]{22,24}$'
$fn$;

-- Each storefront product's name and whether customers can buy it now (sold out includes stock below the smallest
-- sellable quantity), exactly as api.catalogue shows it.
CREATE FUNCTION app.restock_catalogue_state(target_store uuid) RETURNS TABLE(product_id uuid,product_name text,available boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT (p->>'id')::uuid,p->>'name',(p->>'available')::boolean FROM jsonb_array_elements(api.catalogue(target_store)->'products') p
$fn$;

-- Checkout (server-only, after rate limiting): ask to be told when a sold-out product is back. The answer is the same
-- whether or not this number already asked, so it never reveals another shopper's request.
CREATE FUNCTION api.request_restock_alert(target_store uuid,product uuid,mobile text,subscription jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE business uuid; number_value text; state record; existing app.restock_requests; now_value timestamptz:=clock_timestamp();
BEGIN
 number_value:=app.normalize_indian_mobile(mobile);
 IF number_value !~ '^\+91[6-9][0-9]{9}$' OR product IS NULL OR (subscription IS NOT NULL AND NOT app.valid_push_subscription(subscription))
 THEN RAISE EXCEPTION 'Invalid alert request' USING ERRCODE='22023'; END IF;
 SELECT s.business_id INTO business FROM app.stores s JOIN app.businesses b ON b.id=s.business_id
 WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL;
 IF business IS NULL THEN RAISE EXCEPTION 'Store unavailable' USING ERRCODE='22023'; END IF;
 SELECT * INTO state FROM app.restock_catalogue_state(target_store) c WHERE c.product_id=request_restock_alert.product;
 IF state.product_id IS NULL THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='22023'; END IF;
 IF state.available THEN RETURN jsonb_build_object('status','AVAILABLE'); END IF;
 -- Expired requests are removed, never kept.
 DELETE FROM app.restock_requests r WHERE r.store_id=target_store AND r.expires_at<=now_value;
 IF (SELECT count(*) FROM app.restock_requests r WHERE r.store_id=target_store AND r.mobile_e164=number_value
  AND r.product_id<>request_restock_alert.product)>=20
 THEN RAISE EXCEPTION 'Too many alerts for this number' USING ERRCODE='22023'; END IF;
 INSERT INTO app.restock_requests(business_id,store_id,product_id,mobile_e164,push_subscription,requested_at,expires_at)
 VALUES(business,target_store,product,number_value,subscription,now_value,now_value+interval '7 days')
 ON CONFLICT (store_id,product_id,mobile_e164) DO NOTHING;
 SELECT r.* INTO existing FROM app.restock_requests r WHERE r.store_id=target_store AND r.product_id=request_restock_alert.product
 AND r.mobile_e164=number_value FOR UPDATE;
 IF existing.pushed_at IS NOT NULL OR existing.notified_at IS NOT NULL THEN
  -- Told before and sold out again: a fresh 7-day request.
  UPDATE app.restock_requests r SET requested_at=now_value,expires_at=now_value+interval '7 days',pushed_at=NULL,notified_at=NULL,notified_by=NULL,
   push_subscription=COALESCE(subscription,r.push_subscription) WHERE r.id=existing.id;
 ELSIF existing.push_subscription IS NULL AND subscription IS NOT NULL THEN
  -- An open request keeps its dates (one per number per product) and its first browser.
  UPDATE app.restock_requests r SET push_subscription=subscription WHERE r.id=existing.id;
 END IF;
 RETURN jsonb_build_object('status','WAITING');
END $fn$;

-- Checkout (server-only): claims, at most once each, the browser pushes due for products that are available again.
-- Concurrent callers never claim the same request.
CREATE FUNCTION api.restock_push_due(target_store uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
 WITH back AS (SELECT c.product_id,c.product_name FROM app.restock_catalogue_state(target_store) c WHERE c.available),
 due AS (SELECT r.id FROM app.restock_requests r JOIN back b ON b.product_id=r.product_id
  WHERE r.store_id=target_store AND r.pushed_at IS NULL AND r.push_subscription IS NOT NULL AND r.expires_at>clock_timestamp()
  ORDER BY r.requested_at LIMIT 500 FOR UPDATE OF r SKIP LOCKED),
 claimed AS (UPDATE app.restock_requests r SET pushed_at=clock_timestamp() FROM due WHERE r.id=due.id AND r.pushed_at IS NULL
  RETURNING r.product_id,r.push_subscription)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',c.product_id,'productName',b.product_name,'subscription',c.push_subscription)),'[]'::jsonb)
 FROM claimed c JOIN back b ON b.product_id=c.product_id
$fn$;

-- Staff (ADMIN/OWNER): open requests by product, most waiting first, for the "Notify on WhatsApp" list.
CREATE FUNCTION api.restock_waiting(target_store uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 IF NOT app.can_access_store(actor.business_id,target_store) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',q.product_id,'productName',q.name,'available',q.available,
  'waiting',q.waiting,'requests',q.requests) ORDER BY q.waiting DESC,q.name) FROM
  (SELECT r.product_id,p.name,COALESCE(c.available,false) AS available,count(*) FILTER (WHERE r.notified_at IS NULL) AS waiting,
   jsonb_agg(jsonb_build_object('id',r.id,'mobile',r.mobile_e164,'requestedAt',r.requested_at,'expiresAt',r.expires_at,
    'pushed',r.pushed_at IS NOT NULL,'notifiedAt',r.notified_at) ORDER BY r.requested_at) AS requests
  FROM app.restock_requests r JOIN app.products p ON p.business_id=r.business_id AND p.id=r.product_id
  LEFT JOIN app.restock_catalogue_state(target_store) c ON c.product_id=r.product_id
  WHERE r.business_id=actor.business_id AND r.store_id=target_store AND r.expires_at>clock_timestamp()
  GROUP BY r.product_id,p.name,c.available) q),'[]'::jsonb);
END $fn$;

-- Staff (ADMIN/OWNER): after sending the WhatsApp message, mark that request notified. Repeating it is a no-op.
CREATE FUNCTION api.mark_restock_notified(target_request uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; request app.restock_requests;
BEGIN
 actor:=app.require_staff(ARRAY['ADMIN','OWNER']);
 SELECT r.* INTO request FROM app.restock_requests r WHERE r.id=target_request AND r.business_id=actor.business_id AND r.expires_at>clock_timestamp() FOR UPDATE;
 IF request.id IS NULL OR NOT app.can_access_store(actor.business_id,request.store_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF request.notified_at IS NULL THEN
  UPDATE app.restock_requests SET notified_at=clock_timestamp(),notified_by=actor.id WHERE id=request.id RETURNING * INTO request;
  -- No mobile number in the audit log.
  PERFORM app.core_audit(request.business_id,request.store_id,actor.id,app.current_staff_role(),'RESTOCK_NOTIFIED',request.id,jsonb_build_object('productId',request.product_id));
 END IF;
 RETURN jsonb_build_object('id',request.id,'notifiedAt',request.notified_at);
END $fn$;

REVOKE ALL ON FUNCTION app.valid_push_subscription(jsonb),app.restock_catalogue_state(uuid),api.request_restock_alert(uuid,uuid,text,jsonb),
 api.restock_push_due(uuid),api.restock_waiting(uuid),api.mark_restock_notified(uuid)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.request_restock_alert(uuid,uuid,text,jsonb),api.restock_push_due(uuid) TO trait_checkout;
GRANT EXECUTE ON FUNCTION api.restock_waiting(uuid),api.mark_restock_notified(uuid) TO authenticated;
COMMENT ON FUNCTION api.request_restock_alert(uuid,uuid,text,jsonb) IS 'Server-only (trait_checkout) after per-IP and per-number rate limiting: one back-in-stock request per number per product, 7 days.';
COMMENT ON FUNCTION api.restock_push_due(uuid) IS 'Server-only (trait_checkout): claims due browser pushes for products available again; each at most once.';

DO $security$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'
 AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'Unsafe table state'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE r.rolname IN ('anon','authenticated','service_role','trait_checkout','trait_payment_verifier') AND n.nspname='app' AND c.relname='restock_requests'
 AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE'))) THEN RAISE EXCEPTION 'Unexpected direct table access'; END IF;
END $security$;
COMMIT;
