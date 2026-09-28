export type CategorySlug = string;
export type PreparationId = string;
export interface PreparationOption {
  id: PreparationId;
  label: string;
  removesCleaningWaste: boolean;
  cleaningLossPercent?: number;
}
export interface Category {
  slug: CategorySlug;
  name: string;
  description: string;
  image: string;
}
export type PricingBasis = 'RAW_WEIGHT' | 'NET_WEIGHT' | 'UNIT' | 'TRAY';
export interface SalePricing {
  pricingBasis?: PricingBasis;
  pricePaise?: number | null;
  priceUnitGrams?: number | null;
  unitsPerPack?: number | null;
}
export interface Product extends SalePricing {
  saleQuantities?: readonly number[];
  orderable?: boolean;
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
