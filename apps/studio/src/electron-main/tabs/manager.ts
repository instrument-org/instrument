import { publisher } from "@/electron-main/rpc/publisher";
import { type StudioPath } from "@/shared/studio-path";
import { type Tab, type TabState } from "@/shared/tabs";
import { type BaseWindow, type WebContentsView } from "electron";

import { tryCaptureError } from "../lib/try-capture-error";
import { getMainWindow } from "../windows/main/instance";
import {
  createStudioOverlayController,
  type StudioOverlayController,
} from "./studio-overlay";

const ZOOM_STEP = 0.5;
// Agent browser views must stay in the window hierarchy for CDP input/capture,
// but each tab now renders the whole window (AppShell), so a visible agent view
// would cover it. Park them offscreen until the in-tab viewport lands (S3).
const OFFSCREEN_AGENT_BOUNDS = { height: 800, width: 1280, x: -20_000, y: 0 };

/**
 * In the unified app the main window's own web contents renders the entire
 * tabbed UI (see `AppShell`), with tabs kept alive as React subtrees. Tab state
 * is owned by the renderer, so this manager no longer creates a WebContentsView
 * per tab. It now only:
 *  - owns the studio overlay (app-wide modals),
 *  - page-zooms the window web contents, and
 *  - keeps agent browser views composited (offscreen) so CDP keeps working.
 *
 * The remaining tab-shaped methods are no-op stubs kept so existing menu/RPC
 * call sites compile; those paths will be re-pointed at the renderer over IPC.
 */
export class TabsManager {
  public baseWindow: BaseWindow;
  public studioOverlay: StudioOverlayController;

  public constructor({ baseWindow }: { baseWindow: BaseWindow }) {
    this.baseWindow = baseWindow;
    this.studioOverlay = createStudioOverlayController({
      baseWindow,
      onActiveChange: (isActive) => {
        publisher.publish("studio-overlay.active-changed", { isActive });
      },
      onClosed: () => {
        this.focusCurrentTab();
      },
    });
  }

  /**
   * Only agent browser views (passed as `webView`) are mounted here, kept
   * offscreen. App tabs are owned by the renderer and ignored.
   */
  public addTab(options: {
    iconName?: Tab["iconName"];
    keepMounted?: true;
    params?: Record<string, string>;
    select?: boolean;
    title?: string;
    urlPath?: StudioPath;
    webView?: WebContentsView;
  }) {
    const { webView } = options;
    if (!webView) {
      return;
    }
    tryCaptureError("addChildView failed mounting agent browser view", () => {
      this.baseWindow.contentView.addChildView(webView);
      webView.setBounds(OFFSCREEN_AGENT_BOUNDS);
    });
  }

  public closeAllTabs() {
    // Tabs are renderer-owned; nothing to close here.
  }

  public closeTab(_input: { id: string }) {
    // Renderer-owned.
  }

  public focusCurrentTab() {
    if (this.studioOverlay.isActive()) {
      return;
    }
    getMainWindow()?.webContents.focus();
  }

  public getCurrentTab(): null {
    return null;
  }

  public getState(): TabState {
    return { selectedTabId: null, tabs: [] };
  }

  public getTabs(): Tab[] {
    return [];
  }

  public goBack() {
    if (this.studioOverlay.isActive()) {
      this.studioOverlay.goBack();
    }
    // Otherwise per-tab history is handled in the renderer (each tab's router).
  }

  public goForward() {
    if (this.studioOverlay.isActive()) {
      this.studioOverlay.goForward();
    }
  }

  public async initialize(_options?: {
    initialParams?: Record<string, string>;
    initialPath?: StudioPath;
  }) {
    // Tabs are created by the renderer (AppShell); nothing to restore here.
  }

  public reopenClosedTab() {
    // Renderer-owned.
  }

  public reorderTabs(_ids: string[]) {
    // Renderer-owned.
  }

  public resetZoom() {
    if (this.studioOverlay.isActive()) {
      this.studioOverlay.resetZoom();
      return;
    }
    getMainWindow()?.webContents.setZoomLevel(0);
  }

  public selectNextTab() {
    // Renderer-owned.
  }

  public selectPreviousTab() {
    // Renderer-owned.
  }

  public selectTab(_input: { id: string }) {
    // Renderer-owned.
  }

  public selectTabByIndex(_input: { index: number }) {
    // Renderer-owned.
  }

  public teardown() {
    this.studioOverlay.teardown();
  }

  public updateCurrentTabBounds() {
    // The app-wide overlay still tracks the full window on resize.
    this.studioOverlay.resize();
  }

  public zoomIn() {
    if (this.studioOverlay.isActive()) {
      this.studioOverlay.zoomIn();
      return;
    }
    this.stepWindowZoom(ZOOM_STEP);
  }

  public zoomOut() {
    if (this.studioOverlay.isActive()) {
      this.studioOverlay.zoomOut();
      return;
    }
    this.stepWindowZoom(-ZOOM_STEP);
  }

  private stepWindowZoom(delta: number) {
    const webContents = getMainWindow()?.webContents;
    if (webContents) {
      webContents.setZoomLevel(webContents.getZoomLevel() + delta);
    }
  }
}
