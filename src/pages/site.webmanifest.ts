// /site.webmanifest — name and description from settings.yaml, icons from `npm run brand`, each
// with its ?v= content hash (src/lib/brand.ts) so a new app icon replaces the old one.
import type { APIRoute } from 'astro';
import { getSettings } from '../lib/site';
import { webManifest } from '../lib/brand';

export const GET: APIRoute = async () =>
  new Response(webManifest(await getSettings()), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
