import { create } from 'zustand';

// Tracks the user's CURRENTLY in-flight (or just-finished-but-unacknowledged)
// AI video job so it survives navigation. VideoScreen is a stack screen that
// unmounts when the user leaves it (e.g. taps the Create FAB), which would
// otherwise drop the local activeJob state and present a blank "new video"
// form on return — with the running generation unreachable. By parking the job
// id here, VideoScreen rehydrates and resumes polling on mount, so the user can
// always get back to watch progress, and can't start a second video until the
// current one is done (the form stays hidden behind the ResultView).
//
// In-memory only: a full app kill clears it (the job still finishes server-side
// and appears in Profile history — matching the existing "app killed during
// countdown" behavior). It is set on submit and cleared when the user starts
// over via Make Another / Try Again.
interface VideoJobStore {
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
}

export const useVideoJobStore = create<VideoJobStore>((set) => ({
  activeJobId: null,
  setActiveJobId: (id) => set({ activeJobId: id }),
}));
