# Blush Picnic — blushpicnic.com

The website for **Blush Picnic**, luxury picnic setups in Toronto and the GTA: a fast static
site that turns Instagram and Google visitors into booking requests, plus a small PHP handler
that emails each request to the business.

| You are… | Read |
| --- | --- |
| The owner (changing prices, photos, FAQs; publishing) | [HANDOVER.md](HANDOVER.md) |
| Working on Google visibility | [SEO.md](SEO.md) |
| A developer | this file, then [CLAUDE.md](CLAUDE.md) (conventions and content rules) |
| Deploying or debugging the server | [docs/deployment.md](docs/deployment.md), [docs/htaccess-tests.md](docs/htaccess-tests.md) |
| Working on the booking handler | [tests/api-README.md](tests/api-README.md) |

## Stack

- **Astro 7**, static output. `build.format: 'file'` and `trailingSlash: 'never'`, so `/packages`
  is built as `dist/packages.html` and served as a clean URL by `.htaccess`.
- **Tailwind CSS 4** (via `@tailwindcss/vite`). Design tokens live in `src/styles/global.css`.
- **TypeScript** (strict). Interactivity is plain TypeScript in `<script>` tags. There's no UI framework.
- **Images**: `astro:assets` + sharp. Every photo ships as AVIF and WebP in several widths.
- **Fonts**: Gloock (headings) and Figtree (body), self-hosted through Fontsource and preloaded.
- **Booking handler**: `public/api/book.php` (PHP 8.1+, vendored PHPMailer). It sends email
  through Hostinger SMTP as support@blushpicnic.com. Web3Forms is a switchable fallback.
- **Hosting**: Hostinger shared hosting (LiteSpeed reading Apache-style `.htaccess`), files in `public_html`.
- **Tests**: Node's built-in test runner for the API, Playwright for the browser, and a real
  Apache 2.4 for the server rules.

## Getting started

```bash
npm ci            # Node 20+ (22 recommended)
npm run dev       # http://localhost:4321
```

`npm run dev` doesn't run PHP, so booking requests can't be sent from it. To try the whole
flow, including the form handler, build the site and serve it with PHP's built-in server.
`tests/router.php` copies the production `.htaccess` behaviour: clean URLs, the 404 page and `/api/*.php`.

```bash
npm run build
php -S 127.0.0.1:4321 -t dist tests/router.php
```

