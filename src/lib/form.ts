// Resolves src/content/booking-form.yaml into one structure used by BOTH the booking page
// (to render the form) and /api/form-schema.json (which api/book.php validates against).
import { getFormGroups, getOccasions, getPackages, getAddons, getStyles, getServices, getSettings } from './site';

export const OTHER_OCCASION = { id: 'other', name: 'Something else', formGroup: 'none' } as const;
export const NOT_SURE_PACKAGE = { id: 'not-sure', name: 'Help me choose' } as const;
/** The two "area" answers after the travel areas in settings.yaml; neither has a travel fee. */
export const AREA_OTHER = 'Somewhere else in the GTA';
export const AREA_UNSURE = 'Not sure yet';

export const STEP_TITLES = ['What you’d like', 'When & where', 'Details & style', 'Your details'] as const;

export interface Option {
  value: string;
  label: string;
}

// One copy of the showIf rule for the server-side resolver, the browser and the tests.
export { showIfConditions, showIfMatches, type ShowIfCondition } from '../scripts/booking/conditions';
import type { ShowIfCondition } from '../scripts/booking/conditions';

export interface ResolvedField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  help?: string;
  placeholder?: string;
  options?: Option[];
  min?: number;
  max?: number;
  maxLength?: number;
  maxWords?: number;
  autocomplete?: string;
  onlyFor?: string[];
  /** equals: one value · in: any of several · neither: any non-empty answer. A list = all must hold. */
  showIf?: ShowIfCondition | ShowIfCondition[];
  /** answer follows another field's (browser only), e.g. service "proposals" → occasion "proposal" */
  lockBy?: { field: string; values: Record<string, string> };
  note?: string;
  half?: boolean;
}

export interface ResolvedGroup {
  id: string;
  title: string;
  step: number;
  appliesTo: string[];
  intro?: string;
  fields: ResolvedField[];
}

export interface FormSchema {
  version: 1;
  steps: readonly string[];
  groups: ResolvedGroup[];
  occasions: { id: string; name: string; formGroup: string; recommendedPackage?: string }[];
  packages: {
    id: string;
    name: string;
    priceFrom: number | null;
    guestsIncluded: number | null;
    guestsMax: number | null;
    /** "for 2 guests" as written in packages.yaml — the estimate's package line, in the browser and the email */
    guestsLabel: string | null;
    extraGuestPrice: number | null;
    durationHours: number | null;
  }[];
  addons: { id: string; name: string; price: number | null }[];
  /** What the business offers (services.yaml); the form's first question. */
  services: { id: string; name: string; short: string; dm: boolean; securityDeposit: boolean }[];
  /** Picnic styles (styles.yaml); price null = quoted. */
  styles: { id: string; name: string; price: number | null; included: boolean }[];
  /** Travel fee by area (settings.yaml); fee null = quoted by area. */
  travel: { note: string; areas: { name: string; fee: number | null }[] };
  deposit: { standard: number; largeEventPercent: number; summary: string };
  securityDeposit: { amount: number; returnedWithin: string; summary: string };
  letterBoardMaxWords: number;
  taxNote: string;
  /** Business facts for the PHP emails and error messages (from settings.yaml). */
  business: {
    name: string;
    url: string;
    phoneDisplay: string;
    phoneE164: string;
    email: string;
    instagramHandle: string;
    instagramUrl: string;
    replyTime: string;
    depositSummary: string;
    locationNote: string;
    taxNote: string;
  };
}

