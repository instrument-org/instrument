import { describe, expect, it } from "vitest";

import { fileUrlOf } from "./file-url";

describe("fileUrlOf", () => {
  it.each([
    ["/Users/casey/a b.html", "file:///Users/casey/a%20b.html"],
    ["/Users/casey/back\\slash.html", "file:///Users/casey/back%5Cslash.html"],
    ["C:\\Users\\casey\\a.html", "file:///C%3A/Users/casey/a.html"],
    ["C:/Users/casey/a.html", "file:///C%3A/Users/casey/a.html"],
  ])("%j → %j", (hostPath, url) => {
    expect(fileUrlOf(hostPath)).toBe(url);
  });
});
