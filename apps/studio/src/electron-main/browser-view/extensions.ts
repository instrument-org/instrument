import {
  type ExtensionAccess,
  extensionRecord,
  forgetExtensionRecord,
  updateExtensionRecord,
} from "@/electron-main/stores/workspace/browser-extensions";
import { publisher } from "@/electron-main/rpc/publisher";
import { getWorkspacePreferences } from "@/electron-main/stores/workspace/preferences";
import { openStepsWindow } from "@/electron-main/windows/steps-window";
import {
  BROWSER_EXTENSIONS_SESSION,
  type BrowserExtension,
  CHROME_WEB_STORE_URL,
  desktopAppSteps,
} from "@/shared/browser-extensions";
import { APP_NAME } from "@instrument-org/shared";
import { matchesAccelerator } from "@/electron-main/menus/match-accelerator";
import { commandWindow } from "@/electron-main/windows/window-command";
import { osOf } from "@/shared/os-conventions";
import {
  type BrowserTargetId,
  BrowserTargetIdSchema,
  notePageOpenedTab,
  StoreId,
} from "@instrument-org/workspace/electron";
import {
  BaseWindow,
  BrowserWindow,
  type Extension,
  ipcMain,
  type IpcMainInvokeEvent,
  Menu,
  type NativeImage,
  session,
  type Session,
  type WebContents,
  webContents,
  WebContentsView,
} from "electron";
import {
  ElectronChromeExtensions,
  setSessionPartitionResolver,
} from "electron-chrome-extensions";
import { installChromeWebStore } from "electron-chrome-web-store";
import fs from "node:fs/promises";
import path from "node:path";
import { noop } from "radashi";
import { z } from "zod";

import {
  checkExtensionConnection,
  desktopAppOf,
  type ExtensionConnection,
  openDesktopApp,
} from "./extension-connection";
import {
  ACTION_COMMANDS,
  assignCommands,
  collidesWith,
  type ExtensionCommand,
  reportedCommand,
} from "./extension-commands";
import { unsupportedFeatures } from "./extension-support";
import {
  addVersion,
  chooseVersion,
  clearAside,
  describeVersion,
  type InstalledVersion,
  readInstalls,
  removeInstall,
  removeLeftoverData,
  removeOtherVersions,
} from "./extension-installs";
import { reloadOpenTabsFor } from "./extension-open-tabs";
import {
  accessOf,
  coversOrigins,
  joinAccess,
  newAccessLines,
  permissionLines,
} from "./extension-permissions";
import {
  compareExtensionVersions,
  downloadStorePackage,
  fetchStorePackages,
} from "./extension-store-updates";
import { guests } from "./guest-registry";
import { log } from "./log";

/** How long a tab an extension asked for may take to mount before the ask fails. */
const TAB_OPEN_TIMEOUT_MS = 10_000;

/** How often the store is asked for newer versions, as often as Chrome asks. */
const UPDATE_CHECK_MS = 5 * 60 * 60 * 1000;

/** How long an extension's page gets to clear its storage as it is removed. */
const CLEAR_STORAGE_MS = 5000;

let extensions: ElectronChromeExtensions | null = null;

/** The session the extensions run on and where their files are, once they are on. */
let enabled: null | { extensionsDir: string; session: Session } = null;

/**
 * The guest a person is looking at: what an extension's popup acts on, and
 * the tab a tab it asks for opens beside.
 */
let currentTab: WebContents | null = null;

/**
 * Whether the app itself is adding, selecting or removing a tab, which the
 * library reports through the same callbacks as an extension's ask.
 */
let isAppActing = false;

/** Runs the app's own change to the tabs the extensions see. */
function asApp(act: () => void): void {
  const was = isAppActing;
  isAppActing = true;
  try {
    act();
  } finally {
    isAppActing = was;
  }
}

/**
 * Tabs extensions asked for and are waiting on, by the target the tab opens
 * under, each with the window the extensions count it in: an extension's own
 * window (`openWindowAsked`), or the window that hosts it.
 */
const tabsAsked = new Map<
  BrowserTargetId,
  { into?: BaseWindow; take: (tab: WebContents, window: BaseWindow) => void }
>();

/**
 * The windows extensions opened (`chrome.windows.create`), each a hidden
 * window of its own that is never shown, standing for a set of tabs in the
 * group the extension's page was in: what it counts as that window's tabs,
 * by tab guest, with the tab each opened beside.
 */
const extensionWindows = new Map<
  BaseWindow,
  Map<WebContents, { besideId: BrowserTargetId; targetId: BrowserTargetId }>
>();

/** What each extension's desktop app last said of this browser, by extension id. */
const connections = new Map<string, ExtensionConnection | null>();

/** Extensions the person just added or turned on, by id, until each loads. */
const justAllowed = new Set<string>();

/** How long a question about an extension waits before it counts as refused. */
const ASK_TIMEOUT_MS = 5 * 60 * 1000;

/** The last question put to the windows, which the next waits for. */
let lastAsk: Promise<unknown> = Promise.resolve();

/** The questions about an extension waiting on a window's answer, by ask id. */
const installAsks = new Map<string, (allow: boolean) => void>();

