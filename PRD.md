# TRAIT Fish & Meat Hub --- Product Requirements Document (PRD)

**Version:** 1.0\
**Prepared:** September 2026\
**Status:** Living project specification

> This is a living document. Codex may update it when an approved
> product requirement changes. Do not silently change business rules;
> record material changes in the Change Log.

## 1. Product Vision

TRAIT Fish & Meat Hub is a mobile-first online ordering platform for
fresh fish, chicken, mutton, seafood/prawns and future categories. It
should feel like a premium local store rather than a marketplace: fast
catalogue browsing, clear raw-weight pricing, simple preparation
selection, guest checkout, secure payments, order tracking, and a
protected staff/admin workspace.

## 2. Product Goals

-   Make **All, Fish, Chicken, Mutton** immediately visible as primary
    catalogue filters.
-   Allow customers to find products quickly, choose preparation and raw
    weight, and add them to a duplicate-safe cart.
-   Price applicable products by **raw weight** and communicate
    estimated cleaning loss only where configured.
-   Support **Cash on Delivery / Cash at pickup** and a third-party
    online/UPI payment gateway.
-   Give **ADMIN** catalogue-master control and **OWNER** daily prices,
    availability, employee access, permitted payments, reports and operational settings.
-   Give **EMPLOYEE** accounts only the operational access needed for
    assigned stores.
-   Use Supabase as the secure backend and Vercel/Next.js as the trusted
    application boundary.
-   Keep the system branch-ready without overengineering multi-store
    operations today.

## 3. User Roles

### Guest Customer

Can browse, filter All/Fish/Chicken/Mutton, configure products, manage
cart, checkout, choose payment method, and securely track their own
order.

### ADMIN

Developer/platform administrator. Full catalogue-master control within the
provisioned business, plus permitted business operations. ADMIN authority
cannot be granted by OWNER or editable Auth metadata.

### OWNER

Shop/business operator. Business-wide permitted orders, necessary customer
information, status updates, policy-controlled payments, reports, employee
access and operational settings. For existing products, OWNER may change
only daily selling price and Available / Sold Out state. OWNER may also
create and manage order-level store offers (Section 10.3); offers never
alter catalogue masters, selling prices or price history.

Hierarchy: **ADMIN > OWNER > EMPLOYEE**.

### EMPLOYEE

Assigned-store operations only: order queue, necessary customer/delivery
information, permitted fulfillment/status updates, operational
measurements, cash receipt within policy, and UPI reference submission.
EMPLOYEE may view current store offers for assigned stores.
EMPLOYEE cannot administer catalogue, prices, offers, staff or reports.

## 4. Customer Storefront

### 4.1 Primary Catalogue Filters

The storefront must prominently provide:

-   **All** --- all eligible active catalogue items.
-   **Fish** --- fish and approved fish subcategories such as
    Freshwater, Sea Fish and Seafood/Prawns where configured.
-   **Chicken** --- chicken products.
-   **Mutton** --- mutton products.

Changing the selected option filters the same catalogue experience.
Search, featured products and availability must respect the selected
category.

Categories must be database-driven so ADMIN can add future categories
without code changes.

### 4.2 Product Cards

Each product card should support:

-   Product image
-   Display name
-   Optional local name
-   Price for the product's sale unit (per kg for raw-weight products; see
    Section 5.1)
-   Availability
-   Add action

Selecting **Add** opens product configuration.

### 4.3 Product Configuration

Support product-specific:

-   Preparation/cut: Whole, Cleaned, Curry Cut, Fry Cut, Boneless,
    Skinless, etc.
-   Raw weight
-   Special instructions
-   Cleaning-loss estimate where applicable

Suggested initial weights:

-   500 g
-   1 kg
-   1.5 kg
-   2 kg

Allowed weights must ultimately be database-driven.

## 5. Raw-Weight Pricing Rule

Pricing is based on **RAW WEIGHT**.

Example:

-   Customer orders 1 kg raw fish.
-   Price is ₹300/kg.
-   Customer pays ₹300.
-   If configured cleaning loss is approximately 25%, the UI may show
    estimated cleaned weight of approximately 750 g.

The cleaned-weight figure is an estimate, not a guarantee. Cleaning-loss
percentage must be configurable per product/preparation and must not be
universally hardcoded.

For Chicken, Mutton or any non-loss preparation, do not display an
"After cleaning" estimate unless cleaning loss is explicitly configured.

Actual cleaned/dispatch weight may be recorded operationally but must
not silently reprice the order.

### 5.1 Other Sale Units

Raw weight remains the default. ADMIN may instead configure a product with
one of these pricing bases:

