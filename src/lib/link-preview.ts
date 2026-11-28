/** Link preview (Open Graph / Twitter card) limits and the built-in text; mirrored by api.save_link_preview. */
export const linkPreviewLimits = { title: 70, description: 200 } as const;
export const defaultLinkPreview = {
 title: "TRAIT Fish & Meat Hub",
 description: "Fresh fish, chicken & mutton, cleaned and cut your way. Delivery in Hyderabad.",
 image: { url: "/og-default.jpeg", width: 1254, height: 1254, alt: "TRAIT Fish & Meat Hub logo" },
};
/** COMPACT: square image (small card, the default). LARGE: the 1200×630 banner (big card). */
export type LinkPreviewStyle = "COMPACT" | "LARGE";
export type LinkPreview = { title?: string; description?: string; imagePath?: string; version?: number; style?: LinkPreviewStyle; squareImagePath?: string; squareImageSize?: number };
/** Public URL of a saved share image; ?v= changes on every save so WhatsApp, Facebook and X fetch the new one. */
export function shareImageUrl(path: string, version?: number) {
 const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
 return base ? base + "/storage/v1/object/public/share-images/" + path.split("/").map(encodeURIComponent).join("/") + "?v=" + (version ?? 1) : null;
}
