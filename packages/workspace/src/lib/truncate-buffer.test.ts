import { describe, expect, it } from "vitest";

import {
  TRUNCATE_MAX_BYTES,
  TRUNCATE_MAX_LINES,
  truncateHead,
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
    // Each line is 10 bytes + newline = 11 bytes; limit to 25 bytes fits 2 lines
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
    // Should contain the end of the text
    expect(result.content).toContain("0123456789");
  });

  it("handles a single line longer than maxBytes via partial tail", () => {
    const bigLine = "abcdefghij".repeat(10); // 100 chars
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

describe("TRUNCATE_MAX_BYTES / TRUNCATE_MAX_LINES", () => {
  it("exports expected defaults", () => {
    expect(TRUNCATE_MAX_BYTES).toBe(50 * 1024);
    expect(TRUNCATE_MAX_LINES).toBe(2000);
  });
});
