# Booking handler (`public/api/book.php`): how it works and how to test it

The booking form posts to `/api/book.php` on Hostinger (PHP 8.1+, Apache/LiteSpeed). The handler
checks the answers against `/api/form-schema.json`, which the build generates from
`src/content/booking-form.yaml`, so the server validates exactly the questions the form shows.
It then emails the request to the business through Hostinger SMTP (PHPMailer) and sends the
client a confirmation.

## Run the tests

```bash
npm run test:api                              # = node tests/api-test.mjs
API_TEST_SKIP_BUILD=1 node tests/api-test.mjs # reuse dist-api/ (PHP files are re-synced from public/api)
```

The test file:

1. builds the site into `dist-api/` (`OUT_DIR=dist-api CACHE_DIR=node_modules/.astro-api npx astro build`), which takes about a minute;
2. copies `public/api/` over `dist-api/api/`, so PHP edits are tested without a rebuild;
3. runs `php -l` on every PHP file;
4. starts `php -S 127.0.0.1:4406 -t dist-api tests/router.php` with
   `BLUSH_CONFIG=tests/fixtures/blush-config.test.php`. Emails become `.eml` files in `tests/.mail/`,
   and rate-limit data and logs go to `tests/.tmp/`. Both folders are git-ignored and wiped at the start of each run;
5. restarts the server with different `TEST_*` env vars for the rate-limit, failure and SMTP checks.

Requirements: Node 20+, PHP 8.1+ CLI with `mbstring`, and port 4406 free (override with `API_TEST_PORT`).
To run beside another copy, also set `API_TEST_DIST`, `API_TEST_CACHE_DIR`, `API_TEST_MAIL_DIR` and `API_TEST_TMP_DIR`
(e.g. `tests/.mail-mine`, `tests/.tmp-mine`; every `tests/.mail*/` and `tests/.tmp*/` folder is git-ignored).
The one test that drives the real `/book` form in Chromium skips itself when no browser is installed.

What it covers:

- **Every occasion** in `form-schema.json`, including `other`, is checked twice: once with only the
  required answers and once with every question that applies. Each run must return 200 and write
  both emails, with the right To, Reply-To, From and Subject, and with every answered question
  shown using the form's labels and option labels.
- **Required questions:** every required question that applies, for every occasion, returns 422
  with `errors[field]` when it's missing.
- **Rejected answers:** a bad email, a bad phone number, a past date, an impossible date or a date
  years away; a bad time; an invalid option, package, occasion or add-on; adults set to 0, 301, a
  word or a fraction; a letter board over 7 words; an answer over its maxLength; two answers for a
  radio.
- **Ignored answers:** questions that don't apply (another occasion's group, `onlyFor`, `showIf`)
  and unknown fields are never validated and never emailed.
- **Safety:** HTML in answers is escaped; a CR/LF header-injection attempt has no effect.
- **Estimate:** extra guests and add-ons are priced as on the site; "Help me choose" shows "To be quoted".
- **Checkboxes:** lists survive repeated keys, `key[]`, multipart and JSON.
- **Spam:** a filled honeypot, a too-fast `_ts`, a fetch() post without `_ts` and a `_ts` far in the
  future all get the same reply as a real send; the request still reaches the business with
  `[Possible spam]` in the subject and a note saying why, and no client confirmation is sent. A
  honeypot hit with invalid answers gets the usual 422. A clock a few minutes ahead and a no-JS
  post (no `_ts`) are normal requests. The rate limit returns 429 with Retry-After, answers that
  need fixing don't count, and a burst of parallel requests can't slip past it; stored data never
  holds a raw IP. A proxy IP header counts only from `trusted_proxies`; IPv6 counts per /64. Over
  `confirm_max_per_hour` the business email still goes out but the confirmation doesn't.
- **Emails:** the business email shows summary rows first (no answer repeated below), its main
  button follows "Best way to reach you", and both parts use CRLF line ends. The client's copy is
  "a summary" of answers from our own lists only (no free-text location, no visitor-chosen To
  name, a greeting name only if it looks like a name), with the booking and security deposits as
  separate steps, a link to `/policies`, and "Not sure yet — we’ll recommend one" for "Help me choose".
- **Errors:** GET returns 405; a plain form post gets a 303 to `/thank-you` or `/book?error=1`; a
  foreign Origin or Referer gets 403; an oversized body gets 413; a bad content type gets 415;
  malformed JSON gets 400; a multipart post with a file part, or too big once parsed, gets 413; a
  missing config gets 500; a failed business email gets 500 with "try again or text us";
  `form-schema.json` without its business facts is refused (there are no typed fallbacks in PHP).
- **Real SMTP code path:** a tiny fake SMTP server in the test checks AUTH, MAIL FROM and RCPT for
  both emails. When login is rejected, the handler returns 500 and keeps a copy in `data_dir/unsent/`.

