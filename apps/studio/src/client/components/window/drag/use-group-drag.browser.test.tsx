import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, expect, it, vi } from "vitest";

import { PIECE_EDGE_PX, REST_MS } from "./landing";
import { currentDrag, followRemote, pressToDrag, setLander } from "./session";
import { useSidePagesTarget, useStripTarget } from "./use-group-drag";
import { useSidebarTarget } from "./use-sidebar-drag";

const ROW_Y = 300;
const STRIP_Y = 20;

const pointer = (type: string, x: number, y: number) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      buttons: type === "pointermove" ? 1 : 0,
      clientX: x,
      clientY: y,
      isPrimary: true,
    }),
  );

/** A side's strip of two 100px tabs, from the window's left edge. */
function Strip({ group }: { group: string }) {
  useStripTarget({
    group,
    isOn: true,
    page: () => null,
    side: 0,
    strip: () => document.querySelector<HTMLElement>("[data-group-tabs]"),
    tabs: [
      { href: "/a", id: "a", kind: "screen" },
      { href: "/b", id: "b", kind: "screen" },
    ],
  });
  return (
    <div
      data-group-tabs=""
      style={{ height: 40, left: 0, position: "fixed", top: 0, width: 400 }}
    >
      <div role="tablist" style={{ display: "flex" }}>
        {["a", "b"].map((key) => (
          <div data-tab-key={key} key={key} style={{ height: 40, width: 100 }}>
            {key}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A group's sides, each a 400px page from `left` (the window's left edge), a screen up on each. */
function Pages({ left = 0, sides }: { left?: number; sides: 1 | 2 }) {
  const layout = {
    focused: 0 as const,
    sides: Array.from({ length: sides }, (_, side) => ({
      tabs: [{ href: `/s${side}`, id: `s${side}`, kind: "screen" as const }],
      up: `s${side}`,
    })),
  };
  useSidePagesTarget({
    group: "up",
    isOn: true,
    layout,
    scroller: () => document.querySelector<HTMLElement>("[data-pages]"),
  });
  return (
    <div
      data-pages=""
      style={{
        display: "flex",
        height: 600,
        left,
        position: "fixed",
        top: 100,
      }}
    >
      {layout.sides.map((_, side) => (
        <div
          data-side-page={side}
          key={side}
          style={{ height: 600, width: 400 }}
        />
      ))}
    </div>
  );
}

/** Presses a sidebar row of `group` and carries it to `x` over the strip. */
const carryRowTo = (group: string, x: number) => {
  pressToDrag(
    { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
    () => ({
      grab: { x: 0, y: 0 },
      held: { group, height: 40, kind: "group" },
    }),
  );
  pointer("pointermove", 10, ROW_Y - 40);
  pointer("pointermove", x, STRIP_Y);
};

afterEach(() => {
  pointer("pointerup", 0, 0);
  setLander(undefined);
  document.body.replaceChildren();
});

it("lands a sidebar row dropped on another group's strip at the gap nearest the pointer, a line there", async () => {
  const landed = vi.fn();
  setLander(landed);
  await renderInBrowser(<Strip group="up" />);
  carryRowTo("other", 150);
  const strip = {
    group: "up",
    index: 1,
    kind: "strip",
    line: { height: 28, left: 99, top: 6, width: 2 },
    side: 0,
  };
  expect(currentDrag()?.landing).toEqual(strip);
  pointer("pointerup", 150, STRIP_Y);
  expect(landed).toHaveBeenCalledWith(
    { group: "other", height: 40, kind: "group" },
    strip,
  );
});

const BOOKMARK = {
  bookmark: "b1",
  id: "tab_b1",
  kind: "link",
  title: "Example",
  url: "https://example.com/",
} as const;

/** A place of the bar's Files menu. */
const PLACE = {
  id: "tab_p1",
  kind: "link",
  place: { path: "/Users/mac-user/Documents" },
  title: "Documents",
  url: "file:///Users/mac-user/Documents/",
} as const;

/** Presses something of the window and carries it to a point. */
const carryTo = (
  held: typeof BOOKMARK | typeof PLACE,
  x: number,
  y = STRIP_Y,
) => {
  pressToDrag(
    { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
    () => ({ grab: { x: 0, y: 0 }, held }),
  );
  pointer("pointermove", 10, ROW_Y - 40);
  pointer("pointermove", x, y);
};

/** Presses a bookmark of the bar and carries it to `x` over the strip. */
const carryBookmarkTo = (x: number) => {
  carryTo(BOOKMARK, x);
};

const rest = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

it("opens a bookmark in the tab whose middle it rests on, and keeps that tab while the pointer stays near its middle", async () => {
  await renderInBrowser(<Strip group="up" />);
  carryBookmarkTo(150);
  expect(currentDrag()?.landing).toMatchObject({ index: 1, kind: "strip" });
  await rest(REST_MS + 80);
  const replace = {
    group: "up",
    kind: "replace",
    lit: { height: 40, left: 100, top: 0, width: 100 },
    side: 0,
    tab: "b",
  };
  expect(currentDrag()?.landing).toEqual(replace);
  // Its middle 72% keeps it; past that the line comes back.
  pointer("pointermove", 185, STRIP_Y);
  await rest(40);
  expect(currentDrag()?.landing).toEqual(replace);
  pointer("pointermove", 190, STRIP_Y);
  await rest(40);
  expect(currentDrag()?.landing).toMatchObject({ index: 2, kind: "strip" });
});

it("stands a tab along its own strip where its left edge is, with no line", async () => {
  await renderInBrowser(<Strip group="up" />);
  pressToDrag(
    { button: 0, clientX: 10, clientY: STRIP_Y, isPrimary: true },
    () => ({
      grab: { x: 10, y: 0 },
      held: { group: "up", id: "a", key: "a", kind: "tab", side: 0 },
    }),
  );
  pointer("pointermove", 40, STRIP_Y);
  pointer("pointermove", 170, STRIP_Y);
  expect(currentDrag()?.landing).toEqual({
    group: "up",
    index: 1,
    kind: "strip",
    side: 0,
  });
});

it("never opens a tab from another side in a tab's place", async () => {
  await renderInBrowser(<Strip group="up" />);
  pressToDrag(
    { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
    () => ({
      grab: { x: 0, y: 0 },
      held: { group: "up", id: "c", key: "c", kind: "tab", side: 1 },
    }),
  );
  pointer("pointermove", 10, ROW_Y - 40);
  pointer("pointermove", 150, STRIP_Y);
  await rest(REST_MS + 80);
  expect(currentDrag()?.landing).toMatchObject({ index: 1, kind: "strip" });
});

it("lands a sidebar row nowhere on its own group's strip", async () => {
  await renderInBrowser(<Strip group="up" />);
  carryRowTo("up", 150);
  expect(currentDrag()?.landing).toBeUndefined();
});

it.each([
  { at: PIECE_EDGE_PX - 1, expected: { side: 0, split: true }, sides: 1 },
  { at: PIECE_EDGE_PX, expected: undefined, sides: 1 },
  { at: 400 - PIECE_EDGE_PX - 1, expected: undefined, sides: 1 },
  { at: 400 - PIECE_EDGE_PX, expected: { side: 1, split: true }, sides: 1 },
  { at: 790, expected: undefined, sides: 2 },
] as const)(
  "opens a sidebar row held over a group's page beside it only at a lone side's outer edge (x $at, $sides sides)",
  async ({ at, expected, sides }) => {
    await renderInBrowser(<Pages sides={sides} />);
    pressToDrag(
      { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
      () => ({
        grab: { x: 0, y: 0 },
        held: { group: "other", height: 40, kind: "group" },
      }),
    );
    // Starts above the pages, so no edge is armed on the way.
    pointer("pointermove", 10, STRIP_Y);
    pointer("pointermove", at, 400);
    const { landing } = currentDrag() ?? {};
    expect(
      landing?.kind === "side"
        ? { group: landing.group, side: landing.side, split: landing.split }
        : landing,
    ).toEqual(expected && { group: "up", ...expected });
  },
);

/** The window's sidebar of groups, 200px wide, its list holding only New. */
function Sidebar() {
  useSidebarTarget(() =>
    document.querySelector<HTMLElement>('nav[aria-label="Tab groups"]'),
  );
  return (
    <nav
      aria-label="Tab groups"
      style={{ height: 800, left: 0, position: "fixed", top: 0, width: 200 }}
    >
      <div data-group-list="" style={{ height: 800, position: "relative" }}>
        <div data-drop-item=":new" style={{ height: 36 }} />
      </div>
    </nav>
  );
}

it("arms nothing at the left edge a sidebar row comes free inside until the pointer has been out of it, each time it comes free", async () => {
  // The sidebar ends at 200 and lets go of a row 72px past it, at 272; the
  // page starts at 208, so its left edge reaches to 208 + 96 = 304.
  await renderInBrowser(
    <>
      <Sidebar />
      <Pages left={208} sides={1} />
    </>,
  );
  pressToDrag(
    { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
    () => ({
      grab: { x: 0, y: 0 },
      held: { group: "other", height: 40, kind: "group" },
    }),
  );
  const at = (x: number) => {
    pointer("pointermove", x, 400);
    const landing = currentDrag()?.landing;
    return landing?.kind === "side"
      ? `${landing.split ? "split" : "join"} ${String(landing.side)}`
      : (landing?.kind ?? "none");
  };
  pointer("pointermove", 10, ROW_Y - 40);
  expect([
    at(271),
    at(272),
    at(290),
    at(220),
    at(320),
    at(290),
    at(220),
    at(100),
    at(290),
    at(500),
    at(290),
  ]).toEqual([
    // In the sidebar's reach past its edge, the row keeps to the list.
    "sidebar",
    // Free from the first pixel past that reach, inside the left edge: it
    // waits.
    "none",
    "none",
    "none",
    // Out of the edge once, over the page's middle.
    "none",
    "split 0",
    "split 0",
    // Back over the sidebar, and free again inside the edge: it waits again.
    "sidebar",
    "none",
    "none",
    "split 0",
  ]);
});

it.each([
  { at: 200, expected: undefined, sides: 1 },
  { at: 600, expected: undefined, sides: 2 },
  { at: 400 - PIECE_EDGE_PX - 1, expected: undefined, sides: 1 },
  { at: 400 - PIECE_EDGE_PX, expected: { side: 1, split: true }, sides: 1 },
] as const)(
  "lands a bookmark nowhere in a page's content, and splits at its outer edge, as deep as a tab's (x $at, $sides sides)",
  async ({ at, expected, sides }) => {
    await renderInBrowser(<Pages sides={sides} />);
    carryTo(BOOKMARK, at, 400);
    const { landing } = currentDrag() ?? {};
    expect(
      landing?.kind === "side"
        ? { side: landing.side, split: landing.split }
        : landing,
    ).toEqual(expected);
  },
);

it.each([5, 200, 395])(
  "lands a place nowhere on a page, its edges included (x %i)",
  async (at) => {
    await renderInBrowser(<Pages sides={1} />);
    carryTo(PLACE, at, 400);
    expect(currentDrag()?.landing).toBeUndefined();
  },
);

it("opens a place as a tab from a strip's line", async () => {
  const landed = vi.fn();
  setLander(landed);
  await renderInBrowser(<Strip group="up" />);
  carryTo(PLACE, 150);
  const strip = {
    group: "up",
    index: 1,
    kind: "strip",
    line: { height: 28, left: 99, top: 6, width: 2 },
    side: 0,
  };
  expect(currentDrag()?.landing).toEqual(strip);
  pointer("pointerup", 150, STRIP_Y);
  expect(landed).toHaveBeenCalledWith(PLACE, strip);
});

/** One side of one tab, which draws no strip: its page from the window's left edge, 100px down, with the row every page has at its top. */
function LoneSide({ side = 0 }: { side?: 0 | 1 }) {
  const tabs = [{ href: "/only", id: "only", kind: "screen" as const }];
  useStripTarget({
    group: "up",
    isOn: true,
    page: () => document.querySelector(`[data-side-page="${String(side)}"]`),
    side,
    strip: () => null,
    tabs,
  });
  useSidePagesTarget({
    group: "up",
    isOn: true,
    layout: { focused: 0, sides: [{ tabs, up: "only" }] },
    scroller: () => document.querySelector<HTMLElement>("[data-pages]"),
  });
  return (
    <div
      data-pages=""
      style={{ height: 600, left: 0, position: "fixed", top: 100, width: 800 }}
    >
      <div data-side-page={side} style={{ height: 600, width: 800 }} />
    </div>
  );
}

/** A tab of another group, held from the sidebar's side of the window to a point. */
const holdTabAt = (x: number, y: number) => {
  pressToDrag(
    { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
    () => ({
      grab: { x: 0, y: 0 },
      held: { group: "other", id: "c", key: "c", kind: "tab", side: 0 },
    }),
  );
  pointer("pointermove", 10, ROW_Y - 40);
  pointer("pointermove", x, y);
};

it("lands a tab held over the top row of a side with no strip at that side's end", async () => {
  await renderInBrowser(<LoneSide />);
  holdTabAt(400, 115);

  expect(currentDrag()?.landing).toMatchObject({
    group: "up",
    index: 1,
    kind: "strip",
    side: 0,
  });
});

it("lands it nowhere over the middle of that side's page, as a piece of the window never does", async () => {
  await renderInBrowser(<LoneSide />);
  holdTabAt(400, 400);

  expect(currentDrag()?.landing).toBeUndefined();
});

it("leaves the top row to the side's own only tab, which is on it already", async () => {
  await renderInBrowser(<LoneSide />);
  pressToDrag(
    { button: 0, clientX: 400, clientY: 115, isPrimary: true },
    () => ({
      grab: { x: 0, y: 0 },
      held: { group: "up", id: "only", key: "only", kind: "tab", side: 0 },
    }),
  );
  pointer("pointermove", 400, 140);
  pointer("pointermove", 420, 118);

  expect(currentDrag()?.landing).toBeUndefined();
});

it("takes a whole group held over from another window among a strip's tabs, as it does one of this window's", async () => {
  await renderInBrowser(<Strip group="up" />);
  const landing = followRemote(
    {
      grab: { x: 0, y: 0 },
      held: { group: "other", height: 40, kind: "group" },
      point: { x: 150, y: STRIP_Y },
    },
    () => undefined,
  );

  expect(landing).toMatchObject({
    group: "up",
    index: 1,
    kind: "strip",
    side: 0,
  });
  followRemote(undefined, () => undefined);
});

it("takes one at a lone side's outer edge as a side of its own", async () => {
  await renderInBrowser(<Pages sides={1} />);
  const landing = followRemote(
    {
      grab: { x: 0, y: 0 },
      held: { group: "other", height: 40, kind: "group" },
      point: { x: PIECE_EDGE_PX - 10, y: 400 },
    },
    () => undefined,
  );

  expect(landing).toMatchObject({
    group: "up",
    kind: "side",
    side: 0,
    split: true,
  });
  followRemote(undefined, () => undefined);
});
