// Turns far from view drawn as boxes of their last height, in a real browser:
// which turns are boxes, that the reader's place holds while boxes fill in
// again at another height, at the window's zooms, and that a jump to a box
// lands where it says. Measured, since jsdom has no layout or observers.
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { renderInBrowser } from "@/tests/render-browser";
import { useLayoutEffect, useState } from "react";
import { describe, expect, it } from "vitest";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useFarRows,
  useMessageScroller,
} from "../message-scroller";
import { type FarRows } from "./far-rows";

const TURNS = 60;
const VIEW = 400;

/** How tall turn `index`'s reply is the first time it is drawn. */
const replyHeight = (index: number) => 120 + ((index * 37) % 260);

/** Times each turn's reply has been drawn, so drawing it again changes its height. */
const draws = new Map<number, number>();

/**
 * A reply that comes back 7px taller every time it is drawn again, as a
 * turn whose pictures or cards lay out differently on a second look.
 */
function Reply({ index }: { index: number }) {
  const [count] = useState(() => {
    const next = (draws.get(index) ?? 0) + 1;
    draws.set(index, next);
    return next;
  });
  return (
    <div
      data-reply={index}
      style={{ height: replyHeight(index) + (count - 1) * 7 }}
    >
      Reply {index}
      {index === 5 && <button type="button">Copy</button>}
    </div>
  );
}

let farRows: FarRows | undefined;
let scrollToMessage: ReturnType<typeof useMessageScroller>["scrollToMessage"];
let setShown: (isShown: boolean) => void = () => undefined;

function Grab() {
  const rows = useFarRows();
  const scroller = useMessageScroller();
  useLayoutEffect(() => {
    farRows = rows;
    ({ scrollToMessage } = scroller);
  });
  return null;
}

function Harness({ zoom = 1 }: { zoom?: number }) {
  const [isShown, setIsShown] = useState(true);
  setShown = setIsShown;
  return (
    <div style={{ zoom }}>
      <ActiveTabProvider isActive={isShown}>
        <MessageScrollerProvider>
          <Grab />
          <MessageScroller>
            <MessageScrollerViewport style={{ height: VIEW, width: 320 }}>
              <MessageScrollerContent
                style={{ display: "flex", flexDirection: "column", gap: 24 }}
              >
                {Array.from({ length: TURNS }, (_, index) => {
                  const id = `turn-${index.toString()}`;
                  const isLast = index === TURNS - 1;
                  return [
                    <MessageScrollerItem
                      key={`${id}-opener`}
                      keepDrawn={isLast}
                      messageId={id}
                      scrollAnchor
                      style={{ paddingBottom: 8 }}
                      turnId={id}
                    >
                      <div style={{ height: 40 }}>Message {index}</div>
                    </MessageScrollerItem>,
                    <MessageScrollerItem
                      key={`${id}-reply`}
                      keepDrawn={isLast}
                      turnId={id}
                    >
                      <Reply index={index} />
                    </MessageScrollerItem>,
                  ];
                })}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      </ActiveTabProvider>
    </div>
  );
}

let setProseZoom: (zoom: number) => void = () => undefined;

/** Words enough to wrap onto a few lines or many, by turn. */
const prose = (index: number) =>
  `Reply ${index.toString()}: ${"the harbor wall and its berths ".repeat(8 + ((index * 7) % 30))}`;

/**
 * Turns of a block that keeps its height over words that wrap, as a tool row
 * over a reply, in a window whose width on screen stays put, so a zoom gives
 * the column fewer layout px and the words more lines, as the app's zoom does.
 */
function ProseHarness() {
  const [zoom, setZoom] = useState(1);
  setProseZoom = setZoom;
  return (
    <div style={{ width: 480 }}>
      <div style={{ width: "100%", zoom }}>
        <MessageScrollerProvider>
          <Grab />
          <MessageScroller>
            <MessageScrollerViewport style={{ height: VIEW, width: "100%" }}>
              <MessageScrollerContent
                style={{ display: "flex", flexDirection: "column", gap: 24 }}
              >
                {Array.from({ length: TURNS }, (_, index) => {
                  const id = `turn-${index.toString()}`;
                  return (
                    <MessageScrollerItem
                      key={id}
                      keepDrawn={index === TURNS - 1}
                      messageId={id}
                      scrollAnchor
                      style={{ padding: 8 }}
                      turnId={id}
                    >
                      <div style={{ height: 120 }} />
                      <p style={{ margin: 0 }}>{prose(index)}</p>
                    </MessageScrollerItem>
                  );
                })}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      </div>
    </div>
  );
}

function viewport() {
  const element = document.querySelector<HTMLElement>(
    "[data-slot=message-scroller-viewport]",
  );
  if (!element) {
    throw new Error("no viewport");
  }
  return element;
}

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const next = (left: number) => {
      if (left === 0) {
        resolve();
      } else {
        requestAnimationFrame(() => {
          next(left - 1);
        });
      }
    };
    next(count);
  });

