import { captureException } from "@/client/lib/capture-exception";
import { IDLE_LOAD, type LoadState, nextLoad } from "@/client/lib/load-stage";
import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserGuestTarget,
  type PopupEvent,
  type PopupState,
} from "@/shared/browser";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { sleep } from "radashi";

import type { GuestEventMap, GuestHandle } from "./guest-handle";

/**
 * The tabs whose page is a page's popup. A popup's page is Chromium's own,
 * kept in a view main places over the window (`adoptPopup` in manager.ts),
 * so there is no `<webview>` here: the pool hands these targets to this one,
 * which tells main where the tab's slot is and drives the page through it.
 *
 * A native view draws over everything the window draws, so while a menu, a
 * dialog or anything else of the window's own floats over the slot, the view
 * hides and a picture of the page stands in its place.
 */

interface Bounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface Claim {
  bounds: Bounds;
  clip?: Bounds;
  layer: number;
  since: number;
}

interface Popup {
  claims: Map<symbol, Claim>;
  // Where the picture stands while the view is hidden under the window's own layers.
  cover: HTMLDivElement;
  // Whether the window's own layers cover the slot, so the picture shows.
  covered: boolean;
  handle: GuestHandle;
  listeners: Map<keyof GuestEventMap, Set<(event: never) => void>>;
  load: LoadState;
  // What main was last told: where the view stands, or nowhere.
  placed: Bounds | null;
  shown: boolean;
  state: PopupState;
  targetId: BrowserTargetId;
}

const popups = new Map<BrowserTargetId, Popup>();
const popupTargets = new Set<BrowserTargetId>();
let nextClaimOrder = 0;

// Anything of the window's own that floats over the page: Radix's menus,
// popovers and selects, dialogs, and toasts.
const FLOATING_LAYERS =
  "[data-radix-popper-content-wrapper], [role=dialog], [role=alertdialog], [data-sonner-toast]";

const RECONNECT_DELAY_MS = 1000;

/** Whether a target's page is a popup, which this pool rather than the `<webview>` pool holds. */
export function isPopupTarget(targetId: BrowserTargetId): boolean {
  return popupTargets.has(targetId);
}

/** A popup's handle, once its state has come; null for any other target. */
export function getPopup(targetId: BrowserTargetId): GuestHandle | null {
  return popups.get(targetId)?.handle ?? null;
}

/** The element the popup's picture stands in, for an overlay drawing the page to count as its own. */
export function getPopupElement(targetId: BrowserTargetId): HTMLElement | null {
  return popups.get(targetId)?.cover ?? null;
}

/** Whether a slot shows the popup. */
export function isPopupShown(targetId: BrowserTargetId): boolean {
  return popups.get(targetId)?.shown === true;
}

/** Brings the pool in line with main's popup targets; `changed` fires once a handle is ready or gone. */
export function reconcilePopups(
  targets: readonly BrowserGuestTarget[],
  changed: () => void,
): void {
  const wanted = new Set(
    targets.filter((target) => target.popup).map((target) => target.id),
  );
  popupTargets.clear();
  for (const targetId of wanted) {
    popupTargets.add(targetId);
    if (!popups.has(targetId)) {
      void adopt(targetId, changed);
    }
  }
  for (const [targetId, popup] of popups) {
    if (!wanted.has(targetId)) {
      popup.cover.remove();
      popups.delete(targetId);
      changed();
    }
  }
}

