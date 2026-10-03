// /robots.txt — everything public is crawlable; the form handler and the post-booking page are not.
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /thank-you',
    '',
    // `site` comes from astro.config.mjs
    site ? `Sitemap: ${new URL('/sitemap-index.xml', site).href}` : '',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
