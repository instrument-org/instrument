import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  currentDrag,
  type DropTarget,
  pressToDrag,
  setLander,
  useDropTarget,
} from "./session";

// How many holds keep pages off the keyboard (`holdKeyboardFromPages`).
const keyboard = vi.hoisted(() => ({ holds: 0 }));
vi.mock("@/client/lib/page-keyboard", () => ({
  holdKeyboardFromPages: () => {
    keyboard.holds += 1;
    let isHeld = true;
    return () => {
      if (isHeld) {
        isHeld = false;
        keyboard.holds -= 1;
      }
    };
  },
}));

const AT = { x: 100, y: 100 };

/** A pointer event at a point along the row, the button down while it moves unless `buttons` says. */
const pointer = (
  type: string,
  x: number,
  buttons = type === "pointermove" ? 1 : 0,
) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      buttons,
      clientX: x,
      clientY: AT.y,
      isPrimary: true,
    }),
  );

const HELD = {
  group: "group",
  id: "tab",
  key: "tab",
  kind: "tab",
  side: 0,
} as const;

/** Presses a tab and moves the pointer past the start, which makes the press a drag. */
const pressTab = () =>
  pressToDrag(
    { button: 0, clientX: AT.x, clientY: AT.y, isPrimary: true },
    () => ({ grab: { x: 0, y: 0 }, held: HELD }),
  );
const drag = () => {
  pointer("pointermove", AT.x + 40);
};

const afterTasks = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left === 0) {
        resolve();
      } else {
        requestAnimationFrame(() => step(left - 1));
      }
    };
    step(count);
  });

/** A page in a frame of its own, as a guest is, and the screen's home for the keyboard. */
let page: HTMLIFrameElement;
let home: HTMLElement;

beforeEach(async () => {
  const tab = document.createElement("div");
  tab.toggleAttribute("data-app-tab-active", true);
  home = document.createElement("div");
  home.toggleAttribute("data-keyboard-home", true);
  home.tabIndex = -1;
  home.textContent = "Home";
  tab.append(home);
  document.body.append(tab);
  page = document.createElement("iframe");
  page.srcdoc = "<input>";
  const loaded = new Promise((resolve) => {
    page.addEventListener("load", resolve, { once: true });
  });
  document.body.append(page);
  await loaded;
  window.focus();
});

afterEach(() => {
  pointer("pointerup", AT.x);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * As a Mac has it, the window's document reads as unfocused while a page in
 * it has the keyboard; elsewhere it reads as focused.
 */
const readFocusAs = (system: "mac" | "other") => {
  if (system === "mac") {
    vi.spyOn(document, "hasFocus").mockImplementation(
      () => document.activeElement !== page,
    );
  }
};

it.each(["mac", "other"] as const)(
  "keeps a drag when a page in the window takes the keyboard, and takes it back for the drag (%s)",
  async (system) => {
    readFocusAs(system);
    pressTab();
    drag();
    expect(currentDrag()?.held.kind).toBe("tab");

    page.focus();
    expect(document.activeElement).toBe(page);
    await afterTasks();

    expect(currentDrag()?.held.kind).toBe("tab");
    expect(document.activeElement).toBe(document.body);
    await userEvent.keyboard("{Escape}");
    expect(currentDrag()).toBeUndefined();
    await frames(2);
    expect(document.activeElement).toBe(home);
  },
);

it.each(["mac", "other"] as const)(
  "takes the keyboard back from a page that took it during the press (%s)",
  (system) => {
    readFocusAs(system);
    pressTab();
    page.focus();
    drag();

    expect(currentDrag()?.held.kind).toBe("tab");
    expect(document.activeElement).toBe(document.body);
  },
);

it("ends a drag when the window loses the system's focus", () => {
  pressTab();
  drag();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));

  expect(currentDrag()).toBeUndefined();
});