/** The versions that would not load since launch, by their folder, which are not tried again. */
const failedPaths = new Set<string>();

/** The extensions that ran since launch, whose stored data Chromium has open. */
const ranSinceLaunch = new Set<string>();

/** The last change to what is installed, which the next waits for. */
let lastChange: Promise<unknown> = Promise.resolve();

/** Runs one change to what is installed or running at a time. */
function inTurn<T>(change: () => Promise<T>): Promise<T> {
  const turn = lastChange.then(change);
  lastChange = turn.catch(noop);
  return turn;
}

const OS = osOf(process.platform);

/** The extensions running, by id in the order they loaded, which settles two asking for one key. */
const loadOrder: string[] = [];

/** Every running extension's commands, with the key each runs on. */
let commands: ExtensionCommand[] = [];

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
 * installs in `extensionsDir` beside the profile; loading what is installed
 * and turned on, and keeping it current (`checkForExtensionUpdates`). What
 * the extensions' workers log stays in their DevTools, as in Chrome. The
 * action buttons' icons are served to the window by the `crx:` handler the
 * app session registers as it is made (`lib/app-session.ts`), which finds
 * this session by the name the buttons give it.
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
    createTab: (details) => openTabAsked(details),
    createWindow: openWindowAsked,
    grantedPermissions: ({ id }) => extensionRecord(id)?.optional,
    // Neither is carried out: the tab stays as the person left it.
    removeTab: (tab) => {
      if (!isAppActing && !tab.isDestroyed()) {
        log.info(`an extension asked to close a tab guest=${tab.id}`);
      }
    },
    selectTab: (tab) => {
      if (!isAppActing) {
        log.info(`an extension asked to select a tab guest=${tab.id}`);
      }
    },
    removeWindow: closeWindowAsked,
    requestPermissions: confirmPermissions,
    session: guestSession,
    takeInstalled: ({ id }) => {
      const installed = extensionRecord(id)?.installed ?? null;
      if (installed) {
        updateExtensionRecord(id, { installed: null });
      }
      return installed;
    },
  });
  guestSession.extensions.on("extension-loaded", (_event, extension) => {
    log.info(
      `extension loaded ${extension.name} ${extension.version} id=${extension.id}`,
    );
    publisher.publish("browser.extensions-changed", null);
    void recheckExtensionConnections();
    reassignCommands(guestSession, [
      ...loadOrder.filter((id) => id !== extension.id),
      extension.id,
    ]);
    // Just added or turned on, so the tabs already open have none of its content
    // scripts; one loaded at launch comes before any tab.
    if (justAllowed.delete(extension.id)) {
      reloadOpenTabsFor(extension).catch((error: unknown) => {
        log.error("open tabs could not be reloaded for an extension", error);
      });
    }
  });
  guestSession.extensions.on("extension-unloaded", (_event, extension) => {
    log.info(`extension unloaded ${extension.name} id=${extension.id}`);
    connections.delete(extension.id);
    publisher.publish("browser.extensions-changed", null);
    reassignCommands(
      guestSession,
      loadOrder.filter((id) => id !== extension.id),
    );
  });
  // A worker that stopped may leave its extension idle, which is when an
  // update it was too busy for can load.
  guestSession.serviceWorkers.on("running-status-changed", (details) => {
    if (details.runningStatus === "stopped") {
      applyReadyUpdates();
    }
  });
  extensions.handleApiCall("commands.getAll", ({ extension }) =>
    commands
      .filter((command) => command.extensionId === extension.id)
      .map((command) => reportedCommand(command, OS)),
  );
  installChromeWebStore({
    autoUpdate: false,
    beforeInstall: confirmInstall,
    extensionsPath: extensionsDir,
    loadExtensions: false,
    session: guestSession,
  }).catch((error: unknown) => {
    log.error("the Chrome Web Store could not be set up", error);
  });
  answerStorePage(guestSession);
  inTurn(() => loadInstalled(guestSession, extensionsDir)).then(
    () => {
      checkForExtensionUpdates();
      setInterval(checkForExtensionUpdates, UPDATE_CHECK_MS);
    },
    (error: unknown) => {
      log.error("the installed extensions could not be loaded", error);
    },
  );
}

/**
 * Gives the running extensions' commands their keys again, after one loaded
 * or unloaded. A key the app's menu binds stays the app's, so the command
 * has none, as in Chrome, which refuses a key the browser has.
 */
function reassignCommands(guestSession: Session, order: string[]): void {
  loadOrder.splice(0, loadOrder.length, ...order);
  const menuAccelerators = appAccelerators();
  commands = assignCommands(
    loadOrder.flatMap((id) => guestSession.extensions.getExtension(id) ?? []),
    OS,
  ).map((command) =>
    command.accelerator !== null &&
    collidesWith(command.accelerator, menuAccelerators, OS)
      ? { ...command, accelerator: null }
      : command,
  );
}

/** Every accelerator the app's menu binds. */
function appAccelerators(): string[] {
  const found: string[] = [];
  const walk = (menu: Menu | null | undefined) => {
    for (const item of menu?.items ?? []) {
      if (item.accelerator) {
        found.push(item.accelerator);
      }
      walk(item.submenu);
    }
  };
  walk(Menu.getApplicationMenu());
  return found;
}

