import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteFrame, type StripOffer } from "@/components/layout/site-frame";
import { liveShop } from "@/lib/live-catalogue";
import { shopCategories, type ShopCategory } from "@/lib/shop-categories";
import { currentOffers } from "@/lib/offers";
import { formatMoney } from "@/lib/format";
import { storefrontInfo, storeAddress, hoursLines, phoneDigits } from "@/lib/storefront-info";
import type { FooterStore } from "@/components/layout/footer";
import { linkPreview } from "@/lib/homepage-text-server";
import { defaultLinkPreview, shareImageUrl } from "@/lib/link-preview";


import "./globals.css";


const bodyFont = localFont({
  src: [
    { path: "../../public/fonts/plus-jakarta-sans-400.ttf", weight: "400" },
    { path: "../../public/fonts/plus-jakarta-sans-500.ttf", weight: "500" },
    { path: "../../public/fonts/plus-jakarta-sans-600.ttf", weight: "600" },
    { path: "../../public/fonts/plus-jakarta-sans-700.ttf", weight: "700" },
  ], variable: "--font-body", display: "swap",
});
const headingFont = localFont({
  src: [
    { path: "../../public/fonts/oswald-400.ttf", weight: "400" },
    { path: "../../public/fonts/oswald-500.ttf", weight: "500" },
    { path: "../../public/fonts/oswald-600.ttf", weight: "600" },
    { path: "../../public/fonts/oswald-700.ttf", weight: "700" },
  ], variable: "--font-heading", display: "swap",
});
export const dynamic = "force-dynamic";
// Shared-link preview: Settings → Link preview (title, description, 1200×630 image), or the built-in preview.
// The image is always set here, not via an app/opengraph-image file, because file-based metadata would override it.
export async function generateMetadata(): Promise<Metadata> {
  const saved = await linkPreview();
  const title = saved.title ?? defaultLinkPreview.title, description = saved.description ?? defaultLinkPreview.description;
  const custom = saved.imagePath ? shareImageUrl(saved.imagePath, saved.version) : null;
  const image = custom ? { url: custom, width: 1200, height: 630, alt: title, type: "image/jpeg" } : defaultLinkPreview.image;
  return {
    // Absolute URLs for shared links (Open Graph image); set NEXT_PUBLIC_SITE_URL to the live site address.
    metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
    title: { default: "TRAIT Fish & Meat Hub | Fresh, Your Way", template: "%s | TRAIT Fish & Meat Hub" },
    description: "Fresh fish, seafood, chicken, mutton and eggs from TRAIT Fish & Meat Hub, Kokapet, Hyderabad. Choose your weight and cut; home delivery or store pickup.",
    openGraph: { type: "website", siteName: "TRAIT Fish & Meat Hub", locale: "en_IN", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let categories: ShopCategory[] = [];
  try { const shop = await liveShop(); categories = shopCategories(shop.products, shop.categories); } catch { /* Navigation shows "All" only while the catalogue is unavailable. */ }
  // Current offers for the sticky header strip; text is built here so server and browser render the same dates.
  let offers: StripOffer[] = [];
  try { offers = (await currentOffers()).map(o => ({ id: o.id, code: o.code, text: o.title + (o.code ? "" : " · " + (o.kind === "PERCENT" ? o.value / 100 + "% off" : formatMoney(o.value) + " off")), ends: "ends " + new Date(o.endsAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) })); } catch { /* No strip while offers are unavailable. */ }
  // Footer contact details; hours are formatted here so server and browser render the same text.
  let store: FooterStore | null = null;
  try { const info = await storefrontInfo(); if (info) store = { name: info.name, address: storeAddress(info.address), phone: info.phone ? phoneDigits(info.phone) : null, whatsapp: info.whatsapp ? phoneDigits(info.whatsapp) : info.phone ? phoneDigits(info.phone) : null, hours: hoursLines(info.hours ?? {}), areas: info.delivery ? (info.areas ?? []).map(a => a.name ? a.name + " " + a.pincode : a.pincode) : [] }; } catch { /* Footer shows the brand line only. */ }
  return <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}><body><a className="skip-link" href="#main-content">Skip to content</a><SiteFrame categories={categories.map(({ slug, name }) => ({ slug, name }))} offers={offers} store={store}>{children}</SiteFrame></body></html>;
}
