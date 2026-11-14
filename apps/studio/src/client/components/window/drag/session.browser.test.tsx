import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { currentDrag, pressToDrag } from "./session";

const AT = { x: 100, y: 100 };

const pointer = (type: string, x: number) =>
  window.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: AT.y, isPrimary: true }),
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

it("keeps a drag when a page in the window takes the keyboard, and takes it back for the drag", async () => {
  pressTab();
  drag();
  expect(currentDrag()?.held.kind).toBe("tab");

  page.focus();
  expect([document.activeElement, document.hasFocus()]).toEqual([page, true]);
  await afterTasks();

  expect(currentDrag()?.held.kind).toBe("tab");
  expect(document.activeElement).toBe(document.body);
  await userEvent.keyboard("{Escape}");
  expect(currentDrag()).toBeUndefined();
  await frames(2);
  expect(document.activeElement).toBe(home);
});

it("takes the keyboard back from a page that took it during the press", () => {
  pressTab();
  page.focus();
  drag();

  expect(currentDrag()?.held.kind).toBe("tab");
  expect(document.activeElement).toBe(document.body);
});

it("ends a drag when the window loses the system's focus", () => {
  pressTab();
  drag();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));

  expect(currentDrag()).toBeUndefined();
});
