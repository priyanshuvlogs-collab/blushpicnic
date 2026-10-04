#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Blush Picnic — build the website and upload it to Hostinger.
#
#    ./deploy.sh                  build, then upload (asks before changing anything)
#    ./deploy.sh --dry-run        build, then list what would be uploaded; changes nothing
#    ./deploy.sh --backup         download the live site to backups/<date>/ before uploading
#                                 (happens automatically the first time)
#    ./deploy.sh --delete         also remove files from public_html that are no longer
#                                 part of the site (shows the list and asks first)
#    ./deploy.sh --config FILE    upload your filled-in blush-config.php to the folder ABOVE
#                                 public_html, where the booking form reads it (asks first)
#    ./deploy.sh --install        run `npm ci` before building (fresh computer, new packages)
#    ./deploy.sh --skip-build     upload the dist/ folder as it is
#    ./deploy.sh --check          only check the live site (redirects, pages, booking API)
#    ./deploy.sh --show-cert      show the FTP server's security certificate (see deploy.env.example)
#    ./deploy.sh --yes            don't ask for confirmation (for scripts)
#    ./deploy.sh --env FILE       read settings from FILE instead of deploy.env
#
#  Settings (server, user, password…) live in deploy.env — copy deploy.env.example.
#  deploy.env is git-ignored. Never put the password in this file or anywhere in git.
#  Full guide: docs/deployment.md
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ── Output helpers ───────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  B=$'\e[1m'; RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; RST=$'\e[0m'
else
  B=''; RED=''; GRN=''; YEL=''; RST=''
fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$RST"; }
ok()   { printf '  %sOK%s   %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '  %s!!%s   %s\n' "$YEL" "$RST" "$*" >&2; }
die()  { printf '\n%sStopped:%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

usage() { sed -n '3,21p' "$0" | sed 's/^# \{0,2\}//'; }

# ── Arguments ────────────────────────────────────────────────────────────────
DRY_RUN=0 BACKUP=0 DELETE=0 INSTALL=0 SKIP_BUILD=0 CHECK_ONLY=0 SHOW_CERT=0 YES=0
CONFIG_FILE="" ENV_FILE="deploy.env"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-n)   DRY_RUN=1 ;;
    --backup)       BACKUP=1 ;;
    --delete)       DELETE=1 ;;
    --config)       [[ $# -ge 2 ]] || die "--config needs a file, e.g. --config ~/blush-config.php"; CONFIG_FILE="$2"; shift ;;
    --config=*)     CONFIG_FILE="${1#*=}" ;;
    --install|--ci) INSTALL=1 ;;
    --skip-build)   SKIP_BUILD=1 ;;
    --check)        CHECK_ONLY=1 ;;
    --show-cert)    SHOW_CERT=1 ;;
    --yes|-y)       YES=1 ;;
    --env)          [[ $# -ge 2 ]] || die "--env needs a file"; ENV_FILE="$2"; shift ;;
    --env=*)        ENV_FILE="${1#*=}" ;;
    -h|--help)      usage; exit 0 ;;
    *)              usage; die "unknown option: $1" ;;
  esac
  shift
done

# ── Settings: deploy.env (KEY=value lines; read as text, never executed) ─────
# Variables already set in the environment win over the file (handy for one-off runs).
KNOWN_KEYS=" PROTOCOL FTP_HOST FTP_PORT FTP_USER FTP_PASS REMOTE_DIR CONFIG_REMOTE_DIR FTP_VERIFY_CERT FTP_CERT_FINGERPRINT SSH_KEY PARALLEL SITE_URL KEEP_REMOTE BACKUP_DIR "
load_env() {
  local file="$1" line key val n=0
  local re_skip='^[[:space:]]*(#|$)' re_kv='^[[:space:]]*(export[[:space:]]+)?([A-Z_][A-Z0-9_]*)=(.*)$'
  local re_sq="^'(.*)'[[:space:]]*(#.*)?\$" re_dq='^"(.*)"[[:space:]]*(#.*)?$'
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    [[ "$line" =~ $re_skip ]] && continue
    if [[ "$line" =~ $re_kv ]]; then
      key="${BASH_REMATCH[2]}" val="${BASH_REMATCH[3]}"
      # 'single' or "double" quotes are taken literally; unquoted values lose a trailing " # comment"
      if [[ "$val" =~ $re_sq ]]; then val="${BASH_REMATCH[1]}"
      elif [[ "$val" =~ $re_dq ]]; then val="${BASH_REMATCH[1]}"
      else val="${val%%[[:space:]]#*}"; val="${val%"${val##*[![:space:]]}"}"; fi
      [[ "$KNOWN_KEYS" == *" $key "* ]] || { warn "$file line $n: unknown setting $key (ignored)"; continue; }
      [[ -n "${!key:-}" ]] && continue
      printf -v "$key" '%s' "$val"
    else
      warn "$file line $n is not KEY=value (ignored)"
    fi
  done < "$file"
}
if [[ -f "$ENV_FILE" ]]; then
  load_env "$ENV_FILE"
elif [[ "$ENV_FILE" != "deploy.env" ]]; then
  die "settings file $ENV_FILE not found"
fi

PROTOCOL="${PROTOCOL:-ftps}"
FTP_HOST="${FTP_HOST:-}"
FTP_USER="${FTP_USER:-}"
FTP_PASS="${FTP_PASS:-}"
REMOTE_DIR="${REMOTE_DIR:-/domains/blushpicnic.com/public_html}"
FTP_VERIFY_CERT="${FTP_VERIFY_CERT:-yes}"
FTP_CERT_FINGERPRINT="${FTP_CERT_FINGERPRINT:-}"
SSH_KEY="${SSH_KEY:-}"
PARALLEL="${PARALLEL:-4}"
SITE_URL="${SITE_URL:-https://blushpicnic.com}"; SITE_URL="${SITE_URL%/}"
KEEP_REMOTE="${KEEP_REMOTE:-}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
case "$PROTOCOL" in
  ftps)        FTP_PORT="${FTP_PORT:-21}" ;;
  sftp|rsync)  FTP_PORT="${FTP_PORT:-65002}" ;;
  *)           die "PROTOCOL must be ftps, sftp or rsync (got \"$PROTOCOL\"). Plain, unencrypted FTP is not supported." ;;
