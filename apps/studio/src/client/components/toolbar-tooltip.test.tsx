import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("ToolbarTooltip", () => {
  it("names a plain icon button from the shortcut table", () => {
    renderWithProviders(
      <TooltipProvider>
        <ToolbarTooltip shortcut="toggleSidebar">
          <Button size="icon" variant="ghost-toolbar">
            <svg />
          </Button>
        </ToolbarTooltip>
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy();
  });

  it("names a button that is itself a link, through both slots", () => {
    renderWithProviders(
      <TooltipProvider>
        <ToolbarTooltip shortcut="newTask">
          <Button asChild size="icon" variant="ghost-toolbar">
            <a href="/new-tab">
              <svg />
            </a>
          </Button>
        </ToolbarTooltip>
      </TooltipProvider>,
    );

    expect(screen.getByRole("link", { name: "New Task" })).toBeTruthy();
  });
});
