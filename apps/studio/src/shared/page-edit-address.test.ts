import {
  isPageEditAddress,
  withoutPageEditParam,
} from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

describe("withoutPageEditParam", () => {
  it.each([
    ["file:///a/page.html?instrument-edit=n1", "file:///a/page.html"],
    ["file:///a/page.html?instrument-edit=n1#top", "file:///a/page.html#top"],
    [
      "file:///a/page.html?instrument-edit=n1&tab=2",
      "file:///a/page.html?tab=2",
    ],
    [
      "file:///a/page.html?tab=2&instrument-edit=n1",
      "file:///a/page.html?tab=2",
    ],
    [
      "✓ Page\n  file:///task/page.html?instrument-edit=n1\n",
      "✓ Page\n  file:///task/page.html\n",
    ],
    ["file:///a/page.html?tab=2", "file:///a/page.html?tab=2"],
  ])("%s → %s", (input, expected) => {
    expect(withoutPageEditParam(input)).toBe(expected);
  });
});

describe("isPageEditAddress", () => {
  it.each([
    ["file:///a/page.html?instrument-edit=n1", true],
    ["file:///a/page.html?tab=2&instrument-edit=n1", true],
    ["file:///a/page.html?tab=2", false],
    ["file:///a/instrument-edit=x.html", false],
  ])("%s → %s", (url, expected) => {
    expect(isPageEditAddress(url)).toBe(expected);
  });
});
