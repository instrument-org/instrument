import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, expect, it, vi } from "vitest";

import { REST_MS } from "./landing";
import { currentDrag, pressToDrag, setLander } from "./session";
import { useSidePagesTarget, useStripTarget } from "./use-group-drag";

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

/** A group's sides, each a 400px page from the window's left edge, a screen up on each. */
function Pages({ sides }: { sides: 1 | 2 }) {
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
        left: 0,
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

/** Presses a bookmark of the bar and carries it to `x` over the strip. */
const carryBookmarkTo = (x: number) => {
  pressToDrag(
    { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
    () => ({
      grab: { x: 0, y: 0 },
      held: {
        bookmark: "b1",
        id: "tab_b1",
        kind: "link",
        title: "Example",
        url: "https://example.com/",
      },
    }),
  );
  pointer("pointermove", 10, ROW_Y - 40);
  pointer("pointermove", x, STRIP_Y);
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
  { at: 120, expected: { side: 0, split: true }, sides: 1 },
  { at: 300, expected: { side: 1, split: true }, sides: 1 },
  { at: 600, expected: undefined, sides: 2 },
] as const)(
  "opens a sidebar row held over a group's page beside it, on the half under the pointer, only beside a lone side (x $at, $sides sides)",
  async ({ at, expected, sides }) => {
    await renderInBrowser(<Pages sides={sides} />);
    pressToDrag(
      { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
      () => ({
        grab: { x: 0, y: 0 },
        held: { group: "other", height: 40, kind: "group" },
      }),
    );
    pointer("pointermove", 10, ROW_Y - 40);
    pointer("pointermove", at, 400);
    const { landing } = currentDrag() ?? {};
    expect(
      landing?.kind === "side"
        ? { group: landing.group, side: landing.side, split: landing.split }
        : landing,
    ).toEqual(expected && { group: "up", ...expected });
  },
);
