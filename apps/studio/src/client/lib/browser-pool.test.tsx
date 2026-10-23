import { browserTargetOf, StoreId } from "@instrument-org/workspace/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getAttachedTargetsSnapshot,
  getGuest,
  initBrowserPool,
  setPaintHost,
  showOverSlot,
} from "./browser-pool";

const target = browserTargetOf(StoreId.newSessionId());

// A stream that stays open without ever yielding, as the pool's event
// subscriptions are while nothing happens.
async function* quiet(signal?: AbortSignal) {
  await new Promise((resolve) => {
    signal?.addEventListener("abort", resolve);
  });
  yield* [];
}

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
          restoreHostFocus: stream,
          setGuestSurface: stream,
        },
        live: {
          targets: {
            call: (_input: unknown, options?: { signal?: AbortSignal }) =>
              Promise.resolve(
                (async function* () {
                  const snapshot = (asleep: boolean) => [
                    { asleep, attached: true, generation: 1, id: target },
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
        syncHostFocus: done,
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
  await vi.waitFor(() => {
    expect(element()).not.toBeNull();
  });
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
  await vi.waitFor(() => {
    expect(visibility()).toBe("hidden");
  });

  // The slot does not wait for main to wake it.
  const slot = Symbol("slot");
  showOverSlot(target, inlineBounds, slot);
  expect(visibility()).toBe("visible");

  // Parked again before main has woken it, it stays hidden until main has.
  setPaintHost(target, slot);
  expect(visibility()).toBe("hidden");
  targets.next(false);
  await vi.waitFor(() => {
    expect(visibility()).toBe("visible");
  });
});
