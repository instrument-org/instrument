import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { currentDrag, pressToDrag } from "./session";

// How many holds keep pages off the keyboard (`holdKeyboardFromPages`).
const keyboard = vi.hoisted(() => ({ holds: 0 }));
vi.mock("@/client/lib/browser-pool", () => ({
  holdKeyboardFromPages: () => {
    keyboard.holds += 1;
    let isHeld = true;
    return () => {
      if (isHeld) {
        isHeld = false;
        keyboard.holds -= 1;
      }
    };
  },
}));

const AT = { x: 100, y: 100 };

/** A pointer event at a point along the row, the button down while it moves unless `buttons` says. */
const pointer = (
  type: string,
  x: number,
  buttons = type === "pointermove" ? 1 : 0,
) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      buttons,
      clientX: x,
      clientY: AT.y,
      isPrimary: true,
    }),
  );

/** Presses a tab and moves the pointer past the start, which makes the press a drag. */
const pressTab = () =>
  pressToDrag(
    { button: 0, clientX: AT.x, clientY: AT.y, isPrimary: true },
    () => ({
      grab: { x: 0, y: 0 },
      held: { group: "group", id: "tab", key: "tab", kind: "tab", side: 0 },
    }),
  );
const drag = () => {
  pointer("pointermove", AT.x + 40);
};

const afterTasks = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left === 0) {
        resolve();
      } else {
        requestAnimationFrame(() => step(left - 1));
      }
    };
    step(count);
  });

/** A page in a frame of its own, as a guest is, and the screen's home for the keyboard. */
let page: HTMLIFrameElement;
let home: HTMLElement;

beforeEach(async () => {
  const tab = document.createElement("div");
  tab.toggleAttribute("data-app-tab-active", true);
  home = document.createElement("div");
  home.toggleAttribute("data-keyboard-home", true);
  home.tabIndex = -1;
  home.textContent = "Home";
  tab.append(home);
  document.body.append(tab);
  page = document.createElement("iframe");
  page.srcdoc = "<input>";
  const loaded = new Promise((resolve) => {
    page.addEventListener("load", resolve, { once: true });
  });
  document.body.append(page);
  await loaded;
  window.focus();
});

afterEach(() => {
  pointer("pointerup", AT.x);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * As a Mac has it, the window's document reads as unfocused while a page in
 * it has the keyboard; elsewhere it reads as focused.
 */
const readFocusAs = (system: "mac" | "other") => {
  if (system === "mac") {
    vi.spyOn(document, "hasFocus").mockImplementation(
      () => document.activeElement !== page,
    );
  }
};

it.each(["mac", "other"] as const)(
  "keeps a drag when a page in the window takes the keyboard, and takes it back for the drag (%s)",
  async (system) => {
    readFocusAs(system);
    pressTab();
    drag();
    expect(currentDrag()?.held.kind).toBe("tab");

    page.focus();
    expect(document.activeElement).toBe(page);
    await afterTasks();

    expect(currentDrag()?.held.kind).toBe("tab");
    expect(document.activeElement).toBe(document.body);
    await userEvent.keyboard("{Escape}");
    expect(currentDrag()).toBeUndefined();
    await frames(2);
    expect(document.activeElement).toBe(home);
  },
);

it.each(["mac", "other"] as const)(
  "takes the keyboard back from a page that took it during the press (%s)",
  (system) => {
    readFocusAs(system);
    pressTab();
    page.focus();
    drag();

    expect(currentDrag()?.held.kind).toBe("tab");
    expect(document.activeElement).toBe(document.body);
  },
);

it("ends a drag when the window loses the system's focus", () => {
  pressTab();
  drag();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));

  expect(currentDrag()).toBeUndefined();
});

it("holds pages off the keyboard from the press until the drag ends", () => {
  pressTab();
  expect(keyboard.holds).toBe(1);
  drag();
  expect(keyboard.holds).toBe(1);
  pointer("pointerup", AT.x + 40);

  expect(currentDrag()).toBeUndefined();
  expect(keyboard.holds).toBe(0);
});

it("lets pages pass the pointer from the press, so a move over one still reaches the press", () => {
  const passes = () => getComputedStyle(page).pointerEvents === "none";
  expect(passes()).toBe(false);
  pressTab();
  expect(passes()).toBe(true);
  pointer("pointerup", AT.x);

  expect(passes()).toBe(false);
});

it("drops a press whose button came up where the window never heard it", () => {
  pressTab();
  pointer("pointermove", AT.x + 40, 0);

  expect(currentDrag()).toBeUndefined();
  expect(keyboard.holds).toBe(0);
});

it("lets pages take the keyboard once a press ends as a click", () => {
  pressTab();
  pointer("pointerup", AT.x);

  expect(keyboard.holds).toBe(0);
});
