import { renderWithProviders } from "@/tests/render";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FolderAttachmentRow } from "./folder-attachment-row";

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
});
