// /robots.txt — everything public is crawlable except the form handler. Pages kept out of search
// (/thank-you, /links, /404) are not blocked here on purpose: crawlers must be able to fetch them to
// see their <meta name="robots" content="noindex">. They are also left out of the sitemap.
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    // `site` comes from astro.config.mjs
    site ? `Sitemap: ${new URL('/sitemap-index.xml', site).href}` : '',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
