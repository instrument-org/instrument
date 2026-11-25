import {
  applyBookmarkOpsAtom,
  bookmarksAtom,
  bookmarksStateAtom,
} from "@/client/bookmarks/store";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { BookmarkStar, requestBookmarkTab } from "./bookmark-star";

describe("the star at the end of the address", () => {
  it("keeps the address on the bar under the name typed", async () => {
    const { store } = await renderInBrowser(
      <BookmarkStar address="instrument://chat/one" title="Trip plans" />,
    );
    const kept = () =>
      store
        .get(bookmarksAtom)
        .find((bookmark) => bookmark.url === "instrument://chat/one");

    await userEvent.click(
      page.getByRole("button", { name: "Bookmark this tab" }),
    );
    await expect.element(page.getByText("Bookmark added")).toBeVisible();
    expect(kept()).toMatchObject({ title: "Trip plans" });

    await userEvent.fill(page.getByLabelText("Name"), "Trip");
    await userEvent.click(page.getByRole("button", { name: "Done" }));
    await expect
      .element(page.getByText("Bookmark added"))
      .not.toBeInTheDocument();
    expect(kept()?.title).toBe("Trip");

    // Pressed again, the star edits what it keeps, and Remove lets it go.
    await userEvent.click(page.getByRole("button", { name: "Edit bookmark" }));
    await userEvent.click(page.getByRole("button", { name: "Remove" }));
    await expect.poll(kept).toBeUndefined();
  });

  it("answers ⌘D with the star of the row the keyboard is in", async () => {
    const { store } = await renderInBrowser(
      <>
        <div>
          <input aria-label="first field" />
          <BookmarkStar address="https://first.example/" title="First" />
        </div>
        <div>
          <input aria-label="second field" />
          <BookmarkStar address="https://second.example/" title="Second" />
        </div>
      </>,
    );
    await userEvent.click(page.getByLabelText("second field"));
    requestBookmarkTab();
    await expect.element(page.getByText("Bookmark added")).toBeVisible();
    expect(store.get(bookmarksAtom).map((bookmark) => bookmark.url)).toEqual([
      "https://second.example/",
    ]);
  });

  it.each(["apps", "chats"])(
    "is out of sight on %s until ⌘D keeps that page, with a site beside it",
    async (name) => {
      const address = `instrument://screen/${name}`;
      const { store } = await renderInBrowser(
        <>
          <div>
            <input aria-label="fixed field" />
            <BookmarkStar address={address} title="Fixed" />
          </div>
          <div>
            <BookmarkStar address="https://beside.example/" title="Beside" />
          </div>
        </>,
      );
      const kept = () =>
        store
          .get(bookmarksAtom)
          .map((bookmark) => bookmark.url)
          .filter((url) => url === address || url.includes("beside"));
      // The site's star is the only one there to press.
      expect(
        page.getByRole("button", { name: "Bookmark this tab" }).all(),
      ).toHaveLength(1);

      await userEvent.click(page.getByLabelText("fixed field"));
      requestBookmarkTab();
      await expect.element(page.getByText("Bookmark added")).toBeVisible();
      expect(kept()).toEqual([address]);
      const star = document.querySelector('[data-bookmark-star="kept"]');
      expect(star && getComputedStyle(star).opacity).toBe("1");

      await userEvent.click(page.getByRole("button", { name: "Remove" }));
      await expect.poll(kept).toEqual([]);
    },
  );

  it("keeps the star on one app's page, a chat and a folder", async () => {
    await renderInBrowser(
      <>
        <BookmarkStar address="instrument://app/slack" title="Slack" />
        <BookmarkStar address="instrument://chat/one" title="Trip plans" />
        <BookmarkStar address="file:///Users/mac-user/" title="Home" />
      </>,
    );
    expect(
      page.getByRole("button", { name: "Bookmark this tab" }).all(),
    ).toHaveLength(3);
  });

  it("files the bookmark in the folder picked, and opens the editor for another", async () => {
    const { store } = await renderInBrowser(
      <BookmarkStar address="https://third.example/" title="Third" />,
    );
    await store.set(applyBookmarkOpsAtom, [
      { folder: { id: "f", order: 9, title: "Reading" }, type: "addFolder" },
    ]);
    const kept = () =>
      store
        .get(bookmarksAtom)
        .find((bookmark) => bookmark.url === "https://third.example/");

    await userEvent.click(
      page.getByRole("button", { name: "Bookmark this tab" }),
    );
    await userEvent.click(page.getByRole("combobox"));
    await userEvent.click(page.getByRole("option", { name: "Reading" }));
    // Escape keeps what was picked, as Done does.
    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByText("Bookmark added"))
      .not.toBeInTheDocument();
    expect(kept()?.folder).toBe("f");

    await userEvent.click(page.getByRole("button", { name: "Edit bookmark" }));
    await userEvent.click(page.getByRole("combobox"));
    await userEvent.click(
      page.getByRole("option", { name: "Choose another folder…" }),
    );
    const editor = page.getByRole("dialog");
    await expect.element(editor.getByText("Edit bookmark")).toBeVisible();
    await userEvent.fill(editor.getByLabelText("URL"), "third.example/moved");
    await userEvent.click(editor.getByRole("button", { name: "New folder" }));
    await userEvent.fill(editor.getByLabelText("Folder name"), "Later");
    await userEvent.click(editor.getByRole("button", { name: "Save" }));
    await expect.element(editor).not.toBeInTheDocument();
    const state = store.get(bookmarksStateAtom);
    const later = state.folders.find((folder) => folder.title === "Later");
    expect(later).toBeDefined();
    expect(
      state.bookmarks.find((bookmark) => bookmark.title === "Third"),
    ).toMatchObject({ folder: later?.id, url: "https://third.example/moved" });
  });
});
