import { browserTargetOf, StoreId } from "@instrument-org/workspace/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getAttachedTargetsSnapshot,
  getGuest,
  giveKeyboardTo,
  holdKeyboardFromPages,
  initBrowserPool,
  setPagePanes,
  setPaintHost,
  showOverSlot,
} from "./browser-pool";
import { installKeyboardLoan } from "./keyboard-loan";

const target = browserTargetOf(StoreId.newTabId());
// A tab opened behind the one on screen, which no slot has shown.
const behind = browserTargetOf(StoreId.newTabId());

// A stream that stays open without ever yielding, as the pool's event
// subscriptions are while nothing happens.
async function* quiet(signal?: AbortSignal) {
  await new Promise((resolve) => {
    signal?.addEventListener("abort", resolve);
  });
  yield* [];
}

// Main's asks of the window, which a test sends when it needs to: the
// keyboard given back after an agent's command, and a person's press in a page.
const asks = vi.hoisted(() => {
  const feed = <T,>() => {
    let wake: ((value: T) => void) | null = null;
    return {
      send: (value: T) => {
        wake?.(value);
      },
      stream: (_input: unknown, options?: { signal?: AbortSignal }) =>
        Promise.resolve(
          (async function* () {
            while (!options?.signal?.aborted) {
              yield await new Promise<T>((resolve) => {
                wake = resolve;
              });
            }
          })(),
        ),
    };
  };
  return {
    hostFocus: { synced: 0 },
    pressed: feed<{ targetId: string }>(),
    restore: feed<null>(),
    // Whether main says a page holding the keyboard gives it back.
    returns: { value: false },
  };
});

// What main says next about the target, which a test sends when it needs to.
const targets = vi.hoisted(() => {
  const queued: boolean[] = [];
  let waiting: ((asleep: boolean) => void) | null = null;
  return {
    next: (asleep: boolean) => {
      if (waiting) {
        waiting(asleep);
        waiting = null;
      } else {
        queued.push(asleep);
      }
    },
    take: () =>
      new Promise<boolean>((resolve) => {
        const asleep = queued.shift();
        if (asleep === undefined) {
          waiting = resolve;
        } else {
          resolve(asleep);
        }
      }),
  };
});

vi.mock("@/client/lib/browser-host", () => ({ WINDOW_BROWSER_HOST: "main" }));
vi.mock("@/client/lib/capture-exception", () => ({
  captureException: vi.fn(),
}));
vi.mock("@/client/rpc/client", () => {
  const stream = {
    call: (_input: unknown, options?: { signal?: AbortSignal }) =>
      Promise.resolve(quiet(options?.signal)),
  };
  const done = { call: () => Promise.resolve() };
  return {
    rpcClient: {
      browser: {
        events: {
          focusGuest: stream,
          pagePressed: { call: asks.pressed.stream },
          restoreHostFocus: { call: asks.restore.stream },
          setGuestSurface: stream,
        },
        live: {
          targets: {
            call: (_input: unknown, options?: { signal?: AbortSignal }) =>
              Promise.resolve(
                (async function* () {
                  const snapshot = (asleep: boolean) => [
                    { asleep, attached: true, generation: 1, id: target },
                    {
                      asleep: false,
                      attached: true,
                      generation: 1,
                      id: behind,
                    },
                  ];
                  yield snapshot(false);
                  while (!options?.signal?.aborted) {
                    yield snapshot(await targets.take());
                  }
                })(),
              ),
          },
        },
        syncFocus: done,
        syncGuestShown: done,
        syncGuestSurface: done,
        returnsKeyboard: { call: () => Promise.resolve(asks.returns.value) },
        syncHostFocus: {
          call: () => {
            asks.hostFocus.synced += 1;
            return Promise.resolve();
          },
        },
        syncRasterBudget: done,
      },
    },
  };
});

/** The pool's element for the one target, as the page holds it. */
const element = () => document.querySelector("webview");

let stop: () => void;
beforeAll(async () => {
  stop = initBrowserPool();
  await vi.waitFor(
    () => {
      expect(element()).not.toBeNull();
    },
    { interval: 1 },
  );
});
afterAll(() => {
  stop();
});

const placement = () => {
  const { style } = element()?.parentElement ?? {};
  return { left: style?.left, opacity: style?.opacity, zIndex: style?.zIndex };
};

const visibility = () => element()?.parentElement?.style.visibility;

const inline = Symbol("inline pane");
const popOut = Symbol("popped-out window");
const inlineBounds = { height: 800, width: 500, x: 700, y: 80 };
const popOutBounds = { height: 740, width: 760, x: 500, y: 130 };

