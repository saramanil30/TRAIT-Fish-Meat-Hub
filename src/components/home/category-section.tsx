import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { ShopCategory } from "@/lib/shop-categories";
export function CategorySection({ categories }: { categories: readonly ShopCategory[] }) {
  if (!categories.length) return null;
  return <section className="category-section" aria-labelledby="category-title"><div className="container"><div className="section-heading"><h2 id="category-title"><Icon name="fish" /> Browse by category</h2><span className="muted desktop-note">Something for every kitchen</span></div><div className="category-grid">{categories.map(c => <Link className={"category-card category-" + c.slug} key={c.slug} href={"/" + c.slug}><Image src={c.image} alt="" width={100} height={100} sizes="80px" /><div><h3>{c.name}</h3><p>{c.description}</p></div></Link>)}</div></div></section>;
}
