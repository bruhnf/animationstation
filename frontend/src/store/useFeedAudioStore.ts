import { create } from 'zustand';

// Session-wide mute preference for feed videos. Each feed post owns its own
// expo-video player, so mute used to be local per-post state — the viewer had
// to un-mute every clip again after scrolling. This shared store lifts the
// preference above any single video: once the viewer un-mutes (or mutes) in the
// feed, every other feed video follows, for the rest of the scrolling session,
// until they toggle it again.
//
// In-memory only (not persisted): the feed intentionally starts muted on each
// fresh app launch — the platform-standard, autoplay-friendly default — and the
// preference is meant to hold "while scrolling", not across restarts.
interface FeedAudioStore {
  muted: boolean;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
}

export const useFeedAudioStore = create<FeedAudioStore>((set) => ({
  muted: true,
  setMuted: (muted) => set({ muted }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
}));
