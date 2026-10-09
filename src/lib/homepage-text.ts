/** Editable homepage hero text. Keys and limits mirror app.homepage_text_limits(); a missing key uses the built-in text. */
export const homepageTextFields = [
 { key: "badge", label: "Badge", max: 40, fallback: "Welcome to TRAIT" },
 { key: "headline", label: "Headline (white part)", max: 60, fallback: "Fresh Fish & Tender Meat," },
 { key: "highlight", label: "Headline (red highlighted part)", max: 40, fallback: "Prepared Your Way." },
 { key: "subtitle", label: "Subtitle", max: 200, fallback: "From everyday meals to weekend favourites, discover the right catch and cut for your kitchen." },
 { key: "button", label: "Button label", max: 30, fallback: "Explore the collection" },
 { key: "leftLabel", label: "Left card label", max: 24, fallback: "FISH & SEAFOOD" },
 { key: "leftTitle", label: "Left card title", max: 50, fallback: "Find your favourite catch" },
 { key: "leftSubtitle", label: "Left card subtitle", max: 80, fallback: "Whole, cleaned or cut your way" },
 { key: "rightLabel", label: "Right card label", max: 24, fallback: "CHICKEN & MUTTON" },
 { key: "rightTitle", label: "Right card title", max: 50, fallback: "A cut for every kitchen" },
 { key: "rightSubtitle", label: "Right card subtitle", max: 80, fallback: "Make your next meal your own" },
] as const;
export type HomepageTextKey = typeof homepageTextFields[number]["key"];
export type HomepageText = Partial<Record<HomepageTextKey, string>>;
/** Plain text: no control characters (including line breaks) and no angle brackets. */
export const homepageTextPattern = /[\u0000-\u001f\u007f<>]/;
/** Every field resolved: the saved text, or the built-in text when it is missing or blank. */
export function resolveHomepageText(saved: HomepageText): Record<HomepageTextKey, string> & { customHeadline: boolean } {
 const text = Object.fromEntries(homepageTextFields.map(f => [f.key, saved[f.key]?.trim() || f.fallback])) as Record<HomepageTextKey, string>;
 return { ...text, customHeadline: !!saved.headline?.trim() };
}
