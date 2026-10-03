# Blush Picnic — project conventions

Astro 7 (static output, `build.format: 'file'`, `trailingSlash: 'never'`) + Tailwind 4 + TypeScript. Deployed to Hostinger shared hosting (`public_html`), booking handled by `public/api/book.php` (PHPMailer over Hostinger SMTP, sending as support@blushpicnic.com to blush.picnic25@gmail.com).

## Non-negotiable content rules
- **Never invent facts.** No fake reviews, stats, awards, press, "spots left", years in business, numbers of picnics, team size, ratings, or policies. Only use facts in `src/content/settings.yaml`, `packages.yaml`, `addons.yaml` and the business brief. Where real content is missing, render a clearly marked placeholder (`.placeholder-note`, text starting "Placeholder —") and list it in `HANDOVER.md`.
- Every price says **"Starting at"** and **"before HST"**; package and occasion pages note that **location affects price** (`settings.locationNote`).
- Known facts: deliver, set up, style, clean up; parks, beaches, backyards, homes, indoor venues; Toronto + GTA; reply within 24 hours; deposit $100 or 50% for larger events, balance before the event, non-refundable. Weather / cancellation / damage policies are **placeholders** until the owner sends them.
- No secrets in git (SMTP/FTP passwords live in `blush-config.php` outside `public_html`, or GitHub Secrets).

## Data → never hard-code
All editable content is in `src/content/` (schemas in `src/content.config.ts`). Read it via helpers in `src/lib/site.ts` (`getSettings`, `getPackages`, `getOccasions`, `money`, `bookUrl`, `smsUrl`, `telUrl`, `occasionUrl`, `inlineMd`…). Changing a price must only ever mean editing one YAML file. JSON-LD builders live in `src/lib/schema.ts`. The booking form is defined in `src/content/booking-form.yaml` and resolved by `src/lib/form.ts` (`buildFormSchema`), which also produces `/api/form-schema.json` for the PHP validator.

Ids: packages `signature`, `proposal-romance`, `celebration` (+ pseudo `not-sure`); occasions are the filenames in `src/content/occasions/` (e.g. `proposal`), URL from frontmatter `urlSlug` (e.g. `/proposal-picnic-toronto`); pseudo occasion `other`. Deep link: `/book?occasion=proposal&package=proposal-romance`.

## Design system
- Tokens (`src/styles/global.css` `@theme`): `petal` bg, `cream` surfaces, `plum` text/buttons, `plum-soft` secondary text, `sage`/`gold` **decorative only** (fail contrast), `sage-ink`/`gold-ink` for coloured text, `line` hairlines. Fonts: `font-display` (Gloock, headings only) + Figtree body.
- Classes: `container-x`, `section-y`, `measure`, `btn btn-primary|btn-secondary|btn-light [btn-lg]`, `link-arrow`, `arch`, `arch-outline`, `prose-blush`, `heading-sm`, `placeholder-note`, `hero-enter`.
- Shared components (`src/components/`): `BaseLayout` (title, description, image, jsonLd, noindex, hideStickyBar), `ArchImage`, `PriceTag`, `FaqList`, `CtaBand`, `Breadcrumbs`, `HowItWorks`, `ReviewsSection` (renders nothing when empty), `OccasionChips`, `Icon`, `Wordmark`.
- The arch is the one signature motif — hero frames and sparingly elsewhere. Avoid AI-template tells: no all-caps eyebrow labels, no grids of identical shadowed cards, no fade-up on every block (only `.hero-enter` on the hero). Respect `prefers-reduced-motion`.
- Images: `astro:assets` (`<Picture formats={['avif','webp']}>` / `ArchImage`), always meaningful `alt`, correct `sizes`. Placeholder photos live in `src/assets/photos/` (regenerate: `npm run placeholders`).
- Accessibility: WCAG 2.2 AA, tap targets ≥ 44px (`min-h-11`/`min-h-12`), visible focus, one `h1` per page, logical heading order, labelled controls, keyboard support for every interaction.

## Analytics
Call `window.bpTrack(event, params)` or add `data-track="<event>"` (+ `data-track-*` params) to links. Events: `booking_start`, `booking_step` {step}, `booking_submit`, `click_call`, `click_text`, `click_instagram`, `package_select` {package}, `booking_cta` {location}. GA4 / Meta Pixel load only after consent.

## Commands
`npm run build` (set `OUT_DIR=dist-xyz CACHE_DIR=node_modules/.astro-xyz` to build in parallel without clobbering), `npm run check`, `npm run placeholders`, `npm run photos`.
