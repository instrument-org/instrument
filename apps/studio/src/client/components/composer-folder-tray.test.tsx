import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComposerFolderTray } from "./composer-folder-tray";
import { TooltipProvider } from "./ui/tooltip";

function renderTray({ folders = [] as string[], showAdd = false } = {}) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  renderWithProviders(
    <TooltipProvider>
      <ComposerFolderTray
        folders={folders}
        onAdd={onAdd}
        onRemove={onRemove}
        showAdd={showAdd}
      />
    </TooltipProvider>,
  );
  return { onAdd, onRemove };
}

describe("ComposerFolderTray", () => {
  // The same line is the empty state and the way to grow the list, so which of
  // the two it is has to come from what is already attached.
  it("invites a first folder, then another", () => {
    const { unmount } = renderWithProviders(
      <TooltipProvider>
        <ComposerFolderTray
          folders={[]}
            onAdd={vi.fn()}
          onRemove={vi.fn()}
          showAdd
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button").textContent).toMatchInlineSnapshot(
      `"Work in a local folder"`,
    );
    unmount();

    renderTray({
      folders: ["/Users/sam/Docs"],
      showAdd: true,
    });
    expect(
      screen.getByRole("button", { name: "Add another local folder" }),
    ).toBeTruthy();
  });

  // Off, the tray is still the only way to see or drop a folder added from the
  // plus menu -- it just stops advertising itself.
  it("lists folders on a surface that does not offer to add one", () => {
    const { onRemove } = renderTray({
      folders: ["/Users/sam/Docs"],
    });

    expect(screen.queryByText("Work in a local folder")).toBeNull();
    expect(screen.queryByText("Add another local folder")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Remove Docs/ }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("/Users/sam/Docs");
  });
});
