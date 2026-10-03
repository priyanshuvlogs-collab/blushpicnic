// Wording helpers for occasion pages, derived from each occasion's data so new occasions need no code.
import type { Occasion, Package, Settings } from '../../lib/site';
import { money } from '../../lib/site';

const PLACE_WORDS = new Set(['toronto', 'gta', 'ontario', 'on']);

/**
 * Natural phrase for the occasion's picnic, built from its URL slug:
 *   proposal-picnic-toronto        → "proposal picnic"
 *   picnic-date-toronto            → "picnic date"
 *   engagement-picnic-toronto      → "engagement picnic"
 *   be-my-girlfriend-picnic-toronto → "Be My Girlfriend picnic" (keeps the name's capitals)
 * Falls back to "<name> picnic" when the slug has no "picnic" in it.
 */
export function picnicPhrase(o: Occasion): string {
  const name = o.data.name.trim();
  let phrase = o.data.urlSlug
    .split('-')
    .filter((w) => w && !PLACE_WORDS.has(w))
    .join(' ')
    .replace(/\bpicnics\b/, 'picnic');
  if (!/\bpicnic\b/.test(phrase)) phrase = `${name.toLowerCase()} picnic`;
  // "Be My Girlfriend" is a title, not a common noun: keep its capitals.
  const words = name.split(/\s+/);
  const isTitle = words.length > 1 && words.every((w) => /^[A-Z]/.test(w));
  if (isTitle && phrase.includes(name.toLowerCase())) phrase = phrase.replace(name.toLowerCase(), name);
  return phrase;
}

export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "proposal picnics", "picnic dates" */
export const picnicPhrasePlural = (o: Occasion) => {
  const p = picnicPhrase(o);
  return p.endsWith('s') ? p : `${p}s`;
};

/** "Book the Proposal & Romance package" / "Book the Signature Picnic" */
export const bookPackageLabel = (p: Package) => `Book the ${p.data.name}${/picnic$/i.test(p.data.name) ? '' : ' package'}`;

/** "2 guests" from "for 2 guests" */
export const guestsShort = (p: Package) => p.data.guestsLabel.replace(/^for\s+/i, '');

/** "Starting at $375 for 2 guests, before HST" */
export const startingLine = (p: Package, s: Settings) => `Starting at ${money(p.data.priceFrom)} ${p.data.guestsLabel}, ${s.taxNote}`;

/** Trim text to roughly `max` characters on a word boundary. */
export function excerpt(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > 40 ? at : max).replace(/[\s,;:.—–-]+$/, '')}…`;
}
