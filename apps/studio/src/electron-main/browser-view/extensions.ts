import { publisher } from "@/electron-main/rpc/publisher";
import {
  BROWSER_EXTENSIONS_SESSION,
  ONE_PASSWORD_EXTENSION_ID,
} from "@/shared/browser-extensions";
import {
  type BaseWindow,
  BrowserWindow,
  session,
  type Session,
  type WebContents,
} from "electron";
import {
  ElectronChromeExtensions,
  setSessionPartitionResolver,
} from "electron-chrome-extensions";
import { installChromeWebStore } from "electron-chrome-web-store";
import { noop } from "radashi";

import { guests } from "./guest-registry";
import { log } from "./log";

/** How long a tab an extension asked for may take to mount before the ask fails. */
const TAB_OPEN_TIMEOUT_MS = 10_000;

let extensions: ElectronChromeExtensions | null = null;

/**
 * The guest a person is looking at: what an extension's popup acts on, and
 * the tab a tab it asks for opens beside.
 */
let currentTab: WebContents | null = null;

/** Tabs extensions asked for and are waiting on, each taking the next guest registered. */
const tabsAsked: ((tab: WebContents, window: BaseWindow) => void)[] = [];

/**
 * Chrome extension support on the in-app browser's session, behind the
 * `browser_extensions` flag: the library's APIs over Electron's own, with
 * each tab guest registered as a tab (`registerExtensionTab`) and the one a
 * person looks at as the active one (`selectExtensionTab`); the Chrome Web
 * Store's own install button, allowed 1Password alone, keeping what it
 * installs in `extensionsDir` beside the profile and loading it on every
 * boot; and what the extensions' workers log, in the log. The action
 * buttons' icons are served to the window by the `crx:` handler the app
 * session registers as it is made (`lib/app-session.ts`), which finds this
 * session by the name the buttons give it.
 */
export function enableBrowserExtensions(
  guestSession: Session,
  extensionsDir: string,
): void {
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
  });
  guestSession.serviceWorkers.on("console-message", (_event, details) => {
    if (details.sourceUrl.startsWith("chrome-extension://")) {
      log.info(
        `extension worker [${details.sourceUrl}:${details.lineNumber}] ${details.message}`,
      );
    }
  });
  installChromeWebStore({
    allowlist: [ONE_PASSWORD_EXTENSION_ID],
    extensionsPath: extensionsDir,
    session: guestSession,
  }).catch((error: unknown) => {
    log.error("the Chrome Web Store could not be set up", error);
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
