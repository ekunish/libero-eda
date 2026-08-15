import { create } from "zustand";

type PlaybackState = {
  frame: number;
  maxFrame: number;
  fps: number;
  speed: number;
  playing: boolean;
  loop: boolean;
  setFrame: (frame: number) => void;
  configure: (maxFrame: number, fps: number) => void;
  togglePlaying: () => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setLoop: (loop: boolean) => void;
  step: (delta: number) => void;
  reset: () => void;
};

export const usePlayback = create<PlaybackState>((set, get) => ({
  frame: 0,
  maxFrame: 0,
  fps: 20,
  speed: 1,
  playing: false,
  loop: true,
  setFrame: (frame) => set({ frame: Math.max(0, Math.min(get().maxFrame, Math.round(frame))) }),
  configure: (maxFrame, fps) =>
    set({ maxFrame: Math.max(0, maxFrame), fps, frame: 0, playing: false }),
  togglePlaying: () => {
    const { playing, frame, maxFrame } = get();
    if (playing) {
      set({ playing: false });
      return;
    }
    set({ frame: frame >= maxFrame ? 0 : frame, playing: true });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setLoop: (loop) => set({ loop }),
  step: (delta) => get().setFrame(get().frame + delta),
  reset: () => set({ frame: 0, playing: false }),
}));
