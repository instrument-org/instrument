import {
  AGENT_BROWSER_VIEWPORT,
  agentBrowserPartition,
} from "@/shared/agent-browser";

/**
 * Renderer-owned pool of agent-browser `<webview>` guests. Each guest is created
 * once (on the main process's `mount` command), appended to `document.body`, and
 * kept there for its lifetime so React reconciliation / a host subtree being
 * hidden never unmounts it (which would drop its compositor surface and break
 * the main process's CDP capture + input).
 *
 * Two visibility modes:
 *  - paint-host: laid out at the guest's logical size but visually hidden
 *    (`opacity: 0.001`), used whenever nothing is showing the guest. Chromium
 *    still paints it, so CDP capture/input keep working headlessly.
 *  - visible: positioned over a host slot (e.g. the task page's browser panel,
 *    measured by that component) and scaled to fit, with input enabled.
 *
 * The main process owns guest existence via mount/unmount; the host slot only
 * toggles paint-host vs visible. Hiding/closing the slot never disposes a guest.
 */

// Subset of Electron's `<webview>` tag API the browser panel drives so the user
// can take over navigation.
export interface WebviewElement extends HTMLElement {
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void>;
  reload(): void;
}

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

const { height: VIEW_H, width: VIEW_W } = AGENT_BROWSER_VIEWPORT;

const pool = new Map<string, PooledWebview>();

export function disposeWebview(targetId: string) {
  const pooled = pool.get(targetId);
  if (!pooled) {
    return;
  }
  pooled.container.remove();
  pool.delete(targetId);
}

export function ensureWebview(targetId: string): PooledWebview {
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

  container.append(webview);
  document.body.append(container);

  const pooled: PooledWebview = { container, lastVisibleBounds: null, webview };
  pool.set(targetId, pooled);
  applyPaintHost(pooled);
  return pooled;
}

/** The pooled guest element for a target, if it exists (for nav controls). */
export function getWebviewElement(targetId: string): null | WebviewElement {
  return pool.get(targetId)?.webview ?? null;
}

/**
 * Wire the main -> renderer mount/unmount commands. Call once from AppShell.
 * Returns an unsubscribe function.
 */
export function initAgentBrowserPool(): () => void {
  return window.api.onAgentBrowserCommand((command) => {
    if (command.type === "mount") {
      ensureWebview(command.targetId);
    } else {
      disposeWebview(command.targetId);
    }
  });
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
 * alive, so this can fire freely on every resize.
 */
export function showOverSlot(targetId: string, bounds: Bounds) {
  const pooled = ensureWebview(targetId);
  pooled.lastVisibleBounds = bounds;
  const { container, webview } = pooled;

  Object.assign(container.style, {
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
    height: `${height}px`,
    transform: "",
    transformOrigin: "",
    width: `${width}px`,
  } satisfies Partial<CSSStyleDeclaration>);
}
