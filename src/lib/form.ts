// Resolves src/content/booking-form.yaml into one structure used by BOTH the booking page
// (to render the form) and /api/form-schema.json (which api/book.php validates against).
import { getFormGroups, getOccasions, getPackages, getAddons, getSettings } from './site';

export const OTHER_OCCASION = { id: 'other', name: 'Something else', formGroup: 'none' } as const;
export const NOT_SURE_PACKAGE = { id: 'not-sure', name: 'Help me choose' } as const;

export const STEP_TITLES = ['Occasion & package', 'When & where', 'Details & style', 'Your details'] as const;

export interface Option {
  value: string;
  label: string;
}

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
  showIf?: { field: string; equals?: string };
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
    extraGuestPrice: number | null;
    durationHours: number | null;
  }[];
  addons: { id: string; name: string; price: number | null }[];
  deposit: { standard: number; largeEventPercent: number };
  letterBoardMaxWords: number;
  taxNote: string;
}

export async function buildFormSchema(): Promise<FormSchema> {
  const [groups, occasions, packages, addons, s] = await Promise.all([
    getFormGroups(),
    getOccasions(),
    getPackages(),
    getAddons(),
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
      extraGuestPrice: p.data.extraGuestPrice,
      durationHours: p.data.durationHours,
    })),
    { id: NOT_SURE_PACKAGE.id, name: NOT_SURE_PACKAGE.name, priceFrom: null, guestsIncluded: null, guestsMax: null, extraGuestPrice: null, durationHours: null },
  ];
  const adds = addons.map((a) => ({ id: a.id, name: a.data.name, price: a.data.price }));

  const sources: Record<string, Option[]> = {
    occasions: occ.map((o) => ({ value: o.id, label: o.name })),
    packages: pkgs.map((p) => ({ value: p.id, label: p.name })),
    addons: adds.map((a) => ({ value: a.id, label: a.name })),
  };

  const resolved: ResolvedGroup[] = groups.map((g) => ({
    id: g.id,
    title: g.data.title,
    step: g.data.step,
    appliesTo: g.data.appliesTo,
    intro: g.data.intro,
    fields: g.data.fields.map(({ source, options, ...f }) => ({
      ...f,
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
    deposit: { standard: s.deposit.standard, largeEventPercent: s.deposit.largeEventPercent },
    letterBoardMaxWords: s.booking.letterBoardMaxWords,
    taxNote: s.taxNote,
  };
}

/** Does a group apply to this occasion? */
export function groupApplies(g: Pick<ResolvedGroup, 'appliesTo'>, formGroup: string): boolean {
  return g.appliesTo.includes('*') || g.appliesTo.includes(formGroup);
}
