import { describe, expect, it } from "vitest";

import { isChatId } from "./is-chat-id";

describe("isChatId", () => {
  it.each([
    ["my-app", true],
    ["test123", true],
    ["chat-old-task", true],
    ["eval-123", true],
    ["2026-09-24-transcribe-a-note-2", true],
    ["2026-10-19-transcribe-a-note-7k3q", true],
    ["2026-10-19-chat-z018", true],
    ["my-app.preview", false],
    ["sandbox-test.my-app", false],
    ["version-abc.my-app", false],
  ])("should return %s for %s", (id, expected) => {
    expect(isChatId(id)).toBe(expected);
  });
});
