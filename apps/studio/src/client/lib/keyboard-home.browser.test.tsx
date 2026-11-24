import { browserTargetOf } from "@instrument-org/workspace/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import {
  focusScreenHome,
  installKeyboardHome,
  keepCaretOnKeyboardSide,
  placeCaretAfterPress,
} from "./keyboard-home";
import { isPageOnSideWithoutKeyboard } from "./keyboard-place";

let uninstall: () => void;

beforeEach(() => {
  uninstall = installKeyboardHome();
});

afterEach(() => {
  uninstall();
  document.body.replaceChildren();
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

it("lets a tab of a tab list have the press it is picked on, and no other button", () => {
  document.body.innerHTML = `
    <button type="button" role="tab">Grid</button>
    <button type="button">Sort</button>
  `;
  const [tab, button] = document.querySelectorAll("button");
  if (!tab || !button) {
    throw new Error("fixture missing");
  }
  const press = (target: Element) => {
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  expect([press(tab), press(button)]).toEqual([false, true]);
});

it("leaves the keyboard in a popover a button opens while it fades in", async () => {
  document.body.innerHTML = `
    <div data-app-tab-active>
      <div data-keyboard-home tabindex="-1">
        <div role="option" aria-selected="true" tabindex="0">Row</div>
      </div>
      <button type="button">Search</button>
    </div>
  `;
  const tab = document.querySelector<HTMLElement>("[data-app-tab-active]");
  const row = document.querySelector<HTMLElement>('[role="option"]');
  const button = document.querySelector("button");
  if (!tab || !row || !button) {
    throw new Error("fixture missing");
  }
  row.focus();
  button.addEventListener("click", () => {
    const popover = document.createElement("div");
    popover.animate([{ opacity: 0 }, { opacity: 1 }], 500);
    const input = document.createElement("input");
    popover.append(input);
    tab.append(popover);
    input.focus();
  });

  await userEvent.click(button);
  await frames(3);

  expect(document.activeElement?.tagName).toBe("INPUT");
});

it("puts the keyboard in a screen's home without a ring until a key is pressed", async () => {
  document.body.innerHTML = `
    <div data-app-tab-active>
      <div data-keyboard-home>
        <button type="button">First</button>
        <button type="button">Second</button>
      </div>
    </div>
  `;
  const [first, second] = document.querySelectorAll("button");
  if (!first || !second) {
    throw new Error("fixture missing");
  }
  const outline = (element: Element) => getComputedStyle(element).outlineStyle;

  focusScreenHome({ leaving: false });
  await frames(3);

  expect(document.activeElement).toBe(first);
  expect(outline(first)).toBe("none");

  await userEvent.keyboard("{ArrowDown}");

  expect(document.activeElement).toBe(first);
  expect(outline(first)).toBe("solid");

  await userEvent.keyboard("{Tab}");

  expect(document.activeElement).toBe(second);
  expect(outline(second)).toBe("solid");
});

it("leaves a keyboard let go onto nothing where something outside the screen took it", async () => {
  document.body.innerHTML = `
    <div data-app-tab-active>
      <div data-keyboard-home>
        <button type="button">First</button>
      </div>
    </div>
    <textarea aria-label="Prompt"></textarea>
  `;
  const prompt = document.querySelector("textarea");
  if (!prompt) {
    throw new Error("fixture missing");
  }

  focusScreenHome({ leaving: false });
  prompt.focus();
  await frames(3);

  expect(document.activeElement).toBe(prompt);
});

/** A tab group of two sides, the right one with the keyboard: a chat's words on the left, a file's view on the right. */
const TWO_SIDES = `
  <div data-app-tab-active>
    <div data-group-side="0">
      <div data-keyboard-home>
        <div contenteditable="true" aria-label="Composer">draft</div>
      </div>
    </div>
    <div data-group-side="1" data-keyboard>
      <div data-keyboard-home tabindex="-1" aria-label="File"></div>
    </div>
  </div>
`;

const twoSides = () => {
  document.body.innerHTML = TWO_SIDES;
  const composer = document.querySelector<HTMLElement>(
    '[aria-label="Composer"]',
  );
  const file = document.querySelector<HTMLElement>('[aria-label="File"]');
  if (!composer || !file) {
    throw new Error("fixture missing");
  }
  return { composer, file };
};

it("takes the keyboard from the side without it to the home of the side with it", async () => {
  const { composer, file } = twoSides();
  composer.focus();

  focusScreenHome({ leaving: false });
  await frames(3);

  expect(document.activeElement).toBe(file);
});

it("takes away the caret the other side's words kept, so text typed in goes nowhere", async () => {
  const { composer, file } = twoSides();
  composer.focus();
  composer.blur();
  expect(document.getSelection()?.anchorNode?.parentElement).toBe(composer);

  focusScreenHome({ leaving: false });
  await frames(3);
  document.execCommand("insertText", false, "qq");

  expect(document.activeElement).toBe(file);
  expect(document.getSelection()?.rangeCount).toBe(0);
  expect(composer.textContent).toBe("draft");
});

it("hands the keyboard from a home to its words once they are drawn", async () => {
  const { file } = twoSides();

  focusScreenHome({ leaving: false });
  await frames(3);
  expect(document.activeElement).toBe(file);

  const words = document.createElement("div");
  words.contentEditable = "true";
  file.append(words);
  await frames(1);

  expect(document.activeElement).toBe(words);
});

it("sends the keyboard home after a press on a tab lets go of it", async () => {
  const { composer, file } = twoSides();
  const tab = document.createElement("div");
  tab.setAttribute("role", "tab");
  tab.textContent = "Notes";
  // The strip's tab keeps the keyboard where it was, as a button does.
  tab.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  // A press on the other side lets go of the caret there.
  tab.addEventListener("pointerdown", () => {
    composer.blur();
  });
  file.parentElement?.prepend(tab);
  composer.focus();

  await userEvent.click(tab);
  await frames(3);

  expect(document.activeElement).toBe(file);
});

describe("the sides of a tab group", () => {
  /** A group of two sides, a chat's composer on the left and a page on the right, with the keyboard on `keyboard`. */
  const groupSides = (keyboard: "left" | "right") => {
    document.body.innerHTML = `
      <div data-app-tab-active>
        <div data-group-sides>
          <div data-group-side="0" ${keyboard === "left" ? "data-keyboard" : ""}>
            <p style="user-select: text">Words to read</p>
            <div data-keyboard-home><div contenteditable="true">Prompt</div></div>
          </div>
          <div data-group-side="1" data-page-tab="tab_01M7EKJA7JST69N0RVMKWTP7Q8" ${keyboard === "right" ? "data-keyboard" : ""}>
            <input aria-label="Field">
          </div>
        </div>
      </div>
      <button type="button" aria-label="Page">a page's guest, drawn over the window</button>
    `;
    const [left, right] =
      document.querySelectorAll<HTMLElement>("[data-group-side]");
    const prompt = document.querySelector<HTMLElement>("[contenteditable]");
    const field = document.querySelector<HTMLElement>("input");
    const page = document.querySelector<HTMLElement>("button");
    if (!left || !right || !prompt || !field || !page) {
      throw new Error("fixture missing");
    }
    return { field, left, page, prompt, right };
  };

  it("puts the caret in a side's home after a press on nothing in it", async () => {
    const { left, prompt } = groupSides("left");
    placeCaretAfterPress(left);
    await frames(2);
    expect(document.activeElement).toBe(prompt);
  });

  it("leaves words a press in a side selected", async () => {
    const { left } = groupSides("left");
    const words = left.querySelector("p")?.firstChild;
    if (!words) {
      throw new Error("fixture missing");
    }
    document.getSelection()?.setBaseAndExtent(words, 0, words, 5);
    placeCaretAfterPress(left);
    await frames(2);
    expect([
      document.activeElement,
      document.getSelection()?.toString(),
    ]).toEqual([document.body, "Words"]);
  });

  it("sends a caret that landed in the side without the keyboard to the side with it", async () => {
    const { field, prompt, right } = groupSides("left");
    field.focus();
    keepCaretOnKeyboardSide(right);
    await frames(2);
    expect(document.activeElement).toBe(prompt);
  });

  it("knows a page up on the side without the keyboard, which may not hold it", () => {
    groupSides("left");
    const onLeft = isPageOnSideWithoutKeyboard(
      browserTargetOf("tab_01M7EKJA7JST69N0RVMKWTP7Q8"),
    );
    groupSides("right");
    const onRight = isPageOnSideWithoutKeyboard(
      browserTargetOf("tab_01M7EKJA7JST69N0RVMKWTP7Q8"),
    );
    expect([onLeft, onRight]).toEqual([true, false]);
  });
});