const boxedTurns = () =>
  new Set(
    [...document.querySelectorAll<HTMLElement>("[data-placeholder]")].map(
      (row) => row.dataset.turnId,
    ),
  );

const rowsOf = (turn: number) => [
  ...document.querySelectorAll<HTMLElement>(
    `[data-turn-id="turn-${turn.toString()}"]`,
  ),
];

/** The row under the middle of the view (or the next, past a gap), and its top on screen. */
function middleRow() {
  const view = viewport().getBoundingClientRect();
  const middle = view.top + view.height / 2;
  const row = [
    ...document.querySelectorAll<HTMLElement>("[data-message-scroller-item]"),
  ].find((item) => item.getBoundingClientRect().bottom >= middle);
  return row && { row, top: row.getBoundingClientRect().top };
}

/** The first row in view, and its top on screen. */
function topRow() {
  const top = viewport().getBoundingClientRect().top;
  const row = [
    ...document.querySelectorAll<HTMLElement>("[data-message-scroller-item]"),
  ].find((item) => item.getBoundingClientRect().bottom > top);
  return row && { row, top: row.getBoundingClientRect().top };
}

/**
 * Steps the view a fraction of its height at a time to the far end in
 * `direction`, and lists every step after which the row in the middle of the
 * view was not where the step put it.
 */
async function stepThrough(direction: 1 | -1) {
  const view = viewport();
  const scale = view.getBoundingClientRect().height / view.offsetHeight;
  const misses: { at: number; px: number }[] = [];
  let boxedOnTheWay = 0;
  for (;;) {
    const before = middleRow();
    const from = view.scrollTop;
    // As a reader's wheel, so the owner leaves the place to them.
    view.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: direction * 100 }),
    );
    view.scrollTop = from + direction * 0.9 * view.clientHeight;
    const moved = view.scrollTop - from;
    if (Math.abs(moved) < 1) {
      break;
    }
    await frames(3);
    boxedOnTheWay = Math.max(boxedOnTheWay, boxedTurns().size);
    if (before) {
      const off =
        before.row.getBoundingClientRect().top - (before.top - moved * scale);
      if (Math.abs(off) > 1) {
        misses.push({ at: Math.round(from), px: Math.round(off) });
      }
    }
  }
  return { boxedOnTheWay, misses };
}

