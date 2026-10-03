import Image from "next/image";
import Link from "next/link";
import { IN_STORE_PHONE } from "@/lib/shop-categories";

/** Distraction-free checkout header: logo home, secure checkout, and a phone number for help. */
export function CheckoutHeader() {
  return <header className="checkout-header"><div className="container checkout-header-row">
    <Link href="/" className="brand" aria-label="TRAIT Fish and Meat Hub home"><Image className="brand-logo" src="/trait-logo.jpeg" alt="TRAIT Fish & Meat Hub official logo" width={1254} height={1254} unoptimized preload /><span className="brand-copy"><strong>TRAIT HUB</strong><small>FISH & MEAT</small></span></Link>
    <p className="checkout-secure"><span aria-hidden="true">🔒</span> Secure checkout</p>
    <a className="checkout-help" href={"tel:+91" + IN_STORE_PHONE}><span>Need help?</span> <strong>{IN_STORE_PHONE}</strong></a>
  </div></header>;
}
