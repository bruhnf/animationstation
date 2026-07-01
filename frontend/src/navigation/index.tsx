import React, { useEffect } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import {
  NavigationContainer,
  NavigatorScreenParams,
  DarkTheme as NavDarkTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useUserStore } from '../store/useUserStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { useConfigStore } from '../store/useConfigStore';
import { Colors, Gradients } from '../constants/theme';

import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import OnboardingPhotoScreen from '../screens/OnboardingPhotoScreen';
import AboutScreen from '../screens/AboutScreen';
import HomeScreen from '../screens/HomeScreen';
import TryOnScreen from '../screens/TryOnScreen';
import ProfileScreen from '../screens/ProfileScreen';
import FriendsScreen from '../screens/FriendsScreen';
import InboxScreen from '../screens/InboxScreen';
import SettingsScreen from '../screens/SettingsScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import AdminConsoleScreen from '../screens/AdminConsoleScreen';
import PurchaseScreen from '../screens/PurchaseScreen';
import PublicProfileScreen from '../screens/PublicProfileScreen';
import BlockedUsersScreen from '../screens/BlockedUsersScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import TryOnCommentsScreen from '../screens/TryOnCommentsScreen';
import GuestProfileScreen from '../screens/GuestProfileScreen';
import ClosetScreen from '../screens/ClosetScreen';
import VideoScreen from '../screens/VideoScreen';
import CompareScreen from '../screens/CompareScreen';
import ReferralScreen from '../screens/ReferralScreen';
import SavedLooksScreen from '../screens/SavedLooksScreen';
import CreateHubScreen from '../screens/CreateHubScreen';
import CleanUpScreen from '../screens/CleanUpScreen';
import DesignScreen from '../screens/DesignScreen';
import SignupCTA from '../components/ui/SignupCTA';
import SplashAnnouncementModal from '../components/SplashAnnouncementModal';
import WelcomeSplash from '../components/WelcomeSplash';
import { navigationRef } from './navigationRef';

export type AuthStackParams = {
  Login: undefined;
  Signup: undefined;
  OnboardingPhoto: undefined;
  // About is reachable pre-signup so prospective users can see the value
  // proposition, tier features, and live StoreKit pricing before being asked
  // to register. Required for App Store Guideline 5.1.1(v) compliance.
  About: undefined;
};

export type MainTabParams = {
  // Home is the global feed — a continuous scroll of every user's public
  // creations. (The neon hub that used to live here is now the admin-toggleable
  // welcome splash.)
  Home: undefined;
  Library: { picker?: boolean } | undefined;
  // Center FAB → the Create hub, the single landing spot for every creation
  // feature (Image, Design, Video, Clean-Up, Library).
  Create: undefined;
  Inbox: undefined;
  Profile: undefined;
};

export type RootStackParams = {
  // Auth is presented as a modal over the app for guest sessions (Sign Up / Log
  // In). For real users it isn't registered — they're already authenticated.
  // Nested params let a CTA deep-link straight to Login or Signup.
  Auth: NavigatorScreenParams<AuthStackParams> | undefined;
  // Nested params let a screen jump straight to a specific tab, e.g. the 3-dot
  // menu's "Animate a Photo" → navigate('Main', { screen: 'Video' }).
  Main: NavigatorScreenParams<MainTabParams> | undefined;
  // Creation feature screens — reached from the Create hub (and some deep-links).
  // Available to guests AND real users (guests use whatever credits they have).
  TryOn: undefined;
  Video: undefined;
  CleanUp: undefined;
  // Outfit Designer (text-to-outfit) — separate from the Closet grid.
  Design: undefined;
  Settings: undefined;
  EditProfile: undefined;
  AdminConsole: undefined;
  Purchase: undefined;
  Friends: { initialTab?: 'following' | 'followers'; openSearch?: boolean };
  PublicProfile: { username: string };
  BlockedUsers: undefined;
  ChangePassword: undefined;
  // Optional commentId is used by inbox notifications (COMMENT_REPLY,
  // COMMENT_LIKE) to deep-link into the thread and auto-scroll/highlight a
  // specific comment after the screen loads.
  TryOnComments: { jobId: string; commentId?: string };
  // Outfit Designer / saved outfits. { picker: true } = opened from the
  // TryOn screen to pick an item (tap hands the item back and pops).
  Closet: { picker?: boolean } | undefined;
  // Compare Looks — pick two completed try-ons and view them side by side.
  Compare: undefined;
  // Invite Friends — referral code, share link, and earnings.
  Referral: undefined;
  // Saved Looks — the user's bookmarked try-on results.
  SavedLooks: undefined;
};