/**
 * Runs an extension's command when its key is pressed in `contents`, a page
 * of the in-app browser or a window one opened, ahead of the page, as
 * Chrome's browser-wide keys are. A chord the app's menu binds is never an
 * extension's (`reassignCommands`), checked again on the press since the
 * menu is built again as the app changes.
 */
export function listenForExtensionCommands(contents: WebContents): void {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat) {
      return;
    }
    const command = commands.find(
      ({ accelerator }) =>
        accelerator !== null &&
        matchesAccelerator(input, accelerator, { isMac: OS === "mac" }),
    );
    if (
      !command?.accelerator ||
      collidesWith(command.accelerator, appAccelerators(), OS)
    ) {
      return;
    }
    event.preventDefault();
    runExtensionCommand(command, contents);
  });
}

/**
 * An extension's command for the tab it was pressed in, or the one a person
 * is looking at when it was pressed in a window a page opened: an action's
 * command presses the extension's button in that tab's window, which opens
 * its popup or tells it it was clicked; any other reaches the extension's
 * `chrome.commands.onCommand` with the tab.
 */
function runExtensionCommand(command: ExtensionCommand, from: WebContents) {
  const tab = extensions?.getTabDetails(from)
    ? from
    : currentTab && !currentTab.isDestroyed()
      ? currentTab
      : null;
  log.info(
    `extension ${command.extensionId} command ${command.name} guest=${String(tab?.id)}`,
  );
  if (ACTION_COMMANDS.has(command.name)) {
    // A window a page opened has no host; its opener's tab is in one.
    const host = [tab, currentTab].find(
      (contents) => contents && !contents.isDestroyed() && contents.hostWebContents,
    )?.hostWebContents;
    const window =
      host && !host.isDestroyed() ? BrowserWindow.fromWebContents(host) : null;
    if (window) {
      commandWindow(window, {
        extensionId: command.extensionId,
        type: "openExtensionPopup",
      });
    }
    return;
  }
  extensions?.sendExtensionEvent(
    command.extensionId,
    "commands.onCommand",
    command.name,
    tab ? extensions.getTabDetails(tab) : undefined,
  );
}

/**
 * Answers the store page's own controls for an extension already installed
 * (Remove, and turning it off and on) with what the Extensions page does,
 * in place of the library's answers.
 */
function answerStorePage(guestSession: Session): void {
  const answer = (
    channel: string,
    act: (event: IpcMainInvokeEvent, id: string, arg: unknown) => unknown,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, id: unknown, arg: unknown) => {
      if (
        event.sender.session !== guestSession ||
        event.senderFrame?.origin !== new URL(CHROME_WEB_STORE_URL).origin ||
        typeof id !== "string"
      ) {
        return undefined;
      }
      return await act(event, id, arg);
    });
  };
  answer("chrome.management.setEnabled", async (_event, id, on) => {
    await setBrowserExtensionEnabled(id, on === true);
    return true;
  });
  answer("chrome.management.uninstall", async ({ sender }, id) => {
    try {
      await removeBrowserExtension(id);
    } catch (error) {
      log.error(`extension ${id} could not be removed`, error);
      return "unknown_error";
    }
    queueMicrotask(() => {
      if (!sender.isDestroyed()) {
        sender.send("chrome.management.onUninstalled", id);
      }
    });
    return "success";
  });
}

/**
 * Loads what is installed and turned on, each in the newest version the
 * person has agreed to, after deleting the stored data of extensions since
 * removed. An extension with no record yet was agreed to as it is.
 */
async function loadInstalled(
  guestSession: Session,
  extensionsDir: string,
): Promise<void> {
  const installs = await readInstalls(extensionsDir);
  if (!installs) {
    throw new Error(`the extensions at ${extensionsDir} cannot be read`);
  }
  for (const [id, versions] of installs) {
    if (versions.length === 0) {
      // Goes only when empty, as a removal cut short leaves it.
      await fs
        .rmdir(path.join(extensionsDir, id))
        .then(() => installs.delete(id), noop);
    }
  }
  await clearAside(extensionsDir).catch((error: unknown) => {
    log.warn("removed extensions' files stay", error);
  });
  if (guestSession.storagePath) {
    // A removal forgets the record, so one with a record and no folder was
    // lost some other way, and its data stays.
    const removed = await removeLeftoverData(
      guestSession.storagePath,
      (id) => installs.has(id) || extensionRecord(id) !== undefined,
    );
    if (removed.length > 0) {
      log.info(`removed extensions' data deleted: ${removed.join(", ")}`);
    }
  }
  for (const [id, versions] of installs) {
    // The oldest, since a newer one may be waiting on the person.
    const oldest = versions.at(-1);
    if (!oldest) {
      continue;
    }
    if (!extensionRecord(id)) {
      updateExtensionRecord(id, {
        required: accessOf(oldest.manifest),
        version: oldest.version,
      });
    }
    if (!extensionRecord(id)?.disabled) {
      await loadExtension(guestSession, id, versions).catch(
        (error: unknown) => {
          log.error(`extension ${id} could not be loaded`, error);
        },
      );
    }
  }
}

