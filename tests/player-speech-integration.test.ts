import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import { getPreparedScene } from "@/lib/player/computeSceneState";
import { usePlayerStore } from "@/lib/player/store";
import { browserSpeech } from "@/lib/player/browserSpeech";

type FakeUtterance = {
  text: string;
  voice: null;
  rate: number;
  volume: number;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};
const spoken: FakeUtterance[] = [];
const fakeSynth = {
  paused: false,
  speaking: false,
  pending: false,
  speak: vi.fn((u: FakeUtterance) => {
    spoken.push(u);
    fakeSynth.speaking = true;
  }),
  cancel: vi.fn(() => { fakeSynth.speaking = false; }),
  pause: vi.fn(() => { fakeSynth.paused = true; }),
  resume: vi.fn(() => { fakeSynth.paused = false; }),
  getVoices: () => [{ lang: "en-US", default: true }],
};
class Utterance implements FakeUtterance {
  voice = null;
  rate = 1;
  volume = 1;
  lang = "en-US";
  onstart = null;
  onend = null;
  onerror = null;
  constructor(public text: string) {}
}

beforeAll(() => {
  vi.stubGlobal("window", { speechSynthesis: fakeSynth });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
});
afterAll(() => {
  browserSpeech()?.stop();
  vi.unstubAllGlobals();
});

describe("player speech fallback from a user gesture", () => {
  it("calls speak synchronously inside Play, then advances only on speech end", () => {
    usePlayerStore.getState().load(buildFixtureCourse());
    const first = getPreparedScene(usePlayerStore.getState().flat[0].scene).timeline.segments[0];
    const before = spoken.length;
    usePlayerStore.getState().play();
    expect(spoken.length).toBe(before + 1); // no deferred React effect required
    expect(fakeSynth.cancel).not.toHaveBeenCalled();
    const utterance = spoken.at(-1)!;
    expect(utterance.text).toContain("Welcome");
    utterance.onstart?.();
    expect(usePlayerStore.getState().speechDriven).toBe(true);
    usePlayerStore.getState().advance(first.durationMs + 500);
    expect(usePlayerStore.getState().tMs).toBe(first.endMs - 1);
    utterance.onend?.();
    expect(usePlayerStore.getState().speechDriven).toBe(false);
    expect(usePlayerStore.getState().tMs).toBeGreaterThanOrEqual(first.endMs);
    usePlayerStore.getState().pause();
  });

  it("seeking cancels old speech; stale onend cannot jump the timeline", () => {
    vi.useFakeTimers();
    try {
      usePlayerStore.getState().load(buildFixtureCourse());
      usePlayerStore.getState().play();
      vi.advanceTimersByTime(100);
      const old = spoken.at(-1)!;
      const tl = getPreparedScene(usePlayerStore.getState().flat[0].scene).timeline;
      usePlayerStore.getState().seekTo(tl.segments[1].startMs + 50);
      const afterSeek = usePlayerStore.getState().tMs;
      old.onend?.();
      expect(usePlayerStore.getState().tMs).toBe(afterSeek);
      vi.advanceTimersByTime(100);
      expect(spoken.at(-1)!.text).not.toBe(old.text);
      usePlayerStore.getState().pause();
    } finally {
      vi.useRealTimers();
    }
  });

  it("mute stops browser speech but keeps captions and the virtual clock running", () => {
    usePlayerStore.getState().load(buildFixtureCourse());
    const was = spoken.length;
    usePlayerStore.getState().play();
    expect(spoken.length).toBe(was + 1);
    const utterance = spoken.at(-1)!;
    utterance.onstart?.();
    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().muted).toBe(true);
    expect(usePlayerStore.getState().captions).toBe(true);
    expect(usePlayerStore.getState().speechDriven).toBe(false);
    const t = usePlayerStore.getState().tMs;
    usePlayerStore.getState().advance(500);
    expect(usePlayerStore.getState().tMs).toBeGreaterThan(t);
    usePlayerStore.getState().pause();
  });
});
