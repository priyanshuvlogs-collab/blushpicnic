// Shared helpers for the booking-form tests. The form is data-driven, so tests read the same schema the
// page uses (/api/form-schema.json) instead of hard-coding questions.
import { expect, type APIRequestContext, type Page, type Request, type Locator } from '@playwright/test';
import type { FormSchema, ResolvedField, ResolvedGroup } from '../../src/lib/form';

export type { FormSchema, ResolvedField, ResolvedGroup };
export type Occasion = FormSchema['occasions'][number];
export type Fields = Map<string, string[]>;

export const BOOK_ENDPOINT = '**/api/book.php';

export async function getSchema(request: APIRequestContext): Promise<FormSchema> {
  const res = await request.get('/api/form-schema.json');
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as FormSchema;
}

/** YYYY-MM-DD in Toronto, `days` from today. */
export function torontoDate(days = 0): string {
  const now = new Date(Date.now() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function groupApplies(g: ResolvedGroup, occ: Occasion): boolean {
  return g.appliesTo.includes('*') || g.appliesTo.includes(occ.formGroup);
}

/** Does a question show for this occasion (ignoring showIf answers, which start "off")? */
export function fieldShows(g: ResolvedGroup, f: ResolvedField, occ: Occasion): boolean {
  if (!groupApplies(g, occ)) return false;
  if (f.onlyFor && !f.onlyFor.includes(occ.id)) return false;
  if (f.showIf) return false;
  return true;
}

export const stepFields = (schema: FormSchema, step: number, occ: Occasion) =>
  schema.groups.filter((g) => g.step === step).flatMap((g) => g.fields.filter((f) => fieldShows(g, f, occ)).map((f) => ({ g, f })));

/** A valid sample answer for a question. */
export function sampleValue(f: ResolvedField, step: number): string {
  const clip = (s: string) => (f.maxLength ? s.slice(0, f.maxLength) : s);
  switch (f.type) {
    case 'email':
      return 'maya@example.com';
    case 'tel':
      return '647 555 0123';
    case 'number':
      return String(Math.min(f.max ?? 2, Math.max(f.min ?? 1, 2)));
    case 'date':
      return step === 2 ? torontoDate(30) : '2026-06-20';
    case 'time':
      return '16:30';
    case 'month':
      return '2027-03';
    case 'textarea':
      return clip('Test notes for the picnic');
    default:
      return f.id === 'name' ? 'Maya Test' : clip(`Test ${f.label}`.replace(/[?:]/g, ''));
  }
}

/** Answer one question with a sample value; returns what should be submitted. */
export async function answer(page: Page, f: ResolvedField, step: number): Promise<string | string[]> {
  const field = page.locator(`[data-field="${f.id}"]`);
  switch (f.type) {
    case 'radio':
    case 'select': {
      const radios = field.locator('input[type="radio"]');
      if (await radios.count()) {
        await radios.first().check();
        return (await radios.first().getAttribute('value')) ?? '';
      }
      const value = f.options![0].value;
      await field.locator('select').selectOption(value);
      return value;
    }
    case 'checkboxes': {
      const box = field.locator('input[type="checkbox"]').first();
      await box.check();
      return [(await box.getAttribute('value')) ?? ''];
    }
    case 'toggle':
      await field.locator('input').check();
      return 'yes';
    default: {
      const v = sampleValue(f, step);
      await page.locator(`#f-${f.id}`).fill(v);
      return v;
    }
  }
}

export async function openBooking(page: Page, query = '') {
  await page.goto(`/book${query}`);
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
}

export const stepHeading = (page: Page, name: string | RegExp) => page.getByRole('heading', { level: 2, name });
export const primaryButton = (page: Page) => page.locator('[data-primary]');

export async function next(page: Page) {
  await primaryButton(page).click();
}

export async function choose(page: Page, occasion: string, pkg: string) {
  await page.locator(`input[name="occasion"][value="${occasion}"]`).check();
  await page.locator(`input[name="package"][value="${pkg}"]`).check();
}

/** Fill every required question that shows on a step. */
export async function fillRequired(page: Page, schema: FormSchema, step: number, occ: Occasion) {
  const filled: Record<string, string | string[]> = {};
  for (const { f } of stepFields(schema, step, occ)) {
    if (!f.required || f.id === 'occasion' || f.id === 'package') continue;
    filled[f.id] = await answer(page, f, step);
  }
  return filled;
}

/** Parse a multipart/form-data request body into name → values. */
export async function postedFields(req: Request): Promise<Fields> {
  const body = req.postDataBuffer();
  const type = req.headers()['content-type'] ?? '';
  const fd = await new Response(body ? new Uint8Array(body) : '', { headers: { 'content-type': type } }).formData();
  const out: Fields = new Map();
  for (const [k, v] of fd.entries()) out.set(k, [...(out.get(k) ?? []), String(v)]);
  return out;
}

export interface Captured {
  fields: Fields;
  headers: Record<string, string>;
}

/** Mock api/book.php. `reply` decides the response for each call (1-based). */
export async function mockBooking(
  page: Page,
  reply: (call: number, fields: Fields) => { status: number; body?: unknown } | 'abort' = () => ({ status: 200, body: { ok: true, ref: 'BP-TEST42' } }),
): Promise<Captured[]> {
  const calls: Captured[] = [];
  await page.route(BOOK_ENDPOINT, async (route) => {
    const req = route.request();
    const fields = await postedFields(req);
    calls.push({ fields, headers: req.headers() });
    const r = reply(calls.length, fields);
    if (r === 'abort') return route.abort('internetdisconnected');
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body ?? {}) });
  });
  return calls;
}

