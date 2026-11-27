import { captureException } from "@/client/lib/capture-exception";
import { returnKeyboardFromAgent } from "@/client/lib/keyboard-home";
import { onKeyboardLentToPage } from "@/client/lib/keyboard-loan";
import {
  isPageOnSideWithoutKeyboard,
  PAGE_ON_SCREEN,
} from "@/client/lib/keyboard-place";
import {
  askAfterKeyboard,
  callOffKeyboardSends,
  focusGuest,
  forgetPageKeyboard,
  handKeyboardBackFromParked,
  keepKeyboardOnItsSide,
  onHostBlur,
  pagePressed,
  passKeyboardTo,
  recordHostFocus,
  releaseGuestFocus,
  setPagePool,
  takeKeyboardOnArrival,
} from "@/client/lib/page-keyboard";
import {
  IDLE_LOAD,
  type LoadEvent,
  type LoadStage,
  type LoadState,
  nextLoad,
} from "@/client/lib/load-stage";
import { rpcClient } from "@/client/rpc/client";
import {
  BROWSER_GUEST_VIEWPORT,
  BROWSER_ZOOM_MAX,
  BROWSER_ZOOM_MIN,
  type BrowserGuestTarget,
  browserPartition,
} from "@/shared/browser";
import {
  PAGE_EDGE_CHANNEL,
  PAGE_LAYER_CHANNEL,
  PAGE_REMOTE_CHANNEL,
  PAGE_THUMB_CHANNEL,
  type PageRemoteMessage,
} from "@/shared/page-editor-channels";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { sleep } from "radashi";

// Backoff before re-establishing a dropped desired-targets stream so a hard
// transport failure doesn't spin.
const RECONNECT_DELAY_MS = 500;

// A guest is a remote frame, and Blink rasterizes one only within its
// compositing rect: this document's viewport, outset by 15% of that viewport on
// each side to cover scrolling, then clamped to the frame's own size
// (`RemoteFrameView::ComputeCompositingRect`). So a guest laid out beyond
// `innerWidth`/`innerHeight` x 1.3 is painted only that far, while it and
// `Page.getLayoutMetrics` both keep reporting the size it was laid out at --
// nothing downstream can tell a cropped frame from a whole one. The exact bound
// is `v + 2 * ceil(0.15 * v)`, never below `1.3v`, so flooring the product stays
// under it and absorbs device-pixel rounding as well. The viewport it follows is
// this window's, not the OS window's, which is why `innerWidth` is the input.
// See docs/findings/browser-guest-raster-cap.md.
const GUEST_RASTER_BUDGET = 1.3;

/**
 * Renderer-owned pool of browser `<webview>` guests. The main process owns
 * which targets should exist and streams that desired set over
 * `browser.live.targets`; this pool reconciles to it (mount on add, dispose
 * on remove). Each guest is appended to `document.body` and kept there for its
 * lifetime so React reconciliation / a host subtree being hidden never unmounts
 * it (which would drop its compositor surface and break capture + input).
 *
 * Two visibility modes:
 *  - paint-host: laid out at the guest's logical size but visually hidden
 *    (`opacity: 0.001`), used whenever nothing is showing the guest. Chromium
 *    still paints it on-screen, so `wc.capturePage()` capture and CDP input keep
 *    working headlessly (capture needs the guest composited into the window,
 *    which is why we can't truly hide it; a covered or minimized window is made
 *    to draw by the main process's `whileEmbedderComposites`). A guest main
 *    has put to sleep is parked with `visibility: hidden` instead, drawing
 *    nothing until a command or a slot wakes it (`guest-sleep.ts`).
 *  - visible: positioned over a host slot (e.g. the task page's browser panel,
 *    measured by that component) and scaled to fit, with input enabled.
 *
 * A host shows its guest only while its own surface is on screen (a task's
 * browser panel while its tab is the foreground tab, see use-active-tab) and
 * parks it otherwise; hosts on screen together each show their own, stacked
 * by the `layer` they hand showOverSlot. The main process owns guest existence
 * via the desired-targets stream; the host slot only toggles paint-host vs
 * visible. Hiding/closing the slot never disposes a guest.
 */

interface Bounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface PooledWebview {
  // Whether main put the guest to sleep, which hides it while parked so it
  // draws nothing. A slot showing it wakes it.
  asleep: boolean;
  container: HTMLDivElement;
  // A size the agent asked this guest to lay out at, which outranks the size
  // it parks at otherwise (see `lastVisibleBounds`). Null for a guest nobody
  // has asked about.
  desiredSurface: null | { height: number; width: number };
  // Generation of the entry this guest was mounted for. A destroy+recreate of
  // the same targetId bumps it, so reconcile knows to dispose this guest and
  // mount a fresh one rather than reusing an element bound to a dead entry.
  generation: number;
  // Whether main was last told a slot shows this guest. Main's record of a
  // new guest starts parked, as this does.
  /** Nothing yet: a guest handed over from another window starts out counted as shown. */
  lastReportedShown: boolean | undefined;
  // Last size reported to main, so a park/show cycle that lands on the same
  // number doesn't re-send it.
  lastReportedSurface: null | { height: number; width: number };
  // The guest as everything outside the pool drives it, from the element's
  // dom-ready on: before it, every one of the element's methods throws.
  handle: GuestHandle | null;
  // Last size the guest was shown at, which it keeps while parked when that
  // was in a host above the pane (a draft window), since it is shown there
  // again; a guest last shown in the pane, or never shown, parks at its
  // pane's size (`paneSizeOf`).
  lastVisibleBounds: Bounds | null;
  shownAbovePane: boolean;
  targetId: BrowserTargetId;
  webview: WebviewElement;
}

/** Each guest's `LoadStage`, kept from its first event on. */
const loadStages = new WeakMap<WebviewElement, LoadStage>();

import { type GuestEventMap, type GuestHandle } from "./guest-handle";
import {
  claimPopupSlot,
  getPopup,
  getPopupElement,
  initPopupPool,
  isPopupShown,
  isPopupTarget,
  reconcilePopups,
  withdrawPopupSlot,
} from "./popup-pool";

export type { GuestEventMap, GuestHandle };
export { pageOfPress } from "@/client/lib/page-keyboard";

