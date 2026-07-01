// Jest manual mock for expo-video.
//
// The real module is a native module: under jest-expo its native view init
// throws on import ("Cannot read properties of undefined (reading 'prototype')"
// from expo-video/src/VideoPlayer.tsx), which crashes any suite that renders a
// screen importing VideoPlayerModal (e.g. ProfileScreen). A root-level
// __mocks__ entry for a node_modules package is applied automatically to every
// suite, so this fixes the current ProfileScreen test and any future
// HomeScreen/VideoScreen tests on the same import — no per-file jest.mock needed.
//
// Only the surface our components touch is stubbed.
module.exports = {
  useVideoPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    release: jest.fn(),
    replace: jest.fn(),
  })),
  VideoView: 'VideoView',
};
