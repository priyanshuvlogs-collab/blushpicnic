// Cache-busting for the brand files that live at fixed URLs in public/ (favicons, app icons,
// og.jpg, logo.png, /brand/*.svg). Those are cached for 30 days (public/.htaccess), and browsers
// keep favicons in a cache of their own, so a new logo under the same URL would stay hidden
// from returning visitors, the CDN and Google. Every page therefore links them with
// ?v=<first 8 hex of the file's SHA-256>: when `npm run brand` (or a new SVG in public/brand/)
// changes a file, its URL changes on the next build. Nothing to bump by hand.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from './site';

/** Browser UI colour (Blush 100), shared by <meta name="theme-color"> and the manifest. */
export const THEME_COLOR = '#F6E6E1';

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 8);
const memo = new Map<string, string>();

/** '/favicon.svg' → '/favicon.svg?v=1a2b3c4d'. The path is a file in public/ (read at build time). */
export function versioned(path: string): string {
  let url = memo.get(path);
  if (!url) {
    // process.cwd() (the project root), not import.meta.url: Astro bundles this module elsewhere.
    url = `${path}?v=${hash(readFileSync(join(process.cwd(), 'public', path)))}`;
    memo.set(path, url);
  }
  return url;
}

/** The web app manifest (served as /site.webmanifest by src/pages/site.webmanifest.ts). */
export function webManifest(s: Settings): string {
  return (
    JSON.stringify(
      {
        id: '/',
        name: s.name,
        short_name: s.name,
        description: s.description,
        lang: 'en-CA',
        start_url: '/',
        scope: '/',
        display: 'minimal-ui',
        background_color: THEME_COLOR,
        theme_color: THEME_COLOR,
        icons: [
          { src: versioned('/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: versioned('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
          // the artwork sits inside the maskable safe zone, so launchers can show it full-bleed
          { src: versioned('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: versioned('/favicon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      null,
      2,
    ) + '\n'
  );
}

/** Link to the manifest, versioned by its own content (which includes the icons' versions). */
export const manifestUrl = (s: Settings) => `/site.webmanifest?v=${hash(webManifest(s))}`;
