# Razorpay online payments

Test mode first: use `rzp_test_…` keys. Live keys get their own `payment_provider_accounts` row automatically, so test and live records never mix.

## Setup
1. Apply `supabase/migrations/20261125000000_razorpay_payments.sql` (as `postgres`). If `pg_cron` is installed it schedules the 30-minute unpaid-order sweep every minute. Without it, checkout, tracking, pay and webhook traffic run the sweep.
2. Provision the verifier login through a secure admin channel. It must be a different login from checkout:
   ```sql
   CREATE ROLE trait_verifier_app LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   GRANT trait_payment_verifier TO trait_verifier_app;   -- nothing else: no tables, no trait_checkout
   GRANT CONNECT ON DATABASE postgres TO trait_verifier_app;
   ```
   The app checks this isolation on every connection, and refuses the connection if the verifier URL is the same as the checkout URL.
3. Set these env vars in the deployment secrets only: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `TRAIT_PAYMENT_VERIFIER_DATABASE_URL`. "Pay online" appears at checkout only when all of them are set.
4. In the Razorpay Dashboard (Test mode), go to Webhooks and add `https://<your-domain>/api/razorpay/webhook` with the same secret. Select these events: `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`. Turn on automatic capture for payments.

## Flow
- **Checkout:** places the order with payment method `ONLINE`. The server creates the Razorpay order from the stored server-side amount, and the verifier binds it to the payment. The customer then pays in Razorpay Checkout.
- **Browser callback:** only refreshes the page. Only the HMAC-verified webhook, through `api.record_razorpay_payment`, marks a payment PAID. That call is idempotent on Razorpay's event id.
- **Unpaid orders:** online orders still unpaid 30 minutes after placing are cancelled by `api.cancel_unpaid_online_orders`. The cancel trigger returns the stock, and slot capacity excludes cancelled orders.
- **Retry payment:** customers can retry from the tracking/confirmation page or from the signed `/pay/<id>.<sig>` link in the staff "WhatsApp customer" message.
- **Admin:** shows "Paid online" with the `pay_…` and `order_…` references. ADMIN/OWNER can use "Refund ₹X via Razorpay" to refund the full remaining amount; the refund is audited, and resending it is safe because of the idempotency key. The refund completes on the `refund.processed` webhook. If money arrives after an order was cancelled, the order shows "Paid after cancellation: refund this payment".
