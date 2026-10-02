"use client";
import { usePathname } from "next/navigation";
import { Header } from "./header";
import { Footer } from "./footer";
import { MobileNav } from "./mobile-nav";
export type NavCategory = { slug: string; name: string };
export function SiteFrame({ children, categories, offers }: { children: React.ReactNode; categories: NavCategory[]; offers: string[] }) {
  const pathname = usePathname();
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  // The cart page shows no site header (top strip, logo/search/cart row, category nav).
  const header = !admin && pathname !== "/cart";
  return <>{header && <Header categories={categories} offers={offers} />}<main id="main-content" tabIndex={-1} className={admin ? undefined : header ? "storefront" : "storefront headerless"}>{children}</main>{!admin && <><Footer categories={categories} /><MobileNav /></>}</>;
}
