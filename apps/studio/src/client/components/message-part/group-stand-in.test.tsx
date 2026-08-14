import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GroupStandIn } from "./group-stand-in";

// jsdom has no layout and runs no real animation, so nothing here is about how
// the swap looks. What it can see is the thing the swap depends on and the thing
// it could leak: that a new row id replaces the row on screen, and that the row
// it replaced does not stay behind it.
describe("GroupStandIn", () => {
  it("draws the row it is given", () => {
    renderWithProviders(
      <GroupStandIn rowId="row-1">
        <span>Reading the config</span>
      </GroupStandIn>,
    );

    expect(screen.getByText("Reading the config")).toBeTruthy();
  });

  it("puts the next step in the slot and lets the last one go", async () => {
    const { rerender } = renderWithProviders(
      <GroupStandIn rowId="row-1">
        <span>Reading the config</span>
      </GroupStandIn>,
    );

    rerender(
      <GroupStandIn rowId="row-2">
        <span>Running the tests</span>
      </GroupStandIn>,
    );

    // Both at once is the swap: `popLayout` gives the slot to the new row
    // immediately and lets the old one leave from where it was. Were this
    // `wait`, the group's only line would be empty for a whole transition.
    expect(screen.getByText("Running the tests")).toBeTruthy();
    expect(screen.getByText("Reading the config")).toBeTruthy();

    // And the one that left has to actually go, or a phase that ran twenty
    // calls would be carrying twenty rows.
    await expect
      .poll(() => screen.queryByText("Reading the config"))
      .toBeNull();
  });

  it("keeps the same slot across the swap, so the row moves within it", () => {
    const { container, rerender } = renderWithProviders(
      <GroupStandIn rowId="row-1">
        <span>Reading the config</span>
      </GroupStandIn>,
    );
    const slot = container.firstElementChild;

    rerender(
      <GroupStandIn rowId="row-2">
        <span>Running the tests</span>
      </GroupStandIn>,
    );

    expect(container.firstElementChild).toBe(slot);
  });

  // The masked window is what stops a row being drawn outside the slot, so it
  // has to be on for the whole roll. It also has to come off afterwards: a row
  // the reader expands draws its output below the line, and a window left on
  // would cut that off at the height of the line above.
  it("masks the window only while a row is rolling", async () => {
    const { container, rerender } = renderWithProviders(
      <GroupStandIn rowId="row-1">
        <span>Reading the config</span>
      </GroupStandIn>,
    );
    const slot = container.firstElementChild;

    expect(slot?.className).not.toContain("roll-window-y");

    rerender(
      <GroupStandIn rowId="row-2">
        <span>Running the tests</span>
      </GroupStandIn>,
    );

    expect(slot?.className).toContain("roll-window-y");

    await expect.poll(() => slot?.className).not.toContain("roll-window-y");
  });

  // A batch of reads drains in less time than one roll takes. Queuing a roll per
  // call would have the reader watching an animation drain long after the agent
  // finished, and every one of them would leave a row behind in the slot.
  it("coalesces a burst into one roll and keeps the text current", () => {
    const { container, rerender } = renderWithProviders(
      <GroupStandIn rowId="row-1">
        <span>Reading one</span>
      </GroupStandIn>,
    );

    for (const [index, label] of ["two", "three", "four"].entries()) {
      rerender(
        <GroupStandIn rowId={`row-${String(index + 2)}`}>
          <span>{`Reading ${label}`}</span>
        </GroupStandIn>,
      );
    }

    // The slot says what the agent is doing now, not what it was doing when the
    // roll started.
    expect(screen.getByText("Reading four")).toBeTruthy();
    // One row on its way out, whatever the burst did: the first roll is still
    // running, so the rest replaced the text in the slot rather than each
    // starting a roll of their own.
    expect(screen.queryByText("Reading two")).toBeNull();
    expect(screen.queryByText("Reading three")).toBeNull();
    expect(container.textContent).toBe("Reading oneReading four");
  });

  it("rolls again once the roll in flight has finished", async () => {
    const { rerender } = renderWithProviders(
      <GroupStandIn rowId="row-1">
        <span>Reading one</span>
      </GroupStandIn>,
    );

    rerender(
      <GroupStandIn rowId="row-2">
        <span>Reading two</span>
      </GroupStandIn>,
    );
    await expect.poll(() => screen.queryByText("Reading one")).toBeNull();

    rerender(
      <GroupStandIn rowId="row-3">
        <span>Reading three</span>
      </GroupStandIn>,
    );

    expect(screen.getByText("Reading two")).toBeTruthy();
    expect(screen.getByText("Reading three")).toBeTruthy();
  });
});
