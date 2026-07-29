import { shortcutGuideModalAtom } from "@/client/atoms/shortcut-guide-modal";
import { blockingModalCountAtom } from "@/client/atoms/tab-navigation-block";
import { renderWithDefaultStore } from "@/tests/render";
import { screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";

import { useShortcutGuideHotkey } from "./use-shortcut-guide-hotkey";

const store = getDefaultStore();

function Host() {
  useShortcutGuideHotkey();
  return (
    <>
      <div data-testid="plain" />
      <input aria-label="text field" />
      <div
        contentEditable
        data-testid="editable"
        suppressContentEditableWarning
      />
    </>
  );
}

function press(target: Element, init?: KeyboardEventInit) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "?", ...init }),
  );
}

const isGuideOpen = () => store.get(shortcutGuideModalAtom) !== null;

describe("useShortcutGuideHotkey", () => {
  // The modal slot is cleared for us after each test (see setup-dom); the
  // blocking count is this test's own doing, so it resets that itself.
  beforeEach(() => {
    store.set(blockingModalCountAtom, 0);
  });

  it("opens the guide on ?", () => {
    renderWithDefaultStore(<Host />);

    press(screen.getByTestId("plain"));

    expect(isGuideOpen()).toBe(true);
  });

  it("leaves ? to a focused input", () => {
    renderWithDefaultStore(<Host />);

    press(screen.getByLabelText("text field"));

    expect(isGuideOpen()).toBe(false);
  });

  it("leaves ? to a contenteditable", () => {
    renderWithDefaultStore(<Host />);

    press(screen.getByTestId("editable"));

    expect(isGuideOpen()).toBe(false);
  });

  it("stays out of the way while a modal is blocking", () => {
    renderWithDefaultStore(<Host />);
    store.set(blockingModalCountAtom, 1);

    press(screen.getByTestId("plain"));

    expect(isGuideOpen()).toBe(false);
  });

  it("ignores ? pressed with a modifier", () => {
    renderWithDefaultStore(<Host />);

    press(screen.getByTestId("plain"), { metaKey: true });

    expect(isGuideOpen()).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderWithDefaultStore(<Host />);
    const plain = screen.getByTestId("plain");
    unmount();

    press(plain);

    expect(isGuideOpen()).toBe(false);
  });
});
