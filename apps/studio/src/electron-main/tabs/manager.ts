import { publisher } from "@/electron-main/rpc/publisher";
import { type StudioPath } from "@/shared/studio-path";
import { type Tab, type TabState } from "@/shared/tabs";
import { type BaseWindow } from "electron";

import { getMainWindow } from "../windows/main/instance";
import {
  createStudioOverlayController,
  type StudioOverlayController,
} from "./studio-overlay";
import { sendTabCommand } from "./tab-command";

const ZOOM_STEP = 0.5;

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
   * Open an app tab. Forwarded to the renderer, which owns tab state. Agent
   * browser guests are renderer `<webview>`s now, so there is no main-owned
   * view to mount here.
   */
  public addTab(options: {
    iconName?: Tab["iconName"];
    keepMounted?: true;
    params?: Record<string, string>;
    select?: boolean;
    title?: string;
    urlPath?: StudioPath;
  }) {
    sendTabCommand({
      appPath: options.urlPath ?? "/new-tab",
      newTab: true,
      type: "navigate",
    });
  }

  public closeActiveTab() {
    sendTabCommand({ type: "close" });
  }

  public closeAllTabs() {
    // Tabs are renderer-owned; nothing to close here.
  }

  public closeTab(input: { id: string }) {
    sendTabCommand({ id: input.id, type: "close" });
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

  public navigateActiveTab(input: { appPath: string }) {
    sendTabCommand({ appPath: input.appPath, type: "navigate" });
  }

  public reopenClosedTab() {
    sendTabCommand({ type: "reopen" });
  }

  public reorderTabs(_ids: string[]) {
    // Renderer-owned (driven by the tab bar's drag).
  }

  public resetZoom() {
    if (this.studioOverlay.isActive()) {
      this.studioOverlay.resetZoom();
      return;
    }
    getMainWindow()?.webContents.setZoomLevel(0);
  }

  public selectLastTab() {
    sendTabCommand({ type: "selectLast" });
  }

  public selectNextTab() {
    sendTabCommand({ type: "selectNext" });
  }

  public selectPreviousTab() {
    sendTabCommand({ type: "selectPrevious" });
  }

  public selectTab(_input: { id: string }) {
    // Renderer-owned (driven by the tab bar).
  }

  public selectTabByIndex(input: { index: number }) {
    sendTabCommand({ index: input.index, type: "selectByIndex" });
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
