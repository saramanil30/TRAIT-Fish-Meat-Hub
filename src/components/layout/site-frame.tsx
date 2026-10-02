"use client";
import { usePathname } from "next/navigation";
import { Header } from "./header";
import { Footer } from "./footer";
import { MobileNav } from "./mobile-nav";
export type NavCategory = { slug: string; name: string };
export function SiteFrame({ children, categories, offers }: { children: React.ReactNode; categories: NavCategory[]; offers: string[] }) {
  const pathname = usePathname();
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  // Cart and checkout: the header (top strip, logo/search/cart row, offer strip) scrolls away with the page.
  const scrolls = pathname === "/cart" || pathname.startsWith("/checkout");
  return <>{!admin && <Header categories={categories} offers={offers} scrolls={scrolls} />}<main id="main-content" tabIndex={-1} className={admin ? undefined : "storefront"}>{children}</main>{!admin && <><Footer categories={categories} /><MobileNav /></>}</>;
}
