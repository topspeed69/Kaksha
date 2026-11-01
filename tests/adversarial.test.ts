import { describe, expect, it } from "vitest";
import {
  checkProviderUrl,
  checkUrl,
  isBlockedIp,
  isMetadataIp,
} from "@/server/ingest/ssrf";
import {
  buildChunks,
  decodeEntities,
  parseMarkdown,
  sanitizeText,
  sniffKind,
} from "@/server/ingest";
import {
  DEFAULT_SETTINGS,
  SECRET_CLEAR,
  SECRET_MASK,
  decryptSecret,
  encryptSecret,
  maskSettings,
  mergeSettings,
  resolveSlot,
} from "@/server/settings";
import {
  extractJson,
  generateStructured,
  type LLMProvider,
  type LLMRequest,
  type LLMResult,
} from "@/server/providers/llm";
import {
  normalizeSpeech,
  readAudioDurationMs,
  readAudioFile,
  readMp3DurationMs,
  readWavDurationMs,
} from "@/server/providers/tts";
import {
  checkPlotExpression,
  safeEvaluate,
  validateScene,
} from "@/lib/dsl/validate";
import { inspectAnswerMath, renderLatex, tokenizeMathText } from "@/lib/katex";
import { heuristicPlan } from "@/server/pipeline/planner";
import { generateScene } from "@/server/pipeline/scenes";
import { gradeByOverlap } from "@/server/grading";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import {
  safeRedirectPath,
  signAccessCookie,
  verifyAccessCookie,
  verifySubmittedCode,
} from "@/server/auth";
import type { Question, QuizScene, WhiteboardScene } from "@/lib/dsl/types";

