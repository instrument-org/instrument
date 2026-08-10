import { renderWithProviders } from "@/tests/render";
import { describe, expect, it } from "vitest";

import { PlanningDotSlot } from "./planning-dot-slot";

// The point of the slot is the 28px it gives back, and jsdom has no layout to
// measure that in. What it can see is the lifetime the width animation needs:
// the dot has to outlive the flag that turned it off, and then it has to go.
const dot = (container: HTMLElement) =>
  container.querySelector(".planning-dot-core");

describe("PlanningDotSlot", () => {
  it("draws nothing for a row that is not working", () => {
    const { container } = renderWithProviders(
      <PlanningDotSlot isRunning={false} />,
    );

    expect(dot(container)).toBeNull();
  });

  it("draws the dot while the row is working", () => {
    const { container } = renderWithProviders(<PlanningDotSlot isRunning />);

    expect(dot(container)).not.toBeNull();
  });

  it("holds the dot through the exit and then gives its space back", async () => {
    const { container, rerender } = renderWithProviders(
      <PlanningDotSlot isRunning />,
    );

    rerender(<PlanningDotSlot isRunning={false} />);

    // Still there: the width has to animate down from something. Gone at once
    // and the label would jump the whole 28px, which is the thing this exists
    // to stop.
    expect(dot(container)).not.toBeNull();

    await expect.poll(() => dot(container)).toBeNull();
  });
});
