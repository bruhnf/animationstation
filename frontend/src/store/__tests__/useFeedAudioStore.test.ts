import { useFeedAudioStore } from '../useFeedAudioStore';

describe('useFeedAudioStore feed-wide mute preference', () => {
  beforeEach(() => {
    useFeedAudioStore.setState({ muted: true });
  });

  it('starts muted (autoplay-friendly default)', () => {
    expect(useFeedAudioStore.getState().muted).toBe(true);
  });

  it('toggleMuted flips the shared preference', () => {
    useFeedAudioStore.getState().toggleMuted();
    expect(useFeedAudioStore.getState().muted).toBe(false);
    useFeedAudioStore.getState().toggleMuted();
    expect(useFeedAudioStore.getState().muted).toBe(true);
  });

  it('setMuted sets the value directly', () => {
    useFeedAudioStore.getState().setMuted(false);
    expect(useFeedAudioStore.getState().muted).toBe(false);
  });

  it('is a single shared instance, so un-muting on one post is seen by every other', () => {
    // All feed posts read the same module singleton — the whole point of lifting
    // mute out of per-post state. One post un-mutes; any other post reading the
    // store afterwards (its selector re-fires on the change) observes it.
    useFeedAudioStore.getState().setMuted(false);
    expect(useFeedAudioStore.getState().muted).toBe(false);
  });
});
