import type { Product } from "@/types/catalog";

/** Storefront categories, mapped from the live catalogue's top-level category names (lower case). */
const definitions = [
  { slug: "fish", name: "Fish", description: "Everyday favourites & prized catches", image: "/assets/stitch/category-fish.jpg", includes: ["fish", "fresh water", "seafood"] },
  { slug: "seafood", name: "Seafood & Prawns", description: "A little taste of the coast", image: "/assets/stitch/category-seafood.jpg", includes: ["seafood"] },
  { slug: "chicken", name: "Chicken", description: "Versatile cuts for family favourites", image: "/assets/stitch/category-chicken.jpg", includes: ["chicken"], announce: true },
  { slug: "mutton", name: "Mutton", description: "Rich flavour, carefully chosen cuts", image: "/assets/stitch/hero-mutton.jpg", includes: ["mutton"], announce: true },
  { slug: "eggs", name: "Eggs", description: "Farm-fresh trays", image: "", includes: ["eggs"] },
] as const;

/** inStoreOnly: an announced category with no published products yet (sold in store); it shows a normal product grid once products exist. */
export type ShopCategory = { slug: string; name: string; description: string; image: string; includes: readonly string[]; inStoreOnly?: boolean };

export const IN_STORE_PHONE = "8686146562";

export function inCategory(product: Product, category: ShopCategory) {
  return category.includes.includes(product.category);
}

/** Categories with published products, plus announced ones sold in store for now; navigation and filter chips use this list. */
export function shopCategories(products: readonly Product[]): ShopCategory[] {
  return definitions.flatMap(definition => {
    const members = products.filter(p => (definition.includes as readonly string[]).includes(p.category));
    if (!members.length) return "announce" in definition && definition.announce ? [{ ...definition, inStoreOnly: true }] : [];
    return [{ ...definition, image: definition.image || members.find(p => !p.image.includes("placeholder"))?.image || members[0].image }];
  });
}

export function shopCategory(slug: string, products: readonly Product[]) {
  return shopCategories(products).find(c => c.slug === slug);
}
