import type { Product, PreparationOption } from "../types/catalog";
import type { CartItem, ProductSelection } from "../types/cart";

export const MAX_INSTRUCTIONS_LENGTH = 300;

// Display-only calculations. A future server must independently validate product,
// availability, preparation and raw weight and recalculate using its current price.
export function calculateLineTotalPaise(pricePerKg: number, rawWeightGrams: number): number {
  if (!Number.isFinite(pricePerKg) || pricePerKg < 0 || !Number.isSafeInteger(rawWeightGrams) || rawWeightGrams <= 0) {
    throw new Error("Please choose a valid raw weight and product price.");
  }
  const pricePerKgPaise = Math.round(pricePerKg * 100);
  const total = Math.round((pricePerKgPaise * rawWeightGrams) / 1000);
  if (!Number.isSafeInteger(total)) throw new Error("This weight is too large.");
  return total;
}

export function estimateCleanedWeightGrams(rawWeightGrams: number, lossPercent?: number): number | undefined {
  if (lossPercent === undefined) return undefined;
  if (!Number.isFinite(lossPercent) || lossPercent < 0 || lossPercent >= 100 || !Number.isSafeInteger(rawWeightGrams) || rawWeightGrams <= 0) {
    throw new Error("Invalid cleaning estimate.");
  }
  return Math.round(rawWeightGrams * (1 - lossPercent / 100));
}

export function applicableCleaningLoss(product: Product, preparation: PreparationOption): number | undefined {
  return preparation.cleaningLossPercent ?? (preparation.removesCleaningWaste ? product.cleaningLossPercent : undefined);
}

export function createCartItem(product: Product, selection: ProductSelection, id: string): CartItem {
  if (!product.available) throw new Error("This product is currently sold out.");
  const preparation = product.preparationOptions.find(option => option.id === selection.preparationId);
  if (!preparation) throw new Error("Please choose an available preparation.");
  if (!product.selectableWeightsGrams.includes(selection.rawWeightGrams)) throw new Error("Please choose an available raw weight.");
  if (selection.specialInstructions.length > MAX_INSTRUCTIONS_LENGTH) throw new Error("Please keep instructions within 300 characters.");
  const cleaningLossPercent = applicableCleaningLoss(product, preparation);
  return {
    ...selection,
    specialInstructions: selection.specialInstructions.trim(),
    id,
    productId: product.id,
    productName: product.name,
    localName: product.localName,
    image: product.image,
    imageAlt: product.imageAlt,
    preparation,
    pricePerKg: product.pricePerKg,
    lineTotalPaise: calculateLineTotalPaise(product.pricePerKg, selection.rawWeightGrams),
    cleaningLossPercent,
    estimatedCleanedWeightGrams: estimateCleanedWeightGrams(selection.rawWeightGrams, cleaningLossPercent),
  };
}

function isSameSelection(a: CartItem, b: CartItem): boolean {
  return (
    a.productId === b.productId &&
    a.preparationId === b.preparationId &&
    a.rawWeightGrams === b.rawWeightGrams &&
    a.specialInstructions.normalize("NFC").trim() === b.specialInstructions.normalize("NFC").trim()
  );
}
export type CartAction =
  | { type: "add"; item: CartItem }
  | { type: "update"; item: CartItem }
  | { type: "remove"; id: string }
  | { type: "clear" };

export function cartReducer(
  items: readonly CartItem[],
  action: CartAction
): readonly CartItem[] {
  switch (action.type) {
    case "add":
      if (items.some(item => isSameSelection(item, action.item))) {
        throw new Error("This selection is already in your cart.");
      }
      return [...items, action.item];

    case "update":
      if (items.some(item => item.id !== action.item.id && isSameSelection(item, action.item))) {
        throw new Error("This selection is already in your cart.");
      }
      return items.map((item) =>
        item.id === action.item.id ? action.item : item
      );

    case "remove":
      return items.filter((item) => item.id !== action.id);

    case "clear":
      return [];
  }
}

export function cartSubtotalPaise(items: readonly CartItem[]): number {
  return items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
}

// Store only choices, never authoritative prices. Restore against the current mock
// catalogue and discard invalid/stale entries. This is UX hygiene, not a security boundary.
export function serializeCart(items: readonly CartItem[]): string {
  return JSON.stringify({ version: 1, items: items.map(({ id, productId, preparationId, rawWeightGrams, specialInstructions }) => ({ id, productId, preparationId, rawWeightGrams, specialInstructions })) });
}
export function restoreCart(value: string | null, products: readonly Product[]): readonly CartItem[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1 || !("items" in parsed) || !Array.isArray(parsed.items)) return [];
    const result: CartItem[] = [];
    for (const entry of parsed.items) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.productId !== "string" || typeof entry.preparationId !== "string" || typeof entry.rawWeightGrams !== "number" || typeof entry.specialInstructions !== "string") continue;
      if (result.some(item => item.id === entry.id)) continue;
      const product = products.find(product => product.id === entry.productId);
      const preparation = product?.preparationOptions.find(option => option.id === entry.preparationId);
      if (!product || !preparation) continue;
      try {
        const item = createCartItem(product, { preparationId: preparation.id, rawWeightGrams: entry.rawWeightGrams, specialInstructions: entry.specialInstructions }, entry.id);
        if (!result.some(existing => isSameSelection(existing, item))) result.push(item);
      } catch { /* Discard stale choices, for example a now-unavailable product. */ }
    }
    return result;
  } catch { return []; }
}
