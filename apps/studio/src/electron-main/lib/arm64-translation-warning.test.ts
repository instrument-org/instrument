import { describe, expect, it } from "vitest";

import { shouldShowARM64TranslationWarning } from "./arm64-translation-warning";

// A packaged x64 Mac build running under Rosetta, which shows the warning.
const translated = {
  arch: "x64",
  isPackaged: true,
  platform: "darwin",
  runningUnderARM64Translation: true,
} as const;

describe("shouldShowARM64TranslationWarning", () => {
  it.each([
    ["a translated x64 Mac build", {}, true],
    ["a translated x64 Windows build", { platform: "win32" }, true],
    ["a development build", { isPackaged: false }, false],
    [
      "an x64 build that is not translated",
      { runningUnderARM64Translation: false },
      false,
    ],
    ["an arm64 build", { arch: "arm64" }, false],
    [
      "Linux, where Electron does not report translation",
      { platform: "linux" },
      false,
    ],
  ] as const)("warns for %s: %s", (_, change, expected) => {
    expect(
      shouldShowARM64TranslationWarning({ ...translated, ...change }),
    ).toBe(expected);
  });
});
