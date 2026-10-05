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
  fieldShows,
  fieldApplies,
  fieldById,
  lockedAnswer,
  serviceName,
  mockBooking,
  completeToReview,
  visibleEstimateTotal,
  estimateText,
  recordAnalytics,
  torontoDate,
  escapeRe,
  DEFAULT_SERVICE,
  type FormSchema,
  type Occasion,
} from './booking-helpers';
import { AREA_OTHER, AREA_UNSURE, QUOTE_HEADLINE } from '../../src/scripts/booking/estimate';

const money = (n: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n).replace('CA', '');

const sendButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Send booking request' });
const fieldError = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-field="${id}"] [data-field-error]`);
const field = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-field="${id}"]`);
const radio = (page: import('@playwright/test').Page, name: string, value: string) => page.locator(`input[name="${name}"][value="${value}"]`);

let schema: FormSchema;
let step1: RegExp;
test.beforeAll(async ({ request }) => {
  schema = await getSchema(request);
  step1 = new RegExp(escapeRe(schema.steps[0]));
});

/** Every question of a step shows or hides as the schema says for this occasion + service. */
async function expectStepQuestions(page: import('@playwright/test').Page, step: number, occ: Occasion, service: string) {
  for (const g of schema.groups.filter((x) => x.step === step)) {
    const group = page.locator(`[data-group="${g.id}"]`);
    const shown = g.fields.some((f) => fieldShows(g, f, occ, service));
    if (shown) await expect(group, `group ${g.id}`).toBeVisible();
    else await expect(group, `group ${g.id}`).toBeHidden();
    for (const f of g.fields) {
      const el = field(page, f.id);
      if (fieldShows(g, f, occ, service)) await expect(el, `field ${f.id}`).toBeVisible();
      else await expect(el, `field ${f.id}`).toBeHidden();
    }
  }
}

/** What was posted matches what applies: locked answers included, everything else never sent. */
function expectPostedQuestions(fields: Map<string, string[]>, occ: Occasion, service: string) {
  expect(fields.get('service')).toEqual([service]);
  expect(fields.get('occasion')).toEqual([occ.id]);
  for (const g of schema.groups)
    for (const f of g.fields) {
      if (fieldApplies(g, f, occ, service)) {
        const locked = lockedAnswer(f, occ, service);
        if (locked !== null) expect(fields.get(f.id), `${f.id} is locked to ${locked}`).toEqual([locked]);
      } else expect(fields.has(f.id) || fields.has(`${f.id}[]`), `${f.id} should not be sent`).toBe(false);
    }
}

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

      // Step 3 shows exactly the questions for this occasion (and a picnic).
      await expect(stepHeading(page, /Details & style/)).toBeVisible();
      await expectStepQuestions(page, 3, occ, DEFAULT_SERVICE);
      Object.assign(answers, await fillRequired(page, schema, 3, occ));
      await next(page);

      await expect(stepHeading(page, /Your details/)).toBeVisible();
      Object.assign(answers, await fillRequired(page, schema, 4, occ));
      await next(page);

      await expect(stepHeading(page, /Review & send/)).toBeVisible();
      await expect(page.locator('[data-review-list]')).toContainText(occ.name);
      await expect(page.locator('[data-review-list]')).toContainText(serviceName(schema, DEFAULT_SERVICE));

      const before = calls.length;
      await sendButton(page).click();
      await page.waitForURL('**/thank-you');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you, Maya.');
      await expect(page.locator('[data-thanks-ref]')).toContainText('BP-TEST42');
      expect(calls.length).toBe(before + 1);

      const { fields, headers } = calls[calls.length - 1];
      expect(headers['accept']).toContain('application/json');
      expect(fields.get('package')).toEqual([pkg]);
      for (const [id, v] of Object.entries(answers)) {
        if (Array.isArray(v)) expect(fields.get(`${id}[]`), id).toEqual(v);
        else expect(fields.get(id), id).toEqual([v]);
      }
      // Questions that don't apply are disabled, so they're never sent.
      expectPostedQuestions(fields, occ, DEFAULT_SERVICE);
      // Anti-spam fields.
      expect(fields.get('company_website')).toEqual(['']);
      const ts = Number(fields.get('_ts')?.[0]);
      expect(ts).toBeGreaterThan(Date.now() - 3_600_000);
      expect(ts).toBeLessThanOrEqual(Date.now());
      expect(fields.get('_page')).toEqual(['/book']);
    });
  }
});

