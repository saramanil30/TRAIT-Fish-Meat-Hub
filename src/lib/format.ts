export function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}
export function formatMoney(paise: number): string { return formatPrice(paise / 100); }
export function formatWeight(grams: number): string {
  return grams < 1000 ? grams + " g" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(grams / 1000) + " kg";
}
