import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MobileNav } from "@/components/layout/mobile-nav";
import "./globals.css";
export const metadata: Metadata = { title: { default: "TRAIT Fish & Meat Hub | Fresh, Your Way", template: "%s | TRAIT Fish & Meat Hub" }, description: "Discover fish, seafood, chicken and mutton at TRAIT Fish & Meat Hub. Explore our preview collection - ordering coming soon." };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a><Header /><main id="main-content" tabIndex={-1}>{children}</main><Footer /><MobileNav /></body></html>; }
