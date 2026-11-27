import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  installKeyboardLoan,
  isKeyboardLentFromField,
  onKeyboardLentToPage,
  returnLentKeyboard,
  tellWindowKeyboardLeft,
} from "./keyboard-loan";

// Whether the next events count as the browser's own doing, which no event
// a test causes is, and the page a person took.
let isBrowsers = false;
let personsPage: Element | null = null;
let uninstall: () => void;
let field: HTMLInputElement;
let other: HTMLButtonElement;
let page: HTMLElement;
let heard: string[];

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** The window as a page taking the keyboard leaves it, and as one giving it back does. */
const windowLoses = () => window.dispatchEvent(new Event("blur"));
const windowGains = () => window.dispatchEvent(new Event("focus"));

beforeEach(() => {
  isBrowsers = false;
  personsPage = null;
  uninstall = installKeyboardLoan({
    isBrowsersDoing: () => isBrowsers,
    isPersonsPage: (guest) => guest === personsPage,
  });
  field = document.createElement("input");
  field.setAttribute("aria-label", "field");
  other = document.createElement("button");
  other.textContent = "Other";
  other.setAttribute("aria-label", "other");
  // A guest is an element of the window's that takes focus, as far as the
  // window can tell.
  page = document.createElement("webview");
  page.tabIndex = -1;
  document.body.append(field, other, page);
  heard = [];
  const note = (event: Event) => {
    const { target } = event;
    const name =
      target === window
        ? "window"
        : target instanceof Element
          ? (target.getAttribute("aria-label") ?? target.tagName.toLowerCase())
          : "?";
    heard.push(`${name} ${event.type}`);
  };
  const controller = new AbortController();
  for (const type of ["blur", "focus"]) {
    for (const target of [field, other, window]) {
      target.addEventListener(type, note, { signal: controller.signal });
    }
  }
  const stopLoans = uninstall;
  uninstall = () => {
    controller.abort();
    stopLoans();
  };
});

afterEach(() => {
  uninstall();
  document.body.replaceChildren();
});

describe("a page that only borrows the keyboard", () => {
  it("is not heard taking it from a field, or giving it back", () => {
    field.focus();
    heard = [];
    page.focus();
    windowLoses();
    expect(isKeyboardLentFromField()).toBe(true);
    windowGains();
    field.focus();
    expect(heard).toEqual([]);
    expect(document.activeElement).toBe(field);
    expect(isKeyboardLentFromField()).toBe(false);
  });

  it("is not heard when the browser first lets the field go onto nothing", () => {
    field.focus();
    heard = [];
    isBrowsers = true;
    field.blur();
    windowLoses();
    page.focus();
    windowGains();
    field.focus();
    expect(heard).toEqual([]);
  });

  it("is not heard taking it from nothing either", async () => {
    isBrowsers = true;
    windowLoses();
    page.focus();
    expect(returnLentKeyboard()).toBe(true);
    windowGains();
    await wait(150);
    expect(heard).toEqual([]);
    expect(document.activeElement).toBe(document.body);
  });

  it("gives the keyboard back to the field it left when asked", () => {
    field.focus();
    page.focus();
    windowLoses();
    heard = [];
    expect(returnLentKeyboard()).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(heard).toEqual([]);
  });

  it("has no field to give it back to once that field is out of sight", () => {
    field.focus();
    page.focus();
    windowLoses();
    field.style.display = "none";
    expect(returnLentKeyboard()).toBe(false);
  });
});

describe("a keyboard that left the window for good", () => {
  it("is heard once whoever knows the page says it keeps it", async () => {
    const asked = vi.fn();
    const stop = onKeyboardLentToPage(asked);
    field.focus();
    heard = [];
    page.focus();
    windowLoses();
    await wait(20);
    expect(asked).toHaveBeenCalledExactlyOnceWith(page);
    expect(heard).toEqual([]);
    tellWindowKeyboardLeft();
    expect(heard).toEqual(["field blur", "window blur"]);
    stop();
  });

  it("is heard at once with no one to ask after the page", async () => {
    field.focus();
    heard = [];
    page.focus();
    windowLoses();
    await wait(20);
    expect(heard).toEqual(["field blur", "window blur"]);
  });

  it("is heard as it happens for a page a person took", () => {
    field.focus();
    heard = [];
    personsPage = page;
    page.focus();
    expect(heard).toEqual(["field blur"]);
  });

  it("is heard when another app has it, after a moment for it to come back", async () => {
    field.focus();
    heard = [];
    isBrowsers = true;
    // The window loses the keyboard with the field still its focused element.
    field.dispatchEvent(new FocusEvent("blur"));
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    windowLoses();
    await wait(20);
    expect(heard).toEqual([]);
    await wait(150);
    expect(heard).toEqual(["field blur", "window blur"]);
  });

  it("is heard when the window's own code puts it somewhere else", () => {
    field.focus();
    page.focus();
    windowLoses();
    heard = [];
    windowGains();
    other.focus();
    expect(heard).toEqual(["field blur", "other focus"]);
    expect(document.activeElement).toBe(other);
  });

  it("is heard when a press of the person's puts it somewhere else", async () => {
    field.focus();
    page.focus();
    windowLoses();
    heard = [];
    isBrowsers = true;
    await userEvent.click(other);
    expect(heard).toContain("field blur");
    expect(document.activeElement).toBe(other);
  });
});

describe("a keyboard that ran on out of a page onto a control", () => {
  it("is put back in the field it left, unheard", () => {
    field.focus();
    heard = [];
    isBrowsers = true;
    field.blur();
    windowLoses();
    windowGains();
    other.focus();
    expect(document.activeElement).toBe(field);
    expect(heard).toEqual([]);
  });

  it("is put back on nothing when that is where it left from", () => {
    isBrowsers = true;
    windowLoses();
    windowGains();
    other.focus();
    expect(document.activeElement).toBe(document.body);
    expect(heard).toEqual([]);
  });
});

describe("a field losing the keyboard some other way", () => {
  it("is heard as it happens when a script lets go of it", () => {
    field.focus();
    heard = [];
    field.blur();
    expect(heard).toEqual(["field blur"]);
  });

  it("is heard as it happens when it is no longer fit to hold it", () => {
    field.focus();
    heard = [];
    isBrowsers = true;
    field.disabled = true;
    field.dispatchEvent(new FocusEvent("blur"));
    expect(heard).toEqual(["field blur"]);
  });

  it("is heard as it happens with the stack to go by, under a script's own call", () => {
    uninstall();
    uninstall = installKeyboardLoan({
      isPersonsPage: () => false,
    });
    const blurred = vi.fn();
    field.addEventListener("blur", blurred);
    field.focus();
    field.blur();
    expect(blurred).toHaveBeenCalledOnce();
  });
});
