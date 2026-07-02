/**
 * Image-prompt safety — pure, unit-tested module.
 *
 * AnimationStation is a general free-form AI image/video generator. Free user
 * text feeding an image generator is still a moderation surface, so the defense
 * stays layered — just relaxed to sexual-content-only for a general app:
 *
 *   1. `validateOutfitDescription` — sanitize + reject sexually explicit content
 *      BEFORE any credit is spent or any call leaves our servers.
 *   2. `buildOutfitPrompt` — the user's text is embedded inside a fixed
 *      server-side wrapper (quoted to mark it as content to render, not
 *      instructions) with light quality guidance.
 *   3. xAI's own content filters — a block surfaces as ContentModeratedError
 *      and feeds the existing moderation-strike machinery (first strikes refund,
 *      repeat offenders stop being refunded).
 *
 * (Internal names like "outfit"/"closet" are kept unchanged to minimize risk;
 * they are not user-visible.)
 */

export const OUTFIT_DESCRIPTION_MIN = 3;
export const OUTFIT_DESCRIPTION_MAX = 300;
export const CLOSET_ITEM_NAME_MAX = 60;

// Sexually-explicit terms only — a general image app blocks pornographic /
// explicit content but allows everything else. Matched on word boundaries,
// case-insensitive. Unlike the old fashion app, 'nude'/'naked' ARE blocked here
// (we are not scoping to clothing, so the "nude = a color" exception no longer
// applies).
const BANNED_TERMS = [
  'naked',
  'nude',
  'nudes',
  'topless',
  'nsfw',
  'explicit',
  'x-rated',
  'porn',
  'pornographic',
  'sex',
  'sexual',
  'erotic',
  'fetish',
  'no clothes',
  'without clothes',
];

// Sexual-content-only policy wording, surfaced on a rejected prompt.
export const OUTFIT_POLICY_MESSAGE =
  'AnimationStation blocks sexually explicit or pornographic content. Please keep prompts non-explicit.';

export type OutfitValidation = { ok: true; cleaned: string } | { ok: false; error: string };

/**
 * True if `text` contains a sexually-explicit banned term (word-boundary,
 * case-insensitive). Single-sources the denylist for callers that need only the
 * screen without the full length/min validation (e.g. the optional multi-image
 * compose prompt).
 */
export function containsBannedTerm(text: string): boolean {
  const lower = text.toLowerCase();
  for (const term of BANNED_TERMS) {
    const re = new RegExp(`(^|[^a-z])${term.replace(/[-\s]/g, '[-\\s]')}([^a-z]|$)`, 'i');
    if (re.test(lower)) return true;
  }
  return false;
}

export function validateOutfitDescription(raw: unknown): OutfitValidation {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Please describe the image you want to create.' };
  }
  // Strip control characters (incl. newlines — the template is single-line so
  // user text can't fake new "instructions" on their own line), collapse runs
  // of whitespace, trim.
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < OUTFIT_DESCRIPTION_MIN) {
    return { ok: false, error: 'Please describe the image in a few words.' };
  }
  if (cleaned.length > OUTFIT_DESCRIPTION_MAX) {
    return {
      ok: false,
      error: `Prompts are limited to ${OUTFIT_DESCRIPTION_MAX} characters.`,
    };
  }

  const lower = cleaned.toLowerCase();
  for (const term of BANNED_TERMS) {
    // Word-boundary match so "sex" hits but e.g. "sextet"/"Essex" never can.
    const re = new RegExp(`(^|[^a-z])${term.replace(/[-\s]/g, '[-\\s]')}([^a-z]|$)`, 'i');
    if (re.test(lower)) {
      return { ok: false, error: OUTFIT_POLICY_MESSAGE };
    }
  }

  return { ok: true, cleaned };
}

/**
 * Wrap the validated description in a fixed server-side text-to-image template.
 * The quotes around the user text mark it as a description to render, not
 * instructions; the surrounding quality guidance is light and does NOT force
 * "no people" or a clothing/catalog framing (this is a general image app).
 */
export function buildOutfitPrompt(cleanedDescription: string): string {
  return (
    'High-quality, detailed image. ' +
    `${cleanedDescription}. ` +
    'Photorealistic where appropriate, well-composed, good lighting.'
  );
}