it("keeps the page in the frontmost slot while one beneath measures after it", () => {
  showOverSlot(target, popOutBounds, popOut, null, 41);
  showOverSlot(target, inlineBounds, inline);
  expect(placement()).toMatchInlineSnapshot(`
    {
      "left": "500px",
      "opacity": "1",
      "zIndex": "41",
    }
  `);

  // Letting go hands the page to the slot still asking for it.
  setPaintHost(target, popOut);
  expect(placement()).toMatchInlineSnapshot(`
    {
      "left": "700px",
      "opacity": "1",
      "zIndex": "0",
    }
  `);

  setPaintHost(target, inline);
  expect(placement()).toMatchInlineSnapshot(`
    {
      "left": "0px",
      "opacity": "0.001",
      "zIndex": "2147483647",
    }
  `);
});

it("marks the page's guest while a slot shows it", () => {
  showOverSlot(target, inlineBounds, inline);
  expect(element()?.hasAttribute("data-page-on-screen")).toBe(true);
  setPaintHost(target, inline);
  expect(element()?.hasAttribute("data-page-on-screen")).toBe(false);
});

describe("the keyboard after an agent's command", () => {
  const guestOf = (id: string) => {
    const guest = [...document.querySelectorAll<HTMLElement>("webview")].find(
      (each) => each.getAttribute("partition")?.includes(id) === true,
    );
    if (!guest) {
      throw new Error("no guest");
    }
    // jsdom focuses only what has a tab index; Electron's guest takes focus itself.
    guest.tabIndex = -1;
    return guest;
  };
  const settled = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

  it("leaves a page the agent's command put it in", async () => {
    const guest = guestOf(behind);
    guest.focus();
    asks.restore.send(null);
    await settled();
    expect(document.activeElement).toBe(document.body);
  });

  it("stays in a page the person pressed in", async () => {
    const guest = guestOf(target);
    asks.pressed.send({ targetId: target });
    await settled();
    guest.focus();
    asks.restore.send(null);
    await settled();
    expect(document.activeElement).toBe(guest);
    guest.blur();
  });
});

describe("a page found holding a keyboard it took from a field", () => {
  let endLoans: () => void;
  let field: HTMLInputElement;
  let left: number;
  const guest = () => {
    const found = [...document.querySelectorAll<HTMLElement>("webview")].find(
      // The tab no test before these pressed in.
      (each) => each.getAttribute("partition")?.includes(behind) === true,
    );
    if (!found) {
      throw new Error("no guest");
    }
    // jsdom focuses only what has a tab index; Electron's guest takes focus itself.
    found.tabIndex = -1;
    return found;
  };
  const taken = async () => {
    field.focus();
    left = 0;
    guest().focus();
    window.dispatchEvent(new Event("blur"));
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  };
  const waited = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  beforeEach(() => {
    endLoans = installKeyboardLoan({
      isPersonsPage: () => false,
      isShown: () => true,
    });
    field = document.createElement("input");
    field.addEventListener("blur", () => {
      left += 1;
    });
    document.body.append(field);
    asks.hostFocus.synced = 0;
  });
  afterEach(() => {
    endLoans();
    field.remove();
    guest().blur();
  });

  it("is left alone while main says an agent's command gives it back", async () => {
    asks.returns.value = true;
    await taken();
    await waited();
    expect(document.activeElement).toBe(guest());
    expect(left).toBe(0);
  });

  it("gives it back to the field with no press of the person's, and tells main the window has it", async () => {
    asks.returns.value = false;
    await taken();
    await waited();
    expect(document.activeElement).toBe(field);
    expect(left).toBe(0);
    expect(asks.hostFocus.synced).toBeGreaterThan(0);
  });

  it("keeps it after a press of the person's, and the field hears", async () => {
    asks.returns.value = false;
    await taken();
    asks.pressed.send({ targetId: behind });
    await waited();
    expect(document.activeElement).toBe(guest());
    expect(left).toBe(1);
  });
});

it("gives the page to the newer of two slots on one layer, and keeps it there as the older re-measures", () => {
  const older = Symbol("older");
  const newer = Symbol("newer");
  showOverSlot(target, inlineBounds, older);
  showOverSlot(target, popOutBounds, newer);
  showOverSlot(target, inlineBounds, older);
  expect(placement().left).toMatchInlineSnapshot(`"500px"`);

  // The older slot parking does not take the page from the newer.
  setPaintHost(target, older);
  expect(placement().left).toMatchInlineSnapshot(`"500px"`);
  setPaintHost(target, newer);
});

