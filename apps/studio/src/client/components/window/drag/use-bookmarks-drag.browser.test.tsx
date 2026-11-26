import { outlineRows } from "@/client/bookmarks/outline";
import {
  applyBookmarkOpsAtom,
  bookmarksStateAtom,
} from "@/client/bookmarks/store";
import { renderInBrowser } from "@/tests/render-browser";
import {
  barItems,
  type BookmarkOp,
  OTHER_ROOT,
  rootItems,
} from "@/shared/bookmarks";
import { createStore, useAtomValue } from "jotai";
import { afterEach, expect, it } from "vitest";

import { pressBookmark, pressRows } from "./press-bookmark";
import { currentDrag } from "./session";
import { useBookmarksTarget, useOutlineTarget } from "./use-bookmarks-drag";
import { useDragSystem } from "./use-drag-system";
import { useStripTarget } from "./use-group-drag";

/**
 * A window with a strip of two 100px tabs at its top, the bookmarks bar
 * under it (80px marks), and the Bookmarks page's outline under that, 40px
 * rows from `LIST_TOP`: a, b, c, folder F open over d, then All Bookmarks
 * open over e.
 */
const BAR_TOP = 60;
const LIST_TOP = 200;
const ROW_PX = 40;
const OPEN = new Set([OTHER_ROOT, "F"]);

/** The middle of a row, or a point `at` of the way down it. */
const rowY = (index: number, at = 0.5) => LIST_TOP + ROW_PX * (index + at);

const pointer = (type: string, x: number, y: number) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      buttons: type === "pointermove" ? 1 : 0,
      clientX: x,
      clientY: y,
      isPrimary: true,
    }),
  );

