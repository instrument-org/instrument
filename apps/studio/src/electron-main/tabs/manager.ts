import { createContextMenu } from "@/electron-main/lib/context-menu";
import { logger } from "@/electron-main/lib/electron-logger";
import { openExternal } from "@/electron-main/lib/open-external";
import { getBackgroundColor } from "@/electron-main/lib/theme-utils";
import { publisher } from "@/electron-main/rpc/publisher";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { type StudioPath } from "@/shared/studio-path";
import {
  META_TAGS,
  SingleTabOnlyRoutes,
  type Tab,
  type TabState,
} from "@/shared/tabs";
import { TabIconsSchema } from "@instrument-org/shared/icons";
import { ProjectSubdomainSchema } from "@instrument-org/workspace/electron";
import { type BaseWindow, WebContentsView } from "electron";
import { type LogFunctions } from "electron-log";
import Store from "electron-store";
import path from "node:path";

import { captureServerException } from "../lib/capture-server-exception";
import { unsafe_studioURL } from "../lib/urls";

interface TabStore {
  root?: TabState;
}

interface TabWithView extends Tab {
  /**
   * When true, this view is owned externally (browser-view-manager) and must
   * always stay in the window hierarchy so Chromium keeps it composited.
   * "Closing" such a tab only sets tabBarHidden=true; it is never removed from
   * this.tabs or the window.
   */
  keepMounted?: true;
  webView: WebContentsView;
}

export class TabsManager {
  public baseWindow: BaseWindow;
  private logger: LogFunctions;
  private recentlyClosed: Tab[] = [];
  private selectedTabId: null | string = null;
  private sidebarWidth = 0;
  private store: Store<TabStore>;
  private tabs: TabWithView[];
  private unsubscribeSidebar?: () => void;

  public constructor({
    baseWindow,
    initialSidebarWidth,
  }: {
    baseWindow: BaseWindow;
    initialSidebarWidth: number;
  }) {
    this.sidebarWidth = initialSidebarWidth;
    this.tabs = [];
    this.logger = logger.scope("tabs");
    this.baseWindow = baseWindow;
    this.store = new Store<TabStore>({ name: "tabs" });

    this.unsubscribeSidebar = publisher.subscribe(
      "sidebar.updated",
      ({ width }) => {
        this.sidebarWidth = width;
        this.updateCurrentTabBounds();
        this.focusCurrentTab();
      },
    );
  }

  public addTab({
    iconName,
    keepMounted,
    params = {},
    select,
    title,
    urlPath = "/",
    webView,
  }: {
    iconName?: Tab["iconName"];
    keepMounted?: true;
    params?: Record<string, string>;
    select?: boolean;
    title?: string;
    urlPath?: StudioPath;
    webView?: WebContentsView;
  }) {
    // When borrowing an external view, default to opening in the background so
    // the agent's work isn't interrupted.
    const shouldSelect = select ?? (webView ? false : true);

    const searchParams = new URLSearchParams(params);
    const queryString = searchParams.toString();
    const pathWithParams = urlPath + (queryString ? `?${queryString}` : "");

    if (!webView && this.selectOnAddNewTab({ urlPath: pathWithParams })) {
      return;
    }

    const id = crypto.randomUUID();
    const view = webView ?? this.createTabView({ id, urlPath: pathWithParams });

    if (webView) {
      view.setBounds(this.computeTabBounds());
      // Add at z-index 0 so it starts beneath any regular tab view on top.
      this.baseWindow.contentView.addChildView(view, 0);

      // Keep the tab title in sync with whatever the agent navigates to.
      view.webContents?.on("page-title-updated", (_event, newTitle) => {
        const live = this.tabs.find((t) => t.id === id);
        if (live && newTitle.trim()) {
          live.title = newTitle.trim();
          this.afterUpdate();
        }
      });

      // If the externally-owned view is destroyed, proactively close the tab
      // so we never attempt to add a destroyed child view to the window.
      view.webContents?.on("destroyed", () => {
        const live = this.tabs.find((t) => t.id === id);
        if (live) {
          this.closeTab({ id });
        }
      });
    }

    const newTab: TabWithView = {
      iconName,
      id,
      keepMounted,
      pathname: pathWithParams,
      pinned: false,
      title,
      webView: view,
    };

    this.tabs.push(newTab);
    if (shouldSelect) {
      this.selectTabView(newTab);
    }
    this.afterUpdate();
  }

