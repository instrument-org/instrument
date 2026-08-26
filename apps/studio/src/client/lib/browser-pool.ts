import { captureException } from "@/client/lib/telemetry";
import { rpcClient } from "@/client/rpc/client";
import {
  BROWSER_GUEST_VIEWPORT,
  type BrowserGuestTarget,
  browserPartition,
} from "@/shared/browser";
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
 *    working headlessly (capture needs the guest on-screen and unoccluded, which
 *    is why we can't truly hide it).
 *  - visible: positioned over a host slot (e.g. the task page's browser panel,
 *    measured by that component) and scaled to fit, with input enabled.
 *
 * At most one guest is visible at a time: each task's browser panel shows its
 * guest only while its tab is the foreground tab (see use-active-tab) and parks
 * it otherwise, so two guests can never be shown at once. The main process owns
 * guest existence via the desired-targets stream; the host slot only toggles
 * paint-host vs visible. Hiding/closing the slot never disposes a guest.
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
  // Last size the guest was shown at, so paint-host keeps it that size while
  // hidden (avoids a jarring resize when re-shown).
  lastVisibleBounds: Bounds | null;
  webview: WebviewElement;
}

// Subset of Electron's `<webview>` tag API the browser panel drives so the user
// can take over navigation.
interface WebviewElement extends HTMLElement {
  canGoBack(): boolean;
  canGoForward(): boolean;
  findInPage(
    text: string,
    options?: { findNext?: boolean; forward?: boolean },
  ): number;
  getTitle(): string;
  getURL(): string;
  getZoomFactor(): number;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void>;
  reload(): void;
  reloadIgnoringCache(): void;
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
  getWebviewElement(targetId)?.focus({ preventScroll: true });
}

function recordHostFocus(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.tagName === "WEBVIEW") {
    return;
  }
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
function releaseGuestFocus({ webview }: PooledWebview) {
  if (document.activeElement !== webview) {
    return;
  }
  webview.blur();
  restoreHostFocus();
}

function restoreHostFocus() {
  if (lastHostFocusedElement?.isConnected) {
    lastHostFocusedElement.focus({ preventScroll: true });
  }
}

// The slot currently showing each guest. Two panels can be mounted for the same
// target (e.g. the task open in two tabs), and both drive show/park as tabs
// switch; only the slot that showed a guest may park it, so a backgrounded panel
// can't park the guest the foreground one is showing (last-writer-wins otherwise).
const paintOwners = new Map<BrowserTargetId, symbol>();

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
// polled endpoint. Replaced (not mutated) on each reconcile so the snapshot is a
// stable reference for useSyncExternalStore between changes.
let attachedTargets: ReadonlySet<BrowserTargetId> = new Set();
const targetListeners = new Set<() => void>();

export function getAttachedTargetsSnapshot(): ReadonlySet<BrowserTargetId> {
  return attachedTargets;
}

/** The pooled guest element for a target, if it exists (for nav controls). */
export function getWebviewElement(
  targetId: BrowserTargetId,
): null | WebviewElement {
  return pool.get(targetId)?.webview ?? null;
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

  return () => {
    controller.abort();
    document.removeEventListener("focusin", recordHostFocus);
    window.removeEventListener("resize", onWindowResize);
  };
}

/**
 * Park the guest in paint-host (laid out + painted, but not shown). No-ops if
 * another slot currently owns the guest's visibility, so a backgrounded panel
 * can't hide the guest the foreground panel is showing.
 */
export function setPaintHost(targetId: BrowserTargetId, owner: symbol) {
  const currentOwner = paintOwners.get(targetId);
  if (currentOwner && currentOwner !== owner) {
    return;
  }
  paintOwners.delete(targetId);
  const pooled = pool.get(targetId);
  if (pooled) {
    releaseGuestFocus(pooled);
    applyPaintHost(pooled);
  }
}

/**
 * Show the guest over a host slot, sized to the slot's measured bounds so it
 * fills dynamically (no letterbox). Resizing/moving a painted guest keeps it
 * alive, so this can fire freely on every resize. No-ops if the guest doesn't
 * exist (the main process owns creation via the desired-targets stream).
 * Claims visibility ownership for `owner` so only this slot can later park it.
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
) {
  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
  paintOwners.set(targetId, owner);
  pooled.lastVisibleBounds = bounds;
  const { container, webview } = pooled;

  Object.assign(container.style, {
    borderRadius: `0 0 ${VISIBLE_BOTTOM_RADIUS} ${VISIBLE_BOTTOM_RADIUS}`,
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
    zIndex: "0",
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
      borderRadius: `0 0 ${VISIBLE_BOTTOM_RADIUS} ${VISIBLE_BOTTOM_RADIUS}`,
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

  container.append(webview);
  document.body.append(container);

  const pooled: PooledWebview = {
    container,
    desiredSurface: desiredSurfaces.get(targetId) ?? null,
    generation,
    lastVisibleBounds: null,
    webview,
  };
  pool.set(targetId, pooled);
  applyPaintHost(pooled);
  return pooled;
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

  attachedTargets = new Set(
    targets.filter((target) => target.attached).map((target) => target.id),
  );
  for (const listener of targetListeners) {
    listener();
  }
}

function reportRasterBudget() {
  void rpcClient.browser.syncRasterBudget.call(maxRasterSize());
}
