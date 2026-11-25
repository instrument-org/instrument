import { describe, expect, it } from "vitest";

import { chooseFindTarget, insideViewer } from "./find-targets";
import { placeOf } from "./keyboard-place";

// A window with the inbox beside a screen, a viewer open in the screen, and a
// dialog over it all.
function layout() {
  document.body.innerHTML = `
    <div id="inbox"><input id="inbox-search" /><div id="row"></div></div>
    <div id="screen">
      <button id="screen-blank"></button>
      <div id="viewer"><input id="viewer-find" /><div id="page"></div></div>
    </div>
    <div role="dialog" id="dialog"><button id="confirm"></button></div>
  `;
  const at = (id: string) => {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(id);
    }
    return element;
  };
  const entry = (
    name: string,
    surface: string,
    overrides: Partial<{
      holdsKeyboard: boolean;
      stamp: number;
      visible: boolean;
    }> = {},
  ) => ({
    holdsKeyboard: false,
    name,
    stamp: 0,
    surface: at(surface),
    visible: true,
    ...overrides,
  });
  return { at, entry };
}

describe("chooseFindTarget", () => {
  it("picks the innermost surface the keyboard is in", () => {
    const { at, entry } = layout();
    const entries = [
      entry("inbox", "inbox"),
      entry("screen", "screen"),
      entry("viewer", "viewer"),
    ];
    expect(chooseFindTarget(entries, at("page"))?.name).toBe("viewer");
    expect(chooseFindTarget(entries, at("screen-blank"))?.name).toBe("screen");
    expect(chooseFindTarget(entries, at("row"))?.name).toBe("inbox");
  });

  it("picks a page holding the keyboard, whose element is elsewhere", () => {
    const { entry } = layout();
    const entries = [
      entry("inbox", "inbox", { stamp: 5 }),
      entry("browser", "screen", { holdsKeyboard: true }),
    ];
    expect(chooseFindTarget(entries, document.body)?.name).toBe("browser");
  });

  it("falls back to the surface visited last, then the one registered last", () => {
    const { entry } = layout();
    expect(
      chooseFindTarget(
        [
          entry("inbox", "inbox", { stamp: 2 }),
          entry("viewer", "viewer", { stamp: 1 }),
        ],
        null,
      )?.name,
    ).toBe("inbox");
    expect(
      chooseFindTarget(
        [entry("inbox", "inbox"), entry("viewer", "viewer")],
        null,
      )?.name,
    ).toBe("viewer");
  });

  it("passes over surfaces that are not on screen", () => {
    const { at, entry } = layout();
    const entries = [
      entry("inbox", "inbox", { stamp: 1 }),
      entry("viewer", "viewer", { stamp: 2, visible: false }),
    ];
    expect(chooseFindTarget(entries, at("page"))?.name).toBe("inbox");
  });

  it("opens nothing behind a dialog that has no search", () => {
    const { at, entry } = layout();
    expect(
      chooseFindTarget([entry("inbox", "inbox", { stamp: 1 })], at("confirm")),
    ).toBeUndefined();
  });
});

describe("insideViewer", () => {
  it("puts a toolbar drawn outside its viewer inside it", () => {
    const { at, entry } = layout();
    at("page").innerHTML = `<span hidden id="mark"></span>`;
    at("inbox").insertAdjacentHTML(
      "beforeend",
      `<div data-find-surface-of="mark"><input id="field" /></div>`,
    );
    const entries = [entry("inbox", "inbox"), entry("viewer", "viewer")];
    const place = insideViewer(at("field"));
    expect(place).toBe(at("mark"));
    expect(chooseFindTarget(entries, place)?.name).toBe("viewer");
    expect(insideViewer(at("row"))).toBe(at("row"));
  });

  it("leaves an element where it is once its viewer is gone", () => {
    const { at } = layout();
    at("row").setAttribute("data-find-surface-of", "gone");
    expect(insideViewer(at("row"))).toBe(at("row"));
  });
});

describe("placeOf", () => {
  it("is the focused element, or the last press when focus is on the body", () => {
    const { at } = layout();
    expect(placeOf({ focused: at("viewer-find"), pressed: at("row") })).toBe(
      at("viewer-find"),
    );
    expect(placeOf({ focused: document.body, pressed: at("row") })).toBe(
      at("row"),
    );
    const gone = at("row");
    gone.remove();
    expect(placeOf({ focused: document.body, pressed: gone })).toBeNull();
  });

  it("is the side with the keyboard unless the caret is in it or in a dialog", () => {
    const { at } = layout();
    const side = at("inbox");
    expect(
      placeOf({ focused: at("viewer-find"), pressed: at("row"), side }),
    ).toBe(side);
    expect(placeOf({ focused: document.body, pressed: at("row"), side })).toBe(
      side,
    );
    expect(
      placeOf({ focused: at("row"), pressed: null, side: at("inbox") }),
    ).toBe(at("row"));
    expect(placeOf({ focused: at("confirm"), pressed: null, side })).toBe(
      at("confirm"),
    );
  });
});
