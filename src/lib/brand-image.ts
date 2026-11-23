import { webpSize } from "./hero-image";
/** Header logos and favicons (Settings → Header logo); mirrored by api.save_store_branding. Sizes are read from the
 *  file header (PNG IHDR or WebP chunk), never from the file name. */
export const brandLogoLimitBytes = 524288;
export const faviconLimitBytes = 32768;
export const touchIconLimitBytes = 131072;
export const desktopLogoBounds = { minHeight: 40, maxHeight: 600, minWidth: 60, maxWidth: 2400 } as const;
export const mobileLogoBounds = { min: 192, max: 1024 } as const;
export type BrandImage = { width: number; height: number; type: "png" | "webp" };
/** Width and height from a PNG's IHDR chunk; null when not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
 const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
 if (bytes.length < 33 || signature.some((b, i) => bytes[i] !== b)) return null;
 if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
 const read = (at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
 const width = read(16), height = read(20);
 return width && height ? { width, height } : null;
}
export function brandImage(bytes: Uint8Array): BrandImage | null {
 const png = pngSize(bytes);
 if (png) return { ...png, type: "png" };
 const webp = webpSize(bytes);
 return webp ? { ...webp, type: "webp" } : null;
}
/** Wide desktop logo: PNG/WebP, 40–600 px tall, at most 2400 px wide, at least 1.5× as wide as tall, ≤ 512 KB. */
export function validDesktopLogo(bytes: Uint8Array): BrandImage | null {
 const image = bytes.length <= brandLogoLimitBytes ? brandImage(bytes) : null;
 const b = desktopLogoBounds;
 return image && image.height >= b.minHeight && image.height <= b.maxHeight && image.width >= b.minWidth && image.width <= b.maxWidth
  && image.width * 2 >= image.height * 3 ? image : null;
}
/** Square mobile logo: PNG/WebP, 192–1024 px, ≤ 512 KB. */
export function validMobileLogo(bytes: Uint8Array): BrandImage | null {
 const image = bytes.length <= brandLogoLimitBytes ? brandImage(bytes) : null;
 return image && image.width === image.height && image.width >= mobileLogoBounds.min && image.width <= mobileLogoBounds.max ? image : null;
}
/** Generated icons: PNG of exactly side×side pixels within the byte limit (32 → favicon, 180 → home-screen icon). */
export function validIconPng(bytes: Uint8Array, side: 32 | 180) {
 const size = bytes.length <= (side === 32 ? faviconLimitBytes : touchIconLimitBytes) ? pngSize(bytes) : null;
 return size?.width === side && size.height === side;
}
export type StoreBranding = { desktopLogo?: { path: string; width: number; height: number }; mobileLogo?: string; favicon?: string; touchIcon?: string; version?: number };
/** Custom header logos as public URLs (each falls back to the built-in logo) and the favicon made from the square logo. */
export type HeaderBrand = { desktop?: { url: string; width: number; height: number }; mobile?: string; icons?: { favicon: string; touch: string } };
const brandPath = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(png|webp)$/;
export const validBrandPath = (path: unknown): path is string => typeof path === "string" && brandPath.test(path);
/** Public URL of a brand-images object; ?v= changes on every save so browsers fetch the new logo and favicon. */
export function brandImageUrl(base: string | undefined, path: string, version?: number) {
 return base?.replace(/\/$/, "") + "/storage/v1/object/public/brand-images/" + path.split("/").map(encodeURIComponent).join("/") + "?v=" + (version ?? 1);
}
