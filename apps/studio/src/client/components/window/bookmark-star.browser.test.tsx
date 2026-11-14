import { bookmarksAtom } from "@/client/bookmarks/store";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { BookmarkStar, requestBookmarkTab } from "./bookmark-star";

describe("the star at the end of the address", () => {
  it("keeps the address on the bar, then in the sidebar, under the name typed", async () => {
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
    expect(kept()?.where).toBeUndefined();

    await userEvent.click(page.getByRole("radio", { name: "Sidebar" }));
    await expect.poll(() => kept()?.where).toBe("sidebar");
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
});
