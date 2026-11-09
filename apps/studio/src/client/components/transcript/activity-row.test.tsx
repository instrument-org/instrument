import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RowLine } from "./activity-row";

// jsdom runs no animation and never delivers `animationend` to React, so what
// it sees is the sweep's class going on for a changed label.
describe("RowLine", () => {
  it("sweeps a changed label in", () => {
    const { rerender } = renderWithProviders(
      <RowLine label="Worked for 12s" mark={null} sweepsIn />,
    );
    expect(screen.getByText("Worked for 12s").className).not.toContain(
      "title-arrival",
    );

    rerender(<RowLine label="Read 3 files" mark={null} sweepsIn />);
    expect(screen.getByText("Read 3 files").className).toContain(
      "title-arrival",
    );
    expect(screen.queryByText("Worked for 12s")).toBeNull();
  });

  it("changes a label outright without sweepsIn", () => {
    const { rerender } = renderWithProviders(
      <RowLine label="One" mark={null} />,
    );
    rerender(<RowLine label="Two" mark={null} />);
    expect(screen.getByText("Two").className).not.toContain("title-arrival");
  });
});
