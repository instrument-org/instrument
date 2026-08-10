import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type FolderAccess,
  FolderAccessLabel,
  FolderAccessList,
} from "./folder-access-list";
import { TooltipProvider } from "./ui/tooltip";

function renderList(
  folders: FolderAccess[],
  onAccessChange = vi.fn(),
  onRemove = vi.fn(),
) {
  renderWithProviders(
    <TooltipProvider>
      <FolderAccessList
        folders={folders}
        onAccessChange={onAccessChange}
        onRemove={onRemove}
      />
    </TooltipProvider>,
  );
  return { onAccessChange, onRemove };
}

describe("FolderAccessList", () => {
  it("states what each folder was granted", () => {
    renderList([
      { access: "read-only", path: "/Users/sam/Docs" },
      { access: "read-write", path: "/Users/sam/Photos" },
    ]);

    expect(
      screen.getByRole("button", { name: "Access for Docs" }).textContent,
    ).toMatchInlineSnapshot(`"Read-only"`);
    expect(
      screen.getByRole("button", { name: "Access for Photos" }).textContent,
    ).toMatchInlineSnapshot(`"Full access"`);
  });

  it("removes the folder the user closed", () => {
    const { onRemove } = renderList([
      { access: "read-write", path: "/Users/sam/Photos" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Remove Photos/ }));

    expect(onRemove).toHaveBeenCalledExactlyOnceWith("/Users/sam/Photos");
  });
});

describe("FolderAccessLabel", () => {
  // The sentence about writing lives on the shield, so a folder that cannot be
  // written must not carry one for it to hang off.
  it("offers the warning only where the agent can write", () => {
    const { rerender } = renderWithProviders(
      <TooltipProvider>
        <FolderAccessLabel access="read-only" />
      </TooltipProvider>,
    );
    expect(screen.getByText("Read-only").dataset.state).toBeUndefined();

    rerender(
      <TooltipProvider>
        <FolderAccessLabel access="read-write" />
      </TooltipProvider>,
    );
    expect(screen.getByText("Full access").dataset.state).toBe("closed");
  });
});
