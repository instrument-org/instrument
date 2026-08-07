import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GroupHeading } from "./group-heading";
import { TranscriptGroup } from "./transcript-group";

describe("GroupHeading", () => {
  it("heads the run with the title", () => {
    const { container } = render(<GroupHeading title="Charting the numbers" />);

    expect(container.textContent).toBe("Charting the numbers");
  });

  it("reads as still running while the agent works inside the group", () => {
    const { container, getByText } = render(
      <GroupHeading isRunning title="Charting the numbers" />,
    );

    expect(getByText("Charting the numbers").className).toContain(
      "brand-shiny-text",
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("settles to the resting color once the group closes", () => {
    const { container, getByText } = render(
      <GroupHeading title="Charting the numbers" />,
    );

    expect(getByText("Charting the numbers").className).toContain(
      "text-muted-foreground",
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("opens and closes the group it heads", () => {
    const onToggle = vi.fn();
    const { getByRole } = render(
      <TranscriptGroup canExpand isExpanded={false} onToggle={onToggle}>
        <GroupHeading title="Charting the numbers" />
      </TranscriptGroup>,
    );

    fireEvent.click(getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to open when the group has no rows behind it", () => {
    const { container } = render(
      <TranscriptGroup canExpand={false} isExpanded={false} onToggle={vi.fn()}>
        <GroupHeading title="Charting the numbers" />
      </TranscriptGroup>,
    );

    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelector("svg")).toBeNull();
  });

  // A disabled button still takes `:hover`, so lighting up under the pointer
  // offers a click that does not do anything.
  it("does not light up under the pointer with nothing to open", () => {
    const { getByText } = render(
      <TranscriptGroup canExpand={false} isExpanded={false} onToggle={vi.fn()}>
        <GroupHeading title="Charting the numbers" />
      </TranscriptGroup>,
    );

    expect(getByText("Charting the numbers").className).not.toContain("hover");
  });
});
