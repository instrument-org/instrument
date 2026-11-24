import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENTRY_REPORT_GAP_MS,
  hasRestoredEntry,
  isEntry,
  watchEntries,
} from "./entries";

function field(html: string) {
  document.body.innerHTML = html;
  const made = document.body.firstElementChild;
  if (!(made instanceof HTMLElement)) {
    throw new TypeError("no element");
  }
  return made;
}

describe("what counts as something entered", () => {
  it.each([
    ["a text field", "<input>", true],
    ["a search field", '<input type="search">', true],
    ["a password", '<input type="password">', true],
    ["a chosen file", '<input type="file">', true],
    ["a date", '<input type="date">', true],
    ["a text area", "<textarea></textarea>", true],
    ["a picked option", "<select><option>a</option></select>", true],
    ["a checkbox", '<input type="checkbox">', false],
    ["a radio button", '<input type="radio">', false],
    ["a slider", '<input type="range">', false],
    ["a color", '<input type="color">', false],
    ["a plain element", "<div></div>", false],
  ])("%s", (_case, html, expected) => {
    expect(isEntry(field(html))).toBe(expected);
  });

  it("takes anything inside an editable region", () => {
    const inner = field("<div><p>words</p></div>").firstElementChild;
    // jsdom computes no `isContentEditable`.
    Object.defineProperty(inner, "isContentEditable", { value: true });
    expect(isEntry(inner ?? undefined)).toBe(true);
  });
});

describe("a document come back with what was entered before", () => {
  const page = (html: string) => {
    const made = document.implementation.createHTMLDocument();
    made.body.innerHTML = html;
    return made;
  };
  const typed = () => {
    const made = page('<input id="name" value="as written">');
    const name = made.querySelector("input");
    if (name) {
      name.value = "put back";
    }
    return made;
  };

  it.each([
    ["Back or Forward", "back_forward", true],
    ["a reload", "reload", true],
    ["a link followed", "navigate", false],
    ["nothing said", undefined, false],
  ])("after %s", (_case, arrivedBy, expected) => {
    expect(hasRestoredEntry(typed(), arrivedBy)).toBe(expected);
  });

  it("takes a text area and a picked option, and leaves a toggle and an untouched field", () => {
    const area = page("<textarea>as written</textarea>");
    const textarea = area.querySelector("textarea");
    if (textarea) {
      textarea.value = "put back";
    }
    expect(hasRestoredEntry(area, "reload")).toBe(true);

    const picked = page(
      "<select><option selected>a</option><option>b</option></select>",
    );
    const option = picked.querySelectorAll("option")[1];
    if (option) {
      option.selected = true;
    }
    expect(hasRestoredEntry(picked, "reload")).toBe(true);

    const toggled = page('<input type="checkbox" value="on">');
    const box = toggled.querySelector("input");
    if (box) {
      box.checked = true;
    }
    expect(hasRestoredEntry(toggled, "reload")).toBe(false);
    expect(hasRestoredEntry(page('<input value="as written">'), "reload")).toBe(
      false,
    );
  });

  it("is told of once the page is shown", () => {
    const made = document.implementation.createHTMLDocument();
    const shown = new EventTarget();
    Object.defineProperty(made, "defaultView", { value: shown });
    made.body.innerHTML = '<input value="as written">';
    const name = made.querySelector("input");
    if (name) {
      name.value = "put back";
    }
    const told = vi.fn();
    watchEntries(made, told, { arrivedBy: () => "back_forward" });
    expect(told).not.toHaveBeenCalled();
    shown.dispatchEvent(new Event("pageshow"));
    expect(told).toHaveBeenCalledTimes(1);
  });
});

describe("telling of entries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A page watched for entries, with `type` to enter something and `told` for each telling. */
  function watched(isReal = true) {
    const page = document.implementation.createHTMLDocument();
    page.body.innerHTML =
      '<input id="name"><input id="mute" type="checkbox"><div id="host"></div>';
    const told = vi.fn();
    watchEntries(page, told, { isReal: () => isReal });
    const type = (
      id = "name",
      event = new Event("input", { bubbles: true }),
    ) => {
      page.querySelector(`#${id}`)?.dispatchEvent(event);
    };
    return { told, type };
  }

  it("tells of text edited inside an element that hides its field", () => {
    const { told, type } = watched();
    type("host", new Event("input", { bubbles: true }));
    expect(told).not.toHaveBeenCalled();
    type(
      "host",
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );
    expect(told).toHaveBeenCalledTimes(1);
  });

  it("tells of the first at once", () => {
    const { told, type } = watched();
    type();
    expect(told).toHaveBeenCalledTimes(1);
  });

  it("tells of a run once more, at its gap's end, however many there were", () => {
    const { told, type } = watched();
    type();
    type();
    type();
    expect(told).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(ENTRY_REPORT_GAP_MS);
    expect(told).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(ENTRY_REPORT_GAP_MS * 5);
    expect(told).toHaveBeenCalledTimes(2);
  });

  it("tells at once again after a quiet gap", () => {
    const { told, type } = watched();
    type();
    vi.advanceTimersByTime(ENTRY_REPORT_GAP_MS);
    type();
    expect(told).toHaveBeenCalledTimes(2);
  });

  it("says nothing of a toggle, or of a value a script set", () => {
    const toggled = watched();
    toggled.type("mute");
    expect(toggled.told).not.toHaveBeenCalled();
    const scripted = watched(false);
    scripted.type();
    expect(scripted.told).not.toHaveBeenCalled();
  });
});
