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

describe("long lines", () => {
  const cut = (text: string) => {
    const { content, keptHeadBytes, keptTailBytes, omittedLines, truncated } =
      truncateMiddle(text, { headBytes: 20, tailBytes: 20 });
    return { content, keptHeadBytes, keptTailBytes, omittedLines, truncated };
  };

  it("fills the windows from one line over both windows", () => {
    expect(cut("a".repeat(30) + "b".repeat(30))).toMatchInlineSnapshot(`
      {
        "content": "aaaaaaaaaaaaaaaaaaaa[... 20 bytes omitted ...]bbbbbbbbbbbbbbbbbbbb",
        "keptHeadBytes": 20,
        "keptTailBytes": 20,
        "omittedLines": 0,
        "truncated": true,
      }
    `);
  });

  it("fills the windows from a long first line", () => {
    expect(cut(`${"a".repeat(60)}\nshort\nend`)).toMatchInlineSnapshot(`
      {
        "content": "aaaaaaaaaaaaaaaaaaaa[... 30 bytes omitted ...]aaaaaaaaaa
      short
      end",
        "keptHeadBytes": 20,
        "keptTailBytes": 20,
        "omittedLines": 0,
        "truncated": true,
      }
    `);
  });

  it("fills the windows from a long last line", () => {
    expect(cut(`start\nshort\n${"z".repeat(60)}`)).toMatchInlineSnapshot(`
      {
        "content": "start
      short
      [... 40 bytes omitted ...]zzzzzzzzzzzzzzzzzzzz",
        "keptHeadBytes": 11,
        "keptTailBytes": 20,
        "omittedLines": 0,
        "truncated": true,
      }
    `);
  });

  it("fills the windows from short lines around a long one", () => {
    expect(cut(`one\ntwo\n${"m".repeat(60)}\nthree\nfour`))
      .toMatchInlineSnapshot(`
      {
        "content": "one
      two
      mmmmmmmmmmmm[... 48 bytes omitted ...]
      three
      four",
        "keptHeadBytes": 20,
        "keptTailBytes": 10,
        "omittedLines": 0,
        "truncated": true,
      }
    `);
  });

  it("fills the windows from a carriage-return progress bar", () => {
    expect(cut(`${"progress 10%\r".repeat(8)}done\n`)).toMatchInlineSnapshot(`
      {
        "content": "progress 10%
      progres[... 68 bytes omitted ...]0%
      progress 10%
      done",
        "keptHeadBytes": 20,
        "keptTailBytes": 20,
        "omittedLines": 0,
        "truncated": true,
      }
    `);
  });

  it("keeps whole lines when the window is more than half full", () => {
    const text = `${"a".repeat(12)}\n${"b".repeat(40)}\n${"c".repeat(12)}`;
    expect(cut(text).content).toBe(
      `${"a".repeat(12)}\n[... 1 lines omitted ...]\n${"c".repeat(12)}`,
    );
  });

  it("cuts a long line at character boundaries", () => {
    const { content } = truncateMiddle("🙂".repeat(1000), {
      headBytes: 1023,
      tailBytes: 1023,
    });
    expect(sanitizeSurrogates(content)).toBe(content);
    expect(content).not.toContain("�");
    expect(content).toBe(
      `${"🙂".repeat(255)}[... 1960 bytes omitted ...]${"🙂".repeat(255)}`,
    );
  });

  it("shows 20 KB of one 1 MB line by default", () => {
    const result = truncateMiddle("x".repeat(1024 * 1024));
    expect(result.keptHeadBytes).toBe(TRUNCATE_HEAD_BYTES);
    expect(result.keptTailBytes).toBe(TRUNCATE_TAIL_BYTES);
    expect(result.content).toContain(
      `[... ${1024 * 1024 - 20 * 1024} bytes omitted ...]`,
    );
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
