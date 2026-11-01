import { describe, expect, it, vi } from "vitest";
import {
  BrowserSpeechController,
  type BrowserSynth,
  type BrowserUtterance,
} from "@/lib/player/browserSpeech";

function setup() {
  const spoken: BrowserUtterance[] = [];
  let paused = false;
  const synth: BrowserSynth = {
    speak: (utterance) => spoken.push(utterance),
    cancel: vi.fn(),
    pause: vi.fn(() => { paused = true; }),
    resume: vi.fn(() => { paused = false; }),
    getVoices: () => [{ lang: "en-US", default: true }],
    get paused() { return paused; },
    get speaking() { return spoken.length > 0; },
    get pending() { return false; },
  };
  const controller = new BrowserSpeechController(synth, (text) => ({
    text,
    voice: null,
    lang: "",
    rate: 1,
    volume: 1,
    onstart: null,
    onend: null,
    onerror: null,
  }));
  return { synth, controller, spoken };
}

describe("browser speech controller", () => {
  it("starts the first utterance synchronously without canceling it", () => {
    const { synth, controller, spoken } = setup();
    const onStart = vi.fn();
    controller.start({ key: "scene:s1", text: "Speak this sentence.", rate: 1, onStart, onEnd: vi.fn(), onError: vi.fn() });
    expect(spoken).toHaveLength(1);
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(spoken[0].voice?.lang).toBe("en-US");
    expect(spoken[0].rate).toBe(1);
    spoken[0].onstart?.();
    expect(onStart).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("uses the browser default when voices have not loaded yet", () => {
    const { synth, controller, spoken } = setup();
    synth.getVoices = () => [];
    controller.start({ key: "s1", text: "Still speak.", rate: 1.25, onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() });
    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice).toBeNull();
    expect(spoken[0].lang).toBe("en-US");
    controller.stop();
  });

  it("pauses and resumes the SAME utterance without starting another", () => {
    const { synth, controller, spoken } = setup();
    const call = { key: "s1", text: "This is long.", rate: 1, onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    controller.start(call);
    spoken[0].onstart?.();
    controller.pause();
    controller.start(call);
    expect(spoken).toHaveLength(1);
    expect(synth.resume).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("ignores stale onend and onerror callbacks after seeking to another segment", () => {
    vi.useFakeTimers();
    try {
      const { synth, controller, spoken } = setup();
      const firstEnd = vi.fn();
      const secondEnd = vi.fn();
      const firstErr = vi.fn();
      controller.start({ key: "s1", text: "First", rate: 1, onStart: vi.fn(), onEnd: firstEnd, onError: firstErr });
      const old = spoken[0];
      controller.start({ key: "s2", text: "Second", rate: 1, onStart: vi.fn(), onEnd: secondEnd, onError: vi.fn() });
      expect(synth.cancel).toHaveBeenCalledTimes(1);
      old.onend?.();
      old.onerror?.({ error: "interrupted" });
      expect(firstEnd).not.toHaveBeenCalled();
      expect(firstErr).not.toHaveBeenCalled();
      expect(spoken).toHaveLength(1);
      vi.advanceTimersByTime(90);
      expect(spoken).toHaveLength(2);
      spoken[1].onend?.();
      expect(secondEnd).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a missing voice instead of claiming audio is playing", () => {
    vi.useFakeTimers();
    try {
      const { controller } = setup();
      const onError = vi.fn();
      controller.start({ key: "s1", text: "No speech starts.", rate: 1, onStart: vi.fn(), onEnd: vi.fn(), onError });
      vi.advanceTimersByTime(3100);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toMatch(/did not start/i);
      expect(controller.activeKey).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart the same utterance on a clock tick", () => {
    const { controller, spoken } = setup();
    const call = { key: "s1", text: "A sentence.", rate: 1, onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    controller.start(call);
    controller.start({ ...call });
    controller.start({ ...call });
    expect(spoken).toHaveLength(1);
    controller.stop();
  });
});
