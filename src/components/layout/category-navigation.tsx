"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavCategory } from "./site-frame";
export function CategoryNavigation({ categories }: { categories: NavCategory[] }) {
  const pathname = usePathname();
  const links = [{ href: "/search", label: "All", soon: false }, ...categories.map(c => ({ href: "/" + c.slug, label: c.name, soon: !!c.comingSoon }))];
  return <nav className="category-nav container" aria-label="Shop categories">{links.map(({ href, label, soon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}{soon && <span className="soon-tag">Coming soon</span>}</Link>)}<span>Choose your cut. Make it your own.</span></nav>;
}
