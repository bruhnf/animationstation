/**
 * Contextual copy for the guest sign-up CTA. Pure + unit-tested so the messaging
 * stays consistent across every guest-gated surface. The "free / no credit card"
 * bullets appear everywhere — that reassurance is the whole point (most apps ask
 * for a card up front; we deliberately don't).
 */

export type SignupContext =
  | 'design'
  | 'video'
  | 'credits'
  | 'inbox'
  | 'profile'
  | 'save'
  | 'generic';

export interface SignupCopy {
  /** Emoji/Ionicon-free headline for the CTA. */
  title: string;
  /** One-line value proposition for this context. */
  message: string;
  /** Reassurance bullets — always lead with the free/no-card promise. */
  bullets: string[];
}

// Shared reassurance shown on every CTA. Order matters: free first, card second.
export const FREE_BULLETS: readonly string[] = [
  '100% free to create your account',
  'No credit card required',
  'No subscription — try everything free',
];

const COPY: Record<SignupContext, { title: string; message: string }> = {
  design: {
    title: 'Generate your own images',
    message: 'Create a free account to generate images with AI and build your library.',
  },
  video: {
    title: 'Animate your photos',
    message: 'Create a free account to turn your photos into short AI videos.',
  },
  credits: {
    title: 'Get more credits — free to join',
    message:
      'Create a free account to top up your credits. Signing up costs nothing and never asks for a card.',
  },
  inbox: {
    title: 'Join the community',
    message: 'Sign up to follow people and get notified about likes and comments on your creations.',
  },
  profile: {
    title: 'Save your creations',
    message:
      'Create a free account to save your creations, build a profile, and pick up where you left off.',
  },
  save: {
    title: 'Save this creation',
    message: 'Create a free account to bookmark creations and find them anytime.',
  },
  generic: {
    title: 'Create your free account',
    message: 'Unlock everything AnimationStation offers — it only takes a moment.',
  },
};

export function getSignupCopy(context: SignupContext): SignupCopy {
  const base = COPY[context] ?? COPY.generic;
  return { ...base, bullets: [...FREE_BULLETS] };
}
