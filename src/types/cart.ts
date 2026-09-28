import type { PreparationId, PreparationOption, SalePricing } from "./catalog";
export interface ProductSelection {
  preparationId: PreparationId;
  rawWeightGrams?: number;
  quantity?: number;
  specialInstructions: string;
}
export interface CartItem extends ProductSelection, SalePricing {
  id: string;
  productId: string;
  productName: string;
  localName?: string;
  image: string;
  imageAlt: string;
  preparation: PreparationOption;
  pricePerKg: number;
  lineTotalPaise: number;
  estimatedCleanedWeightGrams?: number;
  cleaningLossPercent?: number;
}