Booking requests need a config. For local testing, point `BLUSH_CONFIG` at the test fixture,
which writes emails to `tests/.mail/` as `.eml` files instead of sending them:
`BLUSH_CONFIG=tests/fixtures/blush-config.test.php php -S …`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run check` | `astro check`: types, content schemas and `.astro` diagnostics |
| `npm run test:api` | Booking handler tests (builds into `dist-api/`, runs PHP on port 4406) |
| `npm run test:e2e` | Playwright browser tests (builds into `dist-e2e/`, PHP on port 4455, mobile + desktop) |
| `npm test` | Both test suites |
| `bash docs/htaccess-test.sh [dist]` | Runs `.htaccess` on a throw-away Apache 2.4 and checks 60+ redirects, headers and blocked paths |
| `npm run photos -- <folder>` | Swaps in real photos: strips metadata (GPS too), resizes, updates the gallery list |
| `npm run placeholders` | Recreates the labelled placeholder photos (`--force` overwrites them) |
| `npm run brand` | Regenerates the logo, favicons, manifest icons and `og.jpg` from `settings.yaml` |
| `npm run deploy` | `./deploy.sh`: build and upload to Hostinger (see below) |

Several builds can run side by side without clobbering each other:
`OUT_DIR=dist-xyz CACHE_DIR=node_modules/.astro-xyz npx astro build`.

## Project structure

```
src/
  content/              ← every editable fact and text (validated by src/content.config.ts)
    settings.yaml         business facts, contact, deposit, analytics IDs, booking provider
    packages.yaml         the three packages (prices, inclusions, photos)
    addons.yaml           add-ons (price: null = "Price on request")
    faqs.yaml             FAQ page + home preview
    booking-form.yaml     every booking question, per occasion group
    gallery.yaml          gallery photos, alt text, occasions
    reviews.yaml          real reviews only (the section hides while this is empty)
    occasions/*.md        one landing page per occasion (front matter + body copy)
    pages/*.md            about, policies, privacy (long-form copy)
  lib/
    site.ts               typed content helpers: getSettings, getPackages, money, bookUrl, smsUrl…
    schema.ts             JSON-LD builders (LocalBusiness, Service, FAQPage, BreadcrumbList)
    form.ts               booking-form.yaml → one schema for the form AND the PHP validator
  layouts/BaseLayout.astro  <head>, SEO tags, JSON-LD, header/footer, sticky bar, consent banner
  components/           shared pieces + one folder per page area (home, packages, occasion, book, gallery, pages)
  pages/                routes; [occasion].astro builds every occasion page from occasions/*.md
    api/form-schema.json.ts   → /api/form-schema.json (read by book.php)
    robots.txt.ts             → /robots.txt
  scripts/              client-side TypeScript (booking form, gallery filter, lightbox, analytics, tracking)
  assets/photos/        source photos (placeholders until replaced with `npm run photos`)
  styles/global.css     Tailwind theme tokens and the few global classes
public/
  .htaccess             production server rules (HTTPS, clean URLs, caching, security headers)
  api/                  booking handler: book.php, lib/ (incl. PHPMailer), .htaccess rules
  favicons, logo, og.jpg, site.webmanifest
api-config/blush-config.example.php   template for the server-only booking config (never commit the real one)
scripts/                photo swap, placeholders, brand assets, screenshots
tests/                  API tests, Playwright specs, PHP dev router, fixtures
docs/                   deployment runbook, .htaccess test harness and its results
deploy.sh, deploy.env.example   upload from a computer (FTPS / SFTP / rsync)
.github/workflows/      ci.yml (checks every change), deploy.yml (manual deploy)
```

## Content model and rules

All copy and facts live in `src/content/`. Components never hard-code them. The schemas in
`src/content.config.ts` make a typo (a missing price, a too-long meta title) fail the build
instead of shipping. The main rules (details in [CLAUDE.md](CLAUDE.md)):

- **Read through helpers.** `getSettings()`, `getPackages()`, `getOccasions()`, `money()`, `bookUrl()`, `telUrl()`,
  `smsUrl()`, `inlineMd()` and the others in `src/lib/site.ts`. Changing a price must only ever mean editing one YAML file.
- **Prices** always read "Starting at …" and "before HST" (`settings.taxNote`). Package and
  occasion pages carry `settings.locationNote` ("prices vary by location").
- **Never invent facts**: no reviews, ratings, stats, awards or policies that the owner hasn't
  given. Missing content gets a visible placeholder (`<p class="placeholder-note"><strong>Placeholder —</strong> …</p>`)
  and a line in HANDOVER.md → "Waiting on you".
- **Ids are part of URLs and analytics.** Packages are `signature`, `proposal-romance` and `celebration`,
  plus the pseudo-id `not-sure`. Occasions are the file names in `src/content/occasions/`, plus the pseudo-id `other`.
  An occasion's page URL is its front-matter `urlSlug` (`/proposal-picnic-toronto`).
- **Deep links into the form**: `bookUrl({ occasion, package })` → `/book?occasion=proposal&package=proposal-romance`.
- **Analytics**: add `data-track="<event>"` (plus `data-track-*` params) to links, or call
  `window.bpTrack(event, params)`. Events: `booking_start`, `booking_step`, `booking_submit`, `click_call`,
  `click_text`, `click_instagram`, `package_select`, `booking_cta`. GA4 and the Meta Pixel load only
  after the visitor accepts cookies. Their IDs come from `settings.yaml`, or from the env vars
  `PUBLIC_GA4_ID` / `PUBLIC_META_PIXEL_ID`.

## Booking flow

1. **The form.** `/book` renders the four-step form from `src/content/booking-form.yaml`.
   `buildFormSchema()` in `src/lib/form.ts` resolves it, filling options from occasions, packages
   and add-ons. Groups appear per occasion `formGroup`, and fields can be limited with `onlyFor` or `showIf`.
2. **The contract.** The same resolved schema is built to **`/api/form-schema.json`**. `book.php`
   validates every submission against it, so the server checks exactly the questions the browser
   showed. Change a question in the YAML and both sides follow; no PHP edit is needed. The file holds the
   steps, groups and fields (id, type, required, options, limits, `onlyFor`/`showIf`), occasions,
   packages with prices, add-ons, deposit and security deposit facts, and the tax note.
3. **Submitting.** The form `POST`s to `/api/book.php` (`settings.booking.endpoint`) with
   `Accept: application/json`. Field names are the YAML field ids, and checkbox groups use `name[]`.
   Responses:
   - `200 {ok, ref, message}`: the client is sent to `/thank-you`
   - `422 {errors: {field: message}}`: the form highlights each field
   - `403 / 413 / 415 / 429 / 500 {message}`: the message always offers the phone number

   Without JavaScript, the handler answers with a `303` redirect instead.
4. **Spam protection**: a honeypot field (`company_website`) and a time trap (`_ts`: sent within
   4 seconds of opening the form, missing from a fetch() post, or far in the future). A request that
   trips one is never thrown away: it still reaches the business, with `[Possible spam]` in the subject,
   but gets no client confirmation, and the visitor sees the usual reply. Also a per-IP rate limit
   (IPv6 per /64; the IP is stored as an HMAC hash), a site-wide cap on client confirmations
   (`confirm_max_per_hour`), and an Origin/Referer check. The confirmation holds no free text the
   visitor typed, so it can't carry anyone's message to a stranger.
5. **Email.** PHPMailer sends over SMTP (`smtp.hostinger.com:465`, SSL) as support@blushpicnic.com
   to blush.picnic25@gmail.com, with Reply-To set to the client, and sends the client an automatic
   confirmation. Each request gets a reference such as `BP-20261003-AB12`. If sending fails, a copy
   is kept in `blush-data/unsent/` so no booking is lost.
6. **Config.** `blush-config.php` lives **outside** `public_html`, in the domain folder next to it.
   It's created from `api-config/blush-config.example.php` and holds the mailbox password. The
   handler also writes its private data (rate limit, an activity log without personal details,
   unsent copies) to `blush-data/` there.
7. **Fallback.** Set `settings.booking.provider: "web3forms"` and add an access key to post to
   Web3Forms instead, if SMTP ever breaks. The CSP already allows `https://api.web3forms.com`.

The full contract, file map and test coverage: [tests/api-README.md](tests/api-README.md).

## Tests

- `npm run test:api` builds into `dist-api/`, then runs `book.php` under `php -S` with a test
  config (emails become `.eml` files). It exercises every occasion, every required field, rejected
  and ignored answers, header injection, spam traps, the rate limit, error paths and a fake SMTP
  server. `API_TEST_SKIP_BUILD=1` reuses an existing build, and `API_TEST_DIST=dist` tests `dist/`
  (`API_TEST_PORT`, `API_TEST_MAIL_DIR` and `API_TEST_TMP_DIR` let two runs work side by side).
- `npm run test:e2e`: Playwright (Chromium, mobile 390px and desktop 1440px) builds into `dist-e2e/`
  and serves it with PHP on port 4455. The booking specs live in `tests/e2e/`.
- `bash docs/htaccess-test.sh dist` needs `apache2` (and `libapache2-mod-php` for the PHP
  checks). It starts a throw-away Apache with `AllowOverride All` and checks the redirects (www,
  http, `.html`, trailing slashes, `/index`), clean URLs, the 404 page, blocked dotfiles and PHP,
  caching per file type, brotli/gzip and every security header. Results and reasoning:
  [docs/htaccess-tests.md](docs/htaccess-tests.md).
- **CI** (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request:
  `astro check`, build, `php -l` on every PHP file, shellcheck, the API tests and the Apache
  `.htaccess` test. Playwright runs as a separate job on pull requests and on manual runs.

## Deploying

The site is plain files in `public_html`. There are three ways to put them there; all are
described step by step in [docs/deployment.md](docs/deployment.md):

1. **GitHub Actions (owner's default).** Actions → "Deploy to Hostinger" → Run workflow. It's manual on
   purpose, because the owner approves every deploy. It builds, uploads changed files over FTPS
   (SamKirkland/FTP-Deploy-Action) and checks the live site. It needs three repository secrets:
   `FTP_SERVER`, `FTP_USERNAME` and `FTP_PASSWORD`.
2. **`./deploy.sh` from a computer** (needs `lftp`). It builds, connects over FTPS (or SFTP/rsync
   once SSH is on), backs up the live site on the first run, and uploads in a safe order: new `_astro/`
   files first, then pages. It then verifies every file's size on the server and runs the same
   live checks. Flags: `--dry-run`, `--backup`, `--delete`, `--config <file>`, `--check`,
   `--show-cert`, `--install`, `--skip-build`, `--yes`. Settings go in `deploy.env` (copy `deploy.env.example`).
3. **hPanel File Manager**, as an emergency fallback: upload the contents of `dist/` into `public_html`.

Whichever you use, `blush-config.php` goes one level **above** `public_html`. Never put it
inside `public_html`.

## Environment and secrets policy

- **No secrets in git, ever.** `.gitignore` blocks `deploy.env`, `blush-config.php` and `.env*`,
  and `deploy.sh` refuses to upload a build that contains secret-looking files or the FTP password.
- **Where each secret lives:**

  | Secret | Lives in | Never in |
  | --- | --- | --- |
  | FTP password | GitHub → Settings → Secrets (`FTP_PASSWORD`), or `deploy.env` / typed at the prompt | the repo, chat, email |
  | Mailbox password for support@blushpicnic.com | `blush-config.php` on the server, above `public_html` | the repo, `public_html` |
  | SSH key (optional) | your computer (`SSH_KEY` in `deploy.env`) | the repo |

- **Not secret** (safe in `settings.yaml`): the GA4 measurement ID, the Meta Pixel ID and a
  Web3Forms access key. Anyone can read them from the page source by design.
- **If a secret leaks**, change it at the source (hPanel → Files → FTP Accounts, or hPanel →
  Emails for the mailbox), then update the GitHub secret or `blush-config.php`. The FTP password
  was once shared in a chat during setup, so changing it is part of the one-time setup in HANDOVER.md.
- **Build-time variables**: `OUT_DIR`, `CACHE_DIR` (parallel builds), `PUBLIC_GA4_ID`,
  `PUBLIC_META_PIXEL_ID` (override `settings.yaml`), `DEPLOY_DIST` (deploy another folder), and
  `API_TEST_SKIP_BUILD` / `API_TEST_DIST` / `API_TEST_PORT` for the API tests.

## Server rules in brief (`public/.htaccess`)

- Every URL has one canonical form: `https://blushpicnic.com/<page>`, with no `www`, no `.html`
  and no trailing slash. Any other form gets a single 301.
- `/packages` is served from `packages.html` internally. `/api/` is never rewritten.
- `ErrorDocument 404 /404.html`. Dotfiles, Markdown, logs, config templates and any PHP outside
  `/api` answer 403.
- Caching: `/_astro/*` (fingerprinted) for a year, `immutable`; other images and fonts for 30 days;
  pages `no-cache` (always revalidated, so deploys show at once); sitemap and robots for an hour.
- Compression: brotli with gzip fallback where the server has the modules (LiteSpeed compresses on its own).
- Security headers: HSTS (one year, no subdomains, no preload), CSP, nosniff,
  `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy`. The CSP allows the site itself,
  the inline scripts and styles Astro emits, GA4, the Meta Pixel and Web3Forms. Adding a new
  third-party service means adding its domain to the CSP.
