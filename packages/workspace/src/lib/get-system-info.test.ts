import { describe, expect, it } from "vitest";

import { osName } from "./get-system-info";

describe("osName", () => {
  it.each([
    ["win32", "10.0.26100", "Windows 11 (build 26100)"],
    ["win32", "10.0.19045", "Windows 10 (build 19045)"],
    ["win32", "6.3", "Windows 6.3"],
    ["freebsd", "14.1", "freebsd 14.1"],
  ] as const)("names %s %s as %s", async (platform, release, expected) => {
    expect(await osName(platform, release)).toBe(expected);
  });

  it.runIf(process.platform === "darwin")(
    "names macOS by its product version, not Darwin's",
    async () => {
      expect(await osName("darwin", "27.0.0")).toMatch(/^macOS \d+\.\d+/);
    },
  );
});
