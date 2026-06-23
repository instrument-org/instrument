import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import {
  isSessionTitleAutoReplaceable,
  isUntitledChatSessionTitle,
} from "./generate-session-title";
import { getTaskSettings } from "./task-settings";

vi.mock("./task-settings", () => ({
  getTaskSettings: vi.fn(),
}));

const mockGetTaskSettings = vi.mocked(getTaskSettings);

describe("isUntitledChatSessionTitle", () => {
  it.each([
    ["Untitled chat", true],
    ["Untitled chat 2", true],
    ["Untitled chat 10", true],
    ["untitled chat", false],
    ["Untitled Chat", false],
    ["Untitled research", false],
    ["My task", false],
    ["2026-04-29 Chat", false],
    ["2026-04-29 Chat 2", false],
    ["2026-04-29 Chat 10", false],
    ["2026-4-29 Chat", false],
    ["2026-04-29", false],
    ["2026-04-29 Research", false],
  ])("(%s) -> %s", (title, expected) => {
    expect(isUntitledChatSessionTitle(title)).toBe(expected);
  });
});

describe("isSessionTitleAutoReplaceable", () => {
  const taskId = createMockTaskConfigForDir("/tmp/instrument-test-task");

  beforeEach(() => {
    mockGetTaskSettings.mockReset();
  });

  it("is true for Untitled chat without reading settings", async () => {
    await expect(
      isSessionTitleAutoReplaceable({
        taskId,
        title: "Untitled chat",
      }),
    ).resolves.toBe(true);
    expect(mockGetTaskSettings).not.toHaveBeenCalled();
  });

  it("is true when title equals settings name", async () => {
    mockGetTaskSettings.mockResolvedValue({ name: "Fix login bug" });
    await expect(
      isSessionTitleAutoReplaceable({
        taskId,
        title: "Fix login bug",
      }),
    ).resolves.toBe(true);
  });

  it("is false when title differs from settings name", async () => {
    mockGetTaskSettings.mockResolvedValue({ name: "Other" });
    await expect(
      isSessionTitleAutoReplaceable({
        taskId,
        title: "Fix login bug",
      }),
    ).resolves.toBe(false);
  });
});
