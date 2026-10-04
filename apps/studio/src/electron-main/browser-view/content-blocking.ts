import { logger } from "@/electron-main/lib/electron-logger";
import { getWorkspacePreferences } from "@/electron-main/stores/workspace/preferences";
import {
  fetchResources,
  FiltersEngine,
  Request,
} from "@ghostery/adblocker";
import type { IBackgroundCallback } from "@ghostery/adblocker-electron-preload";
import {
  app,
  type CallbackResponse,
  type HeadersReceivedResponse,
  ipcMain,
  type IpcMainInvokeEvent,
  type OnBeforeRequestListenerDetails,
  type OnHeadersReceivedListenerDetails,
  type Session,
} from "electron";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "tldts";

/**
 * Ad and tracker blocking for the task browser, the way Brave does it out of
 * the box: EasyList, EasyPrivacy, and uBlock Origin's lists, through
 * Ghostery's engine.
 *
 * The engine's own Electron wrapper is not used, because it takes the session's
 * `onBeforeRequest` and `onHeadersReceived` for itself and Electron keeps one
 * listener per event, so enabling it would silently drop the local-file policy
 * (`local-file-policy.ts`). Instead the guest session's one listener asks
 * `blockedRequestResponse` about every request that is not a file, and this
 * module owns the rest: the CSP filters, and the preload that hides ad
 * elements a request block cannot reach (the search engine's own ads among
 * them, which are served from its own origin).
 *
 * A document is never blocked, only what it loads, so a navigation the person
 * or the agent makes always lands. Turned off per workspace from the page
 * menu; the change applies from the next load.
 */

/** How long a built engine serves before the lists are fetched again. */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const UBLOCK_ORIGIN =
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/";

/**
 * Ghostery's ads-and-tracking set, fetched from where each list is published
 * rather than from the engine's mirror of them, which updates only when that
 * repository's bot lands a commit and drops uBlock Origin's newer yearly
 * lists. uBlock Origin's main list pulls those in with `!#include`, which
 * `fetchList` follows.
 */
const FILTER_LISTS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
  "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext",
  ...[
    "filters.txt",
    "badware.txt",
    "privacy.txt",
    "quick-fixes.txt",
    "unbreak.txt",
  ].map((name) => `${UBLOCK_ORIGIN}${name}`),
];

const INJECT_CHANNEL = "@ghostery/adblocker/inject-cosmetic-filters";
const MUTATION_OBSERVER_CHANNEL =
  "@ghostery/adblocker/is-mutation-observer-enabled";

const log = logger.scope("content-blocking");

let engine: FiltersEngine | null = null;
let loading: Promise<void> | null = null;
let blockAds: boolean | null = null;
let ipcHandlersRegistered = false;
let isExempt: (webContentsId: number) => boolean = () => false;
const blockingSessions = new WeakSet<Session>();

/**
 * Block in `guestSession` from now on, except in the pages `exempt` names by
 * their web contents id. Idempotent, since every page's session comes through
 * here: the preload is registered once per session and the IPC handlers once
 * per process.
 */
export function enableContentBlocking(
  guestSession: Session,
  exempt: (webContentsId: number) => boolean,
) {
  isExempt = exempt;
  loading ??= loadEngine();
  if (blockingSessions.has(guestSession)) {
    return;
  }
  if (!ipcHandlersRegistered) {
    ipcHandlersRegistered = true;
    ipcMain.handle(INJECT_CHANNEL, injectCosmeticFilters);
    ipcMain.handle(
      MUTATION_OBSERVER_CHANNEL,
      (event) =>
        blockingSessions.has(event.sender.session) &&
        !isExempt(event.sender.id) &&
        engine?.config.enableMutationObserver === true,
    );
  }
  blockingSessions.add(guestSession);
  guestSession.registerPreloadScript({
    filePath: createRequire(import.meta.url).resolve(
      "@ghostery/adblocker-electron-preload",
    ),
    type: "frame",
  });
  guestSession.webRequest.onHeadersReceived((details, callback) => {
    callback(cspResponse(details));
  });
}

/** What the guest session's request listener answers for a non-file request. */
export function blockedRequestResponse(
  details: OnBeforeRequestListenerDetails,
): CallbackResponse {
  if (
    !engine ||
    !isBlocking() ||
    (details.webContentsId !== undefined && isExempt(details.webContentsId))
  ) {
    return {};
  }
  const request = requestFrom(details);
  if (request.isMainFrame()) {
    return {};
  }
  const { match, redirect } = engine.match(request);
  if (redirect) {
    return { redirectURL: redirect.dataUrl };
  }
  return match ? { cancel: true } : {};
}