// ---------------------------------------------------------------------------
// "Surprise me" — server-side creative image-prompt idea generator.
//
// Pure (Math.random injectable for tests). Returns one self-contained,
// imaginative prompt idea to fill the text box. Every idea is ordinary creative
// content and passes validateOutfitDescription by construction. It still flows
// through validate + buildOutfitPrompt at generate time like any typed prompt.
// ---------------------------------------------------------------------------

const SURPRISE_IDEAS = [
  'a neon-lit cyberpunk city street at night, rain reflections',
  'a cozy cabin in a snowy forest at golden hour',
  'a majestic dragon perched on a cliff over the ocean',
  'a retro 1980s diner with chrome and pastel colors',
  'an astronaut floating above a colorful nebula',
  'a whimsical treehouse village in a giant redwood forest',
  'a steampunk airship over Victorian rooftops',
  'a serene Japanese garden with koi pond and cherry blossoms',
  'a vibrant coral reef teeming with tropical fish',
  'a cottagecore kitchen full of fresh bread and flowers',
  'a samurai standing in a bamboo forest at dawn',
  'a futuristic solarpunk city with hanging gardens',
];

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

/**
 * Generate a random, ready-to-edit creative image prompt for the "Surprise me"
 * button. `rand` is injectable so the output is deterministic in tests.
 */
export function randomOutfitIdea(rand: () => number = Math.random): string {
  return pick(SURPRISE_IDEAS, rand);
}

// ---------------------------------------------------------------------------
// Edit / transform an uploaded image per the user's instruction. The base
// prompt is a fixed server-side template; an OPTIONAL user instruction is
// sanitized + denylisted and used as the PRIMARY directive. xAI's filters + the
// strike system handle the long tail (a block throws ContentModeratedError like
// generate/creation).
// ---------------------------------------------------------------------------

export const CLEANUP_INSTRUCTION_MAX = 200;

export const CLEANUP_BASE_PROMPT =
  'Edit the provided image following the user instruction below. Produce a ' +
  'high-quality, coherent result. Keep it non-explicit.';

/**
 * Validate the OPTIONAL edit instruction. Absent/empty is valid (gentle enhance
 * only). Non-empty text is sanitized (control chars stripped, whitespace
 * collapsed), length-capped, and screened against the same sexual-content
 * denylist — rejected BEFORE any credit is spent.
 */
export function validateCleanupInstruction(raw: unknown): OutfitValidation {
  if (raw === undefined || raw === null || raw === '') return { ok: true, cleaned: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'Please enter a valid instruction.' };
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return { ok: true, cleaned: '' };
  if (cleaned.length > CLEANUP_INSTRUCTION_MAX) {
    return {
      ok: false,
      error: `Instructions are limited to ${CLEANUP_INSTRUCTION_MAX} characters.`,
    };
  }
  const lower = cleaned.toLowerCase();
  for (const term of BANNED_TERMS) {
    const re = new RegExp(`(^|[^a-z])${term.replace(/[-\s]/g, '[-\\s]')}([^a-z]|$)`, 'i');
    if (re.test(lower)) return { ok: false, error: OUTFIT_POLICY_MESSAGE };
  }
  return { ok: true, cleaned };
}

/**
 * Build the final edit prompt: the fixed base, then the user's sanitized
 * instruction as the PRIMARY directive when present. With no instruction, fall
 * back to a gentle, faithful enhance.
 */
export function buildCleanupPrompt(cleanedInstruction: string): string {
  if (!cleanedInstruction) {
    return (
      CLEANUP_BASE_PROMPT +
      ' Enhance this image: improve clarity, lighting, and detail while keeping it ' +
      'faithful to the original.'
    );
  }
  return `${CLEANUP_BASE_PROMPT} User instruction: "${cleanedInstruction}".`;
}

/** Derive a short display name for the closet item from the description. */
export function deriveItemName(cleanedDescription: string): string {
  if (cleanedDescription.length <= CLOSET_ITEM_NAME_MAX) {
    return capitalize(cleanedDescription);
  }
  const slice = cleanedDescription.slice(0, CLOSET_ITEM_NAME_MAX);
  const lastSpace = slice.lastIndexOf(' ');
  // Cut at a word boundary when one exists in the back half of the slice.
  const cut = lastSpace > CLOSET_ITEM_NAME_MAX / 2 ? slice.slice(0, lastSpace) : slice;
  return `${capitalize(cut.trimEnd())}…`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
