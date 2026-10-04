// Which photos in src/assets/photos/ are AI illustrations rather than real Blush Picnic events.
// scripts/ai-photos.mjs records every image it generates (with its SHA-256) in
// src/assets/photos/ai-photos.json; `npm run photos` removes a file from that list when a real photo
// replaces it — so labels appear and disappear on their own, with nothing to edit by hand.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImageMetadata } from 'astro';

// process.cwd() (the project root), not import.meta.url: Astro bundles this module elsewhere.
const DIR = join(process.cwd(), 'src/assets/photos');
const LOG = join(DIR, 'ai-photos.json');
const log: Record<string, { sha256?: string }> = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : {};
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
// Still AI only while the file is byte-for-byte the generated one: a photo replaced any other way
// (e.g. uploaded on GitHub under the same name) loses its label by itself.
const stems = new Set(
  Object.entries(log)
    .filter(([file, meta]) => existsSync(join(DIR, file)) && (!meta.sha256 || sha256(join(DIR, file)) === meta.sha256))
    .map(([file]) => file.replace(/\.[^.]+$/, '')),
);

/** File name without extension, from an imported image: "/_astro/hero.Bx1y2z.jpg" or "/@fs/…/hero.jpg?…" → "hero". */
const stem = (img: ImageMetadata) => (img.src.split('?')[0].split('/').pop() ?? '').split('.')[0];

/** True when this imported photo was generated with AI (and not yet replaced by a real photo). */
export const isAiPhoto = (img: ImageMetadata) => stems.has(stem(img));

/** True when any AI illustration is still in use, for site-wide notes. */
export const anyAiPhotos = () => stems.size > 0;
