import { describe, expect, it } from "vitest";

import { isAddressableTaskFilePath } from "./task-file-path";

describe("isAddressableTaskFilePath", () => {
  it.each([
    ["work/report.html", true],
    ["/mnt/Instrument/report.html", true],
    ["/skills/pdf/SKILL.md", true],
    // Tasks work in their chat's folder; no task has a folder of its own.
    ["/tasks/2026-08-26-mac-studio/output/explainer.html", false],
    ["/Users/someone/.ssh/id_rsa", false],
    ["/tasks/../etc/passwd", false],
    [String.raw`work\report.html`, false],
  ])("%s → %s", (path, addressable) => {
    expect(isAddressableTaskFilePath(path)).toBe(addressable);
  });
});
