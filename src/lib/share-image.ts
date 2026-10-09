/** Link preview images: baseline or progressive JPEG, exactly 1200×630, at most 300 KB (read from the SOF header, not the file name). */
export const shareImageLimitBytes = 300 * 1024;
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
 if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
 for (let i = 2; i + 9 < bytes.length;) {
  if (bytes[i] !== 0xff) return null;
  const marker = bytes[i + 1];
  if (marker === 0xff) { i++; continue; }
  if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
  const length = (bytes[i + 2] << 8) | bytes[i + 3];
  if (length < 2) return null;
  if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
   return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
  i += 2 + length;
 }
 return null;
}
export function validShareJpeg(bytes: Uint8Array) {
 const size = bytes.length <= shareImageLimitBytes ? jpegSize(bytes) : null;
 return size?.width === 1200 && size.height === 630;
}
