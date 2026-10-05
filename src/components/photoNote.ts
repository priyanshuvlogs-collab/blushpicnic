// Which pictures need a note beside them — the one rule every page follows (gallery, occasion pages,
// packages, services): a photo whose alt text starts "Placeholder" is a stand-in, and one recorded
// in src/assets/photos/ai-photos.json is an AI illustration. Neither goes into share cards or
// structured data, where the note wouldn't travel with it.
import type { ImageMetadata } from 'astro';
import { isAiPhoto } from '../lib/photos';

export type PhotoKind = 'real' | 'ai' | 'placeholder';

export function photoKind(src: ImageMetadata, alt: string): PhotoKind {
  if (isAiPhoto(src)) return 'ai';
  if (/^placeholder\b/i.test(alt.trim())) return 'placeholder';
  return 'real';
}

/** True for a stand-in or AI picture: keep it out of og:image and JSON-LD. */
export const isStandIn = (src: ImageMetadata, alt: string) => photoKind(src, alt) !== 'real';
