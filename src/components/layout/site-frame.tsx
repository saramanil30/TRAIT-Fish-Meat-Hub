"use client";
import { usePathname } from "next/navigation";
import { Header } from "./header";
import { Footer } from "./footer";
import { MobileNav } from "./mobile-nav";
export type NavCategory = { slug: string; name: string };
export function SiteFrame({ children, categories }: { children: React.ReactNode; categories: NavCategory[] }) {
  const pathname = usePathname();
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  return <>{!admin && <Header categories={categories} />}<main id="main-content" tabIndex={-1} className={admin ? undefined : "storefront"}>{children}</main>{!admin && <><Footer categories={categories} /><MobileNav /></>}</>;
}
