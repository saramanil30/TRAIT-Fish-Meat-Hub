"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const links = [["/search", "All"], ["/fish", "Fish"], ["/chicken", "Chicken"], ["/mutton", "Mutton"], ["/seafood", "Seafood & Prawns"]] as const;
export function CategoryNavigation() {
  const pathname = usePathname();
  return <nav className="category-nav container" aria-label="Shop categories">{links.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}<span>Choose your cut. Make it your own.</span></nav>;
}
