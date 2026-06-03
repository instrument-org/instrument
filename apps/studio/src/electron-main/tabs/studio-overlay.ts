import { createContextMenu } from "@/electron-main/lib/context-menu";
import { openExternal } from "@/electron-main/lib/open-external";
import { tryCaptureError } from "@/electron-main/lib/try-capture-error";
import { unsafe_studioURL } from "@/electron-main/lib/urls";
import {
  STUDIO_OVERLAY_DISMISSIBLE,
  type StudioOverlayKind,
  type StudioOverlayRequest,
  studioOverlayRequestToLocation,
  type StudioOverlayResult,
} from "@/shared/studio-overlay";
import { type StudioPath } from "@/shared/studio-path";
import { type BaseWindow, type WebContents, WebContentsView } from "electron";
import path from "node:path";
import { noop } from "radashi";

/**
 * Owns the single app-wide modal overlay: a topmost WebContentsView covering
 * the whole window. `show` resolves once the renderer reports completion, the
 * modal is replaced by another `show`, or it is dismissed/fails.
 */
export interface StudioOverlayController {
  activeKind: () => null | StudioOverlayKind;
  /** No-op for non-dismissible kinds (see `STUDIO_OVERLAY_DISMISSIBLE`). */
  dismiss: () => void;
  fail: () => void;
  goBack: () => void;
  goForward: () => void;
  isActive: () => boolean;
  /** Re-add the overlay on top after tab views are restacked. */
  reassertTopmost: () => void;
  reload: () => void;
  resetZoom: () => void;
  /** Keep the overlay aligned with the window; call on every resize. */
  resize: () => void;
  /** Resolve the active overlay as completed and tear it down. */
  resolve: () => void;
  show: (request: StudioOverlayRequest) => Promise<StudioOverlayResult>;
  /** Debug only: mount the view visibly on the idle route to test escape. */
  showIdle: () => void;
  /** Remove and destroy the overlay without resolving (window teardown). */
  teardown: () => void;
  zoomIn: () => void;
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

/** Where the warm view parks while hidden: a route that renders nothing. */
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
  // Created on first show, then kept alive (hidden, parked on idle) across opens
  // so reopening is instant. Destroyed only on teardown.
  let warmView: null | WebContentsView = null;
  // First open boots the document with a real load; later opens/parks navigate
  // the warm renderer client-side over IPC.
  let booted = false;
  // Monotonically increasing counter sent with every navigate IPC. On a fast
  // dismiss -> show, hideAndPark sends navigate-to-idle then openOverlay sends
  // navigate-to-new. Both are delivered in order, but the renderer's
  // router.navigate commits asynchronously, so the idle route could otherwise
  // paint (blank, while the view is visible) before the new route lands. The
  // renderer tracks the last seq it saw and drops the now-stale park, so the
  // most recently issued navigate always wins. See router.tsx.
  let navSeq = 0;

  function setActive(next: ActiveOverlay | null) {
    const wasActive = active !== null;
    active = next;
    const isActive = active !== null;
    if (isActive !== wasActive) {
      onActiveChange?.(isActive);
    }
  }

  function computeBounds() {
    // getContentBounds (not bounds) because the window is frameless.
    const { height, width } = baseWindow.getContentBounds();
    return { height, width, x: 0, y: 0 };
  }

  function createWarmView() {
    const view = new WebContentsView({
      webPreferences: {
        additionalArguments: ["--windowType=studio-overlay"],
        preload: path.join(import.meta.dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    // Bottom dock: the default could land under the draggable top strip, which
    // swallows clicks on the DevTools toolbar.
    createContextMenu({ inspectMode: "bottom", windowOrWebContentsView: view });
    // Transparent so the renderer's scrim composites over the content beneath.
    view.setBackgroundColor("#00000000");
    view.setBounds(computeBounds());

    view.webContents?.setWindowOpenHandler((details) => {
      void openExternal(details.url);
      return { action: "deny" };
    });

    return view;
  }

  function ensureWarmView() {
    warmView ??= createWarmView();
    return warmView;
  }

  /**
   * Open the overlay at `location`, navigating the warm renderer client-side
   * (the first call boots the document with a real load).
   *
   * Clearing first flattens webContents history to the single committed entry
   * so back/forward stays within this open and can't reach idle or a prior
   * open. Clearing the committed entry needs no load listener, which is why the
   * open clears and parking (whose entry hasn't committed) does not.
   */
  function openOverlay(location: string) {
    const webContents = warmView?.webContents;
    if (!webContents) {
      return;
    }
    if (!booted) {
      booted = true;
      void webContents.loadURL(unsafe_studioURL(location));
      return;
    }
    tryCaptureError("clearing studio overlay history failed", () => {
      webContents.navigationHistory.clear();
    });
    webContents.send("studio-overlay:navigate", location, ++navSeq);
  }

  /** Remove the view from the window and park its renderer on the idle route. */
  function hideAndPark(view: WebContentsView) {
    tryCaptureError("removeChildView failed closing studio overlay", () => {
      baseWindow.contentView.removeChildView(view);
    });
    if (booted) {
      view.webContents?.send(
        "studio-overlay:navigate",
        IDLE_LOCATION,
        ++navSeq,
      );
    }
  }

  function destroyWarmView() {
    if (!warmView) {
      return;
    }
    const view = warmView;
    warmView = null;
    booted = false;
    tryCaptureError("removeChildView failed destroying studio overlay", () => {
      baseWindow.contentView.removeChildView(view);
    });
    view.webContents?.close();
  }

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
      // Enforced here so every user-dismiss path (Escape, click-outside, Cmd+W)
      // honors it; `fail`/`teardown` bypass it for forced teardown.
      if (active && !STUDIO_OVERLAY_DISMISSIBLE[active.kind]) {
        return;
      }
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

      // Re-showing the identical modal keeps it open and just refocuses it.
      if (active && !active.settled && active.location === location) {
        active.view.webContents?.focus();
        return Promise.resolve<StudioOverlayResult>({ completed: false });
      }

      // Replace: resolve the previous caller. Leave `active` non-null so
      // setActive below sees open->open and emits no spurious close+open pair.
      if (active && !active.settled) {
        const previous = active;
        previous.settled = true;
        previous.resolve({ completed: false });
      }

      const view = ensureWarmView();
      openOverlay(location);
      tryCaptureError("addChildView failed showing studio overlay", () => {
        // Added last so it composites above the selected tab (idempotent).
        baseWindow.contentView.addChildView(view);
      });
      view.webContents?.focus();

      return new Promise<StudioOverlayResult>((resolve) => {
        setActive({
          kind: request.kind,
          location,
          resolve,
          settled: false,
          view,
        });
      });
    },
    showIdle: () => {
      // Force the visible-but-on-idle state the safety-net button guards
      // against. `kind` is just a dismissible sentinel so dismiss() works.
      if (active && !active.settled) {
        const previous = active;
        previous.settled = true;
        previous.resolve({ completed: false });
      }
      const view = ensureWarmView();
      openOverlay(IDLE_LOCATION);
      tryCaptureError("addChildView failed showing studio overlay", () => {
        baseWindow.contentView.addChildView(view);
      });
      view.webContents?.focus();
      setActive({
        kind: "crash",
        location: IDLE_LOCATION,
        resolve: noop,
        settled: false,
        view,
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

/** The route path + query string a request maps to. */
function serializeLocation(request: StudioOverlayRequest) {
  const { path: routePath, search } = studioOverlayRequestToLocation(request);
  const query = new URLSearchParams(search).toString();
  return query ? `${routePath}?${query}` : routePath;
}
