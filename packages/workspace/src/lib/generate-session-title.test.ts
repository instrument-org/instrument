import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAppConfigForDir } from "../test/helpers/mock-app-config";
import {
  isSessionTitleAutoReplaceable,
  isUntitledChatSessionTitle,
} from "./generate-session-title";
import { getTaskManifest } from "./task-manifest";

vi.mock("./task-manifest", () => ({
  getTaskManifest: vi.fn(),
}));

const mockGetTaskManifest = vi.mocked(getTaskManifest);

describe("isUntitledChatSessionTitle", () => {
  it.each([
    ["Untitled chat", true],
    ["Untitled chat 2", true],
    ["Untitled chat 10", true],
    ["untitled chat", false],
    ["Untitled Chat", false],
    ["Untitled research", false],
    ["My project", false],
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
  const taskId = createMockAppConfigForDir("/tmp/instrument-test-project");

  beforeEach(() => {
    mockGetTaskManifest.mockReset();
  });

  it("is true for Untitled chat without reading manifest", async () => {
    await expect(
      isSessionTitleAutoReplaceable({
        taskId,
        title: "Untitled chat",
      }),
    ).resolves.toBe(true);
    expect(mockGetTaskManifest).not.toHaveBeenCalled();
  });

  it("is true when title equals manifest name", async () => {
    mockGetTaskManifest.mockResolvedValue({ name: "Fix login bug" });
    await expect(
      isSessionTitleAutoReplaceable({
        taskId,
        title: "Fix login bug",
      }),
    ).resolves.toBe(true);
  });

  it("is false when title differs from manifest name", async () => {
    mockGetTaskManifest.mockResolvedValue({ name: "Other" });
    await expect(
      isSessionTitleAutoReplaceable({
        taskId,
        title: "Fix login bug",
      }),
    ).resolves.toBe(false);
  });
});
