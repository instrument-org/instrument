import { describe, expect, it } from "vitest";

import { sanitizeSurrogates } from "./sanitize-model-text";
import {
  TRUNCATE_HEAD_BYTES,
  TRUNCATE_TAIL_BYTES,
  truncateMiddle,
} from "./truncate-buffer";

describe("truncateMiddle", () => {
  it("returns full text when under combined byte limit", () => {
    const result = truncateMiddle("hello\nworld");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("hello\nworld");
    expect(result.omittedLines).toBe(0);
  });

  it("returns empty string for empty input", () => {
    const result = truncateMiddle("");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("");
    expect(result.omittedLines).toBe(0);
  });

  it("keeps head and tail, drops middle, inserts separator", () => {
    // 20 lines × 20 chars = 400 bytes, but headBytes+tailBytes = 60, so middle gets dropped
    const lines = Array.from(
      { length: 20 },
      (_, i) => `line${String(i).padStart(2, "0")}${"x".repeat(14)}`,
    );
    const result = truncateMiddle(lines.join("\n"), {
      headBytes: 30,
      tailBytes: 30,
    });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("line00");
    expect(result.content).toContain("line19");
    expect(result.content).toContain("lines omitted");
    expect(result.omittedLines).toBeGreaterThan(0);
    expect(result.omittedLines + result.content.split("\n").length - 1).toBe(
      result.totalLines,
    );
  });

  it("separator includes the omitted line count", () => {
    const lines = Array.from(
      { length: 20 },
      (_, i) => `line${String(i).padStart(2, "0")}${"x".repeat(14)}`,
    );
    const result = truncateMiddle(lines.join("\n"), {
      headBytes: 40,
      tailBytes: 40,
    });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain(
      `[... ${result.omittedLines} lines omitted ...]`,
    );
  });

  it("does not truncate when windows cover all lines", () => {
    const text = "a\nb\nc\nd\ne";
    const result = truncateMiddle(text, { headBytes: 100, tailBytes: 100 });
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(text);
  });

  it("reports correct totalBytes and totalLines", () => {
    const text = "a\nb\nc";
    const result = truncateMiddle(text);
    expect(result.totalLines).toBe(3);
    expect(result.totalBytes).toBe(Buffer.byteLength(text, "utf8"));
  });

  it("triggers on byte limit with default head/tail constants", () => {
    // 300 lines × 100 chars ≈ 30 KB, exceeds 10+10 KB combined budget
    const line = "x".repeat(99);
    const text = Array.from({ length: 300 }, () => line).join("\n");
    const result = truncateMiddle(text);
    expect(result.truncated).toBe(true);
    expect(result.omittedLines).toBeGreaterThan(0);
    // Head should start from the beginning
    expect(result.content.startsWith(line)).toBe(true);
    // Tail should end with the last line
    expect(result.content.endsWith(line)).toBe(true);
  });
});

describe("character boundaries", () => {
  // Every emoji here is two UTF-16 code units and four UTF-8 bytes. Cut one in
  // half and what is left is either a code unit with no UTF-8 encoding or a
  // replacement character where a character used to be. The first is rejected
  // by the provider, the second is silent corruption, and tool output is
  // written to disk and replayed every turn, so both outlive the turn.
  const emojiLine = "🙂".repeat(64);

  // Every offset in an emoji: the boundary itself and each byte inside one.
  const caps = [4, 5, 6, 7, 8].map((offset) => 1024 + offset);

  it.each(caps)("keeps whole characters at a %i byte cap", (maxBytes) => {
    const text = Array.from({ length: 40 }, () => emojiLine).join("\n");

    const { content } = truncateMiddle(text, {
      headBytes: maxBytes,
      tailBytes: maxBytes,
    });
    expect(sanitizeSurrogates(content)).toBe(content);
    expect(content).not.toContain("�");
  });
});

describe("exported constants", () => {
  it("exports expected defaults", () => {
    expect(TRUNCATE_HEAD_BYTES).toBe(10 * 1024);
    expect(TRUNCATE_TAIL_BYTES).toBe(10 * 1024);
  });
});