describe("adversarial SSRF & URL validation", () => {
  it("blocks private, loopback, link-local, CGNAT, multicast and broadcast IPv4", () => {
    const blocked = [
      "0.0.0.0",
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "100.64.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ];
    for (const ip of blocked) {
      expect(isBlockedIp(ip), `expected ${ip} to be blocked`).toBe(true);
    }
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });

  it("blocks IPv6 loopback, expanded forms, IPv4-mapped, 6to4, NAT64, ULA and link-local bypasses", async () => {
    const bypassIps = [
      "::",
      "::1",
      "[::1]",
      "0:0:0:0:0:0:0:1",
      "0000:0000:0000:0000:0000:0000:0000:0001",
      "0:0:0:0:0:0:0:0",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:169.254.169.254",
      "::ffff:10.0.0.1",
      "::ffff:192.168.0.1",
      "::127.0.0.1",
      "fe80::1",
      "fe80::1%eth0",
      "febf::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "ff02::1",
      "2002:7f00:0001::1", // 6to4 -> 127.0.0.1
      "2002:a9fe:a9fe::1", // 6to4 -> 169.254.169.254
      "64:ff9b::127.0.0.1", // NAT64 -> 127.0.0.1
      "64:ff9b::169.254.169.254", // NAT64 -> metadata
      "100::1",
      "2001:db8::1",
    ];
    for (const ip of bypassIps) {
      expect(isBlockedIp(ip), `expected IPv6 ${ip} to be blocked`).toBe(true);
    }
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);

    const urlAttempts = [
      "http://[::1]:3000/api/settings",
      "http://[::ffff:127.0.0.1]:3000/",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://0177.0.0.1/",
      "http://user:pass@8.8.8.8/",
      "file:///etc/passwd",
      "gopher://127.0.0.1:6379/_INFO",
    ];
    for (const raw of urlAttempts) {
      const res = await checkUrl(raw);
      expect(res.ok, `expected URL ${raw} to be rejected`).toBe(false);
    }
  });

  it("enforces LUMEN_ALLOW_LOCAL_PROVIDERS=1 and always blocks cloud metadata IPs", async () => {
    expect(isMetadataIp("169.254.169.254")).toBe(true);
    expect(isMetadataIp("::ffff:169.254.169.254")).toBe(true);
    expect(isMetadataIp("fe80::1")).toBe(true);

    const prev = process.env.LUMEN_ALLOW_LOCAL_PROVIDERS;
    try {
      delete process.env.LUMEN_ALLOW_LOCAL_PROVIDERS;
      const blockedLocal = await checkProviderUrl("http://127.0.0.1:11434/api/chat");
      expect(blockedLocal.ok).toBe(false);

      process.env.LUMEN_ALLOW_LOCAL_PROVIDERS = "1";
      const allowedLocal = await checkProviderUrl("http://127.0.0.1:11434/api/chat");
      expect(allowedLocal.ok).toBe(true);

      // Cloud metadata MUST remain blocked even when LUMEN_ALLOW_LOCAL_PROVIDERS=1
      const metadataV4 = await checkProviderUrl("http://169.254.169.254/latest/meta-data");
      expect(metadataV4.ok).toBe(false);
      const metadataV6 = await checkProviderUrl("http://[::ffff:169.254.169.254]/latest/meta-data");
      expect(metadataV6.ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.LUMEN_ALLOW_LOCAL_PROVIDERS;
      else process.env.LUMEN_ALLOW_LOCAL_PROVIDERS = prev;
    }
  });
});

describe("adversarial MathJS sandbox & plot performance", () => {
  it("blocks AST escapes, matrix bombs, property access, assignments and deep ASTs", () => {
    const attacks = [
      "ones(5000, 5000)",
      "zeros(9999, 9999)",
      "range(0, 100000000)",
      "x.constructor",
      'x["toString"]',
      "[1, 2, 3]",
      '{"a": 1}',
      "x = 10",
      "f(x) = x^2",
      "x > 0 ? 1 : -1",
      "1; 2",
      'import("fs")',
      "evaluate('1+1')",
      Array.from({ length: 130 }, () => "x").join(" + "),
    ];
    for (const expr of attacks) {
      expect(checkPlotExpression(expr).length, `expected "${expr.slice(0, 30)}" to fail`).toBeGreaterThan(0);
      expect(safeEvaluate(expr, 1), `expected safeEvaluate("${expr.slice(0, 30)}") to return null`).toBeNull();
    }
  });

  it("evaluates valid math accurately and handles singularities gracefully", () => {
    expect(safeEvaluate("sin(pi / 2)", 0)).toBeCloseTo(1, 6);
    expect(safeEvaluate("exp(-x)", 0)).toBeCloseTo(1, 6);
    expect(safeEvaluate("1 / x", 0)).toBeNull(); // Infinity rejected
    expect(safeEvaluate("sqrt(-1)", 0)).toBeNull(); // Non-real complex rejected
    expect(safeEvaluate("x^2", Number.NaN)).toBeNull();
  });

  it("evaluates 2,000 plot samples in under 100ms via compiled LRU cache", () => {
    const start = performance.now();
    let validCount = 0;
    for (let i = 0; i < 2000; i += 1) {
      const y = safeEvaluate("exp(-0.6 * x) * cos(3 * x) + sin(x / pi)", (i / 2000) * 5);
      if (y !== null) validCount += 1;
    }
    const elapsed = performance.now() - start;
    expect(validCount).toBe(2000);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("settings encryption, secret mask safety & prototype pollution", () => {
  it("encrypts and decrypts secrets and rejects tampered ciphertext", () => {
    const cipher = encryptSecret("sk-live-super-secret-key");
    expect(cipher).toMatch(/^v1\./);
    expect(cipher).not.toContain("sk-live");
    expect(decryptSecret(cipher)).toBe("sk-live-super-secret-key");

    // Flip a character in the auth tag
    const parts = cipher.split(".");
    const flippedTag =
      (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    expect(decryptSecret(`${parts[0]}.${parts[1]}.${parts[2]}.${flippedTag}`)).toBe("");
  });

  it("never overwrites stored API keys with the bullet mask on re-save", () => {
    const withRealKey = mergeSettings(DEFAULT_SETTINGS, {
      llm: {
        default: { provider: "openai", model: "gpt-4o-mini", api_key: "sk-real-secret" },
      },
    });
    expect(withRealKey.llm.default.api_key).toBe("sk-real-secret");

    // Simulate GET /api/settings -> maskSettings -> PUT /api/settings round-trip
    const maskedForBrowser = maskSettings(withRealKey);
    expect(maskedForBrowser.llm.default.api_key).toBe(SECRET_MASK);

    const savedBackFromBrowser = mergeSettings(withRealKey, {
      ...maskedForBrowser,
      tts: { ...maskedForBrowser.tts, default_speed: 1.25 },
    });
    expect(savedBackFromBrowser.llm.default.api_key).toBe("sk-real-secret");
    expect(savedBackFromBrowser.tts.default_speed).toBe(1.25);

    // Explicit clear works
    const cleared = mergeSettings(withRealKey, {
      llm: { default: { api_key: SECRET_CLEAR } },
    });
    expect(cleared.llm.default.api_key).toBe("");
  });

  it("ignores prototype pollution payloads and does not leak base_url across providers", () => {
    const malicious = JSON.parse(
      '{"__proto__":{"polluted":true},"tts":{"default_speed":"not-a-number"}}',
    );
    const merged = mergeSettings(DEFAULT_SETTINGS, malicious);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(merged.tts.default_speed).toBe(1);

    const mixed = mergeSettings(DEFAULT_SETTINGS, {
      llm: {
        default: {
          provider: "openai",
          base_url: "https://api.openai.com/v1",
          api_key: "sk-openai",
          model: "gpt-4o-mini",
        },
        planner: {
          provider: "ollama",
          model: "llama3.2",
        },
      },
    });
    const resolvedPlanner = resolveSlot(mixed, "planner");
    expect(resolvedPlanner.config.provider).toBe("ollama");
    expect(resolvedPlanner.config.base_url).toBeUndefined();
    expect(resolvedPlanner.config.api_key).toBe("");
  });
});

describe("audio frame duration reading & path traversal protection", () => {
  it("reads exact duration of 44.1 kHz MPEG-1 Layer III frames", () => {
    // MPEG-1 (versionBits=3 -> 11), Layer III (layerBits=1 -> 01), 128kbps (idx=9 -> 1001), 44100Hz (idx=0 -> 00)
    // Byte 0: 0xFF
    // Byte 1: 111 11 01 1 = 0xFB
    // Byte 2: 1001 00 0 0 = 0x90
    // Byte 3: 0x00
    // Frame length = floor(144 * 128000 / 44100) = 417 bytes, 1152 samples/frame
    const frameLen = Math.floor((144 * 128000) / 44100);
    const frameCount = 40;
    const buf = Buffer.alloc(frameLen * frameCount, 0);
    for (let i = 0; i < frameCount; i += 1) {
      const off = i * frameLen;
      buf[off] = 0xff;
      buf[off + 1] = 0xfb;
      buf[off + 2] = 0x90;
    }
    const expectedMs = Math.round(((frameCount * 1152) / 44100) * 1000);
    expect(readMp3DurationMs(buf)).toBe(expectedMs);
    expect(readAudioDurationMs(buf, "audio/mpeg")).toBe(expectedMs);
  });

  it("reads exact duration of 24 kHz MPEG-2 Layer III frames (Kokoro format)", () => {
    // MPEG-2 (versionBits=2 -> 10), Layer III (layerBits=1 -> 01), 64kbps (V2 idx=8 -> 1000), 24000Hz (idx=1 -> 01)
    // Byte 0: 0xFF
    // Byte 1: 111 10 01 1 = 0xF3
    // Byte 2: 1000 01 0 0 = 0x84
    // Frame length = floor(72 * 64000 / 24000) = 192 bytes, 576 samples/frame
    const frameLen = 192;
    const frameCount = 50; // 50 * 576 / 24000 = 1.200s = 1200ms
    const buf = Buffer.alloc(frameLen * frameCount, 0);
    for (let i = 0; i < frameCount; i += 1) {
      const off = i * frameLen;
      buf[off] = 0xff;
      buf[off + 1] = 0xf3;
      buf[off + 2] = 0x84;
    }
    expect(readMp3DurationMs(buf)).toBe(1200);
  });

  it("walks WAV RIFF chunks even when JUNK metadata precedes fmt and data", () => {
    // RIFF header (12B) + JUNK chunk (8+10B) + fmt chunk (8+16B) + data chunk (8+48000B)
    const buf = Buffer.alloc(12 + 18 + 24 + 8 + 48000, 0);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(buf.length - 8, 4);
    buf.write("WAVE", 8, "ascii");
    // JUNK chunk at 12
    buf.write("JUNK", 12, "ascii");
    buf.writeUInt32LE(10, 16);
    // fmt chunk at 30
    buf.write("fmt ", 30, "ascii");
    buf.writeUInt32LE(16, 34);
    buf.writeUInt16LE(1, 38); // PCM
    buf.writeUInt16LE(1, 40); // mono
    buf.writeUInt32LE(24000, 42); // 24 kHz
    buf.writeUInt32LE(48000, 46); // byteRate = 48000 B/s
    // data chunk at 54
    buf.write("data", 54, "ascii");
    buf.writeUInt32LE(48000, 58); // 1.000 second
    expect(readWavDurationMs(buf)).toBe(1000);
  });

  it("handles corrupt, truncated and traversal inputs safely", () => {
    expect(readAudioDurationMs(Buffer.alloc(0), "audio/mpeg")).toBe(0);
    const badId3 = Buffer.from("ID3\x04\x00\x00\x7f\x7f\x7f\x7fgarbage", "latin1");
    expect(readMp3DurationMs(badId3)).toBeNull();
    expect(readAudioFile("../../etc/passwd")).toBeNull();
    expect(readAudioFile("deadbeef;rm -rf")).toBeNull();
    expect(normalizeSpeech("ħ and Δx ≫ λ at 20 ms")).toContain("h-bar");
  });
});

describe("ingestion sanitization, binary sniffing & chunking invariants", () => {
  it("strips null bytes, control chars, lone surrogates and hazardous HTML entities", () => {
    const dirty = "Hello\u0000World\u0007 \uD800LoneHigh \uDC00LoneLow Valid😀";
    const clean = sanitizeText(dirty);
    expect(clean).not.toContain("\u0000");
    expect(clean).not.toContain("\uD800");
    expect(clean).not.toContain("\uDC00");
    expect(clean).toContain("Valid😀");

    const entities = decodeEntities("A&#0;B&#xD800;C&#99999999;D&#945;E");
    expect(entities).not.toContain("\u0000");
    expect(entities).toContain("α");
  });

  it("rejects binary payloads masquerading as .md or .txt", () => {
    expect(sniffKind(Buffer.from("\x89PNG\r\n\x1a\nfake", "latin1"), "notes.md")).toBe("binary");
    expect(sniffKind(Buffer.from("\x7fELF\x02\x01\x01\x00", "latin1"), "paper.txt")).toBe("binary");
    expect(sniffKind(Buffer.from("hello\x00world"), "notes.txt")).toBe("binary");
    expect(sniffKind(Buffer.from("# Heading\nPlain markdown text.\n"), "notes.md")).toBe("markdown");
  });

  it("splits oversized unpunctuated text and avoids duplicate overlap-only tail chunks", () => {
    const giantLine = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(" ");
    const parsedGiant = parseMarkdown(`# Giant\n${giantLine}`, "giant.md");
    const giantChunks = buildChunks(parsedGiant.sections);
    expect(giantChunks.length).toBeGreaterThanOrEqual(2);
    expect(giantChunks[0].text).not.toBe(giantChunks[1].text);

    // Construct sentences that trigger emit right on the last sentence
    const sentence = "Quantum decoherence explains how environmental entanglement suppresses interference terms.";
    const exactText = Array.from({ length: 48 }, () => sentence).join(" ");
    const chunks = buildChunks([{ title: "Sec 1", level: 1, text: exactText }]);
    expect(chunks.length).toBe(1);
  });
});

describe("KaTeX safety & inline math tokenizer", () => {
  it("tokenizes $$display$$, $inline$, escaped \\$ and unmatched $ cleanly", () => {
    const { segments, unclosed } = tokenizeMathText(
      "Cost is \\$5. Display: $$E = mc^2$$ and inline $\\alpha + \\beta$ plus trailing $10",
    );
    expect(unclosed).toBe(true);
    expect(segments.filter((s) => s.kind === "math")).toEqual([
      { kind: "math", value: "E = mc^2", display: true },
      { kind: "math", value: "\\alpha + \\beta", display: false },
    ]);
    const joinedText = segments
      .filter((s) => s.kind === "text")
      .map((s) => s.value)
      .join("");
    expect(joinedText).toContain("$5");
    expect(joinedText).toContain("$10");
  });

  it("reports parse errors and blocks untrusted HTML/JS commands in KaTeX", () => {
    const valid = inspectAnswerMath("Entropy $S = -\\operatorname{Tr}(\\rho \\ln \\rho)$ and $[H, x] \\approx 0$.");
    expect(valid.firstError).toBeNull();
    expect(valid.formulas).toHaveLength(2);

    const broken = inspectAnswerMath("Bad macro $\\notarealcommand{x}$ here.");
    expect(broken.firstError).toBeTruthy();

    const unclosed = inspectAnswerMath("Forgot closing $\\tau_D = 1");
    expect(unclosed.firstError).toContain("Unclosed");

    const xss = renderLatex("\\href{javascript:alert(1)}{click}", false);
    expect(xss.html).toBeTruthy();
    if (xss.html) {
      expect(xss.html).not.toContain("<a ");
      expect(xss.html).not.toContain("href=");
    }
  });
});

describe("LLM structured-output repair loop & JSON extraction", () => {
  it("extracts balanced JSON even when surrounded by prose containing braces", () => {
    const messy =
      'Note: use set notation {a, b} carefully.\n```json\n{"title": " Brace } test ", "ok": true}\n```\nTrailing {note}.';
    expect(extractJson(messy)).toEqual({ title: " Brace } test ", ok: true });
  });

  it("repairs invalid model output on the second attempt using validation errors", async () => {
    const calls: LLMRequest[] = [];
    const fakeProvider: LLMProvider = {
      name: "fake",
      async complete(req: LLMRequest): Promise<LLMResult> {
        calls.push(req);
        if (calls.length === 1) {
          return { text: '{"score": "wrong"}', model: "fake-1", provider: "fake" };
        }
        return { text: '{"score": 0.85}', model: "fake-1", provider: "fake" };
      },
      async *stream() {
        yield "";
      },
    };

    const outcome = await generateStructured<{ score: number }>({
      slot: {
        provider: fakeProvider,
        config: { provider: "openai", model: "fake-1" },
        slot: "grader",
        available: true,
      },
      system: "Output JSON.",
      prompt: "Give score.",
      temperature: 0,
      maxTokens: 100,
      validate: (val) => {
        const v = val as { score?: unknown };
        return typeof v?.score === "number"
          ? { ok: true, value: { score: v.score } }
          : { ok: false, issues: ["score must be a number"] };
      },
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.score).toBe(0.85);
      expect(outcome.repairs).toBe(1);
    }
    expect(calls[1].messages[0].content).toContain("score must be a number");
  });
});

describe("planner, whiteboard, grading determinism & access-code auth", () => {
  it("never leaves literal {topic} placeholders in heuristic plans", () => {
    const plan = heuristicPlan({
      topic: "Fourier analysis: heat equation & convergence",
      depth: "introductory",
      background: "beginner",
      minutes: 30,
      sectionTitles: [],
    });
    expect(JSON.stringify(plan)).not.toContain("{topic}");
  });

  it("draws real whiteboard ops in heuristic mode even with special characters in topic", async () => {
    const plan = heuristicPlan({
      topic: "C++ & Rust: 100% memory_safety #1",
      depth: "graduate",
      background: "familiar",
      minutes: 15,
      sectionTitles: [],
    });
    const wbOutline = plan.modules[0].scenes.find((s) => s.kind === "whiteboard")!;
    const outcome = await generateScene({
      settings: DEFAULT_SETTINGS,
      courseTitle: "Systems",
      topic: "C++ & Rust: 100% memory_safety #1",
      depth: "graduate",
      background: "familiar",
      module: plan.modules[0],
      outline: wbOutline,
      chunks: [],
      index: 0,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const wb = outcome.scene as WhiteboardScene;
      expect(validateScene(wb)).toEqual([]);
      const drawOps = wb.segments.flatMap((s) =>
        s.actions.filter((a) => a.op === "wb.text" || a.op === "wb.latex" || a.op === "wb.line"),
      );
      expect(drawOps.length).toBeGreaterThanOrEqual(9);
    }
  });

  it("grades short answers strictly deterministically in fallback mode", () => {
    const course = buildFixtureCourse();
    const quiz = course.modules[1].scenes.find((s) => s.kind === "quiz") as QuizScene;
    const shortQ = quiz.questions.find((q) => q.type === "short") as Question;
    const ans = {
      type: "short" as const,
      text: "The joint system and environment evolve unitarily while the partial trace discards unobserved environment degrees of freedom.",
    };
    const r1 = gradeByOverlap(shortQ, ans);
    const r2 = gradeByOverlap(shortQ, ans);
    expect(r1).toEqual(r2);
  });

  it("verifies access codes, signed cookies and open-redirect guards", () => {
    expect(verifySubmittedCode("lumen-2026", "lumen-2026")).toBe(true);
    expect(verifySubmittedCode("wrong", "lumen-2026")).toBe(false);
    const cookie = signAccessCookie("lumen-2026");
    expect(verifyAccessCookie(cookie, "lumen-2026")).toBe(true);
    expect(verifyAccessCookie(cookie, "other-code")).toBe(false);
    expect(verifyAccessCookie(`${cookie}x`, "lumen-2026")).toBe(false);

    expect(safeRedirectPath("/courses/123/lecture")).toBe("/courses/123/lecture");
    expect(safeRedirectPath("//evil.example.com")).toBe("/library");
    expect(safeRedirectPath("https://evil.example.com")).toBe("/library");
    expect(safeRedirectPath("/\\evil.example.com")).toBe("/library");
  });
});