export async function buildFormSchema(): Promise<FormSchema> {
  const [groups, occasions, packages, addons, styles, services, s] = await Promise.all([
    getFormGroups(),
    getOccasions(),
    getPackages(),
    getAddons(),
    getStyles(),
    getServices(),
    getSettings(),
  ]);

  const occ = [
    ...occasions.map((o) => ({ id: o.id, name: o.data.name, formGroup: o.data.formGroup, recommendedPackage: o.data.recommendedPackage })),
    { ...OTHER_OCCASION },
  ];
  const pkgs = [
    ...packages.map((p) => ({
      id: p.id,
      name: p.data.name,
      priceFrom: p.data.priceFrom,
      guestsIncluded: p.data.guestsIncluded,
      guestsMax: p.data.guestsMax,
      guestsLabel: p.data.guestsLabel ?? null,
      extraGuestPrice: p.data.extraGuestPrice,
      durationHours: p.data.durationHours,
    })),
    { id: NOT_SURE_PACKAGE.id, name: NOT_SURE_PACKAGE.name, priceFrom: null, guestsIncluded: null, guestsMax: null, guestsLabel: null, extraGuestPrice: null, durationHours: null },
  ];
  const adds = addons.map((a) => ({ id: a.id, name: a.data.name, price: a.data.price }));
  const svcs = services.map((x) => ({ id: x.id, name: x.data.name, short: x.data.short, dm: x.data.dm, securityDeposit: x.data.securityDeposit }));
  const stys = styles.map((x) => ({ id: x.id, name: x.data.name, price: x.data.price, included: x.data.included }));
  const travel = { note: s.travel.note, areas: s.travel.areas.map((a) => ({ name: a.name, fee: a.fee })) };

  const sources: Record<string, Option[]> = {
    occasions: occ.map((o) => ({ value: o.id, label: o.name })),
    packages: pkgs.map((p) => ({ value: p.id, label: p.name })),
    addons: adds.map((a) => ({ value: a.id, label: a.name })),
    services: svcs.map((x) => ({ value: x.id, label: x.name })),
    styles: stys.map((x) => ({ value: x.id, label: x.name })),
    areas: [...travel.areas.map((a) => ({ value: a.name, label: a.name })), { value: AREA_OTHER, label: AREA_OTHER }, { value: AREA_UNSURE, label: AREA_UNSURE }],
  };

  const resolved: ResolvedGroup[] = groups.map((g) => ({
    id: g.id,
    title: g.data.title,
    step: g.data.step,
    appliesTo: g.data.appliesTo,
    intro: g.data.intro,
    fields: g.data.fields.map(({ source, options, ...f }) => ({
      ...f,
      // the area question explains the travel fee with the owner's own sentence (settings.yaml)
      help: f.help ?? (source === 'areas' ? s.travel.note : undefined),
      // the letter-board limit lives in settings.yaml; the schema carries it so browser and server agree
      maxWords: f.id === 'letter_board' ? s.booking.letterBoardMaxWords : f.maxWords,
      required: f.required ?? false,
      options: source ? sources[source] : options?.map((o) => ({ value: o, label: o })),
    })),
  }));

  // Guard against duplicate field ids — they would silently overwrite each other in the email.
  const seen = new Set<string>();
  for (const g of resolved)
    for (const f of g.fields) {
      if (seen.has(f.id)) throw new Error(`booking-form.yaml: duplicate field id "${f.id}"`);
      seen.add(f.id);
    }

  return {
    version: 1,
    steps: STEP_TITLES,
    groups: resolved,
    occasions: occ,
    packages: pkgs,
    addons: adds,
    services: svcs,
    styles: stys,
    travel,
    deposit: { standard: s.deposit.standard, largeEventPercent: s.deposit.largeEventPercent, summary: s.deposit.summary },
    securityDeposit: s.securityDeposit,
    letterBoardMaxWords: s.booking.letterBoardMaxWords,
    taxNote: s.taxNote,
    business: {
      name: s.name,
      url: s.url,
      phoneDisplay: s.phoneDisplay,
      phoneE164: s.phoneE164,
      email: s.email,
      instagramHandle: s.instagramHandle,
      instagramUrl: s.instagramUrl,
      replyTime: s.replyTime,
      depositSummary: `${s.deposit.summary} ${s.securityDeposit.summary}`,
      locationNote: s.locationNote,
      taxNote: s.taxNote,
    },
  };
}

/** Does a group apply to this occasion? */
export function groupApplies(g: Pick<ResolvedGroup, 'appliesTo'>, formGroup: string): boolean {
  return g.appliesTo.includes('*') || g.appliesTo.includes(formGroup);
}

