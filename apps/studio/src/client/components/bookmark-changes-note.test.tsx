import { bookmarksStateAtom } from "@/client/bookmarks/store";
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BookmarkChangesNote } from "./bookmark-changes-note";

const { markUndone } = vi.hoisted(() => ({ markUndone: vi.fn() }));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { workspace: { bookmarks: { markUndone: { call: markUndone } } } },
}));

const docs = {
  kind: "bookmark" as const,
  order: 0,
  place: "Bookmarks bar",
  root: "bar" as const,
  title: "Docs",
  url: "https://example.com/docs",
};
const removed = { after: null, before: docs, id: "docs" };

describe("BookmarkChangesNote", () => {
  it("shows what was removed, and puts it back", async () => {
    const { store } = renderWithProviders(
      <BookmarkChangesNote changes={[removed]} />,
    );

    expect(screen.getByText("Removed a bookmark")).toBeDefined();
    expect(screen.getByText("Removed from Bookmarks bar")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Undone")).toBeDefined();
    expect(store.get(bookmarksStateAtom).bookmarks).toEqual([
      { id: "docs", order: 0, title: "Docs", url: "https://example.com/docs" },
    ]);
  });

  it("names a mix of changes by what each did", () => {
    renderWithProviders(
      <BookmarkChangesNote
        changes={[
          {
            after: {
              kind: "folder",
              order: 4,
              place: "All Bookmarks",
              root: "all",
              title: "Reading",
            },
            before: null,
            id: "reading",
          },
          {
            after: {
              ...docs,
              folder: "reading",
              place: "All Bookmarks/Reading",
              root: "all",
              title: "Manual",
            },
            before: docs,
            id: "elsewhere",
          },
        ]}
      />,
    );

    expect(screen.getByText("Changed a folder and a bookmark")).toBeDefined();
    expect(screen.getByText("Added to All Bookmarks")).toBeDefined();
    expect(screen.getByText("Docs → Manual")).toBeDefined();
    expect(
      screen.getByText("Bookmarks bar → All Bookmarks/Reading"),
    ).toBeDefined();
    // Neither stands as the card says, so there is nothing to undo.
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