/** What a person agreed to let an extension reach. */
function requiredAccess(id: string): ExtensionAccess {
  return extensionRecord(id)?.required ?? { origins: [], permissions: [] };
}

/**
 * Loads an extension in the newest version the person has agreed to, or an
 * older one still on disk when that one will not load, and deletes the
 * versions nothing needs.
 */
async function loadExtension(
  guestSession: Session,
  id: string,
  versions: readonly InstalledVersion[],
): Promise<void> {
  ranSinceLaunch.add(id);
  let failure: unknown = new Error("no version of it can run");
  const candidates = () =>
    chooseVersion(
      versions.filter((version) => !failedPaths.has(version.path)),
      requiredAccess(id),
    ).loadable;
  for (let loadable = candidates(); loadable; loadable = candidates()) {
    const before = extensionRecord(id);
    const last = before?.version ?? null;
    // Ahead of the load, which starts the worker that asks.
    updateExtensionRecord(id, {
      version: loadable.version,
      ...(last !== null && last !== loadable.version && !before?.installed
        ? { installed: { previousVersion: last, reason: "update" as const } }
        : {}),
    });
    try {
      await guestSession.extensions.loadExtension(loadable.path);
      await removeOtherVersions(versions, [loadable, versions[0]]);
      return;
    } catch (error) {
      failure = error;
      log.error(`extension ${id} ${loadable.version} did not load`, error);
      updateExtensionRecord(id, {
        installed: before?.installed ?? null,
        version: last,
      });
      failedPaths.add(loadable.path);
    }
  }
  throw failure;
}

/**
 * Whether an extension is doing nothing an update would interrupt: its
 * worker is stopped and none of its pages, popups or frames is open.
 */
function isIdle(guestSession: Session, id: string): boolean {
  const origin = `chrome-extension://${id}`;
  const runs = Object.values(guestSession.serviceWorkers.getAllRunning()).some(
    ({ scope }) => scope.startsWith(`${origin}/`),
  );
  return (
    !runs &&
    !webContents
      .getAllWebContents()
      .some(
        (contents) =>
          !contents.isDestroyed() &&
          contents.session === guestSession &&
          contents.mainFrame.framesInSubtree.some(({ url }) =>
            url.startsWith(`${origin}/`),
          ),
      )
  );
}

/** Whether a pass over the ready updates is waiting its turn. */
let isApplying = false;

/**
 * Loads each downloaded update whose extension is idle. One that never is
 * loads at the next launch.
 */
function applyReadyUpdates(): void {
  if (isApplying) {
    return;
  }
  isApplying = true;
  inTurn(async () => {
    isApplying = false;
    if (!enabled) {
      return;
    }
    const { extensionsDir, session: guestSession } = enabled;
    const installs = await readInstalls(extensionsDir);
    for (const { id, version } of guestSession.extensions.getAllExtensions()) {
      const versions = installs?.get(id) ?? [];
      const { loadable } = chooseVersion(versions, requiredAccess(id));
      if (
        loadable &&
        !failedPaths.has(loadable.path) &&
        compareExtensionVersions(loadable.version, version) > 0 &&
        isIdle(guestSession, id)
      ) {
        log.info(`extension ${id} updating ${version} to ${loadable.version}`);
        guestSession.extensions.removeExtension(id);
        await loadExtension(guestSession, id, versions).catch(
          (error: unknown) => {
            log.error(`extension ${id} could not be updated`, error);
          },
        );
      }
    }
  }).catch((error: unknown) => {
    log.error("an extension's update could not be loaded", error);
  });
}

/**
 * Downloads each installed extension's newer version from the store. One
 * that asks for nothing new loads once the extension is idle or at the next
 * launch; one that asks for more waits on the person, with the version that
 * runs left running (`acceptExtensionUpdate`).
 */
function checkForExtensionUpdates(): void {
  if (!enabled) {
    return;
  }
  const { extensionsDir } = enabled;
  downloadUpdates(extensionsDir)
    .then(applyReadyUpdates)
    .catch((error: unknown) => {
      log.warn("extension updates could not be checked", error);
    });
}

async function downloadUpdates(extensionsDir: string): Promise<void> {
  const installs = await readInstalls(extensionsDir);
  for (const found of await fetchStorePackages([...(installs?.keys() ?? [])])) {
    const isNewer = (newest: InstalledVersion | undefined) =>
      newest !== undefined &&
      compareExtensionVersions(found.version, newest.version) > 0;
    if (!isNewer(installs?.get(found.id)?.[0])) {
      continue;
    }
    try {
      const verified = await downloadStorePackage(found);
      await inTurn(async () => {
        // The person may have removed it while it downloaded.
        const now = await readInstalls(extensionsDir);
        if (isNewer(now?.get(found.id)?.[0])) {
          const added = await addVersion(extensionsDir, found.id, verified);
          const kept = now?.get(found.id) ?? [];
          const { loadable } = chooseVersion(kept, requiredAccess(found.id));
          const runningPath = enabled?.session.extensions.getExtension(
            found.id,
          )?.path;
          await removeOtherVersions(kept, [
            added,
            loadable ?? undefined,
            kept.find((version) => version.path === runningPath),
          ]);
          log.info(`extension ${found.id} downloaded ${found.version}`);
        }
      });
    } catch (error) {
      log.error(
        `extension ${found.id} could not be updated to ${found.version}`,
        error,
      );
    }
  }
  publisher.publish("browser.extensions-changed", null);
}

