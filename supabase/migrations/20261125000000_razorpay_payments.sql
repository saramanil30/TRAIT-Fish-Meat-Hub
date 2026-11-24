-- Razorpay online payments (test mode first) on the existing provider-neutral payment core.
-- Only trait_payment_verifier (a separate LOGIN, never checkout's) binds Razorpay orders and records
-- verified webhook outcomes; nothing here lets a browser or checkout mark a payment PAID.
-- Unpaid online orders auto-cancel after 30 minutes; the existing trigger restores stock and
-- slot counts already exclude cancelled orders. Forward-only.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('api.record_verified_payment(uuid,text,text,text,bigint,text)') IS NULL
 OR to_regprocedure('api.bind_provider_payment(uuid,uuid,text)') IS NULL
 OR to_regprocedure('api.request_refund(uuid,bigint,uuid,jsonb,text)') IS NULL
 OR to_regprocedure('app.restore_cancelled_stock()') IS NULL
 OR to_regprocedure('api.online_payment(uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'Deployed payment core and daily stock required; Razorpay migration not yet applied'; END IF;
END;
$preflight$;

-- How long an online order waits for payment before it is cancelled.
CREATE FUNCTION app.online_pay_window() RETURNS interval LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$ SELECT interval '30 minutes' $fn$;

-- Verifier: the active Razorpay merchant account for this store's business, keyed by the key id
-- (test and live keys are separate accounts, so test payments never settle live records).
CREATE FUNCTION api.razorpay_account(target_store uuid,key_id text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE business uuid; result uuid;
BEGIN
 IF key_id IS NULL OR key_id !~ '^rzp_(test|live)_[A-Za-z0-9]{6,40}$' THEN RAISE EXCEPTION 'Invalid Razorpay key id' USING ERRCODE='22023'; END IF;
 SELECT s.business_id INTO business FROM app.stores s WHERE s.id=target_store AND s.is_active AND s.deleted_at IS NULL;
 IF business IS NULL THEN RAISE EXCEPTION 'Store unavailable' USING ERRCODE='22023'; END IF;
 INSERT INTO app.payment_provider_accounts(business_id,provider,merchant_reference,is_active)
 VALUES(business,'razorpay',key_id,true) ON CONFLICT (provider,merchant_reference) DO NOTHING;
 SELECT id INTO result FROM app.payment_provider_accounts WHERE provider='razorpay' AND merchant_reference=key_id AND business_id=business AND is_active;
 IF result IS NULL THEN RAISE EXCEPTION 'Razorpay account unavailable' USING ERRCODE='22023'; END IF;
 RETURN result;
END;
$fn$;

-- Verifier: what is needed to start or retry Checkout for one online payment of this store.
CREATE FUNCTION api.online_payment(target_store uuid,target_payment uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT jsonb_build_object('paymentId',p.id,'orderId',o.id,'orderNumber',o.order_number,'amountPaise',p.amount_paise,'currency',p.currency,
  'status',p.status,'orderStatus',o.status,'providerReference',p.provider_payment_reference,
  'payUntil',o.created_at+app.online_pay_window(),'name',o.fulfillment_snapshot->>'name','mobileE164',o.fulfillment_snapshot->>'mobileE164')
 FROM app.payments p JOIN app.orders o ON o.id=p.order_id
 WHERE p.id=target_payment AND o.store_id=target_store AND p.method='ONLINE'
$fn$;

-- Verifier, after webhook signature verification: settle (or fail) the payment through the
-- existing idempotent core, and keep Razorpay's payment id (pay_…) for refunds and staff.
CREATE FUNCTION api.record_razorpay_payment(account_id uuid,razorpay_order text,razorpay_payment text,event_id text,
 outcome text,verified_amount_paise bigint,verified_currency text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE payment app.payments; order_row app.orders;
BEGIN
 IF razorpay_payment IS NULL OR razorpay_payment !~ '^pay_[A-Za-z0-9]{6,40}$' THEN RAISE EXCEPTION 'Invalid Razorpay payment id' USING ERRCODE='22023'; END IF;
 PERFORM api.record_verified_payment(account_id,razorpay_order,event_id,outcome,verified_amount_paise,verified_currency);
 SELECT * INTO payment FROM app.payments WHERE provider_account_id=account_id AND provider_payment_reference=razorpay_order;
 payment:=app.lock_order_payment(payment.id);
 SELECT * INTO order_row FROM app.orders WHERE id=payment.order_id;
 IF outcome='PAID' AND NOT EXISTS(SELECT 1 FROM app.payment_events WHERE payment_id=payment.id AND kind='PROVIDER_CHARGE' AND evidence_reference=razorpay_payment) THEN
  INSERT INTO app.payment_events(business_id,order_id,payment_id,actor_role,kind,to_status,amount_paise,evidence_reference)
  VALUES(payment.business_id,payment.order_id,payment.id,'PROVIDER','PROVIDER_CHARGE',payment.status,verified_amount_paise,razorpay_payment);
  -- Money arrived after the order was cancelled (late payment): staff must refund it.
  IF order_row.status='CANCELLED' THEN
   PERFORM app.core_audit(payment.business_id,order_row.store_id,NULL,'PROVIDER','PAID_AFTER_CANCEL',payment.id,jsonb_build_object('amountPaise',verified_amount_paise));
  END IF;
 END IF;
 RETURN jsonb_build_object('paymentStatus',payment.status,'orderStatus',order_row.status,'orderNumber',order_row.order_number);
END;
$fn$;

-- Checkout and verifier: cancel this store's online orders still unpaid after the pay window.
-- Stock comes back through orders_cancel_restores_stock; slot capacity ignores cancelled orders.
CREATE FUNCTION api.cancel_unpaid_online_orders(target_store uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE o app.orders; p app.payments; n integer:=0;
BEGIN
 FOR o IN SELECT * FROM app.orders WHERE store_id=target_store AND payment_method='ONLINE' AND status IN ('PLACED','CONFIRMED')
  AND created_at<clock_timestamp()-app.online_pay_window() ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO p FROM app.payments WHERE order_id=o.id ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE;
  CONTINUE WHEN p.id IS NULL OR p.status NOT IN ('PENDING','FAILED');
  UPDATE app.orders SET status='CANCELLED',version=version+1,updated_at=clock_timestamp() WHERE id=o.id;
  INSERT INTO app.order_status_history(business_id,order_id,from_status,to_status,actor_role,reason)
  VALUES(o.business_id,o.id,o.status,'CANCELLED','SYSTEM','Online payment not completed within 30 minutes');
  IF p.status='PENDING' THEN UPDATE app.payments SET status='FAILED',version=version+1,updated_at=clock_timestamp() WHERE id=p.id; END IF;
  INSERT INTO app.payment_events(business_id,order_id,payment_id,actor_role,kind,from_status,to_status,amount_paise)
  VALUES(o.business_id,o.id,p.id,'SYSTEM','PAYMENT_EXPIRED',p.status,'FAILED',p.amount_paise);
  PERFORM app.core_audit(o.business_id,o.store_id,NULL,'SYSTEM','ORDER_STATUS',o.id,jsonb_build_object('from',o.status,'to','CANCELLED','reason','UNPAID_ONLINE'));
  n:=n+1;
 END LOOP;
 RETURN n;
END;
$fn$;

-- Staff (ADMIN/OWNER, via request_refund's own checks and audit): one-click refund of everything
-- still refundable on a Razorpay payment. Returns what the server needs to call Razorpay.
CREATE FUNCTION api.request_full_online_refund(target_payment uuid,expected_version bigint,request_key uuid,reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor app.staff_profiles; payment app.payments; remaining bigint; take bigint; allocations jsonb:='[]'; c record; refund uuid; charge text; refund_row app.payment_refunds;
BEGIN
 PERFORM app.require_staff(ARRAY['ADMIN','OWNER']);
 SELECT * INTO payment FROM app.payments WHERE id=target_payment;
 IF payment.id IS NULL OR payment.method<>'ONLINE' OR payment.provider_account_id IS NULL THEN RAISE EXCEPTION 'Not a Razorpay payment' USING ERRCODE='22023'; END IF;
 actor:=app.require_order_staff(payment.order_id);
 SELECT evidence_reference INTO charge FROM app.payment_events WHERE payment_id=payment.id AND kind='PROVIDER_CHARGE' ORDER BY created_at DESC LIMIT 1;
 IF charge IS NULL THEN RAISE EXCEPTION 'Razorpay payment id unknown' USING ERRCODE='22023'; END IF;
 -- A retry (same key, or a refund Razorpay has not accepted yet) resends that refund instead of creating another.
 SELECT * INTO refund_row FROM app.payment_refunds WHERE payment_id=payment.id
  AND (request_id=request_key OR (status='PENDING' AND provider_refund_reference IS NULL)) ORDER BY request_id=request_key DESC,created_at LIMIT 1;
 IF refund_row.id IS NULL THEN
  remaining:=payment.amount_paise-COALESCE((SELECT sum(amount_paise) FROM app.payment_refunds WHERE payment_id=payment.id AND status IN ('PENDING','COMPLETED')),0);
  IF remaining<=0 THEN RAISE EXCEPTION 'Nothing left to refund' USING ERRCODE='22023'; END IF;
  -- Fill delivery then items, each up to what it has left, until the remaining paid amount is covered.
  FOR c IN SELECT NULL::uuid AS item,o.delivery_fee_paise-COALESCE((SELECT sum(a.amount_paise) FROM app.refund_allocations a JOIN app.payment_refunds r ON r.id=a.refund_id
    WHERE a.order_id=o.id AND a.order_item_id IS NULL AND r.status IN ('PENDING','COMPLETED')),0) AS left_paise,0 AS line_number
   FROM app.orders o WHERE o.id=payment.order_id
   UNION ALL SELECT i.id,i.line_total_paise-COALESCE((SELECT sum(a.amount_paise) FROM app.refund_allocations a JOIN app.payment_refunds r ON r.id=a.refund_id
    WHERE a.order_item_id=i.id AND r.status IN ('PENDING','COMPLETED')),0),i.line_number FROM app.order_items i WHERE i.order_id=payment.order_id
   ORDER BY line_number LOOP
   EXIT WHEN remaining<=0;
   take:=LEAST(remaining,c.left_paise);
   CONTINUE WHEN take<=0;
   allocations:=allocations||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('itemId',c.item,'amountPaise',take)));
   remaining:=remaining-take;
  END LOOP;
  refund:=api.request_refund(target_payment,expected_version,request_key,allocations,reason);
  SELECT * INTO refund_row FROM app.payment_refunds WHERE id=refund;
 ELSE
  PERFORM app.core_audit(payment.business_id,(SELECT store_id FROM app.orders WHERE id=payment.order_id),actor.id,app.current_staff_role(),'REFUND_RESENT',refund_row.id,jsonb_build_object('amountPaise',refund_row.amount_paise));
 END IF;
 RETURN jsonb_build_object('refundId',refund_row.id,'amountPaise',refund_row.amount_paise,'status',refund_row.status,'chargeReference',charge,'razorpayOrder',payment.provider_payment_reference,
  'providerRefundReference',refund_row.provider_refund_reference,'orderNumber',(SELECT order_number FROM app.orders WHERE id=payment.order_id));
END;
$fn$;

-- Staff order detail: adds the Razorpay order/payment references and the pay deadline.
CREATE OR REPLACE FUNCTION api.order_detail(target_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor app.staff_profiles;
BEGIN
 actor:=app.require_order_staff(target_order);
 RETURN jsonb_build_object('order',(SELECT to_jsonb(o) FROM app.orders o WHERE id=target_order),
 'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY line_number) FROM app.order_items i WHERE order_id=target_order),
 'fulfillment',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY created_at) FROM app.order_item_fulfillment f WHERE order_id=target_order),'[]'::jsonb),
 'payments',(SELECT jsonb_agg(jsonb_build_object('id',p.id,'method',p.method,'status',p.status,'amountPaise',p.amount_paise,'refundedPaise',p.refunded_paise,'version',p.version,
   'providerReference',p.provider_payment_reference,
   'chargeReference',(SELECT e.evidence_reference FROM app.payment_events e WHERE e.payment_id=p.id AND e.kind='PROVIDER_CHARGE' ORDER BY e.created_at DESC LIMIT 1),
   'pendingRefundPaise',(SELECT COALESCE(sum(r.amount_paise),0) FROM app.payment_refunds r WHERE r.payment_id=p.id AND r.status='PENDING'),
   'unsentRefund',EXISTS(SELECT 1 FROM app.payment_refunds r WHERE r.payment_id=p.id AND r.status='PENDING' AND r.provider_refund_reference IS NULL),
   'payUntil',CASE WHEN p.method='ONLINE' THEN (SELECT o.created_at+app.online_pay_window() FROM app.orders o WHERE o.id=p.order_id) END)) FROM app.payments p WHERE p.order_id=target_order),
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at,'actorId',actor_id) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=target_order),
 'stock',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'productName',p.name,'measure',m.measure,'change',m.change,'before',m.on_hand_before,'after',m.on_hand_after,'note',m.note,'at',m.created_at) ORDER BY m.created_at,m.id)
  FROM app.stock_movements m JOIN app.product_store_settings o ON o.id=m.offering_id JOIN app.products p ON p.id=o.product_id
  WHERE m.business_id=actor.business_id AND m.order_id=target_order),'[]'::jsonb));
