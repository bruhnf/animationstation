import type { OriginalImageBadge } from '../components/FullScreenImageModal';

// Identifiers for the four kinds of images that can appear in a Transform carousel.
export type CarouselSlot = 'full' | 'medium' | 'clothing' | 'body';

// A single slide that's been confirmed to have a usable URL.
export interface CarouselSlide {
  url: string;
  aiGenerated: boolean;
  label: string;
  badge: OriginalImageBadge | null;
  slot: CarouselSlot;
}

// Source fields the builder reads off a Transform-shaped object. Both backend
// payloads (Creation from feed/profile/notifications) match this shape.
export interface CarouselSource {
  resultImageUrl?: string | null;
  resultImage2Url?: string | null;
  refImage1Url?: string | null;
  sourceImageUrl?: string | null;
}

/**
 * Build the canonical 4-slide creation carousel. Order is fixed:
 *   1. Full body (AI result)
 *   2. Medium (AI result)
 *   3. Original reference image
 *   4. Original photo used as input
 *
 * Slots whose URL is missing are dropped, but the order of the remaining
 * slots is preserved. The first AI badge is reserved for the result images;
 * the source images carry their own descriptive overlay badges.
 */
export function buildCreationCarousel(source: CarouselSource): CarouselSlide[] {
  const candidates: {
    url?: string | null;
    aiGenerated: boolean;
    label: string;
    badge: OriginalImageBadge | null;
    slot: CarouselSlot;
  }[] = [
    {
      url: source.resultImageUrl,
      aiGenerated: true,
      label: 'Full Body',
      badge: null,
      slot: 'full',
    },
    {
      url: source.resultImage2Url,
      aiGenerated: true,
      label: 'Medium',
      badge: null,
      slot: 'medium',
    },
    {
      url: source.refImage1Url,
      aiGenerated: false,
      label: 'Reference',
      badge: { label: 'Original reference image', iconName: 'image-outline' },
      slot: 'clothing',
    },
    {
      url: source.sourceImageUrl,
      aiGenerated: false,
      label: 'Original Photo',
      badge: { label: 'Original photo', iconName: 'person-outline' },
      slot: 'body',
    },
  ];
  return candidates.filter((c): c is CarouselSlide => !!c.url);
}

/**
 * Returns the index of the named slot inside an already-built carousel, or
 * 0 if it's not present (caller should default to "first available").
 */
export function indexOfSlot(slides: CarouselSlide[], slot: CarouselSlot): number {
  const idx = slides.findIndex((s) => s.slot === slot);
  return idx >= 0 ? idx : 0;
}
