import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";

afterEach(() => {
  vi.restoreAllMocks();
});

function openMenu(onSelect: () => void) {
  renderWithProviders(
    <ContextMenu>
      <ContextMenuTrigger>
        <div>Folder</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onSelect}>Move to Trash</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("Folder"));
  return screen.getByRole("menuitem", { name: "Move to Trash" });
}

describe("ContextMenuContent", () => {
  it("does not choose the item under the release of the press that opened it", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const onSelect = vi.fn();
    const item = openMenu(onSelect);
    vi.spyOn(performance, "now").mockReturnValue(1100);
    fireEvent.pointerUp(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("chooses an item a press was dragged onto once the menu has been up a moment", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const onSelect = vi.fn();
    const item = openMenu(onSelect);
    vi.spyOn(performance, "now").mockReturnValue(1500);
    fireEvent.pointerUp(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
