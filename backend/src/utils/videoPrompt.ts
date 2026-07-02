// Motion-prompt handling for the AI Video feature. The user describes what the
// person in the source image should do ("wave and smile", "do a backflip",
// "morph into a cat"). Pure + dependency-free so it's unit-testable.
//
// Unlike the Outfit Designer, the motion prompt is NOT embedded in a fixed
// template — it's passed to Grok's video model directly — so xAI's own content
// moderation is the safety layer (the worker maps a moderation block to the
// same strike/grace policy as a creation). We still sanitize: trim, strip control
// characters, and enforce a sane length so junk/oversized input can't reach the
// API or the DB column (VARCHAR 300).

export const MOTION_PROMPT_MIN = 2;
export const MOTION_PROMPT_MAX = 300;

export interface MotionPromptResult {
  ok: boolean;
  value?: string; // sanitized prompt when ok
  error?: string; // user-facing reason when not ok
}

/**
 * Validate + normalize a user motion prompt. Strips control chars, collapses
 * runs of whitespace, trims, and length-checks. Returns { ok:false, error } for
 * anything unusable so the controller can return a 400.
 */
export function sanitizeMotionPrompt(raw: unknown): MotionPromptResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Describe what you want the image to do.' };
  }
  const cleaned = raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < MOTION_PROMPT_MIN) {
    return { ok: false, error: 'Describe what you want the image to do.' };
  }
  if (cleaned.length > MOTION_PROMPT_MAX) {
    return { ok: false, error: `Keep it under ${MOTION_PROMPT_MAX} characters.` };
  }
  return { ok: true, value: cleaned };
}
