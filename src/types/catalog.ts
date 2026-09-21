export type CategorySlug = "fish" | "seafood" | "chicken" | "mutton";
export type PreparationId = "whole" | "cleaned" | "curry-cut" | "fry-cut" | "boneless" | "skinless";
export interface PreparationOption {
  id: PreparationId;
  label: string;
  removesCleaningWaste: boolean;
}
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
  preparationOptions: readonly PreparationOption[];
  selectableWeightsGrams: readonly number[];
  /** Product-specific estimate, not a guaranteed delivered weight. */
  cleaningLossPercent?: number;
}
