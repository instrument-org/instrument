import { describe, expect, it } from "vitest";

import {
  TRUNCATE_HEAD_BYTES,
  TRUNCATE_MAX_BYTES,
  TRUNCATE_MAX_LINES,
  TRUNCATE_TAIL_BYTES,
  truncateHead,
  truncateMiddle,
  truncateTail,
} from "./truncate-buffer";

describe("truncateHead", () => {
  it("returns full text when under limits", () => {
    const result = truncateHead("hello\nworld");
    expect(result.truncated).toBe(false);
    expect(result.truncatedBy).toBeNull();
    expect(result.content).toBe("hello\nworld");
  });

  it("returns empty string for empty input", () => {
    const result = truncateHead("");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("");
    expect(result.totalLines).toBe(0);
  });

  it("truncates by line limit and reports which limit was hit", () => {
    const text = Array.from({ length: 10 }, (_, idx) => `line${idx}`).join(
      "\n",
    );
    const result = truncateHead(text, { maxLines: 3 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("lines");
    expect(result.content).toBe("line0\nline1\nline2");
    expect(result.totalLines).toBe(10);
  });

  it("truncates by byte limit and reports which limit was hit", () => {
    const text = Array.from({ length: 5 }, () => `0123456789`).join("\n");
    const result = truncateHead(text, { maxBytes: 25 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
    expect(result.content.split("\n").length).toBeLessThanOrEqual(2);
  });

  it("sets firstLineExceedsLimit when first line alone exceeds cap", () => {
    const bigLine = "x".repeat(100);
    const result = truncateHead(bigLine, { maxBytes: 10 });
    expect(result.truncated).toBe(true);
    expect(result.firstLineExceedsLimit).toBe(true);
    expect(result.content).toBe("");
  });

  it("does not count a trailing newline as an extra line", () => {
    const result = truncateHead("a\nb\n");
    expect(result.totalLines).toBe(2);
    expect(result.truncated).toBe(false);
  });
});

describe("truncateTail", () => {
  it("returns full text when under limits", () => {
    const result = truncateTail("hello\nworld");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("hello\nworld");
  });

  it("returns empty string for empty input", () => {
    const result = truncateTail("");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("");
  });

  it("keeps the last N lines when truncating by line limit", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const result = truncateTail(lines.join("\n"), { maxLines: 3 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("lines");
    expect(result.content).toBe("line7\nline8\nline9");
    expect(result.totalLines).toBe(10);
  });

  it("keeps the last bytes when truncating by byte limit", () => {
    const lines = Array.from({ length: 5 }, () => `0123456789`);
    const result = truncateTail(lines.join("\n"), { maxBytes: 25 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
    expect(result.content).toContain("0123456789");
  });

  it("handles a single line longer than maxBytes via partial tail", () => {
    const bigLine = "abcdefghij".repeat(10);
    const result = truncateTail(bigLine, { maxBytes: 20 });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(20);
  });

  it("reports correct totalBytes and totalLines", () => {
    const text = "a\nb\nc";
    const result = truncateTail(text);
    expect(result.totalLines).toBe(3);
    expect(result.totalBytes).toBe(Buffer.byteLength(text, "utf8"));
  });

  it("matches the default limits", () => {
    const lines = Array.from(
      { length: TRUNCATE_MAX_LINES + 1 },
      () => "x",
    ).join("\n");
    const result = truncateTail(lines);
    expect(result.truncated).toBe(true);
    expect(result.content.split("\n").length).toBeLessThanOrEqual(
      TRUNCATE_MAX_LINES,
    );
  });
});

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

describe("exported constants", () => {
  it("exports expected defaults", () => {
    expect(TRUNCATE_MAX_BYTES).toBe(50 * 1024);
    expect(TRUNCATE_MAX_LINES).toBe(2000);
    expect(TRUNCATE_HEAD_BYTES).toBe(10 * 1024);
    expect(TRUNCATE_TAIL_BYTES).toBe(10 * 1024);
  });
});
