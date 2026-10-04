// {tokens} let copy in Markdown/YAML mention prices, deposits and contact details without typing
// them twice. They are filled from settings.yaml and packages.yaml at build time, so changing a
// price in packages.yaml updates every page that mentions it.
//
// Available tokens
//   {name} {phone} {text} {email} {instagram} {tiktok} {replyTime} {serviceArea} {taxNote} {locationNote}
//   {deposit} {depositPercent} {depositSummary} {securityDeposit} {securityReturned} {securityDepositSummary}
//   Per package (ids: signature, proposal-romance, celebration):
//   {price:signature} → $375   {guests:signature} → 2 guests   {hours:signature} → 2 hours
//   {extraGuest:signature} → $35   {package:signature} → Signature Picnic   {guestsMax:celebration} → 8
// Unknown {words} are left exactly as written.
import { getSettings, getPackages, money, hours, mailUrl, smsUrl, telUrl, smartQuotes, type Settings, type Package } from './site';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TOKEN = /\{([a-zA-Z]+(?::[a-z0-9-]+)?)\}/g;

export interface TokenMaps {
  /** token → HTML (contact tokens become links) */
  html: Record<string, string>;
  /** token → plain text (meta tags, JSON-LD, attribute-safe strings) */
  text: Record<string, string>;
}

export function buildTokenMaps(s: Settings, packages: Package[]): TokenMaps {
  const text: Record<string, string> = {
    name: s.name,
    phone: s.phoneDisplay,
    text: s.phoneDisplay,
    email: s.email,
    instagram: s.instagramHandle,
    tiktok: s.tiktokHandle,
    replyTime: s.replyTime,
    serviceArea: s.serviceArea,
    taxNote: s.taxNote,
    locationNote: s.locationNote,
    deposit: money(s.deposit.standard),
    depositPercent: `${s.deposit.largeEventPercent}%`,
    depositSummary: s.deposit.summary,
    securityDeposit: money(s.securityDeposit.amount),
    securityReturned: s.securityDeposit.returnedWithin,
    securityDepositSummary: s.securityDeposit.summary,
  };
  for (const p of packages) {
    const d = p.data;
    text[`price:${p.id}`] = money(d.priceFrom);
    text[`guests:${p.id}`] = d.guestsLabel.replace(/^for\s+/i, '');
    text[`hours:${p.id}`] = hours(d.durationHours);
    text[`package:${p.id}`] = d.name;
    if (d.extraGuestPrice !== null) text[`extraGuest:${p.id}`] = money(d.extraGuestPrice);
    if (d.guestsMax !== null) text[`guestsMax:${p.id}`] = String(d.guestsMax);
  }

  for (const k of Object.keys(text)) text[k] = smartQuotes(text[k]);

  const html: Record<string, string> = Object.fromEntries(Object.entries(text).map(([k, v]) => [k, esc(v)]));
  html.phone = `<a href="${esc(telUrl(s))}" data-track="click_call">${esc(s.phoneDisplay)}</a>`;
  html.text = `<a href="${esc(smsUrl(s))}" data-track="click_text">${esc(s.phoneDisplay)}</a>`;
  html.email = `<a href="${esc(mailUrl(s))}" class="break-all">${esc(s.email)}</a>`;
  html.instagram = `<a href="${esc(s.instagramUrl)}" rel="noopener" data-track="click_instagram">${esc(s.instagramHandle)}</a>`;
  html.tiktok = `<a href="${esc(s.tiktokUrl)}" rel="noopener" data-track="click_tiktok">${esc(s.tiktokHandle)}</a>`;
  return { html, text };
}

let cached: Promise<TokenMaps> | undefined;
/** Token maps from the current data files (cached for the duration of a build). */
export function getTokenMaps(): Promise<TokenMaps> {
  cached ??= Promise.all([getSettings(), getPackages()]).then(([s, p]) => buildTokenMaps(s, p));
  return cached;
}

/** Replace tokens in an HTML string — only in text content, never inside tags/attributes. */
export function fillHtml(html: string, maps: TokenMaps): string {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : part.replace(TOKEN, (m, key: string) => maps.html[key] ?? m)))
    .join('');
}

/**
 * Replace tokens in plain text (the result is still plain text; escape it as usual when rendering).
 * Straight quotes become typographer's quotes, so YAML copy matches the Markdown bodies.
 */
export function fillText(text: string, maps: TokenMaps): string {
  return smartQuotes(text.replace(TOKEN, (m, key: string) => maps.text[key] ?? m));
}

/** Recursively fill tokens in every string of a data object (frontmatter, YAML entries). */
export function fillDeep<T>(value: T, maps: TokenMaps): T {
  if (typeof value === 'string') return fillText(value, maps) as T;
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, maps)) as T;
  if (value && typeof value === 'object' && !(value as object).constructor?.name?.includes('Image') && !('src' in (value as object) && 'width' in (value as object))) {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, fillDeep(v, maps)])) as T;
  }
  return value;
}

export const fillTokensHtml = async (html: string) => fillHtml(html, await getTokenMaps());
export const fillTokensText = async (text: string) => fillText(text, await getTokenMaps());

/** Literal dollar amounts in copy that should probably be tokens (warned about at build time). */
export function literalPrices(text: string): string[] {
  return [...text.matchAll(/\$\d[\d,]*/g)].map((m) => m[0]);
}
