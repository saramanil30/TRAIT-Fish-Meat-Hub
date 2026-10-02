export function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}
export function formatMoney(paise: number): string { return formatPrice(paise / 100); }
export function formatWeight(grams: number): string {
  return grams < 1000 ? grams + " g" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(grams / 1000) + " kg";
}
/** India time, e.g. "02 Oct 2026, 10:51 AM". Built from parts so server and browser render the same text. */
export function formatDateTimeIST(iso: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`;
}
