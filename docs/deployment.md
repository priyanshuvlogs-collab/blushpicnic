# Deploying blushpicnic.com

This is the full runbook. The owner's short version is in [HANDOVER.md](../HANDOVER.md) → "Publishing your changes".

## What lives where on Hostinger

FTP logs in to the **domain folder**, which *contains* `public_html`:

```
domains/blushpicnic.com/          ← FTP starts here (SSH starts one level up, in your home folder)
├── blush-config.php              booking settings + mailbox password: private, never inside public_html
├── blush-data/                   created by the booking handler: rate limit, activity log, unsent/ copies
└── public_html/                  the website = the contents of dist/
    ├── .htaccess                 HTTPS, clean URLs, caching, security headers
    ├── index.html, packages.html, proposal-picnic-toronto.html, …, 404.html
    ├── sitemap-index.xml, sitemap-0.xml, robots.txt, favicons, og.jpg
    ├── _astro/                   fingerprinted CSS, JS, fonts and images
    └── api/                      book.php, form-schema.json, lib/ (PHPMailer), .htaccess
```

The booking handler finds its settings at `dirname(public_html/api, 2)/blush-config.php`, which
is the domain folder. Anything outside `public_html` can't be opened from a browser.

## Before the very first deploy (go-live checklist)

1. **The domain points to Hostinger**: hPanel → Domains → blushpicnic.com shows it as active.
2. **SSL is on**: hPanel → Security → SSL, with blushpicnic.com and www.blushpicnic.com covered (the free certificate is fine).
   This must come **before** the first deploy, because `.htaccess` sends every visitor to `https://`.
   Without a certificate, they would see a browser warning.
3. **PHP 8.1 or newer**: hPanel → Advanced → PHP Configuration. 8.2 or 8.3 is ideal. On the same
   page (PHP options), set **display_errors Off**: `book.php` switches it off itself, but only once
   it runs, so PHP's own start-up warnings would otherwise follow the hPanel setting.
4. **The mailbox exists**: hPanel → Emails → Email Accounts → support@blushpicnic.com. Keep its password at hand.
5. **Booking settings**: create `blush-config.php` and put it next to `public_html` (see
   "Uploading blush-config.php" below).
6. **A backup of whatever is there now**: `./deploy.sh` does this automatically on its first
   run. If you deploy with GitHub Actions first, make one in hPanel → Files → Backups.
7. **Change the FTP password** if it was ever sent in a chat or email (hPanel → Files → FTP
   Accounts), then use the new one everywhere below. Keep the repository **private**: the FTP
   host and username belong only in `deploy.env` (git-ignored) and GitHub Secrets, never in a file in git.

`public_html/.htaccess` belongs to this project, and every deploy replaces it with
`public/.htaccess`. hPanel switches that write into `.htaccess` (such as "Force HTTPS") aren't
needed, because the project's file already does it. Make server-rule changes in `public/.htaccess`
and run `bash docs/htaccess-test.sh` before deploying.

After the first deploy:

- Send a real test booking (HANDOVER.md → One-time setup, step 7).
- `curl -i -X POST -H 'Accept: application/json' https://blushpicnic.com/api/book.php` must answer
  `415` with JSON (`{"ok":false,…}`), not the site's "page not found" page. `./deploy.sh --check`
  tests the same thing.
- Send a second test booking from another network (e.g. phone data instead of Wi-Fi) and check
  the `"ip"` values of the two `sent` lines in `blush-data/booking-YYYY-MM.log` differ. If they're
  the same, a proxy sits in front of the site and every visitor shares one rate limit: set
  `client_ip_header` and `trusted_proxies` in `blush-config.php` (see the example file).

## Option A: GitHub Actions (recommended for the owner)

**One-time:** GitHub → the repository → Settings → Secrets and variables → Actions → *New repository secret*, three times:

| Name | Value |
| --- | --- |
| `FTP_SERVER` | the FTP host **name** from hPanel → Files → FTP Accounts: the name on the server's certificate, which `./deploy.sh --show-cert` prints (not the IP address) |
| `FTP_USERNAME` | the FTP username from the same page |
| `FTP_PASSWORD` | the FTP password |

Optional *variables* (same page, Variables tab): `SITE_URL` (default `https://blushpicnic.com`),
`FTP_PORT` (default 21), `FTP_TLS_SECURITY` (`strict` by default; `loose` switches the certificate
check off, so avoid it).

Also: Settings → Environments → **production** → Deployment branches → *Selected branches* → add
`main` (and, if you like, a required reviewer). The workflow itself only deploys from `main` too.

**Each deploy:** Actions → **Deploy to Hostinger** → **Run workflow** → Run workflow. It takes 2–4
minutes. The steps:

1. checks the three secrets exist (and that it runs from `main`);
2. `npm ci` and `npm run build`; a broken content file (a typo in a YAML file) stops here, and nothing is uploaded;
3. checks the build: the key files exist, and so does every logo and icon file a page, the manifest,
   JSON-LD or the booking emails link to; no secret-looking file, saved email or the FTP password
   is inside; no file outside `_astro/` is named like a fingerprinted one; the booking emails' business facts are there;
4. runs `php -l` and the booking API tests (`npm run test:api`) against that build;
5. uploads `dist/` to `public_html/` over **FTPS** with SamKirkland/FTP-Deploy-Action 4.3.5
   (pinned to its exact commit, since the action receives the password).
   Only files that changed since the last Actions deploy are sent. Files removed from the site
   are deleted, and nothing else on the server is touched (`dangerous-clean-slate: false`). Its
   memory is `public_html/.ftp-deploy-sync-state.json`, which `.htaccess` hides from the web;
6. runs `./deploy.sh --check` against the live site (it can be switched off in the Run workflow form).

The green tick and the "production" environment link at the top of the run show it's live.

**Encryption:** the upload is always FTPS, so the password and files travel encrypted, and the
action checks the server's certificate (`security: strict`), so an impostor can't catch the
password. Certificates are issued to names, so `FTP_SERVER` must be the hostname printed by
`./deploy.sh --show-cert`; with an IP address the upload stops with a certificate error.

