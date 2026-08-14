import { renderWithProviders } from "@/tests/render";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FolderAttachmentRow } from "./folder-attachment-row";
import { TooltipProvider } from "./ui/tooltip";

const { openFolder } = vi.hoisted(() => ({
  openFolder: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { utils: { openFolder: { call: openFolder } } },
}));

const PATH = "/Users/sam/Downloads";

describe("FolderAttachmentRow", () => {
  it("opens the folder when the row is clicked", async () => {
    renderWithProviders(<FolderAttachmentRow access="read-only" path={PATH} />);

    screen.getByRole("button", { name: /Downloads/ }).click();

    await waitFor(() => {
      expect(openFolder).toHaveBeenCalledWith({ folderPath: PATH });
    });
  });

  // Opening is the row's own click, so removing is all the menu is for: a
  // folder that cannot be removed has nothing to offer.
  it("offers no menu for a folder it cannot remove", () => {
    renderWithProviders(<FolderAttachmentRow access="read-only" path={PATH} />);

    expect(screen.queryByRole("button", { name: "Folder actions" })).toBeNull();
  });

  it("offers a menu for a folder it can remove", () => {
    renderWithProviders(
      <FolderAttachmentRow access="read-only" onRemove={vi.fn()} path={PATH} />,
    );

    expect(screen.getByRole("button", { name: "Folder actions" })).toBeTruthy();
  });

  it("puts access beside the path as a named icon", () => {
    renderWithProviders(
      <TooltipProvider>
        <FolderAttachmentRow access="read-write" path={PATH} />
      </TooltipProvider>,
    );

    const path = screen.getByText("~/Downloads");
    const access = screen.getByRole("img", { name: "Full access" });

    expect(screen.queryByText("Full access")).toBeNull();
    expect(access.parentElement).toBe(path.parentElement);
  });
});