async function adopt(targetId: BrowserTargetId, changed: () => void) {
  const state = await rpcClient.browser.popup.state
    .call({ targetId })
    .catch(() => {
      // A popup that closed before its state came is gone from main's
      // targets, and the next reconcile drops it here.
      return null;
    });
  if (!state || !popupTargets.has(targetId) || popups.has(targetId)) {
    return;
  }
  const cover = document.createElement("div");
  cover.dataset.popupPicture = targetId;
  Object.assign(cover.style, {
    backgroundPosition: "top left",
    backgroundRepeat: "no-repeat",
    backgroundSize: "100% auto",
    display: "none",
    pointerEvents: "none",
    position: "fixed",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(cover);
  const popup: Popup = {
    claims: new Map(),
    cover,
    covered: false,
    handle: popupHandle(targetId, () => popups.get(targetId)),
    listeners: new Map(),
    load: state.loading ? { loading: true, stage: "waiting" } : IDLE_LOAD,
    placed: null,
    shown: false,
    state,
    targetId,
  };
  popups.set(targetId, popup);
  changed();
}

/** Shows the popup over a slot, in whichever claiming slot is frontmost; see `showOverSlot`. */
export function claimPopupSlot(
  targetId: BrowserTargetId,
  owner: symbol,
  claim: Omit<Claim, "since">,
): void {
  const popup = popups.get(targetId);
  if (!popup) {
    return;
  }
  popup.claims.set(owner, {
    ...claim,
    since: popup.claims.get(owner)?.since ?? nextClaimOrder++,
  });
  place(popup);
}

/** Withdraws a slot's claim; see `setPaintHost`. */
export function withdrawPopupSlot(targetId: BrowserTargetId, owner: symbol) {
  const popup = popups.get(targetId);
  if (!popup?.claims.delete(owner)) {
    return;
  }
  place(popup);
}

function frontClaim(popup: Popup): Claim | undefined {
  let front: Claim | undefined;
  for (const claim of popup.claims.values()) {
    if (
      !front ||
      claim.layer > front.layer ||
      (claim.layer === front.layer && claim.since > front.since)
    ) {
      front = claim;
    }
  }
  return front;
}

// The part of the slot that can be seen, for a slot inside a scroller.
function visiblePart({ bounds, clip }: Claim): Bounds | null {
  if (!clip) {
    return bounds;
  }
  const x = Math.max(bounds.x, clip.x);
  const y = Math.max(bounds.y, clip.y);
  const right = Math.min(bounds.x + bounds.width, clip.x + clip.width);
  const bottom = Math.min(bounds.y + bounds.height, clip.y + clip.height);
  return right > x && bottom > y
    ? { height: bottom - y, width: right - x, x, y }
    : null;
}

function overlaps(a: DOMRect, b: Bounds) {
  return (
    a.width > 0 &&
    a.height > 0 &&
    a.left < b.x + b.width &&
    a.right > b.x &&
    a.top < b.y + b.height &&
    a.bottom > b.y
  );
}

function isCovered(bounds: Bounds) {
  return [...document.querySelectorAll(FLOATING_LAYERS)].some((layer) =>
    overlaps(layer.getBoundingClientRect(), bounds),
  );
}

function sameBounds(a: Bounds | null, b: Bounds | null) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height)
  );
}

function tellMain(popup: Popup, bounds: Bounds | null) {
  if (sameBounds(popup.placed, bounds)) {
    return;
  }
  popup.placed = bounds;
  // Where the view stands, for a run reading what main was told.
  popup.cover.dataset.placed = bounds
    ? `${bounds.x},${bounds.y},${bounds.width}x${bounds.height}`
    : "";
  toMain(
    rpcClient.browser.popup.place.call({
      bounds,
      targetId: popup.targetId,
    }),
  );
}

function reportShown(popup: Popup, shown: boolean) {
  if (popup.shown === shown) {
    return;
  }
  popup.shown = shown;
  toMain(
    rpcClient.browser.syncGuestShown.call({
      shown,
      targetId: popup.targetId,
    }),
  );
}

function place(popup: Popup) {
  const claim = frontClaim(popup);
  const bounds = claim ? visiblePart(claim) : null;
  reportShown(popup, claim !== undefined);
  if (!bounds) {
    popup.covered = false;
    popup.cover.style.display = "none";
    tellMain(popup, null);
    return;
  }
  Object.assign(popup.cover.style, {
    height: `${bounds.height}px`,
    left: `${bounds.x}px`,
    top: `${bounds.y}px`,
    width: `${bounds.width}px`,
    zIndex: String(claim?.layer ?? 0),
  } satisfies Partial<CSSStyleDeclaration>);
  const covered = isCovered(bounds);
  if (!covered) {
    popup.covered = false;
    popup.cover.style.display = "none";
    tellMain(popup, bounds);
    return;
  }
  if (popup.covered) {
    return;
  }
  popup.covered = true;
  // The picture first, then the view hides over it, so nothing blinks.
  void popup.handle.capture().then((picture) => {
    if (!popup.covered) {
      return;
    }
    if (picture) {
      popup.cover.style.backgroundImage = `url("${picture}")`;
    }
    popup.cover.style.display = "block";
    tellMain(popup, null);
  });
}

/**
 * Sends main a placement or a page action. A call fails only when the popup
 * closed under it, which the next reconcile drops, so a failure is recorded
 * and nothing is shown.
 */
function toMain(call: Promise<unknown>) {
  call.catch(captureException);
}

function emit(popup: Popup, event: PopupEvent) {
  for (const listener of popup.listeners.get(event.name) ?? []) {
    (listener as (detail: PopupEvent["detail"]) => void)(event.detail);
  }
}

