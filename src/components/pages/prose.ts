// Fills {tokens} in rendered long-form page HTML (src/content/pages/*.md) with values from
// settings.yaml, so prices, deposit amounts and contact details are never typed twice.
// Unknown {words} are left exactly as written.
import { money, mailUrl, smsUrl, telUrl, type Settings } from '../../lib/site';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Token → HTML. Contact tokens render as links so they work on phones. */
export function tokenMap(s: Settings): Record<string, string> {
  const handle = s.instagramHandle;
  return {
    name: esc(s.name),
    deposit: esc(money(s.deposit.standard)),
    depositPercent: `${s.deposit.largeEventPercent}%`,
    depositSummary: esc(s.deposit.summary),
    taxNote: esc(s.taxNote),
    locationNote: esc(s.locationNote),
    replyTime: esc(s.replyTime),
    serviceArea: esc(s.serviceArea),
    phone: `<a href="${esc(telUrl(s))}" data-track="click_call">${esc(s.phoneDisplay)}</a>`,
    text: `<a href="${esc(smsUrl(s))}" data-track="click_text">${esc(s.phoneDisplay)}</a>`,
    email: `<a href="${esc(mailUrl(s))}" class="break-all">${esc(s.email)}</a>`,
    instagram: `<a href="${esc(s.instagramUrl)}" rel="noopener" data-track="click_instagram">${esc(handle)}</a>`,
  };
}

/** Replace {token} occurrences in an HTML string. Tokens inside attribute values are left alone. */
export function fillTokens(html: string, s: Settings): string {
  const map = tokenMap(s);
  // Split on tags so a token is only ever replaced in text content, never inside an attribute.
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : part.replace(/\{([a-zA-Z]+)\}/g, (m, key: string) => map[key] ?? m)))
    .join('');
}

/** Plain-text version (for meta tags and JSON-LD). */
export function fillTokensText(text: string, s: Settings): string {
  return fillTokens(text, s).replace(/<[^>]+>/g, '');
}

const decode = (t: string) =>
  t
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

/**
 * The page's sections: every <h2 id="…"> in the rendered markdown, in order. Works for raw-HTML
 * headings with explicit ids (which the markdown engine does not report) and for ## headings.
 */
export function h2Sections(html: string): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const m of html.matchAll(/<h2\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/gi)) {
    out.push({ id: m[1], label: decode(m[2]) });
  }
  return out;
}
