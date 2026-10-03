// Typed helpers over the content collections. Components import from here rather than
// calling getCollection directly, so sorting and lookups stay consistent site-wide.
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';

export type Settings = CollectionEntry<'settings'>['data'];
export type Package = CollectionEntry<'packages'>;
export type Addon = CollectionEntry<'addons'>;
export type Occasion = CollectionEntry<'occasions'>;
export type Faq = CollectionEntry<'faqs'>;
export type GalleryItem = CollectionEntry<'gallery'>;
export type Review = CollectionEntry<'reviews'>;
export type FormGroup = CollectionEntry<'formGroups'>;

const byOrder = <T extends { data: { order: number } }>(a: T, b: T) => a.data.order - b.data.order;

export async function getSettings(): Promise<Settings> {
  const entry = await getEntry('settings', 'site');
  if (!entry) throw new Error('src/content/settings.yaml must contain a "site" entry');
  return entry.data;
}

export const getPackages = async () => (await getCollection('packages')).sort(byOrder);
export const getAddons = async () => (await getCollection('addons')).sort(byOrder);
export const getOccasions = async () => (await getCollection('occasions')).sort(byOrder);
export const getFaqs = async () => (await getCollection('faqs')).sort(byOrder);
export const getGallery = async () => (await getCollection('gallery')).sort(byOrder);
export const getReviews = async () => await getCollection('reviews');
export const getFormGroups = async () =>
  (await getCollection('formGroups')).sort((a, b) => a.data.step - b.data.step || a.data.order - b.data.order);

export async function getPackage(id: string) {
  const p = await getEntry('packages', id);
  if (!p) throw new Error(`Unknown package "${id}"`);
  return p;
}

export async function getOccasion(id: string) {
  return getEntry('occasions', id);
}

/** "$1,200" — whole dollars, Canadian formatting. */
export function money(n: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0, minimumFractionDigits: 0 })
    .format(n)
    .replace('CA', '');
}

/** "2 hours" / "2.5 hours" */
export function hours(h: number): string {
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** Booking deep link, e.g. /book?occasion=proposal&package=proposal-romance */
export function bookUrl(opts: { occasion?: string; package?: string } = {}): string {
  const params = new URLSearchParams();
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

/** Tiny, safe markdown for short data strings: **bold** and [text](/link). Escapes everything else. */
export function inlineMd(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/|mailto:|tel:)[^)\s]*)\)/g, '<a href="$2">$1</a>');
}

/** Plain-text version of inlineMd input (for JSON-LD and meta tags). */
export const plainMd = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
