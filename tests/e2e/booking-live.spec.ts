// LIVE booking tests: the real browser form posting to the real api/book.php — no page.route() mocking —
// then reading the two .eml files the PHP handler writes (mail_transport "file") and checking what the
// owner and the client actually receive. Mobile only (390px), like an Instagram visitor.
//
// Run from the repo root:
//   OUT_DIR=dist-live CACHE_DIR=node_modules/.astro-live npx astro build
//   BLUSH_CONFIG=$(pwd)/tests/fixtures/blush-config.live.php php -S 127.0.0.1:4506 -t dist-live tests/router.php &
//   BLUSH_LIVE_E2E=1 npx playwright test tests/e2e/booking-live.spec.ts --project=mobile
//   rm -rf tests/.mail-live tests/.tmp-live dist-live node_modules/.astro-live     # afterwards
// The default playwright.config.ts also starts its own e2e server on :4455 (reused if one is running).
// To skip that, point --config at any file outside the repo that only says:
//   export default { testDir: '<repo>/tests/e2e', testMatch: /booking-live\.spec\.ts$/, workers: 3 };
// Without BLUSH_LIVE_E2E=1 every test here is skipped, so `npm run test:e2e` is unaffected.
// tests/.mail-live and tests/.tmp-live hold real-looking test emails and a salt: delete them after a run.
// The fixture sets min_seconds to 0 (Playwright fills the form faster than any person could); the
// spam-flag path is covered on purpose by the honeypot test at the end.
//
// Optional env: LIVE_BASE_URL (default http://127.0.0.1:4506), LIVE_SHOTS_DIR (email screenshots;
// default: this test's output folder, also attached to the report).
import { test, expect, type Page, type Locator, type TestInfo, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { torontoDate, escapeRe, type FormSchema, type ResolvedField, type ResolvedGroup, type Occasion } from './booking-helpers';
import { showIfConditions, showIfMatches, lockedValue } from '../../src/scripts/booking/conditions';

const BASE_URL = process.env.LIVE_BASE_URL ?? 'http://127.0.0.1:4506';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAIL_DIR = path.join(ROOT, 'tests', '.mail-live'); // = mail_dir in tests/fixtures/blush-config.live.php
const OWNER_INBOX = 'owner-inbox@example.com'; // to_email in the fixture
const OWNER_REPLY_TO = 'owner-replies@example.com'; // reply_to_for_client in the fixture

// Occasion ids = content collection ids (file names) + the pseudo occasion "other". Read at collection
// time so each occasion is its own test; a test below checks this matches /api/form-schema.json.
const OCC_DIR = path.join(ROOT, 'src', 'content', 'occasions');
const OCCASION_FILES = fs.readdirSync(OCC_DIR).filter((f) => f.endsWith('.md'));
const OCCASION_IDS = [...OCCASION_FILES.map((f) => f.replace(/\.md$/, '')), 'other'];
const URL_SLUGS: Record<string, string> = Object.fromEntries(
  OCCASION_FILES.map((f) => [f.replace(/\.md$/, ''), /^urlSlug:\s*"?([^"\n]+)"?/m.exec(fs.readFileSync(path.join(OCC_DIR, f), 'utf8'))?.[1] ?? '']),
);

// Which occasions get what (everything else: every applicable question answered, required and optional).
const REQUIRED_ONLY = new Set(['picnic-date', 'announcement']);
const SURPRISE = new Set(['proposal', 'birthday', 'be-my-girlfriend', 'retirement']);
const PACKAGE_OVERRIDE: Record<string, string> = { other: 'not-sure', family: 'celebration', 'picnic-date': 'proposal-romance' };
const GUESTS: Record<string, [adults: number, kids: number | null]> = { birthday: [4, 1], family: [9, 3], corporate: [8, null] };
const SCREENSHOT: Record<string, ('business' | 'client')[]> = { proposal: ['business', 'client'], family: ['business'] };

const CLIENTS = [
  { name: 'Maya Fernandes', phone: '647 555 0123', e164: '+16475550123', ig: '@maya.fernandes' },
  { name: 'Chloé Tremblay', phone: '(416) 555-0199', e164: '+14165550199', ig: '@chloe.tremblay' },
  { name: "Zoë O'Brien", phone: '+1 905-555-0144', e164: '+19055550144', ig: '' },
  { name: 'Aisha Khan', phone: '289.555.0170', e164: '+12895550170', ig: 'aisha_k' },
];
const LOCATIONS = [
  'Trinity Bellwoods Park, Toronto',
  'Woodbine Beach — near the volleyball courts',
  '42 Maple Ave, Mississauga',
  'Kew Gardens & the Beaches',
  'Edwards Gardens, North York',
  'Our backyard in Markham',
];
const SIGN: Record<string, string> = {
  proposal: 'Marry Me?',
  'be-my-girlfriend': 'Be Mine?',
  anniversary: 'Happy 10 Years',
  'just-engaged': 'She Said Yes',
  'newly-married': 'Just Married',
};
const TEXT: Record<string, string> = {
  birthday_name: 'Maya',
  birthday_favourites: 'Lilac and gold',
  anniversary_place: 'Kensington Market, where we met',
  partner_name: 'Daniel',
  partner_colours: 'Ivory and sage',
  partner_flowers: 'Peonies and white roses',
  couple_names: 'Priya & Daniel',
  kids_ages: '3, 6 and 9',
  kids_activities: 'Colouring, bubbles and lawn games',
  honouree: 'Linda Chen',
  company_name: 'Maple & Co. Design',
  honour_message: 'Thank you for 25 years, Linda!',
  baby_name: 'Ava',
  parents_names: 'Sara & Omar',
  due_date: 'March 2027',
  bride_name: 'Hannah',
  surprise_for: 'Daniel',
  surprise_knows: 'His sister Leah and my best friend',
  arrival_plan: 'I’ll suggest a walk after dinner.\nWe should get there around 5:30.',
  colours_vibe: 'Blush and ivory, soft and romantic',
  food_allergies: 'Bringing our own sandwiches.\nOne guest has a nut allergy.',
  notes: 'Please text before 5 pm — thank you!',
  other_occasion: 'A graduation',
  // Room decor and hampers (the typed addresses must reach the owner and never the client's copy).
  room_address: '123 Front St W, Toronto — room 1204',
  delivery_address: '45 Lakeshore Rd E, Mississauga',
  card_message: 'Happy birthday, Sam — love from all of us',
  dietary: 'Nut allergy, vegetarian',
  hamper_vision: 'A spa evening in a basket: candles, a robe and her favourite tea.',
};
const NUMBERS: Record<string, string> = { birthday_age: '30', anniversary_year: '10' };
/** Services that book a picnic package (FormSchema::PICNIC_SERVICES) and the delivered ones (HAMPER_SERVICES). */
const PICNIC_SERVICES = ['picnics', 'proposals'];
const HAMPER_SERVICES = ['birthday-hampers', 'custom-hampers'];
/** The two "area" answers after the travel areas (AREA_OTHER / AREA_UNSURE in src/lib/form.ts). */
const AREA_OTHER = 'Somewhere else in the GTA';
const AREA_UNSURE = 'Not sure yet';

test.skip(!process.env.BLUSH_LIVE_E2E, 'Live tests need the PHP server from the header of this file and BLUSH_LIVE_E2E=1');
test.use({
  baseURL: BASE_URL,
  browserName: 'chromium',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'en-CA',
  timezoneId: 'America/Toronto',
  contextOptions: { reducedMotion: 'reduce' },
});

let schema: FormSchema;
test.beforeAll(async ({ request }, testInfo) => {
  testInfo.skip(testInfo.project.name === 'desktop', 'Live booking tests run once, at 390px');
  const res = await request.get('/api/form-schema.json').catch(() => null);
  if (!res?.ok()) throw new Error(`Live server not reachable at ${BASE_URL} — start it as described at the top of booking-live.spec.ts`);
  schema = (await res.json()) as FormSchema;
});

// Every page must load and run without script errors.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as Page & { __errors?: string[] }).__errors = errors;
  // Keep a copy of api/book.php's JSON answer: the page navigates to /thank-you straight after reading
  // it, which discards the body before Playwright can fetch it. Observes only — nothing is mocked.
  await page.addInitScript(() => {
    const orig = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await orig(...args);
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (url.includes('/api/book.php')) {
        try {
          sessionStorage.setItem('__live_book_response', await res.clone().text());
        } catch {
          /* ignore */
        }
      }
      return res;
    };
  });
});
test.afterEach(async ({ page }) => {
  expect.soft((page as Page & { __errors?: string[] }).__errors ?? [], 'uncaught page errors').toEqual([]);
});