// Subset of Electron's `<webview>` tag API the pool drives. Only the pool
// holds the element; everything else reaches the guest through its
// GuestHandle.
interface WebviewElement extends HTMLElement {
  canGoBack(): boolean;
  canGoForward(): boolean;
  /** The page as it looks now, for a surface that holds a picture of it over a reload. */
  capturePage(): Promise<{ toDataURL: () => string }>;
  /** Forgets every entry but the one the guest is at. */
  clearHistory(): void;
  executeJavaScript(code: string): Promise<unknown>;
  findInPage(
    text: string,
    options?: { findNext?: boolean; forward?: boolean },
  ): number;
  getTitle(): string;
  getURL(): string;
  getWebContentsId(): number;
  getZoomFactor(): number;
  goBack(): void;
  goForward(): void;
  isLoading(): boolean;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
  print(): Promise<void>;
  reload(): void;
  reloadIgnoringCache(): void;
  /** A message to the guest's preload, on a channel it listens on. */
  send(channel: string, ...args: unknown[]): void;
  setAudioMuted(muted: boolean): void;
  setZoomFactor(factor: number): void;
  stop(): void;
  stopFindInPage(
    action: "activateSelection" | "clearSelection" | "keepSelection",
  ): void;
}

const { height: VIEW_H, width: VIEW_W } = BROWSER_GUEST_VIEWPORT;

// Round the visible guest's bottom corners to match the browser panel's
// rounded-xl frame (inner radius, inside the 1px border). Whether Chromium
// actually clips the `<webview>` guest to this radius is build-dependent; the
// container also sets overflow:hidden to give it the best chance.
const VISIBLE_BOTTOM_RADIUS = "0.6875rem";

const pool = new Map<BrowserTargetId, PooledWebview>();

// The size the window's pane last showed a page at, which a parked guest is
// laid out at, so a page opened behind the one on screen, or put away while
// the pane resized, is already that size when its tab comes up rather than
// relaying out from another one in front of the person.
let paneSize: null | { height: number; width: number } = null;

// The size each pane last showed a page at, by the pane its tab stands in (a
// side of a tab group, two of which stand side by side at widths of their
// own), and the pane each page's tab stands in, as `setPagePanes` was last
// told. A page whose pane has shown nothing yet parks at `paneSize`.
const paneSizes = new Map<string, { height: number; width: number }>();
let pagePanes: ReadonlyMap<BrowserTargetId, string> = new Map();

// How long the pane's size holds before parked guests follow it, so dragging
// a window edge does not relayout every page behind the one on screen at
// each frame.
const PANE_SETTLE_MS = 150;
let paneSettle: ReturnType<typeof setTimeout> | undefined;

/**
 * The color a page paints behind its content: its root's or its body's
 * background, or, where both show through, the canvas its color scheme
 * gives it (Chromium's own white, or its dark #121212). Read without
 * touching the page's document.
 */
const PAGE_BACKDROP_SCRIPT = `(() => {
  for (const element of [document.documentElement, document.body]) {
    const color = element ? getComputedStyle(element).backgroundColor : "";
    if (color && color !== "transparent" && !/^rgba\\(.*,\\s*0\\)$/.test(color)) {
      return color;
    }
  }
  const scheme = document.documentElement ? getComputedStyle(document.documentElement).colorScheme : "";
  const dark = /\\bdark\\b/.test(scheme) && (!/\\blight\\b/.test(scheme) || matchMedia("(prefers-color-scheme: dark)").matches);
  return dark ? "rgb(18, 18, 18)" : "rgb(255, 255, 255)";
})()`;

// The slot currently showing each guest.
const paintOwners = new Map<BrowserTargetId, symbol>();

setPagePool({
  count: () => pool.size,
  guestOf: (targetId) => pool.get(targetId)?.webview,
  guests: () =>
    [...pool].map(([targetId, pooled]) => [targetId, pooled.webview]),
  isShownInSlot: (targetId) => paintOwners.has(targetId),
  readyGuestOf: (targetId) => {
    const pooled = pool.get(targetId);
    return pooled?.handle ? pooled.webview : undefined;
  },
});

interface SlotClaim {
  bottomRadius: string;
  bounds: Bounds;
  /** The part of the window the slot is seen through, which the guest is cut to. */
  clip?: Bounds;
  layer: number;
  /** The width a page an agent opened first lays out at, when this slot is narrower (see showOverSlot). */
  layoutWidth?: number;
  renderedSize: null | undefined | { height: number; width: number };
  // Order the slot first asked in, which breaks a tie between two slots on one
  // layer in favor of the newer; re-measuring keeps a slot's place.
  since: number;
}

// Every slot asking to show each guest, by the slot. Several can be on screen
// for one page at once (a chat inline in the pane and grown in a window over
// it, the task open in two tabs), and the guest can stand in only one: the
// frontmost slot has it, the newer on a tie, and when that slot lets go it
// passes to the next still asking. Without the record, whichever slot measured
// last would take the page, and a slot under a window could pull it out from
// under the window that draws it.
const slotClaims = new Map<BrowserTargetId, Map<symbol, SlotClaim>>();
let nextClaimOrder = 0;

// Agent-requested guest sizes, kept beside the pool rather than only on the
// pooled entry: main replays them when this stream subscribes, which can happen
// before the target's guest has mounted, and a recreated guest should come back
// at the size the model last asked for.
const desiredSurfaces = new Map<
  BrowserTargetId,
  { height: number; width: number }
>();

// The zoom an agent's page was given so it lays out at a width the side is
// too narrow for: the desktop width a page the agent opened starts at, or the
// width the agent asked for with a viewport request while the page was shown.
// It holds across the tab's navigations until the person zooms the page
// themselves, which takes it out of here, and is what the address field's
// zoom chip tells apart from the person's own zoom.
const agentZooms = new Map<BrowserTargetId, number>();

// A layout width waiting to become a zoom: worked out once, against the
// slot's width, the next time a slot shows the guest and it is ready to drive.
const pendingLayouts = new Map<BrowserTargetId, number>();

// Targets a slot has shown, so the desktop width a page the agent opened starts
// at is decided once, by the first slot that shows it.
const shownOnce = new Set<BrowserTargetId>();

// The narrowest zoom an agent's page starts at. Under it the text is too small
// to read, and the page lays out narrower than desktop instead.
const AGENT_PAGE_MIN_ZOOM = 0.5;

// Ids of targets whose guest has attached, mirrored from the desired-targets
// stream so the UI can show the live guest vs a placeholder without a second
// polled endpoint, and whose element here is ready to drive (see
// publishAttached).
let attachedFromMain: ReadonlySet<BrowserTargetId> = new Set();
let attachedTargets: ReadonlySet<BrowserTargetId> = new Set();
const targetListeners = new Set<() => void>();

export function getAttachedTargetsSnapshot(): ReadonlySet<BrowserTargetId> {
  return attachedTargets;
}

