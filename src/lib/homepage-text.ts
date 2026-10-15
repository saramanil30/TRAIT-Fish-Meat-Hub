/** Editable homepage text. Keys and limits mirror app.homepage_text_limits(); a missing key uses the built-in text.
 *  The hero slider has three slides: slide 1 uses badge/headline/subtitle, slide 2 the left* keys, slide 3 the right* keys. */
export const homepageTextFields = [
 { key: "badge", label: "Slide 1 badge", max: 40, fallback: "Fresh & Premium" },
 { key: "headline", label: "Slide 1 headline", max: 60, fallback: "Fresh Seafood & Meat" },
 { key: "subtitle", label: "Slide 1 second line", max: 200, fallback: "Delivered to Your Doorstep" },
 { key: "leftLabel", label: "Slide 2 badge", max: 24, fallback: "Today's Catch" },
 { key: "leftTitle", label: "Slide 2 headline", max: 50, fallback: "Straight From the Coast" },
 { key: "leftSubtitle", label: "Slide 2 second line", max: 80, fallback: "Cleaned and Cut Your Way" },
 { key: "rightLabel", label: "Slide 3 badge", max: 24, fallback: "Tender Meat" },
 { key: "rightTitle", label: "Slide 3 headline", max: 50, fallback: "Chicken & Mutton" },
 { key: "rightSubtitle", label: "Slide 3 second line", max: 80, fallback: "Fresh Cuts for Every Kitchen" },
 { key: "highlight", label: "Tagline (the word TRAIT shows in red)", max: 40, fallback: "Quality is Our TRAIT." },
 { key: "button", label: "Button label", max: 30, fallback: "Shop now" },
 { key: "trust1", label: "Hero trust label 1", max: 30, fallback: "Freshly Sourced" },
 { key: "trust2", label: "Hero trust label 2", max: 30, fallback: "Hygienically Cleaned" },
 { key: "trust3", label: "Hero trust label 3", max: 30, fallback: "Premium Quality" },
 { key: "trust4", label: "Hero trust label 4", max: 30, fallback: "On-Time Delivery" },
 { key: "bannerTitle", label: "Bottom banner title", max: 60, fallback: "Freshness. Quality. Trust." },
] as const;
export type HomepageTextKey = typeof homepageTextFields[number]["key"];
export type HomepageText = Partial<Record<HomepageTextKey, string>>;
/** Plain text: no control characters (including line breaks) and no angle brackets. */
export const homepageTextPattern = /[\u0000-\u001f\u007f<>]/;
/** Every field resolved: the saved text, or the built-in text when it is missing or blank. */
export function resolveHomepageText(saved: HomepageText): Record<HomepageTextKey, string> {
 return Object.fromEntries(homepageTextFields.map(f => [f.key, saved[f.key]?.trim() || f.fallback])) as Record<HomepageTextKey, string>;
}
