import { describe, expect, it } from "vitest";

import { sanitizeSurrogates } from "./sanitize-model-text";
import {
  TRUNCATE_HEAD_BYTES,
  TRUNCATE_TAIL_BYTES,
  truncateMiddle,
} from "./truncate-buffer";

describe("truncateMiddle", () => {
  it.each([
    ["hello\nworld", {}, 2],
    ["", {}, 0],
    ["a\nb\n", {}, 2],
    ["a\nb\nc\nd\ne", { headBytes: 100, tailBytes: 100 }, 5],
  ])("returns %j unchanged when it fits", (text, options, totalLines) => {
    expect(truncateMiddle(text, options)).toMatchObject({
      content: text,
      omittedLines: 0,
      totalBytes: Buffer.byteLength(text),
      totalLines,
      truncated: false,
    });
  });

  it("keeps whole lines from both ends and counts the omitted ones", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    expect(
      truncateMiddle(lines.join("\n"), { headBytes: 12, tailBytes: 12 }),
    ).toMatchInlineSnapshot(`
      {
        "content": "line0
      line1
      [... 17 lines omitted ...]
      line19",
        "keptHeadBytes": 11,
        "keptTailBytes": 6,
        "omittedLines": 17,
        "totalBytes": 129,
        "totalLines": 20,
        "truncated": true,
        "truncatedBy": "bytes",
      }
    `);
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