// ───────────────────────── Formatting (mirrors public/api/lib/Booking.php) ─────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** PHP 'D M j, Y' — "Sat Nov 7, 2026". */
const phpDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MONTHS[m - 1]} ${d}, ${y}`;
};
/** PHP 'g:i A' — "4:30 PM". */
const phpTime = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const optLabel = (f: ResolvedField, v: string) => f.options?.find((o) => o.value === v)?.label ?? v;
const shortName = (full: string) => {
  const p = full.trim().split(/\s+/);
  return p.length < 2 ? p[0] : `${p[0]} ${p[p.length - 1].charAt(0).toUpperCase()}.`;
};
const firstName = (full: string) => full.trim().split(/\s+/)[0];
const guestsLabel = (pkg: FormSchema['packages'][number]) =>
  pkg.guestsIncluded !== null && pkg.guestsMax !== null && pkg.guestsMax > pkg.guestsIncluded
    ? `for ${pkg.guestsIncluded}–${pkg.guestsMax} guests`
    : pkg.guestsIncluded !== null
      ? `for ${pkg.guestsIncluded} ${pkg.guestsIncluded === 1 ? 'guest' : 'guests'}`
      : '';

function displayOf(f: ResolvedField, v: string | string[]): string {
  if (Array.isArray(v)) return v.map((x) => optLabel(f, x)).join(', ');
  switch (f.type) {
    case 'select':
    case 'radio':
      return optLabel(f, v);
    case 'date':
      return phpDate(v);
    case 'time':
      return phpTime(v);
    case 'toggle':
      return 'Yes';
    case 'textarea':
      return v.trim();
    default:
      return v.trim().replace(/\s+/g, ' ');
  }
}

// ───────────────────────── What each booking answers ─────────────────────────
interface Answer {
  f: ResolvedField;
  g: ResolvedGroup;
  value: string | string[];
  display: string;
}
type Pkg = FormSchema['packages'][number];
type Service = FormSchema['services'][number];
interface Plan {
  occ: Occasion;
  service: Service;
  /** null for a service without packages (room decor, hampers) */
  pkg: Pkg | null;
  client: (typeof CLIENTS)[number] & { email: string };
  answers: Answer[];
  byId: Map<string, Answer>;
}

function applies(g: ResolvedGroup, f: ResolvedField, occ: Occasion, values: Map<string, string | string[]>): boolean {
  if (!(g.appliesTo.includes('*') || g.appliesTo.includes(occ.formGroup))) return false;
  if (f.onlyFor && !f.onlyFor.includes(occ.id)) return false;
  return showIfConditions(f.showIf).every((c) => {
    const v = values.get(c.field);
    return showIfMatches(c, Array.isArray(v) ? v : [v ?? '']);
  });
}

/** A question the service locks (the browser answers it and hides it), e.g. Proposals → occasion "proposal". */
const isLocked = (f: ResolvedField, values: Map<string, string | string[]>) => {
  const dep = f.lockBy && values.get(f.lockBy.field);
  return !!f.lockBy && lockedValue(f.lockBy, Array.isArray(dep) ? dep : [dep ?? '']) !== null;
};

/** These picnic tests book Proposals for a proposal and Picnics for everything else. */
const serviceFor = (occ: Occasion) => (occ.id === 'proposal' ? 'proposals' : 'picnics');

function sample(f: ResolvedField, occ: Occasion, i: number, client: Plan['client'], pkgId: string, serviceId: string): string | string[] | null {
  const opts = f.options ?? [];
  const rotate = (k = 0) => opts[(i + k) % opts.length].value;
  switch (f.id) {
    case 'service':
      return serviceId;
    case 'occasion':
      return occ.id;
    case 'package':
      return pkgId;
    case 'date':
      return torontoDate(21 + i);
    case 'backup_date':
      return torontoDate(28 + i);
    case 'start_time':
      return ['16:30', '11:00', '18:45', '13:15'][i % 4];
    case 'guests_adults':
      return String(GUESTS[occ.id]?.[0] ?? (pkgId === 'celebration' ? 7 : 2));
    case 'guests_kids': {
      const k = GUESTS[occ.id]?.[1];
      return k === null ? null : String(k ?? 1);
    }
    case 'location':
      return LOCATIONS[i % LOCATIONS.length];
    case 'sign_wording':
      return SIGN[occ.id] ?? 'Happy Days';
    case 'letter_board':
      return `Made with love for ${firstName(client.name)}`;
    case 'name':
      return client.name;
    case 'phone':
      return client.phone;
    case 'email':
      return client.email;
    case 'instagram':
      return client.ig || null;
    case 'couple_date':
      return occ.id === 'newly-married' ? torontoDate(-30) : torontoDate(200);
    case 'baby_dob':
      return torontoDate(-20);
    case 'wedding_date':
      return torontoDate(150);
  }
  if (TEXT[f.id]) return f.maxLength ? TEXT[f.id].slice(0, f.maxLength) : TEXT[f.id];
  if (NUMBERS[f.id]) return NUMBERS[f.id];
  switch (f.type) {
    case 'radio':
    case 'select':
      return rotate();
    case 'checkboxes': {
      const picked = new Set([rotate(), rotate(3)]);
      return opts.map((o) => o.value).filter((v) => picked.has(v)); // the server keeps the form's order
    }
    case 'toggle':
      return SURPRISE.has(occ.id) ? 'yes' : null;
    case 'number':
      return String(Math.max(f.min ?? 1, 2));
    case 'date':
      return torontoDate(40);
    case 'time':
      return '15:00';
    case 'email':
      return client.email;
    case 'tel':
      return client.phone;
    default: // a question added to booking-form.yaml later
      return `Sample ${f.label}`.replace(/[?:…]/g, '').slice(0, f.maxLength ?? 120);
  }
}

interface PlanOptions {
  requiredOnly?: boolean;
  pkg?: string;
  clientIndex?: number;
  /** services.yaml id; default: Proposals for a proposal, Picnics for everything else */
  service?: string;
  /** fixed answers for particular questions (e.g. the area), instead of the sample */
  overrides?: Record<string, string | string[]>;
}

function buildPlan(occId: string, opts: PlanOptions = {}): Plan {
  const i = Math.max(0, OCCASION_IDS.indexOf(occId));
  const occ = schema.occasions.find((o) => o.id === occId)!;
  expect(occ, `occasion ${occId} in /api/form-schema.json`).toBeTruthy();
  const serviceId = opts.service ?? serviceFor(occ);
  const service = schema.services.find((s) => s.id === serviceId)!;
  expect(service, `service ${serviceId} in /api/form-schema.json`).toBeTruthy();
  // A service that locks the occasion (Proposals, hampers) only ever books that occasion.
  const occField = schema.groups.flatMap((g) => g.fields).find((f) => f.id === 'occasion');
  const locked = occField?.lockBy ? lockedValue(occField.lockBy, [serviceId]) : null;
  if (locked !== null) expect(occ.id, `${serviceId} locks the occasion to “${locked}”`).toBe(locked);
  const pkgId = opts.pkg ?? PACKAGE_OVERRIDE[occId] ?? occ.recommendedPackage ?? 'not-sure';
  const base = CLIENTS[(opts.clientIndex ?? i) % CLIENTS.length];
  const local = firstName(base.name).normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase();
  const client = { ...base, email: `${local}+${occId.replace(/[^a-z]/g, '')}@example.com` };
  const requiredOnly = opts.requiredOnly ?? REQUIRED_ONLY.has(occId);
  const values = new Map<string, string | string[]>();
  const answers: Answer[] = [];
  for (const g of schema.groups)
    for (const f of g.fields) {
      if (!applies(g, f, occ, values)) continue;
      if (requiredOnly && !f.required) continue;
      const v = opts.overrides?.[f.id] ?? sample(f, occ, i, client, pkgId, serviceId);
      if (v === null || (Array.isArray(v) && !v.length)) continue;
      values.set(f.id, v);
      answers.push({ f, g, value: v, display: displayOf(f, v) });
    }
  // The package only exists for picnics and proposals (its showIf); the plan carries it only when answered.
  const pkg = schema.packages.find((p) => p.id === values.get('package')) ?? null;
  return { occ, service, pkg, client, answers, byId: new Map(answers.map((a) => [a.f.id, a])) };
}

// ───────────────────────── Driving the real form ─────────────────────────
const fieldBox = (page: Page, id: string) => page.locator(`[data-field="${id}"]`);
const primary = (page: Page) => page.locator('[data-primary]');
const stepTitle = (page: Page, step: number) =>
  page.getByRole('heading', { level: 2, name: new RegExp(escapeRe(step <= schema.steps.length ? schema.steps[step - 1] : 'Review & send')) });

async function openBook(page: Page, query = '') {
  await page.goto(`/book${query}`);
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
}

async function answer(page: Page, a: Answer) {
  const { f, value } = a;
  const box = fieldBox(page, f.id);
  if (f.id === 'service' || f.id === 'package') return box.locator(`input[value="${value}"]`).check();
  switch (f.type) {
    case 'radio':
    case 'select': {
      const radio = box.getByRole('radio', { name: optLabel(f, value as string), exact: true });
      if (f.id === 'occasion' || (await box.locator('input[type="radio"]').count())) return radio.check();
      return box.locator('select').selectOption(value as string);
    }
    case 'checkboxes':
      for (const v of value as string[]) await box.getByRole('checkbox', { name: optLabel(f, v), exact: true }).check();
      return;
    case 'toggle':
      return box.getByRole('switch', { name: f.label }).check();
    default:
      return page.locator(`#f-${f.id}`).fill(value as string);
  }
}

