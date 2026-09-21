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

Search and category pages browse the mock catalogue. Only mobile navigation needs a client component for the active route. Search uses a GET form and server rendering. Add buttons are intentionally disabled; cart and tracking are clearly labelled placeholders. No customer information is collected and there is no authentication, checkout, database or Supabase integration.

Fonts use the local system stack; no remote image or font hosts are required. Prices and availability are samples. Replace illustrations with approved product photographs, verify catalogue data and publish contact, delivery and legal information before launch. The cart count remains zero until cart functionality is implemented.

Environment files matching .env* are ignored. Never put secrets in client code or NEXT_PUBLIC_ variables.
