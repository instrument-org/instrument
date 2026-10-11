import { describe, expect, it } from "vitest";

import { isAddressableTaskFilePath } from "./task-file-path";

describe("isAddressableTaskFilePath", () => {
  it.each([
    ["work/report.html", true],
    ["/Users/someone/Documents/report.html", true],
    ["/Users/someone/.ssh/id_rsa", true],
    ["/tasks/../etc/passwd", false],
    [String.raw`work\report.html`, false],
  ])("%s → %s", (path, addressable) => {
    expect(isAddressableTaskFilePath(path)).toBe(addressable);
  });
});
