/** "Notify me when available": shared wording and links for the push, the WhatsApp message and the storefront. */
export const RESTOCK_DAYS = 7;
/** Where a back-in-stock message sends the customer: a search for the product (works for every category). */
export function restockPath(productName: string) { return "/search?q=" + encodeURIComponent(productName.slice(0, 100)); }
export function restockMessage(productName: string, site: string) { return productName + " is back at TRAIT! Order: " + site + restockPath(productName); }
