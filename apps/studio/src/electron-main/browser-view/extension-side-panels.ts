import { publisher } from "@/electron-main/rpc/publisher";
import {
  extensionRecord,
  updateExtensionRecord,
} from "@/electron-main/stores/workspace/browser-extensions";
import { type ExtensionSidePanel } from "@/shared/browser-extensions";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import {
  type Extension,
  type Session,
  type WebContents,
  webContents,
} from "electron";
import { type ElectronChromeExtensions } from "electron-chrome-extensions";
import { z } from "zod";

import { guests } from "./guest-registry";
import { log } from "./log";

const OptionsSchema = z.object({
  enabled: z.boolean().optional(),
  path: z.string().optional(),
  tabId: z.number().int().optional(),
});

const PlaceSchema = z
  .object({
    tabId: z.number().int().optional(),
    windowId: z.number().int().optional(),
  })
  .optional();

const BehaviorSchema = z.object({
  openPanelOnActionClick: z.boolean().optional(),
});

const ManifestSchema = z
  .object({
    side_panel: z.object({ default_path: z.string().optional() }).optional(),
  })
  .catch({});

interface Options {
  enabled?: boolean;
  path?: string;
}

/** An extension's panel open in a tab, at a path of the extension's own. */
interface OpenPanel {
  extensionId: string;
  path: string;
  tab: WebContents;
}

/** The panels open in tabs, one per tab, by the tab's target. */
const open = new Map<BrowserTargetId, OpenPanel>();

/** What each extension set of its panel for one tab, by the tab's guest. */
const tabOptions = new WeakMap<WebContents, Map<string, Options>>();

/** The tabs whose going closes their panel. */
const watchedTabs = new WeakSet<WebContents>();

/** The extensions and their session, once the calls are answered. */
let running: null | {
  extensions: ElectronChromeExtensions;
  session: Session;
} = null;

/** Where an extension's panel path points, or undefined for one outside the extension. */
function urlOf(extensionId: string, path: string): string | undefined {
  const base = `chrome-extension://${extensionId}/`;
  const url = URL.parse(path, base);
  return url?.href.startsWith(base) ? url.href : undefined;
}

/** The extension's panel for every tab: what it set, over its manifest's `side_panel`. */
function defaultOptionsOf(extension: Extension): Options {
  const kept = extensionRecord(extension.id)?.sidePanel;
  const path =
    kept?.path ??
    ManifestSchema.parse(extension.manifest).side_panel?.default_path;
  return {
    enabled: kept?.enabled ?? true,
    ...(path === undefined ? {} : { path }),
  };
}

/** The extension's panel in `tab`: what it set for the tab, over what it set for every tab. */
function optionsIn(
  extension: Extension,
  tab: WebContents | undefined,
): Options {
  const own = tab ? tabOptions.get(tab)?.get(extension.id) : undefined;
  return { ...defaultOptionsOf(extension), ...own };
}

function publishChange() {
  publisher.publish("browser.extension-side-panels-changed", null);
}

/**
 * The extension side panels open in tabs, for the windows: each window
 * keeps a page for every one of its tabs that has one, and shows the one
 * of the tab with the keyboard in its group's side panel.
 */
export function listExtensionSidePanels(): ExtensionSidePanel[] {
  const listed: ExtensionSidePanel[] = [];
  for (const [targetId, panel] of open) {
    const extension = running?.session.extensions.getExtension(
      panel.extensionId,
    );
    const url = urlOf(panel.extensionId, panel.path);
    if (extension && url) {
      listed.push({
        extensionId: extension.id,
        name: extension.name,
        targetId,
        url,
      });
    }
  }
  return listed;
}

/** Whether a `<webview>` mounting for `targetId`'s side panel asks for the page open there. */
export function isExtensionSidePanelAt(
  targetId: BrowserTargetId,
  src: string | undefined,
): boolean {
  const panel = open.get(targetId);
  return (
    panel !== undefined &&
    src !== undefined &&
    src === urlOf(panel.extensionId, panel.path)
  );
}

