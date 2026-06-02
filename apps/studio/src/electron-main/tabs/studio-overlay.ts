import { createContextMenu } from "@/electron-main/lib/context-menu";
import { openExternal } from "@/electron-main/lib/open-external";
import { tryCaptureError } from "@/electron-main/lib/try-capture-error";
import { unsafe_studioURL } from "@/electron-main/lib/urls";
import {
  type StudioOverlayKind,
  type StudioOverlayRequest,
  studioOverlayRequestToLocation,
  type StudioOverlayResult,
} from "@/shared/studio-overlay";
import { type StudioPath } from "@/shared/studio-path";
import { type BaseWindow, type WebContents, WebContentsView } from "electron";
import path from "node:path";

/**
 * Owns the single app-wide modal overlay: a topmost WebContentsView that
 * covers the entire window (toolbar, sidebar, and the active tab). It is
 * deliberately separate from the tab z-stack so it can never be sunk behind
 * the shield, and it is sized to the full window rather than the tab content
 * area.
 *
 * Lifecycle is driven by the studioOverlay RPC: `show` returns a promise that
 * resolves once the overlay renderer calls `complete`/`dismiss`, the modal is
 * replaced by another `show`, or it errors.
 */
export interface StudioOverlayController {
  /** The kind of the active overlay, or null when none is open. */
  activeKind: () => null | StudioOverlayKind;
  /** Resolve the active overlay as dismissed and tear down its view. */
  dismiss: () => void;
  /** Resolve the active overlay as failed (not completed) and tear it down. */
  fail: () => void;
  /**
   * Navigate the overlay's own history back. Inert until the overlay route
   * gains multi-entry history (e.g. settings), but lets native back/forward
   * target the overlay (not the tab) while it is open.
   */
  goBack: () => void;
  /** Navigate the overlay's own history forward. See `goBack`. */
  goForward: () => void;
  /** Whether an overlay is currently mounted. */
  isActive: () => boolean;
  /** Re-add the overlay on top of the z-stack after tab views are restacked. */
  reassertTopmost: () => void;
  /** Reload the overlay's own webContents. */
  reload: () => void;
  /** Reset the overlay's zoom to the default level. */
  resetZoom: () => void;
  /** Keep the overlay aligned with the window; call on every window resize. */
  resize: () => void;
  /**
   * Resolve the active overlay as completed (the renderer reporting success)
   * and tear it down. Non-completion outcomes (dismiss/error/replace) are
   * produced internally and resolve as `{ completed: false }`.
   */
  resolve: () => void;
  /** Mount the overlay and resolve when the flow finishes. */
  show: (request: StudioOverlayRequest) => Promise<StudioOverlayResult>;
  /** Remove and destroy the overlay without resolving (window teardown). */
  teardown: () => void;
  /** Zoom the overlay in by one step. */
  zoomIn: () => void;
  /** Zoom the overlay out by one step. */
  zoomOut: () => void;
}

interface ActiveOverlay {
  kind: StudioOverlayKind;
  /** Serialized target location, used to dedupe identical re-show requests. */
  location: string;
  resolve: (result: StudioOverlayResult) => void;
  settled: boolean;
  view: WebContentsView;
}

/** Run a callback against the active overlay's webContents, if any. */
function withActiveWebContents(
  active: ActiveOverlay | null,
  fn: (webContents: WebContents) => void,
) {
  // electron/electron#50249: webContents is undefined after destruction.
  const webContents = active?.view.webContents;
  if (webContents) {
    fn(webContents);
  }
}

/**
 * Idle parking route for the warm view. While hidden the view is navigated
 * here (instead of left on an `/studio-overlay/*` route) so its renderer mounts no
 * layout and runs no live queries/timers. Keep in sync with the file route at
 * `routes/studio-overlay-idle.tsx`.
 */
const IDLE_LOCATION = "/studio-overlay-idle" satisfies StudioPath;

