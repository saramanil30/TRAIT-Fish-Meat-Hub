import type { PreparationId, PreparationOption } from "./catalog";
export interface ProductSelection {
  preparationId: PreparationId;
  rawWeightGrams: number;
  specialInstructions: string;
}
export interface CartItem extends ProductSelection {
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