it("holds pages off the keyboard from the press until the drag ends", () => {
  pressTab();
  expect(keyboard.holds).toBe(1);
  drag();
  expect(keyboard.holds).toBe(1);
  pointer("pointerup", AT.x + 40);

  expect(currentDrag()).toBeUndefined();
  expect(keyboard.holds).toBe(0);
});

it("lets pages pass the pointer from the press, so a move over one still reaches the press", () => {
  const passes = () => getComputedStyle(page).pointerEvents === "none";
  expect(passes()).toBe(false);
  pressTab();
  expect(passes()).toBe(true);
  pointer("pointerup", AT.x);

  expect(passes()).toBe(false);
});

it("drops a press whose button came up where the window never heard it", () => {
  pressTab();
  pointer("pointermove", AT.x + 40, 0);

  expect(currentDrag()).toBeUndefined();
  expect(keyboard.holds).toBe(0);
});

it("ends a drag whose release the window never heard, landing nothing, and gives pages the pointer back", () => {
  const lands = vi.fn();
  setLander(lands);
  pressTab();
  drag();
  expect(currentDrag()?.held.kind).toBe("tab");
  expect(getComputedStyle(page).pointerEvents).toBe("none");

  // The pointer comes back over the window with no button down.
  pointer("pointermove", AT.x + 60, 0);
  expect(currentDrag()).toBeUndefined();
  expect(getComputedStyle(page).pointerEvents).not.toBe("none");

  // The next press and release elsewhere lands nothing.
  pointer("pointermove", AT.x + 80, 1);
  pointer("pointerup", AT.x + 80);
  expect(lands).not.toHaveBeenCalled();
  setLander(undefined);
});

it("lets pages take the keyboard once a press ends as a click", () => {
  pressTab();
  pointer("pointerup", AT.x);

  expect(keyboard.holds).toBe(0);
});

function Target({ target }: { target: DropTarget }) {
  useDropTarget(target);
  return null;
}

it("shows nothing at the drag's start, lights a page's edge the moment the pointer reaches it, and lets go into it", async () => {
  const landed = vi.fn();
  setLander(landed);
  const band = { height: 400, left: 376, top: 0, width: 24 };
  const split = {
    edge: { height: 376, left: 394, top: 12, width: 3 },
    group: "group",
    kind: "side",
    lit: { height: 400, left: 200, top: 0, width: 200 },
    side: 1,
    split: true,
  } as const;
  await renderInBrowser(
    <Target
      target={{
        landingAt: (point) => (point.x >= band.left ? split : undefined),
        rect: () => ({ height: 400, left: 0, top: 0, width: 400 }),
      }}
    />,
  );
  pressTab();
  drag();
  expect(currentDrag()?.landing).toBeUndefined();

  pointer("pointermove", 380);
  expect(currentDrag()?.landing).toEqual(split);
  pointer("pointerup", 384);

  expect(landed).toHaveBeenCalledWith(HELD, split);
  setLander(undefined);
});

it("marks a refused spot with the not-allowed cursor and lands nothing there", async () => {
  const landed = vi.fn();
  setLander(landed);
  await renderInBrowser(
    <Target
      target={{
        landingAt: () => "refused",
        rect: () => ({ height: 400, left: 0, top: 0, width: 400 }),
      }}
    />,
  );
  pressTab();
  drag();
  pointer("pointermove", 200);
  expect([
    currentDrag()?.isRefused,
    document.documentElement.hasAttribute("data-drop-refused"),
  ]).toEqual([true, true]);
  pointer("pointerup", 200);

  expect(landed).not.toHaveBeenCalled();
  expect(document.documentElement.hasAttribute("data-drop-refused")).toBe(
    false,
  );
  setLander(undefined);
});

/** A place of Files' sidebar, a row of Favorites when it has `favorites`. */
const placeOf = (favorites?: readonly string[]) =>
  ({
    id: "tab_p1",
    kind: "link",
    place: {
      path: "/Users/mac-user/Documents",
      ...(favorites ? { favorites } : {}),
    },
    title: "Documents",
    url: "file:///Users/mac-user/Documents/",
  }) as const;