export function createStudioOverlayController({
  baseWindow,
  onActiveChange,
  onClosed,
}: {
  baseWindow: BaseWindow;
  /** Notified whenever the overlay opens or closes, so state can be published. */
  onActiveChange?: (isActive: boolean) => void;
  /** Called after an overlay is removed so the manager can refocus the tab. */
  onClosed: () => void;
}): StudioOverlayController {
  let active: ActiveOverlay | null = null;
  // The overlay's WebContentsView is created on first show and then kept alive
  // (hidden, parked on the idle route) across opens so reopening is instant: no
  // new process, no fresh renderer boot. It is only destroyed on teardown.
  let warmView: null | WebContentsView = null;

  function setActive(next: ActiveOverlay | null) {
    const wasActive = active !== null;
    active = next;
    const isActive = active !== null;
    if (isActive !== wasActive) {
      onActiveChange?.(isActive);
    }
  }

  function computeBounds() {
    // Cover the entire window, including the toolbar and sidebar drawn by the
    // shell webContents. getContentBounds because the window is frameless.
    const { height, width } = baseWindow.getContentBounds();
    return { height, width, x: 0, y: 0 };
  }

  /** Create the overlay view once, configured but not yet navigated. */
  function createWarmView() {
    const view = new WebContentsView({
      webPreferences: {
        additionalArguments: ["--windowType=studio-overlay"],
        preload: path.join(import.meta.dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    // Dock DevTools at the bottom: docked-default could land under the modal's
    // draggable top strip, which swallows clicks on the DevTools toolbar.
    createContextMenu({ inspectMode: "bottom", windowOrWebContentsView: view });
    // Transparent so the renderer's scrim composites over the tab and sidebar
    // beneath it. An opaque background here would hide everything behind the
    // overlay regardless of the renderer's semi-transparent scrim.
    view.setBackgroundColor("#00000000");
    view.setBounds(computeBounds());

    view.webContents?.setWindowOpenHandler((details) => {
      void openExternal(details.url);
      return { action: "deny" };
    });

    return view;
  }

  /** The warm view, creating it on first use. */
  function ensureWarmView() {
    warmView ??= createWarmView();
    return warmView;
  }

  /**
   * Navigate the warm view to a location as a fresh entry, then drop prior
   * history so the overlay's own back/forward can never cross sessions (e.g.
   * back out of a freshly opened settings modal into a previous login flow).
   */
  function navigateTo(view: WebContentsView, location: string) {
    const { webContents } = view;
    if (!webContents) {
      return;
    }
    webContents.once("did-finish-load", () => {
      // clear() keeps the current entry and discards the rest.
      tryCaptureError("clearing studio overlay history failed", () => {
        webContents.navigationHistory.clear();
      });
    });
    void webContents.loadURL(unsafe_studioURL(location));
  }

  /** Hide the overlay and park it on the idle route, keeping it warm. */
  function hideAndPark(view: WebContentsView) {
    tryCaptureError("removeChildView failed closing studio overlay", () => {
      baseWindow.contentView.removeChildView(view);
    });
    // Park on the idle route so the hidden renderer mounts no layout and runs
    // no live queries/timers while it waits to be reused.
    navigateTo(view, IDLE_LOCATION);
  }

  /** Permanently destroy the warm view (window teardown only). */
  function destroyWarmView() {
    if (!warmView) {
      return;
    }
    const view = warmView;
    warmView = null;
    tryCaptureError("removeChildView failed destroying studio overlay", () => {
      baseWindow.contentView.removeChildView(view);
    });
    view.webContents?.close();
  }

  /** Resolve the active modal and hide its (reusable) view. No-op if settled. */
  function settle(result: StudioOverlayResult) {
    if (!active || active.settled) {
      return;
    }
    const current = active;
    current.settled = true;
    setActive(null);
    hideAndPark(current.view);
    current.resolve(result);
    onClosed();
  }

  return {
    activeKind: () => active?.kind ?? null,
    dismiss: () => {
      settle({ completed: false });
    },
    fail: () => {
      settle({ completed: false });
    },
    goBack: () => {
      withActiveWebContents(active, (webContents) => {
        webContents.navigationHistory.goBack();
        webContents.focus();
      });
    },
    goForward: () => {
      withActiveWebContents(active, (webContents) => {
        webContents.navigationHistory.goForward();
        webContents.focus();
      });
    },
    isActive: () => active !== null,
    reassertTopmost: () => {
      if (!active) {
        return;
      }
      const { view } = active;
      tryCaptureError("addChildView failed reasserting studio overlay", () => {
        baseWindow.contentView.addChildView(view);
      });
    },
    reload: () => {
      withActiveWebContents(active, (webContents) => {
        webContents.reload();
        webContents.focus();
      });
    },
    resetZoom: () => {
      active?.view.webContents?.setZoomLevel(0);
    },
    resize: () => {
      active?.view.setBounds(computeBounds());
    },
    resolve: () => {
      settle({ completed: true });
    },
    show: (request) => {
      const location = serializeLocation(request);

      // Re-showing the exact same modal (e.g. pressing the settings hotkey
      // repeatedly) should keep the open modal in place, not toggle it. Focus
      // the existing view and resolve this duplicate caller as replaced.
      if (active && !active.settled && active.location === location) {
        active.view.webContents?.focus();
        return Promise.resolve<StudioOverlayResult>({ completed: false });
      }

      // Replacing an active modal resolves the previous caller as replaced.
      // Leave `active` non-null so the setActive below sees open->open and
      // doesn't emit a spurious close+open pair. The same warm view is reused;
      // the navigateTo below points it at the new location.
      const wasVisible = active !== null && !active.settled;
      if (active && !active.settled) {
        const previous = active;
        previous.settled = true;
        previous.resolve({ completed: false });
      }

      // Reuse the warm view (created on first show, kept alive across closes).
      const view = ensureWarmView();
      navigateTo(view, location);

      return new Promise<StudioOverlayResult>((resolve) => {
        setActive({
          kind: request.kind,
          location,
          resolve,
          settled: false,
          view,
        });
        // Already mounted on a replace; only (re)add on a fresh open.
        if (!wasVisible) {
          tryCaptureError("addChildView failed showing studio overlay", () => {
            // Topmost: added last so it composites above the selected tab.
            baseWindow.contentView.addChildView(view);
          });
        }
        view.webContents?.focus();
      });
    },
    teardown: () => {
      if (active) {
        active.settled = true;
        setActive(null);
      }
      destroyWarmView();
    },
    zoomIn: () => {
      const wc = active?.view.webContents;
      if (wc) {
        wc.setZoomLevel(wc.getZoomLevel() + 0.5);
      }
    },
    zoomOut: () => {
      const wc = active?.view.webContents;
      if (wc) {
        wc.setZoomLevel(wc.getZoomLevel() - 0.5);
      }
    },
  };
}

/**
 * The hash location (`/studio-overlay/login?...`) a request maps to. Each kind is
 * its own child route; the renderer uses hash routing, so the query string
 * lives inside the hash. The shared serializer produces the type-checked path
 * and the params it validates.
 */
function serializeLocation(request: StudioOverlayRequest) {
  const { path: routePath, search } = studioOverlayRequestToLocation(request);
  const query = new URLSearchParams(search).toString();
  return query ? `${routePath}?${query}` : routePath;
}
