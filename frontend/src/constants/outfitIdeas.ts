// Curated prompts + modifier chips for the image generator.
//
// These are pure UX scaffolding on top of the free-text box: "Surprise me"
// drops in a full ready-to-generate description, and the style/lighting chips
// append a modifier word. All of it still flows through the server-side
// validation, so this never widens the moderation surface — it just removes
// the blank-box friction that kills text-to-image features.

export const SURPRISE_PROMPTS: string[] = [
  'a neon cyberpunk city at night, rain-slicked streets reflecting the signs',
  'a colossal dragon soaring over a stormy ocean at sunset',
  'a cozy snowy cabin glowing warm against a pine forest under the aurora',
  'an astronaut drifting through a vivid purple nebula full of stars',
  'a lone samurai standing in a misty bamboo forest at dawn',
  'a lush solarpunk city with vertical gardens and glass towers',
  'a retro 1950s diner at night, chrome and neon under a starry sky',
  'a vibrant coral reef teeming with fish and shafts of sunlight',
  'a tranquil Japanese garden with a red bridge over a koi pond',
  'a steampunk airship floating above a sea of clouds at golden hour',
  'a mystical library with floating candles and towering bookshelves',
  'a fox curled up in a field of glowing wildflowers under moonlight',
  'a futuristic desert outpost beneath twin suns and a dust storm',
  'a whimsical treehouse village connected by rope bridges in a giant forest',
  'a lighthouse on a rugged cliff braving crashing waves in a storm',
  'a hot air balloon festival drifting over rolling green hills at sunrise',
];

// Tapping a chip appends its phrase to the description so the user can still
// see and edit the full prompt. Kept short and unambiguous.
export const STYLE_CHIPS: string[] = [
  'photorealistic',
  'cinematic',
  'anime',
  'watercolor',
  '3D render',
  'vintage film',
  'surreal',
  'minimalist',
];

export const OCCASION_CHIPS: string[] = [
  'golden hour',
  'neon lighting',
  'dramatic shadows',
  'soft pastel',
  'black and white',
  'vibrant colors',
];

export function randomSurprisePrompt(exclude?: string): string {
  const pool = exclude ? SURPRISE_PROMPTS.filter((p) => p !== exclude) : SURPRISE_PROMPTS;
  const list = pool.length > 0 ? pool : SURPRISE_PROMPTS;
  return list[Math.floor(Math.random() * list.length)];
}
