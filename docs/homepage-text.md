# Homepage text

Settings → **Homepage text** (ADMIN and OWNER; EMPLOYEE has no Settings access) edits the homepage hero for the selected store:
badge, headline (white part + red highlighted part), subtitle, button label, and each side card's label, title and subtitle.

- Plain text only: line breaks are collapsed, `<` and `>` are rejected, and each field has a length limit (`src/lib/homepage-text.ts`, mirrored by `app.homepage_text_limits()`).
- A blank field shows the built-in text (the grey placeholder). The live preview shows exactly what the homepage will render.
- Saved through `api.save_homepage_text` (role and store checks, optimistic version, audit action `HOMEPAGE_TEXT_SAVED`). The storefront reads `api.homepage_text`; if it is unavailable the built-in text is shown.
- `app.store_homepage_text` has forced RLS and no grants to any API role.

Migration: `supabase/migrations/20261009010000_homepage_text.sql`. Test: `npm run test:homepage-text-db`.
