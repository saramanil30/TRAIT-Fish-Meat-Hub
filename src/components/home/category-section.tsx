import Image from "next/image";
import Link from "next/link";
import { categories } from "@/data/catalog";
import { Icon } from "@/components/ui/icon";
export function CategorySection() { return <section className="container section" aria-labelledby="category-title"><div className="section-heading"><div><p className="eyebrow">Find your favourites</p><h2 id="category-title">Shop by Category</h2></div><span className="muted desktop-note">Something for every kitchen</span></div><div className="category-grid">{categories.map(c => <Link className={"category-card category-" + c.slug} key={c.slug} href={"/" + c.slug}><Image src={c.image} alt="" width={220} height={165}/><div><h3>{c.name}</h3><p>{c.description}</p></div><Icon name="arrow"/></Link>)}</div></section>; }
