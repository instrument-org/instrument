import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { fireEvent, render } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { usePlaybackKeys } from "./use-playback-keys";

function press(key: string, target: Element | Window = window) {
  fireEvent.keyDown(target, { bubbles: true, key });
}

/**
 * Mounts the hook alongside a composer-like editable, which is the thing it has
 * to stay out of the way of.
 */
function setup({ isActiveTab = true } = {}) {
  const onStep = vi.fn();
  const onTogglePlay = vi.fn();

  function Harness() {
    usePlaybackKeys({ onStep, onTogglePlay });
    return <textarea data-testid="composer" />;
  }

  const wrap = (children: ReactNode) =>
    isActiveTab ? (
      children
    ) : (
      <ActiveTabProvider isActive={false}>{children}</ActiveTabProvider>
    );

  const { getByTestId } = render(wrap(<Harness />));
  return { composer: getByTestId("composer"), onStep, onTogglePlay };
}

describe("usePlaybackKeys", () => {
  it("plays on space and steps on the arrows", () => {
    const { onStep, onTogglePlay } = setup();

    press(" ");
    press("ArrowRight");
    press("ArrowLeft");

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onStep.mock.calls).toEqual([[1], [-1]]);
  });

  // The bug this exists for: the page listens on `window`, so without the
  // guard a space typed into the composer never reaches it.
  it("leaves the keys alone while the user is typing", () => {
    const { composer, onStep, onTogglePlay } = setup();

    press(" ", composer);
    press("ArrowRight", composer);
    press("ArrowLeft", composer);

    expect(onTogglePlay).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
  });

  it("does not consume the key it ignores", () => {
    const { composer } = setup();
    const typed = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });

    composer.dispatchEvent(typed);

    expect(typed.defaultPrevented).toBe(false);
  });

  // Every tab is mounted at once and hidden with CSS, so a listener that does
  // not check would go on running while the user is in another tab entirely.
  it("stays quiet while its tab is in the background", () => {
    const { onStep, onTogglePlay } = setup({ isActiveTab: false });

    press(" ");
    press("ArrowRight");

    expect(onTogglePlay).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
  });

  it("yields to a control that has already handled the key", () => {
    const { onTogglePlay } = setup();
    const handled = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    handled.preventDefault();

    window.dispatchEvent(handled);

    expect(onTogglePlay).not.toHaveBeenCalled();
  });
});
