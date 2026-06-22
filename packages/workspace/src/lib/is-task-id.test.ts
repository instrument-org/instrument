import { describe, expect, it } from "vitest";

import { isTaskId } from "./is-task-id";

describe("isTaskId", () => {
  it.each([
    ["my-app", true],
    ["test123", true],
    ["chat-old-task", true],
    ["eval-123", true],
    ["my-app.preview", false],
    ["sandbox-test.my-app", false],
    ["version-abc.my-app", false],
  ])("should return %s for %s", (id, expected) => {
    expect(isTaskId(id)).toBe(expected);
  });
});
