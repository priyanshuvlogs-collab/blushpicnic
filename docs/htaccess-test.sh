#!/usr/bin/env bash
# Runs public/.htaccess (as dist/.htaccess) on a real, throw-away Apache 2.4 and checks every
# redirect, clean URL, blocked file, cache header, compression and security header.
# Results and the reasoning per rule: docs/htaccess-tests.md.
#
#   npm run build && bash docs/htaccess-test.sh            # tests ./dist
#   bash docs/htaccess-test.sh dist-xyz                    # tests another build folder
#
# Needs: apache2 (Debian/Ubuntu: apt-get install apache2 libapache2-mod-php), openssl, curl.
# HTACCESS_CONFIG=file copies a blush-config.php next to the document root (booking handler checks).
# HTACCESS_HOLD=1 keeps Apache running after the checks (for browser tests); Ctrl+C stops it.
# HTACCESS_LOGLEVEL="warn rewrite:trace3" prints mod_rewrite's step-by-step log at the end.
# Runs as root or as a normal user (ports 18080/18443 by default: HTACCESS_HTTP_PORT / HTACCESS_HTTPS_PORT).
# Nothing outside a temporary folder is touched; Apache is stopped at the end.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$(cd "$ROOT" && realpath "${1:-dist}")"
HTTP_PORT="${HTACCESS_HTTP_PORT:-18080}"
HTTPS_PORT="${HTACCESS_HTTPS_PORT:-18443}"
HOST="blushpicnic.com"

APACHE="$(command -v apache2 || command -v httpd || true)"
MODS=""
for d in /usr/lib/apache2/modules /usr/lib64/httpd/modules /usr/lib/httpd/modules; do
  [[ -d "$d" ]] && MODS="$d" && break
done
[[ -n "$APACHE" && -n "$MODS" ]] || { echo "apache2 not found (apt-get install apache2 libapache2-mod-php)"; exit 2; }
[[ -f "$DIST/.htaccess" && -f "$DIST/index.html" ]] || { echo "No build at $DIST (run npm run build first)"; exit 2; }

