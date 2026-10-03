# `.htaccess`: how each rule works, and the tests that prove it

`public/.htaccess` is copied into the build and uploaded as `public_html/.htaccess`. Hostinger
serves the site with **LiteSpeed**, which reads Apache 2.4 `.htaccess` files. The rules are
plain Apache 2.4 syntax, and anything that needs an optional module sits in an `<IfModule>` guard.

We can't run LiteSpeed here, so the rules are tested two ways:

1. **On a real Apache 2.4**: `docs/htaccess-test.sh` starts a throw-away Apache (with
   `AllowOverride All` and mod_php) on the built site and checks 61 cases. CI runs it on every
   change. It found two real bugs while these rules were written (see "Bugs the tests caught").
2. **By reasoning** for LiteSpeed-specific behaviour (below), and with the live checks after each
   deploy (`./deploy.sh --check`).

## Running the tests

```bash
npm run build
bash docs/htaccess-test.sh            # or: bash docs/htaccess-test.sh dist-xyz
```

The script needs `apache2` (Debian/Ubuntu: `apt-get install apache2 libapache2-mod-php`), `openssl` and `curl`.
It works as root or as a normal user, on ports 18080/18443 by default (`HTACCESS_HTTP_PORT`, `HTACCESS_HTTPS_PORT`).
Nothing outside a temporary folder is touched.

- `HTACCESS_LOGLEVEL="warn rewrite:trace3"` prints mod_rewrite's step-by-step log.
- `HTACCESS_HOLD=1` keeps Apache running afterwards, for browser checks.
- `HTACCESS_CONFIG=path/blush-config.php` puts a booking config next to the document root, as on Hostinger.

The document root is the build plus files a real `public_html` might hold: a `.git/` folder,
`.env`, Hostinger's `default.php`, an `error_log`, a `README.md`, a `composer.json`, a Google
verification file, an ACME challenge in `.well-known/`, and FTP-Deploy-Action's state file.

**Last run: 61 passed, 0 failed (Apache/2.4.58, Ubuntu), 2026-10-03**, on a full build of the site.

## Rule by rule

URLs are written as a visitor would type them. "→" is a 301 redirect; "⇒" is served internally,
with no redirect.

### 0. Internal lookups are left alone

```apache
RewriteCond %{ENV:REDIRECT_STATUS} !^$
RewriteRule ^ - [L]
```

When Apache serves `packages.html` for `/packages`, or shows `/404.html` for a missing page, it
runs the rules again as an *internal redirect* with `REDIRECT_STATUS` set. Rules 6–8 look at
`THE_REQUEST` (what the visitor typed), which stays the same during that second pass.
Without this guard, the error page for the folder `/_astro/` was redirected to `/_astro`, and
Apache's folder handling sent it back to `/_astro/`: a redirect loop. (The test suite caught
this; see below.) LiteSpeed sets `REDIRECT_STATUS` the same way, and WordPress-style rules
rely on it there.

### 1. `www` → apex, straight to https

```apache
RewriteCond %{HTTP_HOST} ^www\.(.+)$ [NC]
RewriteRule ^ https://%1%{REQUEST_URI} [R=301,L]
```

| Request | Result |
| --- | --- |
| `http://www.blushpicnic.com/` | → `https://blushpicnic.com/` (one hop, not two) |
| `https://www.blushpicnic.com/packages` | → `https://blushpicnic.com/packages` |
| `http://www.blushpicnic.com/book?occasion=proposal` | → `https://blushpicnic.com/book?occasion=proposal` (Apache keeps the query string) |

`%{REQUEST_URI}` is the decoded path, so the rule leaves out `NE` and lets Apache re-encode it.
The `www` pattern is generic, so a Hostinger preview domain is never sent to the live domain.

### 2. http → https

```apache
RewriteCond %{HTTPS} !^on$ [NC]
RewriteCond %{HTTP:X-Forwarded-Proto} !https [NC]
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
```

| Request | Result |
| --- | --- |
| `http://blushpicnic.com/` | → `https://blushpicnic.com/` |
| `http://blushpicnic.com/api/book.php` | → https (bookings are never accepted over plain http) |
| http, with `X-Forwarded-Proto: https` (a CDN in front) | 200, no loop |

`!^on$` is a regex on purpose. The `!=on` comparison form isn't parsed the same way everywhere,
and a server that read it as a regex would redirect https to https forever. Hostinger's own
force-https snippet uses `%{HTTPS}` the same way.

### 3. Hidden files and folders → 403

