/** Delivery slots: times are India wall-clock "HH:MM"; dates are India calendar days "YYYY-MM-DD". */
export type SlotStatus = "open" | "closed" | "full";
export type SlotOption = { id: string; name: string; startsAt: string; endsAt: string; cutoffAt: string; status: SlotStatus };
export type SlotDay = { date: string; slots: SlotOption[] };
/** The slot saved with an order (fulfillment snapshot), as tracking, WhatsApp and staff screens show it. */
export type OrderSlot = { id: string; date: string; name: string; startsAt: string; endsAt: string };
export const SLOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLOT_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "07:00" → "7 am", "16:30" → "4:30 pm", "12:00" → "12 pm". */
export function slotTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " am" : " pm");
}
/** "7–11 am", "11 am–2 pm". */
export function slotRange(startsAt: string, endsAt: string): string {
  const a = slotTime(startsAt), b = slotTime(endsAt);
  return a.slice(-2) === b.slice(-2) ? a.slice(0, -3) + "–" + b : a + "–" + b;
}
/** Today's date in India, "YYYY-MM-DD". */
export function istToday(now = Date.now()): string {
  return new Date(now + 330 * 60000).toISOString().slice(0, 10);
}
/** "Today", "Tomorrow", else "Mon". Relative to India's today. */
export function slotDayName(date: string, today = istToday()): string {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
}
/** "Sat, 11 Oct". */
export function slotDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
}
/** "Sat, 11 Oct · Morning, 7–11 am". */
export function slotLabel(slot: Pick<OrderSlot, "date" | "name" | "startsAt" | "endsAt">): string {
  return slotDate(slot.date) + " · " + slot.name + ", " + slotRange(slot.startsAt, slot.endsAt);
}
