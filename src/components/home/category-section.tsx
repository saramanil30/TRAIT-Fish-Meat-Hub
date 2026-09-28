import Image from "next/image";
import Link from "next/link";
import { categories } from "@/data/catalog";
import { Icon } from "@/components/ui/icon";
export function CategorySection() {
  return <section className="category-section" aria-labelledby="category-title"><div className="container"><div className="section-heading"><h2 id="category-title"><Icon name="fish" /> Browse by category</h2><span className="muted desktop-note">Something for every kitchen</span></div><div className="category-grid">{[...categories].sort((a,b) => ["fish","chicken","mutton","seafood"].indexOf(a.slug) - ["fish","chicken","mutton","seafood"].indexOf(b.slug)).map(c => <Link className={"category-card category-" + c.slug} key={c.slug} href={"/" + c.slug}><Image src={c.image} alt="" width={100} height={100} sizes="80px" /><div><h3>{c.name}</h3><p>{c.description}</p></div></Link>)}</div></div></section>;
}
