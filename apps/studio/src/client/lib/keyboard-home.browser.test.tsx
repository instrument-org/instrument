import { browserTargetOf } from "@instrument-org/workspace/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import {
  focusScreenHome,
  installKeyboardHome,
  isKeyboardNowhere,
  keepCaretOnKeyboardSide,
  leaveField,
  notePersonInPage,
  PAGE_ON_SCREEN,
  placeCaretAfterPress,
  returnKeyboardFromAgent,
  returnKeyboardToWindow,
  setHomeFocus,
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

describe("whether the keyboard is anywhere a person can see", () => {
  /** Puts the keyboard in the element marked `data-here`, then does `after` to it. */
  const keyboardIn = (html: string, after?: (here: HTMLElement) => void) => {
    document.body.innerHTML = html;
    const here = document.querySelector<HTMLElement>("[data-here]");
    here?.focus();
    if (here) {
      after?.(here);
    }
    return isKeyboardNowhere();
  };

  it.each<[string, string, ((here: HTMLElement) => void) | undefined, boolean]>(
    [
      ["a field on show", "<input data-here>", undefined, false],
      ["nothing", "<p>Words</p>", undefined, true],
      [
        "a field hidden with the view it is in",
        "<div><input data-here></div>",
        (here) => {
          here.parentElement?.style.setProperty("visibility", "hidden");
        },
        true,
      ],
      [
        "a field in a part put out of reach",
        "<div><input data-here></div>",
        (here) => {
          here.parentElement?.setAttribute("inert", "");
        },
        true,
      ],
      [
        "a field in a popover still fading in",
        '<div style="opacity: 0"><input data-here></div>',
        undefined,
        false,
      ],
      [
        "a page a slot shows",
        `<webview tabindex="-1" ${PAGE_ON_SCREEN} data-here></webview>`,
        undefined,
        false,
      ],
      [
        "a page put away, which stays drawn out of sight",
        '<webview tabindex="-1" data-here></webview>',
        undefined,
        true,
      ],
    ],
  )("in %s", (_case, html, after, expected) => {
    expect(keyboardIn(html, after)).toBe(expected);
  });
});

describe("the keyboard given back from a page", () => {
  /**
   * A tab group with the keyboard on the left, which shows a field, a
   * composer and a page, and beside the page's guest the guest of a page an
   * agent works in.
   */
  const windowWithPages = ({
    composer = true,
  }: { composer?: boolean } = {}) => {
    document.body.innerHTML = `
      <div data-app-tab-active>
        <div data-group-sides>
          <div data-group-side="0" data-keyboard data-tab-up="tab_up">
            <input aria-label="Rename">
            ${composer ? '<div data-keyboard-home="1"><div contenteditable="true" aria-label="Reply">Prompt</div></div>' : ""}
            <div data-keyboard-home="2" data-page-home></div>
          </div>
          <div data-group-side="1"><input aria-label="Other side"></div>
        </div>
      </div>
      <webview tabindex="-1" ${PAGE_ON_SCREEN} aria-label="Page"></webview>
      <webview tabindex="-1" ${PAGE_ON_SCREEN} aria-label="Agent's page"></webview>
    `;
    const find = (selector: string) => {
      const found = document.querySelector<HTMLElement>(selector);
      if (!found) {
        throw new Error(`fixture missing ${selector}`);
      }
      return found;
    };
    const page = find('[aria-label="Page"]');
    setHomeFocus(find("[data-page-home]"), {
      focus: () => {
        page.focus();
      },
      holds: () => document.activeElement === page,
    });
    return {
      agents: find('[aria-label="Agent\'s page"]'),
      other: find('[aria-label="Other side"]'),
      page,
      rename: find('[aria-label="Rename"]'),
    };
  };
  const at = () =>
    document.activeElement?.getAttribute("aria-label") ?? "nothing";

  it("goes to the field a person was in when an agent's page took it", () => {
    const { agents, rename } = windowWithPages();
    rename.focus();
    agents.focus();
    returnKeyboardFromAgent();
    expect(at()).toBe("Rename");
  });

  it("goes back to the page a person was in", () => {
    const { agents, page } = windowWithPages();
    notePersonInPage(page);
    page.focus();
    agents.focus();
    returnKeyboardFromAgent();
    expect(at()).toBe("Page");
  });

  it("stays in a page the person put it in", () => {
    const { page, rename } = windowWithPages();
    rename.focus();
    notePersonInPage(page);
    page.focus();
    returnKeyboardFromAgent();
    expect(at()).toBe("Page");
  });

  it("stays on nothing, where a person let go of it", () => {
    const { rename } = windowWithPages();
    rename.focus();
    rename.blur();
    returnKeyboardFromAgent();
    expect(at()).toBe("nothing");
  });

  it("goes to a home of the window's own when that field is gone or hidden", () => {
    const gone = windowWithPages();
    gone.rename.focus();
    gone.agents.focus();
    gone.rename.remove();
    returnKeyboardFromAgent();
    expect(at()).toBe("Reply");

    const hidden = windowWithPages();
    hidden.rename.focus();
    hidden.agents.focus();
    hidden.rename.style.visibility = "hidden";
    returnKeyboardFromAgent();
    expect(at()).toBe("Reply");
  });

  it("leaves a field on the side without the keyboard for the home of the side with it", async () => {
    const { agents, other } = windowWithPages();
    other.focus();
    agents.focus();
    returnKeyboardFromAgent();
    await frames(2);
    expect(at()).toBe("Reply");
  });

  it("goes into no page when the place it was in is gone, and lets go with no home to take it", () => {
    const { agents, rename } = windowWithPages({ composer: false });
    rename.focus();
    agents.focus();
    rename.remove();
    returnKeyboardFromAgent();
    expect(at()).toBe("nothing");
  });

  it("goes to the screen's home as the page that had it is put away, outside a tab group", () => {
    document.body.innerHTML = `
      <div data-app-tab-active>
        <div data-keyboard-home><div role="option" aria-selected="true" tabindex="0" aria-label="Row">Row</div></div>
      </div>
      <webview tabindex="-1" aria-label="Page"></webview>
    `;
    const page = document.querySelector<HTMLElement>("webview");
    if (!page) {
      throw new Error("fixture missing");
    }
    notePersonInPage(page);
    returnKeyboardToWindow();
    expect(at()).toBe("Row");
  });
});

it("sends the keyboard home from a field a person is done with", async () => {
  document.body.innerHTML = `
    <div data-app-tab-active>
      <input aria-label="Address">
      <div data-keyboard-home><div role="option" aria-selected="true" tabindex="0">Row</div></div>
    </div>
  `;
  const address = document.querySelector<HTMLElement>("input");
  address?.focus();
  leaveField(address);
  expect(document.activeElement).toBe(document.body);
  await frames(2);
  expect(document.activeElement).toBe(
    document.querySelector('[role="option"]'),
  );
});
