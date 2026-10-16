import { ProductCardBody } from "@/components/product/product-card-body";
import Image from "next/image";
import type { Product } from "@/types/catalog";
import { cardPriceLabel, isRaw, stockLeftText } from "@/lib/pricing";
import { formatMoney } from "@/lib/format";
import { specialBadges, type SpecialBadge } from "@/lib/homepage-content";

/** "₹350/kg"; with a higher "Was ₹" price (entered per the product's own sale unit) shown struck through before it.
 *  NET weight cards show a per-kg price, so a was-price for them is compared and shown per pack instead. */
function CardPrice({ product, wasPaise }: { product: Product; wasPaise?: number }) {
  const label = cardPriceLabel(product).replace(" / ", "/");
  const unitPrice = product.pricePaise ?? Math.round(product.pricePerKg * 100);
  const perPack = !isRaw(product) && product.pricingBasis === "NET_WEIGHT";
  const was = wasPaise && wasPaise > unitPrice ? formatMoney(wasPaise) + (perPack ? "/pack" : label.slice(label.indexOf("/"))) : null;
  if (!was) return <p className="item-card-price"><strong>{label}</strong></p>;
  const now = perPack ? formatMoney(unitPrice) + "/pack" : label;
  return <p className="item-card-price"><s aria-label={"Was " + was}>{was}</s> <strong className="is-sale" aria-label={"Now " + now}>{now}</strong></p>;
}

/** The one product card for the homepage specials, "View All", category pages and search.
 *  Clicking anywhere on an orderable card opens its options popup (see ProductCardBody).
 *  The image badge shows, in order: Sold out, "Only X left", or the homepage special badge; never a plain "Available". */
export function ProductCard({ product, badge, wasPaise }: { product: Product; badge?: SpecialBadge; wasPaise?: number }) {
  const low = product.available ? stockLeftText(product) : null;
  const label = !product.available ? "Sold out" : low ?? (badge ? specialBadges[badge] : null);
  return <article className="item-card">
    <div className="item-card-image"><Image src={product.image} alt={product.imageAlt} width={480} height={360} sizes="(max-width: 767px) 46vw, (max-width: 1199px) 30vw, 20vw" />
      {label && <span className={product.available ? "item-card-badge" : "item-card-badge is-muted"}>{label}</span>}</div>
    <ProductCardBody product={product}><CardPrice product={product} wasPaise={wasPaise} /></ProductCardBody>
  </article>;
}
