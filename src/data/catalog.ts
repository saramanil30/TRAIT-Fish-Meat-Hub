import type { Category, Product } from "@/types/catalog";
// Temporary catalogue only. Prices and availability are illustrative, not live inventory.
export const categories: readonly Category[] = [
    { slug: "fish", name: "Fish", description: "Everyday favourites & prized catches", image: "/assets/stitch/category-fish.jpg" },
    { slug: "seafood", name: "Seafood & Prawns", description: "A little taste of the coast", image: "/assets/stitch/category-seafood.jpg" },
    { slug: "chicken", name: "Chicken", description: "Versatile cuts for family favourites", image: "/assets/stitch/category-chicken.jpg" },
    { slug: "mutton", name: "Mutton", description: "Rich flavour, carefully chosen cuts", image: "/assets/stitch/hero-mutton.jpg" },
];
const weights = [500, 1000, 1500, 2000] as const;
const whole = { id: "whole", label: "Whole", removesCleaningWaste: false } as const;
const cleaned = { id: "cleaned", label: "Cleaned", removesCleaningWaste: true } as const;
const curry = { id: "curry-cut", label: "Curry Cut", removesCleaningWaste: true } as const;
const fry = { id: "fry-cut", label: "Fry Cut", removesCleaningWaste: true } as const;
const boneless = { id: "boneless", label: "Boneless", removesCleaningWaste: true } as const;
const skinless = { id: "skinless", label: "Skinless", removesCleaningWaste: true } as const;

export const products: readonly Product[] = [
    { id: "seer", selectableWeightsGrams: weights, preparationOptions: [whole, cleaned, curry, fry], cleaningLossPercent: 25, name: "Seer Fish", localName: "Vanjaram", category: "fish", pricePerKg: 980, available: true, image: "/assets/stitch/seer-fish.jpg", imageAlt: "Illustrative kingfish steaks on ice with herbs", cut: "Steaks or curry cut" },
    { id: "prawns", selectableWeightsGrams: weights, preparationOptions: [whole, cleaned], name: "White Prawns", localName: "Eral", category: "seafood", pricePerKg: 640, available: true, image: "/assets/stitch/prawns.jpg", imageAlt: "Illustrative prawns arranged on ice with lemon", cut: "Cleaned & deveined" },
    { id: "chicken", selectableWeightsGrams: weights, preparationOptions: [curry, skinless], name: "Chicken Curry Cut", category: "chicken", pricePerKg: 280, available: true, image: "/assets/stitch/category-chicken.jpg", imageAlt: "Illustrative raw chicken portions on a stone counter", cut: "Bone-in pieces" },
    { id: "mutton", selectableWeightsGrams: weights, preparationOptions: [curry, boneless], name: "Mutton Curry Cut", category: "mutton", pricePerKg: 890, available: true, image: "/assets/stitch/mutton-curry.jpg", imageAlt: "Illustrative bone-in mutton curry cuts with spices", cut: "Bone-in pieces" },
    { id: "pomfret", selectableWeightsGrams: weights, preparationOptions: [whole, cleaned, fry], cleaningLossPercent: 25, name: "White Pomfret", localName: "Vavval", category: "fish", pricePerKg: 780, available: false, image: "/images/fish.svg", imageAlt: "Illustrative fish category image with lemon and herbs", cut: "Whole, cleaned" },
    { id: "sardines", selectableWeightsGrams: weights, preparationOptions: [whole, cleaned, fry], cleaningLossPercent: 25, name: "Sardines", localName: "Mathi", category: "fish", pricePerKg: 240, available: true, image: "/images/fish.svg", imageAlt: "Illustrative fish category image on a ceramic plate", cut: "Cleaned, ready to cook" },
    { id: "breast", selectableWeightsGrams: weights, preparationOptions: [boneless, skinless], name: "Chicken Breast", category: "chicken", pricePerKg: 420, available: true, image: "/assets/stitch/chicken-breast.jpg", imageAlt: "Illustrative chicken breast fillets with rosemary", cut: "Boneless" },
    { id: "chops", selectableWeightsGrams: weights, preparationOptions: [curry], name: "Mutton Chops", category: "mutton", pricePerKg: 960, available: false, image: "/images/mutton.svg", imageAlt: "Illustration of bone-in red meat chops", cut: "Bone-in chops" },
];
