import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { UsageStatsTooltip, UsageSummaryText } from "./usage-stats-tooltip";

// The counts open a tooltip on hover and the transcript on press, and both
// belong to one control: a `<button>` holding a second `<button>` is invalid
// markup, and the tree the browser builds out of it is not the one either
// handler was wired against.
test("hangs the tooltip and the press on a single button", () => {
  const onClick = vi.fn();

  renderWithProviders(
    <UsageStatsTooltip
      aria-label="View transcript"
      messageCount={4}
      onClick={onClick}
      stats={{
        inputTokenDetails: {},
        outputTokenDetails: {},
        totalTokens: 120,
      }}
    >
      <UsageSummaryText messageCount={4} totalTokens={120} />
    </UsageStatsTooltip>,
  );

  expect(screen.getAllByRole("button")).toHaveLength(1);

  const button = screen.getByRole("button", { name: "View transcript" });
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});
