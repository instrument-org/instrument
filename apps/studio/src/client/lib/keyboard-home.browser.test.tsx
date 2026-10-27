import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { installKeyboardHome } from "./keyboard-home";

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