/** Which mounting of a target's guest the pool holds; a recreated guest has a new one. */
export function getGuestGeneration(
  targetId: BrowserTargetId,
): number | undefined {
  return pool.get(targetId)?.generation;
}

/**
 * Who walks each page's tab when a step is asked of the page (a thumb button
 * over it, a history chord in it, its menu's Back or Forward, its panel's
 * arrows), by the page's target.
 */
const thumbHandlers = new Map<
  BrowserTargetId,
  (direction: "back" | "forward") => void
>();

/**
 * Guests the window stepped through their own history, by target, until the
 * navigation the step makes is seen: a step is not a page going somewhere
 * new, and does not drop what its tab had ahead of it.
 */
const traversals = new Set<BrowserTargetId>();

/**
 * Steps a guest through its own history, marked as a step for whoever hears
 * the navigation it makes. False when the guest has nowhere to go that way
 * or is not ready.
 */
export function goGuest(
  targetId: BrowserTargetId,
  direction: "back" | "forward",
): boolean {
  const guest = getGuest(targetId);
  if (
    !guest ||
    !(direction === "back" ? guest.canGoBack() : guest.canGoForward())
  ) {
    return false;
  }
  traversals.add(targetId);
  if (guest.step(direction)) {
    return true;
  }
  traversals.delete(targetId);
  return false;
}

/** Whether a step `goGuest` made has yet to land. */
export function hasGuestTraversal(targetId: BrowserTargetId): boolean {
  return traversals.has(targetId);
}

/** Whether the guest's latest navigation was a step `goGuest` made, which this answers once. */
export function takeGuestTraversal(targetId: BrowserTargetId): boolean {
  return traversals.delete(targetId);
}

/** A target's guest, once it is ready to be driven; null until then and once it is gone. */
export function getGuest(targetId: BrowserTargetId): GuestHandle | null {
  return pool.get(targetId)?.handle ?? getPopup(targetId);
}

/**
 * The element a target's guest stands in on the body, for an overlay drawing
 * the page to count as its own; null until the guest is mounted and once it
 * is gone.
 */
export function getGuestElement(targetId: BrowserTargetId): HTMLElement | null {
  return pool.get(targetId)?.container ?? getPopupElement(targetId);
}

/**
 * Subscribe to the main process's desired-targets stream and reconcile the pool
 * to it. Call once at startup; returns an unsubscribe function. This is the pool's
 * only lifeline, so it must survive a dropped stream: if the subscription errors
 * (transport reset, main-process RPC restart) it reconnects after a short backoff
 * rather than silently freezing every future mount/dispose. Resubscribing always
 * receives the current set, so no guest is stranded across the gap.
 */