  public closeAllTabs() {
    for (const tab of this.tabs) {
      this.closeTabView(tab);
    }

    this.tabs = [];
    this.selectedTabId = null;
    this.afterUpdate();
  }

  public closeTab({ id }: { id: string }) {
    const tabIndex = this.tabs.findIndex((tab) => tab.id === id);
    const tab = this.tabs[tabIndex];

    if (tab === undefined) {
      this.logger.error(`Closing tab: Tab ${id} not found`);
      return;
    }

    // Prevent closing pinned tabs
    if (tab.pinned) {
      this.logger.warn(`Cannot close pinned tab: ${id}`);
      return;
    }

    // Background views must stay in the window for Chromium to keep them
    // composited. Just mark them dismissed so the client hides them from the
    // tab bar; everything else (resize, title sync, lifecycle) continues as-is.
    if (tab.keepMounted) {
      tab.tabBarHidden = true;
      this.selectNeighborTab(tab, tabIndex);
      this.afterUpdate();
      return;
    }

    const { webView: _webView, ...closedTabData } = tab;
    this.recentlyClosed.push(closedTabData);

    this.closeTabView(tab);
    this.selectNeighborTab(tab, tabIndex);
    this.tabs = this.tabs.filter((t) => t.id !== id);

    if (this.visibleTabs().length === 0) {
      this.addTab({});
    } else {
      this.afterUpdate();
    }
  }

  public focusCurrentTab() {
    const tab = this.getCurrentTab();
    if (tab) {
      // electron/electron#50249: webContents is undefined after destruction in Electron 41+
      tab.webView.webContents?.focus();
    }
  }

  public getCurrentTab(): null | TabWithView {
    return this.tabs.find((tab) => tab.id === this.selectedTabId) ?? null;
  }

  public getState(): TabState {
    return {
      selectedTabId: this.selectedTabId,
      tabs: this.tabs.map(
        ({ keepMounted: _k, webView: _webView, ...tab }) => tab,
      ),
    };
  }

  public getTabs() {
    return this.tabs;
  }

  public goBack() {
    const tab = this.getCurrentTab();
    if (tab) {
      // electron/electron#50249: webContents is undefined after destruction in Electron 41+
      tab.webView.webContents?.navigationHistory.goBack();
      tab.webView.webContents?.focus();
    }
  }

  public goForward() {
    const tab = this.getCurrentTab();
    if (tab) {
      // electron/electron#50249: webContents is undefined after destruction in Electron 41+
      tab.webView.webContents?.navigationHistory.goForward();
      tab.webView.webContents?.focus();
    }
  }

  public async initialize() {
    const data = this.store.get("root") ?? {
      selectedTabId: null,
      tabs: [],
    };

    this.selectedTabId = data.selectedTabId;

    const tabs = await Promise.all(
      data.tabs
        .filter((tab) => !tab.pinned)
        .map((tab) => {
          const view = this.createTabView({
            id: tab.id,
            // Unsafe, but cannot be verified. Client will handle possible 404s
            urlPath: tab.pathname as StudioPath,
          });
          return {
            ...tab,
            iconName: tab.iconName || undefined,
            pinned: tab.pinned || false,
            webView: view,
          };
        }),
    );

    this.tabs = tabs;

    const selectedTab = this.tabs.find((tab) => tab.id === this.selectedTabId);

    if (selectedTab) {
      this.selectTabView(selectedTab);
    } else if (this.tabs[0]) {
      this.selectTabView(this.tabs[0]);
    } else {
      this.addTab({});
    }

    this.afterUpdate();
  }

  public reopenClosedTab() {
    const closedTab = this.recentlyClosed.pop();
    if (!closedTab) {
      return;
    }

    this.addTab({
      urlPath: closedTab.pathname as StudioPath,
    });
  }

  public reorderTabs(ids: string[]) {
    // Separate pinned and non-pinned tabs
    const pinnedTabs = this.tabs.filter((tab) => tab.pinned);
    const nonPinnedTabs = this.tabs.filter((tab) => !tab.pinned);

    // Only reorder non-pinned tabs
    const reorderedNonPinned = ids
      .filter((id) => !this.tabs.find((tab) => tab.id === id)?.pinned)
      .map((id) => nonPinnedTabs.find((tab) => tab.id === id))
      .filter((tab) => tab !== undefined);

    // Keep pinned tabs first, then reordered non-pinned tabs
    this.tabs = [...pinnedTabs, ...reorderedNonPinned];
    this.afterUpdate();
  }

