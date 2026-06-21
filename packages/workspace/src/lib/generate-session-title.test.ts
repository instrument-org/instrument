import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAppConfigForDir } from "../test/helpers/mock-app-config";
import {
  isSessionTitleAutoReplaceable,
  isUntitledChatSessionTitle,
} from "./generate-session-title";
import { getProjectManifest } from "./project-manifest";

vi.mock("./project-manifest", () => ({
  getProjectManifest: vi.fn(),
}));

const mockGetProjectManifest = vi.mocked(getProjectManifest);

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
  const appConfig = createMockAppConfigForDir("/tmp/instrument-test-project");

  beforeEach(() => {
    mockGetProjectManifest.mockReset();
  });

  it("is true for Untitled chat without reading manifest", async () => {
    await expect(
      isSessionTitleAutoReplaceable({
        appConfig,
        title: "Untitled chat",
      }),
    ).resolves.toBe(true);
    expect(mockGetProjectManifest).not.toHaveBeenCalled();
  });

  it("is true when title equals manifest name", async () => {
    mockGetProjectManifest.mockResolvedValue({ name: "Fix login bug" });
    await expect(
      isSessionTitleAutoReplaceable({
        appConfig,
        title: "Fix login bug",
      }),
    ).resolves.toBe(true);
  });

  it("is false when title differs from manifest name", async () => {
    mockGetProjectManifest.mockResolvedValue({ name: "Other" });
    await expect(
      isSessionTitleAutoReplaceable({
        appConfig,
        title: "Fix login bug",
      }),
    ).resolves.toBe(false);
  });
});