-   **Net weight** --- priced per a configured net-weight unit (for
    example ₹X per 500 g net). Customers choose from configured net
    quantities in grams. No "After cleaning" estimate is shown.
-   **Unit** or **Tray** --- priced per unit or per tray, with a configured
    pieces-per-unit/tray count shown to customers (for example a tray of
    30). Customers choose from configured counts.

Each product has exactly one pricing basis. Once a product has a price
history, its basis and unit size cannot be changed; ADMIN retires it and
creates a new product instead, so historical orders and prices stay
unambiguous. OWNER daily price changes set the price for the product's
existing sale unit only.

## 6. Cart Requirements

-   Customer can edit weight/preparation/instructions, remove lines and
    clear cart.
-   Exact duplicate selections must not be added twice.
-   Duplicate identity is:
    `product + preparation + raw weight (or sale quantity) + normalized/trimmed instructions`.
-   Same product with a different preparation, weight/quantity or
    instructions is a valid separate line.
-   Cart shows raw weight or sale quantity, preparation, unit price and
    calculated line total.
-   Client totals are display-only. Production server must revalidate
    product, availability, price, weight, preparation, delivery fee and
    total.
-   Session persistence may improve UX but is not authoritative order
    data.

## 7. Checkout

-   Customer login is not mandatory.
-   Mobile number is required.
-   Name and address are required for Home Delivery.
-   Delivery methods:
    -   Home Delivery --- default
    -   Store Pickup
-   Earliest delivery initially; no customer-selected time slots in MVP.
-   Server performs final repricing before order placement.
-   If the payable amount changes materially, customer should review the
    updated quote rather than being silently charged a higher amount.

## 8. Payments

Initial supported options:

### Cash

-   Cash on Delivery
-   Cash at pickup

### Online / UPI

Use an approved third-party payment gateway or suitable merchant UPI
integration.

Provider selection is intentionally not hardcoded. Before production
launch, compare current provider fees, settlement terms, API/webhook
quality, UPI/QR support and merchant requirements.

Payment rules:

-   Payment states support `PENDING`, `VERIFYING`, `PAID`, `FAILED`,
    `REFUNDED`.
-   A QR display or customer-entered UTR is evidence only and must not
    automatically mark an order `PAID`.
-   Browser/client success must never be trusted as proof of payment.
-   Automated online payment confirmation requires trustworthy
    server-side provider verification/webhook.
-   Gateway secrets and webhook secrets are server-side only.

## 9. Order Lifecycle

Primary workflow:

`PLACED -> CONFIRMED -> PREPARING -> READY -> OUT_FOR_DELIVERY -> DELIVERED`

`CANCELLED` is an alternate terminal state.

Every status transition records actor and timestamp.

### Order Identification

-   Human-facing order number: `TFM-######`
-   Internal ID: UUID
-   Public tracking uses a separate cryptographically random,
    unguessable token.
-   Sequential order number must not be used as authorization.

### Historical Snapshots

Order items preserve the
product/category/preparation/unit-price/raw-weight/cleaning-estimate
information applicable at purchase time. Later catalogue changes must
not rewrite historical orders.

## 10. Admin and Employee Requirements

### 10.1 Admin Area

-   Protected `/admin` area.
-   A subtle "Admin / Staff Login" link in the public footer opens `/admin` only; it must not link directly to role preview routes.
-   Supabase Auth staff identity plus active TRAIT staff profile
    determines authorization.
-   Roles: `ADMIN`, `OWNER`, `EMPLOYEE`. All use the common /admin login;
    active membership securely determines the destination dashboard.

### 10.2 Employee Management

OWNER can:

-   Create/invite employee login identity
-   Update employee profile
-   Assign employee to store
-   Activate/deactivate employee access
-   Initiate supported password reset/recovery workflow

TRAIT must **never store employee passwords in plaintext or reversible
form**. Supabase Auth manages password hashing, authentication and
recovery.

Disabling TRAIT staff membership must remove application authorization
even if an older Auth session still exists.

Controlled admin workflow must prevent accidental removal/demotion of
the final active OWNER.

### 10.3 Catalogue Administration

ADMIN alone can:

-   Create/edit/activate/retire/sort categories and subcategories
-   Create/edit products
-   Manage names, local names, descriptions and images
-   Configure category mapping
-   Configure featured state
-   Configure product preparation choices
-   Configure allowed weights
-   Configure pricing basis, sale unit and sale quantities (Section 5.1)
-   Add new catalogue items without code changes

