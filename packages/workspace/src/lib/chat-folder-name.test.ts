import { describe, expect, it } from "vitest";

import { chatFolderName, newChatName } from "./chat-folder-name";

// Local-time constructor so the formatted prefix is timezone-independent.
const date = new Date(2026, 5, 23, 12, 0, 0);
const free = () => false;

/** Hands out the given bytes in order, one suffix's worth per call. */
function bytes(...values: number[]) {
  let next = 0;
  return (length: number) => {
    const out = Uint8Array.from(values.slice(next, next + length));
    next += length;
    return out;
  };
}

describe("newChatName", () => {
  it("appends a four-character Crockford suffix to the date and words", () => {
    expect([
      newChatName({
        date,
        isTaken: free,
        randomBytes: bytes(0, 10, 18, 31),
        title: "Fix the login bug",
      }),
      newChatName({
        date,
        isTaken: free,
        randomBytes: bytes(255, 32, 1, 200),
        title: "🚀🔥",
      }),
    ]).toMatchInlineSnapshot(`
      [
        "2026-06-23-fix-the-login-bug-0ajz",
        "2026-06-23-chat-z018",
      ]
    `);
  });

  it("draws the suffix again while the name is taken", () => {
    const taken = new Set(["2026-06-23-fix-bug-0000"]);
    expect(
      newChatName({
        date,
        isTaken: (name) => taken.has(name),
        randomBytes: bytes(0, 0, 0, 0, 1, 2, 3, 4),
        title: "Fix bug",
      }),
    ).toMatchInlineSnapshot(`"2026-06-23-fix-bug-1234"`);
  });

  it("stays a valid subdomain within 63 chars from real randomness", () => {
    const names = Array.from({ length: 200 }, () =>
      newChatName({ date, isTaken: free, title: "a".repeat(200) }),
    );
    for (const name of names) {
      expect(name).toMatch(/^2026-06-23-a{24}-[0-9a-hjkmnp-tv-z]{4}$/);
      expect(name.length).toBeLessThanOrEqual(63);
    }
    expect(new Set(names).size).toBeGreaterThan(190);
  });
});

describe("chatFolderName", () => {
  it("prefixes the date and appends the words of the title", () => {
    expect(
      chatFolderName({ date, isTaken: free, title: "Fix the login bug" }),
    ).toBe("2026-06-23-fix-the-login-bug");
  });

  it.each([{ title: "🚀🔥" }, { title: undefined }])(
    "falls back to `chat` for $title",
    ({ title }) => {
      expect(chatFolderName({ date, isTaken: free, title })).toBe(
        "2026-06-23-chat",
      );
    },
  );

  it("appends a numeric suffix while the name is taken", () => {
    const taken = new Set(["2026-06-23-fix-bug", "2026-06-23-fix-bug-2"]);
    expect(
      chatFolderName({
        date,
        isTaken: (name) => taken.has(name),
        title: "Fix bug",
      }),
    ).toBe("2026-06-23-fix-bug-3");
  });

  it("always produces a valid subdomain within 63 chars", () => {
    const name = chatFolderName({
      date,
      isTaken: free,
      title: "a".repeat(200),
    });
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });
});