/** Presses a place and moves the pointer past the start. */
const pressPlace = (held: ReturnType<typeof placeOf>) =>
  pressToDrag(
    { button: 0, clientX: AT.x, clientY: AT.y, isPrimary: true },
    () => ({ grab: { x: 0, y: 0 }, held }),
  );

it.each([
  { at: 200, where: "over nothing in the window" },
  { at: -100, where: "past the window" },
])(
  "removes a row of Favorites let go $where, and lands a place of the Files menu nowhere there",
  async ({ at }) => {
    const landed = vi.fn();
    setLander(landed);
    await renderInBrowser(
      <Target
        target={{
          landingAt: () => undefined,
          rect: () => ({ height: 400, left: 0, top: 0, width: 400 }),
        }}
      />,
    );
    const favorites = placeOf(["/Users/mac-user/Documents"]);
    pressPlace(favorites);
    drag();
    pointer("pointermove", at);
    const unfavorite = {
      kind: "unfavorite",
      path: "/Users/mac-user/Documents",
    };
    expect(currentDrag()?.landing).toEqual(unfavorite);
    pointer("pointerup", at);

    const menu = placeOf();
    pressPlace(menu);
    drag();
    pointer("pointermove", at);
    expect(currentDrag()?.landing).toBeUndefined();
    pointer("pointerup", at);

    expect(landed.mock.calls).toEqual([
      [favorites, unfavorite],
      [menu, undefined],
    ]);
    setLander(undefined);
  },
);

it("keeps a row of Favorites where a target refuses it", async () => {
  const landed = vi.fn();
  setLander(landed);
  await renderInBrowser(
    <Target
      target={{
        landingAt: () => "refused",
        rect: () => ({ height: 400, left: 0, top: 0, width: 400 }),
      }}
    />,
  );
  pressPlace(placeOf(["/Users/mac-user/Documents"]));
  drag();
  pointer("pointermove", 200);
  expect(currentDrag()).toMatchObject({ isRefused: true, landing: undefined });
  pointer("pointerup", 200);

  expect(landed).not.toHaveBeenCalled();
  setLander(undefined);
});

it("lets a target that lands its own drops take them in place of the lander", async () => {
  const landed = vi.fn();
  const own = vi.fn();
  setLander(landed);
  const favorite = {
    index: 1,
    kind: "favorite",
    line: { height: 2, left: 0, top: 40, width: 200 },
    moves: false,
  } as const;
  await renderInBrowser(
    <Target
      target={{
        land: own,
        landingAt: () => favorite,
        rect: () => ({ height: 400, left: 0, top: 0, width: 400 }),
      }}
    />,
  );
  pressTab();
  drag();
  pointer("pointermove", 200);
  pointer("pointerup", 200);

  expect([own.mock.calls, landed.mock.calls]).toEqual([[[HELD, favorite]], []]);
  setLander(undefined);
});

/** A list 400px tall at the window's top left, scrolled to the middle of rows 2000px tall, as a target that scrolls it. */
const scrollingList = async () => {
  const list = document.createElement("div");
  list.style.cssText =
    "position: fixed; top: 0; left: 0; width: 400px; height: 400px; overflow-y: auto";
  const rows = document.createElement("div");
  rows.style.height = "2000px";
  list.append(rows);
  document.body.append(list);
  list.scrollTop = 1000;
  await renderInBrowser(
    <Target
      target={{
        landingAt: () => undefined,
        rect: () => ({ height: 400, left: 0, top: 0, width: 400 }),
        scrolls: { axis: "y", element: () => list },
      }}
    />,
  );
  return list;
};

it("scrolls a list held near its top, easing in from the first frame there", async () => {
  const list = await scrollingList();
  pressTab();
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      buttons: 1,
      clientX: AT.x,
      clientY: 4,
      isPrimary: true,
    }),
  );
  await frames(30);

  expect(list.scrollTop).toBeLessThan(1000);
});
