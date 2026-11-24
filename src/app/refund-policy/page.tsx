import type { Metadata } from "next";
import { PolicyPage } from "@/components/ui/policy-page";
export const metadata: Metadata = { title: "Refund & cancellation policy", description: "How cancellations and refunds work for orders from TRAIT Fish & Meat Hub." };
export default function Page() {
 return <PolicyPage eyebrow="Cancellations and refunds" title="Refund & cancellation policy" updated="25 November 2026">
  <h2>Cancelling your order</h2><p>Fresh fish and meat are cleaned and cut to order. You can cancel free of charge until we start preparing your order: call or WhatsApp the store with your order number. Once preparation has started we cannot cancel the order.</p>
  <h2>Unpaid online orders</h2><p>If you choose to pay online and the payment is not completed within 30 minutes of placing the order, the order is cancelled automatically and nothing is charged. Until then you can use <strong>Retry payment</strong> on your order tracking page or the payment link we send on WhatsApp.</p>
  <h2>Cancellations by us</h2><p>If we cancel an order (for example, an item is out of stock or we cannot deliver to your area or slot), any amount you paid online is refunded in full.</p>
  <h2>Quality issues</h2><p>If an item is not fresh, is the wrong cut, or is missing, tell us on the day of delivery with your order number and a photo. After checking, we will replace the item or refund its amount.</p>
  <h2>How refunds are paid</h2><p>Refunds for online payments go back to the original payment method (UPI, card or bank account) through Razorpay. They are started within 2 business days of approval and usually reach you within 5–7 business days, depending on your bank. Orders paid by cash or UPI at delivery are refunded by UPI or cash.</p>
  <h2>Late payments</h2><p>If a payment completes after an order was cancelled, the store refunds the full amount with no deductions.</p>
 </PolicyPage>;
}
