import "server-only";
import { cache } from "react";
import { publicRpc } from "./supabase";
import type { HomepageText } from "./homepage-text";
import type { LinkPreview } from "./link-preview";
import { emptyHomepageContent, type HomepageContent } from "./homepage-content";
/** The published store's custom hero text; {} (built-in text) when none is saved or the store service is unavailable. */
export const homepageText = cache(async (): Promise<HomepageText> => {
 if (!process.env.TRAIT_STORE_ID) return {};
 try { return (await publicRpc<HomepageText | null>("homepage_text", { target_store: process.env.TRAIT_STORE_ID })) ?? {}; } catch { return {}; }
});
/** The published store's link preview; {} (built-in preview) when none is saved or the store service is unavailable. */
export async function linkPreview(): Promise<LinkPreview> {
 if (!process.env.TRAIT_STORE_ID) return {};
 try { return (await publicRpc<LinkPreview | null>("link_preview", { target_store: process.env.TRAIT_STORE_ID })) ?? {}; } catch { return {}; }
}
/** The published store's social links, specials and category photos; empty when none are saved, the migration is not
 *  applied yet, or the store service is unavailable. Wrapped in cache() so the layout and the homepage share one read. */
export const homepageContent = cache(async (): Promise<HomepageContent> => {
 if (!process.env.TRAIT_STORE_ID) return emptyHomepageContent;
 try {
  const saved = await publicRpc<HomepageContent | null>("homepage_content", { target_store: process.env.TRAIT_STORE_ID });
  return { ...emptyHomepageContent, ...saved, specials: Array.isArray(saved?.specials) ? saved.specials : [], categoryPhotos: saved?.categoryPhotos ?? {} };
 } catch { return emptyHomepageContent; }
});
/** The published store's hero slides (public paths and alt text, in order); [] (built-in photos) when none are saved,
 *  the migration is not applied yet, or the store service is unavailable. */
export const heroSlides = cache(async (): Promise<{ path: string; alt: string }[]> => {
 if (!process.env.TRAIT_STORE_ID) return [];
 try {
  const saved = await publicRpc<{ path?: unknown; alt?: unknown }[] | null>("hero_slides", { target_store: process.env.TRAIT_STORE_ID });
  if (!Array.isArray(saved)) return [];
  return saved.flatMap(s => typeof s?.path === "string" && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/.test(s.path)
   ? [{ path: s.path, alt: typeof s.alt === "string" ? s.alt : "" }] : []).slice(0, 5);
 } catch { return []; }
});