function cspResponse(
  details: OnHeadersReceivedListenerDetails,
): HeadersReceivedResponse {
  if (
    !engine ||
    !isBlocking() ||
    (details.webContentsId !== undefined && isExempt(details.webContentsId)) ||
    (details.resourceType !== "mainFrame" &&
      details.resourceType !== "subFrame")
  ) {
    return {};
  }
  const directives = engine.getCSPDirectives(requestFrom(details));
  if (directives === undefined) {
    return {};
  }
  const policies = directives.split(";").map((policy) => policy.trim());
  const responseHeaders = { ...details.responseHeaders };
  for (const [name, values] of Object.entries(responseHeaders)) {
    if (name.toLowerCase() === "content-security-policy") {
      policies.push(...values);
      delete responseHeaders[name];
    }
  }
  responseHeaders["content-security-policy"] = [policies.join(";")];
  return { responseHeaders };
}

function requestFrom(
  details: OnBeforeRequestListenerDetails | OnHeadersReceivedListenerDetails,
) {
  return Request.fromRawDetails({
    requestId: `${details.id}`,
    sourceUrl: details.referrer,
    tabId: details.webContentsId,
    type: details.resourceType,
    url: details.url,
  });
}

/**
 * The preload's ask, once at load with the address and again as classes and
 * ids appear: the styles that hide what the lists name, and the scriptlets
 * they run, applied to the frame that asked.
 */
function injectCosmeticFilters(
  event: IpcMainInvokeEvent,
  url: unknown,
  msg?: IBackgroundCallback,
) {
  if (
    !engine ||
    !isBlocking() ||
    typeof url !== "string" ||
    !blockingSessions.has(event.sender.session) ||
    isExempt(event.sender.id)
  ) {
    return;
  }
  const isFirstRun = msg === undefined;
  const { domain, hostname } = parse(url);
  if (!hostname) {
    return;
  }
  const { active, scripts, styles } = engine.getCosmeticsFilters({
    callerContext: {
      frameId: event.frameId,
      lifecycle: msg?.lifecycle,
      processId: event.processId,
    },
    classes: msg?.classes,
    domain: domain ?? "",
    getBaseRules: isFirstRun,
    getExtendedRules: false,
    getInjectionRules: isFirstRun,
    getRulesFromDOM: !isFirstRun,
    getRulesFromHostname: isFirstRun,
    hostname,
    hrefs: msg?.hrefs,
    ids: msg?.ids,
    url,
  });
  if (!active) {
    return;
  }
  if (styles.length > 0) {
    void event.sender.insertCSS(styles, { cssOrigin: "user" });
  }
  for (const script of scripts) {
    event.sender.executeJavaScript(script, true).catch((error: unknown) => {
      log.warn("scriptlet failed", error);
    });
  }
}

/** Whether the person has blocking on for this workspace. */
export function isBlocking() {
  if (blockAds === null) {
    const preferences = getWorkspacePreferences();
    blockAds = preferences.get("blockAds");
    preferences.onDidChange("blockAds", (value) => {
      blockAds = value ?? true;
    });
  }
  return blockAds;
}

/**
 * The engine last built, from disk, then rebuilt from the published lists when
 * there is none or it is a week old. A failed fetch keeps whatever loaded; with
 * nothing on disk either, pages load unblocked until the next launch.
 */
async function loadEngine() {
  const cachePath = path.join(
    app.getPath("userData"),
    "content-blocking-engine.bin",
  );
  let age = Number.POSITIVE_INFINITY;
  try {
    const [buffer, stat] = await Promise.all([
      fs.readFile(cachePath),
      fs.stat(cachePath),
    ]);
    engine = FiltersEngine.deserialize(buffer);
    age = Date.now() - stat.mtimeMs;
  } catch {
    // No engine on disk, or one an older version of the engine wrote.
  }
  if (age < REFRESH_AFTER_MS) {
    return;
  }
  try {
    const [lists, resources] = await Promise.all([
      Promise.all(FILTER_LISTS.map((url) => fetchList(url, new Set()))),
      fetchResources(fetch),
    ]);
    const fresh = FiltersEngine.parse(lists.join("\n"));
    fresh.updateResources(resources, `${resources.length}`);
    engine = fresh;
    await fs.writeFile(cachePath, fresh.serialize());
  } catch (error) {
    log.warn("could not refresh the block lists", error);
  }
}

/**
 * A list's text with each `!#include` replaced by the list it names, which
 * sits beside it. `seen` keeps a list that includes itself from looping.
 */
async function fetchList(url: string, seen: Set<string>): Promise<string> {
  if (seen.has(url)) {
    return "";
  }
  seen.add(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} fetching ${url}`);
  }
  const lines = (await response.text()).split("\n");
  const expanded = await Promise.all(
    lines.map((line) => {
      const included = /^!#include (\S+)/.exec(line)?.[1];
      return included ? fetchList(new URL(included, url).href, seen) : line;
    }),
  );
  return expanded.join("\n");
}
