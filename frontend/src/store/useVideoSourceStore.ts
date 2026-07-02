import { create } from 'zustand';

// Hand-off channel for "MAKE VIDEO!" — when the user taps it on a completed
// creation (e.g. in CreationDetailModal's full-screen carousel), the EXACT image
// currently displayed is parked here and VideoScreen consumes (and clears) it on
// focus, seeding the source box. We pass the image URL (not a jobId) so whatever
// slide the user is looking at — AI full-body, AI medium, the clothing photo, or
// the original body photo — is the one animated, rather than always defaulting
// to the full-body result. A store avoids threading data through navigation
// params on a persistent tab/stack screen (which React Navigation warns about
// and which can go stale), mirroring useClosetStore.
interface PendingVideoSource {
  imageUrl: string;
}

interface VideoSourceStore {
  pendingSource: PendingVideoSource | null;
  setPendingSource: (source: PendingVideoSource) => void;
  consumePendingSource: () => PendingVideoSource | null;
}

export const useVideoSourceStore = create<VideoSourceStore>((set, get) => ({
  pendingSource: null,
  setPendingSource: (source) => set({ pendingSource: source }),
  consumePendingSource: () => {
    const source = get().pendingSource;
    if (source) set({ pendingSource: null });
    return source;
  },
}));
