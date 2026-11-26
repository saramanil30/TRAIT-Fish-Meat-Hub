"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Hides items whose `data-search` text doesn't contain every word; returns how many match.
 *  Items without `data-search` (such as "Add product") always stay visible. */
function applyFilter(list: HTMLElement | null, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  let count = 0;
  list?.querySelectorAll<HTMLElement>("[data-search]").forEach(item => {
    const match = words.every(w => item.dataset.search!.toLowerCase().includes(w));
    item.hidden = !match;
    if (match) count++;
  });
  return count;
}

/** Search box for the staff product lists (Catalogue, and Prices & Availability). */
export function CatalogueSearch({ children, total, placeholder = "Search products by name, local name or category…" }: { children: ReactNode; total: number; placeholder?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(total);
  // Rows re-mount after a save (Prices), so re-apply the current filter after every render.
  useEffect(() => { applyFilter(list.current, query); });
  return <>
    <div className="admin-toolbar catalogue-search">
      <input type="search" aria-label="Search products" placeholder={placeholder} value={query} onChange={e => { setQuery(e.target.value); setShown(applyFilter(list.current, e.target.value)); }} />
      <span className="admin-muted" role="status">{query ? `${shown} of ${total} products` : `${total} products`}</span>
    </div>
    <div ref={list}>{children}</div>
    {query && !shown && <p className="admin-empty">No products match &ldquo;{query}&rdquo;.</p>}
  </>;
}
