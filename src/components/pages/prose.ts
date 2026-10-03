// Helpers for long-form pages (src/content/pages/*.md): {token} filling and section lists.

// Token filling now lives in src/lib/tokens.ts (shared with occasion pages and FAQs, and it knows
// package prices too). These re-exports keep the page components' imports short.
export { fillTokensHtml as fillTokens, fillTokensText } from '../../lib/tokens';

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
  const clean = html.replace(/<!--[\s\S]*?-->/g, ''); // editing notes may mention <h2 id="…">
  for (const m of clean.matchAll(/<h2\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/gi)) {
    out.push({ id: m[1], label: decode(m[2]) });
  }
  return out;
}