esac
REMOTE_DIR="${REMOTE_DIR%/}"
if [[ -z "${CONFIG_REMOTE_DIR:-}" ]]; then
  if [[ "$REMOTE_DIR" == */* ]]; then CONFIG_REMOTE_DIR="${REMOTE_DIR%/*}"; else CONFIG_REMOTE_DIR="."; fi
fi
CONFIG_REMOTE_DIR="${CONFIG_REMOTE_DIR%/}"; [[ -n "$CONFIG_REMOTE_DIR" ]] || CONFIG_REMOTE_DIR="/"
SITE_HOST="${SITE_URL#*://}"; SITE_HOST="${SITE_HOST%%/*}"
# DEPLOY_DIST: build/upload another folder (tests and CI); normally dist/.
DIST="${DEPLOY_DIST:-$ROOT/dist}"; [[ "$DIST" == /* ]] || DIST="$ROOT/$DIST"

# ── Live-site checks (also run after every upload) ───────────────────────────
CHECK_FAILS=0
http_status() { local c; c="$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$@" 2>/dev/null || true)"; echo "${c:-000}"; }
# http_probe <curl args…> → the body, then a last line "<status> <content-type>"
http_probe() { curl -s -m 20 -w '\n%{http_code} %{content_type}' "$@" 2>/dev/null || true; }
expect() { # expect <label> <want-status> <curl args…>
  local label="$1" want="$2"; shift 2
  local got; got="$(http_status "$@")"
  if [[ "$got" == "$want" ]]; then ok "$label ($got)"
  else warn "$label: expected $want, got $got"; CHECK_FAILS=$((CHECK_FAILS + 1)); fi
}
live_checks() {
  step "Checking the live site: $SITE_URL"
  command -v curl >/dev/null || { warn "curl is not installed; skipping checks"; return 0; }
  if [[ "$(http_status "$SITE_URL/")" == 000 ]]; then
    warn "Couldn't reach $SITE_URL at all. Is the domain pointing to Hostinger yet, and is SSL on?"
    say "  (Before the domain is connected, set SITE_URL in deploy.env — or the SITE_URL variable on GitHub — to Hostinger's temporary address.)"
    CHECK_FAILS=1; return 0
  fi
  expect "Home page" 200 "$SITE_URL/"
  expect "Packages page (clean URL)" 200 "$SITE_URL/packages"
  expect "Sitemap" 200 "$SITE_URL/sitemap-index.xml"
  expect "Booking questions (api/form-schema.json)" 200 "$SITE_URL/api/form-schema.json"
  expect "Private booking code is hidden (api/lib)" 403 "$SITE_URL/api/lib/Config.php"
  expect "Old .html address redirects" 301 "$SITE_URL/packages.html"
  local loc
  loc="$(curl -s -o /dev/null -m 20 -w '%{redirect_url}' "http://www.$SITE_HOST/packages" 2>/dev/null || true)"
  if [[ "$loc" == "$SITE_URL/packages" ]]; then ok "http://www.$SITE_HOST → $loc (one redirect)"
  else warn "http://www.$SITE_HOST/packages should redirect to $SITE_URL/packages (got \"${loc:-no redirect}\")"; CHECK_FAILS=$((CHECK_FAILS + 1)); fi
  local headers
  headers="$(curl -sI -m 20 "$SITE_URL/" 2>/dev/null | tr -d '\r' || true)"
  if grep -qi '^strict-transport-security:' <<<"$headers" && grep -qi '^content-security-policy:' <<<"$headers"; then
    ok "Security headers are on (.htaccess is active)"
  else
    warn "Security headers missing: is public_html/.htaccess uploaded?"; CHECK_FAILS=$((CHECK_FAILS + 1))
  fi
  # The booking handler. A 403 or 405 alone proves little (the server's own "forbidden" page is a
  # 403 too), so the answer must be book.php's JSON:
  #   GET  → 405 JSON: PHP runs book.php (the api/.htaccess rules let it through);
  #   POST from a foreign origin → 403 JSON {"ok":false…}: and blush-config.php was found
  #   (the origin check comes after loading it; a missing config answers 500).
  local out meta code ctype body
  out="$(http_probe -H 'Accept: application/json' "$SITE_URL/api/book.php")"
  meta="${out##*$'\n'}"; code="${meta%% *}"; ctype="${meta#* }"
  if [[ "$code" == 405 && "$ctype" == application/json* ]]; then ok "Booking handler runs (GET → 405 from book.php)"
  else
    warn "Booking handler: expected book.php's 405 JSON answer, got $code ${ctype:-no content type}. If it's 403, the server's api/.htaccess rules block book.php (docs/deployment.md → Troubleshooting)"
    CHECK_FAILS=$((CHECK_FAILS + 1))
  fi
  out="$(http_probe -X POST -H 'Accept: application/json' -H 'Origin: https://deploy-check.invalid' "$SITE_URL/api/book.php")"
  meta="${out##*$'\n'}"; code="${meta%% *}"; ctype="${meta#* }"; body="${out%$'\n'*}"
  case "$code" in
    403) if [[ "$ctype" == application/json* && "$body" == *'"ok":false'* ]]; then ok "Booking handler found blush-config.php"
         else warn "Booking handler: got the server's own 403 page, not book.php's answer: the api/.htaccess rules block book.php on this server"; CHECK_FAILS=$((CHECK_FAILS + 1)); fi ;;
    500) warn "Booking handler can't read blush-config.php (or PHP is older than 8.1): upload it with ./deploy.sh --config <file> (see HANDOVER.md); the PHP error log names the cause in a [blush-book] line"; CHECK_FAILS=$((CHECK_FAILS + 1)) ;;
    *)   warn "Booking handler answered $code (expected 403 JSON to this test request)"; CHECK_FAILS=$((CHECK_FAILS + 1)) ;;
  esac
  if (( CHECK_FAILS == 0 )); then say "  All checks passed. Now send yourself a real test booking at $SITE_URL/book"
  else say "  $CHECK_FAILS check(s) need a look. If you just changed DNS or SSL, wait an hour and run ./deploy.sh --check"; fi
}

if (( CHECK_ONLY )); then live_checks; (( CHECK_FAILS == 0 )); exit; fi

# ── Requirements ─────────────────────────────────────────────────────────────
[[ -n "$FTP_HOST" && -n "$FTP_USER" ]] || die "FTP_HOST and FTP_USER are not set. Copy deploy.env.example to deploy.env and fill it in."
[[ "$PARALLEL" =~ ^[1-9][0-9]?$ ]] || die "PARALLEL must be a number from 1 to 99"
[[ "$FTP_PORT" =~ ^[0-9]+$ ]] || die "FTP_PORT must be a number"
case "$REMOTE_DIR" in
  ""|"."|"/"|"~"|*..*) die "REMOTE_DIR \"$REMOTE_DIR\" is not a safe upload folder (expected /domains/blushpicnic.com/public_html)" ;;
esac
[[ "$REMOTE_DIR" =~ ^[A-Za-z0-9._/~-]+$ ]] || die "REMOTE_DIR may only contain letters, digits, . _ - / ~"
[[ "$CONFIG_REMOTE_DIR" =~ ^[A-Za-z0-9._/~-]+$ ]] || die "CONFIG_REMOTE_DIR may only contain letters, digits, . _ - / ~"
[[ "$FTP_HOST" =~ ^[A-Za-z0-9.:-]+$ ]] || die "FTP_HOST looks wrong: $FTP_HOST"
[[ "$FTP_USER" =~ ^[A-Za-z0-9._@-]+$ ]] || die "FTP_USER looks wrong: $FTP_USER"

need() { command -v "$1" >/dev/null 2>&1; }
# norm_dir <path> → the same folder written one way: no "./" parts, doubled or trailing slashes ("." = login folder)
norm_dir() {
  local p="$1" part joined="" parts=()
  IFS=/ read -ra parts <<<"$p"
  for part in ${parts[@]+"${parts[@]}"}; do
    case "$part" in ""|.) ;; *) joined+="${joined:+/}$part" ;; esac
  done
  if [[ "$p" == /* ]]; then printf '/%s' "$joined"; else printf '%s' "${joined:-.}"; fi
}
if [[ "$PROTOCOL" == rsync ]]; then
  { need rsync && need ssh; } || die "rsync and ssh are needed for PROTOCOL=rsync (macOS: built in; Ubuntu: sudo apt install rsync openssh-client)"
  [[ -n "$SSH_KEY" ]] || die "PROTOCOL=rsync needs SSH_KEY (the path to your SSH private key). See docs/deployment.md."
else
  need lftp || die "lftp is not installed. Install it, then run this again:
      macOS:          brew install lftp
      Ubuntu/Debian:  sudo apt install lftp
      Windows:        use WSL (Ubuntu), or deploy with GitHub Actions instead (HANDOVER.md)"
fi
if [[ -n "$SSH_KEY" ]]; then
  SSH_KEY="${SSH_KEY/#\~/$HOME}"
  [[ -f "$SSH_KEY" ]] || die "SSH_KEY file not found: $SSH_KEY"
fi
if [[ "$FTP_CERT_FINGERPRINT" != "" && ! "$FTP_CERT_FINGERPRINT" =~ ^([0-9A-Fa-f]{2}:){19}[0-9A-Fa-f]{2}$ ]]; then
  die "FTP_CERT_FINGERPRINT must look like AB:CD:…(20 pairs). Run ./deploy.sh --show-cert to get it."
fi
case "$FTP_VERIFY_CERT" in yes|no) ;; *) die "FTP_VERIFY_CERT must be yes or no" ;; esac

# ── --show-cert: the FTP server's TLS certificate (for FTP_CERT_FINGERPRINT) ─
if (( SHOW_CERT )); then
  [[ "$PROTOCOL" == ftps ]] || die "--show-cert is for PROTOCOL=ftps"
  need openssl || die "openssl is needed for --show-cert"
  step "Certificate presented by $FTP_HOST:$FTP_PORT"
  pem="$(openssl s_client -starttls ftp -connect "$FTP_HOST:$FTP_PORT" -servername "$FTP_HOST" </dev/null 2>/dev/null \
         | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p')"
  [[ -n "$pem" ]] || die "could not read a certificate from $FTP_HOST:$FTP_PORT (is FTPS on that port?)"
  openssl x509 -noout -subject -issuer -enddate <<<"$pem" 2>/dev/null | sed 's/^/  /' || true
  # names the certificate is valid for (works with OpenSSL and macOS's LibreSSL)
  openssl x509 -noout -text <<<"$pem" 2>/dev/null | grep -A1 'Subject Alternative Name' | tail -1 | sed 's/^ */  names: /' || true
  fp="$(openssl x509 -noout -fingerprint -sha1 <<<"$pem" | sed 's/^.*=//')"
  say ""
  say "  If FTP_HOST is not one of the names above, certificate checking fails. Either:"
  say "    • set FTP_HOST to one of those names (best), or"
  say "    • trust exactly this certificate by adding to deploy.env:"
  say ""
  say "      FTP_CERT_FINGERPRINT=$fp"
  say ""
  say "  Only do that if you're on a network you trust. The fingerprint changes when"
  say "  Hostinger renews the certificate; run --show-cert again then."
  exit 0
fi

# ── Password ─────────────────────────────────────────────────────────────────
if [[ -z "$FTP_PASS" && ( "$PROTOCOL" == ftps || ( "$PROTOCOL" == sftp && -z "$SSH_KEY" ) ) ]]; then
  [[ -t 0 ]] || die "FTP_PASS is empty and there's no terminal to ask for it. Set it in deploy.env or the environment."
  read -r -s -p "Password for $FTP_USER@$FTP_HOST: " FTP_PASS; echo
  [[ -n "$FTP_PASS" ]] || die "no password given"
fi

# ── Temp files (mode 600) and cleanup ────────────────────────────────────────
umask 077
TMP="$(mktemp -d "${TMPDIR:-/tmp}/blush-deploy.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# ── Remote access (lftp for ftps/sftp, rsync over ssh) ───────────────────────
lq() { local s="${1//\\/\\\\}"; printf '"%s"' "${s//\"/\\\"}"; }  # quote for lftp scripts
SSH_CMD=(ssh -p "$FTP_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
[[ -n "$SSH_KEY" ]] && SSH_CMD+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)

lftp_preamble() {
  cat <<EOF
set cmd:fail-exit yes
set cmd:interactive no
set net:max-retries 3
set net:timeout 30
set net:reconnect-interval-base 5
set net:reconnect-interval-max 30
set xfer:clobber yes
set xfer:use-temp-file yes
set xfer:temp-file-name .in.*
set mirror:overwrite yes
EOF
  if [[ "$PROTOCOL" == ftps ]]; then
    cat <<EOF
set ftp:ssl-force true
set ftp:ssl-protect-data true
set ftp:ssl-protect-list true
set ftp:passive-mode true
set ftp:list-options -a
set ssl:verify-certificate $FTP_VERIFY_CERT
EOF
    [[ -n "$FTP_CERT_FINGERPRINT" ]] && echo "set ssl:verify-certificate/$(tr '[:lower:]' '[:upper:]' <<<"$FTP_CERT_FINGERPRINT") no"
    echo "open --env-password -u $(lq "$FTP_USER") -p $FTP_PORT $(lq "ftp://$FTP_HOST")"
  else
    echo "set sftp:auto-confirm no"
    echo "set sftp:connect-program $(lq "${SSH_CMD[*]:0:1} -a -x ${SSH_CMD[*]:3}")"
    if [[ -n "$SSH_KEY" && -z "$FTP_PASS" ]]; then
      echo "open -u $(lq "$FTP_USER,") -p $FTP_PORT $(lq "sftp://$FTP_HOST")"
    else
      echo "open --env-password -u $(lq "$FTP_USER") -p $FTP_PORT $(lq "sftp://$FTP_HOST")"
    fi
  fi
}
# lftp_run <commands-file> : runs the preamble + commands; password via the environment only.
lftp_run() {
  { lftp_preamble; cat "$1"; } > "$TMP/script.lftp"
  LFTP_PASSWORD="$FTP_PASS" lftp -f "$TMP/script.lftp"
}
rsync_run() { rsync -rltz --chmod=D755,F644 -e "${SSH_CMD[*]}" "$@"; }
remote() { printf '%s@%s:%s' "$FTP_USER" "$FTP_HOST" "$1"; }

connection_hint() {
  local log="$1"
  if grep -qiE 'certificate|verif|x509|subjectAltName|not trusted' "$log"; then
    say "  The server's security certificate couldn't be verified for \"$FTP_HOST\"."
    say "  Run ./deploy.sh --show-cert and follow its advice (FTP_HOST or FTP_CERT_FINGERPRINT)."
  elif grep -qiE 'Login incorrect|530|authentication|Permission denied' "$log"; then
    say "  Login failed: check FTP_USER and the password (hPanel → Files → FTP Accounts)."
  elif grep -qiE "No such file|550|cannot access" "$log"; then
    say "  Logged in, but \"$REMOTE_DIR\" wasn't found. Check REMOTE_DIR in deploy.env."
  elif grep -qiE 'ssl-force|AUTH TLS|does not support or allow SSL' "$log"; then
    say "  The server refused an encrypted (FTPS) connection. This script never falls back to plain FTP."
  else
    say "  Couldn't connect to $FTP_HOST:$FTP_PORT. Check FTP_HOST / FTP_PORT and your internet connection."
  fi
}

remote_preflight() {
  step "Connecting to $FTP_HOST ($PROTOCOL, port $FTP_PORT) as $FTP_USER"
  local log="$TMP/preflight.log"
  if [[ "$PROTOCOL" == rsync ]]; then
    if ! "${SSH_CMD[@]}" -o BatchMode=yes "$FTP_USER@$FTP_HOST" "test -d $(printf '%q' "$REMOTE_DIR")" >"$log" 2>&1; then
      sed 's/^/  │ /' "$log" | tail -5; connection_hint "$log"; die "could not reach $REMOTE_DIR over SSH"
    fi
  else
    printf 'cls -1 %s > /dev/null\n' "$(lq "$REMOTE_DIR/")" > "$TMP/cmd"
    if ! lftp_run "$TMP/cmd" >"$log" 2>&1; then
      sed 's/^/  │ /' "$log" | tail -5; connection_hint "$log"; die "could not open $REMOTE_DIR"
    fi
  fi
  ok "Logged in; found $REMOTE_DIR/"
}

remote_backup() { # remote_backup <local-dir>   (called as `… || die`, so every step returns its status)
  local dest="$1"
  mkdir -p "$dest" || return 1
  [[ -f "$BACKUP_DIR/.gitignore" ]] || printf '# Local copies of the live site (deploy.sh). Never commit them.\n*\n' > "$BACKUP_DIR/.gitignore"
  if [[ "$PROTOCOL" == rsync ]]; then
    rsync_run "$(remote "$REMOTE_DIR/")" "$dest/" || return 1
  else
    printf 'mirror --no-perms --parallel=%s %s %s\n' "$PARALLEL" "$(lq "$REMOTE_DIR")" "$(lq "$dest")" > "$TMP/cmd"
    lftp_run "$TMP/cmd" || return 1
  fi
}

# Files on the server that --delete must never remove: SSL renewals, Hostinger's PHP settings,
# search-engine verification files, the GitHub Actions state file, plus KEEP_REMOTE from deploy.env.
PROTECT_RX=('^\.well-known/' '^\.ftp-deploy-sync-state\.json$' '^\.user\.ini$' '^cgi-bin/' '^google[0-9a-f]+\.html$' '^BingSiteAuth\.xml$' '^yandex_[0-9a-f]+\.html$')
PROTECT_GLOB=('/.well-known/' '/.ftp-deploy-sync-state.json' '/.user.ini' '/cgi-bin/' '/google*.html' '/BingSiteAuth.xml' '/yandex_*.html')
read -ra KEEP <<<"$KEEP_REMOTE"   # split on spaces only: a * in KEEP_REMOTE is never expanded here
for p in ${KEEP[@]+"${KEEP[@]}"}; do
  p="${p#/}"
  rx="^$(printf '%s' "$p" | sed 's/[][\.*^$+?(){}|]/\\&/g')"; [[ "$p" == */ ]] || rx+='$'
  PROTECT_RX+=("$rx"); PROTECT_GLOB+=("/$p")
done
protect_args() { # one argument per line: lftp --exclude rules, or rsync protect filters
  local i rel
  if [[ "$PROTOCOL" == rsync ]]; then
    for i in "${PROTECT_GLOB[@]}"; do printf -- '--filter=P %s\n' "$i"; done
    return 0
  fi
  # lftp's --exclude also skips uploading, so leave out any rule that matches a file in the build.
  rel="$(cd "$DIST" && find . -mindepth 1 | sed 's#^\./##')"
  for i in "${PROTECT_RX[@]}"; do
    grep -qE -- "$i" <<<"$rel" && continue
    printf -- '--exclude %s\n' "$(lq "$i")"
  done
}

# Upload order keeps the site working at every moment:
#   1. new fingerprinted files in _astro/ (nothing points at them yet),
#   2. the pages, API and root files (now pointing at the new _astro files),
#   3. only with --delete: old _astro files and removed pages.
# _astro/ files are compared by size only (--ignore-time --upload-older): their names change
# whenever their content does, so same name + same size = same file; a half-uploaded file differs in size.
# Pages are always re-sent (a few MB): timestamps on shared hosting are not reliable enough
# to decide what changed, and a skipped page is worse than a second of extra upload.
remote_upload() { # remote_upload <dry-run 0|1> <delete 0|1>
  local dry="$1" del="$2"
  if [[ "$PROTOCOL" == rsync ]]; then
    local flags=(--checksum --itemize-changes) pages=(--exclude=/_astro/) line
    (( dry )) && flags+=(--dry-run)
    if (( del )); then
      pages+=(--delete-after)
      while IFS= read -r line; do pages+=("$line"); done < <(protect_args)
    fi
    local astro=(--include=/_astro/*** --exclude=*)
    # Each pass must succeed: this runs as `remote_upload … || die`, where bash ignores set -e.
    rsync_run "${flags[@]}" "${astro[@]}" "$DIST/" "$(remote "$REMOTE_DIR/")" || return 1
    rsync_run "${flags[@]}" "${pages[@]}" "$DIST/" "$(remote "$REMOTE_DIR/")" || return 1
    if (( del )); then rsync_run "${flags[@]}" --delete-after "${astro[@]}" "$DIST/" "$(remote "$REMOTE_DIR/")" || return 1; fi
    return 0
  fi
  local common="--reverse --no-perms --upload-older --parallel=$PARALLEL --verbose=1"
  (( dry )) && common+=" --dry-run"
  {
    printf 'mirror %s --ignore-time %s %s\n' "$common" "$(lq "$DIST/_astro")" "$(lq "$REMOTE_DIR/_astro")"
    if (( del )); then
      printf 'mirror %s --transfer-all --exclude-glob _astro/ --delete %s %s %s\n' "$common" "$(protect_args | tr '\n' ' ')" "$(lq "$DIST")" "$(lq "$REMOTE_DIR")"
      printf 'mirror %s --ignore-time --delete %s %s\n' "$common" "$(lq "$DIST/_astro")" "$(lq "$REMOTE_DIR/_astro")"
    else
      printf 'mirror %s --transfer-all --exclude-glob _astro/ %s %s\n' "$common" "$(lq "$DIST")" "$(lq "$REMOTE_DIR")"
    fi
  } > "$TMP/cmd"
  # "+ file" = uploaded, "- file" = deleted (dry runs keep lftp's raw lines for lftp_pretty)
  local bt='`'
  lftp_run "$TMP/cmd" 2>&1 | sed -E "/^Making directory /d; s/^Transferring file ${bt}(.*)'\$/  + \\1/; s/^Removing old file ${bt}(.*)'\$/  - \\1/"
}

# After uploading, compare every file's size on the server with the build and re-send any that
# are missing or incomplete (an FTP upload can end early without an error). rsync checks
# every file itself, so this is for FTPS/SFTP.
remote_verify() {
  [[ "$PROTOCOL" == rsync ]] && return 0
  local attempt bad=() line listed=0
  for attempt in 1 2 3 4 5; do
    printf 'mirror --reverse --no-perms --dry-run --ignore-time --upload-older %s %s\n' "$(lq "$DIST")" "$(lq "$REMOTE_DIR")" > "$TMP/cmd"
    bad=()
    # An empty listing only means "all good" when lftp itself succeeded.
    if lftp_run "$TMP/cmd" > "$TMP/verify.txt" 2> "$TMP/verify.log"; then
      listed=1
      while IFS= read -r line; do bad+=("$line"); done < <(lftp_pretty < "$TMP/verify.txt" | sed -n 's/^upload  //p')
      (( ${#bad[@]} == 0 )) && { ok "Verified: every file on the server matches the build's size"; return 0; }
      (( attempt == 5 )) && break
      say "  ${#bad[@]} file(s) arrived incomplete or missing; sending them again (try $attempt of 4)"
      printf 'mirror --reverse --no-perms --ignore-time --upload-older --parallel=%s %s %s\n' "$PARALLEL" "$(lq "$DIST")" "$(lq "$REMOTE_DIR")" > "$TMP/cmd"
      lftp_run "$TMP/cmd" >/dev/null 2>&1 || true
    else
      listed=0
      (( attempt == 5 )) && break
      say "  Couldn't list the server to check the upload; trying again (try $attempt of 4)"
      sleep 3
    fi
  done
  if (( ! listed )); then
    sed 's/^/  │ /' "$TMP/verify.log" | tail -5 >&2
    warn "Couldn't verify the upload: listing the server failed 5 times. Run ./deploy.sh again to re-check (re-sending is safe)."
    CHECK_FAILS=$((CHECK_FAILS + 1))
    return 0
  fi
  local others=() f
  for f in "${bad[@]}"; do [[ "${f##*/}" == .* ]] || others+=("$f"); done
  if (( ${#others[@]} == 0 )); then
    warn "Couldn't verify ${bad[*]} (this server hides dot-files from listings). Check the site works: ./deploy.sh --check"
    return 0
  fi
  printf '    %s\n' "${others[@]:0:20}" >&2
  die "${#others[@]} file(s) still don't match after 5 tries. Run ./deploy.sh again; if it keeps happening, lower PARALLEL in deploy.env."
}

# What --delete would remove (dry run of the delete passes only).
remote_deletions() {
  local out="$TMP/deletions.txt"
  if [[ "$PROTOCOL" == rsync ]]; then
    remote_upload 1 1 2>/dev/null | grep -E '^\*deleting' | sed -E 's/^\*deleting +//' > "$out" || true
  else
    remote_upload 1 1 2>/dev/null | lftp_pretty | sed -n 's/^delete  //p' > "$out" || true
  fi
  cat "$out"
}

# lftp's dry-run lines → "upload  path" / "delete  path" (paths relative to the site folder).
# (A reverse mirror reports uploads as "get -O <server-dir> file:<local-file>".)
lftp_pretty() {
  local rd="${REMOTE_DIR//./\\.}" ld="${DIST//./\\.}"   # SFTP shows absolute paths: /home/<user>/<REMOTE_DIR>/…
  sed -nE \
    -e "s#^(get|put)( +-[a-z])* +-O +[^ ]+ +file:$ld/#upload  #p" \
    -e "s#^rm( -r)? +[a-z]+://[^/]+/([^ ]*/)?$rd/#delete  #p" \
    -e "s#^rmdir +[a-z]+://[^/]+/([^ ]*/)?$rd/#delete  #p"
}

remote_put_config() { # remote_put_config <local-file>
  local src="$1" dest="$CONFIG_REMOTE_DIR/blush-config.php"
  if [[ "$PROTOCOL" == rsync ]]; then
    rsync -z --chmod=F600 -e "${SSH_CMD[*]}" "$src" "$(remote "$dest")" || return 1
  else
    {
      printf 'put %s -o %s\n' "$(lq "$src")" "$(lq "$dest")"
      printf 'set cmd:fail-exit no\n'
      printf 'chmod 600 %s\n' "$(lq "$dest")"
      printf 'cls -l %s\n' "$(lq "$dest")"
    } > "$TMP/cmd"
    lftp_run "$TMP/cmd" || return 1
  fi
}

# GitHub Actions (FTP-Deploy-Action) remembers what it uploaded in public_html/.ftp-deploy-sync-state.json.
# After a deploy from this computer that memory is stale, so remove it: the next Actions deploy then
# uploads everything once instead of skipping files it wrongly thinks are already there.
remote_forget_actions_state() {
  if [[ "$PROTOCOL" == rsync ]]; then
    "${SSH_CMD[@]}" "$FTP_USER@$FTP_HOST" "rm -f $(printf '%q' "$REMOTE_DIR/.ftp-deploy-sync-state.json")" >/dev/null 2>&1 || true
  else
    printf 'set cmd:fail-exit no\nrm -f %s\n' "$(lq "$REMOTE_DIR/.ftp-deploy-sync-state.json")" > "$TMP/cmd"
    lftp_run "$TMP/cmd" >/dev/null 2>&1 || true
  fi
}

confirm() { # confirm <question> → 0 if yes
  (( YES )) && return 0
  [[ -t 0 ]] || die "need confirmation but there's no terminal (use --yes)"
  local a; read -r -p "$1 [y/N] " a
  [[ "$a" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# ── 1. Build ─────────────────────────────────────────────────────────────────
if (( SKIP_BUILD )); then
  step "Using the existing build in ${DIST#"$ROOT"/}/ (--skip-build)"
else
  need npm || die "npm is not installed (https://nodejs.org, version 20 or newer)"
  if (( INSTALL )) || [[ ! -d node_modules ]]; then
    step "Installing packages (npm ci)"
    npm ci
  fi
  step "Building the site (npm run build)"
  OUT_DIR="$DIST" npm run build
fi

# ── 2. Sanity checks on the build ────────────────────────────────────────────
step "Checking the build"
for f in index.html 404.html .htaccess sitemap-index.xml robots.txt api/book.php api/form-schema.json api/.htaccess api/lib/.htaccess; do
  [[ -f "$DIST/$f" ]] || die "dist/$f is missing: the build is incomplete. Run ./deploy.sh again (without --skip-build)."
done
leaks="$(cd "$DIST" && find . \( -name 'blush-config.php' -o -name 'deploy*.env' -o -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.eml' -o -path '*/.mail*' -o -path '*/blush-data*' \) -print)"
[[ -z "$leaks" ]] || die "secret-looking files or saved emails in dist/ (never upload these into public_html):
$leaks"
# .htaccess caches name.HASH.ext files for a year; outside _astro/ such a name could never be updated.
odd="$(cd "$DIST" && { find . -path ./_astro -prune -o -type f -print | grep -E '(^|/)([^/]*\.[A-Za-z0-9_-]{8}(_[A-Za-z0-9_-]+)?\.(css|m?js|avif|webp|jpe?g|png|gif|svg|woff2?|ttf|otf)|[0-9a-f]{16}\.(woff2?|ttf|otf))$' || true; })"
[[ -z "$odd" ]] || die "these files outside _astro/ are named like fingerprinted build files (name.abcdefgh.ext), so browsers would keep them for a year and never see an update. Rename them (e.g. logo-wordmark.svg):
$odd"
grep -q '"phoneDisplay"' "$DIST/api/form-schema.json" \
  || die "dist/api/form-schema.json has no business facts (phone, reply time…): the booking emails need them. Rebuild the site."
if (( ${#FTP_PASS} >= 8 )) && grep -rqF -- "$FTP_PASS" "$DIST" 2>/dev/null; then
  die "the FTP password appears inside dist/ — something copied it into the site. Find and remove it before deploying."
fi
n_pages=$(find "$DIST" -maxdepth 1 -name '*.html' | wc -l | tr -d ' ')
n_assets=$(find "$DIST/_astro" -type f | wc -l | tr -d ' ')
size=$(du -sh "$DIST" | cut -f1)
ok "$n_pages pages, $n_assets build files, $size in total; no secrets inside"

if [[ -n "$CONFIG_FILE" ]]; then
  CONFIG_FILE="${CONFIG_FILE/#\~/$HOME}"
  [[ -f "$CONFIG_FILE" && -r "$CONFIG_FILE" ]] || die "--config file not found: $CONFIG_FILE"
  case "$(cd "$(dirname "$CONFIG_FILE")" && pwd)/" in "$DIST"/*|"$ROOT/public"/*) die "keep blush-config.php outside dist/ and public/ (it holds a password)";; esac
  if need php; then php -l "$CONFIG_FILE" >/dev/null || die "$CONFIG_FILE has a PHP syntax error (php -l)"; fi
  grep -qE "'smtp_password'[[:space:]]*=>[[:space:]]*''" "$CONFIG_FILE" && warn "smtp_password is empty in $CONFIG_FILE: booking emails won't send until it's filled in"
  case "/$CONFIG_REMOTE_DIR/" in */../*) die "CONFIG_REMOTE_DIR may not contain .. (give the folder next to $REMOTE_DIR)";; esac
  cfg_dir="$(norm_dir "$CONFIG_REMOTE_DIR")"; web_dir="$(norm_dir "$REMOTE_DIR")"
  case "/$cfg_dir/" in "/$web_dir/"*|*"/$web_dir/"*) die "CONFIG_REMOTE_DIR must be OUTSIDE $REMOTE_DIR (got $CONFIG_REMOTE_DIR)";; esac
fi

# ── 3. Connect, plan, confirm ────────────────────────────────────────────────
remote_preflight
MARKER="$BACKUP_DIR/.first-backup-$FTP_HOST"
FIRST_RUN=0; [[ -f "$MARKER" ]] || FIRST_RUN=1
(( FIRST_RUN )) && BACKUP=1

step "Plan"
say "  Server:      $FTP_USER@$FTP_HOST:$FTP_PORT ($PROTOCOL)"
say "  Upload to:   $REMOTE_DIR/"
if (( BACKUP )); then
  if (( FIRST_RUN )); then say "  Backup:      yes — first deploy from this computer, so the live site is saved first"
  else say "  Backup:      yes, into $BACKUP_DIR/"; fi
else say "  Backup:      no (add --backup to save the live site first)"; fi
if (( DELETE )); then say "  Delete:      files on the server that are not in the new build (you'll see the list)"
else say "  Delete:      nothing is deleted"; fi
[[ -n "$CONFIG_FILE" ]] && say "  Config:      $CONFIG_FILE → $CONFIG_REMOTE_DIR/blush-config.php (outside $REMOTE_DIR)"
(( DRY_RUN )) && say "  ${B}Dry run:${RST}     nothing will be uploaded, deleted or downloaded"

if (( DRY_RUN )); then
  step "What would be uploaded"
  remote_upload 1 "$DELETE" > "$TMP/dry.txt" 2>&1 || { cat "$TMP/dry.txt"; die "dry run failed"; }
  if [[ "$PROTOCOL" == rsync ]]; then
    grep -E '^(<f|\*deleting)' "$TMP/dry.txt" | awk '!seen[$0]++' > "$TMP/dry-pretty.txt" || true
    up=$(grep -c '^<f' "$TMP/dry-pretty.txt" || true); rm_=$(grep -c '^\*deleting' "$TMP/dry-pretty.txt" || true)
    sed 's/^/  /' "$TMP/dry-pretty.txt" | head -60
  else
    lftp_pretty < "$TMP/dry.txt" | awk '!seen[$0]++' > "$TMP/dry-pretty.txt"
    up=$(grep -c '^upload' "$TMP/dry-pretty.txt" || true); rm_=$(grep -c '^delete' "$TMP/dry-pretty.txt" || true)
    newassets=$(grep -c '^upload  _astro/' "$TMP/dry-pretty.txt" || true)
    { grep '^delete' "$TMP/dry-pretty.txt"; grep '^upload  _astro/' "$TMP/dry-pretty.txt"; grep '^upload' "$TMP/dry-pretty.txt" | grep -v '^upload  _astro/'; } \
      | sed 's/^/  /' | head -60 || true
    say "  ($newassets new or changed build files in _astro/; pages, API and root files are always re-sent)"
  fi
  (( up + rm_ > 60 )) && say "  … and more"
  say ""
  say "  Would upload $up file(s) and delete $rm_."
  [[ -n "$CONFIG_FILE" ]] && say "  Would upload blush-config.php to $CONFIG_REMOTE_DIR/"
  say "  Dry run finished: nothing was changed. Run without --dry-run to deploy."
  exit 0
fi

if (( DELETE )); then
  step "Files that --delete would remove from the server"
  DELS=()
  while IFS= read -r line; do [[ -n "$line" ]] && DELS+=("$line"); done < <(remote_deletions)
  if (( ${#DELS[@]} == 0 )); then
    say "  None — the server has no leftover files."; DELETE=0
  else
    printf '  %s\n' "${DELS[@]:0:80}"
    (( ${#DELS[@]} > 80 )) && say "  … and $(( ${#DELS[@]} - 80 )) more"
    confirm "Delete these ${#DELS[@]} file(s) from the server as part of this deploy?" || { say "  OK, nothing will be deleted."; DELETE=0; }
  fi
fi

confirm "Deploy to $FTP_HOST now?" || die "cancelled — nothing was changed"

# ── 4. Backup ────────────────────────────────────────────────────────────────
if (( BACKUP )); then
  dest="$BACKUP_DIR/$(date +%Y-%m-%d_%H%M%S)/$(basename "$REMOTE_DIR")"
  step "Backing up the live site to $dest"
  remote_backup "$dest" || die "backup failed — nothing was uploaded"
  : > "$MARKER"
  ok "Saved $(find "$dest" -type f | wc -l | tr -d ' ') files. To restore: docs/deployment.md → Rolling back"
fi

# ── 5. Upload ────────────────────────────────────────────────────────────────
step "Uploading"
start=$(date +%s)
remote_upload 0 "$DELETE" || die "upload failed part-way. The site may be partly updated: run ./deploy.sh again to finish."
ok "Upload finished in $(( $(date +%s) - start ))s"
remote_verify
remote_forget_actions_state

if [[ -n "$CONFIG_FILE" ]]; then
  step "Booking settings (blush-config.php)"
  if confirm "Upload $CONFIG_FILE to $CONFIG_REMOTE_DIR/blush-config.php (outside $REMOTE_DIR)?"; then
    remote_put_config "$CONFIG_FILE" || die "could not upload blush-config.php"
    ok "blush-config.php is in place (private: not reachable from the web)"
  else
    say "  Skipped."
  fi
fi

# ── 6. Check ─────────────────────────────────────────────────────────────────
live_checks
say ""
if (( CHECK_FAILS == 0 )); then say "${B}Deployed.${RST} $SITE_URL"
else say "${B}Uploaded${RST}, but $CHECK_FAILS live check(s) need a look (above)."; fi