END;
$fn$;

-- Tracking: adds the payment method, and for an unpaid online order its payment id and deadline (for "Retry payment").
CREATE OR REPLACE FUNCTION api.track_order(tracking_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE order_row app.orders; pay app.payments;
BEGIN
 IF tracking_token IS NULL OR tracking_token !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT o.* INTO order_row FROM app.order_access_tokens t JOIN app.orders o ON o.id=t.order_id JOIN app.businesses b ON b.id=o.business_id
 WHERE t.token_digest=sha256(convert_to(tracking_token,'UTF8')) AND t.scope='TRACKING' AND t.revoked_at IS NULL
 AND t.expires_at>statement_timestamp() AND b.is_active AND b.deleted_at IS NULL;
 IF order_row.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO pay FROM app.payments WHERE order_id=order_row.id ORDER BY attempt_number DESC LIMIT 1;
 RETURN jsonb_build_object('orderNumber',order_row.order_number,'status',order_row.status,'method',order_row.fulfillment_method,'placedAt',order_row.created_at,
 'subtotalPaise',order_row.subtotal_paise,'discountPaise',order_row.discount_paise,'deliveryFeePaise',order_row.delivery_fee_paise,'totalPaise',order_row.total_paise,'offerTitle',order_row.offer_snapshot->>'title',
 'slot',order_row.fulfillment_snapshot->'slot',
 'paymentStatus',pay.status,'paymentMethod',pay.method,
 'onlinePaymentId',CASE WHEN pay.method='ONLINE' AND pay.status IN ('PENDING','FAILED') AND order_row.status<>'CANCELLED' THEN pay.id END,
 'payUntil',CASE WHEN pay.method='ONLINE' THEN order_row.created_at+app.online_pay_window() END,
 'history',(SELECT jsonb_agg(jsonb_build_object('status',to_status,'at',created_at) ORDER BY created_at,id) FROM app.order_status_history WHERE order_id=order_row.id));
END;
$fn$;

REVOKE ALL ON FUNCTION app.online_pay_window(),api.razorpay_account(uuid,text),api.online_payment(uuid,uuid),
 api.record_razorpay_payment(uuid,text,text,text,text,bigint,text),api.cancel_unpaid_online_orders(uuid),
 api.request_full_online_refund(uuid,bigint,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role,trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.razorpay_account(uuid,text),api.online_payment(uuid,uuid),
 api.record_razorpay_payment(uuid,text,text,text,text,bigint,text) TO trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.cancel_unpaid_online_orders(uuid) TO trait_checkout,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.request_full_online_refund(uuid,bigint,uuid,text) TO authenticated;
COMMENT ON FUNCTION api.record_razorpay_payment(uuid,text,text,text,text,bigint,text) IS 'Verifier only, after Razorpay webhook HMAC verification. Browser callbacks never reach this.';
COMMENT ON FUNCTION api.cancel_unpaid_online_orders(uuid) IS 'Cancels online orders unpaid after 30 minutes; run by pg_cron when installed and on checkout/tracking/webhook traffic.';

-- Every minute via pg_cron when the extension is installed; otherwise the app sweeps on traffic.
DO $cron$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  EXECUTE $q$SELECT cron.schedule('trait-cancel-unpaid-online','* * * * *',
   'SELECT api.cancel_unpaid_online_orders(id) FROM app.stores WHERE is_active AND deleted_at IS NULL')$q$;
 ELSE RAISE NOTICE 'pg_cron not installed: unpaid online orders are swept by app traffic only';
 END IF;
END;
$cron$;

-- The verifier and checkout stay isolated: no table access, no cross-membership, no login on the groups.
DO $security$
BEGIN
 IF has_function_privilege('trait_checkout','api.record_razorpay_payment(uuid,text,text,text,text,bigint,text)','EXECUTE')
 OR has_function_privilege('trait_checkout','api.record_verified_payment(uuid,text,text,text,bigint,text)','EXECUTE')
 OR has_function_privilege('anon','api.online_payment(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','api.record_razorpay_payment(uuid,text,text,text,text,bigint,text)','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('trait_checkout','trait_payment_verifier') AND (rolcanlogin OR rolsuper OR rolbypassrls))
 THEN RAISE EXCEPTION 'Unsafe payment capability'; END IF;
END;
$security$;
NOTIFY pgrst,'reload schema';
COMMIT;
