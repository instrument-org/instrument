import { captureException } from "@/client/lib/capture-exception";
import { rpcClient } from "@/client/rpc/client";
import {
  BROWSER_GUEST_VIEWPORT,
  type BrowserGuestTarget,
  browserPartition,
} from "@/shared/browser";
import { PAGE_THUMB_CHANNEL } from "@/shared/page-editor-channels";
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
 *    to draw by the main process's `whileEmbedderComposites`).
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
  container: HTMLDivElement;
  // A size the agent asked this guest to lay out at, which outranks
  // `lastVisibleBounds` while parked. Null means "whatever the panel last
  // showed it at", which is the only sizing a guest nobody has asked about has.
  desiredSurface: null | { height: number; width: number };
  // Generation of the entry this guest was mounted for. A destroy+recreate of
  // the same targetId bumps it, so reconcile knows to dispose this guest and
  // mount a fresh one rather than reusing an element bound to a dead entry.
  generation: number;
  // Last size reported to main, so a park/show cycle that lands on the same
  // number doesn't re-send it.
  lastReportedSurface: null | { height: number; width: number };
  // The guest as everything outside the pool drives it, from the element's
  // dom-ready on: before it, every one of the element's methods throws.
  handle: GuestHandle | null;
  // Last size the guest was shown at, so paint-host keeps it that size while
  // hidden (avoids a jarring resize when re-shown).
  lastVisibleBounds: Bounds | null;
  targetId: BrowserTargetId;
  webview: WebviewElement;
}

/** What each `<webview>` event a host listens to carries, as Electron fires it. */
export interface GuestEventMap {
  "did-fail-load": {
    errorCode: number;
    errorDescription: string;
    isMainFrame: boolean;
    validatedURL: string;
  };
  "did-navigate": { url: string };
  "did-navigate-in-page": { isMainFrame: boolean; url: string };
  "did-start-loading": object;
  "did-stop-loading": object;
  "found-in-page": { result: { activeMatchOrdinal: number; matches: number } };
  "ipc-message": { args: unknown[]; channel: string };
  "page-favicon-updated": { favicons: string[] };
  "page-title-updated": { title: string };
  /** The pool's own, fired after `setZoom`: Electron says nothing when a guest's zoom changes. */
  "zoom-set": object;
}

/**
 * A tab's guest once it can be driven, the one way anything outside the pool
 * reaches it: `getGuest` hands one back only after the guest is ready, and
 * every method is safe to call after that. A guest gone since answers as an
 * empty page (no address, no history) and ignores what it is asked to do.
 */
export interface GuestHandle {
  canGoBack(): boolean;
  canGoForward(): boolean;
  /** The page as it looks now, as a data URL; null when nothing could be taken. */
  capture(): Promise<null | string>;
  /** Forgets every entry but the one the guest is at. */
  clearHistory(): void;
  find(text: string, options?: { findNext?: boolean; forward?: boolean }): void;
  /** Loads `url`, settling once it has, and rejecting for a load that failed. */
  load(url: string): Promise<void>;
  on<K extends keyof GuestEventMap>(
    event: K,
    listener: (event: GuestEventMap[K]) => void,
  ): () => void;
  reload(options?: { ignoreCache?: boolean }): void;
  /** Runs `code` in the page and settles with what it returns. */
  run(code: string): Promise<unknown>;
  /** A message to the guest's preload, on a channel it listens on. */
  send(channel: string, ...args: unknown[]): void;
  setZoom(factor: number): void;
  /** A step through the page's own history; false when it has none that way. */
  step(direction: "back" | "forward"): boolean;
  stopFind(
    action: "activateSelection" | "clearSelection" | "keepSelection",
  ): void;
  readonly targetId: BrowserTargetId;
  title(): string;
  /** The page's address; empty when it has none to give. */
  url(): string;
  readonly webContentsId: number;
  zoom(): number;
}

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
  reload(): void;
  reloadIgnoringCache(): void;
  /** A message to the guest's preload, on a channel it listens on. */
  send(channel: string, ...args: unknown[]): void;
  setZoomFactor(factor: number): void;
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

