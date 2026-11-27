import {
  type BookmarkOpBatch,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";
import { describe, expect, it, onTestFinished, vi } from "vitest";

const { toastSaid } = vi.hoisted(() => ({ toastSaid: vi.fn() }));
vi.mock("@/client/lib/toast", () => ({ toast: toastSaid }));

const KEPT = {
  id: "kept",
  order: 0,
  title: "Trip plans",
  url: "https://trip.example/",
};

/**
 * The window's bookmarks over a bridge whose main has not read them yet:
 * `read` sends the snapshot of what main read, and `sent` is every batch the
 * window sent.
 */
async function unreadWindow() {
  let send: ((snapshot: BookmarksSnapshot) => void) | undefined;
  const sent: BookmarkOpBatch[] = [];
  const api = window.api;
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      ...api,
      bookmarks: {
        apply: (batch: BookmarkOpBatch) => {
          sent.push(batch);
          return Promise.resolve();
        },
        initial: { acks: {}, bookmarks: [], folders: [], loading: true },
        onChange: (listener: (snapshot: BookmarksSnapshot) => void) => {
          send = listener;
          return () => undefined;
        },
      },
    },
  });
  onTestFinished(() => {
    Object.defineProperty(window, "api", { configurable: true, value: api });
    vi.resetModules();
  });
  vi.resetModules();
  const store = await import("./store");
  const actions = await import("./actions");
  const testing = await import("@testing-library/react");
  const { createStore } = await import("jotai");
  return {
    ...store,
    ...actions,
    createStore,
    read: (snapshot: Omit<BookmarksSnapshot, "acks">) => {
      send?.({ acks: {}, ...snapshot });
    },
    sent,
    testing,
  };
}

describe("bookmarks main has not read yet", () => {
  it("take no change until they are read, then keep an address once", async () => {
    const view = await unreadWindow();
    const store = view.createStore();

    expect(store.get(view.bookmarksLoadedAtom)).toBe(false);
    // An op made from what the window shows is refused, and never sent.
    await expect(
      store.set(view.applyBookmarkOpsAtom, [
        { bookmark: { ...KEPT, id: "twin" }, type: "add" },
      ]),
    ).rejects.toThrow("still being read");
    expect(toastSaid).toHaveBeenCalledWith("Bookmarks are still loading");
    expect(view.sent).toEqual([]);
    expect(store.get(view.bookmarksAtom)).toEqual([]);

    // A wait for the read gives up when it runs out.
    await expect(view.bookmarksRead(store, 20)).resolves.toBe(false);

    const waiting = view.bookmarksRead(store, 10_000);
    view.read({ bookmarks: [KEPT], folders: [] });
    await expect(waiting).resolves.toBe(true);
    expect(store.get(view.bookmarksLoadedAtom)).toBe(true);

    // Once read, the address is known kept, so keeping it again adds no twin.
    expect(
      view.addToAllBookmarks(store, { title: "Again", url: KEPT.url }),
    ).toMatchObject({ bookmark: { id: "kept" }, isNew: false });
    expect(view.sent).toEqual([]);
    view.addToAllBookmarks(store, {
      title: "Other",
      url: "https://other.example/",
    });
    expect(view.sent.flatMap((batch) => batch.ops)).toMatchObject([
      { bookmark: { url: "https://other.example/" }, type: "add" },
    ]);
  });

  it("are known read by a wait that starts after the read", async () => {
    const view = await unreadWindow();
    const store = view.createStore();
    // Read once while nothing follows it, so the store answers that again.
    expect(store.get(view.bookmarksLoadedAtom)).toBe(false);
    view.read({ bookmarks: [KEPT], folders: [] });
    expect(store.get(view.bookmarksLoadedAtom)).toBe(false);

    await expect(view.bookmarksRead(store, 10_000)).resolves.toBe(true);
  });

  it("leave a menu's Add to Bookmarks keeping nothing until they are read", async () => {
    const view = await unreadWindow();
    const { result } = view.testing.renderHook(() => view.useAddBookmark());

    result.current({ title: "Trip", url: KEPT.url });
    expect(toastSaid).toHaveBeenCalledWith("Bookmarks are still loading", {
      description: "Trip",
    });
    expect(view.sent).toEqual([]);

    view.testing.act(() => {
      view.read({ bookmarks: [KEPT], folders: [] });
    });
    result.current({ title: "Trip", url: KEPT.url });
    expect(toastSaid).toHaveBeenLastCalledWith("Already in Bookmarks", {
      description: "Trip plans",
    });
    expect(view.sent).toEqual([]);
  });

  it("dim the star, which does nothing, until they are read", async () => {
    const view = await unreadWindow();
    const { BookmarkStar } =
      await import("@/client/components/window/bookmark-star");
    const { renderWithDefaultStore } = await import("@/tests/render");
    const { container } = renderWithDefaultStore(
      <BookmarkStar address={KEPT.url} title="Trip" />,
    );
    const star = () => {
      const found = container.querySelector("[data-bookmark-star]");
      if (!(found instanceof HTMLButtonElement)) {
        throw new Error("no star");
      }
      return found;
    };

    expect(star().dataset.bookmarkStar).toBe("loading");
    expect(star().disabled).toBe(true);
    view.testing.fireEvent.click(star());
    expect(view.sent).toEqual([]);

    view.testing.act(() => {
      view.read({ bookmarks: [KEPT], folders: [] });
    });
    await view.testing.waitFor(() => {
      expect(star().dataset.bookmarkStar).toBe("kept");
    });
    expect(star().disabled).toBe(false);
    expect(view.sent).toEqual([]);
    // The star and what it draws are imported afresh, past the reset.
  }, 20_000);
});