const Stack = createNativeStackNavigator<RootStackParams>();
const AuthStack = createNativeStackNavigator<AuthStackParams>();
const Tab = createBottomTabNavigator<MainTabParams>();

// Dark navigation theme so inter-screen gaps / card transitions render on the
// app's deep-navy canvas instead of React Navigation's default white.
const navTheme = {
  ...NavDarkTheme,
  colors: {
    ...NavDarkTheme.colors,
    background: Colors.background,
    card: Colors.backgroundElevated,
    text: Colors.textPrimary,
    border: Colors.border,
    primary: Colors.accentCyan,
    notification: Colors.accentMagenta,
  },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
      <AuthStack.Screen name="OnboardingPhoto" component={OnboardingPhotoScreen} />
      <AuthStack.Screen name="About" component={AboutScreen} />
    </AuthStack.Navigator>
  );
}

// Center "Create" FAB — the prominent gateway to the Create hub. Neon
// cyan→purple gradient disc with a cyan glow, matching the app's accent system.
function CreateTabIcon({ focused }: { focused: boolean }) {
  return (
    <LinearGradient
      colors={Gradients.primary}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: 60,
        height: 60,
        borderRadius: 30,
        borderWidth: focused ? 2 : 0,
        borderColor: Colors.white,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
        shadowColor: Colors.accentCyan,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.6,
        shadowRadius: 12,
        elevation: 8,
      }}
    >
      <Ionicons name="add" size={34} color={Colors.white} />
    </LinearGradient>
  );
}

// Guest variant of the Inbox tab — following/notifications need a real account,
// so guests get the flashy sign-up CTA. (Design/Video are NOT gated here: guests
// reach them through the Create hub and use whatever credits they have.)
function InboxTabForGuest() {
  return <SignupCTA context="inbox" />;
}