function popupHandle(
  targetId: BrowserTargetId,
  current: () => Popup | undefined,
): GuestHandle {
  const act = (
    action:
      | "allowSound"
      | "back"
      | "clearHistory"
      | "devTools"
      | "forward"
      | "print"
      | "reload"
      | "reloadIgnoringCache"
      | "stop",
  ) => {
    toMain(rpcClient.browser.popup.act.call({ act: action, targetId }));
  };
  const state = () => current()?.state;
  return {
    allowSound: () => {
      act("allowSound");
    },
    canGoBack: () => state()?.canGoBack ?? false,
    canGoForward: () => state()?.canGoForward ?? false,
    capture: () =>
      rpcClient.browser.popup.capture.call({ targetId }).catch(() => {
        // No picture: the cover stays blank until the view comes back.
        return null;
      }),
    clearHistory: () => {
      act("clearHistory");
    },
    // A popup's history is its own, and stays with it.
    leaveHistory: () => Promise.resolve(),
    find: (text, options) => {
      toMain(rpcClient.browser.popup.find.call({ ...options, targetId, text }));
    },
    isLoading: () => state()?.loading ?? false,
    loadStage: () => current()?.load.stage ?? "idle",
    load: async (url) => {
      act("allowSound");
      await rpcClient.browser.popup.load.call({ targetId, url });
    },
    on: (event, listener) => {
      const popup = current();
      if (!popup) {
        return () => undefined;
      }
      const set = popup.listeners.get(event) ?? new Set();
      popup.listeners.set(event, set);
      const held = listener as (event: never) => void;
      set.add(held);
      return () => {
        set.delete(held);
      };
    },
    openDevTools: () => {
      act("devTools");
    },
    print: () => {
      act("print");
    },
    reload: ({ ignoreCache = false } = {}) => {
      act(ignoreCache ? "reloadIgnoringCache" : "reload");
    },
    run: (code) => rpcClient.browser.popup.run.call({ code, targetId }),
    // A popup's page has no preload of the app's to hear a channel.
    send: () => undefined,
    setZoom: (factor) => {
      toMain(rpcClient.browser.popup.setZoom.call({ factor, targetId }));
    },
    step: (direction) => {
      const can =
        direction === "back"
          ? (state()?.canGoBack ?? false)
          : (state()?.canGoForward ?? false);
      if (can) {
        act(direction);
      }
      return can;
    },
    stop: () => {
      act("stop");
    },
    stopFind: (action) => {
      toMain(rpcClient.browser.popup.stopFind.call({ action, targetId }));
    },
    targetId,
    title: () => state()?.title ?? "",
    url: () => state()?.url ?? "",
    get webContentsId() {
      return state()?.webContentsId ?? -1;
    },
    zoom: () => state()?.zoom ?? 1,
  };
}

function replaceAll() {
  for (const popup of popups.values()) {
    place(popup);
  }
}

/**
 * Hears what each popup's page does, and watches the window's own floating
 * layers come and go over the slots. Call once at startup, beside the
 * `<webview>` pool; returns the way to stop.
 */
export function initPopupPool(): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  // Floating layers are portalled into the body or into the zoomed tree, so
  // the whole document is watched, read once a frame at most and only while
  // a slot shows a popup.
  let frame: null | number = null;
  const observer = new MutationObserver(() => {
    if (frame !== null || ![...popups.values()].some((popup) => popup.shown)) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      replaceAll();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  async function run() {
    while (!controller.signal.aborted) {
      try {
        const subscription = await rpcClient.browser.events.popupChanged.call(
          undefined,
          { signal },
        );
        for await (const { event, state, targetId } of subscription) {
          const popup = popups.get(targetId);
          if (!popup) {
            continue;
          }
          popup.state = state;
          if (event) {
            if (event.name === "did-start-navigation") {
              popup.load = nextLoad(popup.load, {
                isInPlace: event.detail.isInPlace,
                isMainFrame: event.detail.isMainFrame,
                type: event.name,
              });
            } else if (
              event.name === "did-navigate" ||
              event.name === "did-start-loading" ||
              event.name === "did-stop-loading" ||
              event.name === "dom-ready"
            ) {
              popup.load = nextLoad(popup.load, { type: event.name });
            }
            emit(popup, event);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        captureException(error);
      }
      await sleep(RECONNECT_DELAY_MS);
    }
  }
  void run();
  return () => {
    controller.abort();
    observer.disconnect();
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
  };
}
