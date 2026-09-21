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

Search and category pages browse the mock catalogue. Client components are limited to interactive product selection, cart state, cart counts and active mobile navigation. Static page sections remain Server Components. Search uses a GET form and server rendering. Available products open a selection panel and can be added to a preview cart; checkout and tracking offer a local mock order flow. No customer information is sent to a server and there is no authentication, real payment processing, database or Supabase integration.

Fonts use the local system stack; no remote image or font hosts are required. Prices and availability are samples. Replace illustrations with approved product photographs, verify catalogue data and publish contact, delivery and legal information before launch. The cart count reflects the number of configured selections.

Environment files matching .env* are ignored. Never put secrets in client code or NEXT_PUBLIC_ variables.

## Phase 3 preview cart

Product-specific preparation options, selectable raw weights in grams and optional cleaning-loss percentages live in src/data/catalog.ts. Cart calculations in src/lib/cart.ts use integer paise and always charge for raw weight. Estimates apply only to preparations that remove cleaning waste.

The cart uses tab-scoped sessionStorage with an in-memory fallback; stored choices are revalidated and repriced against the mock catalogue on reload. Checkout creates only local mock receipts; no backend or real order creation is present. Browser totals are display-only: a future server must independently validate selections, availability and current prices.

Run npm run test:cart for calculation and cart-state tests using the installed TypeScript compiler. After a production build, npm run test:cart-browser runs the interactive regression checks using an existing Windows Chrome or Edge installation. Screenshots and browser profiles are written to the OS temporary directory.


## Phase 4 local checkout and order preview

`/checkout` reads the existing cart and collects delivery/pickup details plus a Cash/UPI preference. The details/review steps preserve the draft in memory through client navigation. Successful mock placement clears the cart, resets the draft and displays `/order-confirmation/[token]`. No data is sent to a store or order API and no payment is processed. Use sample customer details.

`src/types/order.ts` defines checkout, receipt, totals and status contracts. `src/lib/order.ts` handles validation and preview totals, reusing raw-weight cart pricing without changing cleaning estimates. `MOCK_DELIVERY_CHARGE_PAISE` is the configurable home-delivery charge (4000 paise); pickup is free. `src/lib/order-store.ts` owns local placement and retains the latest receipt in tab-scoped sessionStorage, with an in-memory fallback if storage is blocked. Drafts do not survive a full reload; receipts do when session storage is available. The local receipt is revalidated against the mock catalogue on reload.

Mock order numbers use `TFM-` plus six digits and are display labels only. Tracking URLs use a separate random UUID, with no customer data in the URL. `/track-order` also offers sample tracking without an order. Demo status controls never mutate an order; pickup skips out-for-delivery and labels completion as Collected. Unknown tokens show an unavailable state without customer details. These local links are not cross-device tracking or a server authorization mechanism.

Phase 5 must replace the local placement adapter with secure server-side order creation. Send product/preparation/weight choices and customer details, then let the server validate, reprice, calculate delivery fees and return an authoritative receipt and secure tracking token. Never trust browser totals or stored prices as authoritative. There is no Supabase, authentication, inventory, admin, payment gateway or API integration in this phase.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. After building, run `npm run test:cart-browser` and `npm run test:checkout-browser` using an installed Windows Chrome/Edge. Browser screenshots/profiles stay in the OS temporary directory.