async function fillStep(page: Page, plan: Plan, step: number, skip: string[] = []) {
  await expect(stepTitle(page, step)).toBeVisible();
  const values = new Map(plan.answers.map((a) => [a.f.id, a.value]));
  // A locked question (the occasion, once Proposals is chosen) is answered by the browser and hidden.
  for (const a of plan.answers) if (a.g.step === step && !skip.includes(a.f.id) && !isLocked(a.f, values)) await answer(page, a);
}

async function continueTo(page: Page, step: number) {
  await primary(page).click();
  await expect(stepTitle(page, step)).toBeVisible();
}

interface Sent {
  ref: string;
  response: { ok?: boolean; ref?: string; message?: string };
}

/** Review → Send → /thank-you. Returns the reference shown to the visitor. */
async function sendAndConfirm(page: Page, plan: Plan): Promise<Sent> {
  await expect(stepTitle(page, 5)).toBeVisible();
  const review = page.locator('[data-review-list]');
  await expect(review).toContainText(plan.service.name);
  await expect(review).toContainText(plan.occ.name); // a locked occasion (Proposals, hampers) is reviewed too
  if (plan.pkg) await expect(review).toContainText(plan.pkg.name);
  const addons = plan.byId.get('addons');
  if (addons) await expect(review).toContainText(addons.display);

  const responseP = page.waitForResponse((r) => r.url().endsWith('/api/book.php') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send booking request' }).click();
  const res = await responseP;
  expect(res.status(), 'api/book.php status').toBe(200);
  expect(res.headers()['content-type']).toContain('application/json');

  await page.waitForURL('**/thank-you');
  const body = JSON.parse((await page.evaluate(() => sessionStorage.getItem('__live_book_response'))) ?? '{}') as Sent['response'];
  expect(body.ok, `api/book.php answered ${JSON.stringify(body)}`).toBe(true);
  expect(body.message).toBe(`Thank you, ${firstName(plan.client.name)} — we’ve received your request and will reply ${schema.business.replyTime}.`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Thank you, ${firstName(plan.client.name)}.`);
  const refEl = page.locator('[data-thanks-ref-value]');
  await expect(refEl).toHaveText(/^BP-\d{8}-[A-HJ-NP-Z2-9]{4}$/);
  const ref = (await refEl.textContent())!.trim();
  expect(ref).toBe(body.ref);
  expect(ref.slice(3, 11)).toBe(torontoDate(0).replace(/-/g, ''));
  return { ref, response: body };
}

/** The whole flow for a plan, from an already-open /book page. */
async function completeBooking(page: Page, plan: Plan, opts: { preselected?: boolean } = {}) {
  await expect(stepTitle(page, 1)).toBeVisible();
  if (!opts.preselected) await fillStep(page, plan, 1);
  for (let step = 2; step <= schema.steps.length; step++) {
    await continueTo(page, step);
    await fillStep(page, plan, step);
  }
  await continueTo(page, 5);
  return sendAndConfirm(page, plan);
}

// ───────────────────────── Reading the .eml files ─────────────────────────
interface Eml {
  headers: Record<string, string>;
  html: string;
  text: string;
  bytes: number;
}

const decodeQP = (s: string) =>
  Buffer.from(s.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');

/** RFC 2047 encoded words ("=?utf-8?Q?Chlo=C3=A9?="). */
const decodeWords = (s: string) =>
  s
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, _cs: string, enc: string, data: string) =>
      enc.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64').toString('utf8')
        : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'),
    );

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = decodeWords(line.slice(i + 1).trim());
  }
  return out;
}

function parseEml(file: string): Eml {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const cut = raw.indexOf('\n\n');
  const headers = parseHeaders(raw.slice(0, cut));
  const boundary = /boundary="?([^";]+)"?/i.exec(headers['content-type'] ?? '')?.[1];
  expect(boundary, 'multipart/alternative email (HTML + plain text)').toBeTruthy();
  let html = '';
  let text = '';
  for (const part of raw.slice(cut + 2).split(`--${boundary}`).slice(1, -1)) {
    const p = part.replace(/^\n/, '');
    const j = p.indexOf('\n\n');
    const ph = parseHeaders(p.slice(0, j));
    let body = p.slice(j + 2).replace(/\n$/, '');
    const cte = (ph['content-transfer-encoding'] ?? '').toLowerCase();
    if (cte === 'quoted-printable') body = decodeQP(body);
    else if (cte === 'base64') body = Buffer.from(body, 'base64').toString('utf8');
    if (/text\/html/i.test(ph['content-type'] ?? '')) html = body;
    else if (/text\/plain/i.test(ph['content-type'] ?? '')) text = body;
  }
  return { headers, html, text, bytes: Buffer.byteLength(html, 'utf8') };
}

async function emailsFor(ref: string): Promise<{ business: Eml; client: Eml }> {
  const biz = path.join(MAIL_DIR, `${ref}-business.eml`);
  const cli = path.join(MAIL_DIR, `${ref}-client.eml`);
  await expect.poll(() => fs.existsSync(biz) && fs.existsSync(cli), { message: `${ref}: business + client .eml in tests/.mail-live`, timeout: 10_000 }).toBe(true);
  return { business: parseEml(biz), client: parseEml(cli) };
}

interface EmailDom {
  h1: string;
  sections: { title: string; rows: [string, string][] }[];
  text: string;
  links: { href: string; text: string }[];
}

/** Render an email in a real browser page and read it like a person would. */
async function readEmail(context: BrowserContext, html: string): Promise<EmailDom> {
  const p = await context.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  const dom = await p.evaluate(() => {
    const sections: { title: string; rows: [string, string][] }[] = [{ title: '(summary)', rows: [] }];
    for (const el of document.querySelectorAll<HTMLElement>('h2, tr')) {
      if (el.tagName === 'H2') sections.push({ title: el.innerText.trim(), rows: [] });
      else {
        const l = el.querySelector<HTMLElement>(':scope > td.bp-label');
        const v = el.querySelector<HTMLElement>(':scope > td.bp-value');
        if (l && v) sections[sections.length - 1].rows.push([l.innerText.trim(), v.innerText.trim()]);
      }
    }
    return {
      h1: document.querySelector('h1')?.textContent?.trim() ?? '',
      sections,
      text: document.body.innerText,
      links: [...document.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href') ?? '', text: a.textContent?.trim() ?? '' })),
    };
  });
  await p.close();
  return dom;
}

/** Things that break or get clipped in Gmail (and other webmail). */
function expectGmailSafe(e: Eml, label: string) {
  const { html } = e;
  expect.soft(e.bytes, `${label}: under Gmail's 102 KB clipping limit`).toBeLessThan(102 * 1024);
  expect.soft(html, `${label}: no scripts`).not.toMatch(/<script/i);
  expect.soft(html, `${label}: no external stylesheets`).not.toMatch(/<link[^>]+stylesheet/i);
  expect.soft(html, `${label}: no CSS variables, flex/grid or positioning`).not.toMatch(/var\(--|display:\s*(flex|grid)|position:\s*(absolute|fixed)/i);
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1].trim());
  for (const css of styleBlocks) expect.soft(css, `${label}: <style> only holds progressive @media tweaks`).toMatch(/^@media[\s\S]*\}$/);
  const bodyHtml = html.slice(html.search(/<body/i));
  const unstyled = [...bodyHtml.matchAll(/<(td|p|a|h1|h2|div|span)\b(?![^>]*\bstyle=)[^>]*>/gi)].map((m) => m[0]);
  expect.soft(unstyled, `${label}: every text element carries inline styles`).toEqual([]);
  expect.soft(html, `${label}: declares UTF-8 and a viewport`).toMatch(/<meta charset="utf-8">[\s\S]*<meta name="viewport"/i);
}