/** Takes the update waiting on the person, when it is the version they were shown. */
export function acceptExtensionUpdate(
  id: string,
  version: string,
): Promise<void> {
  return inTurn(async () => {
    if (!enabled) {
      return;
    }
    const { extensionsDir, session: guestSession } = enabled;
    const versions = (await readInstalls(extensionsDir))?.get(id) ?? [];
    const { awaiting } = chooseVersion(versions, requiredAccess(id));
    if (awaiting?.version.version !== version) {
      throw new Error("a different version is waiting");
    }
    updateExtensionRecord(id, {
      required: joinAccess(
        requiredAccess(id),
        accessOf(awaiting.version.manifest),
      ),
    });
    if (!extensionRecord(id)?.disabled) {
      if (guestSession.extensions.getExtension(id)) {
        guestSession.extensions.removeExtension(id);
      }
      justAllowed.add(id);
      await loadExtension(guestSession, id, versions);
    }
    publisher.publish("browser.extensions-changed", null);
  });
}

/** Turns an extension off, keeping it and its data, or on again. */
export function setBrowserExtensionEnabled(
  id: string,
  on: boolean,
): Promise<void> {
  return inTurn(async () => {
    if (!enabled) {
      return;
    }
    const { extensionsDir, session: guestSession } = enabled;
    const versions = (await readInstalls(extensionsDir))?.get(id);
    if (!versions) {
      return;
    }
    const isRunning = guestSession.extensions.getExtension(id) !== null;
    if (on && !isRunning) {
      for (const version of versions) {
        failedPaths.delete(version.path);
      }
      justAllowed.add(id);
      await loadExtension(guestSession, id, versions);
    } else if (!on && isRunning) {
      guestSession.extensions.removeExtension(id);
    }
    updateExtensionRecord(id, { disabled: !on });
    publisher.publish("browser.extensions-changed", null);
  });
}

/**
 * The question the store's install button raises before anything is added,
 * as Chrome's own does: the extension by name and icon and what it will be
 * able to do in a person's words. Once allowed, the package is downloaded
 * and checked here and loaded when it asks for nothing the question did not
 * say; the library, finding it running, downloads nothing of its own.
 */
async function confirmInstall(details: {
  icon: NativeImage;
  id: string;
  localizedName: string;
  manifest: unknown;
}): Promise<{ action: "allow" | "deny" }> {
  const { id } = details;
  const shown = accessOf(details.manifest);
  const allowed = await askWindows({
    icon: details.icon.toDataURL(),
    kind: "add",
    lines: permissionLines(shown),
    name: details.localizedName,
    unsupported: unsupportedFeatures(details.manifest),
  });
  if (!allowed) {
    return { action: "deny" };
  }
  const [found] = await fetchStorePackages([id]);
  if (found?.id !== id) {
    throw new Error("the store has no package for it");
  }
  const verified = await downloadStorePackage(found);
  await inTurn(async () => {
    if (!enabled) {
      throw new Error("extensions are off");
    }
    const { extensionsDir } = enabled;
    const before = (await readInstalls(extensionsDir))?.get(id) ?? [];
    const added = await addVersion(extensionsDir, id, verified, (manifest) =>
      newAccessLines(shown, accessOf(manifest)).length > 0
        ? "the package asks for more than its store page said"
        : undefined,
    );
    const access = accessOf(added.manifest);
    await removeOtherVersions(before, [added]);
    const last = extensionRecord(id)?.version ?? null;
    updateExtensionRecord(id, {
      disabled: false,
      installed:
        last === null
          ? { reason: "install" }
          : last === added.version
            ? null
            : { previousVersion: last, reason: "update" },
      required: access,
      version: added.version,
    });
    justAllowed.add(id);
    failedPaths.delete(added.path);
    // Loaded here, so the library, finding it running, installs nothing.
    await loadExtension(enabled.session, id, [added]);
  });
  return { action: "allow" };
}

/**
 * The question an extension raises by asking for more while it runs
 * (`chrome.permissions.request`). It may ask only for what its manifest says
 * it may, and is asked about only when a person would notice what is new.
 */
async function confirmPermissions(
  { id, manifest, name, path: dir }: Extension,
  asked: { origins?: string[]; permissions?: string[] },
): Promise<boolean> {
  const access: ExtensionAccess = {
    origins: asked.origins ?? [],
    permissions: asked.permissions ?? [],
  };
  const declared = accessOf(manifest);
  const optional = OptionalManifestSchema.parse(manifest);
  if (
    !coversOrigins(
      [...declared.origins, ...optional.optional_host_permissions],
      access.origins,
    ) ||
    !access.permissions.every(
      (permission) =>
        declared.permissions.includes(permission) ||
        optional.optional_permissions.includes(permission),
    )
  ) {
    return false;
  }
  const held = joinAccess(
    requiredAccess(id),
    extensionRecord(id)?.optional ?? { origins: [], permissions: [] },
  );
  const lines = newAccessLines(held, access);
  if (lines.length > 0) {
    const versions = enabled && (await readInstalls(enabled.extensionsDir));
    const running = versions?.get(id)?.find((version) => version.path === dir);
    const allowed = await askWindows({
      icon: running ? (await describeVersion(running)).icon : null,
      kind: "allow-more",
      lines,
      name,
      unsupported: [],
    });
    if (!allowed) {
      return false;
    }
  }
  const record = extensionRecord(id);
  if (!record) {
    return false;
  }
  updateExtensionRecord(id, { optional: joinAccess(record.optional, access) });
  return true;
}

