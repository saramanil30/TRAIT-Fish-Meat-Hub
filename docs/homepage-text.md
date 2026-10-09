# Homepage text, link preview and sharing

Settings → **Homepage text** (ADMIN and OWNER; EMPLOYEE has no Settings access) edits the homepage hero for the selected store:
badge, headline (white part + red highlighted part), subtitle, button label, and each side card's label, title and subtitle.

- Plain text only: line breaks are collapsed, `<` and `>` are rejected, and each field has a length limit (`src/lib/homepage-text.ts`, mirrored by `app.homepage_text_limits()`).
- A blank field shows the built-in text (the grey placeholder). The live preview shows exactly what the homepage will render.
- Saved through `api.save_homepage_text` (role and store checks, optimistic version, audit action `HOMEPAGE_TEXT_SAVED`). The storefront reads `api.homepage_text`; if it is unavailable the built-in text is shown.
- `app.store_homepage_text` has forced RLS and no grants to any API role.

## Link preview

Settings → **Link preview** (ADMIN and OWNER): a share image (JPG, exactly 1200×630, at most 300 KB; checked in the browser and again on the server from the JPEG header), a share title (≤70) and a share description (≤200).

- The root layout's `generateMetadata` sets `og:title`, `og:description`, `og:image` and the `twitter:` card (`summary_large_image`). A saved image is an absolute public Storage URL with `?v={version}`, which changes on every save so apps re-fetch it. Without one, `public/og-default.jpeg` is used (not an `app/opengraph-image` file, which would override any custom image).
- Images upload to the public `share-images` bucket at `{business}/{sha256}.jpg`; only ADMIN and OWNER may insert, under their own business. Saved through `api.save_link_preview` (audit action `LINK_PREVIEW_SAVED`).
- WhatsApp and other apps cache previews per link; an already-shared link may keep its old preview for a while.

## Share to WhatsApp

Settings → **Share to WhatsApp**: pick a photo, edit the message (the site link is added), then the phone's share sheet opens (Web Share API with files). Where photos can't be shared it shares the message and link only, or opens WhatsApp (`wa.me`) when there is no share sheet.

Migrations: `supabase/migrations/20261009010000_homepage_text.sql` (homepage text), `supabase/migrations/20261009020000_link_preview.sql` (link preview). Tests: `npm run test:homepage-settings-db`, `tests/share-image.test.mjs` (in `npm test`).