async function screenshotEmail(context: BrowserContext, html: string, name: string, testInfo: TestInfo) {
  const dir = process.env.LIVE_SHOTS_DIR ?? testInfo.outputPath('emails');
  fs.mkdirSync(dir, { recursive: true });
  const p = await context.newPage();
  for (const width of [390, 700]) {
    await p.setViewportSize({ width, height: 900 });
    await p.setContent(html, { waitUntil: 'load' });
    const file = path.join(dir, `${name}-${width}.png`);
    await p.screenshot({ path: file, fullPage: true });
    // No sideways scrolling inside the email at either width.
    expect.soft(await p.evaluate(() => document.documentElement.scrollWidth), `${name} @${width}px fits the screen`).toBeLessThanOrEqual(width);
    await testInfo.attach(`${name}-${width}px`, { path: file, contentType: 'image/png' });
  }
  await p.close();
}

// ───────────────────────── What the emails must say ─────────────────────────
const isPicnic = (plan: Plan) => PICNIC_SERVICES.includes(plan.service.id);
const isHamper = (plan: Plan) => HAMPER_SERVICES.includes(plan.service.id);
/** "picnic request" for picnics and proposals, "request" otherwise (Booking::requestNoun). */
const requestNoun = (plan: Plan) => (isPicnic(plan) ? 'picnic request' : 'request');
/** [service, occasion] for everything but a plain picnic, where the occasion says it all (Booking::headlineParts). */
/** A custom hamper locks the pseudo occasion "other": not the visitor's choice, so it is left out of the subject and rows. */
const impliedOccasion = (plan: Plan) => plan.occ.id === 'other' && lockedOccasion(plan.service.id) === 'other';
const headline = (plan: Plan) =>
  [...(['picnics', 'proposals'].includes(plan.service.id) ? [] : [plan.service.name]), ...(impliedOccasion(plan) ? [] : [plan.occ.name])].join(' · ');

/**
 * The starting estimate in the business email (Estimate::compute): a package total only for picnics and
 * proposals; the picnic style, chosen add-ons and the travel fee are lines when priced and "quoted"
 * notes otherwise; room decor and hampers are always "To be quoted" but still list those.
 */
function expectedEstimate(plan: Plan) {
  const lines: [string, number][] = [];
  const notes: string[] = [];
  const n = (id: string) => Math.max(0, Number(plan.byId.get(id)?.value ?? 0));
  const pkg = isPicnic(plan) ? plan.pkg : null;
  const priced = !!pkg && pkg.priceFrom !== null;
  if (pkg && priced) {
    const adults = n('guests_adults');
    const kids = n('guests_kids');
    const given = adults + kids;
    const included = pkg.guestsIncluded ?? 0;
    const guests = given > 0 ? given : included;
    lines.push([`${pkg.name}, ${guestsLabel(pkg)}`.replace(/, $/, ''), pkg.priceFrom!]);
    const extra = Math.max(0, guests - included);
    if (extra > 0) {
      if (pkg.extraGuestPrice !== null) {
        // Only adults are priced; kids past the included guests are confirmed in the quote.
        const extraAdults = Math.max(0, adults - included);
        if (extraAdults > 0) lines.push([`${extraAdults} ${extraAdults === 1 ? 'extra guest' : 'extra guests'} × ${money(pkg.extraGuestPrice)}`, extraAdults * pkg.extraGuestPrice]);
        const extraKids = Math.min(kids, extra);
        if (extraKids > 0) notes.push(`${extraKids} ${extraKids === 1 ? 'kid' : 'kids'}: we’ll confirm pricing in your quote`);
      } else if (pkg.guestsMax !== null) {
        if (guests > pkg.guestsMax) notes.push(`${guests} guests: larger groups quoted`);
      } else notes.push(`${guests} guests: extra guests quoted separately`);
    }
  }
  const styleId = plan.byId.get('picnic_style')?.value as string | undefined;
  const style = styleId ? schema.styles.find((s) => s.id === styleId) : undefined;
  if (style && !style.included) {
    if (style.price !== null) lines.push([style.name, style.price]);
    else notes.push(`${style.name}: quoted`);
  }
  const addonIds = (plan.byId.get('addons')?.value as string[] | undefined) ?? [];
  const chosen = addonIds.map((id) => schema.addons.find((a) => a.id === id)!);
  lines.push(...chosen.filter((a) => a.price !== null).map((a) => [a.name, a.price!] as [string, number]));
  const onRequest = chosen.filter((a) => a.price === null).map((a) => a.name);
  const area = plan.byId.get('area')?.value as string | undefined;
  if (area) {
    const known = schema.travel.areas.find((a) => a.name === area);
    if (known && known.fee !== null) lines.push([`Travel to ${known.name}`, known.fee]);
    else if (known) notes.push(`Travel to ${known.name}: quoted by area`);
    else if (area === AREA_UNSURE) notes.push('Travel: quoted once you choose an area');
    else notes.push('Travel: quoted by area'); // AREA_OTHER
  }
  const toQuote = [...notes, ...(onRequest.length ? [`Price on request: ${onRequest.join(', ')}`] : [])];
  if (!priced) return { headline: 'To be quoted', lines, toQuote };
  const total = lines.reduce((s, [, a]) => s + a, 0);
  return { headline: `Starting at ${money(total)} ${schema.taxNote}`, lines, toQuote };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The summary rows at the top of each email (Booking::summaryRows). Rows without a value are left out,
 * so a hamper has no Package, Guests or Start time row and a picnic no "When it arrives". The Service
 * row comes first. The client's copy holds only answers from our own lists (plus date, time, guests
 * and area): the kind of place but never the typed picnic spot, room address or delivery address.
 */
function summaryRows(plan: Plan, forBusiness: boolean): [string, string][] {
  const d = (id: string) => plan.byId.get(id)?.display ?? '';
  const backup = d('backup_date');
  const adults = Number(plan.byId.get('guests_adults')?.value ?? 0);
  const kids = Number(plan.byId.get('guests_kids')?.value ?? 0);
  const guests = [...(adults > 0 ? [count(adults, 'adult', 'adults')] : []), ...(kids > 0 ? [count(kids, 'kid', 'kids')] : [])].join(' · ');
  const pkg = plan.pkg;
  const pkgLine = !pkg
    ? ''
    : forBusiness
      ? pkg.priceFrom !== null
        ? `${pkg.name} · Starting at ${money(pkg.priceFrom)}${guestsLabel(pkg) ? ` ${guestsLabel(pkg)}` : ''}, ${schema.taxNote}`
        : pkg.name
      : pkg.id === 'not-sure'
        ? 'Not sure yet — we’ll recommend one'
        : pkg.name;
  // "Park" (picnics) or "Hotel room" (room decor); a hamper only has a delivery address.
  const placeType = d('location_type') || d('room_type');
  const place = d('location') || d('room_address') || d('delivery_address');
  const rows: [string, string][] = [
    ['Service', plan.service.name],
    ...(impliedOccasion(plan) ? [] : [['Occasion', plan.occ.name] as [string, string]]),
    ['Package', pkgLine],
    ['Date', d('date') + (backup ? (forBusiness ? ` (backup: ${backup})` : ` · backup ${backup}`) : '')],
    ['Start time', d('start_time')],
    ['When it arrives', d('delivery_slot')],
    ['Guests', guests],
    ['Location', forBusiness ? [placeType, place].filter(Boolean).join(' · ') : placeType],
    ['Area', d('area')],
  ];
  if (forBusiness)
    rows.push(['Budget', d('budget')], ['Surprise', plan.byId.get('is_surprise')?.value === 'yes' ? 'Yes' : ''], ['Prefers', d('contact_pref')]);
  return rows.filter(([, v]) => v.trim() !== '');
}

/**
 * Answers the business email shows in its summary rows instead of under their form section
 * (Booking::SUMMARY_FIELDS): field id → [summary row label, what that row shows for the answer].
 */
const SUMMARY_FIELDS: Record<string, [label: string, shows: (a: Answer) => string]> = {
  service: ['Service', (a) => a.display],
  occasion: ['Occasion', (a) => a.display],
  package: ['Package', (a) => a.display],
  date: ['Date', (a) => a.display],
  backup_date: ['Date', (a) => `(backup: ${a.display})`],
  start_time: ['Start time', (a) => a.display],
  delivery_slot: ['When it arrives', (a) => a.display],
  guests_adults: ['Guests', (a) => count(Number(a.value), 'adult', 'adults')],
  guests_kids: ['Guests', (a) => (Number(a.value) > 0 ? count(Number(a.value), 'kid', 'kids') : '')],
  location_type: ['Location', (a) => a.display],
  location: ['Location', (a) => a.display],
  room_type: ['Location', (a) => a.display],
  room_address: ['Location', (a) => a.display],
  delivery_address: ['Location', (a) => a.display],
  area: ['Area', (a) => a.display],
  budget: ['Budget', (a) => a.display],
  is_surprise: ['Surprise', () => 'Yes'],
  contact_pref: ['Prefers', (a) => a.display],
};