test('room decor: no package or guests, the room instead of a spot, and a quote instead of a price', async ({ page }) => {
  const calls = await mockBooking(page);
  const occ = schema.occasions.find((o) => o.id === 'anniversary')!;
  await openBooking(page);
  await choose(page, occ.id, '', 'room-decor');
  // Every service card is a comfortable tap target.
  for (const face of await page.locator('.bk-svc-face').all()) expect((await face.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(field(page, 'occasion')).toBeVisible();
  await expect(field(page, 'package')).toBeHidden();
  await expect(visibleEstimateTotal(page)).toContainText(QUOTE_HEADLINE);
  await next(page);

  await expect(stepHeading(page, /When & where/)).toBeVisible();
  await expectStepQuestions(page, 2, occ, 'room-decor');
  await next(page); // nothing answered yet
  await expect(fieldError(page, 'room_type')).toHaveText('Choose the kind of room');
  await expect(fieldError(page, 'room_address')).toContainText('Enter the address of the room');
  await expect(fieldError(page, 'area')).toHaveText('Choose the area');
  await expect(fieldError(page, 'start_time')).toContainText('Enter a preferred start time');
  const answers = await fillRequired(page, schema, 2, occ, 'room-decor');
  expect(Object.keys(answers)).toEqual(expect.arrayContaining(['room_type', 'room_address', 'area']));
  await next(page);

  await expect(stepHeading(page, /Details & style/)).toBeVisible();
  await expectStepQuestions(page, 3, occ, 'room-decor');
  // Priced add-ons are listed, but nothing is totalled: this is quoted by hand.
  const pricedAddon = schema.addons.find((a) => a.price !== null);
  if (pricedAddon) {
    await page.locator(`input[name="addons[]"][value="${pricedAddon.id}"]`).check();
    await expect.poll(() => estimateText(page)).toContain(pricedAddon.name);
    expect(await estimateText(page)).toContain(money(pricedAddon.price!));
    expect(await estimateText(page)).not.toContain('Packages start at');
    await expect(visibleEstimateTotal(page)).toContainText(QUOTE_HEADLINE);
  }
  Object.assign(answers, await fillRequired(page, schema, 3, occ, 'room-decor'));
  await next(page);
  Object.assign(answers, await fillRequired(page, schema, 4, occ, 'room-decor'));
  await next(page);

  await expect(stepHeading(page, /Review & send/)).toBeVisible();
  await expect(page.locator('[data-review-list]')).toContainText(serviceName(schema, 'room-decor'));
  await expect(page.locator('[data-review-list]')).toContainText(occ.name);
  await sendButton(page).click();
  await page.waitForURL('**/thank-you');
  await expect(page.locator('[data-thanks-occasion]')).toContainText(serviceName(schema, 'room-decor').toLowerCase());
  const sent = calls[0].fields;
  expectPostedQuestions(sent, occ, 'room-decor');
  for (const [id, v] of Object.entries(answers)) expect(sent.get(Array.isArray(v) ? `${id}[]` : id), id).toEqual(Array.isArray(v) ? v : [v]);
  for (const id of ['package', 'guests_adults', 'guests_kids', 'location_type', 'location', 'picnic_style']) expect(sent.has(id), id).toBe(false);
});

test('birthday hamper: the occasion is locked, delivery replaces the picnic questions, and switching service drops old answers', async ({ page }) => {
  const calls = await mockBooking(page);
  const birthday = schema.occasions.find((o) => o.id === 'birthday')!;
  expect(lockedAnswer(fieldById(schema, 'occasion')!, birthday, 'birthday-hampers')).toBe('birthday');

  // Start as a picnic, answering step 2 and 3 the picnic way...
  await openBooking(page);
  await choose(page, 'birthday', 'signature');
  await next(page);
  await fillRequired(page, schema, 2, birthday);
  await next(page);
  await fillRequired(page, schema, 3, birthday);
  await page.locator('input[name="picnic_style"]').last().check();

  // ...then switch to a hamper: the occasion follows the service and hides, the package goes.
  await page.locator('[data-progress] button[data-goto="1"]').click();
  await radio(page, 'service', 'birthday-hampers').check();
  await expect(field(page, 'occasion')).toBeHidden();
  await expect(radio(page, 'occasion', 'birthday')).toBeChecked();
  await expect(radio(page, 'occasion', 'birthday')).toBeEnabled();
  await expect(field(page, 'package')).toBeHidden();
  await expect(page.locator('[data-dm-for]')).toBeHidden();
  await expect(visibleEstimateTotal(page)).toContainText(QUOTE_HEADLINE);
  await next(page);

  await expect(stepHeading(page, /When & where/)).toBeVisible();
  await expectStepQuestions(page, 2, birthday, 'birthday-hampers');
  await next(page);
  await expect(fieldError(page, 'delivery_slot')).toHaveText('Choose when it should arrive');
  await expect(fieldError(page, 'delivery_address')).toHaveText('Enter the delivery address');
  const answers = await fillRequired(page, schema, 2, birthday, 'birthday-hampers');
  expect(Object.keys(answers)).toEqual(expect.arrayContaining(['delivery_slot', 'delivery_address']));
  await next(page);

  // Step 3: the birthday questions and the card message show; add-ons and picnic styles don't.
  await expect(stepHeading(page, /Details & style/)).toBeVisible();
  await expectStepQuestions(page, 3, birthday, 'birthday-hampers');
  await expect(page.locator('[data-group="birthday"]')).toBeVisible();
  await expect(field(page, 'card_message')).toBeVisible();
  await expect(field(page, 'addons')).toBeHidden();
  // A surprise hamper: who it's for is asked, but not how they arrive or whether the team hides (both
  // need the surprise toggle AND a service we set up in person — a showIf list, all of which must hold).
  await page.locator('#f-is_surprise').check();
  await expect(field(page, 'surprise_for')).toBeVisible();
  await expect(field(page, 'team_presence')).toBeHidden();
  await expect(field(page, 'arrival_plan')).toBeHidden();
  await expect(page.locator('[data-field="team_presence"] input').first()).toBeDisabled();
  await page.locator('#f-is_surprise').uncheck();
  await page.fill('#f-card_message', 'Happy birthday, Sam');
  Object.assign(answers, await fillRequired(page, schema, 3, birthday, 'birthday-hampers'));
  await next(page);
  Object.assign(answers, await fillRequired(page, schema, 4, birthday, 'birthday-hampers'));
  await next(page);

  // The review still lists the locked occasion.
  await expect(stepHeading(page, /Review & send/)).toBeVisible();
  const review = page.locator('[data-review-list]');
  await expect(review).toContainText(serviceName(schema, 'birthday-hampers'));
  await expect(review.locator('.bk-review-row', { hasText: fieldById(schema, 'occasion')!.label })).toContainText(birthday.name);
  await sendButton(page).click();
  await page.waitForURL('**/thank-you');
  const sent = calls[0].fields;
  expectPostedQuestions(sent, birthday, 'birthday-hampers');
  expect(sent.get('card_message')).toEqual(['Happy birthday, Sam']);
  for (const [id, v] of Object.entries(answers)) expect(sent.get(Array.isArray(v) ? `${id}[]` : id), id).toEqual(Array.isArray(v) ? v : [v]);
  for (const id of ['package', 'location', 'location_type', 'guests_adults', 'start_time', 'picnic_style']) expect(sent.has(id), `${id} dropped`).toBe(false);
});

test('custom hamper: locked to “Something else”, so the occasion and the vision are required; Instagram DM offered', async ({ page }) => {
  const calls = await mockBooking(page);
  const other = schema.occasions.find((o) => o.id === 'other')!;
  await openBooking(page);
  const dm = page.locator('[data-dm-for="custom-hampers"]');
  await expect(dm).toBeHidden();
  await choose(page, '', '', 'custom-hampers');
  await expect(field(page, 'occasion')).toBeHidden();
  await expect(radio(page, 'occasion', 'other')).toBeChecked();
  await expect(field(page, 'package')).toBeHidden();
  await expect(dm).toBeVisible();
  const dmLink = dm.locator('a');
  await expect(dmLink).toHaveAttribute('href', /^https:\/\/ig\.me\/m\//);
  await expect(dmLink).toHaveAttribute('data-track', 'click_instagram');
  await next(page);

  await expect(stepHeading(page, /When & where/)).toBeVisible();
  await expectStepQuestions(page, 2, other, 'custom-hampers');
  const answers = await fillRequired(page, schema, 2, other, 'custom-hampers');
  await next(page);

  await expect(stepHeading(page, /Details & style/)).toBeVisible();
  await expectStepQuestions(page, 3, other, 'custom-hampers');
  await next(page); // "What's the occasion?" and the vision are required
  await expect(fieldError(page, 'other_occasion')).toBeVisible();
  await expect(fieldError(page, 'hamper_vision')).toContainText('Describe your vision');
  await expect(page.locator('#f-other_occasion')).toBeFocused();
  Object.assign(answers, await fillRequired(page, schema, 3, other, 'custom-hampers'));
  expect(Object.keys(answers)).toEqual(expect.arrayContaining(['other_occasion', 'hamper_vision']));
  await next(page);
  Object.assign(answers, await fillRequired(page, schema, 4, other, 'custom-hampers'));
  await next(page);

  await expect(stepHeading(page, /Review & send/)).toBeVisible();
  await expect(page.locator('[data-review-list]')).toContainText(other.name);
  await sendButton(page).click();
  await page.waitForURL('**/thank-you');
  expectPostedQuestions(calls[0].fields, other, 'custom-hampers');
  for (const [id, v] of Object.entries(answers)) expect(calls[0].fields.get(Array.isArray(v) ? `${id}[]` : id), id).toEqual(Array.isArray(v) ? v : [v]);
});

test('deep links pre-fill the form, win over saved answers and ignore unknown ids', async ({ page, context }) => {
  const proposal = schema.packages.find((p) => p.id === 'proposal-romance')!;
  // An occasion link means a picnic — a proposal link means Proposals (whose occasion is then locked).
  await openBooking(page, '?occasion=proposal&package=proposal-romance');
  await expect(radio(page, 'service', 'proposals')).toBeChecked();
  await expect(radio(page, 'occasion', 'proposal')).toBeChecked();
  await expect(field(page, 'occasion')).toBeHidden();
  await expect(radio(page, 'package', 'proposal-romance')).toBeChecked();
  await expect(page.locator('[data-suggested-for="proposal-romance"]')).toBeVisible();
  await expect(visibleEstimateTotal(page)).toContainText(money(proposal.priceFrom!));

  // A new deep link beats what was saved...
  await choose(page, 'birthday', 'signature');
  await openBooking(page, '?occasion=anniversary&package=celebration');
  await expect(radio(page, 'service', 'picnics')).toBeChecked();
  await expect(radio(page, 'occasion', 'anniversary')).toBeChecked();
  await expect(radio(page, 'package', 'celebration')).toBeChecked();
  // ...but reloading the same link keeps changes made since.
  await radio(page, 'occasion', 'family').check();
  await page.reload();
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  await expect(radio(page, 'occasion', 'family')).toBeChecked();

  // Unknown ids are ignored.
  const other = await context.newPage();
  await openBooking(other, '?service=platinum-tier&occasion=not-a-thing&package=platinum');
  await expect(other.locator('input[name="service"]:checked')).toHaveCount(0);
  await expect(other.locator('input[name="occasion"]:checked')).toHaveCount(0);
  await expect(other.locator('input[name="package"]:checked')).toHaveCount(0);
});

test('deep link ?service=room-decor chooses the service (and a hamper link locks the occasion)', async ({ page, context }) => {
  await openBooking(page, '?service=room-decor');
  await expect(radio(page, 'service', 'room-decor')).toBeChecked();
  await expect(stepHeading(page, step1)).toBeVisible();
  await expect(field(page, 'occasion')).toBeVisible();
  await expect(page.locator('input[name="occasion"]:checked')).toHaveCount(0);
  await expect(field(page, 'package')).toBeHidden();
  await expect(visibleEstimateTotal(page)).toContainText(QUOTE_HEADLINE);
  // The service survives a reload like every other answer.
  await page.reload();
  await expect(page.locator('[data-booking][data-ready="true"]')).toBeAttached();
  await expect(radio(page, 'service', 'room-decor')).toBeChecked();

  const other = await context.newPage();
  await openBooking(other, '?service=birthday-hampers');
  await expect(radio(other, 'service', 'birthday-hampers')).toBeChecked();
  await expect(radio(other, 'occasion', 'birthday')).toBeChecked();
  await expect(field(other, 'occasion')).toBeHidden();
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
  await expect(stepHeading(page, step1)).toBeVisible();
  await expect(radio(page, 'service', DEFAULT_SERVICE)).toBeChecked();
  await expect(radio(page, 'occasion', 'birthday')).toBeChecked();
  await expect(radio(page, 'package', 'celebration')).toBeChecked();
});

test('validation messages say how to fix each problem', async ({ page }) => {
  await openBooking(page);
  await next(page);
  const summary1 = page.locator('[data-step="1"] [data-error-summary]');
  await expect(summary1).toBeVisible();
  await expect(summary1).toContainText('Choose what you’d like us to set up');
  await expect(summary1).toContainText('Choose what we’re celebrating');
  // The package only applies once a picnic or proposal is chosen, so it isn't asked for yet.
  await expect(summary1).not.toContainText('Choose a package');
  const firstService = page.locator('input[name="service"]').first();
  await expect(firstService).toBeFocused();
  await expect(firstService).toHaveAttribute('aria-invalid', 'true');
  await expect(field(page, 'service')).toHaveAttribute('aria-describedby', /f-service-error/);
  // The focused radio carries the error too (screen readers rarely read a fieldset's description on focus),
  // and the number of problems is announced.
  await expect(firstService).toHaveAttribute('aria-describedby', /f-service-error/);
  await expect(page.locator('[data-live-status]')).toContainText('2 things to fix before you continue');

  await radio(page, 'service', 'picnics').check();
  await next(page);
  await expect(summary1).toContainText('Choose what we’re celebrating');
  await expect(summary1).toContainText('Choose a package, or “Help me choose”');
  await expect(page.locator('input[name="occasion"]').first()).toBeFocused();
  await expect(field(page, 'occasion')).toHaveAttribute('aria-describedby', /f-occasion-error/);

  await choose(page, 'picnic-date', 'signature');
  await expect(summary1).toBeHidden();
  await expect(firstService).not.toHaveAttribute('aria-describedby', /f-service-error/);
  await next(page);

  // Step 2: dates can't be in the past (Toronto time), numbers must be in range, required fields say what's missing.
  await expect(page.locator('#f-date')).toHaveAttribute('min', torontoDate(0));
  await page.fill('#f-date', torontoDate(-3));
  await page.fill('#f-guests_adults', '0');
  await next(page);
  await expect(fieldError(page, 'date')).toHaveText('Enter a date that’s today or later');
  await expect(fieldError(page, 'guests_adults')).toContainText('Enter a number from 1 to');
  await expect(fieldError(page, 'start_time')).toContainText('Enter a preferred start time');
  await expect(fieldError(page, 'area')).toHaveText('Choose the area');
  await expect(fieldError(page, 'location')).toHaveText('Enter an address, park name or area');
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
  await page.selectOption('#f-area', schema.travel.areas[0].name);
  await expect(fieldError(page, 'area')).toBeHidden();
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

test('live estimate adds extra guests, travel, style and add-ons, and never prices what it doesn’t know', async ({ page }) => {
  const sig = schema.packages.find((p) => p.id === 'signature')!;
  const cel = schema.packages.find((p) => p.id === 'celebration')!;
  expect(sig.extraGuestPrice).not.toBeNull();
  const area = schema.travel.areas.find((a) => a.name === 'Mississauga') ?? schema.travel.areas[0];
  const style = schema.styles.find((s) => s.name === 'Dome picnic') ?? schema.styles.find((s) => !s.included)!;
  expect(style.included).toBe(false);

  await openBooking(page);
  await expect(visibleEstimateTotal(page)).toContainText(/Choose a package/);
  await choose(page, 'birthday', 'signature');
  await next(page);
  await page.fill('#f-guests_adults', '4');
  await page.fill('#f-guests_kids', '1');
  // Signature, 4 adults + 1 kid: priceFrom + 2 extra (adult) guests × extraGuestPrice (today: $375 + 2 × $35 = $445).
  // There's no published price for kids, so the kid past the included guests is a note, never a charge.
  let expected = sig.priceFrom! + (4 - sig.guestsIncluded!) * sig.extraGuestPrice!;
  await expect(visibleEstimateTotal(page)).toContainText(money(expected));
  let text = await estimateText(page);
  expect(text).toContain(`2 extra guests × ${money(sig.extraGuestPrice!)}`);
  expect(text).toContain(money(2 * sig.extraGuestPrice!));
  expect(text).toContain('1 kid: we’ll confirm pricing in your quote');
  expect(text).toContain('Estimate only — starting price before HST.');
  expect(text).toContain('Prices vary by location');
  expect(text).toMatch(/\$\d+ booking deposit holds your date \(\d+% for larger events\), plus a \$\d+ refundable security deposit/);

  // Travel: a fee once the owner sets one, a "quoted by area" note until then; the two catch-all areas are notes.
  await page.selectOption('#f-area', area.name);
  if (area.fee !== null) {
    expected += area.fee;
    await expect.poll(() => estimateText(page)).toMatch(new RegExp(`Travel to ${escapeRe(area.name)}\\s*${escapeRe(money(area.fee))}`));
    await expect(visibleEstimateTotal(page)).toContainText(money(expected));
  } else {
    await expect.poll(() => estimateText(page)).toContain(`Travel to ${area.name}: quoted by area`);
    await expect(visibleEstimateTotal(page)).toContainText(money(expected));
  }
  await page.selectOption('#f-area', AREA_UNSURE);
  await expect.poll(() => estimateText(page)).toContain('Travel: quoted once you choose an area');
  await page.selectOption('#f-area', AREA_OTHER);
  await expect.poll(() => estimateText(page)).toContain('Travel: quoted by area');
  expect(await estimateText(page)).not.toContain('Travel to');
  await page.selectOption('#f-area', area.name);

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
  await radio(page, 'package', 'celebration').check();
  await next(page);
  await page.fill('#f-guests_adults', String((cel.guestsMax ?? cel.guestsIncluded!) + 2));
  await page.fill('#f-guests_kids', '');
  const celTotal = cel.priceFrom! + (area.fee ?? 0);
  await expect(visibleEstimateTotal(page)).toContainText(money(celTotal));
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
    await expect(visibleEstimateTotal(page)).toContainText(money(celTotal));
  }

  // A picnic style that isn't included: priced once the owner sets a price, "quoted" until then.
  await radio(page, 'picnic_style', style.id).check();
  if (style.price !== null) {
    await expect.poll(() => estimateText(page)).toMatch(new RegExp(`${escapeRe(style.name)}\\s*${escapeRe(money(style.price))}`));
    await expect(visibleEstimateTotal(page)).toContainText(money(celTotal + style.price));
  } else {
    await expect.poll(() => estimateText(page)).toContain(`${style.name}: quoted`);
    await expect(visibleEstimateTotal(page)).toContainText(money(celTotal));
  }
  // The included style is never a line or a note.
  const included = schema.styles.find((s) => s.included);
  if (included) {
    await radio(page, 'picnic_style', included.id).check();
    await expect.poll(() => estimateText(page)).not.toContain(`${style.name}: quoted`);
    text = await estimateText(page);
    expect(text).not.toContain(included.name);
    await radio(page, 'picnic_style', style.id).check();
  }

  // "Help me choose" → we recommend a package; the style and travel notes are still there to read.
  await page.locator('[data-back]').click();
  await page.locator('[data-back]').click();
  await radio(page, 'package', 'not-sure').check();
  await expect(visibleEstimateTotal(page)).toContainText('We’ll recommend a package');
  text = await estimateText(page);
  if (style.price === null) expect(text).toContain(`${style.name}: quoted`);
  if (area.fee === null) expect(text).toContain(`Travel to ${area.name}: quoted by area`);

  // Room decor: nothing is totalled, but the travel note stays so the visitor knows a fee is coming.
  await radio(page, 'service', 'room-decor').check();
  await expect(visibleEstimateTotal(page)).toContainText(QUOTE_HEADLINE);
  text = await estimateText(page);
  expect(text).not.toContain(sig.name);
  expect(text).not.toContain(`${style.name}: quoted`);
  if (area.fee === null) expect(text).toContain(`Travel to ${area.name}: quoted by area`);
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
  await expect(field(page, 'surprise_for')).toBeVisible();
  await expect(field(page, 'team_presence')).toBeVisible(); // a picnic: our team is there, so we ask
  await expect(field(page, 'arrival_plan')).toBeVisible();
  await page.fill('#f-surprise_for', 'My sister');
  await toggle.uncheck();
  await expect(field(page, 'surprise_for')).toBeHidden();
  await expect(field(page, 'team_presence')).toBeHidden();
  await expect(page.locator('#f-surprise_for')).toBeDisabled();

  // Switch the occasion: the birthday questions disappear and aren't sent.
  await page.locator('[data-progress] button[data-goto="1"]').click();
  await radio(page, 'occasion', 'proposal').check();
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
  expect(sent.get('service')).toEqual([DEFAULT_SERVICE]);
  expect(sent.get('occasion')).toEqual(['proposal']);
  expect(sent.has('birthday_name')).toBe(false);
  expect(sent.has('surprise_for')).toBe(false);
  expect(sent.has('is_surprise')).toBe(false);
  expect(sent.get('partner_name')?.[0]).toBeTruthy();
});

test('analytics: booking_start once, booking_step per step, service_select, package_select and booking_submit', async ({ page }) => {
  const log = await recordAnalytics(page);
  await mockBooking(page);
  await openBooking(page);
  await expect.poll(() => log.filter(([e]) => e === 'booking_step').length).toBe(1);
  expect(log.find(([e]) => e === 'booking_step')![1]).toMatchObject({ step: 1 });

  await choose(page, 'retirement', 'celebration');
  await expect.poll(() => log.filter(([e]) => e === 'service_select').map(([, p]) => p.service)).toEqual([DEFAULT_SERVICE]);
  await expect.poll(() => log.filter(([e]) => e === 'package_select').map(([, p]) => p.package)).toEqual(['celebration']);
  await radio(page, 'occasion', 'birthday').check();
  expect(log.filter(([e]) => e === 'booking_start')).toHaveLength(1);

  await radio(page, 'occasion', 'retirement').check();
  await next(page);
  await completeToReviewFrom2(page);
  await sendButton(page).click();
  await page.waitForURL('**/thank-you');
  const steps = log.filter(([e]) => e === 'booking_step').map(([, p]) => p.step);
  expect(steps).toEqual([1, 2, 3, 4, 5]);
  expect(log.filter(([e]) => e === 'booking_submit')).toHaveLength(1);
  expect(log.find(([e]) => e === 'booking_submit')![1]).toMatchObject({ service: DEFAULT_SERVICE, occasion: 'retirement', package: 'celebration' });

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
    // Every service is offered, with its one-line description, and the DM alternative is spelled out.
    await expect(page.locator('input[name="service"]')).toHaveCount(schema.services.length);
    for (const svc of schema.services) await expect(page.locator('.bk-svc', { hasText: svc.name })).toContainText(svc.short);
    await expect(page.locator('[data-dm-for]')).toBeVisible();
    // Core questions are natively required; occasion- and service-specific ones are not (they'd block other requests).
    await expect(page.locator('#f-name')).toHaveAttribute('required', '');
    await expect(page.locator('#f-birthday_name')).not.toHaveAttribute('required', '');
    await expect(page.locator('#f-room_address')).not.toHaveAttribute('required', '');
    await expect(page.locator('input[name="package"]').first()).not.toHaveAttribute('required', '');
    await expect(page.locator('[data-group="birthday"]')).toContainText('Only if you’re booking for');
    await expect(field(page, 'package')).toContainText('Only for');
    await expect(field(page, 'room_type')).toContainText(`Only for ${serviceName(schema, 'room-decor')}`);
    await expect(field(page, 'occasion')).toBeVisible();
    await expect(page.locator('[data-review]')).toBeHidden();
    // Script-only chrome stays out of the way; the deposits are spelled out before sending.
    await expect(page.locator('[data-progress]')).toBeHidden();
    await expect(page.locator('.bk-estbar')).toBeHidden();
    await expect(page.locator('.bk-reassure')).toContainText('non-refundable');
    await expect(page.locator('.bk-reassure')).toContainText('refundable security deposit');
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
    await expect(page.locator('main')).toContainText('non-refundable');
    await expect(page.locator('main')).toContainText('refundable security deposit');
  });
});

test('thank-you page shows a reference passed in the URL', async ({ page }) => {
  await page.goto('/thank-you?ref=BP-ABC123');
  await expect(page.locator('[data-thanks-ref]')).toContainText('BP-ABC123');
  await page.goto('/thank-you?ref=<script>');
  await expect(page.locator('[data-thanks-ref]')).toBeHidden();
});
