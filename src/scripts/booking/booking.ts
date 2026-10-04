// Booking form controller (progressive enhancement).
//
// Without JS the page is one long form that POSTs to settings.booking.endpoint. With JS it becomes a
// 4-step flow + Review & send: conditional questions per occasion, inline validation, a live estimate,
// progress saved in sessionStorage, deep links (/book?occasion=…&package=…) and a fetch() submit that
// never loses answers when something goes wrong.
//
// The questions are data (src/content/booking-form.yaml → buildFormSchema()); this file only knows the
// handful of structural ids the brief defines: occasion, package, date, guests_adults, guests_kids,
// addons, name, email.
import type { ResolvedField, ResolvedGroup } from '../../lib/form';
import type { BookingConfig } from './config';
import { computeEstimate, money, type Estimate } from './estimate';
import { validateField, torontoToday, wordCount } from './validate';
import { loadState, saveState, clearState, saveDone, type BookingState, type Answers } from './storage';

type Val = string | string[];
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Occasion = BookingConfig['schema']['occasions'][number];
interface Entry {
  field: ResolvedField;
  group: ResolvedGroup;
}
interface FieldError {
  id: string;
  msg: string;
}
type FailureKind = 'network' | 'timeout' | 'rate' | 'server' | 'rejected' | 'invalid';
type Result =
  | { ok: true; ref?: string }
  | { ok: false; kind: FailureKind; message?: string; errors?: Record<string, string> };

const REVIEW = 5;
const TIMEOUT_MS = 15_000;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? ('instant' as ScrollBehavior) : 'smooth');

function track(event: string, params?: Record<string, string | number>) {
  try {
    window.bpTrack?.(event, params);
  } catch {
    /* analytics must never break the form */
  }
}