WORK="$(mktemp -d)"
cleanup() {
  if [[ -f "$WORK/httpd.pid" ]]; then kill "$(cat "$WORK/httpd.pid")" 2>/dev/null || true; sleep 0.5; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── Document root: the build plus files a real public_html might contain ─────
DOCROOT="$WORK/public_html"
cp -a "$DIST" "$DOCROOT"
mkdir -p "$DOCROOT/.git" "$DOCROOT/.well-known/acme-challenge"
echo "[core]" > "$DOCROOT/.git/config"
echo "SECRET=1" > "$DOCROOT/.env"
echo "{}" > "$DOCROOT/.ftp-deploy-sync-state.json"
echo "acme-ok" > "$DOCROOT/.well-known/acme-challenge/test-token"
echo "<?php echo 'hostinger default page';" > "$DOCROOT/default.php"
echo "# notes" > "$DOCROOT/README.md"
echo "PHP Warning: something" > "$DOCROOT/error_log"
echo "{}" > "$DOCROOT/composer.json"
echo "google-site-verification: google1234567890abcdef.html" > "$DOCROOT/google1234567890abcdef.html"
first() { local f=("$DOCROOT"/_astro/*."$1"); [[ -e "${f[0]}" ]] || { echo "no .$1 file in _astro/" >&2; exit 2; }; echo "${f[0]##*/}"; }
CSS="$(first css)"; JS="$(first js)"; AVIF="$(first avif)"; WOFF2="$(first woff2)"
# HTACCESS_CONFIG=path/to/blush-config.php puts a booking config next to public_html, like Hostinger.
if [[ -n "${HTACCESS_CONFIG:-}" ]]; then cp "$HTACCESS_CONFIG" "$WORK/blush-config.php"; mkdir -p "$WORK/blush-data"; fi
chmod -R a+rX "$WORK"
[[ -d "$WORK/blush-data" ]] && chmod 777 "$WORK/blush-data"

# ── Apache: plain http + https (self-signed), AllowOverride All, mod_php ──────
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$HOST" \
  -addext "subjectAltName=DNS:$HOST,DNS:www.$HOST" \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" >/dev/null 2>&1

PHP_MOD="$(find "$MODS" -maxdepth 1 -name 'libphp*.so' | head -1)"
RUN_USER="$(id -un)"; RUN_GROUP="$(id -gn)"
if [[ "$(id -u)" == 0 ]]; then RUN_USER=www-data; RUN_GROUP=www-data; fi

load() { [[ -f "$MODS/$2" ]] && echo "LoadModule $1 $MODS/$2"; return 0; }
{
  echo "ServerRoot $WORK"
  echo "ServerName $HOST"
  load mpm_prefork_module mod_mpm_prefork.so
  for m in authz_core authz_host access_compat dir mime rewrite headers deflate brotli filter ssl \
           socache_shmcb negotiation env setenvif alias autoindex; do
    load "${m}_module" "mod_${m}.so"
  done
  [[ -n "$PHP_MOD" ]] && echo "LoadModule php_module $PHP_MOD"
  cat <<CONF
User $RUN_USER
Group $RUN_GROUP
PidFile $WORK/httpd.pid
ErrorLog $WORK/error.log
LogLevel ${HTACCESS_LOGLEVEL:-warn}
Mutex file:$WORK default
TypesConfig /etc/mime.types
Listen 127.0.0.1:$HTTP_PORT
Listen 127.0.0.1:$HTTPS_PORT
DocumentRoot "$DOCROOT"
<Directory />
  AllowOverride None
  Require all denied
</Directory>
<Directory "$DOCROOT">
  AllowOverride All
  Require all granted
</Directory>
<FilesMatch "\.php$">
  SetHandler application/x-httpd-php
</FilesMatch>
# Self-referential URLs (redirects to a bare path) use the production names and ports.
UseCanonicalName On
<VirtualHost 127.0.0.1:$HTTP_PORT>
  ServerName http://$HOST:80
  DocumentRoot "$DOCROOT"
</VirtualHost>
<VirtualHost 127.0.0.1:$HTTPS_PORT>
  ServerName https://$HOST:443
  DocumentRoot "$DOCROOT"
  SSLEngine on
  SSLCertificateFile $WORK/cert.pem
  SSLCertificateKeyFile $WORK/key.pem
</VirtualHost>
CONF
} > "$WORK/httpd.conf"

"$APACHE" -f "$WORK/httpd.conf" -k start
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$HTTP_PORT/" && break; sleep 0.1; done

# ── Checks ───────────────────────────────────────────────────────────────────
pass=0; fail=0
# check <label> <scheme> <host> <path> <status> [location] [-- header-regex|!header-regex...] [@body body-regex...]
check() {
  local label="$1" scheme="$2" host="$3" path="$4" want="$5"; shift 5
  local want_loc="" ; if [[ $# -gt 0 && "$1" != "--" && "$1" != "@body" ]]; then want_loc="$1"; shift; fi
  local port=$HTTP_PORT; [[ "$scheme" == https ]] && port=$HTTPS_PORT
  local hdr="$WORK/h" body="$WORK/b" extra=()
  [[ -n "${XFP:-}" ]] && extra+=(-H "X-Forwarded-Proto: $XFP")
  [[ -n "${AE:-}" ]] && extra+=(-H "Accept-Encoding: $AE")
  [[ "${METHOD:-}" == HEAD ]] && extra+=(--head)
  local code
  code="$(curl -sk --path-as-is -o "$body" -D "$hdr" -w '%{http_code}' -H "Host: $host" "${extra[@]}" \
    "$scheme://127.0.0.1:$port$path" || true)"
  sed -i "s/\r$//" "$hdr"
  local loc; loc="$(grep -i '^location:' "$hdr" | head -1 | sed -E 's/^[Ll]ocation: *//; s/\r$//' || true)"
  local ok=1 why=""
  [[ "$code" == "$want" ]] || { ok=0; why+=" status=$code"; }
  [[ -z "$want_loc" || "$loc" == "$want_loc" ]] || { ok=0; why+=" location=$loc"; }
  local mode=""
  for a in "$@"; do
    case "$a" in
      --) mode=h ;;
      @body) mode=b ;;
      *) if [[ "$mode" == h && "$a" == '!'* ]]; then ! grep -qiE "${a#!}" "$hdr" || { ok=0; why+=" unwanted-header[${a#!}]"; }
         elif [[ "$mode" == h ]]; then grep -qiE "$a" "$hdr" || { ok=0; why+=" missing-header[$a]"; }
         elif [[ "$mode" == b ]]; then grep -qE "$a" "$body" || { ok=0; why+=" body!~[$a]"; }; fi ;;
    esac
  done
  if (( ok )); then pass=$((pass+1)); printf '  ok    %-58s %s %s\n' "$label" "$code" "$loc"
  else fail=$((fail+1)); printf '  FAIL  %-58s want %s %s —%s\n' "$label" "$want" "$want_loc" "$why"; fi
}
# hops <label> <start-url-path> <scheme> <host> <expected-final-url> <expected-hops>
hops() {
  local label="$1" path="$2" scheme="$3" host="$4" final="$5" n="$6" count=0 url
  url="$scheme://$host$path"
  while (( count < 6 )); do
    local s=${url%%://*} rest=${url#*://}; local h=${rest%%/*} p="/${rest#*/}"
    local port=$HTTP_PORT; [[ "$s" == https ]] && port=$HTTPS_PORT
    local out; out="$(curl -sk --path-as-is -o /dev/null -D - -H "Host: $h" "$s://127.0.0.1:$port$p")"
    local code; code="$(head -1 <<<"$out" | awk '{print $2}')"
    [[ "$code" == 301 ]] || break
    url="$(grep -i '^location:' <<<"$out" | head -1 | sed -E 's/^[Ll]ocation: *//; s/\r$//' || true)"
    count=$((count+1))
  done
  if [[ "$url" == "$final" && "$count" == "$n" ]]; then pass=$((pass+1)); printf '  ok    %-58s %s hop(s) → %s\n' "$label" "$count" "$url"
  else fail=$((fail+1)); printf '  FAIL  %-58s %s hop(s) → %s (want %s → %s)\n' "$label" "$count" "$url" "$n" "$final"; fi
}

A="https://$HOST"
echo "Host and scheme"
check "http apex → https"                       http  "$HOST"       /                  301 "$A/"
check "http www → https apex (one hop)"         http  "www.$HOST"   /                  301 "$A/"
check "https www → https apex"                  https "www.$HOST"   /packages          301 "$A/packages"
check "http www keeps the query string"         http  "www.$HOST"   "/book?occasion=proposal" 301 "$A/book?occasion=proposal"
check "http api is upgraded too"                http  "$HOST"       /api/book.php      301 "$A/api/book.php"
XFP=https check "proxy already on https: no loop" http "$HOST"      /packages          200
hops  "http://www…/packages/ → canonical"       /packages/ http "www.$HOST" "$A/packages" 2
hops  "http://www…/packages.html → canonical"   /packages.html http "www.$HOST" "$A/packages" 2

echo "Pages and clean URLs"
check "home"                                    https "$HOST" /                        200 -- '^cache-control: no-cache' '^content-type: text/html; charset=utf-8' @body '<h1'
check "clean URL serves packages.html"          https "$HOST" /packages                200 -- '^cache-control: no-cache' @body '<title>'
check "occasion page"                           https "$HOST" /proposal-picnic-toronto 200
check "booking deep link keeps its query"       https "$HOST" "/book?occasion=proposal&package=proposal-romance" 200
check "trailing slash removed"                  https "$HOST" /packages/               301 "$A/packages"
check "several trailing slashes removed"        https "$HOST" /packages//              301 "$A/packages"
check "trailing slash removed, query kept"      https "$HOST" "/packages/?utm_source=ig" 301 "$A/packages?utm_source=ig"
check "encoded path stays encoded"              https "$HOST" "/a%20b/"                301 "$A/a%20b"
check ".html removed"                           https "$HOST" /packages.html           301 "$A/packages"
check ".html removed, query kept"               https "$HOST" "/packages.html?a=1"     301 "$A/packages?a=1"
check "/index.html → /"                         https "$HOST" /index.html              301 "$A/"
check "/index → /"                              https "$HOST" /index                   301 "$A/"
check "missing page → 404 page"                 https "$HOST" /no-such-page            404 -- '^cache-control: no-cache' @body 'noindex'
check "missing nested page → 404, no loop"      https "$HOST" /packages/extra          404
check "missing nested .html → clean, then 404"  https "$HOST" /packages/extra.html     301 "$A/packages/extra"
check "dotted path → 404"                       https "$HOST" /a.b                     404
check "//host/x.html is not an open redirect"   https "$HOST" //evil.example/x.html    301 "$A/evil.example/x"
check "google verification file not redirected" https "$HOST" /google1234567890abcdef.html 200
check "missing google file → plain 404"         https "$HOST" /google0000000000000000.html 404
METHOD=HEAD check "HEAD /"                      https "$HOST" /                        200

echo "Files, types and caching"
check "sitemap index"                           https "$HOST" /sitemap-index.xml       200 -- 'max-age=3600' '^content-type: (application|text)/xml'
check "robots.txt"                              https "$HOST" /robots.txt              200 -- 'max-age=3600' '^content-type: text/plain'
check "manifest"                                https "$HOST" /site.webmanifest        200 -- 'max-age=86400' '^content-type: application/manifest\+json'
check "og.jpg (not fingerprinted): 30 days"     https "$HOST" /og.jpg                  200 -- 'max-age=2592000' '^content-type: image/jpeg'
check "favicon.ico: 30 days"                    https "$HOST" /favicon.ico             200 -- 'max-age=2592000'
check "_astro css: 1 year immutable"            https "$HOST" "/_astro/$CSS"           200 -- 'max-age=31536000, immutable' '^content-type: text/css'
check "_astro js: 1 year immutable"             https "$HOST" "/_astro/$JS"            200 -- 'max-age=31536000, immutable' '^content-type: text/javascript'
check "_astro avif: 1 year immutable"           https "$HOST" "/_astro/$AVIF"          200 -- 'max-age=31536000, immutable' '^content-type: image/avif'
check "_astro woff2: 1 year immutable"          https "$HOST" "/_astro/$WOFF2"         200 -- 'max-age=31536000, immutable' '^content-type: font/woff2'
check "no folder listing (our page, 403 status)" https "$HOST" /_astro/                 403 @body 'noindex'
AE=br check "brotli for text"                   https "$HOST" /packages                200 -- '^content-encoding: br' '^vary: .*accept-encoding'
AE=gzip check "gzip fallback"                   https "$HOST" "/_astro/$CSS"           200 -- '^content-encoding: gzip'
AE=br check "images are not recompressed"       https "$HOST" "/_astro/$AVIF"          200 -- '!^content-encoding:'

echo "Booking API (never rewritten)"
check "form-schema.json"                        https "$HOST" /api/form-schema.json    200 -- 'max-age=300' '^content-type: application/json'
if [[ -n "$PHP_MOD" ]]; then
check "book.php runs (GET → 405 JSON)"          https "$HOST" /api/book.php            405 -- '^content-type: application/json'
fi
check "api lib code blocked"                    https "$HOST" /api/lib/Config.php      403
check "PHPMailer licence blocked"               https "$HOST" /api/lib/PHPMailer/LICENSE 403
check "api folder: no listing"                  https "$HOST" /api/                    403
check "/api gets its slash from Apache"         https "$HOST" /api                     301 "$A/api/"
check "api .htaccess blocked"                   https "$HOST" /api/.htaccess           403

echo "Blocked files"
check ".htaccess"                               https "$HOST" /.htaccess               403
check ".git folder"                             https "$HOST" /.git/config             403
check ".env"                                    https "$HOST" /.env                    403
check "deploy action state file"                https "$HOST" /.ftp-deploy-sync-state.json 403
check ".well-known stays open (SSL renewals)"   https "$HOST" /.well-known/acme-challenge/test-token 200
check "stray PHP (Hostinger default.php)"       https "$HOST" /default.php             403
check "markdown"                                https "$HOST" /README.md               403
check "PHP error_log"                           https "$HOST" /error_log               403
check "composer.json"                           https "$HOST" /composer.json           403

echo "Security headers"
check "headers on pages"                        https "$HOST" /packages 200 -- \
  '^x-content-type-options: nosniff' '^referrer-policy: strict-origin-when-cross-origin' \
  '^x-frame-options: SAMEORIGIN' '^permissions-policy: camera=\(\)' '^strict-transport-security: max-age=31536000$' \
  "^content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com"
check "headers on 404s too"                     https "$HOST" /no-such-page 404 -- '^x-content-type-options: nosniff' '^content-security-policy:'
check "headers on redirects too"                http  "$HOST" /packages 301 -- '^strict-transport-security:'
if [[ -n "$PHP_MOD" ]]; then
  if curl -sk -D - -o /dev/null -H "Host: $HOST" "https://127.0.0.1:$HTTPS_PORT/api/book.php" | grep -qi '^x-powered-by'; then
    fail=$((fail+1)); echo "  FAIL  X-Powered-By is still sent by PHP"
  else pass=$((pass+1)); echo "  ok    no X-Powered-By on PHP responses"; fi
fi

if [[ "${HTACCESS_LOGLEVEL:-}" == *trace* ]]; then echo; echo "Apache log:"; cat "$WORK/error.log"; fi
# Expected noise: denied files (AH01630/AH01797), forbidden listings (AH01276). Anything else is shown.
unexpected="$(grep -iE 'error|invalid|not allowed' "$WORK/error.log" | grep -vE 'AH01630|AH01797|AH01276|AH00163|client denied' || true)"
if [[ -n "$unexpected" ]]; then echo; echo "Apache error log (unexpected lines):"; tail -20 <<<"$unexpected"; fi
if [[ -n "${HTACCESS_HOLD:-}" ]]; then
  echo; echo "Still serving: http://127.0.0.1:$HTTP_PORT and https://127.0.0.1:$HTTPS_PORT (send Host: $HOST). Ctrl+C to stop."
  echo "Certificate (for curl's CURL_CA_BUNDLE): $WORK/cert.pem"
  while :; do sleep 3600; done
fi
echo
echo "$pass passed, $fail failed  (Apache: $("$APACHE" -v | head -1 | sed 's/Server version: //'))"
(( fail == 0 ))
