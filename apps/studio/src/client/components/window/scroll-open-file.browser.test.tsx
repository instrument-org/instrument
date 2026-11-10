import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { scrollOpenFileOnSpace } from "./scroll-open-file";

async function renderBeside() {
  await renderInBrowser(
    <div style={{ display: "flex", height: 320 }}>
      <div data-testid="folder">
        <div data-file-system-listing="">
          <button type="button">long.pdf</button>
          <input aria-label="Name" />
        </div>
        <button type="button">Sort</button>
      </div>
      <div data-testid="file" style={{ width: 400 }}>
        <div data-file-scroller="" style={{ height: 320, overflow: "auto" }}>
          <div style={{ height: 3000 }} />
        </div>
      </div>
    </div>,
  );
  const element = (selector: string) => {
    const found = document.querySelector(selector);
    if (!found) {
      throw new Error(`${selector} did not render`);
    }
    return found;
  };
  return {
    file: element("[data-testid=file]"),
    folder: element("[data-testid=folder]"),
    scroller: element("[data-file-scroller]"),
    element,
  };
}

const press = (target: Element, shiftKey = false) => ({
  altKey: false,
  ctrlKey: false,
  key: " ",
  metaKey: false,
  shiftKey,
  target,
});

// With a file open beside the folder, Quick Look is put away and Space on the
// rows did nothing, so a PDF opened from the list could not be paged through
// without first clicking into it.
describe("scrollOpenFileOnSpace", () => {
  it("moves the open file down a screen and back up with Shift", async () => {
    const { element, file, folder, scroller } = await renderBeside();
    const row = element("[data-file-system-listing] button");

    expect(scrollOpenFileOnSpace(press(row), { file, folder })).toBe(true);
    expect(scroller.scrollTop).toBe(280);

    expect(scrollOpenFileOnSpace(press(row, true), { file, folder })).toBe(
      true,
    );
    expect(scroller.scrollTop).toBe(0);
  });

  it.each([
    ["a toolbar button, which Space presses", "[data-testid=folder] > button"],
    ["a name being typed", "input"],
  ])("leaves Space alone on %s", async (_case, selector) => {
    const { element, file, folder, scroller } = await renderBeside();

    expect(
      scrollOpenFileOnSpace(press(element(selector)), { file, folder }),
    ).toBe(false);
    expect(scroller.scrollTop).toBe(0);
  });
});
