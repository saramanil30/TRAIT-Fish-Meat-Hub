import { SERVICE_CITY, SERVICE_STATE } from "./order";

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * One delivery line in reading order: house/street, area, city, state pincode.
 * Parts the customer repeated (area, city, state or pincode typed into the street line) appear once.
 * The landmark is returned separately.
 */
export function deliveryAddress(a: Record<string, string | undefined> = {}) {
  const city = a.city?.trim() || SERVICE_CITY, state = a.state?.trim() || SERVICE_STATE, pincode = a.pincode?.trim() ?? "";
  const seen = new Set([city, state, pincode, state + " " + pincode].map(key));
  const parts: string[] = [];
  for (const field of [a.line1, a.locality]) for (const segment of (field ?? "").split(",")) {
    const text = segment.trim();
    if (!text || seen.has(key(text))) continue;
    seen.add(key(text));
    parts.push(text);
  }
  parts.push(city, [state, pincode].filter(Boolean).join(" "));
  return { line: parts.join(", "), landmark: a.line2?.trim() || "" };
}
