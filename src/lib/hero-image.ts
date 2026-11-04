/** Homepage hero slides: WebP, at least 1600 px wide, at most 1 MB, up to 5 per store (read from the WebP header, not the file name). */
export const heroImageLimitBytes = 1048576;
export const heroImageMinWidth = 1600;
export const maxHeroSlides = 5;
/** Width and height from a WebP file's first chunk (lossy VP8, lossless VP8L or extended VP8X); null when not a WebP. */
export function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
 const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
 if (bytes.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP") return null;
 // The RIFF size covers everything after the first 8 bytes; a mismatch means a truncated or padded file.
 const riff = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
 if (riff + 8 !== bytes.length && riff + 9 !== bytes.length) return null;
 const chunk = ascii(12, 16);
 if (chunk === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
 if (chunk === "VP8 ") {
  if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
  return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
 }
 if (chunk === "VP8L") {
  if (bytes[20] !== 0x2f) return null;
  const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
 }
 return null;
}
/** A hero photo the server accepts: a WebP of at most 1 MB and at least 1600 px wide. Returns its width, or null. */
export function validHeroWebp(bytes: Uint8Array): number | null {
 if (bytes.length > heroImageLimitBytes) return null;
 const size = webpSize(bytes);
 return size && size.width >= heroImageMinWidth && size.height > 0 ? size.width : null;
}
/** Public URL of a hero-images object. */
export function heroImageUrl(base: string | undefined, path: string) {
 return base + "/storage/v1/object/public/hero-images/" + path.split("/").map(encodeURIComponent).join("/");
}