/** Where an extension's panel event says it was, as `sidePanel.onOpened` and `onClosed` carry it. */
function eventInfo(
  extensions: ElectronChromeExtensions,
  panel: OpenPanel,
): { path: string; tabId: number; windowId: number } {
  return {
    path: panel.path,
    tabId: panel.tab.id,
    windowId: extensions.getTabDetails(panel.tab)?.windowId ?? -1,
  };
}

/** Closes the panel open in a tab, telling its extension. */
function closeIn(
  extensions: ElectronChromeExtensions,
  targetId: BrowserTargetId,
) {
  const panel = open.get(targetId);
  if (!panel) {
    return;
  }
  open.delete(targetId);
  log.info(
    `extension ${panel.extensionId} side panel closed target=${targetId}`,
  );
  publishChange();
  if (!panel.tab.isDestroyed()) {
    extensions.sendExtensionEvent(
      panel.extensionId,
      "sidePanel.onClosed",
      eventInfo(extensions, panel),
    );
  }
}

/**
 * Opens an extension's panel in a tab, in place of another extension's
 * there. Throws, as Chrome does, for a tab the extension has no panel in.
 */
function openIn(
  extensions: ElectronChromeExtensions,
  extension: Extension,
  tab: WebContents,
): void {
  const targetId = guests.entryOf(tab.id)?.targetId;
  const { enabled, path } = optionsIn(extension, tab);
  if (!targetId || !enabled || path === undefined) {
    throw new Error(`No active side panel for tabId: ${tab.id}`);
  }
  const was = open.get(targetId);
  if (was?.extensionId === extension.id && was.tab === tab) {
    return;
  }
  if (was) {
    closeIn(extensions, targetId);
  }
  const panel = { extensionId: extension.id, path, tab };
  open.set(targetId, panel);
  if (!watchedTabs.has(tab)) {
    watchedTabs.add(tab);
    tab.once("destroyed", () => {
      for (const [id, each] of open) {
        if (each.tab === tab) {
          open.delete(id);
          publishChange();
        }
      }
    });
  }
  log.info(`extension ${extension.id} side panel opened target=${targetId}`);
  publishChange();
  extensions.sendExtensionEvent(
    extension.id,
    "sidePanel.onOpened",
    eventInfo(extensions, panel),
  );
}

/**
 * Brings each open panel of an extension in line with what it set: one
 * turned off, or left with no page, closes; one given another page goes
 * there.
 */
function followOptions(
  extensions: ElectronChromeExtensions,
  extension: Extension,
) {
  for (const [targetId, panel] of open) {
    if (panel.extensionId !== extension.id) {
      continue;
    }
    const { enabled, path } = optionsIn(extension, panel.tab);
    if (!enabled || path === undefined) {
      closeIn(extensions, targetId);
    } else if (path !== panel.path) {
      panel.path = path;
      publishChange();
    }
  }
}

/** Closes the panel open in a tab, for the button beside the extensions in its row. */
export function closeExtensionSidePanel(targetId: BrowserTargetId): void {
  if (running) {
    closeIn(running.extensions, targetId);
  }
}

/**
 * `chrome.sidePanel`, as Chrome draws it: each tab has at most one
 * extension's panel open, kept with the tab and shown in its group's side
 * panel while the tab has the keyboard. What an extension sets for one tab
 * stays with that tab's guest; what it sets for every tab, and whether its
 * button opens its panel, are kept with its record across launches. `open`
 * asks for no click from the person, which Chrome does.
 */