/** The label of an answer's row under its section: the form's own label (a toggle uses its section title, as the review step does). */
const sectionLabel = (a: Answer) => (a.f.type === 'toggle' && a.g.title.trim() ? a.g.title : a.f.label).trim();

/** The first, filled button in the business email: the client's "Best way to reach you" when we have it, else Text. */
function preferredAction(plan: Plan): { verb: string; short: string; href: string; matched: boolean } {
  const { client } = plan;
  const pref = (plan.byId.get('contact_pref')?.display ?? '').toLowerCase();
  const ig = (plan.byId.get('instagram')?.value as string | undefined)?.replace(/^@/, '');
  if (pref.includes('instagram') && ig) return { verb: 'DM', short: 'Instagram', href: `https://instagram.com/${ig}`, matched: true };
  if (pref.includes('mail')) return { verb: 'Email', short: 'Email', href: `mailto:${client.email}?subject=`, matched: true };
  if (pref.includes('text')) return { verb: 'Text', short: 'Text', href: `sms:${client.e164}`, matched: true };
  if (pref.includes('call')) return { verb: 'Call', short: 'Call', href: `tel:${client.e164}`, matched: true };
  return { verb: 'Text', short: 'Text', href: `sms:${client.e164}`, matched: false };
}

/** `spam`: the reason a spam check flagged the request (a fragment of it), when one should have. */
async function checkBusinessEmail(context: BrowserContext, plan: Plan, ref: string, e: Eml, opts: { spam?: string } = {}) {
  const { client } = plan;
  const date = plan.byId.get('date')!.display;
  // "New booking: Proposal · …" for a picnic or a proposal; room decor and hampers are named first ("Room decor · Birthday · …").
  expect.soft(e.headers['subject'], 'business subject').toBe(`${opts.spam ? '[Possible spam] ' : ''}New booking: ${headline(plan)} · ${date} · ${shortName(client.name)}`);
  expect.soft(e.headers['reply-to'], 'business Reply-To is the client').toContain(`<${client.email}>`);
  expect.soft(e.headers['reply-to']).toContain(client.name);
  expect.soft(e.headers['to'], 'business To').toContain(OWNER_INBOX);
  expect.soft(e.headers['from'], 'From').toBe('Blush Picnic <support@blushpicnic.com>');
  expect.soft(e.headers['x-blush-ref']).toBe(ref);
  expect.soft(e.headers['x-mailer'] ?? '', 'no PHPMailer banner').not.toMatch(/phpmailer/i);
  expectGmailSafe(e, 'business email');

  const dom = await readEmail(context, e.html);
  expect.soft(dom.h1).toBe('New booking request');
  if (opts.spam) {
    expect.soft(dom.text, 'spam notice above everything else').toMatch(new RegExp(`^[\\s\\S]*?Possible spam\\. A spam check flagged this request: ${escapeRe(opts.spam)}[\\s\\S]*?New booking request`));
    expect.soft(dom.text).toContain('No confirmation email was sent to them.');
    expect.soft(e.text, 'plain text starts with the spam notice').toMatch(new RegExp(`^POSSIBLE SPAM: A spam check flagged this request: ${escapeRe(opts.spam)}`));
  } else {
    expect.soft(dom.text, 'not flagged as spam').not.toContain('Possible spam');
    expect.soft(e.text, 'not flagged as spam').not.toContain('POSSIBLE SPAM');
  }
  expect.soft(dom.text, 'subline names the service (unless a plain picnic), the date and the client').toContain(`${headline(plan)} · ${date} · from ${client.name}`);
  const summary = summaryRows(plan, true);
  expect.soft(dom.sections[0].rows, 'business summary rows').toEqual(summary);
  expect.soft(summary[0], 'the Service row comes first').toEqual(['Service', plan.service.name]);

  // Every answered question is in the email, with a human value: the core ones in the summary rows
  // above, every other one under its form section with the form's own label.
  const rows = dom.sections.slice(1).flatMap((s) => s.rows.map(([l, v]) => ({ section: s.title, label: l, value: v })));
  const sectionLabels = new Set<string>();
  for (const a of plan.answers) {
    const inSummary = SUMMARY_FIELDS[a.f.id];
    if (inSummary) {
      const [label, shows] = inSummary;
      const want = shows(a);
      if (!want) continue;
      const row = dom.sections[0].rows.find(([l]) => l === label);
      expect.soft(row?.[1] ?? `(no “${label}” row)`, `“${a.f.label}” (${a.f.id}) in the summary row “${label}”`).toContain(want);
      continue;
    }
    const label = sectionLabel(a);
    sectionLabels.add(label);
    const row = rows.find((r) => r.label === label);
    expect.soft(row, `business email has a row labelled “${label}”`).toBeTruthy();
    if (!row) continue;
    expect.soft(row.value, `“${label}” value`).toBe(a.display);
    expect.soft(row.section, `“${label}” section`).toBe(a.g.title);
  }
  expect.soft(rows.filter((r) => !sectionLabels.has(r.label)).map((r) => r.label), 'no rows for unanswered questions, none repeating the summary').toEqual([]);
  // Names, never ids.
  const ids = [plan.service.id, plan.pkg?.id ?? '', plan.occ.id, ...((plan.byId.get('addons')?.value as string[] | undefined) ?? [])];
  for (const id of ids.filter((x) => x.includes('-'))) {
    expect.soft(dom.text, `id “${id}” leaked into the business email`).not.toContain(id);
    expect.soft(e.text, `id “${id}” leaked into the business plain text`).not.toContain(id);
  }

  // Starting estimate, always "before HST" — a total only for picnics and proposals.
  const est = expectedEstimate(plan);
  expect.soft(dom.text, 'estimate box').toMatch(/Starting estimate/i); // the kicker is small caps (CSS uppercase, kept by innerText)
  expect.soft(dom.text, 'estimate headline').toContain(est.headline);
  if (!isPicnic(plan)) expect.soft(est.headline, `${plan.service.id} is quoted by hand`).toBe('To be quoted');
  expect.soft(e.text, 'plain text estimate headline').toContain(`STARTING ESTIMATE: ${est.headline}`);
  for (const [label, amount] of est.lines) expect.soft(dom.text, `estimate line ${label}`).toMatch(new RegExp(`${escapeRe(label)}\\s+${escapeRe(money(amount))}`));
  for (const q of est.toQuote) expect.soft(dom.text, 'to quote').toContain(`To quote: ${q}`);
  expect.soft(dom.text, 'estimate note').toContain(`starting prices, ${schema.taxNote}`);

  // One-tap actions for the owner, the client's preferred way to reach them first ("Text Maya").
  const hrefs = dom.links.map((l) => l.href);
  expect.soft(hrefs, 'Text client').toContain(`sms:${client.e164}`);
  expect.soft(hrefs, 'Call client').toContain(`tel:${client.e164}`);
  expect.soft(hrefs.some((h) => h.startsWith(`mailto:${client.email}?subject=`)), 'Email client').toBe(true);
  const ig = plan.byId.get('instagram')?.value as string | undefined;
  if (ig) expect.soft(hrefs, 'Instagram').toContain(`https://instagram.com/${ig.replace(/^@/, '')}`);
  expect.soft(hrefs.some((h) => h.startsWith('https://www.google.com/maps/search/?api=1&query=')), 'Map').toBe(true);
  const pref = preferredAction(plan);
  // The first link with a text is the first button (the logo link above it has only an image).
  const firstButton = dom.links.find((l) => l.text !== '');
  expect.soft(firstButton?.text, 'first button: the preferred way to reach the client').toBe(`${pref.verb} ${firstName(client.name)}`);
  expect.soft(firstButton?.href.startsWith(pref.href), `first button links to ${pref.href}`).toBe(true);
  if (pref.matched) expect.soft(e.text, 'plain text marks the preferred way').toMatch(new RegExp(`^  ${pref.short}: .*  ← preferred$`, 'm'));
  else expect.soft(e.text, 'no preference given (or none we can act on)').not.toContain('← preferred');
  expect.soft(dom.text).toContain(`Reference ${ref}`);
  expect.soft(dom.text).toMatch(/Received \w{3} \w{3} \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M \(Toronto time\)/);

  // Plain-text alternative carries the same essentials: the summary rows and every other answer.
  for (const s of [ref, plan.service.name, ...(impliedOccasion(plan) ? [] : [plan.occ.name]), date, client.email, est.headline]) expect.soft(e.text, `business plain text has “${s}”`).toContain(s);
  if (!impliedOccasion(plan)) expect.soft(e.text.indexOf('\nService: ') < e.text.indexOf('\nOccasion: '), 'plain text: Service before Occasion').toBe(true);
  for (const [label, value] of summary) expect.soft(e.text, `business plain text summary: ${label}`).toContain(`\n${label}: ${value}\n`);
  for (const a of plan.answers.filter((x) => !SUMMARY_FIELDS[x.f.id])) {
    const value = a.display.includes('\n') ? `\n  ${a.display.replace(/\n/g, '\n  ')}` : a.display;
    expect.soft(e.text, `business plain text: ${sectionLabel(a)}`).toContain(`\n${sectionLabel(a)}: ${value}\n`);
  }
}

