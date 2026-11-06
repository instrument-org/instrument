import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RollingText } from "./rolling-text";

// jsdom has no layout and runs no real animation, so nothing here is about how
// the roll looks. What it can see is that new words replace the old, that the old
// ones go, and that the masked window comes off again.
describe("RollingText", () => {
  it("puts the new words in the slot and lets the old ones go", async () => {
    const { rerender } = renderWithProviders(
      <RollingText rollKey="one">Reading the config</RollingText>,
    );

    rerender(<RollingText rollKey="two">Running the tests</RollingText>);

    expect(screen.getByText("Running the tests")).toBeTruthy();
    expect(screen.getByText("Reading the config")).toBeTruthy();
    await expect
      .poll(() => screen.queryByText("Reading the config"))
      .toBeNull();
  });

  it("masks the window only while the words are rolling", async () => {
    const { container, rerender } = renderWithProviders(
      <RollingText rollKey="one">Reading the config</RollingText>,
    );
    const slot = container.firstElementChild;
    expect(slot?.className).not.toContain("roll-window-y");

    rerender(<RollingText rollKey="two">Running the tests</RollingText>);

    expect(slot?.className).toContain("roll-window-y");
    await expect.poll(() => slot?.className).not.toContain("roll-window-y");
  });

  it("coalesces a burst into one roll and keeps the words current", () => {
    const { container, rerender } = renderWithProviders(
      <RollingText rollKey="one">Reading one</RollingText>,
    );

    for (const label of ["two", "three", "four"]) {
      rerender(<RollingText rollKey={label}>{`Reading ${label}`}</RollingText>);
    }

    expect(screen.getByText("Reading four")).toBeTruthy();
    expect(screen.queryByText("Reading two")).toBeNull();
    expect(container.textContent).toBe("Reading oneReading four");
  });

  it("updates growing words in place under one key", () => {
    const { container, rerender } = renderWithProviders(
      <RollingText rollKey="one">Reading</RollingText>,
    );

    rerender(<RollingText rollKey="one">Reading the config</RollingText>);

    expect(container.textContent).toBe("Reading the config");
    expect(container.firstElementChild?.className).not.toContain(
      "roll-window-y",
    );
  });
});
