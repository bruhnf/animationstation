import { useClosetStore } from '../useClosetStore';
import { ClosetItem } from '../../types';

const item: ClosetItem = {
  id: 'item-1',
  name: 'Red flannel shirt',
  description: 'red flannel shirt with dark jeans',
  imageUrl: 'https://example.com/closet/item-1.jpg',
  createdAt: new Date().toISOString(),
};

describe('useClosetStore selection hand-off', () => {
  beforeEach(() => {
    useClosetStore.setState({ pendingSelection: null });
  });

  it('starts empty and consume returns null', () => {
    expect(useClosetStore.getState().consumePendingSelection()).toBeNull();
  });

  it('hands a picked item over exactly once', () => {
    useClosetStore.getState().setPendingSelection(item);
    expect(useClosetStore.getState().pendingSelection).toEqual(item);

    const consumed = useClosetStore.getState().consumePendingSelection();
    expect(consumed).toEqual(item);

    // A second consume (e.g. the TryOn tab refocusing) must not re-apply it.
    expect(useClosetStore.getState().consumePendingSelection()).toBeNull();
  });

  it('a newer pick replaces an unconsumed one', () => {
    useClosetStore.getState().setPendingSelection(item);
    const newer = { ...item, id: 'item-2', name: 'Linen blazer' };
    useClosetStore.getState().setPendingSelection(newer);
    expect(useClosetStore.getState().consumePendingSelection()).toEqual(newer);
  });
});