export function initBrowserPool(): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  document.addEventListener("focusin", recordHostFocus);
  document.addEventListener("pointerdown", callOffKeyboardSends, true);
  document.addEventListener("fullscreenchange", onFullScreenChange);
  window.addEventListener("resize", onWindowResize);

  async function run() {
    while (true) {
      if (signal.aborted) {
        return;
      }
      try {
        const subscription = await rpcClient.browser.live.targets.call(
          undefined,
          { signal },
        );
        for await (const targets of subscription) {
          reconcile(targets);
        }
      } catch (error) {
        // Read through `controller` so control-flow analysis doesn't narrow the
        // loop-top guard's `signal.aborted` to a constant false here: abort can
        // flip it across the await, which is exactly the teardown case.
        if (controller.signal.aborted) {
          return;
        }
        captureException(error);
      }
      await sleep(RECONNECT_DELAY_MS);
    }
  }

  async function runFocusRestores() {
    while (true) {
      if (signal.aborted) {
        return;
      }
      try {
        const subscription =
          await rpcClient.browser.events.restoreHostFocus.call(undefined, {
            signal,
          });
        for await (const _ of subscription) {
          returnKeyboardFromAgent();
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

  async function runPagePresses() {
    while (true) {
      if (signal.aborted) {
        return;
      }
      try {
        const subscription = await rpcClient.browser.events.pagePressed.call(
          undefined,
          { signal },
        );
        for await (const { targetId } of subscription) {
          pagePressed(targetId);
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

  async function runGuestFocusRequests() {
    while (true) {
      if (signal.aborted) {
        return;
      }
      try {
        const subscription = await rpcClient.browser.events.focusGuest.call(
          undefined,
          { signal },
        );
        for await (const { targetId } of subscription) {
          focusGuest(targetId);
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

  async function runPageSteps() {
    while (true) {
      if (signal.aborted) {
        return;
      }
      try {
        const subscription = await rpcClient.browser.events.stepPage.call(
          undefined,
          { signal },
        );
        for await (const { direction, targetId } of subscription) {
          stepPage(targetId, direction);
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

  async function runGuestSurfaces() {
    while (true) {
      if (signal.aborted) {
        return;
      }
      try {
        const subscription =
          await rpcClient.browser.events.setGuestSurface.call(undefined, {
            signal,
          });
        for await (const { size, targetId } of subscription) {
          applyDesiredSurface(targetId, size);
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

  // Report before subscribing to anything: main refuses an agent's viewport
  // request until it knows what this window can render.
  reportRasterBudget();

  void run();
  void runFocusRestores();
  void runGuestFocusRequests();
  void runPagePresses();
  window.addEventListener("blur", onHostBlur, { signal });
  const stopAskingAfterKeyboard = onKeyboardLentToPage(askAfterKeyboard);
  void runGuestSurfaces();
  void runPageSteps();
  const stopPopups = initPopupPool();

  return () => {
    controller.abort();
    stopPopups();
    stopAskingAfterKeyboard();
    document.removeEventListener("focusin", recordHostFocus);
    document.removeEventListener("pointerdown", callOffKeyboardSends, true);
    document.removeEventListener("fullscreenchange", onFullScreenChange);
    window.removeEventListener("resize", onWindowResize);
  };
}

const shownPageLoadedListeners = new Set<() => void>();

/** Calls `listener` each time a page a slot shows finishes loading. */
export function onShownPageLoaded(listener: () => void) {
  shownPageLoadedListeners.add(listener);
  return () => {
    shownPageLoadedListeners.delete(listener);
  };
}

/**
 * A step for one page: the surface showing it walks its tab, which runs out
 * into the tab's own history at either end; with none, the page steps its
 * own history, as a browser would.
 */
export function stepPage(
  targetId: BrowserTargetId,
  direction: "back" | "forward",
) {
  const handler = thumbHandlers.get(targetId);
  if (handler) {
    handler(direction);
    return;
  }
  goGuest(targetId, direction);
}

/**
 * Takes the thumb buttons pressed over one page, and the history chords
 * pressed in it, for the surface showing it, until the returned function lets
 * them go. The latest surface to ask has
 * them, since it is the one drawing the page.
 */
export function onPageThumb(
  targetId: BrowserTargetId,
  handler: (direction: "back" | "forward") => void,
): () => void {
  thumbHandlers.set(targetId, handler);
  return () => {
    if (thumbHandlers.get(targetId) === handler) {
      thumbHandlers.delete(targetId);
    }
  };
}

type PageEdge = "down" | "escape" | "up";

/**
 * Who hears the keys each page had no use for (see `PAGE_EDGE_CHANNEL`), by
 * the page's target.
 */
const edgeHandlers = new Map<BrowserTargetId, (edge: PageEdge) => void>();

/** Pages with something of their own open over them that Escape closes (see `PAGE_LAYER_CHANNEL`). */
const layeredPages = new Set<BrowserTargetId>();

/** Whether the page has something of its own open over it that Escape closes. */
export function pageHasLayer(targetId: BrowserTargetId) {
  return layeredPages.has(targetId);
}

/** Drives a local page while the keyboard stays beside it; see `PAGE_REMOTE_CHANNEL`. */
export function drivePage(
  targetId: BrowserTargetId,
  message: PageRemoteMessage,
) {
  getGuest(targetId)?.send(PAGE_REMOTE_CHANNEL, message);
}

/**
 * Takes the keys one page had no use for, until the returned function lets
 * them go. The latest surface to ask has them.
 */
export function onPageEdge(
  targetId: BrowserTargetId,
  handler: (edge: PageEdge) => void,
): () => void {
  edgeHandlers.set(targetId, handler);
  return () => {
    if (edgeHandlers.get(targetId) === handler) {
      edgeHandlers.delete(targetId);
    }
  };
}

/**
 * Withdraw a slot's claim on the guest. The guest passes to the frontmost slot
 * still asking for it, or parks in paint-host (laid out + painted, but not
 * shown) when none is, so a backgrounded panel can't hide the guest another
 * panel is showing.
 */
export function setPaintHost(targetId: BrowserTargetId, owner: symbol) {
  if (isPopupTarget(targetId)) {
    withdrawPopupSlot(targetId, owner);
    return;
  }
  const claims = slotClaims.get(targetId);
  claims?.delete(owner);
  if (claims?.size === 0) {
    slotClaims.delete(targetId);
  }
  placeGuest(targetId);
}

/**
 * Show the guest over a host slot, sized to the slot's measured bounds so it
 * fills dynamically (no letterbox). Resizing/moving a painted guest keeps it
 * alive, so this can fire freely on every resize. No-ops if the guest doesn't
 * exist (the main process owns creation via the desired-targets stream).
 * Records `owner`'s claim on the guest, which holds until setPaintHost
 * withdraws it; the guest stands in whichever claiming slot is frontmost.
 *
 * `renderedSize`, when given, shrinks and centers the webview element within
 * `bounds` to that size instead of filling it -- purely a visual/compositing
 * crop, used for the panel's device-preview menu so a device narrower or
 * shorter than the panel doesn't just flush its rendered content into a
 * corner. The guest's actual emulated layout (what the page inside thinks
 * its viewport is) is set separately via `rpcClient.browser.setEmulatedDevice`
 * (CDP, main-process side): Electron does not reliably re-layout an
 * already-loaded guest just because its host element was resized, so that
 * concern and this one are deliberately independent -- see device-emulation.ts.
 */
export function showOverSlot(
  targetId: BrowserTargetId,
  bounds: Bounds,
  owner: symbol,
  renderedSize?: null | { height: number; width: number },
  // Where the shown guest stands among the window's own layers. Zero by
  // default, which puts it over the page's ordinary content and under every
  // floating layer; a host that itself floats (a draft window) names a layer
  // above its own, since a guest under an opaque host is a page nobody sees.
  layer = 0,
  // The radius of the host's bottom corners, which the guest is clipped to so
  // it does not stand square past a rounder frame or round inside a square one:
  // one length for both, or two, the bottom left's and then the bottom right's.
  bottomRadius = VISIBLE_BOTTOM_RADIUS,
  // The part of the window the slot can be seen through, for a slot inside a
  // scroller: the guest is cut to it, since a guest on the body is no child
  // of the scroller to be clipped by it.
  clip?: Bounds,
  // The width a page an agent opened lays out at when this slot is the first
  // to show it and is narrower: the page is zoomed out once, so it lays out at
  // that width and fits the slot, and keeps that zoom wherever it goes after.
  layoutWidth?: number,
) {
  if (isPopupTarget(targetId)) {
    claimPopupSlot(targetId, owner, {
      bounds,
      ...(clip === undefined ? {} : { clip }),
      layer,
    });
    return;
  }
  if (!pool.has(targetId)) {
    return;
  }
  const claims = slotClaims.get(targetId) ?? new Map<symbol, SlotClaim>();
  slotClaims.set(targetId, claims);
  claims.set(owner, {
    bottomRadius,
    bounds,
    ...(clip === undefined ? {} : { clip }),
    layer,
    ...(layoutWidth === undefined ? {} : { layoutWidth }),
    renderedSize,
    since: claims.get(owner)?.since ?? nextClaimOrder++,
  });
  placeGuest(targetId);
}

const shownListeners = new Set<() => void>();

function notifyShown() {
  for (const listener of shownListeners) {
    listener();
  }
}

/**
 * Whether a slot shows the guest: in a group that is up, in a pane on
 * screen. Live work for a page (a watch on its file) hangs off this, so a
 * page out of sight costs nothing until it is shown again.
 */
export function isGuestShown(targetId: BrowserTargetId): boolean {
  return (
    pool.get(targetId)?.lastReportedShown === true || isPopupShown(targetId)
  );
}

/** useSyncExternalStore glue for {@link isGuestShown}. */
export function subscribeGuestShown(listener: () => void): () => void {
  shownListeners.add(listener);
  return () => {
    shownListeners.delete(listener);
  };
}

/** useSyncExternalStore glue for {@link attachedTargets} (see use-browser-targets). */
export function subscribeAttachedTargets(listener: () => void): () => void {
  targetListeners.add(listener);
  return () => {
    targetListeners.delete(listener);
  };
}

// Record a size the agent asked for. A parked guest is put at it, at its own
// size. A guest a slot shows keeps the slot's bounds, since the user is looking
// at it, and lays out at the width asked for by zooming to fit the slot, which
// it also does the next time a slot shows a guest asked about while parked.
function applyDesiredSurface(
  targetId: BrowserTargetId,
  size: null | { height: number; width: number },
) {
  if (size) {
    desiredSurfaces.set(targetId, size);
    pendingLayouts.set(targetId, size.width);
  } else {
    desiredSurfaces.delete(targetId);
    pendingLayouts.delete(targetId);
  }

  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
  pooled.desiredSurface = size;
  if (paintOwners.has(targetId)) {
    placeGuest(targetId);
    return;
  }
  // At its own size a parked guest lays out at the size asked for only unzoomed.
  if (size && agentZooms.has(targetId)) {
    setAgentZoom(pooled, 1);
  }
  applyPaintHost(pooled);
}

// Zoom a guest for the agent's side, as the address field's chip shows it.
// Main zooms it, keeping the zoom to this guest: a page's zoom is otherwise
// its site's, and would reach the person's own tabs on the same site.
function setAgentZoom(pooled: PooledWebview, factor: number) {
  if (factor === 1) {
    agentZooms.delete(pooled.targetId);
  } else {
    agentZooms.set(pooled.targetId, factor);
  }
  zoomAlone(pooled.targetId, factor);
  pooled.webview.dispatchEvent(new Event("zoom-set"));
  const shownAt = paintOwners.has(pooled.targetId)
    ? pooled.lastVisibleBounds
    : null;
  if (shownAt) {
    reportEffectiveSurface(pooled, layoutOf(pooled, shownAt));
  }
}

// Turn a layout width waiting for this guest into a zoom against the slot
// showing it, once the guest can be driven. A request it answers is spent, so
// parking the guest keeps the slot's size and zoom rather than the size asked.
function applyPendingLayout(pooled: PooledWebview, bounds: Bounds) {
  const { targetId } = pooled;
  const layoutWidth = pendingLayouts.get(targetId);
  if (layoutWidth === undefined || !pooled.handle) {
    return;
  }
  pendingLayouts.delete(targetId);
  desiredSurfaces.delete(targetId);
  pooled.desiredSurface = null;
  setAgentZoom(
    pooled,
    Math.min(
      BROWSER_ZOOM_MAX,
      Math.max(BROWSER_ZOOM_MIN, bounds.width / layoutWidth),
    ),
  );
}

function zoomAlone(targetId: BrowserTargetId, factor: number) {
  void rpcClient.browser.zoomGuestAlone.call({ factor, targetId });
}

/** The zoom the agent's side gave the target's page, while the person has not zoomed it themselves. */
export function agentZoomOf(targetId: BrowserTargetId): number | undefined {
  return agentZooms.get(targetId);
}

// On-screen-sized but visually hidden. NOT display:none / far-offscreen, which
// would drop the compositor surface and break CDP capture/input. Held at the
// size it will be shown at (its pane's, or a default before a pane has shown a
// page) so showing it doesn't jump, and clamped to what this window can
// actually rasterize: a guest shown in a panel is bounded by the window anyway,
// but the default is not, so in a window narrower than 985px or shorter than
// 616px it would otherwise park over the cap.
function applyPaintHost(pooled: PooledWebview) {
  const { container, desiredSurface, webview } = pooled;
  const budget = maxRasterSize();
  const requested =
    desiredSurface ??
    (pooled.shownAbovePane
      ? pooled.lastVisibleBounds
      : paneSizeOf(pooled.targetId));
  const width = Math.min(requested?.width ?? VIEW_W, budget.width);
  const height = Math.min(requested?.height ?? VIEW_H, budget.height);
  reportEffectiveSurface(pooled, layoutOf(pooled, { height, width }));

  Object.assign(container.style, {
    borderRadius: "",
    contain: "layout paint size style",
    height: `${height}px`,
    left: "0",
    opacity: "0.001",
    overflow: "hidden",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    transform: "translate3d(0, 0, 0)",
    // A sleeping guest is hidden outright, which stops it drawing; main has
    // turned its background throttling back on to go with it.
    visibility: pooled.asleep ? "hidden" : "visible",
    width: `${width}px`,
    willChange: "transform",
    zIndex: "2147483647",
  } satisfies Partial<CSSStyleDeclaration>);

  Object.assign(webview.style, {
    borderRadius: "",
    height: `${height}px`,
    left: "",
    position: "",
    top: "",
    transform: "",
    transformOrigin: "",
    width: `${width}px`,
  } satisfies Partial<CSSStyleDeclaration>);
}

function disposeWebview(targetId: BrowserTargetId) {
  forgetPageKeyboard(targetId);
  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
  pooled.container.remove();
  pool.delete(targetId);
  paintOwners.delete(targetId);
  slotClaims.delete(targetId);
  layeredPages.delete(targetId);
  agentZooms.delete(targetId);
  pendingLayouts.delete(targetId);
  shownOnce.delete(targetId);
  if (pooled.lastReportedShown === true) {
    notifyShown();
  }
}

// Guest creation happens only here, driven by `reconcile` off the main
// process's desired-targets stream. The host slot never creates a guest: it can
// only show/park one that already exists (see showOverSlot/setPaintHost), so a
// stale "active" host can't resurrect a target the main process just destroyed.
function ensureWebview(
  targetId: BrowserTargetId,
  generation: number,
): PooledWebview {
  const existing = pool.get(targetId);
  if (existing) {
    return existing;
  }

  const container = document.createElement("div");
  // `webview` is a custom element (enabled by webviewTag on the host window);
  // cast to the subset of its tag API we drive.
  const webview = document.createElement("webview") as WebviewElement;
  // The partition encodes the target id so `will-attach-webview` can route the
  // attach; main overrides the actual session there (partition is just a
  // carrier, see browserPartition).
  webview.setAttribute("partition", browserPartition(targetId));
  webview.setAttribute("src", "about:blank");
  // Permit window.open so a genuine sign-in popup reaches the main process's
  // window-open handler (which allows only real popups; see manager.ts). Without
  // this attribute Chromium blocks every `<webview>` popup before the handler
  // runs, which hangs OAuth "Continue with Google" flows.
  webview.setAttribute("allowpopups", "true");
  webview.style.border = "0";

  // Report real DOM focus/blur so the main process can target keyboard
  // commands (zoom, back/forward) at this guest. WebContents#isFocused() is
  // unreliable for `<webview>` guests, but focus/blur on the element itself
  // tracks the host document's activeElement correctly.
  webview.addEventListener("focus", () => {
    void rpcClient.browser.syncFocus.call({ focused: true, targetId });
    keepKeyboardOnItsSide(targetId);
  });
  webview.addEventListener("blur", () => {
    void rpcClient.browser.syncFocus.call({ focused: false, targetId });
  });
  // A thumb button pressed over the page, which steps it as a history chord
  // pressed in it does; and an arrow it had no use for, for whoever walks
  // what it is shown beside.
  webview.addEventListener("ipc-message", (event) => {
    // The guest's message, as Electron's `<webview>` fires it.
    const { args, channel } = event as Event & {
      args?: unknown[];
      channel?: string;
    };
    if (channel === PAGE_EDGE_CHANNEL) {
      const [edge] = args ?? [];
      if (edge === "up" || edge === "down" || edge === "escape") {
        edgeHandlers.get(targetId)?.(edge);
      }
      return;
    }
    if (channel === PAGE_LAYER_CHANNEL) {
      if (args?.[0] === true) {
        layeredPages.add(targetId);
      } else {
        layeredPages.delete(targetId);
      }
      return;
    }
    if (channel !== PAGE_THUMB_CHANNEL) {
      return;
    }
    stepPage(targetId, args?.[0] === "forward" ? "forward" : "back");
  });

  // A new document has nothing of its own open until it says so. The agent's
  // zoom is given again on each one, as a document from another site is laid
  // out at its own zoom while the guest still answers with the old one.
  webview.addEventListener("did-navigate", () => {
    layeredPages.delete(targetId);
    const zoom = agentZooms.get(targetId);
    if (zoom !== undefined) {
      zoomAlone(targetId, zoom);
    }
  });

  // A page's load to a new document (`LoadStage`), moved on by each event
  // that says something about it.
  let load: LoadState = IDLE_LOAD;
  const follow = (event: LoadEvent) => {
    load = nextLoad(load, event);
    loadStages.set(webview, load.stage);
  };
  webview.addEventListener("did-start-loading", () => {
    follow({ type: "did-start-loading" });
  });
  webview.addEventListener("did-start-navigation", (event) => {
    // The navigation's own fields, as Electron's `<webview>` fires them.
    const { isInPlace, isMainFrame } = event as Event &
      GuestEventMap["did-start-navigation"];
    follow({ isInPlace, isMainFrame, type: "did-start-navigation" });
  });
  webview.addEventListener("did-navigate", () => {
    follow({ type: "did-navigate" });
  });
  webview.addEventListener("dom-ready", () => {
    follow({ type: "dom-ready" });
  });
  webview.addEventListener("did-stop-loading", () => {
    follow({ type: "did-stop-loading" });
    if (pool.get(targetId)?.lastReportedShown === true) {
      for (const listener of shownPageLoadedListeners) {
        listener();
      }
    }
  });

  // A file's page keeps the color it paints behind itself on its element, so
  // the moment between one file's document going and the next one's first
  // paint (a folder of pages walked with the arrows) shows that color, which
  // the next page most often shares, rather than the surface behind the page.
  webview.addEventListener("did-stop-loading", () => {
    if (!webview.getURL().startsWith("file:")) {
      return;
    }
    webview
      .executeJavaScript(PAGE_BACKDROP_SCRIPT)
      .then((color) => {
        if (typeof color === "string" && color !== "") {
          webview.style.backgroundColor = color;
        }
      })
      .catch(() => {
        // A page gone, or one refusing the script, keeps the color it had.
      });
  });

  container.append(webview);
  document.body.append(container);

  const pooled: PooledWebview = {
    asleep: false,
    container,
    desiredSurface: desiredSurfaces.get(targetId) ?? null,
    generation,
    handle: null,
    lastReportedShown: undefined,
    lastReportedSurface: null,
    lastVisibleBounds: null,
    shownAbovePane: false,
    targetId,
    webview,
  };
  // The element's methods throw until its guest is dom-ready, so the guest is
  // handed out only from then on.
  webview.addEventListener(
    "dom-ready",
    () => {
      if (pool.get(targetId) === pooled) {
        pooled.handle = guestHandle(
          webview,
          targetId,
          webview.getWebContentsId(),
        );
        const zoom = agentZooms.get(targetId);
        if (zoom !== undefined) {
          zoomAlone(targetId, zoom);
        }
        if (paintOwners.has(targetId)) {
          placeGuest(targetId);
        }
        publishAttached();
        passKeyboardTo(targetId);
      }
    },
    { once: true },
  );
  pool.set(targetId, pooled);
  applyPaintHost(pooled);
  return pooled;
}

/**
 * The handle over one element. Every read and act goes through `guard`, so
 * a guest that has gone since it was handed out answers as an empty page
 * rather than throwing at whoever asked.
 */
function guestHandle(
  webview: WebviewElement,
  targetId: BrowserTargetId,
  webContentsId: number,
): GuestHandle {
  const guard = <T>(read: () => T, otherwise: T): T => {
    try {
      return read();
    } catch {
      return otherwise;
    }
  };
  let isLeaving = false;
  const allowSound = () => {
    if (document.hasFocus()) {
      guard(() => {
        webview.setAudioMuted(false);
      }, undefined);
    }
  };
  return {
    allowSound,
    canGoBack: () => !isLeaving && guard(() => webview.canGoBack(), false),
    canGoForward: () =>
      !isLeaving && guard(() => webview.canGoForward(), false),
    capture: async () => {
      try {
        return (await webview.capturePage()).toDataURL();
      } catch {
        return null;
      }
    },
    leaveHistory: async (left) => {
      isLeaving = true;
      await rpcClient.browser.keepHistory
        .call({ ...left, leaving: true, targetId })
        .catch(() => {
          guard(() => {
            webview.clearHistory();
          }, undefined);
        })
        .finally(() => {
          isLeaving = false;
          webview.dispatchEvent(new Event("history-left"));
        });
    },
    clearHistory: () => {
      guard(() => {
        webview.clearHistory();
      }, undefined);
    },
    find: (text, options) => {
      guard(() => webview.findInPage(text, options), 0);
    },
    isLoading: () => guard(() => webview.isLoading(), false),
    loadStage: () => loadStages.get(webview) ?? "idle",
    load: (url) => {
      allowSound();
      return webview.loadURL(url);
    },
    on: (event, listener) => {
      // Electron fires these as DOM events carrying its own fields, which
      // the DOM's types know nothing of; GuestEventMap names them.
      const relay = (fired: Event) => {
        listener(fired as unknown as Parameters<typeof listener>[0]);
      };
      webview.addEventListener(event, relay);
      return () => {
        webview.removeEventListener(event, relay);
      };
    },
    openDevTools: () => {
      guard(() => {
        webview.openDevTools();
      }, undefined);
    },
    print: () => {
      // Settles once the dialog closes; one dismissed rejects, which says nothing.
      guard(() => {
        void webview.print().catch(() => null);
      }, undefined);
    },
    reload: ({ ignoreCache = false } = {}) => {
      guard(() => {
        if (ignoreCache) {
          webview.reloadIgnoringCache();
        } else {
          webview.reload();
        }
      }, undefined);
    },
    run: (code) => webview.executeJavaScript(code),
    send: (channel, ...args) => {
      guard(() => {
        webview.send(channel, ...args);
      }, undefined);
    },
    setZoom: (factor) => {
      // The person's own zoom, which the agent's side never gives back.
      agentZooms.delete(targetId);
      guard(() => {
        webview.setZoomFactor(factor);
      }, undefined);
      webview.dispatchEvent(new Event("zoom-set"));
    },
    step: (direction) =>
      guard(() => {
        if (direction === "back" && webview.canGoBack()) {
          webview.goBack();
          return true;
        }
        if (direction === "forward" && webview.canGoForward()) {
          webview.goForward();
          return true;
        }
        return false;
      }, false),
    stop: () => {
      guard(() => {
        webview.stop();
      }, undefined);
    },
    stopFind: (action) => {
      guard(() => {
        webview.stopFindInPage(action);
      }, undefined);
    },
    targetId,
    title: () => guard(() => webview.getTitle(), ""),
    url: () => guard(() => webview.getURL(), ""),
    webContentsId,
    zoom: () => guard(() => webview.getZoomFactor(), 1),
  };
}

/** The largest guest, in CSS px, this window can rasterize in full. */
function maxRasterSize() {
  return {
    height: Math.floor(window.innerHeight * GUEST_RASTER_BUDGET),
    width: Math.floor(window.innerWidth * GUEST_RASTER_BUDGET),
  };
}

// The budget follows the window, so a guest parked at a size the window could
// afford stops being affordable when the window shrinks under it, and main's
// answer to the next viewport request goes stale. Only parked guests need
// re-sizing: a guest a slot is showing is re-measured against the slot, which
// the window bounds anyway.
function onWindowResize() {
  reportRasterBudget();
  parkAgain();
}

function parkAgain() {
  for (const [targetId, pooled] of pool) {
    if (!paintOwners.has(targetId)) {
      applyPaintHost(pooled);
    }
  }
}

function paneSizeOf(targetId: BrowserTargetId) {
  const pane = pagePanes.get(targetId);
  return (pane === undefined ? undefined : paneSizes.get(pane)) ?? paneSize;
}

// A pane is a slot on the window's own layer; a host above it (a draft
// window, a look) shows its page at a size of its own.
function notePaneSize(
  targetId: BrowserTargetId,
  size: { height: number; width: number },
) {
  const pane = pagePanes.get(targetId);
  const kept = pane === undefined ? undefined : paneSizes.get(pane);
  const same = (other: null | undefined | typeof size) =>
    other?.width === size.width && other.height === size.height;
  if (same(paneSize) && (pane === undefined || same(kept))) {
    return;
  }
  paneSize = size;
  if (pane !== undefined) {
    paneSizes.set(pane, size);
  }
  clearTimeout(paneSettle);
  paneSettle = setTimeout(parkAgain, PANE_SETTLE_MS);
}

/**
 * Says which pane each page's tab stands in, whole on each change: a parked
 * page is laid out at the size its own pane last showed a page at, so a tab
 * behind the one up on either side of a group comes up at its side's width.
 */
export function setPagePanes(panes: ReadonlyMap<BrowserTargetId, string>) {
  pagePanes = panes;
  // A page already up was shown before its pane was known.
  for (const [targetId, pooled] of pool) {
    const pane = panes.get(targetId);
    if (
      pane !== undefined &&
      paintOwners.has(targetId) &&
      !pooled.shownAbovePane &&
      pooled.lastVisibleBounds &&
      !paneSizes.has(pane)
    ) {
      const { height, width } = pooled.lastVisibleBounds;
      paneSizes.set(pane, { height, width });
    }
  }
  const standing = new Set(panes.values());
  for (const pane of paneSizes.keys()) {
    if (!standing.has(pane)) {
      paneSizes.delete(pane);
    }
  }
  parkAgain();
}

/**
 * A page in HTML full screen (a video's full-screen button) makes its
 * `<webview>` this document's full-screen element, so it stands in the top
 * layer over the whole window, whatever its container's opacity or bounds,
 * and Electron puts the window in full screen for it (and back as it was when
 * the page leaves). One no slot is showing would cover the app with a page
 * nobody chose to look at, and take no clicks, since its container takes
 * none; it leaves full screen instead. Leaving from this document rather than
 * the page's means the page cannot refuse.
 */
function leaveFullScreen(pooled: PooledWebview) {
  if (
    document.fullscreenElement === pooled.webview &&
    !paintOwners.has(pooled.targetId)
  ) {
    document.exitFullscreen().catch(() => {});
  }
}

function onFullScreenChange() {
  for (const pooled of pool.values()) {
    if (document.fullscreenElement !== pooled.webview) {
      continue;
    }
    leaveFullScreen(pooled);
    // Esc reaches the page only while it holds the keyboard, which a page an
    // agent sent into full screen need not.
    if (
      paintOwners.has(pooled.targetId) &&
      !isPageOnSideWithoutKeyboard(pooled.targetId)
    ) {
      pooled.webview.focus({ preventScroll: true });
    }
  }
}

/** A `clip-path` cutting a guest at `bounds` to the part of it inside `clip`. */
function clipInset(bounds: Bounds, clip: Bounds): string {
  const top = Math.max(0, clip.y - bounds.y);
  const left = Math.max(0, clip.x - bounds.x);
  const bottom = Math.max(0, bounds.y + bounds.height - (clip.y + clip.height));
  const right = Math.max(0, bounds.x + bounds.width - (clip.x + clip.width));
  return top + left + bottom + right === 0
    ? ""
    : `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

/** Puts the guest in the frontmost slot asking for it, or parks it when none is. */
function placeGuest(targetId: BrowserTargetId) {
  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
  let winner: [symbol, SlotClaim] | undefined;
  for (const entry of slotClaims.get(targetId) ?? []) {
    const [, claim] = entry;
    if (
      !winner ||
      claim.layer > winner[1].layer ||
      (claim.layer === winner[1].layer && claim.since > winner[1].since)
    ) {
      winner = entry;
    }
  }
  reportShown(pooled, winner !== undefined);
  if (!winner) {
    paintOwners.delete(targetId);
    pooled.webview.removeAttribute(PAGE_ON_SCREEN);
    releaseGuestFocus(targetId);
    applyPaintHost(pooled);
    leaveFullScreen(pooled);
    return;
  }
  const [
    owner,
    { bottomRadius, bounds, clip, layer, layoutWidth, renderedSize },
  ] = winner;
  const [bottomLeft = bottomRadius, bottomRight = bottomLeft] = bottomRadius
    .trim()
    .split(/\s+/);
  const corners = `0 0 ${bottomRight} ${bottomLeft}`;
  paintOwners.set(targetId, owner);
  pooled.webview.setAttribute(PAGE_ON_SCREEN, "");
  pooled.lastVisibleBounds = bounds;
  pooled.shownAbovePane = layer > 0;
  if (layer === 0) {
    notePaneSize(targetId, { height: bounds.height, width: bounds.width });
  }
  if (layoutWidth !== undefined && !shownOnce.has(targetId)) {
    shownOnce.add(targetId);
    if (
      bounds.width < layoutWidth &&
      !pendingLayouts.has(targetId) &&
      !agentZooms.has(targetId)
    ) {
      pendingLayouts.set(
        targetId,
        Math.min(layoutWidth, bounds.width / AGENT_PAGE_MIN_ZOOM),
      );
    }
  }
  applyPendingLayout(pooled, bounds);
  // After the commit that put it here, once the view it replaced is gone.
  queueMicrotask(() => {
    passKeyboardTo(targetId);
  });
  reportEffectiveSurface(
    pooled,
    layoutOf(pooled, { height: bounds.height, width: bounds.width }),
  );
  const { container, webview } = pooled;

  Object.assign(container.style, {
    borderRadius: corners,
    clipPath: clip === undefined ? "" : clipInset(bounds, clip),
    contain: "layout paint size style",
    height: `${bounds.height}px`,
    left: `${bounds.x}px`,
    opacity: "1",
    overflow: "hidden",
    pointerEvents: "auto",
    position: "fixed",
    top: `${bounds.y}px`,
    transform: "",
    visibility: "visible",
    width: `${bounds.width}px`,
    willChange: "",
    zIndex: String(layer),
  } satisfies Partial<CSSStyleDeclaration>);

  if (renderedSize) {
    Object.assign(webview.style, {
      borderRadius: "",
      height: `${renderedSize.height}px`,
      left: `${(bounds.width - renderedSize.width) / 2}px`,
      position: "absolute",
      top: `${(bounds.height - renderedSize.height) / 2}px`,
      transform: "",
      transformOrigin: "",
      width: `${renderedSize.width}px`,
    } satisfies Partial<CSSStyleDeclaration>);
  } else {
    Object.assign(webview.style, {
      borderRadius: corners,
      height: `${bounds.height}px`,
      left: "",
      position: "",
      top: "",
      transform: "",
      transformOrigin: "",
      width: `${bounds.width}px`,
    } satisfies Partial<CSSStyleDeclaration>);
  }
}

/** Bring the pool in line with the desired target set: create any missing
 * guests, dispose any that are no longer wanted, and mirror the attached set. */
function reconcile(all: BrowserGuestTarget[]) {
  // A popup's page is drawn by main, in a view of its own (`popup-pool.ts`).
  reconcilePopups(all, publishAttached);
  const targets = all.filter((target) => !target.popup);
  const desired = new Set(targets.map((target) => target.id));
  for (const target of targets) {
    // A destroy+recreate of the same id (new generation) may reach us as a
    // single snapshot; dispose the stale guest first so ensureWebview mounts a
    // fresh one bound to the live entry instead of reusing the dead element.
    const pooled = pool.get(target.id);
    const isRemade =
      pooled !== undefined && pooled.generation !== target.generation;
    const hadKeyboard = isRemade && document.activeElement === pooled.webview;
    if (isRemade) {
      disposeWebview(target.id);
    }
    const kept = ensureWebview(target.id, target.generation);
    if (hadKeyboard) {
      takeKeyboardOnArrival(target.id);
    }
    if (kept.asleep !== target.asleep) {
      kept.asleep = target.asleep;
      if (!paintOwners.has(target.id)) {
        applyPaintHost(kept);
        if (kept.asleep) {
          handKeyboardBackFromParked(target.id);
        }
      }
    }
  }
  // Snapshot the keys to dispose first; disposeWebview mutates the pool.
  const stale = [...pool.keys()].filter((targetId) => !desired.has(targetId));
  for (const targetId of stale) {
    disposeWebview(targetId);
  }

  attachedFromMain = new Set(
    all.filter((target) => target.attached).map((target) => target.id),
  );
  publishAttached();
}

/**
 * The targets whose guest main reports attached and whose element is ready
 * here, replaced rather than mutated so it is a stable snapshot between
 * changes.
 */
function publishAttached() {
  attachedTargets = new Set(
    [...attachedFromMain].filter(
      (targetId) => pool.get(targetId)?.handle ?? getPopup(targetId),
    ),
  );
  for (const listener of targetListeners) {
    listener();
  }
}

// The size a page laid out in an element of `size` sees, at the guest's zoom.
function layoutOf(
  pooled: PooledWebview,
  size: { height: number; width: number },
): { height: number; width: number } {
  // The agent's zoom as set, since the guest answers with the old one until
  // the change reaches it.
  const zoom = agentZooms.get(pooled.targetId) ?? pooled.handle?.zoom() ?? 1;
  return {
    height: Math.round(size.height / zoom),
    width: Math.round(size.width / zoom),
  };
}

// Tell main what the guest is actually laid out at. `desiredSurfaces` in main
// keeps what an agent asked for, so that a guest returns to it when the window
// grows back; this is the other half, and what a window-dimension probe should
// be answered with. Without it a granted size that the window later shrank under
// would keep being reported as though it still held.
function reportEffectiveSurface(
  pooled: PooledWebview,
  size: { height: number; width: number },
) {
  const last = pooled.lastReportedSurface;
  if (last?.width === size.width && last.height === size.height) {
    return;
  }
  pooled.lastReportedSurface = size;
  void rpcClient.browser.syncGuestSurface.call({
    height: size.height,
    targetId: pooled.targetId,
    width: size.width,
  });
}

// Tell main whether a slot shows the guest or it is parked. A parked guest is
// still laid out and painted, so main has no other way to tell, and it grants
// a page full screen only in a guest a slot shows.
function reportShown(pooled: PooledWebview, shown: boolean) {
  if (pooled.lastReportedShown === shown) {
    return;
  }
  pooled.lastReportedShown = shown;
  notifyShown();
  void rpcClient.browser.syncGuestShown.call({
    shown,
    targetId: pooled.targetId,
  });
}

function reportRasterBudget() {
  void rpcClient.browser.syncRasterBudget.call(maxRasterSize());
}