export function answerSidePanelCalls(
  extensions: ElectronChromeExtensions,
  session: Session,
  currentTab: () => WebContents | null,
): void {
  running = { extensions, session };
  const tabOf = (tabId: number): WebContents => {
    const tab = webContents.fromId(tabId);
    if (!tab || extensions.getTabDetails(tab) === undefined) {
      throw new Error(`No tab with id: ${tabId}.`);
    }
    return tab;
  };
  const placeOf = (place: z.output<typeof PlaceSchema>): WebContents => {
    if (place?.tabId !== undefined) {
      return tabOf(place.tabId);
    }
    if (place?.windowId === undefined) {
      throw new Error(
        "At least one of `tabId` and `windowId` must be provided",
      );
    }
    const tab = currentTab();
    if (!tab || tab.isDestroyed()) {
      throw new Error(`No active side panel for windowId: ${place.windowId}`);
    }
    return tab;
  };
  const options = { permission: "sidePanel" } as const;

  extensions.handleApiCall(
    "sidePanel.setOptions",
    ({ extension }, asked) => {
      const { tabId, ...set } = OptionsSchema.parse(asked);
      if (set.path !== undefined && !urlOf(extension.id, set.path)) {
        throw new Error(`Invalid path: ${set.path}`);
      }
      if (tabId === undefined) {
        const kept = extensionRecord(extension.id)?.sidePanel ?? {};
        updateExtensionRecord(extension.id, {
          sidePanel: { ...kept, ...set },
        });
      } else {
        const tab = tabOf(tabId);
        const own = tabOptions.get(tab) ?? new Map<string, Options>();
        own.set(extension.id, { ...own.get(extension.id), ...set });
        tabOptions.set(tab, own);
      }
      followOptions(extensions, extension);
    },
    options,
  );
  extensions.handleApiCall(
    "sidePanel.getOptions",
    ({ extension }, asked) => {
      const { tabId } = OptionsSchema.parse(asked ?? {});
      const tab = tabId === undefined ? undefined : tabOf(tabId);
      return {
        ...optionsIn(extension, tab),
        ...(tabId === undefined ? {} : { tabId }),
      };
    },
    options,
  );
  extensions.handleApiCall(
    "sidePanel.setPanelBehavior",
    ({ extension }, asked) => {
      const { openPanelOnActionClick } = BehaviorSchema.parse(asked);
      if (openPanelOnActionClick === undefined) {
        return;
      }
      const kept = extensionRecord(extension.id)?.sidePanel ?? {};
      updateExtensionRecord(extension.id, {
        sidePanel: { ...kept, openOnActionClick: openPanelOnActionClick },
      });
    },
    options,
  );
  extensions.handleApiCall(
    "sidePanel.getPanelBehavior",
    ({ extension }) => ({
      openPanelOnActionClick:
        extensionRecord(extension.id)?.sidePanel.openOnActionClick ?? false,
    }),
    options,
  );
  extensions.handleApiCall(
    "sidePanel.getLayout",
    () => ({ side: "right" }),
    options,
  );
  extensions.handleApiCall(
    "sidePanel.open",
    ({ extension }, place) => {
      openIn(extensions, extension, placeOf(PlaceSchema.parse(place)));
    },
    options,
  );
  extensions.handleApiCall(
    "sidePanel.close",
    ({ extension }, place) => {
      const tab = placeOf(PlaceSchema.parse(place));
      const targetId = guests.entryOf(tab.id)?.targetId;
      if (!targetId || open.get(targetId)?.extensionId !== extension.id) {
        throw new Error(`No active side panel for tabId: ${tab.id}`);
      }
      closeIn(extensions, targetId);
    },
    options,
  );

  // With `openPanelOnActionClick`, the extension's button opens its panel
  // in the tab, or closes it there, ahead of its popup and `onClicked`.
  extensions.setActionClickHandler((extensionId, tab) => {
    const extension = session.extensions.getExtension(extensionId);
    if (
      !extension ||
      !extensionRecord(extensionId)?.sidePanel.openOnActionClick
    ) {
      return false;
    }
    const targetId = guests.entryOf(tab.id)?.targetId;
    if (targetId && open.get(targetId)?.extensionId === extensionId) {
      closeIn(extensions, targetId);
      return true;
    }
    try {
      openIn(extensions, extension, tab);
      return true;
    } catch {
      return false;
    }
  });

  session.extensions.on("extension-unloaded", (_event, extension) => {
    for (const [targetId, panel] of open) {
      if (panel.extensionId === extension.id) {
        open.delete(targetId);
        publishChange();
      }
    }
  });
}