ADMIN and OWNER can change existing store offerings through a simple
**Prices & Availability** page: product, category, current/new price for
the product's sale unit,
Available / Sold Out, last updated and save action. OWNER cannot create or
remove offerings or alter any catalogue-master field.

Price changes append immutable price history; historical order pricing is
never rewritten. Availability-only changes are audited without a fake price change.

ADMIN and OWNER can create and edit **store offers** for stores in their
business: title/message, percentage or fixed-rupee discount, start/end time,
whole-store, product or category scope (categories include descendants), and
active state. An offer is an order-level discount: it does not change
catalogue masters, selling prices or price history, and line prices remain
pre-discount. Pricing rules for offers are recorded in the Change Log entry
for store offers and in `docs/store-offers.md`.

OWNER cannot create, delete, rename or modify categories/products, images,
descriptions/local names, preparations, allowed weights, cleaning-loss rules,
or catalogue structure. EMPLOYEE cannot change prices, availability, offers or
any catalogue data; EMPLOYEE may only view current offers for assigned stores.
These restrictions apply to direct API calls as well as UI.

### 10.4 Inventory

MVP uses product availability rather than a full stock ledger.

A full quantity/inventory system is postponed until the real store
workflow for receiving stock, sales, cleaning loss, wastage and
carry-forward is finalized.

## 11. Reporting and Audit

ADMIN/OWNER reporting should support:

-   Daily/weekly/monthly sales
-   Order intake
-   Fulfilled sales
-   Cash vs UPI/online collections
-   Pending/paid payments
-   Cancellations
-   Category/product performance
-   Employee activity

Order intake, fulfilled sales, collections, refunds and outstanding
balances must remain distinct business metrics.

Sensitive actions such as price changes, staff changes, order status
changes, payment verification/refunds and settings changes must be
auditable.

Audit history is not editable through ordinary OWNER application access.

## 12. Non-Functional Requirements

### Security

Default deny, least privilege, RLS plus explicit grants, server
validation, no service-role key in browser, secure cookies/headers, rate
limiting, protected uploads and audit logging.

### Performance

Mobile-first catalogue, optimized images, indexed queries and caching
only for safe public catalogue projections.

### Reliability

Atomic order placement and idempotency for repeated checkout/payment
requests.

### Privacy

Minimize PII. Never expose customer/order history merely by entering a
phone number.

### Accessibility

Keyboard-accessible navigation/forms/modals, clear validation and
sufficient contrast.

### Maintainability

Typed TypeScript, migrations in Git, centralized business rules and
clear UI/server/database separation.

### Scalability

Single store now, but retain business/store keys for future branches.

## 13. Release Scope

### MVP

-   All/Fish/Chicken/Mutton filters
-   Catalogue and search
-   Product configuration
-   Duplicate-safe cart
-   Guest checkout
-   Delivery/pickup
-   Cash + selected online/UPI payment provider
-   Secure order tracking
-   Admin login
-   Employee management
-   Catalogue/price/availability administration
-   Order operations

### Post-MVP

-   Customer OTP accounts
-   Order history
-   Saved addresses
-   Advanced refunds/reports
-   Additional branches
-   Delivery scheduling

### Later

-   Full inventory/stock ledger
-   Procurement workflow

## 14. Acceptance Criteria

1.  All shows all eligible products; Fish/Chicken/Mutton correctly
    filter catalogue.
2.  Exact duplicate cart selections are rejected while legitimate
    variants remain separate.
3.  Production checkout ignores forged browser prices/totals and
    recalculates server-side.
4.  Order creation is atomic and preserves immutable item/price/customer
    fulfillment snapshots.
5.  Public tracking uses an unguessable token.
6.  Cash remains pending until permitted staff action.
7.  Online payment becomes paid only after trusted verification.
8.  ADMIN controls catalogue masters; OWNER manages permitted employee access,
    daily price and availability only for existing products.
9.  EMPLOYEE cannot alter prices/availability/catalogue/staff.
10. Passwords are managed by Supabase Auth and never stored by TRAIT.
11. RLS/grants prevent arbitrary private-table access.
12. Catalogue changes do not rewrite historical orders.
13. Application remains responsive across common mobile/tablet/desktop
    widths.

## 15. Business Decisions Still Required Before Launch

-   Final payment gateway / merchant UPI provider
-   Delivery pincodes/areas, fees and minimum order rules
-   Real store address/support number/opening hours
-   Production
    catalogue/images/prices/preparations/weights/cleaning-loss values
-   Employee cash collection limits and order visibility window
-   Cancellation/refund policy
-   GST/tax/invoice requirements
-   Customer data-retention policy

