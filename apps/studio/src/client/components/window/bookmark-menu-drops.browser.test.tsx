import {
  applyBookmarkOpsAtom,
  bookmarksStateAtom,
} from "@/client/bookmarks/store";
import { OTHER_ROOT, rootItems } from "@/shared/bookmarks";
import { renderInBrowser } from "@/tests/render-browser";
import { getDefaultStore, useAtomValue } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
  OtherBookmarksChip,
  OverflowChip,
  useOpenFolder,
} from "./bookmark-folders";
import { currentDrag, pressToDrag } from "./drag/session";
import { OVERFLOW_CHIP, useBookmarksTarget } from "./drag/use-bookmarks-drag";
import { useRef } from "react";

const store = getDefaultStore();

/** All Bookmarks and the chevron at a bar's end, taking drops as the bar does. */
function BarEnd() {
  const state = useAtomValue(bookmarksStateAtom);
  const { chip } = useOpenFolder();
  const bar = useRef<HTMLDivElement>(null);
  useBookmarksTarget({
    area: () => bar.current,
    others: () =>
      bar.current?.querySelector<HTMLElement>("[data-other-bookmarks]") ?? null,
    overflow: () =>
      bar.current?.querySelector<HTMLElement>("[data-bookmarks-overflow]") ??
      null,
    row: () => null,
  });
  return (
    <div className="flex gap-4 p-4" ref={bar}>
      <OverflowChip
        {...chip(OVERFLOW_CHIP)}
        isLit={false}
        items={rootItems(state, undefined)}
        open={() => undefined}
      />
      <OtherBookmarksChip
        {...chip(OTHER_ROOT)}
        isLit={false}
        items={rootItems(state, OTHER_ROOT)}
        open={() => undefined}
      />
    </div>
  );
}

const center = (element: Element, at = 0.5) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * at };
};

const move = ({ x, y }: { x: number; y: number }) =>
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      buttons: 1,
      clientX: x,
      clientY: y,
      isPrimary: true,
    }),
  );

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left === 0) {
        resolve();
      } else {
        requestAnimationFrame(() => {
          step(left - 1);
        });
      }
    };
    step(count);
  });

/** Holds a link to a site, as a tab's address would be, from a point off the bar, and moves it to `to`. */
const holdLinkAt = async (to: { x: number; y: number }) => {
  pressToDrag({ button: 0, clientX: 2, clientY: 2, isPrimary: true }, () => ({
    grab: { x: 0, y: 0 },
    held: {
      id: "held",
      kind: "link",
      shortcut: true,
      title: "Site",
      url: "https://held.example/",
    },
  }));
  move({ x: 60, y: 60 });
  move(to);
  await frames(2);
};

const landing = () => currentDrag()?.landing;

beforeEach(async () => {
  await store.set(applyBookmarkOpsAtom, [
    {
      bookmark: {
        id: "bar1",
        order: 0,
        title: "On bar",
        url: "https://bar.example/",
      },
      type: "add",
    },
    {
      folder: { id: "f", order: 0, root: OTHER_ROOT, title: "Reading" },
      type: "addFolder",
    },
    {
      bookmark: {
        id: "o1",
        order: 1,
        root: OTHER_ROOT,
        title: "Loose one",
        url: "https://one.example/",
      },
      type: "add",
    },
    {
      bookmark: {
        id: "o2",
        order: 2,
        root: OTHER_ROOT,
        title: "Loose two",
        url: "https://two.example/",
      },
      type: "add",
    },
  ]);
});

afterEach(async () => {
  window.dispatchEvent(new PointerEvent("pointerup", { isPrimary: true }));
  await store.set(
    applyBookmarkOpsAtom,
    ["bar1", "f", "o1", "o2"].map((id) => ({ id, type: "remove" as const })),
  );
});

describe("the bookmarks bar's end while something is held", () => {
  it("keeps a link let go on All Bookmarks at its end, and on the chevron at the bar's end", async () => {
    await renderInBrowser(<BarEnd />, { store });
    const others = document.querySelector("[data-other-bookmarks]");
    const chevron = document.querySelector("[data-bookmarks-overflow]");
    if (!others || !chevron) {
      throw new Error("no chips");
    }

    await holdLinkAt(center(others));
    expect(landing()).toEqual({
      chip: OTHER_ROOT,
      index: 3,
      kind: "bookmarks",
      root: OTHER_ROOT,
    });

    move(center(chevron));
    await frames(2);
    expect(landing()).toEqual({
      chip: OVERFLOW_CHIP,
      index: 1,
      kind: "bookmarks",
    });
  });

  it("files a link held over All Bookmarks' menu among its items, or in a folder whose row's middle it is on", async () => {
    await renderInBrowser(<BarEnd />, { store });
    await userEvent.click(page.getByRole("button", { name: "All Bookmarks" }));
    const two = page.getByRole("menuitem", { name: /Loose two/ }).element();
    const folder = page.getByRole("menuitem", { name: /Reading/ }).element();

    await holdLinkAt(center(two, 0.25));
    expect(landing()).toEqual({
      index: 2,
      kind: "bookmarks",
      root: OTHER_ROOT,
    });

    move(center(folder));
    await frames(2);
    expect(landing()).toEqual({ folder: "f", index: 0, kind: "bookmarks" });

    move(center(two, 0.9));
    await frames(2);
    expect(landing()).toEqual({
      index: 3,
      kind: "bookmarks",
      root: OTHER_ROOT,
    });
  });

  it("holds a bookmark of All Bookmarks' menu, pressed and moved, as that bookmark", async () => {
    await renderInBrowser(<BarEnd />, { store });
    await userEvent.click(page.getByRole("button", { name: "All Bookmarks" }));
    const one = page.getByRole("menuitem", { name: /Loose one/ }).element();
    const from = center(one);
    one.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: from.x,
        clientY: from.y,
        isPrimary: true,
      }),
    );
    move({ x: from.x + 40, y: from.y + 40 });
    await frames(2);
    expect(currentDrag()?.held).toMatchObject({
      bookmark: "o1",
      kind: "link",
      url: "https://one.example/",
    });
    // Its menu stays up while it is held.
    await expect.element(page.getByRole("menu")).toBeVisible();
  });
});
