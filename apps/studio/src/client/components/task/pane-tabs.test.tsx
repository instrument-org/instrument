import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaneTabs } from "./pane-tabs";

const taskId = TaskIdSchema.parse("pane-tabs-test");

function renderStrip({
  onSelect = vi.fn(),
  selectedKey = "browser",
}: { onSelect?: (key: string) => void; selectedKey?: string } = {}) {
  renderWithProviders(
    <PaneTabs
      fileTabs={[
        { filePath: "output/report.pdf", type: "file" },
        { filePath: "output/chart.png", type: "file" },
      ]}
      onClose={vi.fn()}
      onReorder={vi.fn()}
      onSelect={onSelect}
      selectedKey={selectedKey}
      taskId={taskId}
    />,
  );
  return { onSelect };
}

describe("PaneTabs", () => {
  it("exposes the strip as a tab list, with the browser first", () => {
    renderStrip();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Browser",
      "report.pdf",
      "chart.png",
    ]);
  });

  it("says which tab is selected", () => {
    renderStrip({ selectedKey: "file:output/chart.png" });

    expect(screen.getAllByRole("tab").map((tab) => tab.ariaSelected)).toEqual([
      "false",
      "false",
      "true",
    ]);
  });

  // Otherwise every open file is another press of Tab to get past the strip.
  it("keeps one stop in the page's tab order", () => {
    renderStrip({ selectedKey: "file:output/report.pdf" });

    expect(
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex")),
    ).toEqual(["-1", "0", "-1"]);
  });

  it("moves selection and focus together on an arrow key", () => {
    const { onSelect } = renderStrip({ selectedKey: "browser" });

    const [browser, report] = screen.getAllByRole("tab");
    browser?.focus();
    fireEvent.keyDown(browser as Element, { bubbles: true, key: "ArrowRight" });

    expect(onSelect).toHaveBeenCalledWith("file:output/report.pdf");
    expect(document.activeElement).toBe(report);
  });

  it("wraps rather than stopping at the end", () => {
    const { onSelect } = renderStrip({ selectedKey: "browser" });

    const tabs = screen.getAllByRole("tab");
    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0] as Element, { bubbles: true, key: "ArrowLeft" });

    expect(onSelect).toHaveBeenCalledWith("file:output/chart.png");
    expect(document.activeElement).toBe(tabs.at(-1));
  });
});
