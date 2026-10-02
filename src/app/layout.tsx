import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteFrame } from "@/components/layout/site-frame";
import { liveCatalogue } from "@/lib/live-catalogue";
import { shopCategories, type ShopCategory } from "@/lib/shop-categories";


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
  return <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}><body><a className="skip-link" href="#main-content">Skip to content</a><SiteFrame categories={categories.map(({ slug, name, comingSoon }) => ({ slug, name, comingSoon }))}>{children}</SiteFrame></body></html>;
}
