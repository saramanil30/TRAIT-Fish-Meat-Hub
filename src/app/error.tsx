"use client";
import Link from "next/link";
/** Friendly error with a retry for customer pages; nothing technical is shown. */
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <section className="container placeholder"><p className="eyebrow">Something went wrong</p><h1>We couldn&rsquo;t load this page</h1><p>Please check your connection and try again. Your cart is safe.</p><div className="placeholder-actions"><button type="button" className="button primary" onClick={() => retry()}>Try again</button><Link href="/" className="button secondary">Go to home</Link></div></section>;
}
