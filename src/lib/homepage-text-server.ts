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
