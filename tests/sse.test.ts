import { describe, expect, it } from "vitest";
import { SseFrameDecoder, parseTutorFrame } from "@/lib/sse";

describe("tutor SSE stream framing", () => {
  it("reassembles JSON split at arbitrary network boundaries", () => {
    const decoder = new SseFrameDecoder();
    expect(decoder.push('data: {"tex')).toEqual([]);
    expect(decoder.push('t":"Hello"}\n')).toEqual([]);
    const frames = decoder.push('\ndata: {"text":" world"}\n\n');
    expect(frames).toEqual(['{"text":"Hello"}', '{"text":" world"}']);
    expect(frames.map((frame) => parseTutorFrame(frame).text).join("")).toBe("Hello world");
  });

  it("handles CRLF split across chunks, comments and multi-line data", () => {
    const decoder = new SseFrameDecoder();
    expect(decoder.push(': keep-alive\r')).toEqual([]);
    expect(decoder.push('\n\r\ndata: {"text":"a"}\r')).toEqual([]);
    expect(decoder.push('\n\r\n')).toEqual(['{"text":"a"}']);
  });

  it("propagates server errors rather than swallowing them", () => {
    expect(() => parseTutorFrame('{"error":"The tutor model could not be reached"}'))
      .toThrow(/could not be reached/);
    expect(() => parseTutorFrame('{broken')).toThrow(/unreadable/);
  });

  it("bounds a malicious never-ending frame", () => {
    const decoder = new SseFrameDecoder();
    expect(() => decoder.push(`data: ${"x".repeat(1_048_577)}`)).toThrow(/exceeded/);
  });
});
