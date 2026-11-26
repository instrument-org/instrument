import { pageOfSide } from "@/client/lib/keyboard-place";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

function side(html: string, attributes = "") {
  const element = document.createElement("div");
  element.innerHTML = `<div data-group-side="0" ${attributes}>${html}</div>`;
  return element.firstElementChild!;
}

describe("pageOfSide", () => {
  it.each([
    [
      "a page tab",
      side("", 'data-page-tab="tab_01M7EKJA7JST69N0RVMKWTP7Q8"'),
      "tab_01M7EKJA7JST69N0RVMKWTP7Q8",
    ],
    [
      "a file tab drawing its file as a page",
      side(
        '<div><div data-hosted-page-tab="tab_01M7EKJA7JST69N0RVMKWTP7Q9"></div></div>',
      ),
      "tab_01M7EKJA7JST69N0RVMKWTP7Q9",
    ],
  ])("means the page of %s", (_, element, tab) => {
    expect(pageOfSide(element)).toBe(browserTargetOf(tab));
  });

  it("means none for a side showing no page", () => {
    expect(pageOfSide(side("<div></div>"))).toBeNull();
  });
});
