import { publisher } from "@/electron-main/rpc/publisher";
import { getWorkspacePreferences } from "@/electron-main/stores/workspace/preferences";
import {
  BROWSER_EXTENSIONS_SESSION,
  type BrowserExtension,
} from "@/shared/browser-extensions";
import {
  type BaseWindow,
  BrowserWindow,
  type NativeImage,
  session,
  type Session,
  type WebContents,
} from "electron";
import {
  ElectronChromeExtensions,
  setSessionPartitionResolver,
} from "electron-chrome-extensions";
import {
  installChromeWebStore,
  uninstallExtension,
} from "electron-chrome-web-store";
import { noop } from "radashi";
import { z } from "zod";

import {
  checkExtensionConnection,
  desktopAppOf,
  type ExtensionConnection,
  openDesktopApp,
} from "./extension-connection";
import { reloadOpenTabsFor } from "./extension-open-tabs";
import {
  type ExtensionManifest,
  permissionLines,
} from "./extension-permissions";
import { guests } from "./guest-registry";
import { log } from "./log";

/** How long a tab an extension asked for may take to mount before the ask fails. */
const TAB_OPEN_TIMEOUT_MS = 10_000;

let extensions: ElectronChromeExtensions | null = null;

/** The session the extensions run on and where their files are, once they are on. */
let enabled: null | { extensionsDir: string; session: Session } = null;

/**
 * The guest a person is looking at: what an extension's popup acts on, and
 * the tab a tab it asks for opens beside.
 */
let currentTab: WebContents | null = null;

/** Tabs extensions asked for and are waiting on, each taking the next guest registered. */
const tabsAsked: ((tab: WebContents, window: BaseWindow) => void)[] = [];

/** What each extension's desktop app last said of this browser, by extension id. */
const connections = new Map<string, ExtensionConnection | null>();

/** Extensions the person let the store install, by id, until each loads. */
const installsAllowed = new Set<string>();

/** The store's install questions waiting on a window's answer, by ask id. */
const installAsks = new Map<string, (allow: boolean) => void>();

const ManifestWordsSchema = z.object({
  description: z.string().catch(""),
});

/**
 * Chrome extension support on the in-app browser's session, turned on once
 * before the window is up (`guest-session.ts`), so the window's buttons find
 * it when they ask: the library's APIs over Electron's own, with each tab
 * guest registered as a tab (`registerExtensionTab`) and the one a person
 * looks at as the active one (`selectExtensionTab`); the Chrome Web Store's
 * own install button, asking first (`confirmInstall`) and keeping what it
 * installs in `extensionsDir` beside the
 * profile and loading it on every boot; and what the extensions' workers
 * log, in the log. The action buttons' icons are served to the window by
 * the `crx:` handler the app session registers as it is made
 * (`lib/app-session.ts`), which finds this session by the name the buttons
 * give it.
 */
export function enableBrowserExtensions(
  guestSession: Session,
  extensionsDir: string,
): void {
  if (enabled) {
    return;
  }
  enabled = { extensionsDir, session: guestSession };
  setSessionPartitionResolver((name) =>
    name === BROWSER_EXTENSIONS_SESSION
      ? guestSession
      : session.fromPartition(name),
  );
  extensions = new ElectronChromeExtensions({
    createTab: openTabAsked,
    removeTab: (tab) => {
      log.info(`an extension asked to close a tab guest=${tab.id}`);
    },
    selectTab: (tab) => {
      log.info(`an extension asked to select a tab guest=${tab.id}`);
    },
    session: guestSession,
  });
  guestSession.extensions.on("extension-loaded", (_event, extension) => {
    log.info(
      `extension loaded ${extension.name} ${extension.version} id=${extension.id}`,
    );
    publisher.publish("browser.extensions-changed", null);
    void recheckExtensionConnections();
    // Just installed, so the tabs already open have none of its content
    // scripts; one loaded at launch comes before any tab.
    if (installsAllowed.delete(extension.id)) {
      reloadOpenTabsFor(extension).catch((error: unknown) => {
        log.error("open tabs could not be reloaded for an extension", error);
      });
    }
  });
  guestSession.extensions.on("extension-unloaded", (_event, extension) => {
    log.info(`extension unloaded ${extension.name} id=${extension.id}`);
    connections.delete(extension.id);
    publisher.publish("browser.extensions-changed", null);
  });
  guestSession.serviceWorkers.on("console-message", (_event, details) => {
    if (details.sourceUrl.startsWith("chrome-extension://")) {
      log.info(
        `extension worker [${details.sourceUrl}:${details.lineNumber}] ${details.message}`,
      );
    }
  });
  installChromeWebStore({
    beforeInstall: confirmInstall,
    extensionsPath: extensionsDir,
    session: guestSession,
  }).catch((error: unknown) => {
    log.error("the Chrome Web Store could not be set up", error);
  });
}

/**
 * The question the store's install button raises before anything is added,
 * as Chrome's own does: the extension by name and icon and what it will be
 * able to do in a person's words, put to the window as a dialog of the
 * app's (`extension-install-modal.tsx`), which answers through
 * `answerExtensionInstall`. Every window hears the ask; the first answer
 * settles it and the rest are told so.
 */
