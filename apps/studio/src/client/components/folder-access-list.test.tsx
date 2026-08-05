import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type FolderAccess, FolderAccessList } from "./folder-access-list";

function renderList(
  folders: FolderAccess[],
  onAccessChange = vi.fn(),
  onRemove = vi.fn(),
) {
  renderWithProviders(
    <FolderAccessList
      folders={folders}
      onAccessChange={onAccessChange}
      onRemove={onRemove}
    />,
  );
  return { onAccessChange, onRemove };
}

describe("FolderAccessList", () => {
  it("warns only when a folder can be written", () => {
    renderList([{ access: "read-only", path: "/Users/sam/Docs" }]);
    expect(screen.queryByText(/read and write/)).toBeNull();
  });

  it("warns when any folder can be written", () => {
    renderList([
      { access: "read-only", path: "/Users/sam/Docs" },
      { access: "read-write", path: "/Users/sam/Photos" },
    ]);
    expect(screen.getByText(/read and write/)).toBeTruthy();
  });

  // The warning's action is a way out of every grant at once, so a folder the
  // user deliberately left read-only must not produce a redundant change.
  it("switches only the writable folders to read-only", () => {
    const { onAccessChange } = renderList([
      { access: "read-only", path: "/Users/sam/Docs" },
      { access: "read-write", path: "/Users/sam/Photos" },
      { access: "read-write", path: "/Users/sam/Clips" },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Use read-only instead" }),
    );

    expect(onAccessChange.mock.calls).toEqual([
      ["/Users/sam/Photos", "read-only"],
      ["/Users/sam/Clips", "read-only"],
    ]);
  });

  it("removes the folder the user closed", () => {
    const { onRemove } = renderList([
      { access: "read-write", path: "/Users/sam/Photos" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Remove Photos/ }));

    expect(onRemove).toHaveBeenCalledExactlyOnceWith("/Users/sam/Photos");
  });
});
