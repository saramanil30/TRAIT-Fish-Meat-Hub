import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
export const metadata: Metadata = { title: "Page not found" };
export default function NotFound() {
  return <section className="container placeholder"><span className="placeholder-icon"><Icon name="search" width={32} height={32} /></span><p className="eyebrow">Error 404</p><h1>This page is off the menu</h1><p>We couldn&rsquo;t find that page. It may have moved, or the link may be mistyped.</p><div className="placeholder-actions"><Link href="/" className="button primary">Go to home <Icon name="arrow" /></Link><Link href="/search" className="button secondary">Browse all products</Link></div></section>;
}
