import { create } from 'zustand';
import { ClosetItem } from '../types';

// Hand-off channel between ClosetScreen and TransformScreen. When the user picks a
// closet item to transform, the item is parked here and the closet screen pops;
// TransformScreen consumes (and clears) it on focus. A store avoids passing
// non-serializable callbacks through navigation params (React Navigation
// warns) and survives the tab/stack split between the two screens.
interface ClosetSelectionStore {
  pendingSelection: ClosetItem | null;
  setPendingSelection: (item: ClosetItem) => void;
  consumePendingSelection: () => ClosetItem | null;
}

export const useClosetStore = create<ClosetSelectionStore>((set, get) => ({
  pendingSelection: null,
  setPendingSelection: (item) => set({ pendingSelection: item }),
  consumePendingSelection: () => {
    const item = get().pendingSelection;
    if (item) set({ pendingSelection: null });
    return item;
  },
}));