describe("FarRows", () => {
  it("draws the turns far from view as boxes of the height each was drawn at", async () => {
    draws.clear();
    await renderInBrowser(<Harness />);
    await expect.poll(() => boxedTurns().size).toBeGreaterThan(10);
    const boxed = boxedTurns();
    // The transcript opens at its end: the last turns are drawn, and the last
    // stays drawn whatever happens.
    expect(boxed.has(`turn-${(TURNS - 1).toString()}`)).toBe(false);
    expect(boxed.has("turn-0")).toBe(true);
    const [opener, reply] = rowsOf(0);
    expect(opener?.textContent).toBe("");
    expect(opener?.offsetHeight).toBe(48);
    expect(reply?.offsetHeight).toBe(replyHeight(0));
    expect(document.querySelector('[data-reply="0"]')).toBeNull();
    // Only what arrives in the turns kept drawn is read out by the log.
    expect(opener?.ariaLive).toBe("off");
    expect(rowsOf(TURNS - 1).map((row) => row.ariaLive)).toEqual([null, null]);
  });

  it("lists every row's place in the column, boxes included", async () => {
    draws.clear();
    await renderInBrowser(<Harness />);
    await expect.poll(() => boxedTurns().size).toBeGreaterThan(10);
    const places = farRows?.places() ?? [];
    expect(places).toHaveLength(TURNS * 2);
    expect(
      places
        .slice(0, 2)
        .map(({ height, isBox, turn }) => ({ height, isBox, turn })),
    ).toEqual([
      { height: 48, isBox: true, turn: "turn-0" },
      { height: replyHeight(0), isBox: true, turn: "turn-0" },
    ]);
    // Each row starts where the one before it ends, past the column's gap.
    for (const [index, place] of places.entries()) {
      const before = places[index - 1];
      if (before) {
        expect(place.top).toBeCloseTo(before.top + before.height + 24, 3);
      }
      expect(place.top).toBeCloseTo(
        place.row.offsetTop - viewport().offsetTop,
        3,
      );
    }
  });

  it.each([0.75, 1, 1.5])(
    "keeps the reader's place top to bottom and back at %fx zoom",
    { timeout: 60_000 },
    async (zoom) => {
      draws.clear();
      await renderInBrowser(<Harness zoom={zoom} />);
      await expect.poll(() => boxedTurns().size).toBeGreaterThan(5);
      const up = await stepThrough(-1);
      const down = await stepThrough(1);
      const upAgain = await stepThrough(-1);
      expect({
        down: down.misses,
        up: up.misses,
        upAgain: upAgain.misses,
      }).toEqual({
        down: [],
        up: [],
        upAgain: [],
      });
      // Turns were drawn again on the way, so their heights changed.
      expect([...draws.values()].some((count) => count > 2)).toBe(true);
      expect(Math.min(up.boxedOnTheWay, down.boxedOnTheWay)).toBeGreaterThan(5);
    },
  );

  it.each([0.75, 1, 1.5])(
    "keeps the place a jump past the band lands on as the boxes there draw, at %fx zoom",
    async (zoom) => {
      draws.clear();
      await renderInBrowser(<Harness zoom={zoom} />);
      await expect.poll(() => boxedTurns().size).toBeGreaterThan(10);
      const view = viewport();
      for (const at of [0.4, 0.15, 0.6]) {
        view.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, deltaY: -100 }),
        );
        view.scrollTop = at * view.scrollHeight;
        // The row the top of the view is in, which is what stays put: rows
        // below it in view may draw at another height and move under it.
        const landed = topRow();
        expect(landed?.row.hasAttribute("data-placeholder")).toBe(true);
        await frames(10);
        expect(landed?.row.hasAttribute("data-placeholder")).toBe(false);
        expect(
          Math.abs(
            (landed?.row.getBoundingClientRect().top ?? 0) - (landed?.top ?? 0),
          ),
        ).toBeLessThanOrEqual(1);
      }
    },
  );

  it.each([1.5, 0.75])(
    "keeps the boxes near their true heights through a zoom to %fx",
    async (zoom) => {
      await renderInBrowser(<ProseHarness />);
      await expect.poll(() => boxedTurns().size).toBeGreaterThan(20);
      const view = viewport();
      view.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -100 }),
      );
      view.scrollTop = view.scrollHeight / 2;
      await frames(10);
      setProseZoom(zoom);
      await frames(3);
      const landed = topRow();
      await frames(10);
      // The reader's place holds as the boxes take their new heights.
      expect(
        Math.abs(
          (landed?.row.getBoundingClientRect().top ?? 0) - (landed?.top ?? 0),
        ),
      ).toBeLessThanOrEqual(1);
      const estimated = view.scrollHeight;
      expect(boxedTurns().size).toBeGreaterThan(20);
      farRows?.keep(
        "test",
        new Set(
          Array.from(
            { length: TURNS },
            (_, index) => `turn-${index.toString()}`,
          ),
        ),
      );
      await expect.poll(() => boxedTurns().size).toBe(0);
      await frames(2);
      // Within a screen of the column drawn whole, which runs to some
      // seventy. Scaled as words alone would wrap, the boxes made it 4,400 px
      // long at 1.5x and 1,700 px short at 0.75x, since a block of fixed
      // height does not grow with the lines.
      expect(Math.abs(estimated - view.scrollHeight)).toBeLessThan(
        view.clientHeight,
      );
    },
  );

  it("lands a jump to a turn drawn as a box at the top of the view", async () => {
    draws.clear();
    await renderInBrowser(<Harness zoom={1.5} />);
    await expect.poll(() => boxedTurns().has("turn-20")).toBe(true);
    scrollToMessage("turn-20");
    await frames(10);
    const [opener] = rowsOf(20);
    expect(opener?.hasAttribute("data-placeholder")).toBe(false);
    const view = viewport();
    const top =
      (opener?.getBoundingClientRect().top ?? 0) -
      view.getBoundingClientRect().top;
    expect(Math.abs(top)).toBeLessThanOrEqual(1);
  });

  it("leaves a hidden tab's turns as they were until it is up again", async () => {
    draws.clear();
    await renderInBrowser(<Harness />);
    await expect.poll(() => boxedTurns().size).toBeGreaterThan(10);
    const before = boxedTurns();
    setShown(false);
    await frames(2);
    viewport().dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: -100 }),
    );
    viewport().scrollTop = 0;
    await frames(5);
    expect(boxedTurns()).toEqual(before);
    setShown(true);
    await expect.poll(() => boxedTurns().has("turn-0")).toBe(false);
  });

  it("keeps a turn drawn while the keyboard is in it", async () => {
    draws.clear();
    await renderInBrowser(<Harness />);
    await expect.poll(() => boxedTurns().size).toBeGreaterThan(10);
    scrollToMessage("turn-5");
    await expect.poll(() => boxedTurns().has("turn-5")).toBe(false);
    document.querySelector<HTMLElement>('[data-reply="5"] button')?.focus();
    viewport().scrollTop = viewport().scrollHeight;
    await frames(5);
    expect(boxedTurns().has("turn-5")).toBe(false);
    expect(boxedTurns().has("turn-6")).toBe(true);
    viewport().focus();
    await expect.poll(() => boxedTurns().has("turn-5")).toBe(true);
  });
});