/** The estimate summary the visitor can currently see (aside on desktop, bar on mobile). */
export const visibleEstimateTotal = (page: Page): Locator =>
  page.locator('.bk-est-panel .bk-est-total, .bk-est-panel .bk-est-empty, [data-estimate-total]').filter({ visible: true }).first();

/** Full estimate breakdown text (rendered in both the aside and the mobile sheet). */
export async function estimateText(page: Page): Promise<string> {
  return (await page.locator('#bk-est-sheet').textContent()) ?? '';
}

/** Record analytics events (kept in Node, so they survive navigating to /thank-you). */
export async function recordAnalytics(page: Page): Promise<[string, Record<string, unknown>][]> {
  const log: [string, Record<string, unknown>][] = [];
  await page.exposeFunction('__bpRecord', (e: string, p: Record<string, unknown>) => {
    log.push([e, p ?? {}]);
  });
  await page.addInitScript(() => {
    // Wrap whatever the analytics loader assigns to window.bpTrack.
    const w = window as unknown as { __bpRecord: (e: string, p: unknown) => void };
    let inner: ((e: string, p?: unknown) => void) | undefined;
    Object.defineProperty(window, 'bpTrack', {
      configurable: true,
      get: () => (e: string, p?: unknown) => {
        w.__bpRecord(e, p ?? {});
        inner?.(e, p);
      },
      set: (v) => {
        inner = v;
      },
    });
  });
  return log;
}

/** Go from step 1 to the review step for an occasion, answering only what's required. */
export async function completeToReview(page: Page, schema: FormSchema, occasionId: string, pkg?: string) {
  const occ = schema.occasions.find((o) => o.id === occasionId)!;
  await choose(page, occ.id, pkg ?? occ.recommendedPackage ?? 'not-sure');
  await next(page);
  const answers: Record<string, string | string[]> = {};
  for (let step = 2; step <= schema.steps.length; step++) {
    await expect(stepHeading(page, new RegExp(escapeRe(schema.steps[step - 1])))).toBeVisible();
    Object.assign(answers, await fillRequired(page, schema, step, occ));
    await next(page);
  }
  await expect(stepHeading(page, /Review & send/)).toBeVisible();
  return { occ, answers };
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
