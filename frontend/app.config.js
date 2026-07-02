// Dynamic Expo config wrapping app.json — exists ONLY to support installing a
// dev client side-by-side with the App Store app ("app variant" pattern,
// https://docs.expo.dev/tutorial/eas/multiple-app-variants/).
//
// iOS identifies an app by its bundle identifier: a dev client built with the
// production bundle ID would REPLACE the installed App Store app. EAS builds
// with the `development` profile set APP_VARIANT=development (see eas.json),
// which gives the dev client its own identity:
//   - name "AnimationStation Dev" (so the two icons are distinguishable)
//   - bundle ID ai.animationstation.app.dev (separate app to iOS)
//   - scheme animationstation-dev:// (so deep links don't collide with the store app)
//
// Everything else comes straight from app.json, which remains the single
// source of truth for the production identity. Production/preview builds set
// no APP_VARIANT and pass app.json through untouched.
//
// ⚠️ Known limitation of the dev variant: StoreKit/IAP returns NO products
// (the .dev bundle ID has no App Store Connect app). Test purchases with a
// production-bundle-ID build (TestFlight sandbox) instead.

const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => {
  if (!IS_DEV_VARIANT) return config;

  return {
    ...config,
    name: 'AnimationStation Dev',
    scheme: 'animationstation-dev',
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
    },
    android: {
      ...config.android,
      package: `${config.android.package}.dev`,
    },
  };
};
