// Live price estimate for the booking form. Pure functions (no DOM) so the maths is easy to test.
// Everything comes from the form schema (packages.yaml / addons.yaml); nothing is hard-coded here.
//
//   total = package priceFrom
//         + (adults + kids − guestsIncluded) × extraGuestPrice   (only when extraGuestPrice is known)
//         + known add-on prices
//
// Unknown amounts are never guessed: extra guests without a price become a "quoted" note and add-ons
// with a null price are listed as "price on request".

export interface EstimatePackage {
  id: string;
  name: string;
  priceFrom: number | null;
  guestsIncluded: number | null;
  guestsMax: number | null;
  extraGuestPrice: number | null;
  guestsLabel?: string;
}

export interface EstimateAddon {
  id: string;
  name: string;
  price: number | null;
}

export interface EstimateInput {
  packageId: string;
  adults: number | null;
  kids: number | null;
  addons: string[];
}

export interface EstimateLine {
  label: string;
  amount: number;
}

export interface Estimate {
  /** empty = no package yet · recommend = "Help me choose" · priced = a starting estimate */
  kind: 'empty' | 'recommend' | 'priced';
  total: number | null;
  lines: EstimateLine[];
  /** Plain-language notes for amounts we can't price yet ("10 guests: larger groups quoted"). */
  notes: string[];
  /** Selected add-ons whose price is not published yet. */
  onRequest: string[];
  /** Lowest published package price, for "Packages start at …". */
  minPrice: number | null;
  guests: number;
}

const fmt = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** "$1,200" — same output as money() in src/lib/site.ts. */
export const money = (n: number) => fmt.format(n).replace('CA', '');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function computeEstimate(
  data: { packages: EstimatePackage[]; addons: EstimateAddon[] },
  input: EstimateInput,
): Estimate {
  const priced = data.packages.filter((p) => p.priceFrom !== null);
  const minPrice = priced.length ? Math.min(...priced.map((p) => p.priceFrom as number)) : null;

  const chosenAddons = data.addons.filter((a) => input.addons.includes(a.id));
  const addonLines = chosenAddons
    .filter((a) => a.price !== null)
    .map((a) => ({ label: a.name, amount: a.price as number }));
  const onRequest = chosenAddons.filter((a) => a.price === null).map((a) => a.name);

  const given = Math.max(0, input.adults ?? 0) + Math.max(0, input.kids ?? 0);
  const pkg = data.packages.find((p) => p.id === input.packageId);

  if (!pkg) {
    return { kind: 'empty', total: null, lines: [], notes: [], onRequest, minPrice, guests: given };
  }
  if (pkg.priceFrom === null) {
    return { kind: 'recommend', total: null, lines: addonLines, notes: [], onRequest, minPrice, guests: given };
  }

  const included = pkg.guestsIncluded ?? 0;
  const guests = given > 0 ? given : included;
  const lines: EstimateLine[] = [
    { label: `${pkg.name}, ${pkg.guestsLabel ?? `for ${plural(included, 'guest', 'guests')}`}`, amount: pkg.priceFrom },
  ];
  const notes: string[] = [];

  const extra = Math.max(0, guests - included);
  if (extra > 0) {
    if (pkg.extraGuestPrice !== null) {
      lines.push({
        label: `${plural(extra, 'extra guest', 'extra guests')} × ${money(pkg.extraGuestPrice)}`,
        amount: extra * pkg.extraGuestPrice,
      });
    } else if (pkg.guestsMax !== null) {
      if (guests > pkg.guestsMax) notes.push(`${guests} guests: larger groups quoted`);
    } else {
      notes.push(`${guests} guests: extra guests quoted separately`);
    }
  }

  lines.push(...addonLines);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { kind: 'priced', total, lines, notes, onRequest, minPrice, guests };
}