// The last focused Studio element, retained when agent CDP input crosses into
// a guest so focus can return to the exact host element it displaced.
let lastHostFocusedElement: HTMLElement | null = null;

// Put keyboard focus on a guest so agent keyboard input dispatched to it is
// actually delivered there. Chromium routes keyboard input to the widget
// holding focus, and only this renderer-side DOM focus moves it across the
// process boundary -- the main process cannot do it for us. The guest's own
// `document.activeElement` survives losing and regaining focus, so this alone
// puts typing back into whatever the agent last clicked.
function focusGuest(targetId: BrowserTargetId) {
  pool.get(targetId)?.webview.focus({ preventScroll: true });
}

/** How long a page opened in place of what the person was in waits to come on screen and take the keyboard. */
const HEIR_WAIT_MS = 5000;

/**
 * Pages opened in place of what the person was in, by target, with when
 * their claim on the keyboard lapses. The view a link was followed from
 * goes away with the caret in it, and a browser keeps the keyboard in the
 * content area across a link, so the page that took its place takes the
 * keyboard as it comes on screen, which is what lets back and forward step
 * through it.
 */
const keyboardHeirs = new Map<BrowserTargetId, number>();

/**
 * Hands the keyboard to the page once it is on screen and ready, unless
 * the person has put it somewhere they can see by then.
 */
export function takeKeyboardOnArrival(targetId: BrowserTargetId) {
  keyboardHeirs.set(targetId, Date.now() + HEIR_WAIT_MS);
  queueMicrotask(() => {
    passKeyboardTo(targetId);
  });
}

function passKeyboardTo(targetId: BrowserTargetId) {
  const lapses = keyboardHeirs.get(targetId);
  const pooled = pool.get(targetId);
  if (lapses === undefined || !pooled?.handle || !paintOwners.has(targetId)) {
    return;
  }
  keyboardHeirs.delete(targetId);
  if (Date.now() > lapses || !isKeyboardOffScreen()) {
    return;
  }
  pooled.webview.focus({ preventScroll: true });
}

/**
 * Whether the keyboard is in nothing the person can see: on the body, or
 * on an element hidden with the view it was in (every window tab stays
 * mounted, hidden with `visibility`).
 */
function isKeyboardOffScreen() {
  const focused = document.activeElement;
  return (
    focused === null ||
    focused === document.body ||
    !focused.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    })
  );
}

function recordHostFocus(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.tagName === "WEBVIEW") {
    return;
  }
  // Somewhere the person put the keyboard on purpose, which outranks a page
  // still on its way.
  keyboardHeirs.clear();
  lastHostFocusedElement = target;
  // With no guests mounted nothing can steal focus, so skip the per-focusin
  // RPC. The main process re-seeds its claim from window focus whenever a
  // guarded command starts (see the manager's sendCommand).
  if (pool.size > 0) {
    void rpcClient.browser.syncHostFocus.call();
  }
}

// Parking a guest only restyles it: the element stays in the DOM and stays
// focusable, so one the user had clicked into keeps keyboard focus after it
// goes invisible. Keystrokes would reach a page nobody can see, and every
// main-process chord that targets the focused guest (reload, zoom, history)
// would keep hitting it instead of the app. Hand focus back to the host as the
// guest leaves the screen; the `blur` this fires clears the main process's
// record of which guest is focused.
//
// After the commit, not during it: a park from a slot's layout cleanup runs
// inside React's commit, which puts focus back on whatever held it before the
// commit, so a blur there becomes `webview.focus()` and the guest takes the
// keyboard back from whatever the new screen focused (a new tab's address
// field).
function releaseGuestFocus(targetId: BrowserTargetId) {
  queueMicrotask(() => {
    const pooled = pool.get(targetId);
    if (
      !pooled ||
      paintOwners.has(targetId) ||
      document.activeElement !== pooled.webview
    ) {
      return;
    }
    pooled.webview.blur();
    restoreHostFocus();
  });
}

