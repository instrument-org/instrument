import {
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import {
  getAttachedTargetsSnapshot,
  getGuest,
  initBrowserPool,
  setPaintHost,
  showOverSlot,
} from "./browser-pool";

const target = encodeBrowserTargetId(
  TaskIdSchema.parse("instrument"),
  StoreId.newSessionId(),
);

// A stream that stays open without ever yielding, as the pool's event
// subscriptions are while nothing happens.
async function* quiet(signal?: AbortSignal) {
  await new Promise((resolve) => {
    signal?.addEventListener("abort", resolve);
  });
  yield* [];
}

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
                  yield [
                    { attached: true, generation: 1, host: "main", id: target },
                  ];
                  yield* quiet(options?.signal);
                })(),
              ),
          },
        },
        syncFocus: done,
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
