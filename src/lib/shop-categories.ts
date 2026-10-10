import type { Product } from "@/types/catalog";

/** A top-level category from the live catalogue, in its display order. */
export type CatalogueCategory = { name: string; sortOrder: number };
/** inStoreOnly: a category with no published products yet; its page shows the "coming soon, call us" notice. */
export type ShopCategory = { slug: string; name: string; description: string; image: string; includes: readonly string[]; inStoreOnly?: boolean };

export const IN_STORE_PHONE = "8686146562";

/** "Crabs & Lobsters" → "crabs-lobsters"; the category page lives at /{slug}. */
export function categorySlug(name: string): string {
  return name.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Optional page copy and tile image per slug; any other category gets a plain description and a product photo. */
const presentation: Record<string, { description: string; image?: string }> = {
  "river-fish": { description: "Freshwater favourites, cleaned and cut your way", image: "/assets/stitch/category-fish.jpg" },
  "sea-fish": { description: "A little taste of the coast", image: "/assets/stitch/category-seafood.jpg" },
  prawns: { description: "Sea and freshwater prawns by the kg", image: "/assets/stitch/prawns.jpg" },
  "crabs-lobsters": { description: "Crabs and lobsters, cleaned to order" },
  chicken: { description: "Versatile cuts for family favourites", image: "/assets/stitch/category-chicken.jpg" },
  mutton: { description: "Rich flavour, carefully chosen cuts", image: "/assets/stitch/hero-mutton.jpg" },
  eggs: { description: "Farm-fresh trays" },
  "dry-fish": { description: "Sun-dried fish from the coast" },
};

export function inCategory(product: Product, category: ShopCategory) {
  return category.includes.includes(product.category);
}

/** Header pills, footer links and category pages, in the catalogue's order. Products carry their top-level category name in lower case. */
export function shopCategories(products: readonly Product[], categories: readonly CatalogueCategory[]): ShopCategory[] {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).flatMap(c => {
    const slug = categorySlug(c.name);
    if (!slug) return [];
    const key = c.name.toLowerCase();
    const members = products.filter(p => p.category === key);
    const copy = presentation[slug];
    return [{ slug, name: c.name, description: copy?.description ?? "Fresh from TRAIT", includes: [key],
      image: copy?.image || members.find(p => !p.image.includes("placeholder"))?.image || members[0]?.image || "/assets/catalogue/placeholder-fish.svg",
      ...(members.length ? {} : { inStoreOnly: true }) }];
  });
}

export function shopCategory(slug: string, products: readonly Product[], categories: readonly CatalogueCategory[]) {
  return shopCategories(products, categories).find(c => c.slug === slug);
}
