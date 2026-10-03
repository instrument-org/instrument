import { describe, expect, it } from "vitest";

import {
  GESTURE_IDLE,
  type GestureEffect,
  type GestureEvent,
  type GestureState,
  NARROW_AFTER_MS,
  RENAME_AFTER_MS,
  step,
  waitFor,
} from "./file-system-gestures";

type Selected = { has: boolean; size: number };

const ALONE: Selected = { has: true, size: 1 };
const ONE_OF_SEVERAL: Selected = { has: true, size: 3 };
const UNSELECTED: Selected = { has: false, size: 1 };

function mousePress(
  path: string,
  selection: Selected,
  extra: Partial<Extract<GestureEvent, { type: "press" }>> = {},
): GestureEvent {
  return {
    button: 0,
    isContextClick: false,
    isOnName: true,
    mode: null,
    path,
    pointerType: "mouse",
    renames: true,
    selection,
    type: "press",
    ...extra,
  };
}

function click(path: string, detail = 1): GestureEvent {
  return { detail, isContextClick: false, mode: null, path, type: "click" };
}

function timeout(lead: null | string, selectionSize = 1): GestureEvent {
  return { lead, selectionSize, type: "timeout" };
}

/** Every effect the events produce in turn, and where they leave the machine. */
function run(events: GestureEvent[]) {
  let state: GestureState = GESTURE_IDLE;
  const effects: GestureEffect[] = [];
  for (const event of events) {
    const next = step(state, event);
    effects.push(...next.effects);
    state = next.state;
  }
  return { effects, state };
}

describe("pressing a row", () => {
  it("selects an unselected row on the way down, and waits for nothing", () => {
    const { effects, state } = run([mousePress("a", UNSELECTED), click("a")]);
    expect(effects).toEqual([{ mode: null, path: "a", type: "select" }]);
    expect(state).toBe(GESTURE_IDLE);
  });

  it("selects on the click for a touch, not the press", () => {
    const pressed = run([
      mousePress("a", UNSELECTED, { pointerType: "touch" }),
    ]);
    expect(pressed.effects).toEqual([]);
    const clicked = run([
      mousePress("a", UNSELECTED, { pointerType: "touch" }),
      click("a"),
    ]);
    expect(clicked.effects).toEqual([
      { mode: null, path: "a", type: "select" },
    ]);
  });

  it("selects nothing on a Control-click, which is the Mac's right click", () => {
    const { effects } = run([
      mousePress("a", UNSELECTED, { isContextClick: true }),
      { detail: 1, isContextClick: true, mode: null, path: "a", type: "click" },
    ]);
    expect(effects).toEqual([]);
  });

  it("selects for a click that no press began, such as the keyboard's", () => {
    expect(run([click("a")]).effects).toEqual([
      { mode: null, path: "a", type: "select" },
    ]);
  });

  it("carries ⌘ and Shift through to the selection", () => {
    expect(
      run([mousePress("a", UNSELECTED, { mode: "toggle" })]).effects,
    ).toEqual([{ mode: "toggle", path: "a", type: "select" }]);
  });
});

describe("narrowing several to one", () => {
  it("waits out a double-click before narrowing", () => {
    const clicked = run([mousePress("b", ONE_OF_SEVERAL), click("b")]);
    expect(clicked.effects).toEqual([]);
    expect(waitFor(clicked.state)).toBe(NARROW_AFTER_MS);
    const done = run([
      mousePress("b", ONE_OF_SEVERAL),
      click("b"),
      timeout("c", 3),
    ]);
    expect(done.effects).toEqual([{ path: "b", type: "narrow" }]);
    expect(done.state).toBe(GESTURE_IDLE);
  });

  it("leaves several standing for a double-click to open", () => {
    const { effects, state } = run([
      mousePress("b", ONE_OF_SEVERAL),
      click("b"),
      mousePress("b", ONE_OF_SEVERAL),
      click("b", 2),
      { type: "double-click" },
      timeout("c", 3),
    ]);
    expect(effects).toEqual([]);
    expect(state).toBe(GESTURE_IDLE);
  });

  it("narrows first when another row is pressed while it waits", () => {
    const { effects } = run([
      mousePress("b", ONE_OF_SEVERAL),
      click("b"),
      // The selection the press found is still the several.
      mousePress("d", UNSELECTED, { mode: "toggle" }),
    ]);
    expect(effects).toEqual([
      { path: "b", type: "narrow" },
      { mode: "toggle", path: "d", type: "select" },
    ]);
  });

  it("answers a plain press on another of the several as that row alone", () => {
    const { effects } = run([
      mousePress("b", ONE_OF_SEVERAL),
      click("b"),
      mousePress("c", ONE_OF_SEVERAL),
    ]);
    expect(effects).toEqual([
      { path: "b", type: "narrow" },
      { mode: null, path: "c", type: "select" },
    ]);
  });

  it("is called off by the selection changing while it waits", () => {
    const { effects } = run([
      mousePress("b", ONE_OF_SEVERAL),
      click("b"),
      { lead: "d", type: "selection" },
      timeout("d", 1),
    ]);
    expect(effects).toEqual([]);
  });

  it("is not called off by a scroll", () => {
    const { effects } = run([
      mousePress("b", ONE_OF_SEVERAL),
      click("b"),
      { type: "interrupt" },
      timeout("c", 3),
    ]);
    expect(effects).toEqual([{ path: "b", type: "narrow" }]);
  });
});

describe("renaming on a second slow click", () => {
  it("renames the one thing selected once the double-click time is past", () => {
    const clicked = run([mousePress("a", ALONE), click("a")]);
    expect(waitFor(clicked.state)).toBe(RENAME_AFTER_MS);
    expect(
      run([mousePress("a", ALONE), click("a"), timeout("a")]).effects,
    ).toEqual([
      { mode: null, path: "a", type: "select" },
      { path: "a", type: "rename" },
    ]);
  });

  it.each<{ name: string; events: GestureEvent[] }>([
    {
      events: [mousePress("a", UNSELECTED), click("a"), timeout("a")],
      name: "the first click on a row",
    },
    {
      events: [
        mousePress("a", ALONE, { isOnName: false }),
        click("a"),
        timeout("a"),
      ],
      name: "a click on the glyph rather than the name",
    },
    {
      events: [
        mousePress("a", ALONE, { renames: false }),
        click("a"),
        timeout("a"),
      ],
      name: "a browser that renames nothing",
    },
    {
      events: [
        mousePress("a", ALONE, { mode: "toggle" }),
        click("a"),
        timeout("a"),
      ],
      name: "a ⌘-click",
    },
    {
      events: [
        mousePress("a", ALONE),
        click("a"),
        mousePress("a", ALONE),
        click("a", 2),
        { type: "double-click" },
        timeout("a"),
      ],
      name: "a double-click, which opens",
    },
    {
      events: [
        mousePress("a", ALONE),
        click("a"),
        { type: "interrupt" },
        timeout("a"),
      ],
      name: "a key or a scroll first",
    },
    {
      events: [
        mousePress("a", ALONE),
        click("a"),
        { lead: "b", type: "selection" },
        timeout("b"),
      ],
      name: "the selection moving off it",
    },
    {
      events: [mousePress("a", ALONE), click("a"), timeout("a", 2)],
      name: "a selection grown to several by the time it fires",
    },
  ])("does not rename after $name", ({ events }) => {
    expect(
      run(events).effects.filter((each) => each.type === "rename"),
    ).toEqual([]);
  });
});
