import { describe, expect, it } from "vitest";

import { chatFolderName } from "./chat-folder-name";

// Local-time constructor so the formatted prefix is timezone-independent.
const date = new Date(2026, 5, 23, 12, 0, 0);
const free = () => false;

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
