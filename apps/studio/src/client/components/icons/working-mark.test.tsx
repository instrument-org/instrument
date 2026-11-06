import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkingMark } from "./working-mark";
import { WORKING_MARK_PIECES } from "./working-mark-motion";

/**
 * Every row in the transcript is an indicator then a label, and the two kinds of
 * row swap places constantly: a call finishing turns the moving mark into a
 * settled icon. They agree on the column so the swap changes what the indicator
 * is and not where the label starts.
 */
describe("WorkingMark", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the same 20px column a tool call's icon takes", () => {
    const { container } = render(<WorkingMark />);

    expect(container.firstElementChild?.className).toContain("size-5");
  });

  it("draws plain elements the compositor can animate, where Web Animations may be missing", () => {
    const { container } = render(<WorkingMark />);

    expect(container.querySelectorAll(".working-mark span")).toHaveLength(
      WORKING_MARK_PIECES.length,
    );
    // `transform` on an SVG element cannot run on the compositor, so a mark drawn
    // as one takes a style pass on every frame for as long as the agent works.
    expect(container.querySelector("svg")).toBeNull();
  });

  it("plays each piece from the page's clock and stops it on unmount", () => {
    const players: {
      cancel: () => void;
      startTime: number;
      target: unknown;
    }[] = [];
    const cancel = vi.fn();
    vi.stubGlobal(
      "KeyframeEffect",
      class {
        target: unknown = null;
      },
    );
    vi.stubGlobal(
      "Animation",
      class {
        cancel = cancel;
        startTime = -1;
        target: unknown;
        constructor(effect: { target: unknown }) {
          this.target = effect.target;
          players.push(this);
        }
      },
    );

    const { container, unmount } = render(<WorkingMark />);

    expect(players.map(({ target }) => target)).toEqual([
      ...container.querySelectorAll(".working-mark span"),
    ]);
    expect(players.map(({ startTime }) => startTime)).toEqual(
      WORKING_MARK_PIECES.map(() => 0),
    );

    unmount();

    expect(cancel).toHaveBeenCalledTimes(WORKING_MARK_PIECES.length);
  });

  it("draws every piece an even whole number of pixels from one shared corner", () => {
    const { container } = render(<WorkingMark />);

    for (const piece of container.querySelectorAll<HTMLElement>(
      ".working-mark span",
    )) {
      expect(Number.parseFloat(piece.style.width) % 2).toBe(0);
      expect(piece.style.margin).toBe("");
      expect(piece.className).toContain("origin-top-left");
      expect(piece.className).toContain("left-1/2");
      expect(piece.className).toContain("top-1/2");
    }
  });
});
