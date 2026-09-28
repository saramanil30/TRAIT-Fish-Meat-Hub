"use client";
import { usePathname } from "next/navigation";
import { Header } from "./header";
import { Footer } from "./footer";
import { MobileNav } from "./mobile-nav";
export function SiteFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  return <>{!admin && <Header />}<main id="main-content" tabIndex={-1}>{children}</main>{!admin && <><Footer /><MobileNav /></>}</>;
}