function restoreHostFocus() {
  if (lastHostFocusedElement?.isConnected) {
    lastHostFocusedElement.focus({ preventScroll: true });
  }
}

// The slot currently showing each guest.
const paintOwners = new Map<BrowserTargetId, symbol>();

interface SlotClaim {
  bottomRadius: string;
  bounds: Bounds;
  layer: number;
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

/** Whether the guest's latest navigation was a step `goGuest` made, which this answers once. */
export function takeGuestTraversal(targetId: BrowserTargetId): boolean {
  return traversals.delete(targetId);
}

/** A target's guest, once it is ready to be driven; null until then and once it is gone. */
export function getGuest(targetId: BrowserTargetId): GuestHandle | null {
  return pool.get(targetId)?.handle ?? null;
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
          restoreHostFocus();
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
  void runGuestSurfaces();
  void runPageSteps();

  return () => {
    controller.abort();
    document.removeEventListener("focusin", recordHostFocus);
    window.removeEventListener("resize", onWindowResize);
  };
}

/**
 * The page on screen that holds the keyboard, if one does: a parked guest
 * hands the keyboard back as it goes, and one that kept it is no page the
 * person is looking at.
 */
export function pageHoldingKeyboard(): BrowserTargetId | null {
  for (const [targetId, pooled] of pool) {
    if (
      document.activeElement === pooled.webview &&
      paintOwners.has(targetId)
    ) {
      return targetId;
    }
  }
  return null;
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

/**
 * Withdraw a slot's claim on the guest. The guest passes to the frontmost slot
 * still asking for it, or parks in paint-host (laid out + painted, but not
 * shown) when none is, so a backgrounded panel can't hide the guest another
 * panel is showing.
 */
export function setPaintHost(targetId: BrowserTargetId, owner: symbol) {
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
) {
  if (!pool.has(targetId)) {
    return;
  }
  const claims = slotClaims.get(targetId) ?? new Map<symbol, SlotClaim>();
  slotClaims.set(targetId, claims);
  claims.set(owner, {
    bottomRadius,
    bounds,
    layer,
    renderedSize,
    since: claims.get(owner)?.since ?? nextClaimOrder++,
  });
  placeGuest(targetId);
}

/** useSyncExternalStore glue for {@link attachedTargets} (see use-browser-targets). */
export function subscribeAttachedTargets(listener: () => void): () => void {
  targetListeners.add(listener);
  return () => {
    targetListeners.delete(listener);
  };
}

// Record a size the agent asked for and put the guest at it if it is parked.
// A guest a slot is showing keeps the slot's bounds: the user is looking at it,
// and the request takes effect the next time it parks.
function applyDesiredSurface(
  targetId: BrowserTargetId,
  size: null | { height: number; width: number },
) {
  if (size) {
    desiredSurfaces.set(targetId, size);
  } else {
    desiredSurfaces.delete(targetId);
  }

  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
  pooled.desiredSurface = size;
  if (!paintOwners.has(targetId)) {
    applyPaintHost(pooled);
  }
}

// On-screen-sized but visually hidden. NOT display:none / far-offscreen, which
// would drop the compositor surface and break CDP capture/input. Held at the
// last visible size (or a default before first shown) so re-showing doesn't jump,
// and clamped to what this window can actually rasterize: a guest shown in a
// panel is bounded by the window anyway, but the default is not, so in a window
// narrower than 985px or shorter than 616px it would otherwise park over the cap.
function applyPaintHost(pooled: PooledWebview) {
  const { container, desiredSurface, lastVisibleBounds, webview } = pooled;
  const budget = maxRasterSize();
  const requested = desiredSurface ?? lastVisibleBounds;
  const width = Math.min(requested?.width ?? VIEW_W, budget.width);
  const height = Math.min(requested?.height ?? VIEW_H, budget.height);
  reportEffectiveSurface(pooled, { height, width });

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
    visibility: "visible",
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
  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
  pooled.container.remove();
  pool.delete(targetId);
  paintOwners.delete(targetId);
  slotClaims.delete(targetId);
  keyboardHeirs.delete(targetId);
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
  });
  webview.addEventListener("blur", () => {
    void rpcClient.browser.syncFocus.call({ focused: false, targetId });
  });
  // A thumb button pressed over the page, which steps it as a history chord
  // pressed in it does.
  webview.addEventListener("ipc-message", (event) => {
    // The guest's message, as Electron's `<webview>` fires it.
    const { args, channel } = event as Event & {
      args?: unknown[];
      channel?: string;
    };
    if (channel !== PAGE_THUMB_CHANNEL) {
      return;
    }
    stepPage(targetId, args?.[0] === "forward" ? "forward" : "back");
  });

