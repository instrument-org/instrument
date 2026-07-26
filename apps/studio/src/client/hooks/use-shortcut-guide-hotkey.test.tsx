import { shortcutGuideModalAtom } from "@/client/atoms/shortcut-guide-modal";
import { blockingModalCountAtom } from "@/client/atoms/tab-navigation-block";
import { render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";

import { useShortcutGuideHotkey } from "./use-shortcut-guide-hotkey";

// The app mounts no Jotai Provider, so `useStore()` inside the hook is the
// default store in production. Render without one here for the same reason,
// rather than through `renderWithProviders`, whose per-test store the hook's
// own `openShortcutGuide` (a `getDefaultStore` writer) would not reach.
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
  beforeEach(() => {
    store.set(shortcutGuideModalAtom, null);
    store.set(blockingModalCountAtom, 0);
  });

  it("opens the guide on ?", () => {
    render(<Host />);

    press(screen.getByTestId("plain"));

    expect(isGuideOpen()).toBe(true);
  });

  it("leaves ? to a focused input", () => {
    render(<Host />);

    press(screen.getByLabelText("text field"));

    expect(isGuideOpen()).toBe(false);
  });

  it("leaves ? to a contenteditable", () => {
    render(<Host />);

    press(screen.getByTestId("editable"));

    expect(isGuideOpen()).toBe(false);
  });

  it("stays out of the way while a modal is blocking", () => {
    render(<Host />);
    store.set(blockingModalCountAtom, 1);

    press(screen.getByTestId("plain"));

    expect(isGuideOpen()).toBe(false);
  });

  it("ignores ? pressed with a modifier", () => {
    render(<Host />);

    press(screen.getByTestId("plain"), { metaKey: true });

    expect(isGuideOpen()).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<Host />);
    const plain = screen.getByTestId("plain");
    unmount();

    press(plain);

    expect(isGuideOpen()).toBe(false);
  });
});