const OptionalManifestSchema = z.object({
  optional_host_permissions: z.array(z.string()).catch([]),
  optional_permissions: z.array(z.string()).catch([]),
});

/**
 * Puts a question about an extension to the window as a dialog of the app's
 * (`extension-install-modal.tsx`), which answers through
 * `answerExtensionInstall`. Every window hears it, one question at a time;
 * the first answer settles it and the rest are told so.
 */
function askWindows(question: {
  icon: null | string;
  kind: "add" | "allow-more";
  lines: string[];
  name: string;
  unsupported: string[];
}): Promise<boolean> {
  const turn = lastAsk.then(
    () =>
      new Promise<boolean>((resolve) => {
        const askId = crypto.randomUUID();
        const settle = (allow: boolean) => {
          clearTimeout(timer);
          installAsks.delete(askId);
          publisher.publish("browser.extension-install-answered", { askId });
          resolve(allow);
        };
        // A window can go away with the question unanswered.
        const timer = setTimeout(() => {
          settle(false);
        }, ASK_TIMEOUT_MS);
        installAsks.set(askId, settle);
        publisher.publish("browser.extension-install-asked", {
          askId,
          ...question,
        });
      }),
  );
  lastAsk = turn;
  return turn;
}

/** A window's answer to a question about an extension; a late one, after another window answered, changes nothing. */
export function answerExtensionInstall(askId: string, allow: boolean): void {
  installAsks.get(askId)?.(allow);
}

/** The extensions installed, for the window, running or turned off; none while they are off. */
export async function listBrowserExtensions(): Promise<BrowserExtension[]> {
  if (!enabled) {
    return [];
  }
  const { extensionsDir, session: guestSession } = enabled;
  const unpinned = getWorkspacePreferences().get("unpinnedExtensions");
  const installs = await readInstalls(extensionsDir);
  const running = new Map(
    guestSession.extensions
      .getAllExtensions()
      .map((extension) => [extension.id, extension]),
  );
  const listed: BrowserExtension[] = [];
  for (const id of new Set([...running.keys(), ...(installs?.keys() ?? [])])) {
    const extension = running.get(id);
    const { awaiting, loadable } = chooseVersion(
      installs?.get(id) ?? [],
      requiredAccess(id),
    );
    const manifest: unknown = extension?.manifest ?? loadable?.manifest;
    const shown = extension
      ? {
          description: ManifestWordsSchema.parse(extension.manifest)
            .description,
          icon: null,
          name: extension.name,
        }
      : loadable && (await describeVersion(loadable));
    if (shown) {
      listed.push({
        ...shown,
        connection: connections.get(id) ?? null,
        desktopApp: desktopAppOf(id),
        enabled: extension !== undefined,
        id,
        pinned: !unpinned.includes(id),
        unsupported: unsupportedFeatures(manifest),
        update: awaiting && {
          lines: awaiting.lines,
          version: awaiting.version.version,
        },
        version: extension?.version ?? loadable?.version ?? "",
      });
    }
  }
  return listed;
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
    if (desktopAppOf(id) && (await recheckConnection(id))) {
      changed = true;
    }
  }
  if (changed) {
    publisher.publish("browser.extensions-changed", null);
  }
}

/** Asks one extension's desktop app again, keeping its answer; whether the answer changed. */
async function recheckConnection(id: string): Promise<boolean> {
  const connection = await checkExtensionConnection(id);
  if (connections.get(id) === connection) {
    return false;
  }
  log.info(`extension ${id} desktop app connection: ${String(connection)}`);
  connections.set(id, connection);
  return true;
}

/** How often the steps card asks the desktop app again while it is up, and for how long. */
const STEPS_RECHECK_MS = 2000;
const STEPS_RECHECK_FOR_MS = 10 * 60_000;
/** How long the card stays up saying the app is connected. */
const CONNECTED_CARD_MS = 8000;

/**
 * Opens the app an extension talks to, for the person to approve this
 * browser in it, with the steps floating over it until the app takes this
 * browser, on the systems where the app has a screen for that.
 */
