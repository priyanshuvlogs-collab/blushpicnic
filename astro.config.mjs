// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Pages that carry <meta name="robots" content="noindex"> (BaseLayout `noindex`) stay out of the
// sitemap too, so the two signals never disagree. Keep this list in step with those pages.
const NOINDEX_PATHS = ['thank-you', '404', 'links'];
const noindexPattern = new RegExp(`/(${NOINDEX_PATHS.join('|')})(/|$)`);

// Self-hosted fonts through Astro's Fonts API: it writes the @font-face rules (see <Font> in
// BaseLayout) and size-matched fallback faces, so text doesn't jump when the web font arrives.
// The Latin file of each is preloaded; Latin Extended only downloads if such a character appears.
/** @type {[string, ...string[]]} */
const LATIN = ['U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+02BB-02BC', 'U+02C6', 'U+02DA', 'U+02DC', 'U+0304', 'U+0308', 'U+0329', 'U+2000-206F', 'U+20AC', 'U+2122', 'U+2191', 'U+2193', 'U+2212', 'U+2215', 'U+FEFF', 'U+FFFD'];
/** @type {[string, ...string[]]} */
const LATIN_EXT = ['U+0100-02BA', 'U+02BD-02C5', 'U+02C7-02CC', 'U+02CE-02D7', 'U+02DD-02FF', 'U+1D00-1DBF', 'U+1E00-1E9F', 'U+1EF2-1EFF', 'U+2020', 'U+20A0-20AB', 'U+20AD-20C0', 'U+2113', 'U+2C60-2C7F', 'U+A720-A7FF'];

// OUT_DIR / CACHE_DIR let several builds run side by side (tests, CI) without clobbering each other.
export default defineConfig({
  site: 'https://blushpicnic.com',
  trailingSlash: 'never',
  outDir: process.env.OUT_DIR || './dist',
  cacheDir: process.env.CACHE_DIR || './node_modules/.astro',
  build: {
    // /packages -> packages.html, served as a clean URL by .htaccess (no trailing slash)
    format: 'file',
    inlineStylesheets: 'auto',
  },
  compressHTML: true,
  // Book links carry data-astro-prefetch, so /book is already loading by the time a finger lifts.
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Cormorant Garamond',
      cssVariable: '--font-cormorant',
      // serif last: Astro then adds a size-matched Times New Roman face ahead of Georgia
      fallbacks: ['Georgia', 'serif'],
      options: {
        variants: [
          { src: ['@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2'], weight: 500, style: 'normal', unicodeRange: LATIN },
          { src: ['@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2'], weight: 600, style: 'normal', unicodeRange: LATIN },
          { src: ['@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff2'], weight: 500, style: 'italic', unicodeRange: LATIN },
          { src: ['@fontsource/cormorant-garamond/files/cormorant-garamond-latin-ext-500-normal.woff2'], weight: 500, style: 'normal', unicodeRange: LATIN_EXT },
          { src: ['@fontsource/cormorant-garamond/files/cormorant-garamond-latin-ext-600-normal.woff2'], weight: 600, style: 'normal', unicodeRange: LATIN_EXT },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'Jost',
      cssVariable: '--font-jost',
      // system-ui last: Astro then size-matches Segoe UI (Windows), Roboto (Android), Helvetica Neue (Apple) and Arial
      fallbacks: ['system-ui'],
      options: {
        variants: [
          { src: ['@fontsource-variable/jost/files/jost-latin-wght-normal.woff2'], weight: '100 900', style: 'normal', unicodeRange: LATIN },
          { src: ['@fontsource-variable/jost/files/jost-latin-ext-wght-normal.woff2'], weight: '100 900', style: 'normal', unicodeRange: LATIN_EXT },
        ],
      },
    },
  ],
  integrations: [
    sitemap({
      filter: (page) => !noindexPattern.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
