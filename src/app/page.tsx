import Link from "next/link";
import { Hero } from "@/components/home/hero";
import { CategorySection } from "@/components/home/category-section";
import { Discovery } from "@/components/home/discovery";
import { TrustSection } from "@/components/home/trust-section";
import { ProductGrid } from "@/components/product/product-grid";
import { products } from "@/data/catalog";
import { Icon } from "@/components/ui/icon";
export default function Home() { return <><Hero /><CategorySection /><Discovery /><section className="container section fresh-section" aria-labelledby="fresh-title"><div className="section-heading"><div><p className="eyebrow">Good food, great possibilities</p><h2 id="fresh-title">Fresh Today</h2></div><Link href="/search" className="text-link">View all <Icon name="arrow"/></Link></div><p className="preview-note">Sample catalogue · Prices and availability are illustrative. Local checkout preview available. No real orders or payments.</p><ProductGrid products={products.slice(0, 4)}/></section><TrustSection /></>; }
