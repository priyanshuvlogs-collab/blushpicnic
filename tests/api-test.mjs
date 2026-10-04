#!/usr/bin/env node
// Booking API tests for public/api/book.php — see tests/api-README.md.
//
//   node tests/api-test.mjs                    build the site into dist-api/, then test
//   API_TEST_SKIP_BUILD=1 node tests/api-test.mjs   reuse an existing dist-api/ (PHP is re-synced)
//   API_TEST_DIST / API_TEST_CACHE_DIR / API_TEST_PORT / API_TEST_MAIL_DIR / API_TEST_TMP_DIR
//                                              run beside another copy without sharing anything
//
// Runs api/book.php under `php -S 127.0.0.1:4406 -t dist-api tests/router.php` with
// BLUSH_CONFIG=tests/fixtures/blush-config.test.php: emails become .eml files in tests/.mail/,
// rate-limit data and logs go to tests/.tmp/. Every occasion in form-schema.json is exercised.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, cpSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, process.env.API_TEST_DIST || 'dist-api');
const PORT = Number(process.env.API_TEST_PORT || 4406);
const BASE = `http://127.0.0.1:${PORT}`;
const ENDPOINT = `${BASE}/api/book.php`;
const MAIL_DIR = path.resolve(ROOT, process.env.API_TEST_MAIL_DIR || 'tests/.mail');
const TMP_DIR = path.resolve(ROOT, process.env.API_TEST_TMP_DIR || 'tests/.tmp');
const CONFIG = path.join(ROOT, 'tests/fixtures/blush-config.test.php');
const CFG = {
  to: 'owner-inbox@example.com',
  replyToForClient: 'owner-replies@example.com',
  from: 'support@blushpicnic.com',
  fromName: 'Blush Picnic',
  smtpUser: 'support@blushpicnic.com',
  smtpPass: 'test-password-not-real',
};
const CLIENT = { name: 'Priya Sharma', first: 'Priya', short: 'Priya S.', email: 'priya@example.com', phone: '(416) 555-0123' };

