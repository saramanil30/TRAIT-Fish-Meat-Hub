# TRAIT Fish & Meat Hub

Next.js storefront and staff workspace with server-only Supabase integration.

- [Current implementation and remaining launch requirements](docs/final-integration-part-2.md)
- [Vercel Preview setup](docs/staging-deployment.md)
- [Database, Auth and runtime capability configuration](docs/final-integration-part-1.md)

## Development

Use Node.js 24 and npm (`npm.cmd` on Windows if required). Run `npm ci`, then `npm run dev`. Production uses `npm run build` and `npm start`.

Copy variable names from config/environment.example into a secure local/deployment environment. Never commit credentials. `npm run check:environment` reports missing names without values. An unconfigured store shows an unavailable/empty state and checkout/staff access fail closed.

## Live behavior

Catalogue, prices, preparations, delivery rules and contact details come from backend projections. Cart storage contains selections only; checkout obtains an authoritative quote and places orders through an isolated database capability. Encrypted retry envelopes preserve request identity. Tracking exposes minimal status without customer contact details.

Cash collection works through authorized backend operations without a payment gateway. Online preference/reference is evidence only; no provider settlement adapter is configured.

The public Admin / Staff Login link opens /admin. Supabase Auth validates sessions and active membership determines ADMIN, OWNER or EMPLOYEE permissions. Server actions and database RPCs independently enforce scope. Production preview routes are disabled. Browser fixtures are isolated to test processes.

## Validation

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

Database suites: test:staff-db, test:catalogue-db, test:integration-db, test:reporting-db and test:final-db. Additional foundation, delivery and hosted-owner checks are in supabase/validation.

After building, run test:cart-browser, test:checkout-browser, test:admin-browser and test:stitch-browser. These use installed Windows Chrome/Edge and write screenshots/profiles to the OS temporary directory. Fixtures do not certify real hosted Auth or checkout; staging acceptance remains required.

No approved business data or real users are seeded. Storage upload lifecycle, real Auth/email configuration, operational monitoring and hosted race/load acceptance remain launch requirements documented above.
