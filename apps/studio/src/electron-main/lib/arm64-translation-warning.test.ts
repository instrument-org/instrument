import {
  describe,
  expect,
  it,
} from "vitest";

import {
  shouldShowARM64TranslationWarning,
} from "./arm64-translation-warning";

describe("shouldShowARM64TranslationWarning", () => {
  it("shows only for packaged x64 macOS apps running under ARM64 translation", () => {
    expect(
      shouldShowARM64TranslationWarning({
        arch: "x64",
        isPackaged: true,
        platform: "darwin",
        runningUnderARM64Translation: true,
      }),
    ).toBe(true);
  });

  it("skips development builds", () => {
    expect(
      shouldShowARM64TranslationWarning({
        arch: "x64",
        isPackaged: false,
        platform: "darwin",
        runningUnderARM64Translation: true,
      }),
    ).toBe(false);
  });

  it("skips native Apple Silicon builds", () => {
    expect(
      shouldShowARM64TranslationWarning({
        arch: "arm64",
        isPackaged: true,
        platform: "darwin",
        runningUnderARM64Translation: false,
      }),
    ).toBe(false);
  });

  it("shows for packaged x64 Windows apps running under ARM64 translation", () => {
    expect(
      shouldShowARM64TranslationWarning({
        arch: "x64",
        isPackaged: true,
        platform: "win32",
        runningUnderARM64Translation: true,
      }),
    ).toBe(true);
  });

  it("skips x64 macOS apps that are not translated", () => {
    expect(
      shouldShowARM64TranslationWarning({
        arch: "x64",
        isPackaged: true,
        platform: "darwin",
        runningUnderARM64Translation: false,
      }),
    ).toBe(false);
  });

  it("skips platforms where Electron does not expose ARM64 translation", () => {
    expect(
      shouldShowARM64TranslationWarning({
        arch: "x64",
        isPackaged: true,
        platform: "linux",
        runningUnderARM64Translation: false,
      }),
    ).toBe(false);
  });
});