export async function openExtensionDesktopApp(
  id: string,
  {
    comeBack,
    opener,
  }: {
    /** Brings Instrument back to the front, for the card's button once the app is connected. */
    comeBack: () => void;
    /** The app window the card goes with. */
    opener: BrowserWindow | null;
  },
): Promise<void> {
  await openDesktopApp(id);
  const desktopApp = desktopAppOf(id);
  const steps =
    desktopApp &&
    desktopAppSteps(
      desktopApp.name,
      process.platform === "darwin"
        ? "mac"
        : process.platform === "win32"
          ? "windows"
          : "linux",
    );
  if (!desktopApp || !steps) {
    return;
  }
  const title = `Connect ${desktopApp.name}`;
  let timer: NodeJS.Timeout | undefined;
  const card = openStepsWindow(
    `connect:${id}`,
    {
      foot: `This window closes once ${desktopApp.name} is connected.`,
      steps,
      title,
    },
    {
      onAction: (action) => {
        if (action === "back") {
          card?.close();
          comeBack();
        }
      },
      onClosed: () => {
        clearTimeout(timer);
      },
      opener,
    },
  );
  if (!card) {
    return;
  }
  const until = Date.now() + STEPS_RECHECK_FOR_MS;
  const recheck = async () => {
    if (card.isClosed()) {
      return;
    }
    if (await recheckConnection(id)) {
      publisher.publish("browser.extensions-changed", null);
    }
    if (card.isClosed()) {
      return;
    }
    if (connections.get(id) === "connected") {
      card.show({
        button: { action: "back", label: `Back to ${APP_NAME}` },
        done: `${desktopApp.name} is connected to ${APP_NAME}.`,
        title,
      });
      timer = setTimeout(card.close, CONNECTED_CARD_MS);
      return;
    }
    if (Date.now() < until) {
      timer = setTimeout(() => void recheck(), STEPS_RECHECK_MS);
    }
  };
  timer = setTimeout(() => void recheck(), STEPS_RECHECK_MS);
}

/**
 * Takes an extension out of the browser and off the disk, with what it
 * stored, so adding it again starts fresh. What its storage leaves in files
 * Chromium has open goes at the next launch (`removeLeftoverData`).
 */
export function removeBrowserExtension(id: string): Promise<void> {
  return inTurn(async () => {
    if (!enabled) {
      return;
    }
    const { extensionsDir, session: guestSession } = enabled;
    const installs = await readInstalls(extensionsDir);
    if (!installs?.has(id)) {
      return;
    }
    if (guestSession.extensions.getExtension(id)) {
      await clearExtensionStorage(guestSession, id).catch((error: unknown) => {
        log.warn(
          `extension ${id}'s storage stays until the next launch`,
          error,
        );
      });
      guestSession.extensions.removeExtension(id);
    }
    await removeInstall(extensionsDir, id);
    forgetExtensionRecord(id);
    await guestSession.clearStorageData({ origin: `chrome-extension://${id}` });
    if (guestSession.storagePath && !ranSinceLaunch.has(id)) {
      await removeLeftoverData(guestSession.storagePath, (one) => one !== id);
    }
    await clearAside(extensionsDir).catch(noop);
    publisher.publish("browser.extensions-changed", null);
  });
}

/**
 * Empties a running extension's `chrome.storage` from a page of its own,
 * since Chromium keeps the files open and nothing of Electron's reaches them.
 */
async function clearExtensionStorage(
  guestSession: Session,
  id: string,
): Promise<void> {
  const view = new WebContentsView({
    webPreferences: { session: guestSession },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      view.webContents
        .loadURL(`chrome-extension://${id}/manifest.json`)
        .then(() =>
          view.webContents.executeJavaScript(
            "chrome.storage?.local?.clear().then(() => chrome.storage.session?.clear()).then(() => true)",
          ),
        ),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("the page did not answer"));
        }, CLEAR_STORAGE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    view.webContents.close();
  }
}

/**
 * Makes a tab guest a tab the extensions see, in the window that hosts it,
 * and hands it to an extension waiting on a tab it asked for. Returns what
 * takes the tab away again, which runs while the guest is alive.
 */
export function registerExtensionTab(
  guest: WebContents,
  targetId: BrowserTargetId,
): () => void {
  if (!extensions) {
    return noop;
  }
  const host = guest.hostWebContents;
  const hostWindow =
    (host && BrowserWindow.fromWebContents(host)) ??
    BrowserWindow.getFocusedWindow();
  const asked = tabsAsked.get(targetId);
  tabsAsked.delete(targetId);
  const window = asked?.into ?? hostWindow;
  if (!window) {
    log.warn(`no window to register guest=${guest.id} with the extensions`);
    return noop;
  }
  asApp(() => extensions?.addTab(guest, window));
  asked?.take(guest, window);
  const tabs = extensionWindows.get(window);
  // A page in an extension's window may close itself, as its window could in
  // Chrome. Electron emits `close` for `window.close()` without typing it on
  // WebContents, hence the plain emitter.
  const closeSelf = () => {
    const tab = tabs?.get(guest);
    if (tab) {
      publisher.publish("browser.popup-closed", {
        openerId: tab.besideId,
        targetId: tab.targetId,
      });
    }
  };
  if (tabs) {
    (guest as NodeJS.EventEmitter).once("close", closeSelf);
  }
  return () => {
    (guest as NodeJS.EventEmitter).off("close", closeSelf);
    if (!guest.isDestroyed()) {
      asApp(() => extensions?.removeTab(guest));
    }
    // An extension's window goes with its last tab, as a window in Chrome does.
    tabs?.delete(guest);
    if (tabs?.size === 0 && !window.isDestroyed()) {
      extensionWindows.delete(window);
      window.destroy();
    }
  };
}

