import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteFrame } from "@/components/layout/site-frame";
import { liveCatalogue } from "@/lib/live-catalogue";
import { shopCategories, type ShopCategory } from "@/lib/shop-categories";
import { currentOffers } from "@/lib/offers";
import { formatMoney } from "@/lib/format";
import { storefrontInfo, storeAddress, hoursLines, phoneDigits } from "@/lib/storefront-info";
import type { FooterStore } from "@/components/layout/footer";


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
export const metadata: Metadata = {
  title: { default: "TRAIT Fish & Meat Hub | Fresh, Your Way", template: "%s | TRAIT Fish & Meat Hub" },
  description: "Explore fish, seafood, chicken and mutton. Choose your raw weight and preparation at TRAIT.",
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let categories: ShopCategory[] = [];
  try { categories = shopCategories(await liveCatalogue()); } catch { /* Navigation shows "All" only while the catalogue is unavailable. */ }
  // Current offers for the sticky header strip; text is built here so server and browser render the same dates.
  let offers: string[] = [];
  try { offers = (await currentOffers()).map(o => o.title + " · " + (o.code ? "Use code " + o.code : (o.kind === "PERCENT" ? o.value / 100 + "% off" : formatMoney(o.value) + " off")) + " · ends " + new Date(o.endsAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })); } catch { /* No strip while offers are unavailable. */ }
  // Footer contact details; hours are formatted here so server and browser render the same text.
  let store: FooterStore | null = null;
  try { const info = await storefrontInfo(); if (info) store = { name: info.name, address: storeAddress(info.address), phone: info.phone ? phoneDigits(info.phone) : null, whatsapp: info.whatsapp ? phoneDigits(info.whatsapp) : info.phone ? phoneDigits(info.phone) : null, hours: hoursLines(info.hours ?? {}), areas: info.delivery ? (info.areas ?? []).map(a => a.name ? a.name + " " + a.pincode : a.pincode) : [] }; } catch { /* Footer shows the brand line only. */ }
  return <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}><body><a className="skip-link" href="#main-content">Skip to content</a><SiteFrame categories={categories.map(({ slug, name }) => ({ slug, name }))} offers={offers} store={store}>{children}</SiteFrame></body></html>;
}