  public resetZoom() {
    const tab = this.getCurrentTab();
    // electron/electron#50249: webContents is undefined after destruction in Electron 41+
    tab?.webView.webContents?.setZoomLevel(0);
  }

  public selectNextTab() {
    const visible = this.visibleTabs();
    if (visible.length <= 1) {
      return;
    }
    const currentIndex = visible.findIndex((t) => t.id === this.selectedTabId);
    const nextIndex = (currentIndex + 1) % visible.length;
    const tab = visible[nextIndex];
    if (tab) {
      this.selectTabView(tab);
      this.afterUpdate();
    }
  }

  public selectPreviousTab() {
    const visible = this.visibleTabs();
    if (visible.length <= 1) {
      return;
    }
    const currentIndex = visible.findIndex((t) => t.id === this.selectedTabId);
    const prevIndex = (currentIndex - 1 + visible.length) % visible.length;
    const tab = visible[prevIndex];
    if (tab) {
      this.selectTabView(tab);
      this.afterUpdate();
    }
  }

  public selectTab({ id }: { id: string }) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) {
      this.selectTabView(tab);
      this.afterUpdate();
    }
  }

  public selectTabByIndex({ index }: { index: number }) {
    const visible = this.visibleTabs();
    if (index >= 0 && index < visible.length) {
      const tab = visible[index];
      if (tab) {
        this.selectTabView(tab);
        this.afterUpdate();
      }
    }
  }

  public teardown() {
    for (const tab of this.tabs) {
      this.closeTabView(tab);
    }

    this.unsubscribeSidebar?.();
  }

  public updateCurrentTabBounds() {
    const currentTab = this.getCurrentTab();
    if (currentTab) {
      this.updateTabBounds(currentTab);
    }
    // keepMounted tabs stay in the window even when not selected,
    // so they must be resized alongside the active tab.
    for (const tab of this.tabs) {
      if (tab.keepMounted && tab.id !== this.selectedTabId) {
        this.updateTabBounds(tab);
      }
    }
  }

  public zoomIn() {
    const tab = this.getCurrentTab();
    if (tab) {
      // electron/electron#50249: webContents is undefined after destruction in Electron 41+
      const zoomLevel = tab.webView.webContents?.getZoomLevel() ?? 0;
      tab.webView.webContents?.setZoomLevel(zoomLevel + 0.5);
    }
  }

  public zoomOut() {
    const tab = this.getCurrentTab();
    if (tab) {
      // electron/electron#50249: webContents is undefined after destruction in Electron 41+
      const zoomLevel = tab.webView.webContents?.getZoomLevel() ?? 0;
      tab.webView.webContents?.setZoomLevel(zoomLevel - 0.5);
    }
  }

  private afterUpdate() {
    this.store.set("root", this.getPersistedState());
    this.emitStateChange(this.getState());
  }

  private closeTabView(tab: TabWithView) {
    this.baseWindow.contentView.removeChildView(tab.webView);
    tab.webView.webContents?.close();
  }

  private computeTabBounds() {
    // Using getContentBounds due to this being a frameless window. getBounds()
    // returns the incorrect bounds on Windows when in maximized state.
    const windowBounds = this.baseWindow.getContentBounds();
    return {
      height: windowBounds.height - TOOLBAR_HEIGHT,
      width: windowBounds.width - this.sidebarWidth,
      x: this.sidebarWidth,
      y: TOOLBAR_HEIGHT,
    };
  }

  private createTabView({ id, urlPath }: { id: string; urlPath: string }) {
    const url = unsafe_studioURL(urlPath);
    const newContentView = new WebContentsView({
      webPreferences: {
        additionalArguments: [`--tabId=${id}`],
        preload: path.join(import.meta.dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    createContextMenu({ windowOrWebContentsView: newContentView });

    newContentView.setBackgroundColor(getBackgroundColor());

    // Set initial bounds respecting sidebar width
    newContentView.setBounds(this.computeTabBounds());

    // webContents is always defined at construction time, before any destruction event
    const { webContents } = newContentView;
    if (webContents) {
      webContents.setWindowOpenHandler((details) => {
        void openExternal(details.url);
        return { action: "deny" };
      });

      webContents.on("did-navigate-in-page", (_, newUrl) => {
        const tab = this.tabs.find((t) => t.id === id);
        const pathname = newUrl.split("#")[1];
        if (tab && pathname) {
          tab.pathname = pathname;
          this.afterUpdate();
        }
      });

      webContents.on("page-title-updated", (_event, title) => {
        const tab = this.tabs.find((t) => t.id === id);

        if (!tab) {
          return;
        }

        if (title.trim()) {
          tab.title = title.trim();
        }

        void this.updateMetaTags(tab).then(() => {
          this.afterUpdate();
        });
      });

      void webContents.loadURL(url);
    }

    return newContentView;
  }

  private emitStateChange(value: TabState) {
    publisher.publish("tabs.updated", value);
  }

  /** Written to disk -- excludes keepMounted views whose lifecycle is external. */
  private getPersistedState(): TabState {
    const persistedTabs = this.tabs.filter((tab) => !tab.keepMounted);
    const selectedIsPersisted = persistedTabs.some(
      (tab) => tab.id === this.selectedTabId,
    );
    return {
      selectedTabId: selectedIsPersisted ? this.selectedTabId : null,
      tabs: persistedTabs.map(
        ({ keepMounted: _k, webView: _webView, ...tab }) => tab,
      ),
    };
  }

  private selectNeighborTab(tab: Tab, _index: number) {
    const isSelected = this.selectedTabId === tab.id;

    if (isSelected) {
      const visible = this.visibleTabs();
      const visibleIndex = visible.findIndex((t) => t.id === tab.id);
      const nextTab = visible[visibleIndex + 1] ?? visible[visibleIndex - 1];
      if (nextTab) {
        this.selectTabView(nextTab);
      }
    }
  }

  private selectOnAddNewTab({ urlPath }: { urlPath: string }) {
    if (!SingleTabOnlyRoutes.test(urlPath)) {
      return false;
    }

    const existingTab = this.tabs.find((tab) => {
      const tabPathName = tab.pathname.split("?")[0];
      return urlPath === tabPathName;
    });

    if (existingTab) {
      this.selectTabView(existingTab);
      this.afterUpdate();
      return true;
    }

    return false;
  }

  private selectTabView(tab: TabWithView) {
    if (tab.webView.webContents?.isDestroyed()) {
      this.logger.warn(
        `selectTabView: skipping destroyed view for tab ${tab.id}`,
      );
      return;
    }

    const currentTab = this.getCurrentTab();
    if (currentTab && currentTab.id !== tab.id && !currentTab.keepMounted) {
      this.baseWindow.contentView.removeChildView(currentTab.webView);
    }

    this.updateTabBounds(tab);

    // Append to top of the z-stack. For background views this moves them to
    // the front; for regular tabs this covers any background views beneath.
    this.baseWindow.contentView.addChildView(tab.webView);

    // electron/electron#50249: webContents is undefined after destruction in Electron 41+
    tab.webView.webContents?.focus();
    this.selectedTabId = tab.id;
  }

  private async updateMetaTags(tab: TabWithView) {
    const metaTagQueries = {
      iconName: META_TAGS.iconName,
      projectSubdomain: META_TAGS.projectSubdomain,
    } as const;

    type MetaTagsResult = {
      [K in keyof typeof metaTagQueries]: string | undefined;
    };

    const queries = Object.entries(metaTagQueries)
      .map(
        ([key, name]) => `${JSON.stringify(key)}: (() => {
        const el = document.querySelector('meta[name="${name}"]');
        return el ? el.getAttribute('content') : undefined;
      })()`,
      )
      .join(",\n        ");

    const script = `
      (() => {
        return {
          ${queries}
        };
      })()
    `;

    try {
      const metaTags = (await tab.webView.webContents?.executeJavaScript(
        script,
      )) as MetaTagsResult;
      const iconNameResult = TabIconsSchema.safeParse(metaTags.iconName);
      tab.iconName = iconNameResult.success ? iconNameResult.data : undefined;
      const projectSubdomainResult = ProjectSubdomainSchema.safeParse(
        metaTags.projectSubdomain,
      );
      tab.projectSubdomain = projectSubdomainResult.success
        ? projectSubdomainResult.data
        : undefined;
    } catch (error) {
      captureServerException(
        new Error("Failed to update meta tags", { cause: error }),
        { scopes: ["studio"] },
      );
    }
  }

  private updateTabBounds(tab: TabWithView) {
    tab.webView.setBounds(this.computeTabBounds());
  }

  /** Non-keepMounted tabs that participate in tab bar UI and navigation. */
  private visibleTabs() {
    return this.tabs.filter((tab) => !tab.keepMounted);
  }
}
