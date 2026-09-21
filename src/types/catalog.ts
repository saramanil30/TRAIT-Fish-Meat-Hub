export type CategorySlug = "fish" | "seafood" | "chicken" | "mutton";
export interface Category {
    slug: CategorySlug;
    name: string;
    description: string;
    image: string;
}
export interface Product {
    id: string;
    name: string;
    localName?: string;
    category: CategorySlug;
    pricePerKg: number;
    available: boolean;
    image: string;
    imageAlt: string;
    cut: string;
}
