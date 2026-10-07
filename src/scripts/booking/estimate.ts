// Live price estimate for the booking form. Pure functions (no DOM) so the maths is easy to test.
// Everything comes from the form schema (packages.yaml / addons.yaml / styles.yaml / settings.yaml
// travel); nothing is hard-coded here except the two service ids that are priced from packages.
//
//   Picnics and proposals (kind "priced"):
//     total = package priceFrom
//           + (adults − guestsIncluded) × extraGuestPrice   (only when extraGuestPrice is known)
//           + picnic style price                             (only when chosen, not included, known)
//           + known add-on prices
//           + travel fee for the area                        (only when the area's fee is known)
//   Every other service (kind "quote"): no total — "We’ll quote this for you" — but the priced
//   add-ons and the travel line/note are still listed so the visitor sees them.
//
// Unknown amounts are never guessed: extra guests without a price become a "quoted" note, add-ons
// with a null price are listed as "price on request", a style or area without a price becomes a
// "quoted" note, and kids beyond the included guests get a "we'll confirm" note (no published price
// for kids yet — packages.yaml only has extraGuestPrice). Kids still count towards a package's guest
// range (guestsMax).
//
// api/book.php builds the same estimate for the owner's email from the same rules: keep the wording
// of every line and note here in step with it.

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

export interface EstimateStyle {
  id: string;
  name: string;
  price: number | null;
  /** comes with every package (the classic low table): never a line or a note */
  included: boolean;
}

export interface EstimateTravel {
  areas: { name: string; fee: number | null }[];
}

export interface EstimateData {
  packages: EstimatePackage[];
  addons: EstimateAddon[];
  styles?: EstimateStyle[];
  travel?: EstimateTravel;
}

export interface EstimateInput {
  /** service id (services.yaml); empty or missing = treated like a picnic */
  service?: string;
  packageId: string;
  adults: number | null;
  kids: number | null;
  addons: string[];
  /** picnic style id (styles.yaml), when that question applies */
  styleId?: string;
  /** the "Which area?" answer, when that question applies */
  area?: string;
}

export interface EstimateLine {
  label: string;
  amount: number;
}

export interface Estimate {
  /** empty = no package yet · recommend = "Help me choose" · priced = a starting estimate · quote = a service we price by hand */
  kind: 'empty' | 'recommend' | 'priced' | 'quote';
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

/** Services priced from a package (everything else is quoted by hand). */
export const PRICED_SERVICES = ['picnics', 'proposals'] as const;
/** The two "area" answers after the travel areas (same strings as AREA_OTHER / AREA_UNSURE in src/lib/form.ts). */
export const AREA_OTHER = 'Somewhere else in the GTA';
export const AREA_UNSURE = 'Not sure yet';
/** Headline for the "quote" kind (also the short text in the mobile bar). */
export const QUOTE_HEADLINE = 'We’ll quote this for you';

const fmt = (digits: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: digits, minimumFractionDigits: digits });

/** "$1,200" or "$22.50" — same output as money() in src/lib/site.ts and Money::format in PHP. */
export const money = (n: number) => fmt(Number.isInteger(n) ? 0 : 2).format(n).replace('CA', '');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Is this service priced from a package? Empty = not chosen yet, treated like a picnic. */
export const isPricedService = (service: string | undefined) => !service || (PRICED_SERVICES as readonly string[]).includes(service);

/** The travel fee as a line (fee known) or a note (quoted). Nothing when no area is chosen. */
function travelFor(travel: EstimateTravel | undefined, area: string | undefined): { line?: EstimateLine; note?: string } {
  const a = (area ?? '').trim();
  if (!a) return {};
  const found = travel?.areas.find((x) => x.name === a);
  if (found) return found.fee !== null ? { line: { label: `Travel to ${found.name}`, amount: found.fee } } : { note: `Travel to ${found.name}: quoted by area` };
  if (a === AREA_UNSURE) return { note: 'Travel: quoted once you choose an area' };
  return { note: 'Travel: quoted by area' }; // "Somewhere else in the GTA" (or any area not in the list)
}

/** A chosen picnic style as a line (price known) or a note (quoted). Nothing for the included style. */
function styleFor(styles: EstimateStyle[] | undefined, styleId: string | undefined): { line?: EstimateLine; note?: string } {
  const st = styleId ? styles?.find((x) => x.id === styleId) : undefined;
  if (!st || st.included) return {};
  return st.price !== null ? { line: { label: st.name, amount: st.price } } : { note: `${st.name}: quoted` };
}

export function computeEstimate(data: EstimateData, input: EstimateInput): Estimate {
  const priced = data.packages.filter((p) => p.priceFrom !== null);
  const minPrice = priced.length ? Math.min(...priced.map((p) => p.priceFrom as number)) : null;

  const chosenAddons = data.addons.filter((a) => input.addons.includes(a.id));
  const addonLines = chosenAddons
    .filter((a) => a.price !== null)
    .map((a) => ({ label: a.name, amount: a.price as number }));
  const onRequest = chosenAddons.filter((a) => a.price === null).map((a) => a.name);
  const travel = travelFor(data.travel, input.area);

  const adults = Math.max(0, input.adults ?? 0);
  const kids = Math.max(0, input.kids ?? 0);
  const given = adults + kids;

  // Room decor and hampers: priced by hand. Add-ons and travel are still listed, nothing is totalled.
  if (!isPricedService(input.service)) {
    const lines = [...addonLines, ...(travel.line ? [travel.line] : [])];
    const notes = travel.note ? [travel.note] : [];
    return { kind: 'quote', total: null, lines, notes, onRequest, minPrice, guests: given };
  }

  const style = styleFor(data.styles, input.styleId);
  const pkg = data.packages.find((p) => p.id === input.packageId);

  if (!pkg) {
    return { kind: 'empty', total: null, lines: [], notes: [], onRequest, minPrice, guests: given };
  }
  if (pkg.priceFrom === null) {
    const lines = [...(style.line ? [style.line] : []), ...addonLines, ...(travel.line ? [travel.line] : [])];
    const notes = [...(style.note ? [style.note] : []), ...(travel.note ? [travel.note] : [])];
    return { kind: 'recommend', total: null, lines, notes, onRequest, minPrice, guests: given };
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
      // Only adults are priced; kids past the included guests are confirmed in the quote.
      const extraAdults = Math.max(0, adults - included);
      if (extraAdults > 0) {
        lines.push({
          label: `${plural(extraAdults, 'extra guest', 'extra guests')} × ${money(pkg.extraGuestPrice)}`,
          amount: extraAdults * pkg.extraGuestPrice,
        });
      }
      const extraKids = Math.min(kids, extra);
      if (extraKids > 0) notes.push(`${plural(extraKids, 'kid', 'kids')}: we’ll confirm pricing in your quote`);
    } else if (pkg.guestsMax !== null) {
      if (guests > pkg.guestsMax) notes.push(`${guests} guests: larger groups quoted`);
    } else {
      notes.push(`${guests} guests: extra guests quoted separately`);
    }
  }

  if (style.line) lines.push(style.line);
  if (style.note) notes.push(style.note);
  lines.push(...addonLines);
  if (travel.line) lines.push(travel.line);
  if (travel.note) notes.push(travel.note);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { kind: 'priced', total, lines, notes, onRequest, minPrice, guests };
}
