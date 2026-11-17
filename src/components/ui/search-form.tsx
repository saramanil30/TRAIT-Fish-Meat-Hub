"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Product } from "@/types/catalog";
import { Icon } from "@/components/ui/icon";
import { productSearch } from "@/lib/search";
import { cardPriceLabel } from "@/lib/pricing";
import { ProductSelection } from "@/components/product/product-selection";
import "./search-form.css";

const MIN_LETTERS = 2;
const SHOWN = 6;

/** The live catalogue, fetched once per page view on first use and shared by every search box on the page. */
let catalogue: Promise<Product[]> | null = null;
function loadCatalogue() {
  catalogue ??= fetch("/api/catalogue").then(r => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
    .then(data => (Array.isArray(data) ? data as Product[] : []))
    .catch(() => { catalogue = null; return []; });
  return catalogue;
}

/** Search box: a plain GET form to /search (Enter or the button; works without JavaScript), plus instant suggestions
 *  after two letters. A suggestion opens the product's options popup; "See all results" opens the results page. */
export function SearchForm({ id, defaultValue = "" }: { id: string; defaultValue?: string }) {
  const [query, setQuery] = useState(defaultValue);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [chosen, setChosen] = useState<Product | null>(null);
  const [added, setAdded] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const listId = useId();
  const search = useMemo(() => (products ? productSearch(products) : null), [products]);
  const trimmed = query.trim();
  const results = useMemo(() => (search && trimmed.length >= MIN_LETTERS ? search(trimmed) : []), [search, trimmed]);
  const shown = results.slice(0, SHOWN);
  const showList = open && trimmed.length >= MIN_LETTERS && products !== null;

  function warm() { if (!products) loadCatalogue().then(setProducts); }

  // Close when a tap or click lands outside the box.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!form.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function choose(product: Product) { setAdded(""); setOpen(false); setActive(-1); setChosen(product); }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setOpen(false); setActive(-1); return; }
    if (!showList || !shown.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(i => (i + 1) % shown.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(i => (i <= 0 ? shown.length - 1 : i - 1)); }
    // Enter with a highlighted suggestion opens it; otherwise the form submits to the results page as usual.
    else if (event.key === "Enter" && active >= 0) { event.preventDefault(); choose(shown[active]); }
  }

  const optionId = (i: number) => listId + "-option-" + i;
  return <><form ref={form} action="/search" role="search" className="search-form" onSubmit={() => setOpen(false)}>
    <label className="sr-only" htmlFor={id}>Search fish, meat and local names</label><Icon name="search" />
    <input id={id} name="q" type="search" placeholder="Search for fish, seafood, meat, eggs..." maxLength={100} autoComplete="off" enterKeyHint="search"
      role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={listId} aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
      value={query} onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); warm(); }} onFocus={() => { warm(); setOpen(true); }} onKeyDown={onKeyDown} />
    <button type="submit" aria-label="Search products"><Icon name="search" /></button>
    <div className="search-suggest" id={listId} role="listbox" aria-label="Suggested products" hidden={!showList}>
      {showList && (shown.length ? <>
        {shown.map((p, i) => <div key={p.id} id={optionId(i)} role="option" aria-selected={i === active} className={"search-option" + (i === active ? " is-active" : "")}
          onPointerEnter={() => setActive(i)} onClick={() => choose(p)}>
          <Image src={p.image} alt="" width={56} height={42} sizes="56px" />
          <span className="search-option-text"><span className="search-option-name">{p.name}</span>{!p.available && <span className="search-option-note">Sold out</span>}</span>
          <span className="search-option-price">{cardPriceLabel(p).replace(" / ", "/")}</span>
        </div>)}
        <a className="search-all" href={"/search?q=" + encodeURIComponent(trimmed)}>See all {results.length} {results.length === 1 ? "result" : "results"} for “{trimmed}”</a>
      </> : <a className="search-all search-none" href={"/search?q=" + encodeURIComponent(trimmed)}>No quick matches for “{trimmed}”. See suggestions</a>)}
    </div>
    <span className="sr-only" role="status" aria-live="polite">{showList ? (shown.length ? results.length + (results.length === 1 ? " product" : " products") + " found" : "No products found") : ""}</span>
    {added && <span className="added-feedback search-added" role="status">{added} added. <Link href="/cart">View cart</Link></span>}
  </form>
  {chosen && <ProductSelection product={chosen} onClose={() => setChosen(null)} onSaved={() => setAdded(chosen.name)} />}</>;
}