function MainTabs() {
  const { unreadCount, fetchUnreadCount } = useNotificationStore();
  const isGuest = useUserStore((s) => s.user?.isGuest === true);

  useEffect(() => {
    // Guests have no notifications and the /notifications endpoint rejects them
    // (GUEST_SIGNUP_REQUIRED), so don't poll it for guest sessions.
    if (isGuest) return;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60_000);
    return () => clearInterval(interval);
  }, [isGuest]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: Colors.accentCyan,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          backgroundColor: Colors.backgroundElevated,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 72,
          paddingBottom: 12,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Library"
        component={ClosetScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="images" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Create"
        component={CreateHubScreen}
        options={{
          tabBarLabel: '',
          tabBarIcon: ({ focused }) => <CreateTabIcon focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Inbox"
        component={isGuest ? InboxTabForGuest : InboxScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications" size={size} color={color} />
          ),
          tabBarBadge:
            !isGuest && unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Colors.accentMagenta,
            color: Colors.white,
            fontSize: 10,
          },
        }}
      />
      <Tab.Screen
        name="Profile"
        component={isGuest ? GuestProfileScreen : ProfileScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, isInitialized, bootstrapError, sessionEnded, initialize } = useUserStore();
  const fetchConfig = useConfigStore((s) => s.fetchConfig);

  useEffect(() => {
    initialize();
    // Server-controlled promo copy (the join-offer credit amount). Public,
    // best-effort, and never blocks startup — failures keep the default offer.
    fetchConfig();
  }, []);

  if (!isInitialized) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: Colors.surface,
        }}
      >
        <ActivityIndicator size="large" color={Colors.textPrimary} />
      </View>
    );
  }

  // A returning real user's session ended and couldn't be recovered. Show the
  // Login flow so they can sign back into their real account (rather than being
  // silently turned into a guest). On successful login setUser clears
  // sessionEnded and the main app renders. Genuinely new users never reach this
  // — they get a guest session in initialize().
  if (!user && sessionEnded) {
    return (
      <NavigationContainer ref={navigationRef} theme={navTheme}>
        <AuthNavigator />
      </NavigationContainer>
    );
  }

  // Bootstrap couldn't establish ANY session (offline on first launch, or a
  // network failure that we refused to treat as a logout). Show a retry rather
  // than rendering the tabs with a null user.
  if (!user) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: Colors.surface,
          padding: 32,
        }}
      >
        <Text
          style={{ fontSize: 16, color: Colors.gray600, textAlign: 'center', marginBottom: 20 }}
        >
          {bootstrapError
            ? "Couldn't connect. Check your internet connection and try again."
            : 'Loading…'}
        </Text>
        <TouchableOpacity
          onPress={() => initialize()}
          style={{
            backgroundColor: Colors.accent,
            borderRadius: 24,
            paddingVertical: 12,
            paddingHorizontal: 28,
          }}
        >
          <Text style={{ color: Colors.textInverse, fontWeight: '700' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isGuest = user.isGuest === true;

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* Main tabs render for BOTH guest and real users — a guest always has a
            session, so there's no sign-in wall. The screens below differ by
            account state. */}
        <Stack.Screen name="Main" component={MainTabs} />

        {/* Browsable surfaces — available to guests AND real users. */}
        <Stack.Screen
          name="PublicProfile"
          component={PublicProfileScreen}
          options={{ presentation: 'card', headerShown: false }}
        />
        <Stack.Screen
          name="TryOnComments"
          component={TryOnCommentsScreen}
          options={{ presentation: 'card', headerShown: false }}
        />
        {/* Friends (following/followers) lives off the tab bar — reached from the
            feed and Profile links. Inbox is a tab again (see MainTabs). */}
        <Stack.Screen
          name="Friends"
          component={FriendsScreen}
          options={{ presentation: 'card', headerShown: false }}
        />
        <Stack.Screen
          name="Purchase"
          component={PurchaseScreen}
          options={{ presentation: 'modal', headerShown: false }}
        />

        {/* Creation features — reached from the Create hub. Available to guests
            AND real users (guests spend whatever credits they have; the screens
            handle out-of-credits + sign-up nudges). */}
        <Stack.Screen
          name="TryOn"
          component={TryOnScreen}
          options={{ presentation: 'card', headerShown: false }}
        />
        <Stack.Screen
          name="Video"
          component={VideoScreen}
          options={{ presentation: 'card', headerShown: false }}
        />
        <Stack.Screen
          name="CleanUp"
          component={CleanUpScreen}
          options={{ presentation: 'card', headerShown: false }}
        />
        <Stack.Screen
          name="Design"
          component={DesignScreen}
          options={{ presentation: 'card', headerShown: false }}
        />
        <Stack.Screen
          name="Closet"
          component={ClosetScreen}
          options={{ presentation: 'card', headerShown: false }}
        />

        {!isGuest ? (
          // Compare Looks — real accounts only (operates on the user's own
          // try-on history).
          <Stack.Screen
            name="Compare"
            component={CompareScreen}
            options={{ presentation: 'card', headerShown: false }}
          />
        ) : null}

        {!isGuest ? (
          // Invite Friends / referral — real accounts only.
          <Stack.Screen
            name="Referral"
            component={ReferralScreen}
            options={{ presentation: 'card', headerShown: false }}
          />
        ) : null}

        {!isGuest ? (
          // Saved Looks — real accounts only.
          <Stack.Screen
            name="SavedLooks"
            component={SavedLooksScreen}
            options={{ presentation: 'card', headerShown: false }}
          />
        ) : null}

        {isGuest ? (
          // Guest-only: the Sign Up / Log In flow, presented as a modal over the
          // app. On successful login/conversion the store flips user.isGuest to
          // false and this whole branch is replaced by the real-user screens.
          <Stack.Screen name="Auth" component={AuthNavigator} options={{ presentation: 'modal' }} />
        ) : (
          <>
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ presentation: 'modal', headerShown: true, title: 'Settings' }}
            />
            <Stack.Screen
              name="EditProfile"
              component={EditProfileScreen}
              options={{ presentation: 'modal', headerShown: true, title: 'Edit Profile' }}
            />
            {/* AdminConsole is only registered for users in the ADMIN_EMAILS allowlist
                or in dev builds. Defense in depth on top of the Settings UI gate, so
                a malicious deep-link cannot reach the screen on a normal user's device. */}
            {__DEV__ || user.isAdmin ? (
              <Stack.Screen
                name="AdminConsole"
                component={AdminConsoleScreen}
                options={{ presentation: 'modal', headerShown: false }}
              />
            ) : null}
            <Stack.Screen
              name="BlockedUsers"
              component={BlockedUsersScreen}
              // Modal presentation so this screen stacks ABOVE the Settings modal
              // when launched from there. A 'card' presentation would push to the
              // parent stack and render underneath.
              options={{ presentation: 'modal', headerShown: false }}
            />
            <Stack.Screen
              name="ChangePassword"
              component={ChangePasswordScreen}
              // Modal so it stacks above Settings (where it's launched from).
              options={{ presentation: 'modal', headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
      {/* Backend-controlled launch announcement (promos / service notices).
          Mounted once per cold start, over the whole app, for guests and real
          users alike. Renders nothing when no splash is published. */}
      <SplashAnnouncementModal />
      {/* Admin-toggleable welcome hub splash (the neon "Imagine. Create.
          Transcend." screen). Gated on the welcomeSplashEnabled config flag +
          the user's local opt-out. Renders nothing when off. */}
      <WelcomeSplash />
    </NavigationContainer>
  );
}