// ── Setup: build, sync PHP, load schema ──────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.API_TEST_SKIP_BUILD || !existsSync(path.join(DIST, 'api/form-schema.json'))) {
  console.log(`# building the site into ${path.relative(ROOT, DIST)}/ (about a minute)…`);
  const b = spawnSync('npx', ['astro', 'build'], {
    cwd: ROOT,
    env: { ...process.env, OUT_DIR: DIST, CACHE_DIR: path.resolve(ROOT, process.env.API_TEST_CACHE_DIR || 'node_modules/.astro-api') },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (b.status !== 0) {
    console.error((b.stdout || '').split('\n').slice(-40).join('\n'), b.stderr);
    console.error('# astro build failed — fix the build (or rerun with API_TEST_SKIP_BUILD=1 against an existing dist-api/).');
    process.exit(1);
  }
}
// public/api is copied verbatim by Astro; re-sync so PHP edits are tested without a rebuild.
cpSync(path.join(ROOT, 'public/api'), path.join(DIST, 'api'), { recursive: true, force: true });

const SCHEMA = JSON.parse(readFileSync(path.join(DIST, 'api/form-schema.json'), 'utf8'));
const FIELDS = new Map(); // id → { field, group }
for (const group of SCHEMA.groups) for (const field of group.fields) FIELDS.set(field.id, { field, group });
const FUTURE_DATE_FIELDS = ['date', 'backup_date'];

for (const dir of [MAIL_DIR, TMP_DIR]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// ── php -S management ────────────────────────────────────────────────────────

let server = null;
let serverLog = '';
process.on('exit', () => server?.kill('SIGKILL'));

async function startServer(env = {}) {
  await stopServer();
  serverLog = '';
  const s = (server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIST, path.join(ROOT, 'tests/router.php')], {
    cwd: ROOT,
    env: { ...process.env, BLUSH_CONFIG: CONFIG, TEST_MAIL_DIR: MAIL_DIR, TEST_DATA_DIR: TMP_DIR, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  s.stdout.on('data', (d) => (serverLog += d));
  s.stderr.on('data', (d) => (serverLog += d));
  // Ready only when THIS process says it is listening — never trust whatever else answers on the port.
  for (let i = 0; i < 100; i++) {
    if (s.exitCode !== null) throw new Error(`php -S could not start on port ${PORT} (is it in use?):\n${serverLog}`);
    if (/Development Server .* started/.test(serverLog)) {
      const r = await fetch(`${BASE}/api/form-schema.json`).catch(() => null);
      if (r?.ok) return;
    }
    await sleep(100);
  }
  throw new Error(`php -S did not start on port ${PORT}\n${serverLog}`);
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (s.exitCode !== null || s.signalCode !== null) return;
    s.kill(signal);
    await Promise.race([once(s, 'exit'), sleep(2000)]);
  }
}

// ── Helpers: dates, payloads, requests ───────────────────────────────────────

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const torontoDate = (offsetDays) => ymd(new Date(Date.now() + offsetDays * 86_400_000));
const TODAY = torontoDate(0);
const FUTURE = torontoDate(30);
const FUTURE2 = torontoDate(31);
const YESTERDAY = torontoDate(-1);

/** "2026-06-13" → "Sat Jun 13, 2026" (PHP 'D M j, Y'). */
function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${wd} ${mon} ${d}, ${y}`;
}

const occasionOf = (id) => SCHEMA.occasions.find((o) => o.id === id);
const packageOf = (id) => SCHEMA.packages.find((p) => p.id === id);
const optionLabel = (field, value) => field.options?.find((o) => o.value === value)?.label ?? value;

/** Mirrors the PHP applicability rule (group appliesTo → onlyFor → showIf). */
function applicable(fieldId, payload) {
  const entry = FIELDS.get(fieldId);
  if (!entry) return false;
  const { field, group } = entry;
  const fg = occasionOf(payload.occasion)?.formGroup;
  if (!(group.appliesTo.includes('*') || group.appliesTo.includes(fg))) return false;
  if (field.onlyFor?.length && !field.onlyFor.includes(payload.occasion)) return false;
  if (field.showIf) {
    if (!applicable(field.showIf.field, payload)) return false;
    const v = payload[field.showIf.field];
    if (field.showIf.equals !== undefined ? v !== field.showIf.equals : !v) return false;
  }
  return true;
}

function sampleValue(field) {
  const opts = field.options?.map((o) => o.value) ?? [];
  switch (field.type) {
    case 'email': return 'sample@example.com';
    case 'tel': return '416-555-0199';
    case 'date': return FUTURE_DATE_FIELDS.includes(field.id) ? FUTURE : torontoDate(-200);
    case 'month': return '2027-03';
    case 'time': return '16:00';
    case 'number': return String(Math.min(Math.max(field.min ?? 1, 1), field.max ?? 99));
    case 'select': case 'radio': return opts[0];
    case 'checkboxes': return opts.slice(0, 2);
    case 'toggle': return 'yes';
    default: {
      let s = `Sample ${field.id.replace(/_/g, ' ')}`;
      if (field.maxWords) s = s.split(' ').slice(0, field.maxWords).join(' ');
      return field.maxLength ? s.slice(0, field.maxLength) : s;
    }
  }
}

/**
 * A valid submission for an occasion. full=false: only required answers (plus a realistic core);
 * full=true: every applicable question answered (surprise on, so the showIf questions apply too).
 */
function validPayload(occasion, { full = false, pkg } = {}) {
  const occ = occasionOf(occasion);
  const p = {
    occasion,
    package: pkg ?? occ.recommendedPackage ?? 'not-sure',
    date: FUTURE,
    start_time: '17:30',
    guests_adults: '2',
    location_type: FIELDS.get('location_type').field.options[0].value,
    location: 'Trinity Bellwoods Park',
    name: CLIENT.name,
    phone: CLIENT.phone,
    email: CLIENT.email,
    _ts: String(Date.now() - 120_000),
  };
  if (full) {
    p.backup_date = FUTURE2;
    p.is_surprise = 'yes';
  }
  for (const [id, { field }] of FIELDS) {
    if (id in p || !applicable(id, p)) continue;
    if (field.required || full) p[id] = sampleValue(field);
  }
  return p;
}

/** POST a payload. type: urlencoded (repeated keys for lists) | brackets (key[]) | multipart | json. */
async function post(payload, { type = 'urlencoded', json = true, headers = {}, redirect = 'manual', files = {} } = {}) {
  let body;
  const h = { ...headers };
  if (json) h.Accept = 'application/json';
  if (type === 'json') {
    body = JSON.stringify(payload);
    h['Content-Type'] = 'application/json';
  } else if (type === 'multipart') {
    body = new FormData();
    for (const [k, v] of Object.entries(payload)) {
      if (Array.isArray(v)) v.forEach((x) => body.append(`${k}[]`, x));
      else body.append(k, v);
    }
    for (const [k, v] of Object.entries(files)) body.append(k, new Blob([v], { type: 'text/plain' }), `${k}.txt`);
  } else {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      if (Array.isArray(v)) v.forEach((x) => usp.append(type === 'brackets' ? `${k}[]` : k, x));
      else usp.append(k, v);
    }
    body = usp.toString();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const res = await fetch(ENDPOINT, { method: 'POST', body, headers: h, redirect });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, data, text };
}

// ── Helpers: reading the .eml files ──────────────────────────────────────────

const mailFiles = () => (existsSync(MAIL_DIR) ? readdirSync(MAIL_DIR).filter((f) => f.endsWith('.eml')).sort() : []);

function decodeQP(s, header = false) {
  if (header) s = s.replace(/_/g, ' ');
  s = s.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString('utf8');
}

/** RFC 2047 encoded-words → text (adjacent words joined at the byte level). */
function decodeHeader(v) {
  const latin = v.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=(?:\s+(?==\?))?/g, (_, _cs, enc, txt) =>
    enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64').toString('latin1') : Buffer.from(decodeQP(txt, true), 'utf8').toString('latin1'));
  return Buffer.from(latin, 'latin1').toString('utf8');
}

function parseHeaders(block) {
  const headers = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = decodeHeader(line.slice(i + 1).trim());
  }
  return headers;
}

function parseEml(raw) {
  const split = raw.search(/\r?\n\r?\n/);
  const headerBlock = raw.slice(0, split);
  const body = raw.slice(split).replace(/^\r?\n\r?\n/, '');
  const headers = parseHeaders(headerBlock);
  const out = { raw, headerBlock, headers, text: '', html: '' };
  const boundary = /boundary="?([^";]+)"?/i.exec(headers['content-type'] || '')?.[1];
  const parts = boundary ? body.split(`--${boundary}`).slice(1, -1) : [`${headerBlock}\n\n${body}`];
  for (const part of parts) {
    const s = part.replace(/^\r?\n/, '');
    const at = s.search(/\r?\n\r?\n/);
    const ph = parseHeaders(s.slice(0, at));
    let content = s.slice(at).replace(/^\r?\n\r?\n/, '');
    const cte = (ph['content-transfer-encoding'] || '').toLowerCase();
    if (cte === 'quoted-printable') content = decodeQP(content);
    else if (cte === 'base64') content = Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf8');
    content = content.replace(/\r\n/g, '\n'); // MIME text is CRLF; compare as plain \n text
    if ((ph['content-type'] || '').startsWith('text/html')) out.html = content;
    else if ((ph['content-type'] || '').startsWith('text/plain')) out.text = content;
  }
  return out;
}

function readMail(ref, kind) {
  const file = path.join(MAIL_DIR, `${ref}-${kind}.eml`);
  assert.ok(existsSync(file), `expected ${path.relative(ROOT, file)} to exist`);
  return parseEml(readFileSync(file, 'utf8'));
}

const addressOf = (h = '') => (/<([^>]+)>/.exec(h)?.[1] ?? h).trim().toLowerCase();
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Assert the pair of emails for a successful submission and return them. */
function assertEmails(ref, payload) {
  const biz = readMail(ref, 'business');
  const cli = readMail(ref, 'client');
  const occ = occasionOf(payload.occasion);

  assert.equal(addressOf(biz.headers.to), CFG.to, 'business To');
  assert.equal(addressOf(biz.headers['reply-to']), payload.email.toLowerCase(), 'business Reply-To = client');
  assert.match(biz.headers['reply-to'], new RegExp(payload.name.split(' ')[0]), 'business Reply-To carries the client name');
  assert.equal(addressOf(biz.headers.from), CFG.from, 'business From');
  assert.equal(biz.headers.subject, `New booking: ${occ.name} · ${fmtDate(payload.date)} · ${CLIENT.short}`, 'business Subject');
  assert.ok(!/[\r\n]/.test(biz.headers.subject));

  assert.equal(addressOf(cli.headers.to), payload.email.toLowerCase(), 'client To');
  assert.ok(!cli.headers.to.includes(payload.name.split(/\s+/)[0]), 'client To has no display name (none of the visitor’s words)');
  assert.equal(addressOf(cli.headers['reply-to']), CFG.replyToForClient, 'client Reply-To');
  assert.equal(addressOf(cli.headers.from), CFG.from, 'client From');
  assert.match(cli.headers.from, /Blush Picnic/);
  assert.ok(cli.headers.subject.includes(ref), 'client Subject has the reference');
  assert.equal(cli.headers['auto-submitted'], 'auto-generated');

  for (const part of [biz.text, biz.html]) assert.ok(part.length > 200, 'business email has text and HTML parts');
  for (const m of [biz, cli]) assert.ok(!m.raw.includes('=0A'), 'CRLF line ends (no quoted-printable =0A)');
  // Every answered question appears once: in the summary rows (SUMMARY_ROWS), or with the form's
  // label under its section — and select/radio/checkbox answers by option LABEL (never the raw id).
  for (const [id, value] of Object.entries(payload)) {
    if (!FIELDS.has(id) || !applicable(id, payload)) continue;
    const { field, group } = FIELDS.get(id);
    if (id in SUMMARY_ROWS) {
      if (field.type === 'toggle' && value !== 'yes' && value !== true) continue;
      assert.ok(biz.text.includes(`\n${SUMMARY_ROWS[id]}: `), `business summary has "${SUMMARY_ROWS[id]}" for ${id}`);
      assert.ok(!biz.text.includes(`\n${field.label}: `), `"${field.label}" is not repeated below the summary`);
    } else {
      const label = field.type === 'toggle' ? group.title : field.label;
      assert.ok(biz.text.includes(`\n${label}: `), `business text has label "${label}"`);
      assert.ok(biz.html.includes(escHtml(label)), `business HTML has label "${label}"`);
      assert.ok(biz.text.toUpperCase().includes(group.title.toUpperCase()), `business text has section "${group.title}"`);
    }
    if (['select', 'radio', 'checkboxes'].includes(field.type)) {
      for (const v of [].concat(value)) assert.ok(biz.text.includes(optionLabel(field, v)), `business text shows option label for ${id}=${v}`);
    }
  }
  assert.ok(biz.text.includes(occ.name));
  assert.ok(biz.text.includes(ref) && biz.html.includes(ref), 'business email has the reference');
  assert.match(biz.text, /\(Toronto time\)/);
  assert.match(biz.text, /STARTING ESTIMATE: (Starting at \$[\d,]+ before HST|To be quoted)/);
  assert.ok(biz.html.includes('href="tel:+14165550123"') && biz.html.includes('href="sms:+14165550123"') && biz.html.includes(`href="mailto:${payload.email}`), 'quick actions');
  assert.ok(biz.html.includes('#3B1730') && biz.html.includes('#F6E4E1'), 'brand colours');

  assert.ok(cli.text.includes(`Thank you, ${CLIENT.first}.`));
  assert.ok(cli.text.includes(occ.name) && cli.text.includes(fmtDate(payload.date)) && cli.text.includes('5:30 PM'));
  assert.ok(cli.text.includes('Here’s a summary:') && !cli.text.includes('copy of what you sent'), 'the client copy calls itself a summary');
  assert.match(cli.text, /within 24 hours/);
  // The two deposits are separate steps, word for word from settings.yaml (via form-schema.json).
  assert.ok(cli.text.includes(`Your booking deposit\n   ${SCHEMA.deposit.summary}`), 'booking deposit step');
  assert.ok(cli.text.includes(`Your security deposit\n   ${SCHEMA.securityDeposit.summary}`), 'security deposit step');
  assert.ok(cli.html.includes(escHtml(SCHEMA.deposit.summary)) && cli.html.includes(escHtml(SCHEMA.securityDeposit.summary)));
  assert.match(cli.text, /\$100 booking deposit \(or 50% for larger events\) holds your date[\s\S]*\$100 refundable security deposit/);
  assert.match(cli.text, /non-refundable/);
  assert.ok(cli.text.includes(`${SCHEMA.business.url}/policies`) && cli.html.includes(`href="${SCHEMA.business.url}/policies"`), 'policies link');
  assert.match(cli.text, /\(647\) 878-0539/);
  assert.match(cli.text, /@blush\.picnic/);
  assert.ok(cli.html.includes(ref));
  // Only answers from our own lists: the free-text location never reaches the client's inbox.
  assert.ok(!cli.raw.includes(payload.location), 'client copy has no free-text location');
  for (const s of ['Budget', 'Starting estimate', 'To quote', 'Possible spam']) assert.ok(!cli.text.includes(s), `client copy has no "${s}"`);
  return { biz, cli };
}

/** Answers the business email shows in its summary rows (Booking::SUMMARY_FIELDS) → the row label. */
const SUMMARY_ROWS = {
  occasion: 'Occasion', package: 'Package', date: 'Date', backup_date: 'Date', start_time: 'Start time',
  guests_adults: 'Guests', guests_kids: 'Guests', location_type: 'Location', location: 'Location',
  budget: 'Budget', is_surprise: 'Surprise', contact_pref: 'Prefers',
};

// ── Tests ────────────────────────────────────────────────────────────────────

test('php -l passes on every PHP file', () => {
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.php')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'public/api'));
  walk(path.join(ROOT, 'tests/fixtures'));
  files.push(path.join(ROOT, 'tests/router.php'));
  for (const f of files) {
    const r = spawnSync('php', ['-l', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${path.relative(ROOT, f)}: ${r.stdout}${r.stderr}`);
  }
  assert.ok(files.some((f) => f.endsWith('PHPMailer.php')), 'PHPMailer is vendored in public/api/lib/PHPMailer');
});

test('api-config/blush-config.example.php loads, holds no password, and empty values fall back to defaults', () => {
  const php = `
    require 'public/api/lib/Config.php';
    putenv('BLUSH_CONFIG=api-config/blush-config.example.php');
    $c = Blush\\Config::load('/srv/domains/blushpicnic.com/public_html/api');
    echo json_encode(['pw' => $c->str('smtp_password'), 'data' => $c->str('data_dir'), 'mail' => $c->str('mail_dir'),
      'to' => $c->str('to_email'), 'from' => $c->str('from_email'), 'transport' => $c->str('mail_transport'),
      'max' => $c->int('rate_limit_max'), 'origins' => $c->list('allowed_origins'), 'local' => $c->bool('allow_localhost')]);`;
  const r = spawnSync('php', ['-r', php], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(r.stdout);
  assert.equal(c.pw, '', 'example must not contain a password');
  assert.equal(c.data, '/srv/domains/blushpicnic.com/blush-data', 'data_dir defaults to the folder next to public_html');
  assert.equal(c.mail, '/srv/domains/blushpicnic.com/blush-data/mail');
  assert.equal(c.to, 'blush.picnic25@gmail.com');
  assert.equal(c.from, 'support@blushpicnic.com');
  assert.equal(c.transport, 'smtp');
  assert.equal(c.max, 5);
  assert.deepEqual(c.origins, ['https://blushpicnic.com', 'https://www.blushpicnic.com']);
  assert.equal(c.local, false);
});

describe('booking handler (file transport)', () => {
  before(() => startServer());

  test('CORS preflight: allowed origin → 204 with Access-Control-Allow-Origin; foreign origin → 403', async () => {
    const ok = await fetch(ENDPOINT, { method: 'OPTIONS', headers: { Origin: 'https://www.blushpicnic.com', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://www.blushpicnic.com');
    const bad = await fetch(ENDPOINT, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', Accept: 'application/json' } });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });

  test('JSON body: booleans work for toggles and numbers for number fields', async () => {
    const payload = { ...validPayload('proposal'), is_surprise: true, surprise_for: 'Maya', guests_adults: 2 };
    const r = await post(payload, { type: 'json' });
    assert.equal(r.status, 200, r.text);
    const biz = readMail(r.data.ref, 'business');
    assert.ok(biz.text.includes(`${FIELDS.get('surprise_for').field.label}: Maya`));
    assert.ok(biz.text.includes('Guests: 2 adults'));
    assert.ok(biz.text.includes('Surprise: Yes'));
  });

  test('form-schema.json carries the business facts the emails use (no fallbacks in PHP)', () => {
    for (const k of ['name', 'url', 'phoneDisplay', 'phoneE164', 'email', 'instagramHandle', 'instagramUrl', 'replyTime', 'depositSummary', 'taxNote'])
      assert.ok(typeof SCHEMA.business?.[k] === 'string' && SCHEMA.business[k].trim(), `business.${k}`);
    assert.ok(SCHEMA.deposit?.summary && SCHEMA.securityDeposit?.summary, 'deposit and securityDeposit summaries');
    const php = `
      require 'public/api/lib/FormSchema.php';
      $f = tempnam(sys_get_temp_dir(), 'fs');
      file_put_contents($f, json_encode(['groups' => [], 'occasions' => []]));
      try { Blush\\FormSchema::load($f); echo 'loaded'; } catch (RuntimeException $e) { echo 'refused: ', $e->getMessage(); }
      unlink($f);`;
    const r = spawnSync('php', ['-r', php], { cwd: ROOT, encoding: 'utf8' });
    assert.match(r.stdout, /^refused: .*business\.name/, r.stdout + r.stderr);
  });

  test('form-schema.json is served and lists every occasion including "other"', () => {
    assert.ok(SCHEMA.occasions.length >= 2);
    assert.ok(SCHEMA.occasions.some((o) => o.id === 'other'));
  });

  for (const occ of SCHEMA.occasions) {
    test(`valid submission — ${occ.id} (required answers only)`, async () => {
      const payload = validPayload(occ.id);
      const r = await post(payload);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.data.ok, true);
      assert.match(r.data.ref, /^BP-\d{8}-[A-Z2-9]{4}$/);
      assert.ok(r.data.ref.includes(TODAY.replace(/-/g, '')), 'reference uses today (Toronto)');
      assertEmails(r.data.ref, payload);
    });
    test(`valid submission — ${occ.id} (every applicable question)`, async () => {
      const payload = validPayload(occ.id, { full: true });
      const r = await post(payload);
      assert.equal(r.status, 200, r.text);
      assertEmails(r.data.ref, payload);
    });
  }

  test('each occasion-specific required question is enforced', async () => {
    let checked = 0;
    for (const occ of SCHEMA.occasions) {
      const payload = validPayload(occ.id);
      for (const [id, { field }] of FIELDS) {
        if (!field.required || !applicable(id, payload)) continue;
        const p = { ...payload };
        delete p[id];
        const r = await post(p);
        assert.equal(r.status, 422, `${occ.id} without ${id}: ${r.text}`);
        assert.equal(r.data.ok, false);
        assert.equal(r.data.message, 'Please check the highlighted answers.');
        assert.ok(r.data.errors?.[id], `${occ.id}: errors.${id} present`);
        assert.ok(r.data.errors[id].length > 10, 'message is human');
        checked++;
      }
    }
    assert.ok(checked > SCHEMA.occasions.length * 5);
  });

  const invalid = [
    ['bad email', { email: 'priya@' }, 'email'],
    ['email with a space', { email: 'priya sharma@example.com' }, 'email'],
    ['short phone', { phone: '12345' }, 'phone'],
    ['phone with words', { phone: 'call me maybe 4165550123' }, 'phone'],
    ['past date', { date: YESTERDAY }, 'date'],
    ['past backup date', { backup_date: YESTERDAY }, 'backup_date'],
    ['impossible date', { date: '2027-02-30' }, 'date'],
    ['badly formatted date', { date: '13/06/2027' }, 'date'],
    ['date years away', { date: torontoDate(365 * 4) }, 'date'],
    ['bad time', { start_time: '25:00' }, 'start_time'],
    ['invalid radio option', { location_type: 'On the moon' }, 'location_type'],
    ['invalid select option', { budget: 'A million dollars' }, 'budget'],
    ['unknown package', { package: 'platinum' }, 'package'],
    ['unknown occasion', { occasion: 'divorce-party' }, 'occasion'],
    ['unknown add-on', { addons: ['caviar'] }, 'addons'],
    ['zero adults', { guests_adults: '0' }, 'guests_adults'],
    ['too many adults', { guests_adults: '301' }, 'guests_adults'],
    ['adults not a number', { guests_adults: 'two' }, 'guests_adults'],
    ['fractional adults', { guests_adults: '2.5' }, 'guests_adults'],
    ['letter board over 7 words', { letter_board: 'one two three four five six seven eight' }, 'letter_board'],
    ['location over 200 characters', { location: 'x'.repeat(201) }, 'location'],
    ['two answers for a radio', { location_type: ['Park', 'Beach'] }, 'location_type'],
    ['partner name over maxLength', { partner_name: 'P'.repeat(81) }, 'partner_name'],
  ];
  for (const [name, change, field] of invalid) {
    test(`422 — ${name}`, async () => {
      const r = await post({ ...validPayload('proposal'), ...change });
      assert.equal(r.status, 422, r.text);
      assert.equal(r.data.ok, false);
      assert.equal(typeof r.data.errors[field], 'string', `errors.${field}: ${r.text}`);
      assert.ok(r.data.errors[field].length > 10);
    });
  }

  test('error messages are specific and human', async () => {
    const r = await post({ ...validPayload('proposal'), date: YESTERDAY, letter_board: 'one two three four five six seven eight', email: 'nope' });
    assert.match(r.data.errors.date, /already passed/);
    assert.match(r.data.errors.letter_board, /7 words.*8/);
    assert.match(r.data.errors.email, /doesn’t look quite right/);
  });

  test('accepted edge cases: 7-word letter board, today, 12-hour time, past wedding date, international phone', async () => {
    const r1 = await post({ ...validPayload('proposal'), letter_board: 'one two three four five six seven', date: TODAY, start_time: '5:30 pm', phone: '+44 20 7946 0958' });
    assert.equal(r1.status, 200, r1.text);
    const { biz } = { biz: readMail(r1.data.ref, 'business') };
    assert.ok(biz.text.includes('Start time: 5:30 PM'));
    const r2 = await post({ ...validPayload('just-engaged'), couple_date: '2024-05-04' });
    assert.equal(r2.status, 200, r2.text);
    assert.ok(readMail(r2.data.ref, 'business').text.includes('Sat May 4, 2024'));
  });

  test('non-applicable and unknown fields are ignored (never validated, never emailed)', async () => {
    const payload = {
      ...validPayload('proposal'),
      birthday_name: 'BIRTHDAY-NAME-SHOULD-NOT-APPEAR', // birthday group, not romance
      birthday_age: 'not even a number',                 // would fail validation if it applied
      reveal_method: 'Smoke',                            // onlyFor gender-reveal
      surprise_for: 'SURPRISE-FOR-SHOULD-NOT-APPEAR',    // showIf is_surprise = yes (not set)
      hacker_field: 'HACKER-FIELD-SHOULD-NOT-APPEAR',
    };
    const r = await post(payload);
    assert.equal(r.status, 200, r.text);
    const { biz } = assertEmails(r.data.ref, payload);
    for (const s of ['BIRTHDAY-NAME', 'SURPRISE-FOR', 'HACKER-FIELD', 'not even a number', 'Whose birthday', 'How would you like to reveal']) {
      assert.ok(!biz.raw.includes(s) && !biz.text.includes(s) && !biz.html.includes(s), `"${s}" must not be in the email`);
    }
  });

  test('onlyFor: reveal method is kept for gender-reveal but not for baby-shower', async () => {
    const field = FIELDS.get('reveal_method');
    if (!field) return;
    const value = field.field.options[0].value;
    const gr = await post({ ...validPayload('gender-reveal'), reveal_method: value });
    assert.ok(readMail(gr.data.ref, 'business').text.includes(field.field.label));
    const bs = await post({ ...validPayload('baby-shower'), reveal_method: value });
    assert.ok(!readMail(bs.data.ref, 'business').text.includes(field.field.label));
  });

  test('HTML in answers is escaped and header injection is neutralised', async () => {
    const payload = {
      ...validPayload('proposal'),
      name: 'Priya Sharma\r\nBcc: victim@example.com',
      notes: '<script>alert(1)</script> <b>bold</b> & "quotes"',
      partner_name: '<img src=x onerror=alert(1)>',
    };
    const r = await post(payload);
    assert.equal(r.status, 200, r.text);
    const biz = readMail(r.data.ref, 'business');
    assert.ok(!/^bcc:/im.test(biz.headerBlock), 'no injected Bcc header');
    assert.ok(!biz.html.includes('<script>') && !biz.html.includes('<img src=x'), 'HTML escaped');
    assert.ok(biz.html.includes('&lt;script&gt;'));
    assert.ok(biz.text.includes('<script>alert(1)</script>'), 'plain text keeps the literal text');
  });

  test('starting estimate: Signature + extra guest + quoted add-on', async () => {
    const sig = packageOf('signature');
    const addon = SCHEMA.addons[0];
    const payload = { ...validPayload('birthday', { pkg: 'signature' }), guests_adults: String(sig.guestsIncluded + 1), addons: [addon.id] };
    const r = await post(payload);
    assert.equal(r.status, 200, r.text);
    const biz = readMail(r.data.ref, 'business');
    const total = sig.priceFrom + sig.extraGuestPrice;
    assert.match(biz.text, new RegExp(`STARTING ESTIMATE: Starting at \\$${total.toLocaleString('en-US')} before HST`));
    assert.match(biz.text, new RegExp(`1 extra guest × \\$${sig.extraGuestPrice}`));
    if (addon.price === null) assert.match(biz.text, new RegExp(`To quote: Price on request: ${addon.name}`));
    assert.match(biz.text, new RegExp(`Package: ${sig.name} · Starting at \\$${sig.priceFrom} for ${sig.guestsIncluded} guests, before HST`));
  });

  test('starting estimate matches the site: guest ranges and unpriced extra guests', async () => {
    const cel = packageOf('celebration');
    const prop = packageOf('proposal-romance');
    const money = (n) => `$${n.toLocaleString('en-US')}`;
    const within = await post({ ...validPayload('baby-shower', { pkg: 'celebration' }), guests_adults: String(cel.guestsMax ?? cel.guestsIncluded) });
    const wText = readMail(within.data.ref, 'business').text;
    assert.ok(wText.includes(`STARTING ESTIMATE: Starting at ${money(cel.priceFrom)} before HST`), wText);
    assert.ok(!wText.includes('To quote:'), 'no note inside the package guest range');
    if (cel.guestsMax) {
      const big = await post({ ...validPayload('baby-shower', { pkg: 'celebration' }), guests_adults: String(cel.guestsMax + 2) });
      assert.ok(readMail(big.data.ref, 'business').text.includes(`To quote: ${cel.guestsMax + 2} guests: larger groups quoted`));
    }
    if (prop.extraGuestPrice === null && prop.guestsMax === null) {
      const r = await post({ ...validPayload('proposal'), guests_adults: '2', guests_kids: '1' });
      assert.ok(readMail(r.data.ref, 'business').text.includes('To quote: 3 guests: extra guests quoted separately'));
    }
  });

  test('starting estimate: “Help me choose” is quoted', async () => {
    const r = await post(validPayload('other', { pkg: 'not-sure' }));
    assert.equal(r.status, 200, r.text);
    assert.match(readMail(r.data.ref, 'business').text, /STARTING ESTIMATE: To be quoted/);
  });

  test('checkbox lists arrive intact as repeated keys, key[] (urlencoded), multipart and JSON', async () => {
    const ids = SCHEMA.addons.slice(0, 3).map((a) => a.id);
    for (const type of ['urlencoded', 'brackets', 'multipart', 'json']) {
      const payload = { ...validPayload('anniversary'), addons: ids };
      const r = await post(payload, { type });
      assert.equal(r.status, 200, `${type}: ${r.text}`);
      const biz = readMail(r.data.ref, 'business');
      for (const id of ids) assert.ok(biz.text.includes(SCHEMA.addons.find((a) => a.id === id).name), `${type}: add-on ${id}`);
    }
  });

  /** A spam-flagged request: same reply as a real one, business email flagged, no client confirmation. */
  async function assertFlagged(r, why) {
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.ok, true);
    assert.match(r.data.ref, /^BP-\d{8}-[A-Z2-9]{4}$/);
    assert.equal(r.data.message, `Thank you, ${CLIENT.first} — we’ve received your request and will reply ${SCHEMA.business.replyTime}.`, 'same reply as a real send');
    assert.deepEqual(Object.keys(r.data).sort(), ['message', 'ok', 'ref']);
    const biz = readMail(r.data.ref, 'business');
    assert.ok(biz.headers.subject.startsWith('[Possible spam] New booking: '), biz.headers.subject);
    assert.ok(biz.text.startsWith('POSSIBLE SPAM: A spam check flagged this request: ') && biz.text.includes(why), biz.text.slice(0, 300));
    assert.ok(biz.text.includes('No confirmation email was sent to them.'));
    assert.ok(biz.html.includes('Possible spam.'));
    assert.ok(!existsSync(path.join(MAIL_DIR, `${r.data.ref}-client.eml`)), 'no client confirmation');
    return biz;
  }
  const logText = () => readdirSync(TMP_DIR).filter((f) => f.startsWith('booking-')).map((f) => readFileSync(path.join(TMP_DIR, f), 'utf8')).join('');

  test('honeypot filled → the lead is still emailed (flagged), no confirmation, logged without PII', async () => {
    await assertFlagged(await post({ ...validPayload('proposal'), company_website: 'https://spam.example' }), 'hidden “leave this empty” field');
    const logs = logText();
    assert.match(logs, /"event":"honeypot"/);
    assert.match(logs, /"flag":"honeypot"[^\n]*"confirmation":"skipped"/);
    assert.ok(!logs.includes(CLIENT.email) && !logs.includes('127.0.0.1'), 'log has no PII or raw IPs');
  });

  test('honeypot filled but answers invalid → the usual 422, nothing sent', async () => {
    const before = mailFiles().length;
    const r = await post({ ...validPayload('proposal'), company_website: 'x', email: 'nope' });
    assert.equal(r.status, 422, r.text);
    assert.ok(r.data.errors.email);
    assert.equal(mailFiles().length, before);
  });

  test('a real send and a trapped send answer alike', async () => {
    const real = await post(validPayload('proposal'));
    const trap = await post({ ...validPayload('proposal'), company_website: 'x' });
    assert.equal(real.status, trap.status);
    assert.equal(real.data.message, trap.data.message);
    assert.deepEqual(Object.keys(real.data).sort(), Object.keys(trap.data).sort());
    assert.equal(real.headers.get('content-type'), trap.headers.get('content-type'));
  });

  test('submitted too fast (_ts) → flagged, no confirmation', async () => {
    // Milliseconds (Date.now()) and whole seconds are both understood.
    for (const ts of [String(Date.now()), String(Math.ceil(Date.now() / 1000))]) {
      await assertFlagged(await post({ ...validPayload('proposal'), _ts: ts }), 'within seconds');
    }
  });

  test('fetch() submission without _ts, or with one far in the future → flagged', async () => {
    const noTs = validPayload('proposal');
    delete noTs._ts;
    await assertFlagged(await post(noTs), 'timer was missing');
    await assertFlagged(await post({ ...validPayload('proposal'), _ts: '' }), 'timer was missing');
    for (const ts of [String(Date.now() + 86_400_000), '99999999999999', '1e20']) {
      await assertFlagged(await post({ ...validPayload('proposal'), _ts: ts }), 'far in the future');
    }
  });

  test('a visitor clock running a few minutes ahead is not treated as spam', async () => {
    const r = await post({ ...validPayload('proposal'), _ts: String(Date.now() + 5 * 60_000) });
    assert.equal(r.status, 200, r.text);
    assertEmails(r.data.ref, validPayload('proposal'));
  });

  test('a no-JS form post (no _ts at all) is a normal request with a confirmation', async () => {
    const payload = validPayload('birthday');
    delete payload._ts;
    const before = mailFiles().length;
    const r = await post(payload, { json: false });
    assert.equal(r.status, 303);
    assert.equal(mailFiles().length, before + 2);
  });

  test('business email: summary first, no repeats, and the client’s preferred contact is the main button', async () => {
    const r = await post({ ...validPayload('proposal', { full: true }), contact_pref: 'Email' });
    assert.equal(r.status, 200, r.text);
    const biz = readMail(r.data.ref, 'business');
    const buttons = [...biz.html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    assert.ok(buttons[0][0].startsWith(`mailto:${CLIENT.email}`) && buttons[0][1] === `Email ${CLIENT.first}`, JSON.stringify(buttons.slice(0, 3)));
    assert.ok(buttons.some(([h, t]) => h.startsWith('sms:') && t === 'Text'), 'Text is still offered');
    assert.match(biz.text, /\n {2}Email: priya@example\.com \(or just reply\) {2}← preferred\n/);
    assert.ok(biz.text.includes('\nPrefers: Email\n') && biz.text.includes('\nSurprise: Yes\n'));
    assert.ok(biz.text.includes(`\nLocation: ${FIELDS.get('location_type').field.options[0].label} · Trinity Bellwoods Park\n`), 'location type · place');
    assert.ok(!/OCCASION & PACKAGE|WHEN & WHERE/.test(biz.text), 'no sections that only repeat the summary');
    const plain = readMail((await post(validPayload('proposal'))).data.ref, 'business');
    assert.ok(/<a href="sms:\+14165550123"[^>]*>Text Priya<\/a>/.test(plain.html), 'no preference → Text is the main button');
  });

  test('client confirmation: summary only from our own lists, careful greeting', async () => {
    const r = await post({ ...validPayload('other', { pkg: 'not-sure' }), name: 'WinBig.example.com Now' });
    assert.equal(r.status, 200, r.text);
    const cli = readMail(r.data.ref, 'client');
    assert.ok(cli.text.startsWith('Thank you.\n'), 'a first "name" that isn’t a name is left out');
    assert.ok(!cli.raw.includes('WinBig'), 'none of it anywhere in the confirmation');
    assert.ok(cli.text.includes('Package: Not sure yet — we’ll recommend one') && !cli.text.includes('Help me choose'));
    const accented = await post({ ...validPayload('proposal'), name: 'Zoë O’Brien' });
    assert.ok(readMail(accented.data.ref, 'client').text.startsWith('Thank you, Zoë.\n'));
  });

  test('GET → 405', async () => {
    const r = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
    assert.equal(r.status, 405);
    assert.match(r.headers.get('allow') || '', /POST/);
    assert.equal((await r.json()).ok, false);
    const plain = await fetch(ENDPOINT);
    assert.equal(plain.status, 405);
  });

  test('plain form post (no JSON Accept) → 303 to /thank-you?ref=…, emails sent', async () => {
    const before = mailFiles().length;
    const r = await post(validPayload('birthday'), { json: false });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /^\/thank-you\?ref=BP-\d{8}-[A-Z0-9]+$/);
    assert.equal(mailFiles().length, before + 2);
  });

  test('plain form post with errors → 303 to /book?error=1', async () => {
    const r = await post({ ...validPayload('birthday'), email: 'nope' }, { json: false });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/book?error=1#booking-error');
  });

  test('X-Requested-With also gets JSON', async () => {
    const r = await post(validPayload('family'), { json: false, headers: { 'X-Requested-With': 'fetch' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.ok, true);
  });

  test('responses carry security headers', async () => {
    const r = await post({ ...validPayload('birthday'), email: 'nope' });
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('cache-control') || '', /no-store/);
  });

  test('cross-site Origin / Referer → 403; the site’s own origin is accepted', async () => {
    const before = mailFiles().length;
    const evil = await post(validPayload('proposal'), { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403, evil.text);
    const evilRef = await post(validPayload('proposal'), { headers: { Referer: 'https://evil.example/fake-form' } });
    assert.equal(evilRef.status, 403, evilRef.text);
    const nullOrigin = await post(validPayload('proposal'), { headers: { Origin: 'null' } });
    assert.equal(nullOrigin.status, 403, nullOrigin.text);
    assert.equal(mailFiles().length, before);
    const good = await post(validPayload('proposal'), { headers: { Origin: 'https://www.blushpicnic.com', Referer: 'https://www.blushpicnic.com/book' } });
    assert.equal(good.status, 200, good.text);
    const local = await post(validPayload('proposal'), { headers: { Origin: BASE } });
    assert.equal(local.status, 200, local.text);
  });

  test('oversized body → 413 (urlencoded, and multipart, which PHP parses before book.php runs)', async () => {
    const r = await post({ ...validPayload('proposal'), notes: 'x'.repeat(70_000) });
    assert.equal(r.status, 413, r.text);
    assert.equal(r.data.ok, false);
    const m = await post({ ...validPayload('proposal'), notes: 'x'.repeat(70_000) }, { type: 'multipart' });
    assert.equal(m.status, 413, m.text);
  });

  test('a file part in a multipart post → 413, nothing sent', async () => {
    const before = mailFiles().length;
    const r = await post(validPayload('proposal'), { type: 'multipart', files: { upload: 'hello' } });
    assert.equal(r.status, 413, r.text);
    assert.equal(mailFiles().length, before);
  });

  test('unsupported content type → 415; malformed JSON → 400', async () => {
    const r1 = await fetch(ENDPOINT, { method: 'POST', body: 'hello', headers: { 'Content-Type': 'text/csv', Accept: 'application/json' } });
    assert.equal(r1.status, 415);
    const r2 = await fetch(ENDPOINT, { method: 'POST', body: '{"occasion":', headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
    assert.equal(r2.status, 400);
  });

  test('the real /book form markup (multipart FormData, addons[], toggle) posts cleanly', async (t) => {
    if (!existsSync(path.join(DIST, 'book.html'))) return t.skip('no /book page in this build yet');
    let chromium;
    try {
      ({ chromium } = await import('@playwright/test'));
    } catch {
      return t.skip('Playwright not installed');
    }
    // CI's build job installs no browser (the e2e job does), so a missing Chromium is a skip, not a failure.
    let browser;
    try {
      browser = await chromium.launch();
    } catch {
      return t.skip('Chromium not installed (npx playwright install chromium)');
    }
    try {
      const page = await browser.newPage();
      await page.goto(`${BASE}/book?occasion=proposal&package=proposal-romance`);
      const payload = { ...validPayload('proposal', { full: true }), addons: SCHEMA.addons.slice(0, 2).map((a) => a.id) };
      delete payload._ts;
      const result = await page.evaluate(async (answers) => {
        const form = document.querySelector('form[action$="book.php"]');
        if (!form) return { error: 'no form posting to book.php' };
        for (const [name, value] of Object.entries(answers)) {
          const els = form.querySelectorAll(`[name="${name}"], [name="${name}[]"]`);
          if (!els.length) return { error: `the form has no input named ${name}` };
          for (const el of els) {
            if (el.type === 'radio') el.checked = el.value === value;
            else if (el.type === 'checkbox') el.checked = Array.isArray(value) ? value.includes(el.value) : el.value === value;
            else el.value = value;
            // Let the page's own script react (showIf fields are enabled on change).
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        form.querySelector('[name="_ts"]').value = String(Date.now() - 60_000);
        const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
        return { status: res.status, body: await res.json() };
      }, payload);
      assert.equal(result.error, undefined, result.error);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assertEmails(result.body.ref, payload);
      const biz = readMail(result.body.ref, 'business');
      for (const a of SCHEMA.addons.slice(0, 2)) assert.ok(biz.text.includes(a.name), `add-on ${a.name} arrived`);
    } finally {
      await browser.close();
    }
  });

  test('direct access to lib/ is not possible through the PHP entry point', async () => {
    // (Apache/LiteSpeed block lib/ via .htaccess; php -S has no .htaccess, so just make sure the
    // helper files produce no output when requested directly.)
    const r = await fetch(`${BASE}/api/lib/Config.php`);
    assert.equal((await r.text()).trim(), '');
  });
});

describe('rate limit', () => {
  before(async () => {
    rmSync(path.join(TMP_DIR, 'rate-limit.json'), { force: true });
    await startServer({ TEST_RATE_LIMIT_MAX: '2' });
  });

  test('third send from the same IP within the window → 429 with Retry-After (answers to fix don’t count)', async () => {
    const invalid = await post({ ...validPayload('proposal'), email: 'nope' });
    assert.equal(invalid.status, 422, invalid.text);
    for (let i = 0; i < 2; i++) {
      const ok = await post(validPayload('proposal'));
      assert.equal(ok.status, 200, ok.text);
    }
    const before = mailFiles().length;
    const r = await post(validPayload('proposal'));
    assert.equal(r.status, 429, r.text);
    assert.equal(r.data.ok, false);
    assert.match(r.data.message, /please text us at \(647\) 878-0539/i);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.equal(mailFiles().length, before);
    const plain = await post(validPayload('proposal'), { json: false });
    assert.equal(plain.status, 303);
    assert.equal(plain.headers.get('location'), '/book?error=1#booking-error');
  });

  test('stored rate-limit data never contains the raw IP', () => {
    const raw = readFileSync(path.join(TMP_DIR, 'rate-limit.json'), 'utf8');
    assert.ok(!raw.includes('127.0.0.1'));
    assert.match(raw, /[0-9a-f]{64}/);
  });
});

describe('rate limit under a burst of parallel requests', () => {
  before(async () => {
    rmSync(path.join(TMP_DIR, 'rate-limit.json'), { force: true });
    await startServer({ TEST_RATE_LIMIT_MAX: '2', PHP_CLI_SERVER_WORKERS: '6' });
  });

  test('6 requests at once with a limit of 2 → exactly 2 sent', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => post(validPayload('proposal'))));
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [200, 200, 429, 429, 429, 429], results.map((r) => r.text).join('\n'));
  });
});

describe('client confirmations: site-wide hourly cap', () => {
  before(async () => {
    rmSync(path.join(TMP_DIR, 'confirm-limit.json'), { force: true });
    await startServer({ TEST_CONFIRM_MAX: '1' });
  });

  test('over the cap the business email still goes out, the confirmation doesn’t', async () => {
    const first = await post(validPayload('proposal'));
    const second = await post(validPayload('proposal'));
    for (const r of [first, second]) assert.equal(r.status, 200, r.text);
    assertEmails(first.data.ref, validPayload('proposal'));
    readMail(second.data.ref, 'business');
    assert.ok(!existsSync(path.join(MAIL_DIR, `${second.data.ref}-client.eml`)), 'second confirmation held back');
    assert.match(readdirSync(TMP_DIR).filter((f) => f.startsWith('booking-')).map((f) => readFileSync(path.join(TMP_DIR, f), 'utf8')).join(''), new RegExp(`"ref":"${second.data.ref}"[^\\n]*"confirmation":"capped"`));
  });
});

describe('client IP for the rate limit', () => {
  test('a proxy header counts only from a trusted proxy; IPv6 is counted per /64', () => {
    const php = `
      require 'public/api/lib/Http.php';
      $out = [];
      $_SERVER = ['REMOTE_ADDR' => '203.0.113.9', 'HTTP_X_FORWARDED_FOR' => '198.51.100.7, 10.0.0.1'];
      $out[] = Blush\\Request::clientIp('X-Forwarded-For');                          // no trusted proxies → ignored
      $out[] = Blush\\Request::clientIp('X-Forwarded-For', ['192.0.2.0/24']);        // not from the proxy → ignored
      $out[] = Blush\\Request::clientIp('X-Forwarded-For', ['203.0.113.0/24']);      // from the proxy → believed
      $out[] = Blush\\Request::rateKeyIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
      $out[] = Blush\\Request::rateKeyIp('2001:db8:1:2::1');
      $out[] = Blush\\Request::rateKeyIp('::ffff:198.51.100.7');
      $out[] = Blush\\Request::rateKeyIp('198.51.100.7');
      echo json_encode($out);`;
    const r = spawnSync('php', ['-r', php], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), ['203.0.113.9', '203.0.113.9', '198.51.100.7', '2001:db8:1:2::/64', '2001:db8:1:2::/64', '198.51.100.7', '198.51.100.7']);
  });
});

describe('failures', () => {
  test('missing config → 500 with a generic message', async () => {
    await startServer({ BLUSH_CONFIG: path.join(ROOT, 'tests/fixtures/does-not-exist.php') });
    const r = await post(validPayload('proposal'));
    assert.equal(r.status, 500, r.text);
    assert.equal(r.data.ok, false);
    assert.match(r.data.message, /text us at \(647\) 878-0539/);
    assert.ok(!r.text.includes('does-not-exist'), 'no path leaked');
    assert.match(serverLog, /\[blush-book\] Booking config not found/);
    const get = await fetch(ENDPOINT);
    assert.equal(get.status, 405);
  });

  test('business email cannot be sent → 500 with “try again or text us”', async () => {
    const blocker = path.join(TMP_DIR, 'not-a-directory');
    writeFileSync(blocker, 'x');
    await startServer({ TEST_MAIL_DIR: path.join(blocker, 'mail') });
    const r = await post(validPayload('proposal'));
    assert.equal(r.status, 500, r.text);
    assert.equal(r.data.ok, false);
    assert.equal(r.data.message, 'We couldn’t send your request just now. Your answers are saved — please try again or text us at (647) 878-0539.');
  });
});

describe('SMTP transport (fake SMTP server)', () => {
  let smtp;
  before(async () => {
    smtp = await fakeSmtp();
    await startServer({ TEST_MAIL_TRANSPORT: 'smtp', TEST_SMTP_PORT: String(smtp.port) });
  });
  after(() => smtp?.server.close());

  test('authenticates and delivers the business email then the client confirmation', async () => {
    const payload = validPayload('proposal', { full: true });
    const r = await post(payload);
    assert.equal(r.status, 200, `${r.text}\n${serverLog}`);
    for (let i = 0; i < 50 && smtp.messages.length < 2; i++) await sleep(50);
    assert.equal(smtp.messages.length, 2);
    const [biz, cli] = smtp.messages;
    for (const m of smtp.messages) {
      assert.deepEqual(m.auth, { user: CFG.smtpUser, pass: CFG.smtpPass });
      assert.equal(m.from, CFG.from);
    }
    assert.deepEqual(biz.to, [CFG.to]);
    assert.deepEqual(cli.to, [payload.email]);
    const bizMail = parseEml(biz.data);
    assert.ok(bizMail.headers.subject.startsWith('New booking: Proposal · '));
    assert.equal(addressOf(bizMail.headers['reply-to']), payload.email);
    assert.ok(bizMail.text.includes(r.data.ref));
    assert.ok(parseEml(cli.data).headers.subject.includes(r.data.ref));
  });

  test('SMTP rejects the login → 500, and the request is kept in data_dir/unsent', async () => {
    smtp.rejectAuth = true;
    const unsent = path.join(TMP_DIR, 'unsent');
    const before = existsSync(unsent) ? readdirSync(unsent).length : 0;
    const r = await post(validPayload('proposal'));
    assert.equal(r.status, 500, r.text);
    assert.match(r.data.message, /couldn’t send your request just now/);
    assert.equal(readdirSync(unsent).length, before + 1, 'unsent copy saved');
    assert.ok(!serverLog.includes(CFG.smtpPass), 'password never logged');
    smtp.rejectAuth = false;
  });
});

after(() => stopServer());

/** Minimal SMTP server: EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, RSET, QUIT. */
function fakeSmtp() {
  const state = { messages: [], rejectAuth: false, server: null, port: 0 };
  const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');
  state.server = createServer((sock) => {
    let buf = '';
    let mode = 'cmd';
    let auth = null;
    let pendingUser = '';
    let cur = { from: '', to: [], data: '' };
    const send = (l) => sock.write(`${l}\r\n`);
    const authResult = (user, pass) => {
      if (state.rejectAuth) return send('535 5.7.8 Authentication failed');
      auth = { user, pass };
      send('235 2.7.0 Authentication successful');
    };
    send('220 fake.smtp.test ESMTP');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (mode === 'data') {
          if (line === '.') {
            state.messages.push({ ...cur, auth, data: Buffer.from(cur.data, 'latin1').toString('utf8') });
            cur = { from: '', to: [], data: '' };
            mode = 'cmd';
            send('250 2.0.0 OK queued');
          } else cur.data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          continue;
        }
        if (mode === 'login-user') { pendingUser = b64(line); mode = 'login-pass'; send('334 UGFzc3dvcmQ6'); continue; }
        if (mode === 'login-pass') { mode = 'cmd'; authResult(pendingUser, b64(line)); continue; }
        if (mode === 'plain') { mode = 'cmd'; const [, u, p] = b64(line).split('\0'); authResult(u, p); continue; }
        const [verb, ...rest] = line.split(' ');
        const arg = rest.join(' ');
        switch (verb.toUpperCase()) {
          case 'EHLO': sock.write('250-fake.smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SIZE 10485760\r\n'); break;
          case 'HELO': send('250 fake.smtp.test'); break;
          case 'AUTH': {
            const [mech, initial] = arg.split(' ');
            if (mech.toUpperCase() === 'PLAIN') {
              if (initial) { const [, u, p] = b64(initial).split('\0'); authResult(u, p); } else { mode = 'plain'; send('334 '); }
            } else if (mech.toUpperCase() === 'LOGIN') {
              if (initial) { pendingUser = b64(initial); mode = 'login-pass'; send('334 UGFzc3dvcmQ6'); } else { mode = 'login-user'; send('334 VXNlcm5hbWU6'); }
            } else send('504 Unrecognized authentication type');
            break;
          }
          case 'MAIL': cur.from = /<([^>]*)>/.exec(arg)?.[1] ?? ''; send(auth ? '250 OK' : '530 Authentication required'); break;
          case 'RCPT': cur.to.push(/<([^>]*)>/.exec(arg)?.[1] ?? ''); send('250 OK'); break;
          case 'DATA': mode = 'data'; send('354 End data with <CR><LF>.<CR><LF>'); break;
          case 'RSET': cur = { from: '', to: [], data: '' }; send('250 OK'); break;
          case 'NOOP': send('250 OK'); break;
          case 'QUIT': send('221 Bye'); sock.end(); break;
          default: send('502 Command not implemented');
        }
      }
    });
  });
  return new Promise((resolve) => state.server.listen(0, '127.0.0.1', () => { state.port = state.server.address().port; resolve(state); }));
}