describe("a page in full screen", () => {
  // jsdom has no Fullscreen API; Electron makes the `<webview>` this
  // document's full-screen element while its page is in full screen.
  let fullScreenElement: Element | null = null;
  const exitFullscreen = vi.fn(() => {
    fullScreenElement = null;
    return Promise.resolve();
  });
  beforeAll(() => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullScreenElement,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
  });
  afterEach(() => {
    fullScreenElement = null;
    exitFullscreen.mockClear();
  });

  const enterFullScreen = () => {
    fullScreenElement = element();
    document.dispatchEvent(new Event("fullscreenchange"));
  };

  it("stays in full screen while a slot shows it, and leaves once the last one lets go", () => {
    showOverSlot(target, popOutBounds, popOut, null, 41);
    showOverSlot(target, inlineBounds, inline);
    enterFullScreen();
    expect(exitFullscreen).not.toHaveBeenCalled();

    setPaintHost(target, popOut);
    expect(exitFullscreen).not.toHaveBeenCalled();

    setPaintHost(target, inline);
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("leaves at once when nothing shows it", () => {
    enterFullScreen();
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("leaves another element's full screen alone", () => {
    showOverSlot(target, inlineBounds, inline);
    fullScreenElement = document.body;
    setPaintHost(target, inline);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });
});

// Runs last: it brings the guest to dom-ready, which the placement cases
// above do not need.
it("hands out the guest only once it is ready, and never throws for one gone", () => {
  const webview = element();
  if (!webview) {
    throw new Error("no guest mounted");
  }
  expect(getGuest(target)).toBeNull();
  expect(getAttachedTargetsSnapshot().has(target)).toBe(false);

  let attached = true;
  const notAttached = () => {
    if (!attached) {
      throw new Error("The WebView must be attached to the DOM");
    }
  };
  const goBack = vi.fn();
  Object.assign(webview, {
    canGoBack: () => {
      notAttached();
      return true;
    },
    getURL: () => {
      notAttached();
      return "https://example.com/";
    },
    getWebContentsId: () => 7,
    goBack,
    reload: notAttached,
  });
  webview.dispatchEvent(new Event("dom-ready"));

  const guest = getGuest(target);
  expect(guest?.webContentsId).toBe(7);
  expect(getAttachedTargetsSnapshot().has(target)).toBe(true);
  expect(guest?.url()).toBe("https://example.com/");
  expect(guest?.step("back")).toBe(true);
  expect(goBack).toHaveBeenCalledOnce();

  attached = false;
  expect(guest?.url()).toBe("");
  expect(guest?.step("back")).toBe(false);
  expect(() => guest?.reload()).not.toThrow();
});

it("hides a parked page while main has it asleep, and shows it in a slot at once", async () => {
  expect(visibility()).toBe("visible");

  targets.next(true);
  await vi.waitFor(
    () => {
      expect(visibility()).toBe("hidden");
    },
    { interval: 1 },
  );

  // The slot does not wait for main to wake it.
  const slot = Symbol("slot");
  showOverSlot(target, inlineBounds, slot);
  expect(visibility()).toBe("visible");

  // Parked again before main has woken it, it stays hidden until main has.
  setPaintHost(target, slot);
  expect(visibility()).toBe("hidden");
  targets.next(false);
  await vi.waitFor(
    () => {
      expect(visibility()).toBe("visible");
    },
    { interval: 1 },
  );
});

it("holds a page off the keyboard until let go, then hands it over, however long the hold", async () => {
  const webview = element();
  if (!webview) {
    throw new Error("no guest mounted");
  }
  const slot = Symbol("slot");
  showOverSlot(target, inlineBounds, slot);
  await Promise.resolve();
  // jsdom's element is a plain one, so the pool's focus is HTMLElement's.
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const letGoOfPress = holdKeyboardFromPages();
    giveKeyboardTo(target);
    const letGoOfDrag = holdKeyboardFromPages();
    letGoOfPress();
    vi.setSystemTime(Date.now() + 60_000);
    expect(focus.mock.contexts).toEqual([]);

    letGoOfDrag();
    expect(focus.mock.contexts).toEqual([webview]);
    letGoOfDrag();
    expect(focus.mock.contexts).toEqual([webview]);
  } finally {
    vi.useRealTimers();
    focus.mockRestore();
    setPaintHost(target, slot);
  }
});

it("lays out a page no slot has shown at the size the pane shows pages at", async () => {
  const container = () =>
    document.querySelectorAll("webview")[1]?.parentElement?.style;
  const pane = Symbol("pane");
  showOverSlot(target, { height: 600, width: 900, x: 0, y: 40 }, pane);
  await vi.waitFor(
    () => {
      expect(container()?.width).toBe("900px");
    },
    { interval: 5 },
  );
  expect(container()?.height).toBe("600px");

  // A host above the pane leaves it be.
  const draft = Symbol("draft window");
  showOverSlot(target, popOutBounds, draft, null, 41);
  setPaintHost(target, draft);
  setPaintHost(target, pane);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(container()?.width).toBe("900px");
});

it("lays out a page behind at its own side's size, beside a side of another width", async () => {
  const width = (index: number) =>
    document.querySelectorAll("webview")[index]?.parentElement?.style.width;
  setPagePanes(
    new Map([
      [target, "group:0"],
      [behind, "group:1"],
    ]),
  );
  const left = Symbol("left side");
  const right = Symbol("right side");
  showOverSlot(behind, { height: 600, width: 400, x: 900, y: 40 }, right);
  setPaintHost(behind, right);
  showOverSlot(target, { height: 600, width: 880, x: 0, y: 40 }, left);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(width(0)).toBe("880px");
  expect(width(1)).toBe("400px");
  setPaintHost(target, left);
  setPagePanes(new Map());
});