async function checkClientEmail(context: BrowserContext, plan: Plan, ref: string, e: Eml) {
  const { client } = plan;
  const biz = schema.business;
  // "…your picnic request" for picnics and proposals, "…your request" for room decor and hampers.
  expect.soft(e.headers['subject'], 'client subject').toBe(`We’ve received your ${requestNoun(plan)} (${ref})`);
  // No display name: the confirmation carries none of the visitor's own words.
  expect.soft(e.headers['to'], 'client To is the bare address').toBe(client.email);
  expect.soft(e.headers['from'], 'From').toBe('Blush Picnic <support@blushpicnic.com>');
  expect.soft(e.headers['reply-to'], 'client Reply-To goes to the business').toContain(OWNER_REPLY_TO);
  expect.soft(e.headers['auto-submitted']).toBe('auto-generated');
  expect.soft(e.headers['x-blush-ref']).toBe(ref);
  expect.soft(e.headers['x-mailer'] ?? '', 'no PHPMailer banner').not.toMatch(/phpmailer/i);
  expectGmailSafe(e, 'client email');

  const dom = await readEmail(context, e.html);
  expect.soft(dom.h1).toBe(`Thank you, ${firstName(client.name)}.`);
  expect.soft(dom.text, 'the client copy calls itself a summary').toContain(`We’ve received your ${requestNoun(plan)}. Here’s a summary:`);
  const summary = summaryRows(plan, false);
  expect.soft(dom.sections[0].rows, 'client summary rows').toEqual(summary);
  expect.soft(summary[0], 'the Service row comes first').toEqual(['Service', plan.service.name]);

  // What happens next: the booking deposit and the refundable security deposit are separate steps.
  // The last step says what we do: set up a picnic or a room, or deliver a hamper.
  const deposit = `${money(schema.deposit.standard)} booking deposit (or ${schema.deposit.largeEventPercent}% for larger events)`;
  const security = `${money(schema.securityDeposit.amount)} refundable security deposit`;
  const [lastTitle, lastText] = isHamper(plan)
    ? ['We deliver your hamper', 'We put it together and deliver it at the time you chose.']
    : ['We set up, you arrive', 'We deliver, set up, style and clean up — you just arrive.'];
  // The security deposit (rented items) is a step only for services that carry it (services.yaml) — not hampers.
  const hasSecurity = plan.service.securityDeposit !== false;
  expect.soft(dom.text, 'What happens next: quote → booking deposit → (security deposit) → set-up / delivery').toMatch(
    new RegExp(
      ['What happens next', 'We reply with your quote', 'Your booking deposit', deposit, ...(hasSecurity ? ['Your security deposit', security] : []), lastTitle, lastText]
        .map(escapeRe)
        .join('[\\s\\S]*'),
    ),
  );
  if (!hasSecurity) expect.soft(dom.text, 'no security deposit for a hamper').not.toContain('security deposit');
  expect.soft(dom.text, 'only one kind of last step').not.toContain(isHamper(plan) ? 'you just arrive' : 'We deliver your hamper');
  for (const s of [schema.deposit.summary, ...(hasSecurity ? [schema.securityDeposit.summary] : [])]) expect.soft(dom.text, 'deposit sentences from settings.yaml').toContain(s);
  expect.soft(dom.links).toContainEqual({ href: `${biz.url.replace(/\/$/, '')}/policies`, text: 'Read our booking policies' });
  expect.soft(dom.text).toContain(biz.phoneDisplay);
  expect.soft(dom.text).toContain(biz.instagramHandle);
  expect.soft(dom.links).toContainEqual({ href: `tel:${biz.phoneE164}`, text: biz.phoneDisplay });
  expect.soft(dom.links).toContainEqual({ href: biz.instagramUrl, text: biz.instagramHandle });
  expect.soft(dom.text).toContain(ref);
  expect.soft(dom.text).toContain(biz.replyTime);

  // Only answers picked from our own lists (plus date, time and guests): none of the words the visitor
  // typed — the place, names, notes — so the confirmation can't carry a stranger's message.
  const typed = plan.answers
    .filter((a) => (a.f.type === 'text' || a.f.type === 'textarea') && a.f.id !== 'name')
    .map((a) => a.display.split('\n')[0].trim())
    .filter((s) => s && s !== firstName(client.name));
  if (/\s/.test(client.name.trim())) typed.push(client.name);
  for (const s of typed) {
    expect.soft(dom.text, `client email must not repeat the typed “${s}”`).not.toContain(s);
    expect.soft(e.text, `client plain text must not repeat the typed “${s}”`).not.toContain(s);
  }

  // Internal-only details stay out of the client's copy.
  const internal = ['Budget', 'Starting estimate', 'To quote', 'Price on request', 'Quick actions', 'Received', 'Hit reply', OWNER_INBOX, 'google.com/maps', `sms:${client.e164}`];
  for (const s of internal) {
    expect.soft(dom.text, `client email must not show “${s}”`).not.toContain(s);
    expect.soft(e.html, `client email HTML must not contain “${s}”`).not.toContain(s);
  }
  const budget = plan.byId.get('budget')?.display;
  if (budget && !summary.some(([, v]) => v.includes(budget))) expect.soft(dom.text, 'client email must not show the budget').not.toContain(budget);
  for (const s of [ref, biz.phoneDisplay, biz.instagramHandle, biz.replyTime, schema.deposit.summary, ...(hasSecurity ? [schema.securityDeposit.summary, security] : []), deposit, `${biz.url.replace(/\/$/, '')}/policies`, lastTitle])
    expect.soft(e.text, `client plain text has “${s}”`).toContain(s);
  for (const [label, value] of summary) expect.soft(e.text, `client plain text summary: ${label}`).toContain(`\n${label}: ${value}\n`);
  expect.soft(e.text, 'client plain text: We’ve received your …').toContain(`We’ve received your ${requestNoun(plan)}. Here’s a summary:`);
}

/** The locked occasion's radio (hidden once Proposals or a hamper is chosen, so not found by role). */
const occasionRadio = (page: Page, id: string) => page.locator(`input[name="occasion"][value="${id}"]`);
const serviceRadio = (page: Page, id: string) => page.locator(`input[name="service"][value="${id}"]`);

// ═════════════════════════════════════ Tests ═════════════════════════════════════

test('the occasion list matches /api/form-schema.json', async () => {
  expect([...schema.occasions.map((o) => o.id)].sort()).toEqual([...OCCASION_IDS].sort());
});

for (const occId of OCCASION_IDS) {
  test(`books “${occId}” through the real form; both emails are right`, async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const plan = buildPlan(occId);
    await openBook(page);
    const { ref } = await completeBooking(page, plan);
    const { business, client } = await emailsFor(ref);
    await checkBusinessEmail(context, plan, ref, business);
    await checkClientEmail(context, plan, ref, client);
    for (const kind of SCREENSHOT[occId] ?? []) await screenshotEmail(context, (kind === 'business' ? business : client).html, `${occId}-${kind}`, testInfo);
    testInfo.annotations.push({ type: 'ref', description: `${ref} · ${plan.answers.length} answers` });
  });
}

test('special characters survive the trip: escaping, line breaks and UTF-8 names', async ({ page, context }) => {
  const plan = buildPlan('birthday', { clientIndex: 2 }); // Zoë O'Brien
  const notes = plan.byId.get('notes')!;
  notes.value = 'Gate code <b>1234</b> & "ring" twice.\nTexts are best — thanks!';
  notes.display = notes.value;
  await openBook(page);
  const { ref } = await completeBooking(page, plan);
  const { business, client } = await emailsFor(ref);
  expect(business.html).toContain('Gate code &lt;b&gt;1234&lt;/b&gt; &amp; &quot;ring&quot; twice.<br>');
  expect(business.html).not.toContain('<b>1234</b>');
  expect(business.headers['subject']).toContain('Zoë O.');
  expect(client.headers['subject']).toContain(ref);
  await checkBusinessEmail(context, plan, ref, business);
  await checkClientEmail(context, plan, ref, client);
});

test('deep link /book?occasion=birthday&package=celebration is pre-filled and books', async ({ page, context }) => {
  const plan = buildPlan('birthday', { pkg: 'celebration', requiredOnly: true });
  await openBook(page, '?occasion=birthday&package=celebration');
  await expect(fieldBox(page, 'occasion').getByRole('radio', { name: 'Birthday', exact: true })).toBeChecked();
  await expect(page.locator('input[name="package"][value="celebration"]')).toBeChecked();
  await expect(page.locator('[data-estimate-total]')).toHaveText(`Starting at ${money(plan.pkg?.priceFrom ?? 0)}`);
  const { ref } = await completeBooking(page, plan, { preselected: true });
  const { business, client } = await emailsFor(ref);
  await checkBusinessEmail(context, plan, ref, business);
  await checkClientEmail(context, plan, ref, client);
});

