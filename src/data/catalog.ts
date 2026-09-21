import type { Category, Product } from "@/types/catalog";
// Temporary catalogue only. Prices and availability are illustrative, not live inventory.
export const categories: readonly Category[] = [
    { slug: "fish", name: "Fish", description: "Everyday favourites & prized catches", image: "/images/fish.svg" },
    { slug: "seafood", name: "Seafood & Prawns", description: "A little taste of the coast", image: "/images/seafood.svg" },
    { slug: "chicken", name: "Chicken", description: "Versatile cuts for family favourites", image: "/images/chicken.svg" },
    { slug: "mutton", name: "Mutton", description: "Rich flavour, carefully chosen cuts", image: "/images/mutton.svg" },
];
export const products: readonly Product[] = [
    { id: "seer", name: "Seer Fish", localName: "Vanjaram", category: "fish", pricePerKg: 980, available: true, image: "/images/fish.svg", imageAlt: "Illustration of a silver fish with herbs and lemon", cut: "Steaks or curry cut" },
    { id: "prawns", name: "White Prawns", localName: "Eral", category: "seafood", pricePerKg: 640, available: true, image: "/images/seafood.svg", imageAlt: "Illustration of pink prawns on a ceramic plate", cut: "Cleaned & deveined" },
    { id: "chicken", name: "Chicken Curry Cut", category: "chicken", pricePerKg: 280, available: true, image: "/images/chicken.svg", imageAlt: "Illustration of raw chicken portions with rosemary", cut: "Bone-in pieces" },
    { id: "mutton", name: "Mutton Curry Cut", category: "mutton", pricePerKg: 890, available: true, image: "/images/mutton.svg", imageAlt: "Illustration of red meat cuts with herbs", cut: "Bone-in pieces" },
    { id: "pomfret", name: "White Pomfret", localName: "Vavval", category: "fish", pricePerKg: 780, available: false, image: "/images/fish.svg", imageAlt: "Illustrative fish category image with lemon and herbs", cut: "Whole, cleaned" },
    { id: "sardines", name: "Sardines", localName: "Mathi", category: "fish", pricePerKg: 240, available: true, image: "/images/fish.svg", imageAlt: "Illustrative fish category image on a ceramic plate", cut: "Cleaned, ready to cook" },
    { id: "breast", name: "Chicken Breast", category: "chicken", pricePerKg: 420, available: true, image: "/images/chicken.svg", imageAlt: "Illustrative chicken category image with herbs", cut: "Boneless" },
    { id: "chops", name: "Mutton Chops", category: "mutton", pricePerKg: 960, available: false, image: "/images/mutton.svg", imageAlt: "Illustration of bone-in red meat chops", cut: "Bone-in chops" },
];
