import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkingMark } from "./working-mark";

/**
 * Every row in the transcript is an indicator then a label, and the two kinds of
 * row swap places constantly: a call finishing turns the moving mark into a
 * settled icon. They agree on the column so the swap changes what the indicator
 * is and not where the label starts.
 */
describe("WorkingMark", () => {
  it("takes the same 20px column a tool call's icon takes", () => {
    const { container } = render(<WorkingMark />);

    expect(container.firstElementChild?.className).toContain("size-5");
  });

  it("draws nine plain elements the compositor can animate", () => {
    const { container } = render(<WorkingMark />);

    expect(container.querySelectorAll(".working-mark span")).toHaveLength(9);
    // `transform` on an SVG element cannot run on the compositor, so a mark drawn
    // as one takes a style pass on every frame for as long as the agent works.
    expect(container.querySelector("svg")).toBeNull();
  });
});
