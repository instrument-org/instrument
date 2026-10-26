import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FolderRow } from "./folder-row";

// Paths shorten against the home directory the dom setup pins on the preload
// bridge, `/Users/sam`.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FolderRow", () => {
  it("reads its path from the home folder's name, a folder at a time", () => {
    renderWithProviders(<FolderRow path="/Users/sam/Documents/Taxes" />);

    expect(screen.getByTitle("sam › Documents › Taxes")).toBeTruthy();
  });

  it("opens in Files first, copies the real path, then lists what the row adds", () => {
    Object.assign(window.api, { windowType: "app" });
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const onRemove = vi.fn();
    renderWithProviders(
      <FolderRow
        menu={[{ icon: null, label: "Remove", onSelect: onRemove }]}
        path="/Users/sam/Documents/Taxes"
      />,
    );

    fireEvent.contextMenu(screen.getByTitle("sam › Documents › Taxes"));

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent))
      .toMatchInlineSnapshot(`
      [
        "Open in Files",
        "Copy Path",
        "Remove",
      ]
    `);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Path" }));
    expect(writeText).toHaveBeenCalledWith("/Users/sam/Documents/Taxes");
    Object.assign(window.api, { windowType: undefined });
  });
});