function Strip() {
  useStripTarget({
    group: "up",
    isOn: true,
    page: () => null,
    side: 0,
    strip: () => document.querySelector<HTMLElement>("[data-group-tabs]"),
    tabs: [
      { href: "/a", id: "ta", kind: "screen" },
      { href: "/b", id: "tb", kind: "screen" },
    ],
  });
  return (
    <div
      data-group-tabs=""
      style={{ height: 40, left: 0, position: "fixed", top: 0, width: 400 }}
    >
      <div role="tablist" style={{ display: "flex" }}>
        {["ta", "tb"].map((key) => (
          <div data-tab-key={key} key={key} style={{ height: 40, width: 100 }}>
            {key}
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar() {
  const state = useAtomValue(bookmarksStateAtom);
  useBookmarksTarget({
    area: () => document.querySelector<HTMLElement>("[data-bar]"),
    row: () => document.querySelector<HTMLElement>("[data-bar-row]"),
  });
  return (
    <div
      data-bar=""
      style={{
        height: 32,
        left: 0,
        position: "fixed",
        top: BAR_TOP,
        width: 400,
      }}
    >
      <div data-bar-row="" style={{ display: "flex", position: "relative" }}>
        {barItems(state).map((item) => {
          const id = item.kind === "folder" ? item.folder.id : item.bookmark.id;
          return (
            <div
              data-bookmark-folder={item.kind === "folder" ? id : undefined}
              data-bookmark-id={id}
              key={id}
              style={{ height: 32, width: 80 }}
            >
              {id}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The page's outline, a press on a row holding it, or `together` held as rows of the page where it is one of them. */
function Outline({ together = [] }: { together?: readonly string[] }) {
  const state = useAtomValue(bookmarksStateAtom);
  const rows = outlineRows(state, { open: OPEN, q: "" });
  useOutlineTarget({
    isOff: false,
    list: () => document.querySelector<HTMLElement>("[data-list]"),
    rows,
  });
  return (
    <div
      data-list=""
      style={{
        height: 400,
        left: 0,
        overflow: "auto",
        position: "fixed",
        top: LIST_TOP,
        width: 400,
      }}
    >
      <div>
        {rows.map((row) => (
          <div
            data-outline-row={row.id}
            key={row.id}
            onPointerDown={(event) => {
              if (together.includes(row.id)) {
                pressRows(event, { ids: together, title: "2 bookmarks" });
              } else if (row.kind === "bookmark") {
                pressBookmark(event, {
                  id: row.id,
                  title: row.bookmark.title,
                  url: row.bookmark.url,
                });
              }
            }}
            style={{ height: ROW_PX }}
          >
            {row.id}
          </div>
        ))}
      </div>
    </div>
  );
}

function Window({ together }: { together?: readonly string[] }) {
  useDragSystem({ browser: null, chatTitles: new Map() });
  return (
    <>
      <Strip />
      <Bar />
      <Outline together={together} />
    </>
  );
}

const bookmark = (
  id: string,
  order: number,
  place: { folder?: string; root?: typeof OTHER_ROOT } = {},
): BookmarkOp => ({
  bookmark: { id, order, title: id, url: `https://${id}.example/`, ...place },
  type: "add",
});

/** A store whose bookmarks are the window's: a, b, c and folder F over d on the bar, e in All Bookmarks. */
function seeded() {
  const store = createStore();
  const now = store.get(bookmarksStateAtom);
  void store.set(applyBookmarkOpsAtom, [
    ...[...now.bookmarks, ...now.folders].map(
      ({ id }): BookmarkOp => ({ id, type: "remove" }),
    ),
    bookmark("a", 0),
    bookmark("b", 1),
    bookmark("c", 2),
    { folder: { id: "F", order: 3, title: "F" }, type: "addFolder" },
    bookmark("d", 0, { folder: "F" }),
    bookmark("e", 0, { root: OTHER_ROOT }),
  ]);
  return store;
}

/** Presses the row at `index` and carries it to a point. */
const carry = (index: number, to: { x: number; y: number }) => {
  const row =
    document.querySelectorAll<HTMLElement>("[data-outline-row]")[index];
  row?.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: rowY(index),
      isPrimary: true,
    }),
  );
  pointer("pointermove", 20, rowY(index) + 10);
  pointer("pointermove", to.x, to.y);
};

const escape = () =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
  );

const ids = (items: ReturnType<typeof barItems>) =>
  items.map((item) =>
    item.kind === "folder" ? item.folder.id : item.bookmark.id,
  );

afterEach(() => {
  escape();
  document.body.replaceChildren();
});

it("holds a page's bookmark as the bar's are held, which opens from a strip and moves onto the bar", async () => {
  const store = seeded();
  await renderInBrowser(<Window />, { store });
  carry(0, { x: 100, y: 20 });
  expect([currentDrag()?.held, currentDrag()?.landing]).toMatchObject([
    { bookmark: "a", kind: "link", url: "https://a.example/" },
    { group: "up", index: 1, kind: "strip" },
  ]);
  escape();

  // e, from All Bookmarks, past the bar's last mark.
  carry(6, { x: 390, y: BAR_TOP + 16 });
  expect(currentDrag()?.landing).toEqual({ index: 4, kind: "bookmarks" });
  pointer("pointerup", 390, BAR_TOP + 16);

  const state = store.get(bookmarksStateAtom);
  expect([ids(barItems(state)), ids(rootItems(state, OTHER_ROOT))]).toEqual([
    ["a", "b", "c", "F", "e"],
    [],
  ]);
});

it("moves a page's bookmark among the rows, and loose into All Bookmarks", async () => {
  const store = seeded();
  await renderInBrowser(<Window />, { store });
  carry(2, { x: 200, y: rowY(0, 0.25) });
  expect(currentDrag()?.landing).toEqual({
    index: 0,
    kind: "bookmarks",
    row: { at: "before", id: "a" },
  });
  pointer("pointerup", 200, rowY(0, 0.25));
  expect(ids(barItems(store.get(bookmarksStateAtom)))).toEqual([
    "c",
    "a",
    "b",
    "F",
  ]);

  // b onto the middle of All Bookmarks' row, the sixth.
  await expect
    .poll(() => document.querySelector("[data-outline-row]")?.textContent)
    .toBe("c");
  carry(2, { x: 200, y: rowY(5) });
  expect(currentDrag()?.landing).toEqual({
    index: 1,
    kind: "bookmarks",
    root: OTHER_ROOT,
    row: { at: "into", id: OTHER_ROOT },
  });
  pointer("pointerup", 200, rowY(5));

  const state = store.get(bookmarksStateAtom);
  expect([ids(barItems(state)), ids(rootItems(state, OTHER_ROOT))]).toEqual([
    ["c", "a", "F"],
    ["e", "b"],
  ]);
});

it("moves rows held together on the page alone, passing over the strip and the bar", async () => {
  const store = seeded();
  await renderInBrowser(<Window together={["a", "b"]} />, { store });
  carry(0, { x: 100, y: 20 });
  expect(currentDrag()?.held).toMatchObject({ ids: ["a", "b"], kind: "rows" });
  expect(currentDrag()?.landing).toBeUndefined();
  pointer("pointermove", 390, BAR_TOP + 16);
  expect(currentDrag()?.landing).toBeUndefined();

  // After e, the last row.
  pointer("pointermove", 200, rowY(6, 0.75));
  expect(currentDrag()?.landing).toEqual({
    index: 1,
    kind: "bookmarks",
    root: OTHER_ROOT,
    row: { at: "after", id: "e" },
  });
  pointer("pointerup", 200, rowY(6, 0.75));

  const state = store.get(bookmarksStateAtom);
  expect([ids(barItems(state)), ids(rootItems(state, OTHER_ROOT))]).toEqual([
    ["c", "F"],
    ["e", "a", "b"],
  ]);
});
