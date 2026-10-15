/** Homepage content beyond the text: social links, Today's Specials and category photos (api.homepage_content). */
export const specialBadges = { TODAY_SPECIAL: "Today Special", PREMIUM_QUALITY: "Premium Quality", LIMITED_STOCK: "Limited Stock" } as const;
export type SpecialBadge = keyof typeof specialBadges;
export type HomepageSpecial = { productId: string; badge?: SpecialBadge; wasPaise?: number };
export type HomepageContent = { instagram?: string; facebook?: string; specials: HomepageSpecial[]; categoryPhotos: Record<string, string> };
export const emptyHomepageContent: HomepageContent = { specials: [], categoryPhotos: {} };
export const maxSpecials = 12;
/** Mirrors app.valid_social_url: https on the network's own domain, no spaces, quotes, backslashes or angle brackets. */
export function validSocialUrl(value: string, network: "instagram" | "facebook") {
 if (value.length > 300 || /[\s<>"'\\\u0000-\u001f\u007f]/.test(value)) return false;
 return network === "instagram" ? /^https:\/\/(www\.)?instagram\.com\/[^@]*$/i.test(value) : /^https:\/\/((www|m|web)\.)?(facebook\.com|fb\.com)\/[^@]*$/i.test(value);
}
/** Public URL of a category-images object. */
export function categoryPhotoUrl(base: string | undefined, path: string) {
 return base + "/storage/v1/object/public/category-images/" + path.split("/").map(encodeURIComponent).join("/");
}
