import { afterEach, describe, expect, it, vi } from "vitest";

import { offerScreenField, showScreenFieldWithKeyboard } from "./screen-fields";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("showScreenFieldWithKeyboard", () => {
  it("shows the field on the side with the keyboard alone, until it is taken back", () => {
    document.body.innerHTML = `<div data-app-tab-active>
      <div data-group-side><i id="left"></i></div>
      <div data-group-side data-keyboard><i id="right"></i></div>
    </div>`;
    const left = vi.fn();
    const right = vi.fn();
    const ends = [
      offerScreenField({
        element: () => document.querySelector("#left"),
        show: left,
      }),
      offerScreenField({
        element: () => document.querySelector("#right"),
        show: right,
      }),
    ];

    expect(showScreenFieldWithKeyboard()).toBe(true);
    expect(left).not.toHaveBeenCalled();
    expect(right).toHaveBeenCalledOnce();

    for (const end of ends) {
      end();
    }
    expect(showScreenFieldWithKeyboard()).toBe(false);
  });
});
