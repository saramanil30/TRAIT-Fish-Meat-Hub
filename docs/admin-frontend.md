# Admin frontend preview

Entry: `/admin` (also `/admin/login`). Admin preview: `/admin/preview/admin/dashboard`. Owner preview: `/admin/preview/owner/dashboard`. Employee preview: `/admin/preview/employee/orders`.

ADMIN catalogue screens and OWNER operational screens are implemented using the existing local fonts, design tokens and product imagery. Preview drafts are held in component memory and reset on navigation/reload. They do not modify the customer cart, checkout, Supabase, or authentication state. Do not enter real customer or employee information in this public presentation surface.

## Security boundary

Common sign-in and a separate authenticated workspace are now prepared; they remain disabled until the proposed migration and server configuration are deployed. Active database membership determines ADMIN, OWNER or EMPLOYEE. Unauthenticated live paths redirect to login. OWNER catalogue/category and EMPLOYEE management/price preview paths fail closed. Preview routes are public synthetic demonstrations, **not authenticated sessions**; their URL never grants live access.

The new server boundary verifies Supabase Auth identity on the trusted server, loads current active TRAIT staff membership, enforces role and store permissions on every implemented read/mutation, and preserves RLS/grants. Disabling membership must invalidate application authority. Never promote preview UI helpers into authorization checks. Do not wire a live data adapter to the public preview routes.

Employee preview supports Main-store fulfilment, record-only dispatch weights, and UPI evidence. Cash receipt awaits approved limits/policy. Cancellation is ADMIN/OWNER only in the preview pending the final employee operation policy. Evidence never marks a payment paid. Settlement, refunds, staff invitations/recovery, secure image uploads, invoice issuance and payment-provider connection remain explicit integration placeholders. Final-owner removal/demotion is unavailable.

## Frontend behavior

- Dashboard separates intake, fulfilled sales, collections, outstanding amounts, cancellations and refunds.
- Orders offer search, status filters, details, valid fulfilment transitions, pickup handover and append-only in-memory activity.
- ADMIN-only catalogue drafts include names, category, existing image selection, descriptions, featured/retired status, unique raw weights, preparations and preparation-specific loss estimates.
- ADMIN-only categories support creation, renaming, parent selection, sorting and retirement. The preview supports two hierarchy levels.
- Prices are store-specific with in-memory change history; purchased snapshots remain immutable.
- Employee invitations are drafts only; account creation and email delivery do not occur.
- Settings cover store details, delivery/pickup, orders, provider placeholders and business/invoices. Undecided policies remain blank.

## Validation

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, then `npm run test:admin-browser`. The browser test uses installed headless Chrome/Edge and a local production server on port 3217. It verifies denied routes, employee scope, meaningful editing workflows, payment evidence, store-price isolation and layouts at 320/390/768/1440 px. Screenshots are generated under `.next/admin-validation`.

The later approved access-model change adds a proposed forward migration without applying it. See [staff access model](database/staff-access.md) for implemented boundaries, setup, validation and remaining backend work.

