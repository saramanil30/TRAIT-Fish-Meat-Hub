import { Hero } from "@/components/home/hero";
import { HomeBanner, ShopByCategory, TodaysSpecials, TrustStrip, type SpecialItem } from "@/components/home/storefront-sections";
import { liveShop } from "@/lib/live-catalogue";
import { shopCategories } from "@/lib/shop-categories";
import { homepageContent, homepageText } from "@/lib/homepage-text-server";
import { resolveHomepageText } from "@/lib/homepage-text";
import { categoryPhotoUrl } from "@/lib/homepage-content";
export default async function Home() {
  const [shop, content, text] = await Promise.all([liveShop(), homepageContent(), homepageText()]);
  const photos = Object.fromEntries(Object.entries(content.categoryPhotos).map(([id, path]) => [id, categoryPhotoUrl(process.env.SUPABASE_URL, path)]));
  // Settings → Today's Specials, in order, for products listed in this store; until any are chosen, the first five available products.
  const byId = new Map(shop.products.map(p => [p.id, p]));
  const chosen: SpecialItem[] = content.specials.flatMap(s => { const product = byId.get(s.productId); return product && product.orderable !== false ? [{ product, badge: s.badge, wasPaise: s.wasPaise }] : []; });
  const specials = content.specials.length ? chosen : shop.products.filter(p => p.available && p.orderable !== false).slice(0, 5).map(product => ({ product }));
  const t = resolveHomepageText(text);
  return <><Hero /><div className="home-page"><ShopByCategory categories={shopCategories(shop.products, shop.categories, photos)} /><TodaysSpecials items={specials} /><TrustStrip /><HomeBanner title={t.bannerTitle} tagline={t.highlight} button={t.button} /></div></>;
}
