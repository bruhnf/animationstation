// AnimationStation design system — dark, futuristic, neon.
//
// Direction (from the product mockup): a deep space-navy canvas with a
// cyan → purple neon accent language, glassy elevated cards, and soft glows.
// This replaces the old gold-on-black theme.
//
// Migration note: legacy keys (white/black/gray*/gold/accent*) are all kept so
// existing screens keep compiling. Their VALUES are retuned for a dark UI:
//   - the grays are unambiguous in this codebase (gray50/100 = backgrounds,
//     gray400/600/800 = text) so remapping them here darkens most screens with
//     no per-file change;
//   - `white`/`black` stay literal because they're used for BOTH backgrounds and
//     text — a property-scoped sweep converts `backgroundColor: Colors.white`
//     and `color: Colors.black` to the semantic tokens below;
//   - `gold*` is repurposed to cyan so any "saved/accent" surface reads on-brand
//     (no yellow).
// Prefer the SEMANTIC tokens (background/surface/textPrimary/…) + Gradients in
// new/redesigned code.

export const Colors = {
  // --- Base surfaces (dark) --------------------------------------------------
  background: '#080B16', // app canvas — deep space navy-black
  backgroundElevated: '#0E1424', // raised sections / scroll backdrops
  surface: '#131A2B', // cards, sheets, inputs
  surfaceElevated: '#1A2338', // hovered/pressed cards, menus
  surfaceGlass: 'rgba(255,255,255,0.05)', // glassmorphic fill over the canvas
  border: 'rgba(255,255,255,0.08)', // hairline dividers / card borders
  borderStrong: 'rgba(255,255,255,0.16)',
  overlay: 'rgba(4,6,12,0.72)', // modal scrim

  // --- Text ------------------------------------------------------------------
  textPrimary: '#EAF0FF',
  textSecondary: '#98A4C4',
  textTertiary: '#5E6B8C',
  textInverse: '#080B16', // text on top of a bright accent fill

  // --- Neon accent system (cyan → purple) ------------------------------------
  accentCyan: '#22D3EE',
  accentBlue: '#4C7DFF',
  accentPurple: '#A855F7',
  accentMagenta: '#F472B6',
  accent: '#22D3EE', // primary accent (cyan) — fills / active states / links
  accentDark: '#12B5D6', // pressed
  accentSoft: 'rgba(34,211,238,0.14)', // tinted accent background
  accentText: '#5FE3F5', // accent-colored text on dark

  // --- Status ----------------------------------------------------------------
  danger: '#FF5C72',
  success: '#34D399',
  warning: '#FBBF24',

  // --- Legacy keys (retuned for dark; kept so existing screens compile) ------
  white: '#FFFFFF',
  black: '#000000',
  gray50: '#0E1424', // was a light bg → dark
  gray100: '#0E1424', // was a light bg → dark
  gray200: 'rgba(255,255,255,0.08)', // borders / faint chips
  gray300: 'rgba(255,255,255,0.14)',
  gray400: '#5E6B8C', // placeholder / tertiary text / muted icons
  gray600: '#98A4C4', // secondary text
  gray800: '#EAF0FF', // was strong dark text → light primary text
  // Saved/bookmark + "free credits" accents were gold; now cyan (no yellow).
  gold: '#22D3EE',
  goldSoft: 'rgba(34,211,238,0.14)',
  goldText: '#5FE3F5',
};

// Neon gradients (consumed by expo-linear-gradient as `colors={...}`).
// Use `Gradients.primary` for the hero CTA, image/video feature cards, etc.
export const Gradients = {
  primary: ['#22D3EE', '#A855F7'] as const, // cyan → purple (hero CTA)
  primarySoft: ['#1FB6D8', '#7C3AED'] as const,
  image: ['#7C3AED', '#C026D3'] as const, // "AI Image Creation" card (purple → magenta)
  video: ['#0EA5E9', '#06B6D4'] as const, // "AI Video Creation" card (blue → teal)
  blue: ['#3B82F6', '#4C7DFF'] as const, // "Advanced AI Models"
  purple: ['#8B5CF6', '#A855F7'] as const, // "Supercharged Performance"
  teal: ['#0D9488', '#10B981'] as const, // "Secure & Private"
  canvasTop: ['#0B1224', '#080B16'] as const, // subtle top-down page wash
} as const;

export const Typography = {
  fontSizeXS: 11,
  fontSizeSM: 13,
  fontSizeMD: 15,
  fontSizeLG: 17,
  fontSizeXL: 20,
  fontSizeXXL: 24,
  fontSizeHero: 30, // big CTA / screen headlines
  fontSizeDisplay: 38, // hero numbers / splash headlines
  fontWeightRegular: '400' as const,
  fontWeightMedium: '500' as const,
  fontWeightSemiBold: '600' as const,
  fontWeightBold: '700' as const,
  fontWeightHeavy: '800' as const,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

// Reusable elevation presets. On the dark theme, cards lean on borders + subtle
// black shadow for depth, and CTAs get a cyan glow.
export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  cta: {
    shadowColor: Colors.accentCyan,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  glowPurple: {
    shadowColor: Colors.accentPurple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
};
