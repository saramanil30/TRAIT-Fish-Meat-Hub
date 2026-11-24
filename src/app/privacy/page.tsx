import type { Metadata } from "next";
import { PolicyPage } from "@/components/ui/policy-page";
export const metadata: Metadata = { title: "Privacy policy", description: "How TRAIT Fish & Meat Hub collects, uses and protects the details you share when you order." };
export default function Page() {
 return <PolicyPage eyebrow="Your data" title="Privacy policy" updated="25 November 2026">
  <h2>What we collect</h2><p>When you order we collect your name, mobile number, delivery address and landmark, the items and cutting instructions you choose, your delivery slot and your payment method. If you ask for a back-in-stock alert we keep your mobile number (and, if you allow it, a browser notification subscription) for that product.</p>
  <h2>How we use it</h2><p>Only to prepare, deliver and support your order: confirming it, contacting you by phone or WhatsApp about it, delivering it, handling payments and refunds, keeping your saved addresses for faster checkout, and meeting our legal and tax obligations. We do not sell your data or use it for third-party advertising.</p>
  <h2>Online payments</h2><p>Online payments are processed by Razorpay Software Private Limited. Your card, UPI or bank details are entered on Razorpay&apos;s secure checkout and are never seen or stored by us. We receive only the payment status, amount and Razorpay reference numbers. Razorpay&apos;s own privacy policy applies to the details you give them.</p>
  <h2>Sharing</h2><p>We share your details only with the staff and delivery partners who fulfil your order, our payment processor, and the service providers that host our website and database, all under confidentiality. We may disclose information when required by law.</p>
  <h2>Retention and security</h2><p>Order and payment records are kept as long as required for accounting and legal purposes. Tracking links are private and expire. Access to customer data is limited to authorised staff, and connections are encrypted.</p>
  <h2>Your choices</h2><p>You can ask us to correct your details or delete your saved addresses at any time by contacting the store. Order records we must keep by law are retained.</p>
 </PolicyPage>;
}