**Deploying on every push instead** (once you're comfortable with it): in
`.github/workflows/deploy.yml`, add this under `on:`, next to `workflow_dispatch:`

```yaml
  push:
    branches: [main]
    paths-ignore: ['**.md', 'docs/**']
```

Then consider protecting `main` (Settings → Branches) so only changes that pass CI land there.

**Mixing with `./deploy.sh`:** that's safe. `deploy.sh` deletes the action's state file after
each upload, so the next Actions deploy re-sends everything once instead of trusting a stale list.

## Option B: `./deploy.sh` from a computer

Requirements: Node 20+, `lftp` (`brew install lftp` on macOS, `sudo apt install lftp` on
Ubuntu/WSL), and `curl` for the checks. Works with the bash that ships with macOS.

```bash
cp deploy.env.example deploy.env      # fill in; deploy.env is git-ignored
./deploy.sh --dry-run                 # builds, connects, lists what would change
./deploy.sh                           # builds, backs up (first run), uploads, verifies, checks
```

| Flag | What it does |
| --- | --- |
| `--dry-run` | Build, connect, then list uploads and deletions. Changes nothing, downloads nothing |
| `--backup` | Download `public_html` to `backups/<date>/` before uploading. **Automatic on the first run** from each computer (marker: `backups/.first-backup-<host>`) |
| `--delete` | Also remove server files that aren't in the build. Shows the list and asks first |
| `--config FILE` | Upload `FILE` as `blush-config.php` to the folder above `public_html`, with permissions 600 (asks first) |
| `--install` | Run `npm ci` before building (also automatic when `node_modules/` is missing) |
| `--skip-build` | Upload the existing `dist/` |
| `--check` | Only run the live checks (no FTP needed) |
| `--show-cert` | Print the FTP server's certificate names and fingerprint |
| `--yes` | Don't ask (for scripts). The first-run backup still happens |
| `--env FILE` | Read settings from another file |

**What a deploy does, in order:**

1. Builds (`npm run build`) and checks the build: required files present, no `blush-config.php`,
   `.env`, keys, saved emails (`.eml`) or the FTP password inside, no file outside `_astro/` named
   like a fingerprinted build file, and the business facts in `api/form-schema.json`.
2. Connects with FTPS (`ftp:ssl-force`, so it never falls back to plain FTP) and checks
   `REMOTE_DIR` exists. Clear hints for a wrong password, a wrong folder or a certificate problem.
3. Shows the plan and asks.
4. Backup (first run, or with `--backup`).
5. Uploads in an order that keeps the site working throughout:
   1. new files in `_astro/`. They're fingerprinted, so they're compared by size only, and an
      unchanged build uploads nothing here;
   2. pages, the API and root files (about 60 small files, always re-sent: timestamps on shared
      hosting aren't reliable enough to decide what changed);
   3. with `--delete` only: old `_astro/` files and removed pages.

   Every file is uploaded under a temporary dot-name and then renamed, so visitors never get a
   half-written page.
6. **Verifies** every file's size on the server against the build, and re-sends anything
   missing or incomplete (up to 4 times). If the server can't even be listed, it says so (and the
   run ends "Uploaded, but … need a look") instead of reporting a match.
7. Removes the GitHub Action's state file (see "Mixing" above), uploads `blush-config.php` if
   `--config` was given, and runs the live checks.

**`--delete` never removes:** `.well-known/` (SSL renewals), `.user.ini` (Hostinger's PHP
settings), `cgi-bin/`, Google, Bing and Yandex verification files,
`.ftp-deploy-sync-state.json`, and anything listed in `KEEP_REMOTE` in `deploy.env`.

**Certificate check.** `FTP_VERIFY_CERT=yes` is the default. If the first run stops with
"certificate couldn't be verified", run `./deploy.sh --show-cert`. It prints the names on the
certificate and its fingerprint. Either set `FTP_HOST` to one of those names (best), or put the
printed `FTP_CERT_FINGERPRINT=…` line into `deploy.env`. That trusts exactly that certificate,
so an impostor server is still refused. When Hostinger renews the certificate, the fingerprint
changes and the script tells you; run `--show-cert` again on a network you trust.

**SFTP / rsync (after SSH is switched on).** hPanel → Advanced → SSH Access → enable it. It's
usually port 65002 with the same username. In `deploy.env`:

```
PROTOCOL=sftp                                   # or rsync (fastest: compares contents)
FTP_PORT=65002
REMOTE_DIR=domains/blushpicnic.com/public_html  # SSH starts in your home folder
SSH_KEY=~/.ssh/id_ed25519                       # required for rsync; optional for sftp (else password)
```

Add the public key (`~/.ssh/id_ed25519.pub`) in hPanel → Advanced → SSH Access → SSH keys. The
first connection remembers the server's key (`StrictHostKeyChecking=accept-new`), and a changed
key is refused from then on.

**Windows:** run `deploy.sh` inside WSL (Ubuntu), or use Option A.

## Option C: by hand in hPanel (emergency only)

`npm run build`, then hPanel → Files → File Manager → `domains/blushpicnic.com/public_html` →
Upload, and upload the **contents** of `dist/`, including the hidden `.htaccess` and
`api/.htaccess`, `api/lib/.htaccess` (switch on "show hidden files"). Upload `_astro/` before
the pages.

## Uploading `blush-config.php`

1. Copy `api-config/blush-config.example.php` to a file **outside the project folder**, named
   `blush-config.php`. Put the mailbox password for support@blushpicnic.com in `smtp_password`.
2. Upload it with one of these:
   - `./deploy.sh --config ~/path/to/blush-config.php`, which puts it next to `public_html` with permissions 600, or
   - hPanel → Files → File Manager → open `domains/blushpicnic.com` (the folder that *contains*
     `public_html`) → Upload → choose the file.
3. `./deploy.sh --check` should then report "Booking handler runs" and "Booking handler found blush-config.php".
4. Delete your local copy, or keep it somewhere private. Never commit it, and never put it in `public_html`.

## After a logo or favicon change

Pages link the brand files (favicons, app icons, `og.jpg`, `logo.png`, `brand/*.svg`) and the
manifest with `?v=<content hash>` (`src/lib/brand.ts`), so a changed file gets a new URL and
browsers, the CDN and Google fetch it instead of the 30-day cached copy. Nothing to bump by hand.
Once, after deploying a new logo or favicon (the first deploy of the Logo Guide rebrand included):

1. Flush Hostinger's CDN: hPanel → the website → Performance → CDN → Flush cache. The edge may
   still hold the old files at their bare URLs (`/favicon.ico` is also fetched without `?v=`),
   and if the CDN leaves query strings out of its cache key, `?v=` alone won't get past it.
2. Search Console → URL Inspection → `https://blushpicnic.com` → Request indexing, so Google
   refetches the favicon.
3. Optional: Facebook's Sharing Debugger → Scrape again, for link previews (cached by URL too).

Safari and iOS keep a favicon cache of their own; the old icon can show there for a while.

## Rolling back

- **GitHub Actions:** Actions → Deploy to Hostinger → open the last *good* run → **Re-run all
  jobs** (possible for runs from the last 30 days). It rebuilds and uploads that older version.
- **From a computer:** `git checkout <good-commit>`, then `./deploy.sh`, then `git checkout main`.
- **From a backup:** `backups/<date>/public_html` is the site as it was before that deploy. Upload
  it with `lftp`, or as a quick one-off:
  `DEPLOY_DIST=backups/<date>/public_html ./deploy.sh --skip-build`. The build checks need the usual files.
  Hostinger also keeps its own backups: hPanel → Files → Backups.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Browser warning "connection not private" after deploying | SSL isn't active yet. hPanel → Security → SSL. `.htaccess` sends everyone to https |
| "Too many redirects" | A CDN or proxy in front talks plain http to the server without `X-Forwarded-Proto`. Check hPanel's CDN settings; see rule 2 in docs/htaccess-tests.md |
| Pages work but look unstyled | `_astro/` didn't upload completely. Run `./deploy.sh` again; it verifies sizes |
| 500 on every page | A typo in `.htaccess`. Restore the previous one from `backups/`, and run `bash docs/htaccess-test.sh` before deploying |
| `--check`: "Booking handler can't read blush-config.php" | The config is missing or in the wrong folder (it must be next to `public_html`), or it has a PHP syntax error (`php -l blush-config.php`), or PHP is older than 8.1. The PHP error log has a `[blush-book]` line naming the cause |
| `--check`: "got the server's own 403 page" / "expected book.php's 405 JSON" | The server refuses `api/book.php` before PHP runs, so **every booking fails**. Check `public_html/api/.htaccess` is the project's file (its deny rule leaves `book.php` out by name); if Hostinger still blocks it, ask their support why `/api/book.php` gets a 403 |
| Booking requests don't arrive | Check spam. Then look for `[blush-book]` lines in hPanel's PHP error log and for saved copies in `domains/blushpicnic.com/blush-data/unsent/`. Check `smtp_password`, and set up SPF/DKIM/DMARC (HANDOVER.md) |
| `deploy.sh`: "certificate couldn't be verified" | See "Certificate check" above |
| `deploy.sh`: files "arrived incomplete" repeatedly | Set `PARALLEL=2` in `deploy.env` |
| GitHub deploy: "Missing repository secrets" | Add `FTP_SERVER`, `FTP_USERNAME` and `FTP_PASSWORD` (Option A) |
| GitHub deploy fails at "Build the site" | A content file has a mistake. The log names the file and field (e.g. a missing quote in a YAML file). Fix it on GitHub and run the deploy again |
