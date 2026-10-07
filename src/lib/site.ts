// Typed helpers over the content collections. Components import from here rather than
// calling getCollection directly, so sorting and lookups stay consistent site-wide.
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { getTokenMaps, fillDeep, fillText, literalPrices } from './tokens';

export type Settings = CollectionEntry<'settings'>['data'];
export type Package = CollectionEntry<'packages'>;
export type Addon = CollectionEntry<'addons'>;
export type Style = CollectionEntry<'styles'>;
export type Service = CollectionEntry<'services'>;
export type Occasion = CollectionEntry<'occasions'>;
export type Faq = CollectionEntry<'faqs'>;
export type GalleryItem = CollectionEntry<'gallery'>;
export type Review = CollectionEntry<'reviews'>;
export type FormGroup = CollectionEntry<'formGroups'>;

const byOrder = <T extends { data: { order: number } }>(a: T, b: T) => a.data.order - b.data.order;

export async function getSettings(): Promise<Settings> {
  const entry = await getEntry('settings', 'site');
  if (!entry) throw new Error('src/content/settings.yaml must contain a "site" entry');
  const d = entry.data;
  // Sentences shown on the page get typographer's quotes (not smsBody: a ’ makes a text message cost more).
  return {
    ...d,
    description: smartQuotes(d.description),
    tagline: smartQuotes(d.tagline),
    heroAlt: smartQuotes(d.heroAlt),
    locationNote: smartQuotes(d.locationNote),
    travel: { ...d.travel, note: smartQuotes(d.travel.note) },
    deposit: { ...d.deposit, summary: smartQuotes(d.deposit.summary) },
    securityDeposit: { ...d.securityDeposit, summary: smartQuotes(d.securityDeposit.summary) },
  };
}

/** Typographer's quotes in every string of a data entry (images and other objects are left alone). */
function smartDeep<T extends { data: object }>(entry: T): T {
  const data = Object.fromEntries(
    Object.entries(entry.data).map(([k, v]) => [
      k,
      typeof v === 'string' ? smartQuotes(v) : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? smartQuotes(x) : x)) : v,
    ]),
  );
  return { ...entry, data };
}

export const getPackages = async () => (await getCollection('packages')).sort(byOrder).map(smartDeep);
export const getAddons = async () => (await getCollection('addons')).sort(byOrder).map(smartDeep);
export const getStyles = async () => (await getCollection('styles')).sort(byOrder).map(smartDeep);
export const getServices = async () => (await getCollection('services')).sort(byOrder).map(smartDeep);

// Occasion frontmatter and FAQ answers may contain {tokens} (see src/lib/tokens.ts); they are
// filled here so every page gets real values. The occasion body is filled where it's rendered.
const warned = new Set<string>();
function warnLiteralPrices(where: string, text: string) {
  const found = literalPrices(text);
  if (found.length && !warned.has(where)) {
    warned.add(where);
    console.warn(`[content] ${where} contains a typed price (${found.join(', ')}). Use a token like {price:signature} or {deposit} so it updates with packages.yaml/settings.yaml.`);
  }
}

export async function getOccasions() {
  const maps = await getTokenMaps();
  return (await getCollection('occasions')).sort(byOrder).map((o) => {
    warnLiteralPrices(`src/content/occasions/${o.id}.md`, JSON.stringify({ ...o.data, heroImage: undefined }) + (o.body ?? ''));
    const data = fillDeep(o.data, maps);
    if (data.metaDescription.length > 160 && !warned.has(o.id + ':meta')) {
      warned.add(o.id + ':meta');
      console.warn(`[content] src/content/occasions/${o.id}.md: metaDescription is ${data.metaDescription.length} characters once filled in — keep it under 160.`);
    }
    return { ...o, data };
  });
}

export async function getFaqs() {
  const maps = await getTokenMaps();
  return (await getCollection('faqs')).sort(byOrder).map((f) => {
    warnLiteralPrices(`src/content/faqs.yaml (${f.id})`, f.data.answer + f.data.question);
    return { ...f, data: { ...f.data, question: fillText(f.data.question, maps), answer: fillText(f.data.answer, maps) } };
  });
}
export const getGallery = async () => (await getCollection('gallery')).sort(byOrder);
// Read once per build: while reviews.yaml is empty, every read logs a "collection is empty" warning,
// and one per page would bury the warnings that matter. (In `astro dev` it's re-read each time.)
let reviews: Promise<Review[]> | undefined;
export const getReviews = () => (import.meta.env.PROD ? (reviews ??= getCollection('reviews')) : getCollection('reviews'));
export const getFormGroups = async () =>
  (await getCollection('formGroups')).sort((a, b) => a.data.step - b.data.step || a.data.order - b.data.order);

export async function getPackage(id: string) {
  const p = await getEntry('packages', id);
  if (!p) throw new Error(`Unknown package "${id}"`);
  return smartDeep(p);
}

export async function getOccasion(id: string) {
  return (await getOccasions()).find((o) => o.id === id);
}

/** "$1,200" — whole dollars, Canadian formatting. */
export function money(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2; // "$1,200" or "$22.50" — the same as Money::format in the PHP handler
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: digits, minimumFractionDigits: digits })
    .format(n)
    .replace('CA', '');
}

/** "2 hours" / "2.5 hours" */
export function hours(h: number): string {
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** Booking deep link, e.g. /book?occasion=proposal&package=proposal-romance or /book?service=room-decor */
export function bookUrl(opts: { service?: string; occasion?: string; package?: string } = {}): string {
  const params = new URLSearchParams();
  if (opts.service) params.set('service', opts.service);
  if (opts.occasion) params.set('occasion', opts.occasion);
  if (opts.package) params.set('package', opts.package);
  const qs = params.toString();
  return qs ? `/book?${qs}` : '/book';
}

/** URL of an occasion landing page. */
export const occasionUrl = (o: Occasion) => `/${o.data.urlSlug}`;

/** sms: link with a pre-written message (works on iOS and Android). */
export function smsUrl(s: Settings): string {
  return `sms:${s.phoneE164}?&body=${encodeURIComponent(s.smsBody)}`;
}
export const telUrl = (s: Settings) => `tel:${s.phoneE164}`;
export const mailUrl = (s: Settings) => `mailto:${s.email}`;
/** Opens an Instagram DM thread on mobile, the profile on desktop. */
export const igDmUrl = (s: Settings) => `https://ig.me/m/${s.instagramHandle.replace(/^@/, '')}`;

/**
 * Typographer's quotes for copy typed with straight ones in YAML/frontmatter, matching the Markdown
 * bodies: it's → it’s, "Yes" → “Yes”, 'Yes' → ‘Yes’.
 */
export function smartQuotes(text: string): string {
  const open = /(^|[\s([{\u2014\u2013/-])/.source;
  return text
    .replace(/([\p{L}\p{N}])'(?=[\p{L}\p{N}])/gu, '$1\u2019')
    .replace(new RegExp(`${open}"`, 'gu'), '$1\u201c')
    .replace(/"/g, '\u201d')
    .replace(new RegExp(`${open}'`, 'gu'), '$1\u2018')
    .replace(/'/g, '\u2019');
}

/** Tiny, safe markdown for short data strings: **bold** and [text](/link). Escapes everything else. */
export function inlineMd(text: string): string {
  const esc = smartQuotes(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/|mailto:|tel:)[^)\s]*)\)/g, '<a href="$2">$1</a>');
}

/** Plain-text version of inlineMd input (for JSON-LD and meta tags). */
export const plainMd = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
