// Booking form end-to-end tests. /api/book.php is mocked with page.route(), and the questions are read
// from /api/form-schema.json at test time, so adding an occasion or question needs no test changes.
import { test, expect } from '@playwright/test';
import {
  getSchema,
  openBooking,
  choose,
  next,
  stepHeading,
  fillRequired,
  groupApplies,
  fieldShows,
  mockBooking,
  completeToReview,
  visibleEstimateTotal,
  estimateText,
  recordAnalytics,
  torontoDate,
  type FormSchema,
} from './booking-helpers';

const money = (n: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n).replace('CA', '');

const sendButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Send booking request' });
const fieldError = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-field="${id}"] [data-field-error]`);

let schema: FormSchema;
test.beforeAll(async ({ request }) => {
  schema = await getSchema(request);
});

test('completes a booking for every occasion, asking the right questions', async ({ page }) => {
  test.setTimeout(360_000);
  const ids = schema.occasions.map((o) => o.id);
  expect(ids).toContain('other');
  expect(ids.length).toBeGreaterThanOrEqual(17); // 16 occasions + "Something else"

  const calls = await mockBooking(page, () => ({ status: 200, body: { ok: true, ref: 'BP-TEST42' } }));

  for (const occ of schema.occasions) {
    await test.step(`${occ.name} (${occ.id})`, async () => {
      const pkg = occ.recommendedPackage ?? 'not-sure';
      await openBooking(page);
      await choose(page, occ.id, pkg);
      await next(page);

      const answers: Record<string, string | string[]> = {};
      await expect(stepHeading(page, /When & where/)).toBeVisible();
      Object.assign(answers, await fillRequired(page, schema, 2, occ));
      await next(page);

      // Step 3 shows exactly the questions for this occasion.
      await expect(stepHeading(page, /Details & style/)).toBeVisible();
      for (const g of schema.groups.filter((x) => x.step === 3)) {
        const group = page.locator(`[data-group="${g.id}"]`);
        if (groupApplies(g, occ)) await expect(group, `group ${g.id}`).toBeVisible();
        else await expect(group, `group ${g.id}`).toBeHidden();
        for (const f of g.fields) {
          const el = page.locator(`[data-field="${f.id}"]`);
          if (fieldShows(g, f, occ)) await expect(el, `field ${f.id}`).toBeVisible();
          else await expect(el, `field ${f.id}`).toBeHidden();
        }
      }
      Object.assign(answers, await fillRequired(page, schema, 3, occ));
      await next(page);

      await expect(stepHeading(page, /Your details/)).toBeVisible();
      Object.assign(answers, await fillRequired(page, schema, 4, occ));
      await next(page);

      await expect(stepHeading(page, /Review & send/)).toBeVisible();
      await expect(page.locator('[data-review-list]')).toContainText(occ.name);

      const before = calls.length;
      await sendButton(page).click();
      await page.waitForURL('**/thank-you');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you, Maya.');
      await expect(page.locator('[data-thanks-ref]')).toContainText('BP-TEST42');
      expect(calls.length).toBe(before + 1);

      const { fields, headers } = calls[calls.length - 1];
      expect(headers['accept']).toContain('application/json');
      expect(fields.get('occasion')).toEqual([occ.id]);
      expect(fields.get('package')).toEqual([pkg]);
      for (const [id, v] of Object.entries(answers)) {
        if (Array.isArray(v)) expect(fields.get(`${id}[]`), id).toEqual(v);
        else expect(fields.get(id), id).toEqual([v]);
      }
      // Questions that don't apply are disabled, so they're never sent.
      for (const g of schema.groups)
        for (const f of g.fields)
          if (!fieldShows(g, f, occ)) expect(fields.has(f.id) || fields.has(`${f.id}[]`), `${f.id} should not be sent`).toBe(false);
      // Anti-spam fields.
      expect(fields.get('company_website')).toEqual(['']);
      const ts = Number(fields.get('_ts')?.[0]);
      expect(ts).toBeGreaterThan(Date.now() - 3_600_000);
      expect(ts).toBeLessThanOrEqual(Date.now());
      expect(fields.get('_page')).toEqual(['/book']);
    });
  }
});

test('deep links pre-fill the form, win over saved answers and ignore unknown ids', async ({ page, context }) => {
  const proposal = schema.packages.find((p) => p.id === 'proposal-romance')!;
  await openBooking(page, '?occasion=proposal&package=proposal-romance');
  await expect(page.locator('input[name="occasion"][value="proposal"]')).toBeChecked();
  await expect(page.locator('input[name="package"][value="proposal-romance"]')).toBeChecked();
  await expect(page.locator('[data-suggested-for="proposal-romance"]')).toBeVisible();
  await expect(visibleEstimateTotal(page)).toContainText(money(proposal.priceFrom!));

  // A new deep link beats what was saved...
  await choose(page, 'birthday', 'signature');
  await openBooking(page, '?occasion=anniversary&package=celebration');
  await expect(page.locator('input[name="occasion"][value="anniversary"]')).toBeChecked();
  await expect(page.locator('input[name="package"][value="celebration"]')).toBeChecked();
  // ...but reloading the same link keeps changes made since.
  await page.locator('input[name="occasion"][value="family"]').check();
  await page.reload();
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  await expect(page.locator('input[name="occasion"][value="family"]')).toBeChecked();

  // Unknown ids are ignored.
  const other = await context.newPage();
  await openBooking(other, '?occasion=not-a-thing&package=platinum');
  await expect(other.locator('input[name="occasion"]:checked')).toHaveCount(0);
  await expect(other.locator('input[name="package"]:checked')).toHaveCount(0);
});

test('restores answers, the current step and the start time after a reload', async ({ page }) => {
  await openBooking(page);
  await choose(page, 'birthday', 'celebration');
  await next(page);
  await expect(page.locator('#bk-step-2-title')).toBeFocused();
  const date = torontoDate(21);
  await page.fill('#f-date', date);
  await page.fill('#f-location', 'High Park');
  const startedAt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bp-booking-v1')!).startedAt);

  await page.reload();
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  await expect(stepHeading(page, /When & where/)).toBeVisible();
  await expect(page.locator('#f-date')).toHaveValue(date);
  await expect(page.locator('#f-location')).toHaveValue('High Park');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bp-booking-v1')!).startedAt)).toBe(startedAt);
  expect(await page.locator('input[name="_ts"]').inputValue()).toBe(String(startedAt));

  await page.locator('[data-back]').click();
  await expect(stepHeading(page, /Occasion & package/)).toBeVisible();
  await expect(page.locator('input[name="occasion"][value="birthday"]')).toBeChecked();
  await expect(page.locator('input[name="package"][value="celebration"]')).toBeChecked();
});

test('validation messages say how to fix each problem', async ({ page }) => {
  await openBooking(page);
  await next(page);
  const summary1 = page.locator('[data-step="1"] [data-error-summary]');
  await expect(summary1).toBeVisible();
  await expect(summary1).toContainText('Choose what we’re celebrating');
  await expect(summary1).toContainText('Choose a package, or “Help me choose”');
  const firstOccasion = page.locator('input[name="occasion"]').first();
  await expect(firstOccasion).toBeFocused();
  await expect(firstOccasion).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-field="occasion"]')).toHaveAttribute('aria-describedby', /f-occasion-error/);

  await choose(page, 'picnic-date', 'signature');
  await expect(summary1).toBeHidden();
  await next(page);

  // Step 2: dates can't be in the past (Toronto time), numbers must be in range, required fields say what's missing.
  await expect(page.locator('#f-date')).toHaveAttribute('min', torontoDate(0));
  await page.fill('#f-date', torontoDate(-3));
  await page.fill('#f-guests_adults', '0');
  await next(page);
  await expect(fieldError(page, 'date')).toHaveText('Enter a date that’s today or later');
  await expect(fieldError(page, 'guests_adults')).toContainText('Enter a number from 1 to');
  await expect(fieldError(page, 'start_time')).toContainText('Enter a preferred start time');
  await expect(page.locator('#f-date')).toBeFocused();
  await expect(page.locator('#f-date')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f-date')).toHaveAttribute('aria-describedby', /f-date-error/);
  await page.locator('[data-step="2"] [data-error-summary] a', { hasText: 'start time' }).click();
  await expect(page.locator('#f-start_time')).toBeFocused();

  await page.fill('#f-date', torontoDate(10));
  await expect(fieldError(page, 'date')).toBeHidden(); // fixed errors clear as you type
  await page.fill('#f-start_time', '15:00');
  await page.fill('#f-guests_adults', '2');
  await page.locator('input[name="location_type"]').first().check();
  await page.fill('#f-location', 'Woodbine Beach');
  await next(page);
  await next(page); // step 3 has nothing required for a picnic date

  // Step 4: phone and email are checked on blur and on Next.
  await expect(stepHeading(page, /Your details/)).toBeVisible();
  await page.fill('#f-name', 'Maya');
  await page.fill('#f-phone', '12');
  await page.locator('#f-phone').press('Tab');
  await expect(fieldError(page, 'phone')).toHaveText('Enter a phone number with area code, e.g. 647 555 0123');
  await page.fill('#f-email', 'maya@example');
  await next(page);
  await expect(fieldError(page, 'email')).toHaveText('Enter an email address like name@example.com');
  await expect(page.locator('[data-step="4"] [data-error-summary]')).toContainText('2 things to fix');
  await expect(page.locator('#f-phone')).toBeFocused();

  await page.fill('#f-phone', '(647) 555-0123');
  await page.fill('#f-email', 'maya@example.com');
  await next(page);
  await expect(stepHeading(page, /Review & send/)).toBeVisible();
});

test('letter board message has a live word counter and a word limit', async ({ page }) => {
  const max = schema.letterBoardMaxWords;
  const occ = schema.occasions.find((o) => o.id === 'birthday')!;
  await openBooking(page);
  await choose(page, occ.id, 'signature');
  await next(page);
  await fillRequired(page, schema, 2, occ);
  await next(page);
  await fillRequired(page, schema, 3, occ);

  const words = Array.from({ length: max + 2 }, (_, i) => `word${i + 1}`).join(' ');
  const counter = page.locator('[data-word-count="letter_board"]');
  await page.fill('#f-letter_board', words);
  await expect(counter).toHaveText(`${max + 2} of ${max} words`);
  await expect(counter).toHaveClass(/is-over/);
  await next(page);
  await expect(fieldError(page, 'letter_board')).toHaveText(`Keep it to ${max} words or fewer — it’s ${max + 2} now`);
  await expect(stepHeading(page, /Details & style/)).toBeVisible();

  await page.fill('#f-letter_board', 'Happy 30th Maya');
  await expect(counter).toHaveText(`3 of ${max} words`);
  await expect(counter).not.toHaveClass(/is-over/);
  await expect(fieldError(page, 'letter_board')).toBeHidden();
  await next(page);
  await expect(stepHeading(page, /Your details/)).toBeVisible();
});

test('live estimate adds extra guests and add-ons, and never prices what it doesn’t know', async ({ page }) => {
  const sig = schema.packages.find((p) => p.id === 'signature')!;
  const cel = schema.packages.find((p) => p.id === 'celebration')!;
  expect(sig.extraGuestPrice).not.toBeNull();

  await openBooking(page);
  await expect(visibleEstimateTotal(page)).toContainText(/Choose a package/);
  await choose(page, 'birthday', 'signature');
  await next(page);
  await page.fill('#f-guests_adults', '3');
  await page.fill('#f-guests_kids', '1');
  // Signature for 4 guests: priceFrom + 2 extra guests × extraGuestPrice (today: $375 + 2 × $35 = $445).
  const expected = sig.priceFrom! + (4 - sig.guestsIncluded!) * sig.extraGuestPrice!;
  await expect(visibleEstimateTotal(page)).toContainText(money(expected));
  const text = await estimateText(page);
  expect(text).toContain(`2 extra guests × ${money(sig.extraGuestPrice!)}`);
  expect(text).toContain(money(2 * sig.extraGuestPrice!));
  expect(text).toContain('Estimate only — starting price before HST.');
  expect(text).toContain('Prices vary by location');
  expect(text).toMatch(/\$\d+ deposit holds your date \(\d+% for larger events\)/);

  // Mobile: the compact bar expands to show the breakdown.
  const toggle = page.locator('[data-estimate-toggle]');
  if (await toggle.isVisible()) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#bk-est-sheet')).toContainText('extra guests');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }

  // Celebration above its guest range: larger groups are quoted, never guessed.
  await page.locator('[data-back]').click();
  await page.locator('input[name="package"][value="celebration"]').check();
  await next(page);
  await page.fill('#f-guests_adults', String((cel.guestsMax ?? cel.guestsIncluded!) + 2));
  await page.fill('#f-guests_kids', '');
  await expect(visibleEstimateTotal(page)).toContainText(money(cel.priceFrom!));
  await expect.poll(() => estimateText(page)).toMatch(/larger groups quoted/i);

  // Add-ons with no published price are listed as "price on request" and not added.
  await page.fill('#f-start_time', '12:00');
  await page.fill('#f-date', torontoDate(14));
  await page.locator('input[name="location_type"]').first().check();
  await page.fill('#f-location', 'Mississauga');
  await next(page);
  const onRequest = schema.addons.find((a) => a.price === null);
  if (onRequest) {
    await page.locator(`input[name="addons[]"][value="${onRequest.id}"]`).check();
    await expect.poll(() => estimateText(page)).toContain(onRequest.name);
    expect(await estimateText(page)).toContain('Price on request');
    await expect(visibleEstimateTotal(page)).toContainText(money(cel.priceFrom!));
  }

  // "Help me choose" → we recommend a package.
  await page.locator('[data-back]').click();
  await page.locator('[data-back]').click();
  await page.locator('input[name="package"][value="not-sure"]').check();
  await expect(visibleEstimateTotal(page)).toContainText('We’ll recommend a package');
});

test('a 422 from the server shows the errors on the right fields', async ({ page }) => {
  const calls = await mockBooking(page, (n) =>
    n === 1
      ? { status: 422, body: { ok: false, message: 'Please check your answers.', errors: { email: 'We couldn’t verify this email — please check it' } } }
      : { status: 200, body: { ok: true, ref: 'BP-OK422' } },
  );
  await openBooking(page);
  await completeToReview(page, schema, 'anniversary');
  await sendButton(page).click();

  await expect(stepHeading(page, /Your details/)).toBeVisible();
  await expect(fieldError(page, 'email')).toHaveText('We couldn’t verify this email — please check it');
  await expect(page.locator('#f-email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f-email')).toBeFocused();
  await expect(page.locator('[data-step="4"] [data-error-summary]')).toContainText('We couldn’t verify this email');

  // The server's message stays until the answer changes.
  await next(page);
  await expect(stepHeading(page, /Your details/)).toBeVisible();
  await page.fill('#f-email', 'maya.real@example.com');
  await next(page);
  await sendButton(page).click();
  await page.waitForURL('**/thank-you');
  await expect(page.locator('[data-thanks-ref]')).toContainText('BP-OK422');
  expect(calls).toHaveLength(2);
  expect(calls[1].fields.get('email')).toEqual(['maya.real@example.com']);
});

test('server and network errors keep every answer and offer a text-us fallback', async ({ page }) => {
  const calls = await mockBooking(page, (n) => (n === 1 ? { status: 500, body: { ok: false } } : n === 2 ? 'abort' : { status: 200, body: { ok: true, ref: 'BP-RETRY1' } }));
  await openBooking(page);
  await completeToReview(page, schema, 'picnic-date');

  await sendButton(page).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Something went wrong on our side');
  await expect(alert).toContainText('Your answers are still here');
  const sms = alert.locator('a[data-sms-fallback]');
  await expect(sms).toHaveAttribute('href', /^sms:\+\d{10,15}\?&body=.+/);
  await expect(sms).toHaveAttribute('href', /Maya%20Test/);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  await expect(stepHeading(page, /Review & send/)).toBeVisible();
  await expect(sendButton(page)).toBeEnabled();

  // Nothing is lost on reload either.
  await page.reload();
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  await expect(stepHeading(page, /Review & send/)).toBeVisible();
  await expect(page.locator('[data-review-list]')).toContainText('Maya Test');

  await sendButton(page).click();
  await expect(page.getByRole('alert')).toContainText('We couldn’t send your request');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForURL('**/thank-you');
  await expect(page.locator('[data-thanks-ref]')).toContainText('BP-RETRY1');
  expect(calls).toHaveLength(3);
  expect(await page.evaluate(() => sessionStorage.getItem('bp-booking-v1'))).toBeNull();
});

test('a request that hangs times out after 15 seconds with the same fallback', async ({ page }) => {
  await page.clock.install();
  let release: () => void = () => {};
  await page.route('**/api/book.php', async (route) => {
    await new Promise<void>((r) => (release = r)); // never answers until the test ends
    await route.abort().catch(() => {});
  });
  await openBooking(page);
  await completeToReview(page, schema, 'family');
  await sendButton(page).click();
  await expect(page.locator('[data-primary]')).toBeDisabled();
  await expect(page.locator('[data-primary]')).toContainText('Sending…');
  await expect(page.locator('form[data-booking-form]')).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(15_500);
  await expect(page.getByRole('alert')).toContainText('This is taking longer than it should');
  await expect(page.locator('a[data-sms-fallback]')).toBeVisible();
  await expect(sendButton(page)).toBeEnabled();
  release();
});

test('rate limits and other refusals explain what to do next', async ({ page }) => {
  await mockBooking(page, (n) =>
    n === 1
      ? { status: 429, body: { ok: false, message: 'Too many requests.' } }
      : { status: 413, body: { ok: false, message: 'That’s more than we can accept in one go — please shorten your notes and try again.' } },
  );
  await openBooking(page);
  await completeToReview(page, schema, 'appreciation');
  await sendButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Too many attempts in a short time');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert')).toContainText('please shorten your notes');
  await expect(page.locator('a[data-sms-fallback]')).toBeVisible();
});

test('a failed no-JS submission (/book?error=1) explains what happened', async ({ page }) => {
  await openBooking(page);
  await expect(page.locator('[data-booking-error]')).toBeHidden();
  await openBooking(page, '?error=1');
  await expect(page.locator('[data-booking-error]')).toBeVisible();
  await expect(page.locator('[data-booking-error]')).toContainText('Your request didn’t go through');
});

test('answers that stop applying are not sent (occasion switch, surprise off)', async ({ page }) => {
  const calls = await mockBooking(page);
  const birthday = schema.occasions.find((o) => o.id === 'birthday')!;
  await openBooking(page);
  await choose(page, 'birthday', 'signature');
  await next(page);
  await fillRequired(page, schema, 2, birthday);
  await next(page);
  await fillRequired(page, schema, 3, birthday);

  const toggle = page.locator('#f-is_surprise');
  await toggle.check();
  await expect(page.locator('[data-field="surprise_for"]')).toBeVisible();
  await page.fill('#f-surprise_for', 'My sister');
  await toggle.uncheck();
  await expect(page.locator('[data-field="surprise_for"]')).toBeHidden();
  await expect(page.locator('#f-surprise_for')).toBeDisabled();

  // Switch the occasion: the birthday questions disappear and aren't sent.
  await page.locator('[data-progress] button[data-goto="1"]').click();
  await page.locator('input[name="occasion"][value="proposal"]').check();
  await page.locator('[data-progress] button[data-goto="3"]').click();
  await expect(page.locator('[data-group="birthday"]')).toBeHidden();
  await expect(page.locator('[data-group="romance"]')).toBeVisible();
  await fillRequired(page, schema, 3, schema.occasions.find((o) => o.id === 'proposal')!);
  await next(page);
  await fillRequired(page, schema, 4, birthday);
  await next(page);
  await sendButton(page).click();
  await page.waitForURL('**/thank-you');
  const sent = calls[0].fields;
  expect(sent.get('occasion')).toEqual(['proposal']);
  expect(sent.has('birthday_name')).toBe(false);
  expect(sent.has('surprise_for')).toBe(false);
  expect(sent.has('is_surprise')).toBe(false);
  expect(sent.get('partner_name')?.[0]).toBeTruthy();
});

test('analytics: booking_start once, booking_step per step, package_select and booking_submit', async ({ page }) => {
  const log = await recordAnalytics(page);
  await mockBooking(page);
  await openBooking(page);
  await expect.poll(() => log.filter(([e]) => e === 'booking_step').length).toBe(1);
  expect(log.find(([e]) => e === 'booking_step')![1]).toMatchObject({ step: 1 });

  await choose(page, 'retirement', 'celebration');
  await expect.poll(() => log.filter(([e]) => e === 'package_select').map(([, p]) => p.package)).toEqual(['celebration']);
  await page.locator('input[name="occasion"][value="birthday"]').check();
  expect(log.filter(([e]) => e === 'booking_start')).toHaveLength(1);

  await page.locator('input[name="occasion"][value="retirement"]').check();
  await next(page);
  await completeToReviewFrom2(page);
  await sendButton(page).click();
  await page.waitForURL('**/thank-you');
  const steps = log.filter(([e]) => e === 'booking_step').map(([, p]) => p.step);
  expect(steps).toEqual([1, 2, 3, 4, 5]);
  expect(log.filter(([e]) => e === 'booking_submit')).toHaveLength(1);
  expect(log.find(([e]) => e === 'booking_submit')![1]).toMatchObject({ occasion: 'retirement', package: 'celebration' });

  async function completeToReviewFrom2(p: typeof page) {
    const occ = schema.occasions.find((o) => o.id === 'retirement')!;
    for (let step = 2; step <= 4; step++) {
      await fillRequired(p, schema, step, occ);
      await next(p);
    }
    await expect(stepHeading(p, /Review & send/)).toBeVisible();
  }
});

test('review step lets you edit a section and come straight back', async ({ page }) => {
  await openBooking(page);
  await completeToReview(page, schema, 'family');
  await page.getByRole('button', { name: 'Edit When & where' }).click();
  await expect(stepHeading(page, /When & where/)).toBeVisible();
  await expect(page.locator('#bk-step-2-title')).toBeFocused();
  await page.fill('#f-location', 'Edwards Gardens');
  await expect(page.locator('[data-primary]')).toHaveText(/Review your request/);
  await next(page);
  await expect(stepHeading(page, /Review & send/)).toBeVisible();
  await expect(page.locator('[data-review-list]')).toContainText('Edwards Gardens');
});

test('no horizontal scrolling at 320px on any step or the thank-you page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await mockBooking(page);
  await openBooking(page);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const occ = schema.occasions.find((o) => o.id === 'gender-reveal')!;
  await choose(page, occ.id, 'celebration');
  for (let step = 2; step <= 4; step++) {
    await next(page);
    await fillRequired(page, schema, step, occ);
    expect(await overflow(), `step ${step}`).toBeLessThanOrEqual(0);
  }
  await next(page);
  await expect(stepHeading(page, /Review & send/)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await sendButton(page).click();
  await page.waitForURL('**/thank-you');
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the whole form still renders and posts to the booking endpoint', async ({ page }) => {
    await page.goto('/book');
    const form = page.locator('form[data-booking-form]');
    await expect(form).toHaveAttribute('method', 'post');
    await expect(form).toHaveAttribute('action', /\/api\/book\.php$/);
    for (const title of schema.steps) await expect(page.getByRole('heading', { level: 2, name: `Step ${schema.steps.indexOf(title) + 1} of ${schema.steps.length} — ${title}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send booking request' })).toBeVisible();
    // Core questions are natively required; occasion-specific ones are not (they'd block other occasions).
    await expect(page.locator('#f-name')).toHaveAttribute('required', '');
    await expect(page.locator('#f-birthday_name')).not.toHaveAttribute('required', '');
    await expect(page.locator('[data-group="birthday"]')).toContainText('Only if you’re booking for');
    await expect(page.locator('[data-review]')).toBeHidden();
  });

  test('a failed submission sent back to /book?error=1#booking-error shows the notice', async ({ page }) => {
    await page.goto('/book?error=1#booking-error');
    await expect(page.locator('[data-booking-error]')).toBeVisible();
  });

  test('thank-you page reads well without personalisation', async ({ page }) => {
    await page.goto('/thank-you');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you.');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('link', { name: /Follow @/ })).toBeVisible();
  });
});

test('thank-you page shows a reference passed in the URL', async ({ page }) => {
  await page.goto('/thank-you?ref=BP-ABC123');
  await expect(page.locator('[data-thanks-ref]')).toContainText('BP-ABC123');
  await page.goto('/thank-you?ref=<script>');
  await expect(page.locator('[data-thanks-ref]')).toBeHidden();
});