  container.append(webview);
  document.body.append(container);

  const pooled: PooledWebview = {
    container,
    desiredSurface: desiredSurfaces.get(targetId) ?? null,
    generation,
    handle: null,
    lastReportedSurface: null,
    lastVisibleBounds: null,
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
  return {
    canGoBack: () => guard(() => webview.canGoBack(), false),
    canGoForward: () => guard(() => webview.canGoForward(), false),
    capture: async () => {
      try {
        return (await webview.capturePage()).toDataURL();
      } catch {
        return null;
      }
    },
    clearHistory: () => {
      guard(() => {
        webview.clearHistory();
      }, undefined);
    },
    find: (text, options) => {
      guard(() => webview.findInPage(text, options), 0);
    },
    load: (url) => webview.loadURL(url),
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
  for (const [targetId, pooled] of pool) {
    if (!paintOwners.has(targetId)) {
      applyPaintHost(pooled);
    }
  }
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
  if (!winner) {
    paintOwners.delete(targetId);
    releaseGuestFocus(targetId);
    applyPaintHost(pooled);
    return;
  }
  const [owner, { bottomRadius, bounds, layer, renderedSize }] = winner;
  const [bottomLeft = bottomRadius, bottomRight = bottomLeft] = bottomRadius
    .trim()
    .split(/\s+/);
  const corners = `0 0 ${bottomRight} ${bottomLeft}`;
  paintOwners.set(targetId, owner);
  pooled.lastVisibleBounds = bounds;
  // After the commit that put it here, once the view it replaced is gone.
  queueMicrotask(() => {
    passKeyboardTo(targetId);
  });
  reportEffectiveSurface(pooled, {
    height: bounds.height,
    width: bounds.width,
  });
  const { container, webview } = pooled;

  Object.assign(container.style, {
    borderRadius: corners,
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
function reconcile(targets: BrowserGuestTarget[]) {
  const desired = new Set(targets.map((target) => target.id));
  for (const target of targets) {
    // A destroy+recreate of the same id (new generation) may reach us as a
    // single snapshot; dispose the stale guest first so ensureWebview mounts a
    // fresh one bound to the live entry instead of reusing the dead element.
    const pooled = pool.get(target.id);
    if (pooled && pooled.generation !== target.generation) {
      disposeWebview(target.id);
    }
    ensureWebview(target.id, target.generation);
  }
  // Snapshot the keys to dispose first; disposeWebview mutates the pool.
  const stale = [...pool.keys()].filter((targetId) => !desired.has(targetId));
  for (const targetId of stale) {
    disposeWebview(targetId);
  }

  attachedFromMain = new Set(
    targets.filter((target) => target.attached).map((target) => target.id),
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
    [...attachedFromMain].filter((targetId) => pool.get(targetId)?.handle),
  );
  for (const listener of targetListeners) {
    listener();
  }
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

function reportRasterBudget() {
  void rpcClient.browser.syncRasterBudget.call(maxRasterSize());
}