test('every occasion page CTA opens /book with that occasion and its package chosen', async ({ page, context }) => {
  test.setTimeout(120_000);
  for (const occ of schema.occasions.filter((o) => o.id !== 'other')) {
    const slug = URL_SLUGS[occ.id];
    expect(slug, `urlSlug for ${occ.id}`).toBeTruthy();
    await page.goto(`/${slug}`);
    const cta = page.locator('a[data-track-location="occasion_hero"]');
    await expect(cta, `${occ.id} hero CTA`).toHaveAttribute('href', `/book?occasion=${occ.id}&package=${occ.recommendedPackage}`);
  }
  // Then actually tap one and book: Proposal.
  const plan = buildPlan('proposal', { requiredOnly: true, clientIndex: 1 });
  await page.goto(`/${URL_SLUGS.proposal}`);
  await page.locator('a[data-track-location="occasion_hero"]').click();
  await page.waitForURL('**/book?occasion=proposal&package=proposal-romance');
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  // A proposal link means Proposals, which locks (and hides) the occasion.
  await expect(serviceRadio(page, 'proposals')).toBeChecked();
  await expect(occasionRadio(page, 'proposal')).toBeChecked();
  await expect(fieldBox(page, 'occasion')).toBeHidden();
  await expect(page.locator('input[name="package"][value="proposal-romance"]')).toBeChecked();
  const { ref } = await completeBooking(page, plan, { preselected: true });
  const { business, client } = await emailsFor(ref);
  await checkBusinessEmail(context, plan, ref, business);
  await checkClientEmail(context, plan, ref, client);
});

test('a refresh mid-form keeps every answer, and the email still has them', async ({ page, context }) => {
  const plan = buildPlan('proposal', { clientIndex: 3 });
  const val = (id: string) => plan.byId.get(id)!.value as string;
  await openBook(page);
  await fillStep(page, plan, 1);
  await continueTo(page, 2);
  await fillStep(page, plan, 2);
  await continueTo(page, 3);
  // Part of step 3, the last field still focused (never blurred) when the page reloads.
  for (const id of ['partner_name', 'is_surprise', 'surprise_for', 'addons', 'arrival_plan']) await answer(page, plan.byId.get(id)!);
  await page.reload();
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  await expect(stepTitle(page, 3), 'back on the same step').toBeVisible();
  await expect(page.locator('#f-partner_name')).toHaveValue(val('partner_name'));
  await expect(fieldBox(page, 'is_surprise').getByRole('switch')).toBeChecked();
  await expect(page.locator('#f-surprise_for')).toHaveValue(val('surprise_for'));
  await expect(page.locator('#f-arrival_plan')).toHaveValue(val('arrival_plan'));
  for (const v of plan.byId.get('addons')!.value as string[]) await expect(page.locator(`[data-field="addons"] input[value="${v}"]`)).toBeChecked();
  // Earlier steps too.
  await page.locator('[data-back]').click();
  await expect(stepTitle(page, 2)).toBeVisible();
  for (const id of ['date', 'backup_date', 'start_time', 'guests_adults', 'location', 'area']) await expect(page.locator(`#f-${id}`)).toHaveValue(val(id));
  await expect(fieldBox(page, 'location_type').getByRole('radio', { name: val('location_type'), exact: true })).toBeChecked();
  await page.locator('[data-back]').click();
  await expect(serviceRadio(page, 'proposals')).toBeChecked();
  await expect(occasionRadio(page, 'proposal')).toBeChecked();
  // Finish what's left of step 3 and send.
  await continueTo(page, 2);
  await continueTo(page, 3);
  await fillStep(page, plan, 3, ['partner_name', 'is_surprise', 'surprise_for', 'addons', 'arrival_plan']);
  await continueTo(page, 4);
  await fillStep(page, plan, 4);
  // A refresh on Review & send also stays put.
  await continueTo(page, 5);
  await page.reload();
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  await expect(stepTitle(page, 5)).toBeVisible();
  const { ref } = await sendAndConfirm(page, plan);
  const { business, client } = await emailsFor(ref);
  await checkBusinessEmail(context, plan, ref, business);
  await checkClientEmail(context, plan, ref, client);
});

test('shortest path: Instagram bio link → sent proposal request (required answers only)', async ({ page }, testInfo) => {
  // Every deliberate action a person must take on their phone, counted as they happen.
  const log: { kind: 'tap' | 'type' | 'pick'; what: string; chars?: number }[] = [];
  const tap = async (l: Locator, what: string, how: 'click' | 'check' = 'click') => {
    await (how === 'check' ? l.check() : l.click());
    log.push({ kind: 'tap', what });
  };
  const type = async (l: Locator, text: string, what: string) => {
    await l.fill(text);
    log.push({ kind: 'type', what, chars: text.length });
  };
  const pick = async (l: Locator, value: string, what: string) => {
    await l.fill(value); // a native date/time wheel on a phone
    log.push({ kind: 'pick', what });
  };

  const plan = buildPlan('proposal', { requiredOnly: true, clientIndex: 0 });
  const v = (id: string) => plan.byId.get(id)!.value as string;
  // Required questions for this occasion, straight from the schema (so the count follows booking-form.yaml).
  const required = plan.answers.map((a) => a.f.id);

  await page.goto('/links'); // the Instagram bio link
  await tap(page.getByRole('link', { name: /Proposal picnics/ }), 'Proposal picnics (links page)');
  await page.waitForURL(`**/${URL_SLUGS.proposal}`);
  await tap(page.locator('a[data-track-location="occasion_hero"]'), 'Plan your proposal picnic');
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  // The link chose the service, the occasion and the package: nothing to tap on step 1.
  await expect(serviceRadio(page, 'proposals')).toBeChecked();
  await expect(occasionRadio(page, 'proposal')).toBeChecked();
  await expect(page.locator('input[name="package"][value="proposal-romance"]')).toBeChecked();
  await tap(primary(page), 'Continue');
  await expect(stepTitle(page, 2)).toBeVisible();
  await pick(page.locator('#f-date'), v('date'), 'Preferred date');
  await pick(page.locator('#f-start_time'), v('start_time'), 'Start time');
  for (let n = 0; n < Number(v('guests_adults')); n++) await tap(page.getByRole('button', { name: 'More adults' }), 'Adults +');
  await expect(page.locator('#f-guests_adults')).toHaveValue(v('guests_adults'));
  await tap(fieldBox(page, 'location_type').getByRole('radio', { name: v('location_type'), exact: true }), 'Where', 'check');
  await page.locator('#f-area').selectOption(v('area')); // a native select wheel on a phone
  log.push({ kind: 'pick', what: 'Which area?' });
  await type(page.locator('#f-location'), v('location'), 'Location');
  await tap(primary(page), 'Continue');
  await expect(stepTitle(page, 3)).toBeVisible();
  for (const a of plan.answers.filter((x) => x.g.step === 3)) await type(page.locator(`#f-${a.f.id}`), a.value as string, a.f.label);
  await tap(primary(page), 'Continue');
  await expect(stepTitle(page, 4)).toBeVisible();
  for (const id of ['name', 'phone', 'email']) await type(page.locator(`#f-${id}`), v(id), id);
  await tap(primary(page), 'Review your request');
  const { ref } = await (async () => {
    log.push({ kind: 'tap', what: 'Send booking request' });
    return sendAndConfirm(page, plan);
  })();
  expect(fs.existsSync(path.join(MAIL_DIR, `${ref}-business.eml`))).toBe(true);

  const taps = log.filter((l) => l.kind === 'tap').length;
  const typed = log.filter((l) => l.kind === 'type');
  const picks = log.filter((l) => l.kind === 'pick').length;
  const chars = typed.reduce((s, l) => s + (l.chars ?? 0), 0);
  // Rough phone timing: tap 1.5 s, native picker 6 s, typed field 2 s + 0.4 s/char (≈ 25 wpm thumbs),
  // 4 s to read each screen (3 pages + 4 form screens + thank-you).
  const seconds = Math.round(taps * 1.5 + picks * 6 + typed.length * 2 + chars * 0.4 + 8 * 4);
  const autofill = Math.round(seconds - ['name', 'phone', 'email'].reduce((s, id) => s + v(id).length * 0.4, 0));
  const summary =
    `${log.length} interactions = ${taps} taps + ${picks} pickers + ${typed.length} typed fields (${chars} chars) · ` +
    `required answers: ${required.length} (${required.join(', ')}) · est. ≈ ${seconds}s typed by hand, ≈ ${autofill}s with contact autofill · goal < 180s`;
  testInfo.annotations.push({ type: 'shortest-path', description: summary });
  console.log(`[shortest path] ${summary}\n  ${log.map((l) => `${l.kind}: ${l.what}`).join('\n  ')}`);
  expect(seconds, 'Instagram → sent in under 3 minutes on a phone').toBeLessThan(180);
});

