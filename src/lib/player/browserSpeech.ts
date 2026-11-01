"use client";

/** Minimal Web Speech API contract, injectable in tests without a DOM. */
export type BrowserVoice = { lang: string; default?: boolean };
export type BrowserUtterance = {
  text: string;
  voice: BrowserVoice | null;
  lang: string;
  rate: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};
export type BrowserSynth = {
  speak: (utterance: BrowserUtterance) => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  getVoices: () => BrowserVoice[];
  readonly paused: boolean;
  readonly speaking: boolean;
  readonly pending: boolean;
};
export type SpeechCall = {
  key: string;
  text: string;
  rate: number;
  onStart: () => void;
  onEnd: () => void;
  onError: (reason: string) => void;
};

const STALL_TIMEOUT_MS = 3000;
const CANCEL_SETTLE_MS = 80;

type ActiveSpeech = { key: string; utterance: BrowserUtterance; started: boolean; call: SpeechCall };

/**
 * One utterance at a time. No cancel-before-first-speak, no stale onend after a
 * seek, no queue buildup. The initial speak() happens inside the user's Play
 * click/keyboard gesture rather than waiting for a React effect (which browsers
 * can block). Later segments use the same unlocked synthesis session.
 */
export class BrowserSpeechController {
  private active: ActiveSpeech | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;

  constructor(
    private readonly synth: BrowserSynth,
    private readonly createUtterance: (text: string) => BrowserUtterance,
  ) {}

  get activeKey(): string | null {
    return this.active?.key ?? null;
  }

  start(call: SpeechCall): void {
    if (!call.text.trim()) {
      call.onError("There is no narration text for this moment.");
      return;
    }
    if (this.active?.key === call.key) {
      this.active.call = call;
      if (this.synth.paused) {
        this.synth.resume();
        if (this.active.started) call.onStart();
      }
      return;
    }

    const replaced = Boolean(this.active);
    this.stop();
    const token = ++this.sequence;
    let utterance: BrowserUtterance;
    try {
      utterance = this.createUtterance(call.text);
      const voices = this.synth.getVoices();
      // Do not assign an unavailable voice. The browser's own default is much
      // more reliable than a stale voice id or an empty getVoices() result.
      utterance.voice =
        voices.find((v) => v.default && v.lang.toLowerCase().startsWith("en")) ??
        voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
        null;
      utterance.lang = "en-US";
      utterance.rate = Math.min(2, Math.max(0.75, Number.isFinite(call.rate) ? call.rate : 1));
      utterance.volume = 1;
    } catch {
      call.onError("This browser does not provide a usable speech voice. Captions remain available.");
      return;
    }

    const current: ActiveSpeech = { key: call.key, utterance, started: false, call };
    this.active = current;
    utterance.onstart = () => {
      if (this.active !== current || token !== this.sequence) return;
      current.started = true;
      this.clearWatchdog();
      current.call.onStart();
    };
    utterance.onend = () => {
      if (this.active !== current || token !== this.sequence) return;
      this.active = null;
      this.clearWatchdog();
      current.call.onEnd();
    };
    utterance.onerror = (event) => {
      if (this.active !== current || token !== this.sequence) return;
      this.active = null;
      this.clearWatchdog();
      current.call.onError(
        event.error && event.error !== "canceled" && event.error !== "interrupted"
          ? `Browser speech stopped: ${event.error}`
          : "Browser speech is unavailable. Captions will keep playing.",
      );
    };

    const speak = () => {
      if (this.active !== current || token !== this.sequence) return;
      try {
        this.synth.speak(utterance);
      } catch {
        this.active = null;
        current.call.onError("Browser speech could not start. Captions will keep playing.");
        return;
      }
      this.watchdog = setTimeout(() => {
        if (this.active !== current || current.started) return;
        this.active = null;
        this.synth.cancel();
        current.call.onError("Browser speech did not start. Check your device's speech voices; captions will keep playing.");
      }, STALL_TIMEOUT_MS);
    };
    // Only replacing a previous utterance needs a delay after cancel(). On
    // first Play this remains synchronous inside the user gesture.
    if (replaced) this.timer = setTimeout(speak, CANCEL_SETTLE_MS);
    else speak();
  }

  pause(): void {
    if (!this.active) return;
    try { this.synth.pause(); } catch { /* browser may not implement pause */ }
  }

  stop(): void {
    this.sequence += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearWatchdog();
    if (this.active) {
      this.active = null;
      try { this.synth.cancel(); } catch { /* browser may have shut down */ }
    }
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}

let instance: BrowserSpeechController | null = null;

export function browserSpeech(): BrowserSpeechController | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined") return null;
  if (!instance) {
    instance = new BrowserSpeechController(
      window.speechSynthesis as unknown as BrowserSynth,
      (text) => new SpeechSynthesisUtterance(text) as unknown as BrowserUtterance,
    );
  }
  return instance;
}

/** One-click preview must speak synchronously in the click event. */
export function previewBrowserSpeech(
  text: string,
  rate: number,
  onError: (message: string) => void,
): boolean {
  const controller = browserSpeech();
  if (!controller) {
    onError("This browser has no speech synthesis. Turn on a speech service for narration.");
    return false;
  }
  controller.start({
    key: `preview:${Date.now()}:${Math.random()}`,
    text,
    rate,
    onStart: () => undefined,
    onEnd: () => undefined,
    onError,
  });
  return true;
}
