import { describe, expect, it } from "vitest";

import { shouldSkipSigning } from "./win-cloud-hsm-sign.js";

describe("shouldSkipSigning", () => {
  it.each([
    String.raw`C:\build\app.asar.unpacked\node_modules\@vscode\ripgrep\bin\rg.exe`,
    "/build/app.asar.unpacked/node_modules/@vscode/ripgrep/bin/rg.exe",
    String.raw`C:\build\node_modules\@VSCODE\Ripgrep\bin\RG.EXE`,
  ])("skips packaged ripgrep binary at %s", (file) => {
    expect(shouldSkipSigning(file)).toBe(true);
  });

  it.each([
    String.raw`C:\build\Instrument.exe`,
    String.raw`C:\build\app.asar.unpacked\node_modules\dugite\git\cmd\git.exe`,
    "/build/app.asar.unpacked/node_modules/@vscode/ripgrep/bin/rg-helper.exe",
  ])("keeps signing unrelated executable at %s", (file) => {
    expect(shouldSkipSigning(file)).toBe(false);
  });
});
