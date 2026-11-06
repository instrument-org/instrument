import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlanningDotIcon } from "./planning-dot";

/**
 * Every row in the transcript is an indicator then a label, and the two kinds of
 * row swap places constantly: a call finishing turns a moving dot into a settled
 * icon. They agree on the column so the swap changes what the indicator is and
 * not where the label starts, which is the one thing a run of rows cannot afford
 * to do while the reader is watching it step.
 */
describe("PlanningDotIcon", () => {
  it("takes the same 20px column a tool call's icon takes", () => {
    const { container } = render(<PlanningDotIcon />);

    expect(container.firstElementChild?.className).toContain("size-5");
  });

  it("keeps the sphere itself at 10px inside that column", () => {
    const { container } = render(<PlanningDotIcon />);

    expect(
      container.querySelector(".planning-dot-core")?.getAttribute("class"),
    ).toContain("size-2.5");
  });

  // `transform` on an SVG element cannot run on the compositor, so a sphere drawn
  // as one takes a style pass on every frame for as long as the agent works.
  it("draws the sphere as an element the compositor can animate", () => {
    const { container } = render(<PlanningDotIcon />);

    expect(container.querySelector("svg")).toBeNull();
  });
});