test('room decor: a birthday styled in a hotel room — the room (type · address) reaches the owner, only the type the client', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const plan = buildPlan('birthday', { service: 'room-decor', clientIndex: 1, overrides: { area: 'Toronto' } });
  const roomType = plan.byId.get('room_type')!;
  const roomAddress = plan.byId.get('room_address')!;
  expect(plan.pkg, 'room decor has no package').toBeNull();
  for (const id of ['package', 'guests_adults', 'guests_kids', 'location_type', 'location', 'picnic_style', 'delivery_slot', 'delivery_address']) expect(plan.byId.has(id), `${id} does not apply`).toBe(false);
  // A surprise in a room: how they arrive and whether the team hides are asked (a showIf list that includes room decor).
  for (const id of ['start_time', 'area', 'is_surprise', 'surprise_for', 'arrival_plan', 'team_presence', 'letter_board', 'addons', 'food_allergies']) expect(plan.byId.has(id), `${id} applies`).toBe(true);

  await openBook(page);
  await expect(fieldBox(page, 'package')).toBeHidden(); // no service chosen yet
  const { ref } = await completeBooking(page, plan);
  await expect(page.locator('[data-thanks-occasion]')).toContainText(plan.service.name.toLowerCase());
  const { business, client } = await emailsFor(ref);
  await checkBusinessEmail(context, plan, ref, business);
  await checkClientEmail(context, plan, ref, client);

  const date = plan.byId.get('date')!.display;
  expect(business.headers['subject']).toBe(`New booking: ${plan.service.name} · ${plan.occ.name} · ${date} · ${shortName(plan.client.name)}`);
  expect(client.headers['subject']).toBe(`We’ve received your request (${ref})`);
  const biz = await readEmail(context, business.html);
  const cli = await readEmail(context, client.html);
  expect(biz.sections[0].rows[0]).toEqual(['Service', plan.service.name]);
  expect(biz.sections[0].rows).toContainEqual(['Area', 'Toronto']);
  expect(biz.sections[0].rows).toContainEqual(['Location', `${roomType.display} · ${roomAddress.display}`]);
  expect(biz.sections[0].rows).toContainEqual(['Start time', plan.byId.get('start_time')!.display]);
  for (const label of ['Package', 'Guests', 'When it arrives']) expect(biz.sections[0].rows.map(([l]) => l), `no “${label}” row`).not.toContain(label);
  expect(business.text).toContain(`\nLocation: ${roomType.display} · ${roomAddress.display}\n`);
  expect(business.text).toContain('STARTING ESTIMATE: To be quoted');
  expect(cli.sections[0].rows[0]).toEqual(['Service', plan.service.name]);
  expect(cli.sections[0].rows).toContainEqual(['Area', 'Toronto']);
  expect(cli.sections[0].rows).toContainEqual(['Location', roomType.display]);
  for (const part of [client.html, client.text]) {
    expect(part, 'the client never sees the room address').not.toContain(roomAddress.display);
    expect(part).not.toContain('123 Front St');
  }
  expect(client.text).toContain(`\nLocation: ${roomType.display}\n`);
  await screenshotEmail(context, business.html, 'room-decor-business', testInfo);
  testInfo.annotations.push({ type: 'ref', description: `${ref} · ${plan.answers.length} answers` });
});

test('birthday hamper: the occasion is locked, delivery replaces the picnic questions, and the address stays with the owner', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  // Anywhere "else" in the GTA, so the estimate's travel line is "quoted by area".
  const plan = buildPlan('birthday', { service: 'birthday-hampers', clientIndex: 3, overrides: { area: AREA_OTHER } });
  const slot = plan.byId.get('delivery_slot')!;
  const address = plan.byId.get('delivery_address')!;
  expect(plan.pkg, 'a hamper has no package').toBeNull();
  expect(plan.byId.get('occasion')!.value, 'locked to Birthday').toBe('birthday');
  for (const id of ['package', 'guests_adults', 'guests_kids', 'start_time', 'location_type', 'location', 'room_type', 'room_address', 'picnic_style', 'letter_board', 'addons', 'food_allergies', 'arrival_plan', 'team_presence']) {
    expect(plan.byId.has(id), `${id} does not apply`).toBe(false);
  }
  for (const id of ['delivery_slot', 'delivery_address', 'area', 'birthday_name', 'is_surprise', 'surprise_for', 'card_message', 'dietary']) expect(plan.byId.has(id), `${id} applies`).toBe(true);

  await openBook(page);
  await serviceRadio(page, 'birthday-hampers').check();
  await expect(occasionRadio(page, 'birthday')).toBeChecked(); // answered by the browser…
  await expect(fieldBox(page, 'occasion')).toBeHidden(); // …and hidden
  await expect(fieldBox(page, 'package')).toBeHidden();
  const { ref } = await completeBooking(page, plan);
  await expect(page.locator('[data-thanks-occasion]')).toContainText(plan.service.name.toLowerCase());
  const { business, client } = await emailsFor(ref);
  await checkBusinessEmail(context, plan, ref, business);
  await checkClientEmail(context, plan, ref, client);

  const date = plan.byId.get('date')!.display;
  expect(business.headers['subject']).toBe(`New booking: ${plan.service.name} · ${plan.occ.name} · ${date} · ${shortName(plan.client.name)}`);
  expect(client.headers['subject']).toBe(`We’ve received your request (${ref})`);
  const biz = await readEmail(context, business.html);
  const cli = await readEmail(context, client.html);
  expect(biz.sections[0].rows[0]).toEqual(['Service', plan.service.name]);
  expect(biz.sections[0].rows[1]).toEqual(['Occasion', plan.occ.name]);
  expect(biz.sections[0].rows).toContainEqual(['When it arrives', slot.display]);
  expect(biz.sections[0].rows).toContainEqual(['Location', address.display]);
  expect(biz.sections[0].rows).toContainEqual(['Area', AREA_OTHER]);
  for (const label of ['Package', 'Guests', 'Start time']) expect(biz.sections[0].rows.map(([l]) => l), `no “${label}” row`).not.toContain(label);
  expect(business.text).toContain(`\nWhen it arrives: ${slot.display}\n`);
  expect(business.text).toContain(`\nLocation: ${address.display}\n`);
  expect(business.text).toContain('STARTING ESTIMATE: To be quoted');
  expect(business.text).toContain('To quote: Travel: quoted by area');
  expect(cli.sections[0].rows[0]).toEqual(['Service', plan.service.name]);
  expect(cli.sections[0].rows).toContainEqual(['When it arrives', slot.display]);
  expect(cli.sections[0].rows).toContainEqual(['Area', AREA_OTHER]);
  expect(cli.sections[0].rows.map(([l]) => l), 'no Location row for the client (only free text would fit)').not.toContain('Location');
  for (const part of [client.html, client.text]) {
    expect(part, 'the client never sees the delivery address').not.toContain(address.display);
    expect(part).not.toContain('Lakeshore');
    expect(part).not.toContain('Location:');
  }
  expect(client.text).toContain('We deliver your hamper');
  await screenshotEmail(context, client.html, 'birthday-hamper-client', testInfo);
  testInfo.annotations.push({ type: 'ref', description: `${ref} · ${plan.answers.length} answers` });
});

test('a request the spam check flags still reaches the owner, marked “[Possible spam]”, with no client confirmation', async ({ page, context }) => {
  const plan = buildPlan('anniversary', { clientIndex: 1 });
  await openBook(page);
  // What a password manager's autofill might do (and what bots do): fill the hidden "leave this empty" field.
  await page.locator('input[name="company_website"]').evaluate((el: HTMLInputElement) => {
    el.value = 'https://example.com';
  });
  // The visitor gets exactly the usual reply and thank-you page (checked in sendAndConfirm).
  const { ref } = await completeBooking(page, plan);
  const biz = path.join(MAIL_DIR, `${ref}-business.eml`);
  await expect.poll(() => fs.existsSync(biz), { message: `${ref}: business .eml in tests/.mail-live`, timeout: 10_000 }).toBe(true);
  await checkBusinessEmail(context, plan, ref, parseEml(biz), { spam: 'the hidden “leave this empty” field was filled in' });
  // php -S has no fastcgi_finish_request, so a confirmation would have been written before the reply.
  expect(fs.existsSync(path.join(MAIL_DIR, `${ref}-client.eml`)), 'no confirmation mailed for a flagged request').toBe(false);
});