Not covered locally: TLS to smtp.hostinger.com and the `.htaccess` rules, because `php -S` ignores
`.htaccess`. Check both once on the live site (see the deployment checklist below).

## Contract for the booking form (front end)

- `POST /api/book.php` with `Accept: application/json`. Send the body as `FormData` (multipart) or
  `URLSearchParams` (urlencoded), or as JSON.
  - Success: `200 {"ok":true,"ref":"BP-20261003-AB12","message":"…"}`
  - Answers to fix: `422 {"ok":false,"message":"Please check the highlighted answers.","errors":{"<field id>":"How to fix it…"}}`
  - Other failures: `403 / 413 / 415 / 429 / 500 {"ok":false,"message":"…"}`. Show `message`, because it always offers the phone number.
- Without JavaScript (a plain `<form method="post" action="/api/book.php">`), the reply is a 303 to
  `/thank-you`, or to `/book?error=1` if something went wrong.
- Field names are the field ids from `booking-form.yaml`. **Name checkbox inputs `addons[]` /
  `romance_extras[]`, or post urlencoded.** In a multipart body, PHP keeps only the last of
  several same-named keys without `[]`. Toggles send `yes` (also accepted: `on`, `true`, `1`).
- Spam fields:
  - `company_website`: a honeypot. Keep it empty, visually hidden, with `tabindex="-1"` and `autocomplete="off"`.
  - `_ts`: `Date.now()` from when the form was shown. Always send it with fetch(). A request sent
    sooner than `min_seconds` (4 s) after it, without it (fetch only), or with it more than
    10 minutes in the future is treated like a honeypot hit: answered as usual, emailed to the
    business flagged `[Possible spam]`, no client confirmation. Nothing is ever silently dropped.

## Files

| Path | What it is |
| --- | --- |
| `public/api/book.php` | Entry point: PHP settings, then `Blush\Handler` |
| `public/api/lib/Handler.php` | The request flow: method, config, origin, body, spam signals, rate limit, validation, emails, response |
| `public/api/lib/Validator.php` | Schema-driven validation (applicability, type rules, human error messages) |
| `public/api/lib/FormSchema.php` | Reads `form-schema.json`, option labels, business facts, deposit sentence |
| `public/api/lib/Booking.php`, `Estimate.php`, `Emails.php` | Formatting, starting estimate, HTML + text emails |
| `public/api/lib/Mailer.php` | PHPMailer over SMTP, or `.eml` files (`mail_transport: 'file'`); keeps unsent copies |
| `public/api/lib/Store.php` | `data_dir` helpers: per-IP rate limit and the site-wide confirmation cap (HMAC-hashed IPs, one `flock`'d read-modify-write per claim), event log without personal details |
| `public/api/lib/Config.php`, `Http.php` | Config loading and defaults; body parsing and responses |
| `public/api/lib/PHPMailer/` | PHPMailer 7.1.1, vendored unchanged (LGPL-2.1, see `LICENSE`) |
| `public/api/.htaccess`, `public/api/lib/.htaccess` | Only `book.php` and `form-schema.json` are reachable; `lib/` is denied; no listings |
| `api-config/blush-config.example.php` | Every setting, documented; copy it to `blush-config.php` above `public_html` |
| `tests/fixtures/blush-config.test.php` | Test-only config (file transport, `tests/.mail`, `tests/.tmp`; `TEST_*` env overrides) |

## Deployment checklist (Hostinger)

1. Upload `dist/` to `public_html/`. `api/book.php`, `api/lib/` and `api/form-schema.json` are part of the build.
2. Copy `api-config/blush-config.example.php` to `domains/blushpicnic.com/blush-config.php`,
   which sits next to `public_html`, not inside it. Fill in `smtp_password`.
3. Open `https://blushpicnic.com/api/lib/Config.php` and `https://blushpicnic.com/api/lib/PHPMailer/LICENSE`.
   Both must return **403**. `https://blushpicnic.com/api/form-schema.json` must load, and
   `https://blushpicnic.com/api/book.php` must answer 405 **JSON** (a 403 page means the server
   blocks the handler). `./deploy.sh --check` runs these.
4. Send a real test booking. Expect an email at blush.picnic25@gmail.com within a minute and a
   confirmation at the address you entered. If it fails, check hPanel's PHP error log for lines
   starting with `[blush-book]`, and look in `domains/blushpicnic.com/blush-data/unsent/` for the saved request.
5. To update PHPMailer later, replace `PHPMailer.php`, `SMTP.php`, `Exception.php`, `LICENSE` and
   `VERSION` in `public/api/lib/PHPMailer/` with the files from a newer release on
   https://github.com/PHPMailer/PHPMailer/releases.
