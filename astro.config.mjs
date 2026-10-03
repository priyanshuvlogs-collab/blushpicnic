// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

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
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [
    sitemap({
      filter: (page) => !/\/(thank-you|404)(\/|$)/.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