/** Tiny element builder. Text is always set as text (never HTML), so answers can't inject markup. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function formatDate(v: string): string {
  const d = new Date(`${v}T12:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatTime(v: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(v);
  if (!m) return v;
  return new Date(2000, 0, 1, Number(m[1]), Number(m[2])).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

export function initBooking(root: HTMLElement): void {
  const cfgEl = root.querySelector<HTMLScriptElement>('script[data-booking-config]');
  const form = root.querySelector<HTMLFormElement>('form[data-booking-form]');
  if (!cfgEl || !form) return;
  let cfg: BookingConfig;
  try {
    cfg = JSON.parse(cfgEl.textContent || '') as BookingConfig;
  } catch {
    return; // leave the no-JS form in place
  }

  const { schema } = cfg;
  const STEPS = schema.steps.length;
  const today = torontoToday();

  const entries = new Map<string, Entry>();
  for (const group of schema.groups) for (const field of group.fields) entries.set(field.id, { field, group });
  const occasionsById = new Map(schema.occasions.map((o) => [o.id, o]));
  const packageIds = new Set(schema.packages.map((p) => p.id));
  const showIfSources = new Set(schema.groups.flatMap((g) => g.fields.map((f) => f.showIf?.field ?? '')).filter(Boolean));
  const estimateSources = new Set(['package', 'guests_adults', 'guests_kids', 'addons']);
  const serverErrors = new Map<string, string>();

  const stepEls = new Map<number, HTMLElement>();
  form.querySelectorAll<HTMLElement>('[data-step]').forEach((el) => stepEls.set(Number(el.dataset.step), el));
  const card = root.querySelector<HTMLElement>('[data-booking-card]') ?? form;
  const progress = root.querySelector<HTMLElement>('[data-progress]');
  const backBtn = form.querySelector<HTMLButtonElement>('[data-back]');
  const primary = form.querySelector<HTMLButtonElement>('[data-primary]');
  const primaryLabel = primary?.querySelector<HTMLElement>('[data-primary-label]');
  const statusBox = form.querySelector<HTMLElement>('[data-submit-status]');
  const liveStatus = root.querySelector<HTMLElement>('[data-live-status]');
  const estimateLive = root.querySelector<HTMLElement>('[data-estimate-live]');
  const estimateBoxes = [...root.querySelectorAll<HTMLElement>('[data-estimate]')];
  const estimateTotals = [...root.querySelectorAll<HTMLElement>('[data-estimate-total]')];
  const estToggle = root.querySelector<HTMLButtonElement>('[data-estimate-toggle]');
  const estSheet = estToggle ? document.getElementById(estToggle.getAttribute('aria-controls') ?? '') : null;
  if (!backBtn || !primary || !primaryLabel) return;

  // ───────────────────────── Field access ─────────────────────────
  const wrapOf = (id: string) => form.querySelector<HTMLElement>(`[data-field="${CSS.escape(id)}"]`);
  const controlsOf = (id: string): Control[] => {
    const w = wrapOf(id);
    return w ? [...w.querySelectorAll<Control>('input[name], select[name], textarea[name]')] : [];
  };

  // Read/write by the control actually rendered (a "select" in the data may be shown as radio chips).
  const controlKind = (f: ResolvedField, els: Control[]): 'radio' | 'checkboxes' | 'toggle' | 'value' => {
    const first = els[0];
    if (first instanceof HTMLInputElement && first.type === 'radio') return 'radio';
    if (first instanceof HTMLInputElement && first.type === 'checkbox') return f.type === 'toggle' ? 'toggle' : 'checkboxes';
    return 'value';
  };

  function readValue(f: ResolvedField): Val {
    const els = controlsOf(f.id);
    switch (controlKind(f, els)) {
      case 'radio':
        return (els as HTMLInputElement[]).find((e) => e.checked)?.value ?? '';
      case 'checkboxes':
        return (els as HTMLInputElement[]).filter((e) => e.checked).map((e) => e.value);
      case 'toggle': {
        const t = els[0] as HTMLInputElement;
        return t.checked ? t.value || 'yes' : '';
      }
      default:
        return els[0]?.value ?? '';
    }
  }
  const valueOf = (id: string): Val => {
    const e = entries.get(id);
    return e ? readValue(e.field) : '';
  };
  const textOf = (id: string) => {
    const v = valueOf(id);
    return Array.isArray(v) ? v.join(', ') : v.trim();
  };

  function writeValue(f: ResolvedField, v: Val) {
    const els = controlsOf(f.id);
    const list = Array.isArray(v) ? v : [v];
    const kind = controlKind(f, els);
    if (kind === 'radio' || kind === 'checkboxes') {
      for (const e of els as HTMLInputElement[]) e.checked = list.includes(e.value);
    } else if (kind === 'toggle') {
      const t = els[0] as HTMLInputElement;
      t.checked = list[0] === (t.value || 'yes');
    } else if (els[0] && typeof list[0] === 'string') {
      els[0].value = list[0];
    }
  }

  // ───────────────────────── Conditional questions ─────────────────────────
  const currentOccasion = (): Occasion | undefined => occasionsById.get(textOf('occasion'));
  const groupApplies = (g: ResolvedGroup, occ?: Occasion) =>
    g.appliesTo.includes('*') || (!!occ && g.appliesTo.includes(occ.formGroup));

  function applies(e: Entry, occ = currentOccasion(), depth = 0): boolean {
    const { field: f, group: g } = e;
    if (!groupApplies(g, occ)) return false;
    if (f.onlyFor && !(occ && f.onlyFor.includes(occ.id))) return false;
    if (f.showIf) {
      const dep = entries.get(f.showIf.field);
      if (!dep || depth > 5 || !applies(dep, occ, depth + 1)) return false;
      const v = readValue(dep.field);
      const vals = (Array.isArray(v) ? v : [v]).filter(Boolean);
      return f.showIf.equals === undefined ? vals.length > 0 : vals.includes(f.showIf.equals);
    }
    return true;
  }

  /** Show/enable only the questions that apply. Disabled controls are neither validated nor submitted. */
  function applyConditions() {
    const occ = currentOccasion();
    for (const g of schema.groups) {
      let visible = 0;
      for (const f of g.fields) {
        const on = applies({ field: f, group: g }, occ);
        if (on) visible++;
        const wrap = wrapOf(f.id);
        if (wrap) wrap.hidden = !on;
        for (const c of controlsOf(f.id)) {
          c.disabled = !on;
          if (f.required) c.required = on;
        }
        if (!on) setError(f.id, null);
      }
      const gEl = form!.querySelector<HTMLElement>(`[data-group="${CSS.escape(g.id)}"]`);
      if (gEl) gEl.hidden = visible === 0;
    }
    root.querySelectorAll<HTMLElement>('[data-suggested-for]').forEach((b) => {
      b.hidden = !occ?.recommendedPackage || b.dataset.suggestedFor !== occ.recommendedPackage;
    });
  }

  // ───────────────────────── Errors ─────────────────────────
  function setError(id: string, msg: string | null) {
    const wrap = wrapOf(id);
    if (!wrap) return;
    const box = wrap.querySelector<HTMLElement>('[data-field-error]');
    const text = box?.querySelector<HTMLElement>('[data-error-text]');
    const has = !!msg;
    wrap.classList.toggle('has-error', has);
    if (box && text) {
      box.hidden = !has;
      text.textContent = msg ?? '';
    }
    const ctrls = controlsOf(id);
    for (const c of ctrls) has ? c.setAttribute('aria-invalid', 'true') : c.removeAttribute('aria-invalid');
    // Radio/checkbox groups: describe the fieldset and every control in it, because screen readers
    // usually don't read a fieldset's description when focus lands on one of its radios.
    const describers: HTMLElement[] = wrap.tagName === 'FIELDSET' ? [wrap, ...ctrls] : ctrls;
    for (const d of describers) {
      if (d.dataset.describedby === undefined) d.dataset.describedby = d.getAttribute('aria-describedby') ?? '';
      const ids = [has && box ? box.id : '', d.dataset.describedby].filter(Boolean).join(' ');
      if (ids) d.setAttribute('aria-describedby', ids);
      else d.removeAttribute('aria-describedby');
    }
  }
  const hasError = (id: string) => !!wrapOf(id)?.classList.contains('has-error');
  const isChoice = (f: ResolvedField) => ['radio', 'checkboxes', 'toggle', 'select'].includes(f.type);
  const isEventDate = (e: Entry) => e.field.type === 'date' && e.group.step === 2;
  const wordLimit = (f: ResolvedField) =>
    f.maxWords ? (f.id === 'letter_board' ? schema.letterBoardMaxWords : f.maxWords) : undefined;

  function check(e: Entry): string | null {
    const server = serverErrors.get(e.field.id);
    if (server) return server;
    const v = readValue(e.field);
    let msg = validateField(e.field, v, { today, notBeforeToday: isEventDate(e), maxWords: wordLimit(e.field) });
    if (!msg && e.field.id === 'backup_date' && typeof v === 'string' && v && v === textOf('date'))
      msg = 'Choose a different backup date, or leave it blank';
    return msg;
  }

  const stepEntries = (step: number) => [...entries.values()].filter((e) => e.group.step === step);

  function validateStep(step: number, show: boolean): FieldError[] {
    const errs: FieldError[] = [];
    const occ = currentOccasion();
    for (const e of stepEntries(step)) {
      if (!applies(e, occ)) continue;
      const msg = check(e);
      if (show) setError(e.field.id, msg);
      if (msg) errs.push({ id: e.field.id, msg });
    }
    return errs;
  }

  function firstControl(id: string): HTMLElement | undefined {
    const ctrls = controlsOf(id).filter((c) => !c.disabled);
    return ctrls.find((c) => c instanceof HTMLInputElement && c.checked) ?? ctrls[0];
  }

  function focusField(id: string) {
    const c = firstControl(id);
    if (!c) return;
    c.focus({ preventScroll: true });
    (wrapOf(id) ?? c).scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  }

  function renderSummary(step: number, errs: FieldError[]) {
    const box = stepEls.get(step)?.querySelector<HTMLElement>('[data-error-summary]');
    if (!box) return;
    box.replaceChildren();
    if (!errs.length) {
      box.hidden = true;
      return;
    }
    const list = h('ul', { class: 'bk-summary-list' });
    for (const e of errs) {
      const a = h('a', { href: `#${firstControl(e.id)?.id ?? ''}` }, e.msg);
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        focusField(e.id);
      });
      list.append(h('li', { 'data-for': e.id }, a));
    }
    box.append(h('p', { class: 'bk-summary-title' }, summaryTitle(errs.length)), list);
    box.hidden = false;
    // Focus goes to the first field (which reads its own error); this tells screen-reader users how many
    // there are. Cleared first so the same count is announced again after another attempt.
    if (liveStatus) {
      liveStatus.textContent = '';
      window.setTimeout(() => {
        liveStatus.textContent = `${summaryTitle(errs.length)}.`;
      }, 150);
    }
  }
  const summaryTitle = (n: number) => (n === 1 ? 'One thing to fix before you continue' : `${n} things to fix before you continue`);

  /**
   * Keep a visible summary in step with fixes made since it appeared. Updates in place (never rebuilds),
   * so a click on one of its links isn't lost when leaving a field re-validates it.
   */
  function refreshSummary() {
    const box = stepEls.get(current)?.querySelector<HTMLElement>('[data-error-summary]');
    if (!box || box.hidden) return;
    const errs = new Map(
      stepEntries(current)
        .filter((e) => hasError(e.field.id))
        .map((e) => [e.field.id, wrapOf(e.field.id)?.querySelector('[data-error-text]')?.textContent ?? ''] as const),
    );
    if (!errs.size) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    box.querySelectorAll<HTMLElement>('li[data-for]').forEach((li) => {
      const msg = errs.get(li.dataset.for ?? '');
      if (msg === undefined) li.remove();
      else {
        const a = li.querySelector('a');
        if (a && a.textContent !== msg) a.textContent = msg;
      }
    });
    // Every listed problem is fixed (a new one, e.g. a clashing backup date, shows at its field and
    // joins the summary on the next attempt): put the summary away rather than count "0 things".
    const left = box.querySelectorAll('li[data-for]').length;
    if (!left) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const title = box.querySelector('.bk-summary-title');
    if (title) title.textContent = summaryTitle(left);
  }

  // ───────────────────────── State ─────────────────────────
  const saved = loadState();
  const state: BookingState = saved ?? { v: 1, step: 1, maxStep: 1, values: {}, startedAt: Date.now(), query: '', started: false };
  if (!Number.isFinite(state.startedAt) || state.startedAt <= 0) state.startedAt = Date.now();
  let current = 1;
  let sending = false;
  let done = false;

  function snapshot(): Answers {
    const out: Answers = {};
    for (const { field } of entries.values()) out[field.id] = readValue(field);
    return out;
  }
  function persist() {
    if (done) return;
    state.step = current;
    state.values = snapshot();
    saveState(state);
  }

  // ───────────────────────── Steps & progress ─────────────────────────
  const stepName = (n: number) => (n === REVIEW ? 'Review & send' : (schema.steps[n - 1] ?? ''));

  function scrollToCard() {
    const header = document.querySelector<HTMLElement>('[data-header]');
    const offset = (header?.offsetHeight ?? 0) + 12;
    const top = card.getBoundingClientRect().top;
    if (top >= offset - 2 && top < window.innerHeight * 0.4) return; // already in a good spot
    window.scrollTo({ top: Math.max(0, top + window.scrollY - offset), behavior: scrollBehavior() });
  }

  function showStep(n: number, opts: { focus?: boolean; scroll?: boolean } = {}) {
    current = Math.min(Math.max(1, n), REVIEW);
    state.maxStep = Math.max(state.maxStep, current);
    stepEls.forEach((el, i) => {
      el.hidden = i !== current;
    });
    if (current === REVIEW) renderReview();
    else clearStatus();
    updateProgress();
    updateNav();
    if (opts.scroll) scrollToCard();
    if (opts.focus) stepEls.get(current)?.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true });
    track('booking_step', { step: current, step_name: stepName(current) });
    persist();
  }

  function updateProgress() {
    progress?.querySelectorAll<HTMLElement>('[data-progress-item]').forEach((li) => {
      const n = Number(li.dataset.progressItem);
      const status = n === current ? 'current' : n < current || (n <= state.maxStep && n < REVIEW) ? 'done' : 'upcoming';
      li.dataset.state = status;
      const btn = li.querySelector<HTMLButtonElement>('button');
      if (btn) {
        btn.disabled = n > state.maxStep;
        if (n === current) btn.setAttribute('aria-current', 'step');
        else btn.removeAttribute('aria-current');
      }
      const sr = li.querySelector<HTMLElement>('[data-progress-status]');
      if (sr) sr.textContent = status === 'done' ? ' (completed)' : status === 'upcoming' ? ' (not started)' : '';
    });
  }

  function updateNav() {
    backBtn!.hidden = current === 1;
    if (sending) return;
    if (current === REVIEW) primaryLabel!.textContent = 'Send booking request';
    else if (current === STEPS || state.maxStep === REVIEW) primaryLabel!.textContent = 'Review your request';
    else primaryLabel!.replaceChildren('Continue', h('span', { class: 'bk-continue-to' }, ` to ${stepName(current + 1)}`));
    primary!.dataset.mode = current === REVIEW ? 'send' : 'next';
  }

  function next() {
    const errs = validateStep(current, true);
    renderSummary(current, errs);
    if (errs.length) {
      focusField(errs[0].id);
      return;
    }
    if (current === STEPS || state.maxStep === REVIEW) advanceTo(REVIEW);
    else showStep(current + 1, { focus: true, scroll: true });
  }

  /** Move forward several steps (Review, progress bar), stopping at the first step that needs answers. */
  function advanceTo(target: number): boolean {
    for (let s = current; s < target && s <= STEPS; s++) {
      if (validateStep(s, false).length) {
        if (s !== current) showStep(s);
        const errs = validateStep(s, true);
        renderSummary(s, errs);
        focusField(errs[0].id);
        return false;
      }
    }
    showStep(target, { focus: true, scroll: true });
    return true;
  }

  function goTo(n: number) {
    if (n === current || sending) return;
    if (n < current) showStep(n, { focus: true, scroll: true });
    else advanceTo(n);
  }

  // ───────────────────────── Review ─────────────────────────
  function displayValue(f: ResolvedField, v: Val): string {
    const label = (x: string) => f.options?.find((o) => o.value === x)?.label ?? x;
    if (Array.isArray(v)) return v.map(label).join(', ');
    const t = v.trim();
    switch (f.type) {
      case 'toggle':
        return 'Yes';
      case 'date':
        return formatDate(t);
      case 'time':
        return formatTime(t);
      case 'radio':
      case 'select':
        return label(t);
      default:
        return t;
    }
  }

  function answered(step: number) {
    const occ = currentOccasion();
    return stepEntries(step)
      .filter((e) => applies(e, occ))
      .map((e) => ({ e, v: readValue(e.field) }))
      .filter(({ v }) => (Array.isArray(v) ? v.length > 0 : v.trim() !== ''));
  }
  const reviewLabel = (e: Entry) => (e.field.type === 'toggle' ? e.group.title : e.field.label);

  function renderReview() {
    const list = form!.querySelector<HTMLElement>('[data-review-list]');
    if (!list) return;
    list.replaceChildren(
      ...schema.steps.map((title, i) => {
        const step = i + 1;
        const items = answered(step);
        const headId = `bk-review-${step}`;
        const head = h(
          'div',
          { class: 'bk-review-head' },
          h('h3', { id: headId, class: 'bk-review-title' }, title),
          h('button', { type: 'button', class: 'bk-edit', 'data-edit-step': String(step) }, 'Edit', h('span', { class: 'sr-only' }, ` ${title}`)),
        );
        const body = items.length
          ? h(
              'dl',
              { class: 'bk-review-dl' },
              ...items.map(({ e, v }) => h('div', { class: 'bk-review-row' }, h('dt', {}, reviewLabel(e)), h('dd', {}, displayValue(e.field, v)))),
            )
          : h('p', { class: 'bk-review-empty' }, 'Nothing added here — that’s completely fine.');
        return h('section', { class: 'bk-review-step', 'aria-labelledby': headId }, head, body);
      }),
    );
  }

  // ───────────────────────── Estimate ─────────────────────────
  const estimatePackages = schema.packages.map((p) => ({ ...p, guestsLabel: cfg.guestsLabels[p.id] }));

  function currentEstimate(): Estimate {
    const num = (id: string) => {
      const e = entries.get(id);
      if (!e || !applies(e)) return null;
      const n = parseInt(textOf(id), 10);
      return Number.isFinite(n) ? n : null;
    };
    const addons = entries.get('addons');
    return computeEstimate(
      { packages: estimatePackages, addons: schema.addons },
      {
        packageId: textOf('package'),
        adults: num('guests_adults'),
        kids: num('guests_kids'),
        addons: addons && applies(addons) ? (valueOf('addons') as string[]) : [],
      },
    );
  }

  const shortEstimate = (est: Estimate) =>
    est.kind === 'priced' ? `Starting at ${money(est.total ?? 0)}` : est.kind === 'recommend' ? 'We’ll recommend a package' : 'Choose a package';

  function renderEstimate(box: HTMLElement, est: Estimate) {
    const nodes: Node[] = [];
    const sub = est.minPrice !== null ? h('p', { class: 'bk-est-sub' }, `Packages start at ${money(est.minPrice)}, ${cfg.taxNote}.`) : null;
    if (est.kind === 'priced') {
      nodes.push(h('p', { class: 'bk-est-kicker' }, 'Starting at'), h('p', { class: 'bk-est-total' }, money(est.total ?? 0)));
    } else if (est.kind === 'recommend') {
      nodes.push(h('p', { class: 'bk-est-total is-text' }, 'We’ll recommend a package'));
      if (sub) nodes.push(sub);
    } else {
      nodes.push(h('p', { class: 'bk-est-empty' }, 'Choose a package to see a starting estimate.'));
      if (sub) nodes.push(sub);
    }
    const lines = h('ul', { class: 'bk-est-lines' });
    for (const l of est.lines) lines.append(h('li', {}, h('span', {}, l.label), h('span', { class: 'bk-est-amt' }, money(l.amount))));
    for (const n of est.notes) lines.append(h('li', { class: 'is-note' }, h('span', {}, n)));
    for (const name of est.onRequest) lines.append(h('li', {}, h('span', {}, name), h('span', { class: 'bk-est-amt is-muted' }, 'Price on request')));
    if (lines.childElementCount) nodes.push(lines);
    nodes.push(h('p', { class: 'bk-est-note' }, cfg.estimateNote), h('p', { class: 'bk-est-deposit' }, cfg.depositLine));
    box.replaceChildren(...nodes);
  }

  let lastAnnounced = '';
  let announceTimer = 0;
  function updateEstimate(announce: boolean) {
    const est = currentEstimate();
    estimateBoxes.forEach((b) => renderEstimate(b, est));
    const short = shortEstimate(est);
    estimateTotals.forEach((t) => (t.textContent = short));
    const spoken = est.kind === 'priced' ? `${short}, ${cfg.taxNote}` : short;
    if (!announce) {
      lastAnnounced = spoken;
      return;
    }
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      if (!estimateLive || spoken === lastAnnounced) return;
      lastAnnounced = spoken;
      estimateLive.textContent = `Estimate updated: ${spoken}`;
    }, 900);
  }

  function setSheet(open: boolean) {
    if (!estToggle || !estSheet) return;
    estToggle.setAttribute('aria-expanded', String(open));
    estSheet.hidden = !open;
  }
  estToggle?.addEventListener('click', () => setSheet(estToggle.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && estToggle?.getAttribute('aria-expanded') === 'true') {
      setSheet(false);
      estToggle.focus();
    }
  });

  // ───────────────────────── Letter board word counter ─────────────────────────
  const wordTimers = new Map<string, number>();
  const wordAnnounced = new Map<string, string>();
  function updateWordCount(f: ResolvedField, announce = false) {
    const max = wordLimit(f);
    if (!max) return;
    const n = wordCount(textOf(f.id));
    const el = form!.querySelector<HTMLElement>(`[data-word-count="${CSS.escape(f.id)}"]`);
    if (el) {
      el.hidden = false;
      el.textContent = `${n} of ${max} words`;
      el.classList.toggle('is-over', n > max);
    }
    const live = form!.querySelector<HTMLElement>(`[data-word-count-live="${CSS.escape(f.id)}"]`);
    if (!live || !announce) return;
    window.clearTimeout(wordTimers.get(f.id));
    wordTimers.set(
      f.id,
      window.setTimeout(() => {
        const text = n > max ? `${n} words — that’s ${n - max} over the ${max}-word limit` : `${max - n} ${max - n === 1 ? 'word' : 'words'} left`;
        if (wordAnnounced.get(f.id) === text) return; // same count as last time: stay quiet
        wordAnnounced.set(f.id, text);
        live.textContent = text;
      }, 900),
    );
  }

  // ───────────────────────── Submit ─────────────────────────
  function announce(text: string) {
    if (liveStatus) liveStatus.textContent = text;
  }

  function setSending(on: boolean) {
    sending = on;
    primary!.disabled = on;
    backBtn!.disabled = on;
    primary!.classList.toggle('is-sending', on);
    if (on) {
      form!.setAttribute('aria-busy', 'true');
      primaryLabel!.textContent = 'Sending…';
      announce('Sending your booking request…');
    } else {
      form!.removeAttribute('aria-busy');
      updateNav();
    }
  }

  function clearStatus() {
    if (!statusBox) return;
    statusBox.replaceChildren();
    statusBox.hidden = true;
  }

  function smsHref(): string {
    const date = textOf('date');
    const lines = [cfg.smsBody + (date ? formatDate(date) : '')];
    const occ = currentOccasion();
    if (occ) lines.push(`Occasion: ${occ.name}`);
    const name = textOf('name');
    if (name) lines.push(`Name: ${name}`);
    return `sms:${cfg.phoneE164}?&body=${encodeURIComponent(lines.join('\n'))}`;
  }

  function showFailure(kind: FailureKind, message?: string) {
    if (!statusBox) return;
    const titles: Record<FailureKind, string> = {
      network: 'We couldn’t send your request',
      timeout: 'This is taking longer than it should',
      rate: 'Too many attempts in a short time',
      server: 'Something went wrong on our side',
      rejected: 'We couldn’t accept that request',
      invalid: 'Your request needs another look',
    };
    const bodies: Record<FailureKind, string> = {
      network: 'It looks like the connection dropped.',
      timeout: 'We didn’t hear back from our booking inbox in time.',
      rate: 'Please wait a minute before trying again.',
      server: 'Your request didn’t go through.',
      rejected: message || 'Your request didn’t go through.',
      invalid: message || 'Some answers couldn’t be accepted.',
    };
    const retry = h('button', { type: 'button', class: 'btn btn-primary', 'data-retry': '' }, 'Try again');
    retry.addEventListener('click', () => void send());
    const sms = h('a', { href: smsHref(), class: 'btn btn-secondary', 'data-track': 'click_text', 'data-sms-fallback': '' }, `Text ${cfg.phoneDisplay}`);
    statusBox.replaceChildren(
      h(
        'div',
        { class: 'bk-alert', role: 'alert' },
        h('p', { class: 'bk-alert-title' }, titles[kind]),
        h(
          'p',
          {},
          `${bodies[kind]} Your answers are still here and saved on this device. Try again, or text us and we’ll take it from there.`,
        ),
        h('div', { class: 'bk-alert-actions' }, retry, sms),
        h(
          'p',
          { class: 'bk-alert-alt' },
          'You can also call ',
          h('a', { href: `tel:${cfg.phoneE164}`, 'data-track': 'click_call' }, cfg.phoneDisplay),
          ' or email ',
          h('a', { href: `mailto:${cfg.email}` }, cfg.email),
          '.',
        ),
      ),
    );
    statusBox.hidden = false;
    announce('');
    retry.focus();
  }

  function applyServerErrors(errors: Record<string, string>): boolean {
    const list = Object.entries(errors)
      .map(([k, m]) => ({ id: k.replace(/\[\]$/, ''), msg: String(m) }))
      .filter((x) => {
        const e = entries.get(x.id);
        return !!e && applies(e);
      });
    if (!list.length) return false;
    for (const x of list) {
      serverErrors.set(x.id, x.msg);
      setError(x.id, x.msg);
    }
    const order = [...entries.keys()];
    list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const first = entries.get(list[0].id)!.group.step;
    showStep(first);
    const inStep = list.filter((x) => entries.get(x.id)!.group.step === first);
    renderSummary(first, inStep);
    focusField(inStep[0].id);
    return true;
  }

  function setHiddenFields() {
    const set = (name: string, value: string) => {
      const el = form!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (el) el.value = value;
    };
    set('_ts', String(state.startedAt));
    set('_page', location.pathname + location.search);
  }

  async function postForm(): Promise<Result> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        body: new FormData(form!),
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; ref?: unknown; message?: string; errors?: Record<string, string> } | null;
      if (res.ok && data?.ok) return { ok: true, ref: typeof data.ref === 'string' ? data.ref : undefined };
      if (res.status === 422) return { ok: false, kind: 'invalid', message: data?.message, errors: data?.errors };
      if (res.status === 429) return { ok: false, kind: 'rate', message: data?.message };
      // Other 4xx answers (e.g. too long, wrong origin) carry a message written for visitors.
      if (res.status >= 400 && res.status < 500 && data?.message) return { ok: false, kind: 'rejected', message: data.message };
      return { ok: false, kind: 'server' };
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function postWeb3forms(): Promise<Result> {
    const answers: Record<string, string> = {};
    for (let s = 1; s <= STEPS; s++) {
      for (const { e, v } of answered(s)) {
        let key = reviewLabel(e);
        while (key in answers) key += ' ';
        answers[key] = displayValue(e.field, v);
      }
    }
    const occ = currentOccasion();
    const body: Record<string, unknown> = {
      access_key: cfg.web3formsAccessKey,
      subject: `New booking request: ${occ?.name ?? 'Picnic'} — ${textOf('name')}`,
      from_name: `${cfg.businessName} website`,
      replyto: textOf('email'),
      ...answers,
      'Form started': new Date(state.startedAt).toISOString(),
      Page: location.pathname + location.search,
    };
    const hp = form!.querySelector<HTMLInputElement>('input[name="company_website"]')?.value.trim();
    if (hp) body.botcheck = hp;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (res.ok && data?.success) return { ok: true };
      if (res.status === 429) return { ok: false, kind: 'rate' };
      return { ok: false, kind: 'server', message: data?.message };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function succeed(ref?: string) {
    done = true;
    const occ = currentOccasion();
    saveDone({ firstName: textOf('name').split(/\s+/)[0] ?? '', occasion: occ?.id ?? '', occasionName: occ?.name, ref });
    clearState();
    track('booking_submit', { occasion: occ?.id ?? '', package: textOf('package') });
    primaryLabel!.textContent = 'Sent';
    announce('Request sent. Taking you to the confirmation page…');
    window.location.assign(cfg.thankYouUrl);
  }

  async function send() {
    if (sending) return;
    for (let s = 1; s <= STEPS; s++) {
      if (validateStep(s, false).length) {
        showStep(s);
        const errs = validateStep(s, true);
        renderSummary(s, errs);
        focusField(errs[0].id);
        return;
      }
    }
    clearStatus();
    setHiddenFields();
    setSending(true);
    let result: Result;
    try {
      result = cfg.provider === 'web3forms' ? await postWeb3forms() : await postForm();
    } catch (err) {
      result = { ok: false, kind: (err as Error)?.name === 'AbortError' ? 'timeout' : 'network' };
    }
    if (result.ok) {
      succeed(result.ref);
      return;
    }
    setSending(false);
    if (result.kind === 'invalid' && result.errors && applyServerErrors(result.errors)) return;
    showFailure(result.kind, result.message);
  }

  // ───────────────────────── Events ─────────────────────────
  function onEdit(ev: Event) {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)) return;
    if (t.name === 'company_website' || t.name.startsWith('_')) return;
    if (!state.started) {
      state.started = true;
      track('booking_start');
    }
    const wrap = t.closest<HTMLElement>('[data-field]');
    const id = wrap?.dataset.field;
    const e = id ? entries.get(id) : undefined;
    if (!wrap || !id || !e) return;
    wrap.dataset.dirty = 'true';
    serverErrors.delete(id);
    if (id === 'occasion' || showIfSources.has(id)) applyConditions();
    if (hasError(id) || (ev.type === 'change' && isChoice(e.field))) {
      setError(id, check(e));
      refreshSummary();
    }
    if (id === 'date' && hasError('backup_date')) {
      const b = entries.get('backup_date');
      if (b) setError('backup_date', check(b));
    }
    if (id === 'package' && ev.type === 'change') track('package_select', { package: textOf('package') });
    if (estimateSources.has(id)) updateEstimate(true);
    if (wordLimit(e.field)) updateWordCount(e.field, ev.type === 'input');
    persist();
  }
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  // Validate a text field when the visitor leaves it (once they've typed something).
  form.addEventListener('focusout', (ev) => {
    const wrap = (ev.target as HTMLElement).closest<HTMLElement>('[data-field]');
    const id = wrap?.dataset.field;
    const e = id ? entries.get(id) : undefined;
    if (!wrap || !id || !e || isChoice(e.field)) return;
    const to = ev.relatedTarget as Node | null;
    if (to && wrap.contains(to)) return;
    if (wrap.dataset.dirty !== 'true' && !hasError(id)) return;
    if (!applies(e)) return;
    setError(id, check(e));
    refreshSummary();
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (sending) return;
    if (current < REVIEW) next();
    else void send();
  });

  backBtn.addEventListener('click', () => {
    if (!sending) showStep(current - 1, { focus: true, scroll: true });
  });

  form.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    const edit = target.closest<HTMLButtonElement>('[data-edit-step]');
    if (edit) {
      showStep(Number(edit.dataset.editStep), { focus: true, scroll: true });
      return;
    }
    const stepper = target.closest<HTMLButtonElement>('[data-stepper]');
    if (stepper) {
      const input = document.getElementById(stepper.getAttribute('aria-controls') ?? '') as HTMLInputElement | null;
      if (!input || input.disabled) return;
      const delta = Number(stepper.dataset.stepper);
      const min = input.min !== '' ? Number(input.min) : 0;
      const max = input.max !== '' ? Number(input.max) : Infinity;
      const cur = parseInt(input.value, 10);
      let nextVal = Number.isFinite(cur) ? cur + delta : delta > 0 ? Math.max(min, 1) : min;
      nextVal = Math.min(max, Math.max(min, nextVal));
      input.value = String(nextVal);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  progress?.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('button[data-goto]');
    if (btn && !btn.disabled) goTo(Number(btn.dataset.goto));
  });

  // Coming back from /thank-you with the browser's Back button restores this page from memory.
  window.addEventListener('pageshow', (ev) => {
    if (!ev.persisted) return;
    if (done || !loadState()) window.location.reload();
    else if (sending) setSending(false);
  });

  // ───────────────────────── Start ─────────────────────────
  // 1. Restore saved answers.
  for (const [id, v] of Object.entries(state.values ?? {})) {
    const e = entries.get(id);
    if (e) writeValue(e.field, v);
  }
  // 2. Deep link (/book?occasion=proposal&package=proposal-romance) wins over saved answers — once per
  //    distinct link, so reloading the same URL doesn't undo changes made since.
  if (location.search && location.search !== state.query) {
    const params = new URLSearchParams(location.search);
    const occ = params.get('occasion');
    const pkg = params.get('package');
    let applied = false;
    const occEntry = entries.get('occasion');
    const pkgEntry = entries.get('package');
    if (occ && occasionsById.has(occ) && occEntry) {
      writeValue(occEntry.field, occ);
      applied = true;
    }
    if (pkg && packageIds.has(pkg) && pkgEntry) {
      writeValue(pkgEntry.field, pkg);
      applied = true;
    }
    state.query = location.search;
    if (applied) state.step = 1;
  }
  // 3. Event dates can't be in the past (Toronto time).
  for (const e of entries.values()) if (isEventDate(e)) controlsOf(e.field.id).forEach((c) => ((c as HTMLInputElement).min = today));

  // 4. Switch to the step-by-step layout.
  form.noValidate = true;
  document.documentElement.classList.add('bp-js', 'bp-ready');
  root.querySelectorAll<HTMLElement>('[data-js-only]').forEach((el) => (el.hidden = false));
  root.querySelectorAll('.nojs-only').forEach((el) => el.remove());
  applyConditions();
  for (const e of entries.values()) updateWordCount(e.field);
  updateEstimate(false);
  setHiddenFields();

  // 5. Resume where the visitor left off — but never past a step that still needs answers.
  let start = Math.min(Math.max(1, Number(state.step) || 1), REVIEW);
  state.maxStep = Math.min(Math.max(Number(state.maxStep) || 1, start), REVIEW);
  for (let s = 1; s < start && s <= STEPS; s++) {
    if (validateStep(s, false).length) {
      start = s;
      break;
    }
  }
  showStep(start);
  root.dataset.ready = 'true';
}