/**
 * Makes a page's popup, adopted as a tab of the window it is drawn in
 * (`adoptPopup` in manager.ts), a tab the extensions see in that window.
 * Returns what takes it away again.
 */
export function registerPopupTab(
  popup: WebContents,
  window: BaseWindow,
): () => void {
  if (!extensions) {
    return noop;
  }
  asApp(() => extensions?.addTab(popup, window));
  return () => {
    if (!popup.isDestroyed()) {
      asApp(() => extensions?.removeTab(popup));
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
  asApp(() => extensions?.addTab(window.webContents, window));
  log.info(
    `a window a page opened is a tab for the extensions guest=${window.webContents.id}`,
  );
}

/**
 * Tells the extensions which tab a person is looking at, the one change to
 * which tab is active, since a tab registered in the background stays as it
 * is, as in Chrome.
 */
export function selectExtensionTab(guest: WebContents): void {
  currentTab = guest;
  asApp(() => extensions?.selectTab(guest));
}

/**
 * Marks a tab active in its own window for the extensions, without making it
 * the tab a person is looking at (`selectExtensionTab`) unless none is yet:
 * a tab shown in a window in the background is active there all the same.
 */
export function activateExtensionTab(guest: WebContents): void {
  if (!currentTab || currentTab.isDestroyed()) {
    currentTab = guest;
  }
  asApp(() => extensions?.selectTab(guest));
}

/**
 * A tab an extension asked for (`chrome.tabs.create`) opens the way a page's
 * own new-tab link does, beside the tab a person is looking at, and resolves
 * with the guest the window mounts for it. The agent working in that page
 * hears of it as of a popup (`notePageOpenedTab`). Given an extension's
 * window, the tab counts as that window's.
 */
function openTabAsked(
  details: { active?: boolean; url?: string },
  into?: BaseWindow,
): Promise<[WebContents, BaseWindow]> {
  const opener =
    currentTab && !currentTab.isDestroyed()
      ? guests.get(currentTab.id)?.entry
      : undefined;
  if (!opener) {
    return Promise.reject(new Error("no tab is shown to open one beside"));
  }
  const url = details.url ?? "about:blank";
  const tabId = StoreId.newTabId();
  const targetId = BrowserTargetIdSchema.parse(tabId);
  const opened = new Promise<[WebContents, BaseWindow]>((resolve, reject) => {
    const timer = setTimeout(() => {
      tabsAsked.delete(targetId);
      reject(new Error("the tab an extension asked for did not open"));
    }, TAB_OPEN_TIMEOUT_MS);
    tabsAsked.set(targetId, {
      ...(into === undefined ? {} : { into }),
      take: (tab, window) => {
        clearTimeout(timer);
        if (into) {
          extensionWindows
            .get(into)
            ?.set(tab, { besideId: opener.targetId, targetId });
        }
        resolve([tab, window]);
      },
    });
  });
  publisher.publish("browser.open-in-new-tab", {
    background: details.active === false,
    tabId,
    targetId: opener.targetId,
    url,
  });
  notePageOpenedTab(opener.targetId, { tabId, url });
  return opened;
}

/**
 * A window an extension asked for (`chrome.windows.create`, a password
 * manager's or a wallet's own window) opens its pages as tabs beside the tab
 * a person is looking at, in front unless it asked not to be focused, so it
 * never takes the person's focus or lands outside the group. The extension
 * gets a hidden window of its own that is never shown, which its tabs count
 * as theirs, so closing that window closes just them.
 */
async function openWindowAsked(
  details: chrome.windows.CreateData,
): Promise<BaseWindow> {
  const urls =
    details.url === undefined
      ? ["about:blank"]
      : Array.isArray(details.url)
        ? details.url
        : [details.url];
  const window = new BaseWindow({
    height: details.height ?? 600,
    show: false,
    width: details.width ?? 800,
  });
  // Never on screen, whatever the extension asks of it later.
  window.on("show", () => {
    window.hide();
  });
  extensionWindows.set(window, new Map());
  try {
    for (const [index, url] of urls.entries()) {
      await openTabAsked(
        { active: details.focused !== false && index === 0, url },
        window,
      );
    }
    // The library describes a window once, when its first tab arrives, and
    // answers `windows.create` from that; a bounds change is what has it
    // describe the window again, with every tab in it.
    window.emit("resized");
  } catch (error) {
    extensionWindows.delete(window);
    window.destroy();
    throw error;
  }
  return window;
}

/**
 * Closes a window an extension asked to close (`chrome.windows.remove`):
 * one it opened takes its tabs with it, each closing as a popup that closed
 * itself does. An app window is the person's, so it stays open.
 */
function closeWindowAsked(window: BaseWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  const tabs = extensionWindows.get(window);
  if (!tabs) {
    log.info(`an extension asked to close an app window id=${window.id}`);
    return;
  }
  extensionWindows.delete(window);
  for (const { besideId, targetId } of tabs.values()) {
    publisher.publish("browser.popup-closed", { openerId: besideId, targetId });
  }
  window.destroy();
}
