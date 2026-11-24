import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/components/ui/policy-page";
export const metadata: Metadata = { title: "Terms of service", description: "Terms for ordering fresh fish, chicken and mutton from TRAIT Fish & Meat Hub." };
export default function Page() {
 return <PolicyPage eyebrow="Ordering with us" title="Terms of service" updated="25 November 2026">
  <h2>About these terms</h2><p>These terms apply to orders placed on this website with TRAIT Fish &amp; Meat Hub, Kokapet, Hyderabad, Telangana, India. By placing an order you agree to them.</p>
  <h2>Products, weights and prices</h2><p>Fish and meat are natural products. Weight-priced items are cut from the raw weight you choose; the cleaned or cut weight can be lower depending on the cut. Photos are illustrative. Prices are in Indian Rupees and include applicable taxes. The price, delivery fee and any discount are confirmed on the review screen before you place the order.</p>
  <h2>Orders</h2><p>An order is accepted when we confirm it. We may cancel an order if an item is unavailable, the address is outside our delivery area, or we cannot deliver in the chosen slot; any amount paid online is then refunded in full as described in our <Link className="text-link" href="/refund-policy">Refund &amp; Cancellation policy</Link>.</p>
  <h2>Payment</h2><p>You can pay online through Razorpay (UPI, cards, netbanking) or pay by cash or UPI at delivery or pickup. An online order must be paid within 30 minutes of placing it; unpaid online orders are cancelled automatically and the items and slot are released. An order counts as paid only when we receive confirmation from Razorpay.</p>
  <h2>Delivery and pickup</h2><p>We deliver within the areas and slots shown at checkout, or you can collect from the store. See our <Link className="text-link" href="/delivery-areas">Delivery policy</Link>.</p>
  <h2>Liability</h2><p>Please check your order on delivery and tell us about any problem the same day. Our liability for an order is limited to the amount paid for it. Nothing in these terms limits your rights under the Consumer Protection Act, 2019.</p>
  <h2>Governing law</h2><p>These terms are governed by the laws of India; courts in Hyderabad, Telangana have jurisdiction.</p>
 </PolicyPage>;
}