## 16. Change Log

  -----------------------------------------------------------------------
  Version           Date              Change            Approved By
  ----------------- ----------------- ----------------- -----------------
  1.0               2026-09           Initial formal    Project Owner
                                      PRD based on
                                      approved TRAIT
                                      requirements

  -----------------------------------------------------------------------

Approved update (2026-09-25): Added the public footer staff-login entry per Readprompt.txt. Staff roles and access remain determined by secure authentication and active membership.

Approved update (2026-09-26, ReadPrompt.txt): Split ADMIN and OWNER authority; common staff login, ADMIN-only catalogue masters, OWNER daily price/availability operations with immutable history, employee restrictions, and server/database enforcement. New migration is prepared only, not applied. Existing order/payment/report integrations remain future work; no fabricated live operations.

Approved update (2026-09-26, Phase 5B.2): Catalogue backend now includes reusable preparations, product-specific cleaning-loss estimates, integer-gram choices, image metadata, store display overrides, featured ordering and safe public catalogue projections. ADMIN retains master authority; OWNER retains only existing daily price/availability changes; EMPLOYEE has no catalogue mutations. No production products or users are seeded.

Approved update (2026-09-26, Phase 5B.3): Private customer/address foundations preserve guest checkout without automatic account creation or phone-based authorization. Home Delivery eligibility is configured explicitly per store/pincode with integer-paise fee/minimum and active state; Store Pickup uses existing store flags. ADMIN/OWNER manage delivery configuration, EMPLOYEE cannot. Saved-address/account access remains closed pending verified customer workflows. No customer or delivery configuration seed data is added.

Approved update (2026-09-26, core backend run requested through ReadPrompt.txt): Added server-repriced atomic guest orders, immutable purchase/fulfillment snapshots, token-digest tracking, role-scoped status/weight operations, pending cash/online payments, policy-controlled cash receipt, provider-only settlement boundaries, bounded OWNER/ADMIN refunds and immutable operational audit. Pickup completes from READY; Home Delivery uses OUT_FOR_DELIVERY. Any quote change requires review. No provider, real operational policy, customer account or customer cancellation rule is seeded; production HTTP/provider integration and business-policy approval remain required.

Proposed update (2026-10-02, PENDING Project Owner approval --- store offers): Records the store-offers capability already implemented in `20260929000000_store_offers.sql` and applied to the hosted project on 2026-09-29 (see `docs/store-offers.md`). This extends OWNER authority beyond daily price and Available / Sold Out changes; Sections 3 (OWNER, EMPLOYEE) and 10.3 have been amended to match, and those amendments are also pending this approval. Rules as implemented:
-   ADMIN and OWNER may create and edit store offers for stores in their business: title/message, percentage or fixed-rupee discount, start/end time, whole-store/product/category scope (categories include descendants) and active state. EMPLOYEE may view current offers for assigned stores only and cannot create or change them. Guests see only active, current offers.
-   Offers do not alter catalogue masters, selling prices or price history. The discount is applied at order level; line prices remain pre-discount.
-   One offer applies per order: the eligible offer giving the largest merchandise discount. Offers do not stack. Fixed discounts apply once per order and never exceed eligible merchandise; merchandise payable is at least ₹0.01, including for 100% offers, and this is disclosed to customers and staff.
-   Delivery fees are not discounted, and delivery-minimum eligibility uses the pre-discount merchandise subtotal.
-   Eligibility uses server time (start inclusive, end exclusive). If an offer is edited, expires or is deactivated so that the accepted quote changes, the customer must review the new quote before ordering (Section 7).
-   Orders preserve the applied offer and discount as an immutable snapshot (Section 9); payment amounts use the final order total. Offer changes are audited.
No store or offer data is seeded. Open business decision to add to Section 15: who may approve promotions, and any maximum discount or offer-duration policy.

Proposed update (2026-10-02, PENDING Project Owner approval --- sale units): Records the non-raw-weight pricing already implemented in `20260928010000_catalogue_sale_units.sql` and applied to the hosted project. Adds Section 5.1 (Net weight, Unit and Tray pricing bases) and amends Sections 4.2, 6 and 10.3, which previously assumed price per kg for every product. Raw-weight pricing (Section 5) is unchanged and remains the default. ADMIN alone configures a product's basis, unit and sale quantities; OWNER changes only the price for the existing unit. Bases cannot change once a product has been priced. As of 2026-10-02 the hosted catalogue has 21 raw-weight products, 1 net-weight product (per 500 g) and 1 tray product (30 per tray). The same migration added a public, non-orderable catalogue preview (ADMIN-set reference price and publish flag) shown until a real store is configured; ordering still requires a store offering and daily price.
