import { describe, expect, it } from "vitest";

import { isAddressableChatFilePath } from "./chat-file-path";

describe("isAddressableChatFilePath", () => {
  it.each([
    ["work/report.html", true],
    ["/Users/someone/Documents/report.html", true],
    ["/Users/someone/.ssh/id_rsa", true],
    ["/tasks/../etc/passwd", false],
    [String.raw`work\report.html`, false],
  ])("%s → %s", (path, addressable) => {
    expect(isAddressableChatFilePath(path)).toBe(addressable);
  });
});
