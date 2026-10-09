import "server-only";
import { publicRpc } from "./supabase";
import type { HomepageText } from "./homepage-text";
import type { LinkPreview } from "./link-preview";
/** The published store's custom hero text; {} (built-in text) when none is saved or the store service is unavailable. */
export async function homepageText(): Promise<HomepageText> {
 if (!process.env.TRAIT_STORE_ID) return {};
 try { return (await publicRpc<HomepageText | null>("homepage_text", { target_store: process.env.TRAIT_STORE_ID })) ?? {}; } catch { return {}; }
}
/** The published store's link preview; {} (built-in preview) when none is saved or the store service is unavailable. */
export async function linkPreview(): Promise<LinkPreview> {
 if (!process.env.TRAIT_STORE_ID) return {};
 try { return (await publicRpc<LinkPreview | null>("link_preview", { target_store: process.env.TRAIT_STORE_ID })) ?? {}; } catch { return {}; }
}
