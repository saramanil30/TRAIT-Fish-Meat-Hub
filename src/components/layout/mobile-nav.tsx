"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
const links: {
    href: string;
    label: string;
    icon: IconName;
}[] = [{ href: "/", label: "Home", icon: "home" }, { href: "/search", label: "Search", icon: "search" }, { href: "/track-order", label: "Orders", icon: "orders" }, { href: "/cart", label: "Cart", icon: "bag" }];
export function MobileNav() { const pathname = usePathname(); return <nav className="mobile-nav" aria-label="Mobile navigation">{links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}><Icon name={link.icon}/><span>{link.label}{link.icon === "bag" ? " (0)" : ""}</span></Link>)}</nav>; }
