import type { Product } from "../types/catalog";

/** Catalogue search shared by the header suggestions (in the browser) and the /search page (on the server).
 *  Matches the product name, every local/alias name (the "/"-separated parts of the name and local name), the category
 *  and the description; partial words ("chick", "pom") and small typos ("pomfert", "vanjeram") still match. */

/** Lower case, accents removed, anything that is not a letter or digit becomes a single space. */
export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Edit distance where swapping two neighbouring letters ("pomfert" → "pomfret") counts as one edit. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2][j - 2] + 1);
      rows[i][j] = d; best = Math.min(best, d);
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}

type Field = { tokens: string[]; joined: string; weight: number; loose: boolean };
type Entry<T> = { product: T; fields: Field[]; name: string };

function field(texts: readonly string[], weight: number, loose: boolean): Field {
  const tokens = [...new Set(texts.flatMap(t => normalize(t).split(" ")).filter(Boolean))];
  return { tokens, joined: texts.map(t => normalize(t).replace(/ /g, "")).join(" "), weight, loose };
}

/** Each "/"-separated part of the name and local name: "King Fish / Vanjaram" → ["King Fish", "Vanjaram"]. */
export function aliases(product: Pick<Product, "name" | "localName">): string[] {
  return [...new Set([product.name, product.localName ?? ""].flatMap(n => n.split("/")).map(n => n.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

/** How well one query word matches one field: 1 exact, then prefix, inside a run-together name, inside a word, small typo. */
function wordScore(word: string, f: Field): number {
  let best = 0;
  const stem = word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
  const typos = word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0;
  for (const token of f.tokens) {
    if (token === word || token === stem) return 1;
    if (token.startsWith(word) || (stem !== word && token.startsWith(stem))) best = Math.max(best, 0.85);
    else if (f.loose && word.length >= 3 && token.includes(word)) best = Math.max(best, 0.6);
    else if (f.loose && typos && token.length >= 3) {
      // Whole word ("pomfert" ~ "pomfret") or the start of a longer one while still typing ("chiken" ~ "chicken").
      const whole = editDistance(word, token, typos);
      const start = token.length > word.length ? editDistance(word, token.slice(0, word.length), typos) : typos + 1;
      if (Math.min(whole, start) <= typos) best = Math.max(best, 0.5 - 0.1 * Math.min(whole, start));
    }
  }
  // "kingfish" or "seabass" typed as one word.
  if (!best && f.loose && word.length >= 4 && f.joined.includes(word)) best = 0.7;
  return best;
}

const FILLER = new Set(["fresh", "the", "a", "an", "and", "of", "for", "with", "buy", "online", "near", "me", "price", "kg", "best", "in"]);

export type Searchable = Pick<Product, "name" | "localName" | "category" | "cut" | "available">;

/** Builds the index once; the returned function ranks products for any query (best first; sold-out items rank a little lower). */
export function productSearch<T extends Searchable>(products: readonly T[]): (query: string) => T[] {
  const entries: Entry<T>[] = products.map(p => ({
    product: p,
    name: normalize(p.name),
    fields: [field([p.name], 1, true), field(aliases(p), 0.9, true), field([p.category], 0.6, true), field([p.cut ?? ""], 0.3, false)],
  }));
  return (query: string) => {
    const q = normalize(query);
    const all = q.split(" ").filter(Boolean);
    // "fresh pomfret", "buy chicken": filler words only count when they are the whole query.
    const words = all.some(w => !FILLER.has(w)) ? all.filter(w => !FILLER.has(w)) : all;
    if (!words.length) return [];
    const scored = entries.map(e => {
      // Descriptions only count from three letters, so "po" or "ch" does not match half the catalogue's descriptions.
      const per = words.map(w => Math.max(...e.fields.map(f => f.loose || w.length >= 3 ? f.weight * wordScore(w, f) : 0)));
      const matched = per.filter(s => s > 0).length;
      const total = per.reduce((a, b) => a + b, 0) + (e.name.startsWith(q) ? 0.5 : e.name.includes(q) ? 0.25 : 0) - (e.product.available ? 0 : 0.3);
      return { e, matched, total };
    });
    // Every word must match; for a longer query that finds nothing, fall back to products matching most of its words.
    let hits = scored.filter(s => s.matched === words.length);
    if (!hits.length && words.length > 1) hits = scored.filter(s => s.matched >= Math.ceil(words.length / 2));
    return hits.sort((a, b) => b.matched - a.matched || b.total - a.total || a.e.product.name.localeCompare(b.e.product.name))
      .map(s => s.e.product);
  };
}

export function searchProducts<T extends Searchable>(products: readonly T[], query: string): T[] {
  return productSearch(products)(query);
}
