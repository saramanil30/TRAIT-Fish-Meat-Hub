-- Track Order by mobile number: open orders (not Delivered/Cancelled) for one store and number.
-- Returns order number, placed time, status, total and status history only: no name, address,
-- items, ids or tracking tokens. Callable only by the server's checkout role, which applies the
-- per-IP and per-number rate limits first; anon and authenticated cannot call it.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE INDEX IF NOT EXISTS orders_open_by_mobile ON app.orders(store_id,(fulfillment_snapshot->>'mobileE164'))
 WHERE status NOT IN ('DELIVERED','CANCELLED');

CREATE OR REPLACE FUNCTION api.open_orders_by_mobile(target_store uuid, mobile text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE normalized text;
BEGIN
 BEGIN normalized:=app.normalize_indian_mobile(mobile); EXCEPTION WHEN others THEN RETURN '[]'::jsonb; END;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('orderNumber',o.order_number,'placedAt',o.created_at,'status',o.status,'totalPaise',o.total_paise,
  'history',(SELECT jsonb_agg(jsonb_build_object('status',h.to_status,'at',h.created_at) ORDER BY h.created_at,h.id) FROM app.order_status_history h WHERE h.order_id=o.id))
  ORDER BY o.created_at DESC)
 FROM (SELECT o.* FROM app.orders o JOIN app.stores s ON s.id=o.store_id AND s.business_id=o.business_id JOIN app.businesses b ON b.id=o.business_id
  WHERE o.store_id=target_store AND o.fulfillment_snapshot->>'mobileE164'=normalized AND o.status NOT IN ('DELIVERED','CANCELLED')
  AND s.is_active AND s.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL
  ORDER BY o.created_at DESC LIMIT 20) o),'[]'::jsonb);
END; $fn$;
REVOKE ALL ON FUNCTION api.open_orders_by_mobile(uuid,text) FROM PUBLIC,anon,authenticated,service_role,trait_payment_verifier;
GRANT EXECUTE ON FUNCTION api.open_orders_by_mobile(uuid,text) TO trait_checkout;
COMMENT ON FUNCTION api.open_orders_by_mobile(uuid,text) IS 'Server-only (trait_checkout) Track Order lookup after rate limiting: open orders for a store and normalized mobile; status data only, no personal or item details.';
COMMIT;
