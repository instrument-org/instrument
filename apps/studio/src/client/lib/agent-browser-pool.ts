import { rpcClient } from "@/client/rpc/client";
import {
  type AgentBrowserTarget,
  AGENT_BROWSER_VIEWPORT,
  agentBrowserPartition,
} from "@/shared/agent-browser";

/**
 * Renderer-owned pool of agent-browser `<webview>` guests. The main process owns
 * which targets should exist and streams that desired set over
 * `agentBrowser.live.targets`; this pool reconciles to it (mount on add, dispose
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
  getURL(): string;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void>;
  reload(): void;
}

const { height: VIEW_H, width: VIEW_W } = AGENT_BROWSER_VIEWPORT;

// Round the visible guest's bottom corners to match the browser panel's
// rounded-xl frame (inner radius, inside the 1px border). Whether Chromium
// actually clips the `<webview>` guest to this radius is build-dependent; the
// container also sets overflow:hidden to give it the best chance.
const VISIBLE_BOTTOM_RADIUS = "0.6875rem";

const pool = new Map<string, PooledWebview>();

// Ids of targets whose guest has attached, mirrored from the desired-targets
// stream so the UI can show the live guest vs a placeholder without a second
// polled endpoint. Replaced (not mutated) on each reconcile so the snapshot is a
// stable reference for useSyncExternalStore between changes.
let attachedTargets: ReadonlySet<string> = new Set();
const targetListeners = new Set<() => void>();

/** The pooled guest element for a target, if it exists (for nav controls). */
export function getWebviewElement(targetId: string): null | WebviewElement {
  return pool.get(targetId)?.webview ?? null;
}

/** useSyncExternalStore glue for {@link attachedTargets} (see use-agent-browser-targets). */
export function subscribeAttachedTargets(listener: () => void): () => void {
  targetListeners.add(listener);
  return () => {
    targetListeners.delete(listener);
  };
}

export function getAttachedTargetsSnapshot(): ReadonlySet<string> {
  return attachedTargets;
}

/**
 * Subscribe to the main process's desired-targets stream and reconcile the pool
 * to it. Call once at startup; returns an unsubscribe function. Resubscribing
 * always receives the current set, so a guest is never stranded by a change
 * that happened before this listener existed.
 */
export function initAgentBrowserPool(): () => void {
  let cancelled = false;

  async function subscribe() {
    const subscription = await rpcClient.agentBrowser.live.targets.call();
    for await (const targets of subscription) {
      if (cancelled) {
        break;
      }
      reconcile(targets);
    }
  }

  void subscribe();

  return () => {
    cancelled = true;
  };
}

/** Park the guest in paint-host (laid out + painted, but not shown). */
export function setPaintHost(targetId: string) {
  const pooled = pool.get(targetId);
  if (pooled) {
    applyPaintHost(pooled);
  }
}

/**
 * Show the guest over a host slot, sized to the slot's measured bounds so it
 * fills dynamically (no letterbox). Resizing/moving a painted guest keeps it
 * alive, so this can fire freely on every resize. No-ops if the guest doesn't
 * exist (the main process owns creation via the desired-targets stream).
 */
export function showOverSlot(targetId: string, bounds: Bounds) {
  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
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

  Object.assign(webview.style, {
    borderRadius: `0 0 ${VISIBLE_BOTTOM_RADIUS} ${VISIBLE_BOTTOM_RADIUS}`,
    height: `${bounds.height}px`,
    transform: "",
    transformOrigin: "",
    width: `${bounds.width}px`,
  } satisfies Partial<CSSStyleDeclaration>);
}

// On-screen-sized but visually hidden. NOT display:none / far-offscreen, which
// would drop the compositor surface and break CDP capture/input. Held at the
// last visible size (or a default before first shown) so re-showing doesn't jump.
function applyPaintHost(pooled: PooledWebview) {
  const { container, lastVisibleBounds, webview } = pooled;
  const width = lastVisibleBounds?.width ?? VIEW_W;
  const height = lastVisibleBounds?.height ?? VIEW_H;

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
    transform: "",
    transformOrigin: "",
    width: `${width}px`,
  } satisfies Partial<CSSStyleDeclaration>);
}

function disposeWebview(targetId: string) {
  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
  pooled.container.remove();
  pool.delete(targetId);
}

// Guest creation happens only here, driven by `reconcile` off the main
// process's desired-targets stream. The host slot never creates a guest: it can
// only show/park one that already exists (see showOverSlot/setPaintHost), so a
// stale "active" host can't resurrect a target the main process just destroyed.
function ensureWebview(targetId: string): PooledWebview {
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
  // carrier, see agentBrowserPartition).
  webview.setAttribute("partition", agentBrowserPartition(targetId));
  webview.setAttribute("src", "about:blank");
  webview.style.border = "0";

  // Report real DOM focus/blur so the main process can target keyboard
  // commands (zoom, back/forward) at this guest -- WebContents#isFocused()
  // in main is unreliable for `<webview>` guests, but focus/blur on the
  // element itself tracks the host document's activeElement correctly.
  webview.addEventListener("focus", () => {
    void rpcClient.agentBrowser.syncFocus.call({ focused: true, targetId });
  });
  webview.addEventListener("blur", () => {
    void rpcClient.agentBrowser.syncFocus.call({ focused: false, targetId });
  });

  container.append(webview);
  document.body.append(container);

  const pooled: PooledWebview = { container, lastVisibleBounds: null, webview };
  pool.set(targetId, pooled);
  applyPaintHost(pooled);
  return pooled;
}

/** Bring the pool in line with the desired target set: create any missing
 * guests, dispose any that are no longer wanted, and mirror the attached set. */
function reconcile(targets: AgentBrowserTarget[]) {
  const desired = new Set(targets.map((target) => target.id));
  for (const targetId of desired) {
    ensureWebview(targetId);
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
