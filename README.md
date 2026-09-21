# TRAIT Fish & Meat Hub

Customer storefront foundation built with Next.js App Router, React, TypeScript and Tailwind CSS.

## Development

Use Node.js 24 and npm. On Windows, use npm.cmd if PowerShell blocks npm.ps1.

- npm ci
- npm run dev
- npm run lint
- npm run typecheck
- npm run build
- npm start

## Structure

- src/app: route pages, metadata and shared shell
- src/components/layout: header, footer, mobile navigation
- src/components/home: home sections
- src/components/product: catalogue and cards
- src/components/ui: icons, search form and placeholder pages
- src/data/catalog.ts: temporary typed product/category data
- src/types/catalog.ts: catalogue contracts
- src/lib/format.ts: currency formatting
- public/images: original temporary SVG illustrations, not product photography

Search and category pages browse the mock catalogue. Client components are limited to interactive product selection, cart state, cart counts and active mobile navigation. Static page sections remain Server Components. Search uses a GET form and server rendering. Available products open a selection panel and can be added to a preview cart; tracking remains a placeholder. No customer information is collected and there is no authentication, checkout, database or Supabase integration.

Fonts use the local system stack; no remote image or font hosts are required. Prices and availability are samples. Replace illustrations with approved product photographs, verify catalogue data and publish contact, delivery and legal information before launch. The cart count reflects the number of configured selections.

Environment files matching .env* are ignored. Never put secrets in client code or NEXT_PUBLIC_ variables.

## Phase 3 preview cart

Product-specific preparation options, selectable raw weights in grams and optional cleaning-loss percentages live in src/data/catalog.ts. Cart calculations in src/lib/cart.ts use integer paise and always charge for raw weight. Estimates apply only to preparations that remove cleaning waste.

The cart uses tab-scoped sessionStorage with an in-memory fallback; stored choices are revalidated and repriced against the mock catalogue on reload. No checkout, order creation or backend is present. Browser totals are display-only: a future server must independently validate selections, availability and current prices.

Run npm run test:cart for calculation and cart-state tests using the installed TypeScript compiler. After a production build, npm run test:cart-browser runs the interactive regression checks using an existing Windows Chrome or Edge installation. Screenshots and browser profiles are written to the OS temporary directory.
