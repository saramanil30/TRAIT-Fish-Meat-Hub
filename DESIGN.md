---
name: TRAIT Fish & Meat Hub
colors:
  surface: '#f8f9ff'
  surface-dim: '#d6dae4'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4fe'
  surface-container: '#eaeef8'
  surface-container-high: '#e4e8f2'
  surface-container-highest: '#dee2ed'
  on-surface: '#171c23'
  on-surface-variant: '#5c403c'
  inverse-surface: '#2c3138'
  inverse-on-surface: '#ecf1fb'
  outline: '#916f6b'
  outline-variant: '#e6bdb8'
  surface-tint: '#be0a17'
  primary: '#9a000d'
  on-primary: '#ffffff'
  primary-container: '#c4121a'
  on-primary-container: '#ffd5d0'
  inverse-primary: '#ffb4ab'
  secondary: '#5d5e62'
  on-secondary: '#ffffff'
  secondary-container: '#dfdfe3'
  on-secondary-container: '#616266'
  tertiary: '#7b3700'
  on-tertiary: '#ffffff'
  tertiary-container: '#a04900'
  on-tertiary-container: '#ffd6c1'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad6'
  primary-fixed-dim: '#ffb4ab'
  on-primary-fixed: '#410002'
  on-primary-fixed-variant: '#93000c'
  secondary-fixed: '#e2e2e6'
  secondary-fixed-dim: '#c6c6ca'
  on-secondary-fixed: '#1a1c1f'
  on-secondary-fixed-variant: '#45474a'
  tertiary-fixed: '#ffdbc9'
  tertiary-fixed-dim: '#ffb68c'
  on-tertiary-fixed: '#321200'
  on-tertiary-fixed-variant: '#753400'
  background: '#f8f9ff'
  on-background: '#171c23'
  surface-variant: '#dee2ed'
typography:
  display-lg:
    fontFamily: Oswald
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: 0.02em
  display-lg-mobile:
    fontFamily: Oswald
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: 0.02em
  headline-lg:
    fontFamily: Oswald
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: 0.01em
  headline-lg-mobile:
    fontFamily: Oswald
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: 0.01em
  headline-md:
    fontFamily: Oswald
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: 0.01em
  headline-sm:
    fontFamily: Oswald
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 26px
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Oswald
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.06em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 4rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---


<!--
TRAIT DESIGN DOCUMENT GOVERNANCE

This file is the source of truth for visual/UI design only.

Priority when documents conflict:
1. PRD.md    - product and business requirements
2. TRD.md    - technical architecture and security requirements
3. DESIGN.md - visual design system and UI presentation

Important:
- Examples in this document (such as delivery times, GPS/pincode behavior, ratings, FSSAI/cold-chain claims, payment brands, promotional badges, or other sample commerce content) are design examples only unless explicitly approved in PRD.md.
- Do not introduce or change business logic from DESIGN.md alone.
- Preserve existing validated TRAIT functionality when applying this design.
-->

## Brand & Style

This design system targets urban Indian households, culinary enthusiasts, and health-conscious consumers demanding uncompromised freshness, hygiene, and traceability in fresh meats and seafood.

The aesthetic philosophy balances **High-Contrast Boldness** with **Modern Culinary Utility**:
- High-impact contrast pairs deep slate/charcoal foundations with crisp whites and vibrant, fresh crimson accents to evoke prime quality and farm-to-table vitality.
- Typography is assertive, industrial, and clean, conveying freshness speed, cold-chain safety, and premium provenance.
- Layouts are scannable, transactional, and confidence-building, integrating hyper-localized e-commerce signals (pincode delivery timers, UPI seals, FSSAI temperature-control guarantees).
- Touch targets and interactions prioritize rapid mobile conversions, instant weight-swapping, and frictionless checkout.

## Colors

The palette establishes an appetizing, clinical, and premium delivery environment:

- **Primary Accent (`#C4121A`)**: A rich, visceral butchery red reserved for critical conversion moments: "Add to Cart", primary checkout CTA, discount badges, and active weight-selector states.
- **Secondary / Deep Slate (`#121417`)**: Near-black charcoal used for dark hero containers, primary headings, promotional callouts, and dark-mode mobile navigation bars.
- **Tertiary Accent (`#F47A1F`)**: Searing flame amber used exclusively for flash sale banners, express delivery badges (e.g., "90-Min Delivery"), and star ratings.
- **Neutral Palette (`#71767F` base)**: 
  - Canvas & Substrates: Crisp White (`#FFFFFF`) for product cards; Soft Slate Tint (`#F8F9FA`) for page background; Light Divider Gray (`#E9ECEF`) for hairline separations.
  - Text Tiers: Primary Ink (`#121417`), Secondary Body (`#495057`), Muted Captions/Units (`#868E96`).
- **Semantic Feedback**: Forest Fresh Green (`#0E8A3C`) for strict "In Stock", "100% Antibiotic-Free", and UPI success statuses.

## Typography

The type system blends authoritative culinary craftsmanship with clear nutritional and transaction legibility:

- **Display & Headings (Oswald)**: Condensed, bold, uppercase-ready. Delivers immediate market impact for category titles (e.g., "FRESHWATER CATCH", "TENDER MUTTON CURRY CUT"), daily fresh deals, and promotional announcements.
- **Body, UI & Numbers (Plus Jakarta Sans)**: Highly legible, open apertures, geometric clarity. Selected to ensure numbers, weight units (g/kg), and the Indian Rupee symbol (₹) remain sharp, unambiguous, and glanceable on high-density mobile screens.
- **Currency & Metric Stacking**: The ₹ symbol must consistently render at the same font-weight and vertical alignment as the integer price value, never floating or baseline-dropped.

## Layout & Spacing

The layout is built on a responsive 12-column grid system for desktop and tablet, converting to a 4-column structure for mobile web and native apps:

- **Desktop (min-width: 1200px)**: 12 columns, `4rem` outer margin, `1.5rem` gutter. Product catalogs use 4-column card arrangements (span-3).
- **Tablet (768px – 1199px)**: 8 columns, `2rem` margin, `1rem` gutter. Product catalogs use 3-column or 2-column grids with horizontal category scrolls.
- **Mobile (< 768px)**: 4 columns, `1rem` margin, `0.75rem` gutter. Product listings default to high-density 2-column cards or full-width vertical compact list cards.
- **Rhythm**: Vertical flow follows an 8-pixel baseline rhythm. Spacing around card content relies strictly on `space-md` interior padding with `space-sm` gaps between unit selectors and price rows.

## Elevation & Depth

Visual hierarchy uses clean surface separation and controlled, food-safe ambient illumination:

- **Level 0 (Flat Canvas)**: Tonal page foundation (`#F8F9FA`). Devoid of shadows, keeps the interface light, airy, and clinical.
- **Level 1 (Product Cards & Resting Surfaces)**: Pure white (`#FFFFFF`) containers lifted with an ambient shadow: `0px 4px 16px rgba(18, 20, 23, 0.06)`, bounded by an ultra-faint border (`1px solid #E9ECEF`) for definition on high-brightness OLED screens.
- **Level 2 (Hovered Cards & Dropdowns)**: Elevated elevation with `0px 10px 24px rgba(18, 20, 23, 0.10)`.
- **Level 3 (Modals, Sticky Bottom Cart Sheets & Cart Drawer)**: High floating elevation: `0px -4px 28px rgba(18, 20, 23, 0.16)`.
- **Hero & Texture Depth**: Hero zones feature deep slate backplates (`#121417` or subtle linear gradients `#1A1D23` to `#121417`) to contrast fresh red cuts and cold-pack packaging.

## Shapes

The design uses a refined **Level 2 (Rounded)** visual baseline to soften dense commerce data without feeling toy-like:

- Standard product cards, banners, and input containers maintain `rounded-lg` (12px / 0.75rem to 16px / 1rem) for an approachable, modern feel.
- Weight-selection toggles (250g, 500g, 1kg), promotional flash tags, and sticky cart action pills employ full pill geometry (`rounded-full` / 9999px) to signal quick tactile tapping.
- Modal panels and bottom sheets feature top-only radiuses of `rounded-xl` (24px / 1.5rem).

## Components

### Buttons & CTAs
- **Primary CTA**: Solid `#C4121A` fill, white Oswald uppercase label, pill or 8px rounded corners. Includes subtle scale micro-interaction (`transform: scale(0.98)` on tap) and a dark-red hover transition (`#A30F16`).
- **Secondary CTA / Stepper**: Crisp white container with a 1.5px `#C4121A` border and red text. In product cards, clicking transitions the button into an interactive quantity stepper (`- [ qty ] +`).

### Product Cards
- **Structure**: Aspect ratio 4:3 or 1:1 image container with rounded top corners, overlaid with tags:
  - Top-left: Net weight / Gross weight label in semi-transparent dark badge.
  - Top-right: Express delivery badge (e.g., "⚡ 90 MINS").
- **Content Area**: Cut name in Oswald Bold, serving size / piece count in muted caption (`3-4 Pieces | Serves 2`), star rating chip with amber star, interactive horizontal pill group for weight selection (`250g`, `500g`, `1kg`), followed by a bottom row with strike-through MRP, bold final price (`₹429`), and the red Add button.

### Weight Selectors (Pills)
- Compact chips: Resting state uses an off-white background (`#F1F3F5`) with dark text. Active state transitions to `#121417` or `#C4121A` fill with white text, triggering an instantaneous price and unit calculation update without full-card re-renders.

### Pincode Verification & Delivery Strip
- A sticky top utility strip featuring an input with auto-detect GPS, verified checkmarks, and dynamic delivery estimates (e.g., "Delivering fresh to **560038, Indiranagar** in **75 mins**").

### Trust & Payment Badges
- Clean horizontally scrollable or grid-based trust seals: FSSAI-compliant cold chain icon, "100% Chemical & Formalin Free" shield, and localized instant payment badges (UPI, Google Pay, PhonePe, Cards) styled in muted monochrome neutrals.

### Form Inputs
- 48px standard touch height, 1px border (`#CED4DA`), expanding to a 2px `#C4121A` ring on focus. Error states trigger an alert tone (`#DC3545`) accompanied by persistent helper text.