export const Colors = {
  black: '#000000',
  white: '#FFFFFF',
  gray50: '#FAFAFA',
  gray100: '#F5F5F5',
  gray200: '#E8E8E8',
  gray300: '#D4D4D4',
  gray400: '#AAAAAA',
  gray600: '#666666',
  gray800: '#222222',
  danger: '#E53935',
  success: '#43A047',
  warning: '#FB8C00',
  // Saved/bookmarked state (yellow).
  gold: '#FFCC00',

  // --- Accent system (2026 UX redesign — gold-on-black) ---------------------
  // The brand pop is GOLD on black, echoing the "Design Your Own Outfit" card.
  // Discipline: `accent` (bright gold) is for FILLS and on-dark surfaces; on
  // light surfaces use `accentText` (dark gold) so text stays readable. Black +
  // white remain the base; gold is the punch.
  accent: '#FFCC00', // bright gold — fills / on-dark / CTA pop (black text on top)
  accentDark: '#E0B400', // pressed / stronger gold
  accentSoft: '#FFF6D6', // tinted gold card/banner background
  accentText: '#8A6D00', // accessible dark-gold text on light surfaces
  goldSoft: '#FFF6D6', // tinted "free credits" background (== accentSoft)
  goldText: '#8A6D00', // accessible dark gold (== accentText)
};

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

// Reusable elevation presets (iOS shadow + Android elevation) so cards/CTAs
// share a consistent depth language.
export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cta: {
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
};
