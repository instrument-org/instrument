import { describe, expect, it } from "vitest";

import { saveName, saveTypeOf } from "./save-page-format";

describe("saveName", () => {
  it.each([
    ["Example Domain", "https://example.com/", "Example Domain.html"],
    ['A/B: "C" <d>?', "https://example.com/", "A B C d.html"],
    ["", "https://news.example.com/a", "news.example.com.html"],
    ["  ...hidden", "https://example.com/", "hidden.html"],
    ["", "about:blank", "page.html"],
    ["x".repeat(150), "https://example.com/", `${"x".repeat(100)}.html`],
  ])("%j at %s saves as %j", (title, url, expected) => {
    expect(saveName({ title, url })).toBe(expected);
  });
});

describe("saveTypeOf", () => {
  it.each([
    ["/tmp/page.html", "HTMLComplete"],
    ["/tmp/page.HTM", "HTMLOnly"],
    ["/tmp/page.htm", "HTMLOnly"],
    ["/tmp/page", "HTMLComplete"],
  ])("%s saves as %s", (filePath, expected) => {
    expect(saveTypeOf(filePath)).toBe(expected);
  });
});
