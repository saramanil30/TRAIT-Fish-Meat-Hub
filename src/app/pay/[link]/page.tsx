import Link from "next/link";
import { PayOnline } from "@/components/checkout/pay-online";
export const dynamic = "force-dynamic";
export const metadata = { title: "Pay for your TRAIT order", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** Signed pay link sent on WhatsApp ("Retry payment"). The link only identifies the payment; amount and
 *  Razorpay order come from the server, and the order shows Paid only after the verified webhook. */
export default async function Page({ params }: { params: Promise<{ link: string }> }) {
 const link = decodeURIComponent((await params).link);
 return <div className="container page-section order-status-page"><h1>Pay for your order</h1>
  <section className="order-panel"><p>Pay securely with Razorpay using UPI, card or netbanking. Unpaid online orders are cancelled automatically 30 minutes after they are placed.</p>
   <PayOnline source={{ link }} label="Pay now" />
   <p className="field-help">After paying, track your order with your mobile number on <Link href="/track-order">Track Order</Link>.</p>
  </section></div>;
}
