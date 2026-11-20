import { type Bookmark, type BookmarkFolder } from "@/shared/bookmarks";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { FolderChip, useOpenFolder } from "./bookmark-folders";
import { type OpenAddress } from "./bookmark-menu";

const work: BookmarkFolder = { id: "work", order: 0, title: "Work" };
const reading: BookmarkFolder = { id: "reading", order: 1, title: "Reading" };

const kept = (id: string, folder: string): Bookmark => ({
  folder,
  id,
  order: 0,
  title: `Page ${id}`,
  url: `https://example.com/${id}`,
});

/** Two folders on a bar, opening and closing together as the bar has them. */
function TwoFolders({ open }: { open: OpenAddress }) {
  const { chip } = useOpenFolder();
  const chipOf = (folder: BookmarkFolder, items: Bookmark[]) => (
    <FolderChip
      {...chip(folder.id)}
      folder={folder}
      isLit={false}
      isOver={false}
      items={items}
      onNewFolder={() => undefined}
      onRename={() => undefined}
      open={open}
    />
  );
  return (
    <div className="flex gap-1 p-4">
      {chipOf(work, [kept("plan", "work"), kept("notes", "work")])}
      {chipOf(reading, [kept("essay", "reading")])}
    </div>
  );
}

describe("a folder on the bookmarks bar", () => {
  it("opens a menu of its bookmarks on a click, and closes on another", async () => {
    await renderInBrowser(<TwoFolders open={() => undefined} />);
    await userEvent.click(page.getByRole("button", { name: "Work" }));
    await expect
      .element(page.getByRole("menuitem", { name: /Page plan/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: /Page notes/ }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Work" }));
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  });

  it("switches to another folder's menu when the pointer moves onto it", async () => {
    await renderInBrowser(<TwoFolders open={() => undefined} />);
    await userEvent.hover(page.getByRole("button", { name: "Reading" }));
    // Nothing is open, so moving across opens nothing.
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Work" }));
    await expect
      .element(page.getByRole("menuitem", { name: /Page plan/ }))
      .toBeVisible();
    await userEvent.hover(page.getByRole("button", { name: "Reading" }));
    await expect
      .element(page.getByRole("menuitem", { name: /Page essay/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: /Page plan/ }))
      .not.toBeInTheDocument();
  });

  it("opens an item as a bar bookmark does, here or in a new tab with Cmd", async () => {
    const open = vi.fn<OpenAddress>();
    await renderInBrowser(<TwoFolders open={open} />);
    await userEvent.click(page.getByRole("button", { name: "Work" }));
    await userEvent.click(page.getByRole("menuitem", { name: /Page plan/ }), {
      modifiers: ["Meta"],
    });
    expect(open).toHaveBeenLastCalledWith("https://example.com/plan", {
      behind: true,
      newTab: true,
    });
    await userEvent.click(page.getByRole("button", { name: "Work" }));
    await userEvent.click(page.getByRole("menuitem", { name: /Page notes/ }));
    expect(open).toHaveBeenLastCalledWith("https://example.com/notes");
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  });

  it("drops its menu under its chip", async () => {
    await renderInBrowser(<TwoFolders open={() => undefined} />);
    const chip = page.getByRole("button", { name: "Reading" });
    await userEvent.click(chip);
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    const chipRect = chip.element().getBoundingClientRect();
    const menuRect = menu.element().getBoundingClientRect();
    expect(Math.abs(menuRect.left - chipRect.left)).toBeLessThan(2);
    expect(menuRect.top).toBeGreaterThanOrEqual(chipRect.bottom);
  });
});
