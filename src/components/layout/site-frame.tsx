"use client";
import { usePathname } from "next/navigation";
import { Header } from "./header";
import { Footer } from "./footer";
import { MobileNav } from "./mobile-nav";
import { CheckoutHeader } from "./checkout-header";
export type NavCategory = { slug: string; name: string };
export function SiteFrame({ children, categories, offers }: { children: React.ReactNode; categories: NavCategory[]; offers: string[] }) {
  const pathname = usePathname();
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  // Cart: the normal header scrolls away with the page and has no category bar.
  // Checkout: distraction-free, with a minimal header (logo, secure checkout, help) and no mobile nav.
  const cart = pathname === "/cart";
  const checkout = pathname === "/checkout" || pathname.startsWith("/checkout/");
  return <>{!admin && (checkout ? <CheckoutHeader /> : <Header categories={categories} offers={offers} scrolls={cart} showCategories={!cart} />)}<main id="main-content" tabIndex={-1} className={admin ? undefined : "storefront"}>{children}</main>{!admin && <><Footer categories={categories} />{!checkout && <MobileNav />}</>}</>;
}
