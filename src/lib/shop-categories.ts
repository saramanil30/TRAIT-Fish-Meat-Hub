import type { Product } from "@/types/catalog";

/** Storefront categories, mapped from the live catalogue's top-level category names (lower case). */
const definitions = [
  { slug: "fish", name: "Fish", description: "Everyday favourites & prized catches", image: "/assets/stitch/category-fish.jpg", includes: ["fish", "fresh water", "seafood"] },
  { slug: "seafood", name: "Seafood & Prawns", description: "A little taste of the coast", image: "/assets/stitch/category-seafood.jpg", includes: ["seafood"] },
  { slug: "chicken", name: "Chicken", description: "Versatile cuts for family favourites", image: "/assets/stitch/category-chicken.jpg", includes: ["chicken"] },
  { slug: "mutton", name: "Mutton", description: "Rich flavour, carefully chosen cuts", image: "/assets/stitch/hero-mutton.jpg", includes: ["mutton"] },
  { slug: "eggs", name: "Eggs", description: "Farm-fresh trays", image: "", includes: ["eggs"] },
] as const;

export type ShopCategory = { slug: string; name: string; description: string; image: string; includes: readonly string[] };

export function inCategory(product: Product, category: ShopCategory) {
  return category.includes.includes(product.category);
}

/** Only categories with at least one published product; cards, navigation and filter chips all use this list. */
export function shopCategories(products: readonly Product[]): ShopCategory[] {
  return definitions.flatMap(definition => {
    const members = products.filter(p => (definition.includes as readonly string[]).includes(p.category));
    if (!members.length) return [];
    return [{ ...definition, image: definition.image || members.find(p => !p.image.includes("placeholder"))?.image || members[0].image }];
  });
}

export function shopCategory(slug: string, products: readonly Product[]) {
  return shopCategories(products).find(c => c.slug === slug);
}