function confirmInstall(details: {
  icon: NativeImage;
  id: string;
  localizedName: string;
  manifest: ExtensionManifest;
}): Promise<{ action: "allow" | "deny" }> {
  const askId = crypto.randomUUID();
  return new Promise((resolve) => {
    installAsks.set(askId, (allow) => {
      installAsks.delete(askId);
      if (allow) {
        installsAllowed.add(details.id);
      }
      publisher.publish("browser.extension-install-answered", { askId });
      resolve({ action: allow ? "allow" : "deny" });
    });
    publisher.publish("browser.extension-install-asked", {
      askId,
      icon: details.icon.toDataURL(),
      lines: permissionLines(details.manifest),
      name: details.localizedName,
    });
  });
}

/** A window's answer to the store's question; a late one, after another window answered, changes nothing. */
export function answerExtensionInstall(askId: string, allow: boolean): void {
  installAsks.get(askId)?.(allow);
}

/** The extensions the browser runs, for the window; none while they are off. */
export function listBrowserExtensions(): BrowserExtension[] {
  if (!enabled) {
    return [];
  }
  const unpinned = getWorkspacePreferences().get("unpinnedExtensions");
  return enabled.session.extensions
    .getAllExtensions()
    .map(({ id, manifest, name, version }) => ({
      connection: connections.get(id) ?? null,
      description: ManifestWordsSchema.parse(manifest).description,
      desktopApp: desktopAppOf(id),
      id,
      name,
      pinned: !unpinned.includes(id),
      version,
    }));
}

/** Puts an extension's button in the browser's row, or takes it out; the extension runs either way. */
export function setBrowserExtensionPinned(id: string, pinned: boolean): void {
  const preferences = getWorkspacePreferences();
  const unpinned = preferences
    .get("unpinnedExtensions")
    .filter((other) => other !== id);
  preferences.set("unpinnedExtensions", pinned ? unpinned : [...unpinned, id]);
  publisher.publish("browser.extensions-changed", null);
}

/**
 * Asks each extension's desktop app again whether it takes this browser,
 * and tells the window when an answer changed: at launch, as an extension
 * loads, and when the window asks after the person has been away in the
 * app approving it.
 */
export async function recheckExtensionConnections(): Promise<void> {
  if (!enabled) {
    return;
  }
  let changed = false;
  for (const { id } of enabled.session.extensions.getAllExtensions()) {
    if (!desktopAppOf(id)) {
      continue;
    }
    const connection = await checkExtensionConnection(id);
    if (connections.get(id) !== connection) {
      log.info(`extension ${id} desktop app connection: ${String(connection)}`);
      connections.set(id, connection);
      changed = true;
    }
  }
  if (changed) {
    publisher.publish("browser.extensions-changed", null);
  }
}

/** Opens the app an extension talks to, for the person to approve this browser in it. */
export function openExtensionDesktopApp(id: string): Promise<void> {
  return openDesktopApp(id);
}

/** Takes an extension out of the browser and off the disk. */
export async function removeBrowserExtension(id: string): Promise<void> {
  if (!enabled) {
    return;
  }
  await uninstallExtension(id, {
    extensionsPath: enabled.extensionsDir,
    session: enabled.session,
  });
}

/**
 * Makes a tab guest a tab the extensions see, in the window that hosts it,
 * and hands it to an extension waiting on a tab it asked for. Returns what
 * takes the tab away again, which runs while the guest is alive.
 */
export function registerExtensionTab(guest: WebContents): () => void {
  if (!extensions) {
    return noop;
  }
  const host = guest.hostWebContents;
  const window =
    (host && BrowserWindow.fromWebContents(host)) ??
    BrowserWindow.getFocusedWindow();
  if (!window) {
    log.warn(`no window to register guest=${guest.id} with the extensions`);
    return noop;
  }
  extensions.addTab(guest, window);
  tabsAsked.shift()?.(guest, window);
  return () => {
    if (!guest.isDestroyed()) {
      extensions?.removeTab(guest);
    }
  };
}

/**
 * Makes a window a page opened (a sign-in popup) a tab the extensions see,
 * in that window, until its contents is destroyed, which the library
 * watches itself. An extension's menu drawn in the popup acts through the
 * tab it is in, and a tab the extensions never met answers nothing.
 */
export function registerExtensionWindow(window: BrowserWindow): void {
  if (!extensions) {
    return;
  }
  extensions.addTab(window.webContents, window);
  log.info(
    `a window a page opened is a tab for the extensions guest=${window.webContents.id}`,
  );
}

/** Tells the extensions which tab a person is looking at. */
export function selectExtensionTab(guest: WebContents): void {
  currentTab = guest;
  extensions?.selectTab(guest);
}

/**
 * A tab an extension asked for (`chrome.tabs.create`) opens the way a page's
 * own new-tab link does, beside the tab a person is looking at, and resolves
 * with the guest the window mounts for it.
 */
function openTabAsked(details: {
  active?: boolean;
  url?: string;
}): Promise<[WebContents, BaseWindow]> {
  const opener =
    currentTab && !currentTab.isDestroyed()
      ? guests.get(currentTab.id)?.entry
      : undefined;
  if (!opener) {
    return Promise.reject(new Error("no tab is shown to open one beside"));
  }
  publisher.publish("browser.open-in-new-tab", {
    background: details.active === false,
    targetId: opener.targetId,
    url: details.url ?? "about:blank",
  });
  return new Promise((resolve, reject) => {
    const take = (tab: WebContents, window: BaseWindow) => {
      clearTimeout(timer);
      resolve([tab, window]);
    };
    const timer = setTimeout(() => {
      const at = tabsAsked.indexOf(take);
      if (at !== -1) {
        tabsAsked.splice(at, 1);
      }
      reject(new Error("the tab an extension asked for did not open"));
    }, TAB_OPEN_TIMEOUT_MS);
    tabsAsked.push(take);
  });
}
