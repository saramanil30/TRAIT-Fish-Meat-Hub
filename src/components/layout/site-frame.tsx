"use client";
import { usePathname } from "next/navigation";
import { Header } from "./header";
import { Footer, type FooterStore } from "./footer";
import { WhatsAppButton } from "./whatsapp-button";
import { MobileNav } from "./mobile-nav";
import { CheckoutHeader } from "./checkout-header";
export type NavCategory = { slug: string; name: string };
/** One active offer for the header strip: its text, end date and, when it has one, its coupon code. */
export type StripOffer = { id: string; text: string; ends: string; code?: string };
/** Settings → Social links; the top bar shows an icon only for a link that is set. */
export type SocialLinks = { instagram?: string; facebook?: string };
export function SiteFrame({ children, categories, offers, social, store }: { children: React.ReactNode; categories: NavCategory[]; offers: StripOffer[]; social: SocialLinks; store: FooterStore | null }) {
  const pathname = usePathname();
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  // Cart: the normal header scrolls away with the page and has no category bar.
  // Checkout: distraction-free, with a minimal header (logo, secure checkout, help) and no mobile nav.
  const cart = pathname === "/cart";
  const checkout = pathname === "/checkout" || pathname.startsWith("/checkout/");
  return <>{!admin && (checkout ? <CheckoutHeader /> : <Header categories={categories} offers={offers} social={social} scrolls={cart} showCategories={!cart} />)}<main id="main-content" tabIndex={-1} className={admin ? undefined : "storefront"}>{children}</main>{!admin && <><Footer categories={categories} store={store} />{!checkout && <><WhatsAppButton /><MobileNav /></>}</>}</>;
}