```apache
RewriteRule (?:^|/)\.(?!well-known(?:/|$)) - [F]
```

This blocks any path segment that starts with a dot (`/.git/config`, `/.env`, `/api/.htaccess`,
`/.ftp-deploy-sync-state.json`, lftp's `.in.*` temp files) except `/.well-known/`, which SSL
renewals and domain verification need. The `<FilesMatch>` block further down blocks dot*files*
too; this rule also covers dot*folders*, which `<FilesMatch>` can't see.

### 4. The booking API is never rewritten

```apache
RewriteRule ^api(?:/|$) - [L]
```

`/api/book.php` runs as PHP, `/api/form-schema.json` is a plain file, and `/api/.htaccess`
handles the rest (`lib/` denied, only `book.php` and the schema reachable). `/api` without a
slash gets Apache's own folder redirect to `/api/`, which answers 403 (no listing).

### 5. No PHP outside `/api` → 403

```apache
RewriteRule \.(?:php\d?|phtml|phar)$ - [F]
```

`/default.php` (Hostinger's "coming soon" page), a stray `phpinfo.php` or an uploaded script all
answer 403. Only `book.php` runs.

### 6. `/index` and `/index.html` → `/`

```apache
RewriteCond %{THE_REQUEST} ^[A-Z]+\s/+index(?:\.html)?(?:[?\s]) [NC]
RewriteRule ^ / [R=301,L]
```

The rule matches on `THE_REQUEST` (the visitor's request line) and not the rewritten path, so
Apache's own lookup of `index.html` for `/` never triggers it.

### 7. `/page.html` → `/page`

```apache
RewriteCond %{REQUEST_URI} !^/google[0-9a-f]+\.html$ [NC]
RewriteCond %{THE_REQUEST} ^[A-Z]+\s/+([^?\s]*?)\.html(?:[?\s]) [NC]
RewriteRule ^ /%1 [R=301,L,NE]
```

| Request | Result |
| --- | --- |
| `/packages.html` | → `/packages` |
| `/packages.html?a=1` | → `/packages?a=1` |
| `/packages/extra.html` | → `/packages/extra`, which is a 404 |
| `//evil.example/x.html` | → `https://blushpicnic.com/evil.example/x`, **not** an open redirect: `\s/+` swallows every leading slash and the target always starts with a single `/` |
| `/google1234567890abcdef.html` (Search Console file) | 200, not redirected (verification fetchers may not follow redirects) |

The capturing condition must come **last**: `%1` in the substitution refers to the last
matched condition. `NE` keeps the already-encoded request line as it is.

### 8. Trailing slashes removed (except `/` and real folders)

```apache
RewriteCond %{REQUEST_URI} /$
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{THE_REQUEST} ^[A-Z]+\s/+([^?\s]*[^/?\s])/+(?:[?\s])
RewriteRule ^ /%1 [R=301,L,NE]
```

| Request | Result |
| --- | --- |
| `/packages/` | → `/packages` |
| `/packages//` | → `/packages` |
| `/packages/?utm_source=ig` | → `/packages?utm_source=ig` |
| `/a%20b/` | → `/a%20b` (encoding kept) |
| `/` | untouched: the pattern needs at least one non-slash character |
| `/_astro/` (a real folder) | untouched → 403, no listing. Stripping its slash would fight Apache's own "add a slash to folders" redirect |

The `%{REQUEST_URI} /$` condition is a second guard against the loop described in rule 0, for
any server that doesn't set `REDIRECT_STATUS`. An error page's path (`/404.html`) never ends in a slash.

### 9. Clean URLs

```apache
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_FILENAME}.html -f
RewriteRule ^([^.]+)$ $1.html [L]
```

| Request | Result |
| --- | --- |
| `/packages` | ⇒ `packages.html`, 200 |
| `/proposal-picnic-toronto` | ⇒ `proposal-picnic-toronto.html`, 200 |
| `/book?occasion=proposal&package=proposal-romance` | ⇒ `book.html`, query kept |
| `/no-such-page` | 404 with `/404.html` |
| `/packages/extra` | 404, with **no loop** |
| `/a.b` | 404 |

`%{REQUEST_FILENAME}.html` can match a *parent* (`/packages/extra` → `…/packages` + `.html`
exists), so the rule only applies to paths with no dot in them. The rewritten
`packages/extra.html` can never match again, which rules out the classic "500 Internal Server
Error: too many internal redirects". Page slugs are `[a-z0-9-]` (checked by the content schema),
so no real page has a dot. `DOCUMENT_ROOT` isn't used: it isn't always the site folder on shared hosting.

### Other directives

| Directive | Test | Result |
| --- | --- | --- |
| `ErrorDocument 404 /404.html` | `/no-such-page` | 404, our page (`noindex`), `Cache-Control: no-cache` |
| `ErrorDocument 403 /404.html` | `/_astro/` | 403 status, our page instead of the server's default |
| `Options -Indexes` | `/_astro/`, `/api/` | 403, no listings |
| `Options -MultiViews` (guarded) | — | only these rules decide which file answers a URL |
| `<FilesMatch>` deny list | `/.htaccess`, `/README.md`, `/error_log`, `/composer.json`, `*.example.php`, logs, backups | 403 |
| `AddType` | `.avif`, `.webp`, `.woff2`, `.webmanifest`, `.js` | `image/avif`, `font/woff2`, `application/manifest+json`, `text/javascript` |

### Caching

| Files | `Cache-Control` | Why |
| --- | --- | --- |
| `*.html` | `no-cache` | Browsers revalidate each time (a cheap `304`), so a deploy shows up immediately |
| `/_astro/*`: `name.HASH.ext` / `name.HASH_VARIANT.ext` | `public, max-age=31536000, immutable` | The name changes whenever the content does |
| Other images and fonts (`og.jpg`, logo, favicons) | `public, max-age=2592000` (30 days) | Not fingerprinted, so they need to be able to change |
| `*.css`, `*.js` outside `/_astro/` (none today) | 1 day | |
| `*.webmanifest`, `*.json` | 1 day (`/api/form-schema.json`: 5 minutes, set in `api/.htaccess`) | |
| `sitemap-*.xml`, `robots.txt` | 1 hour | |

`.htaccess` can't match a folder, so `/_astro/` is recognised by Astro's fingerprint pattern:
8 characters between dots (`BaseLayout.CRCVGkb8.css`, `about.gc9TmKJL_18yIe1.webp`). All 1,537
files in `/_astro/` of the current build match it, and no file outside it does. **Don't name
your own files in `public/` like `photo.abcdefgh.jpg`**, or they'd be cached for a year.
Later `<FilesMatch>` sections win, which is why the fingerprint rule comes last.

### Compression

`BROTLI_COMPRESS;DEFLATE` where mod_brotli exists (brotli for browsers that accept it, gzip for
the rest), and gzip alone otherwise. Every combination of modules is guarded. Tested: `/packages`
with `Accept-Encoding: br` → `Content-Encoding: br`; a CSS file with `gzip` → `gzip`; AVIF images
are never recompressed. **LiteSpeed** compresses on its own (gzip/brotli in the server
configuration) and ignores these lines, which is fine.

### Security headers

Sent with `Header always`, so they also go out on redirects, 404s and 403s (tested on each).

| Header | Value | Note |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=31536000` | One year. No `includeSubDomains` (a subdomain without SSL keeps working) and no `preload`. A choice; see HANDOVER.md. Browsers ignore it over plain http |
| `Content-Security-Policy` | see below | |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `book.php` sends its own `same-origin`. JSON responses may carry both, which is harmless |
| `X-Frame-Options` | `SAMEORIGIN` | Matches CSP `frame-ancestors 'self'` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | The site uses none of them |
| `X-Powered-By` | removed | Tested on a PHP response |

#### Content-Security-Policy

```
default-src 'self';
script-src  'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net;
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob: https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://www.facebook.com;
font-src    'self' data:;
connect-src 'self' https://api.web3forms.com https://www.googletagmanager.com https://www.google-analytics.com
            https://*.google-analytics.com https://*.analytics.google.com https://connect.facebook.net https://www.facebook.com;
media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://api.web3forms.com;
frame-ancestors 'self'; upgrade-insecure-requests
```

**Why `'unsafe-inline'`:** every built page has small inline scripts that Astro emits (module
scripts for page behaviour, between 1 and 4 per page), 135 `style=""` attributes and inline
`<style>` blocks. JSON-LD (`application/ld+json`) and the booking config
(`application/json`) are data, not scripts, so CSP doesn't apply to them. A hash-based policy
would have to be regenerated on every content edit and would break the site the first time
someone forgot. Everything that makes `'unsafe-inline'` dangerous in practice is still locked:
no plugins (`object-src 'none'`), no `<base>` hijacking, no posting forms to other sites, no
framing by other sites, no scripts or connections to any domain not listed.
*Stricter later:* Astro can emit hashes itself (its CSP option in `astro.config.mjs`). Once
that's on, a `<meta>` CSP with hashes plus this header together make inline scripts
hash-only. That's left for a later, separately tested change.

**Browser check (Chromium via Playwright, over https on the Apache above):**

- All 28 pages in the sitemap, plus `/no-such-page`, `/thank-you` and a booking deep link: **0 CSP
  violations**, no console errors apart from the expected 404.
- Loading `googletagmanager.com/gtag/js`, `connect.facebook.net/en_US/fbevents.js`, a
  `facebook.com/tr` pixel, `google-analytics.com` images, and `fetch` to
  `region1.google-analytics.com`, `region1.analytics.google.com`, `api.web3forms.com` and
  `facebook.com/tr`: **allowed** (0 violations).
- Control: a script and a `fetch` to `evil.example.com`: **blocked**.

**Adding a service later** (a Google Map, a YouTube video, a chat widget, Calendly) means adding
its domains to the right directive: usually `frame-src` for embeds (add `frame-src 'self'
https://www.google.com` and similar), `script-src` and `connect-src` for widgets. Then rerun the
test and check the browser console on the live site. If something breaks right after a deploy,
temporarily renaming the header to `Content-Security-Policy-Report-Only` turns blocking into
console warnings.

## LiteSpeed (Hostinger) notes

What the Apache tests can't prove, and why the rules should still hold on LiteSpeed:

- **mod_rewrite**: LiteSpeed implements Apache's rewrite engine, including `THE_REQUEST`,
  `%{ENV:…}`, `[NC,NE,L,F,R=301]`, `-f`/`-d` tests and PCRE (`(?:…)`, `(?!…)`). Only those
  features are used. No `[END]`, no `<If>` expressions, no `RewriteMap`.
- **Inheritance**: `api/.htaccess` and `api/lib/.htaccess` contain no rewrite rules. On Apache
  the parent's rules then apply to `/api` (and rule 4 stops them). If LiteSpeed doesn't
  inherit them, `/api` simply isn't rewritten at all, which is the same result.
- **`<IfModule>`**: LiteSpeed treats the modules it emulates (rewrite, headers, mime) as
  present. For the others (`negotiation`, `brotli`, `deflate`, `filter`) the block is
  skipped, which is harmless: LiteSpeed has no MultiViews and compresses on its own.
- **`Header always set`, `Header unset`, `ErrorDocument`, `Options -Indexes`,
  `DirectoryIndex`, `AddType`, `AddCharset`, `Require all denied`**: all supported in LiteSpeed `.htaccess`.
- **Hostinger CDN / Cloudflare**: if a CDN ever sits in front and talks plain http to the
  server, rule 2 reads `X-Forwarded-Proto` and doesn't loop.

**After the first deploy**, `./deploy.sh --check` (and the "Check the live site" step in the
GitHub deploy) confirms the important parts on the real server: home, a clean URL, the sitemap,
the API schema, `api/lib` blocked, `.html` → clean redirect, `http://www` → `https://` apex in
one hop, the security headers, and that `book.php` runs and finds its config. For a closer
look, run:

```bash
curl -sI https://blushpicnic.com/packages/            # 301 → /packages
curl -sI http://www.blushpicnic.com/packages.html     # 301 → https://blushpicnic.com/packages.html, then → /packages
curl -sI https://blushpicnic.com/.git/config          # 403
curl -sI https://blushpicnic.com/_astro/              # 403
curl -sI -H 'Accept-Encoding: br, gzip' https://blushpicnic.com/ | grep -i -E 'content-encoding|cache-control|strict'
```

## Bugs the tests caught

1. **Redirect loop on folders.** The first version stripped trailing slashes based on
   `THE_REQUEST` alone. A request for `/_astro/` got a 403, the 403 page went through the rules
   again, `THE_REQUEST` still ended in `/`, so it was redirected to `/_astro`, and Apache's folder
   handling redirected that back to `/_astro/`. Fixed by rule 0 (`REDIRECT_STATUS`) and the
   `REQUEST_URI /$` guard in rule 8.
2. **Lost capture.** Adding the Google-verification exception as a condition *after* the
   capturing condition would have made `%1` empty, so every `.html` URL would have redirected
   to `/`. Fixed by ordering: the capturing condition always comes last.

## Trade-offs, on purpose

- `/404` (no `.html`) serves the 404 page with status 200. Nothing links to it, and it's `noindex`.
- Plain-http requests to `/api/book.php` are redirected to https, so a POST over http would turn
  into a GET (405). The form always posts from an https page, so this never happens in practice.
