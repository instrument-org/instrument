import type { Protocol } from "devtools-protocol";

import { WebSocket } from "ws";

import { isLocalAddress } from "../../../lib/local-page-address";
import { chatDir, resolveChat } from "../../../lib/record-folders";
import { askWindow, requestWindowTab } from "../../../lib/chat/window-tab";
import { sessionLayout } from "../../../lib/session-layout";
import {
  chatPageTabs,
  forgetOpenedTabs,
  noteOpenedTab,
} from "../../../lib/chat/chat-tabs";
import { closeTabsOverCap } from "../../../lib/chat/tab-cap";
import { getBrowserSessionDir } from "../../../lib/chat-dir-utils";
import { getChatState } from "../../../lib/chat-record";
import {
  lastActOf,
  noteTabCommand,
  registerTabAnnouncer,
} from "../../../lib/tab-activity";
import { type StoreId } from "../../../schemas/store-id";
import { type ChatId } from "../../../schemas/chat-id";
import {
  type BrowserTargetId,
  browserTargetOf,
  type WorkspaceConfig,
} from "../../../types";
import { type WorkspaceServerParentRef } from "../types";
import {
  type CdpEventFrame,
  type CdpRequest,
  type CdpResponse,
  createLocalFileGate,
  createMainFrameLoadGate,
  hasLoaderId,
  isExtensionPage,
  NAVIGATE_HOLD_CAP_MS,
  notYourFile,
  notYourPage,
  openTargetSession,
  parseCdpMessage,
  type TargetSession,
} from "./cdp-bridge";

/** A tab of the chat's, by the id the agent and the conversation both name it by. */
interface Tab {
  tabId: string;
  targetId: BrowserTargetId;
  /** The page's title while it has no guest, as the window keeps it. */
  title: string;
  /** The page's address: the guest's, or the one the window keeps for it while it has none. */
  url: string;
}

/**
 * A tab the agent attached to. Its session opens with the page: at once for
 * a page that is up, and for one that was let go as the first command
 * reaches it, so attaching to every tab of the chat (which agent-browser
 * does as it connects) brings back no page nobody drives.
 */
interface Attached {
  opening?: Promise<TargetSession | undefined>;
  session?: TargetSession;
  sessionId: string;
  tab: Tab;
}

/**
 * The browser a session of a chat sees: every page tab of its chat, for the
 * chat's own conversation and each of its tasks alike.
 *
 * agent-browser speaks to a whole browser (it discovers pages, attaches to
 * each on a flat session, opens and closes tabs), so this answers the
 * `Target.*` domain truthfully over the chat's tabs as the window lists them
 * rather than pinning the connection to one page. Each tab is known to the
 * agent by the window's id for it, the one the conversation's note uses. The
 * tabs the session worked in come first, the latest first, so a daemon that
 * reconnects starts where it left off; a session that has worked in none
 * gets a blank tab of its own to start in, so its first `open` never takes
 * a page someone else is on. Opening a tab asks the window for one in the
 * chat, behind whatever the user has up. Closing one an agent opened closes
 * it; closing any other only lets go of it, since that tab is the user's.
 * Nothing here ever selects a tab in the window: switching tabs is the
 * agent's business alone.
 *
 * A tab another session or the person opens after the agent connected is
 * not announced on its own, since agent-browser makes a tab it discovers its
 * active one: the wrapper announces it when the agent names it
 * (`announceChatTab` in `tab-activity.ts`), and the next connection lists it.
 *
 * Each attached tab is a `TargetSession` (`cdp-bridge.ts`), so the
 * local-file gate, the held navigate, and the teardown hold per tab.
 */
export function handleTaskCdpClient(
  clientWs: WebSocket,
  { sessionId, chatId }: { sessionId: StoreId.Session; chatId: ChatId },
  workspaceConfig: WorkspaceConfig,
  workspaceRef: WorkspaceServerParentRef,
) {
  const { browser } = workspaceConfig;
  const actor = { chatId, sessionId };
  const attached = new Map<string, Attached>();
  /** Per attached tab, the watch that tells the agent where the tab has gone. */
  const watches = new Map<string, () => void>();
  /** The tabs the agent has been told of. */
  const announced = new Map<string, Tab>();
  /** A download setting the agent asked for, applied to every tab it attaches to. */
  let downloadBehavior: unknown;
  let closed = false;
  /** Whether this connection has looked for a tab for the session to start in. */
  let started = false;
  // Browser-level commands and events run in arrival order; a page's own
  // commands run in their session's order, beside the others.
  let queue = Promise.resolve();

  const send = (payload: CdpEventFrame | CdpResponse) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  };
  const answer = (id: number, result: unknown) => {
    send({ id, result });
  };
  const refuse = (id: number, message: string) => {
    send({ error: { code: -32_000, message }, id });
  };
  /** A browser-level event, which carries no session. */
  const event = (method: string, params: unknown) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ method, params }));
    }
  };

  /**
   * The chat's page tabs, the ones the session worked in first, the latest
   * first, then the rest in the strip's order. With no window to ask, the
   * tabs the agent was told of whose pages are still up.
   */
  const tabs = async (): Promise<Tab[]> => {
    const listed = await chatPageTabs(chatId);
    const found: Tab[] = listed
      ? listed.map((tab) => ({
          tabId: tab.id,
          targetId: tab.targetId,
          title: tab.title,
          url: browser.getTargetUrl(tab.targetId) ?? tab.url,
        }))
      : [...announced.values()].filter(
          (tab) => browser.getTargetMeta(tab.targetId) !== null,
        );
    return found
      .map((tab, index) => ({
        at: lastActOf(tab.targetId, sessionId) ?? -1,
        index,
        tab,
      }))
      .toSorted((a, b) => b.at - a.at || a.index - b.index)
      .map(({ tab }) => tab);
  };

  /** Brings back the guest of a tab whose page was let go, before it is driven. */
  const bringBack = async (tab: Tab): Promise<boolean> => {
    if (browser.getTargetMeta(tab.targetId)) {
      return true;
    }
    const restored = await askWindow({
      action: { kind: "restore", tabId: tab.tabId },
      askedBy: chatId,
      group: resolveChat(chatId),
    });
    if (restored?.tabId === undefined) {
      return false;
    }
    // The window opens the guest; asking here as well waits for it to
    // attach, and asking twice for one tab makes one guest.
    await browser.createTarget(tab.targetId, getBrowserSessionDir());
    return true;
  };

  /** The window's titles for its tabs, which only the main process knows. */
  const titles = async (): Promise<Map<BrowserTargetId, string>> => {
    const targets = await browser.listTargets();
    return new Map(targets.map((target) => [target.id, target.title]));
  };

  const targetInfo = (
    tab: Tab,
    titleOf: Map<BrowserTargetId, string>,
  ): Protocol.Target.TargetInfo => ({
    attached: attached.has(tab.tabId),
    canAccessOpener: false,
    targetId: tab.tabId,
    title: titleOf.get(tab.targetId) ?? tab.title,
    type: "page",
    url: browser.getTargetUrl(tab.targetId) ?? tab.url,
  });

  const detach = (tabId: string) => {
    watches.get(tabId)?.();
    watches.delete(tabId);
    const entry = attached.get(tabId);
    if (entry) {
      attached.delete(tabId);
      entry.session?.end();
      event("Target.detachedFromTarget", {
        sessionId: entry.sessionId,
        targetId: tabId,
      });
    }
  };

  /** Tells the agent a tab is gone from its browser, whether closed or let go. */
  const forget = (tabId: string) => {
    detach(tabId);
    if (announced.delete(tabId)) {
      event("Target.targetDestroyed", { targetId: tabId });
    }
  };

  const announce = async (tab: Tab) => {
    if (!announced.has(tab.tabId)) {
      announced.set(tab.tabId, tab);
      event("Target.targetCreated", {
        targetInfo: targetInfo(tab, await titles()),
      });
    }
  };

  /**
   * Opens a tab in the chat, behind whatever the user has up, at `address`
   * or blank, and keeps it as one an agent opened.
   */
  const openTab = async (address?: string): Promise<string | Tab> => {
    const tabId = await requestWindowTab({
      askedBy: chatId,
      group: resolveChat(chatId),
      show: false,
      ...(address === undefined ? {} : { url: address }),
    });
    if (!tabId) {
      return "The window did not open a tab. Try again.";
    }
    // The window opens the guest too; asking here as well waits for it to
    // attach, and asking twice for one tab makes one guest.
    const targetId = browserTargetOf(tabId);
    const made = await browser
      .createTarget(targetId, getBrowserSessionDir())
      .then(() => true)
      .catch(() => false);
    if (!made) {
      return "The window did not open a tab. Try again.";
    }
    if (address !== undefined) {
      // Whichever of the two asks made the guest, it is sent to the page
      // here, and the answer waits for the page's load, the way a
      // navigation's does on any tab: `tab new <url>` then reads the page it
      // asked for.
      await loadInNewTab(browser, targetId, address);
    }
    noteTabCommand(targetId, actor);
    await noteOpenedTab(chatId, targetId);
    // One more tab out of sight may put the chat past what it may keep.
    void closeTabsOverCap(chatId).catch(workspaceConfig.captureException);
    return { tabId, targetId, title: "", url: address ?? "about:blank" };
  };

  /**
   * Brings what the agent knows up to the window: tabs closed since are
   * forgotten, and the chat's tabs announced. A session that has worked in
   * none of them first gets a blank tab of its own, listed first, which
   * agent-browser starts in.
   */
  const reconcile = async () => {
    let now = await tabs();
    if (
      !started &&
      !now.some((tab) => lastActOf(tab.targetId, sessionId) !== undefined)
    ) {
      started = true;
      const own = await openTab();
      if (typeof own !== "string") {
        now = [own, ...now];
      }
    }
    started = true;
    const ids = new Set(now.map((tab) => tab.tabId));
    for (const tabId of announced.keys()) {
      if (!ids.has(tabId)) {
        forget(tabId);
      }
    }
    for (const tab of now) {
      await announce(tab);
    }
    return now;
  };

  /**
   * Tells the agent each time a tab's page changes, the way a browser does:
   * agent-browser keeps each tab's address and title from these, so without
   * them a tab it drove by clicks still lists the page it opened.
   */
  const watch = (tab: Tab) => {
    const told = async () => {
      if (attached.has(tab.tabId)) {
        event("Target.targetInfoChanged", {
          targetInfo: targetInfo(tab, await titles()),
        } satisfies Protocol.Target.TargetInfoChangedEvent);
      }
    };
    watches.set(
      tab.tabId,
      browser.subscribeEvents(tab.targetId, noop, (method, params, frame) => {
        if (frame !== undefined) {
          return;
        }
        if (
          method === "Page.loadEventFired" ||
          (method === "Page.frameNavigated" && isMainFrame(params))
        ) {
          queue = queue.then(told).catch(workspaceConfig.captureException);
        }
      }),
    );
  };

  const open = (entry: Attached): TargetSession => {
    const { tab } = entry;
    const session = openTargetSession({
      // The user closed the tab, or the window it was in, or another window
      // took its page, which is then a new page of the same tab: the agent
      // hears that tab come back, to attach to again.
      onDetach: () => {
        forget(tab.tabId);
        queue = queue
          .then(async () => {
            if (!closed && browser.getTargetMeta(tab.targetId)) {
              await announce(tab);
            }
          })
          .catch(workspaceConfig.captureException);
      },
      readLayout: () => sessionLayout({ chatId, sessionId }),
      send,
      sessionId: entry.sessionId,
      targetId: tab.targetId,
      workspaceConfig,
      workspaceRef,
    });
    entry.session = session;
    watch(tab);
    if (downloadBehavior !== undefined) {
      void browser
        .sendCommand(
          tab.targetId,
          "Browser.setDownloadBehavior",
          downloadBehavior,
        )
        .catch(noop);
    }
    return session;
  };

  const attach = (tab: Tab): string => {
    const existing = attached.get(tab.tabId);
    if (existing) {
      return existing.sessionId;
    }
    const entry: Attached = { sessionId: `session-${tab.tabId}`, tab };
    attached.set(tab.tabId, entry);
    if (browser.getTargetMeta(tab.targetId)) {
      open(entry);
    }
    return entry.sessionId;
  };

  /** An attached tab's session, its page brought back first when it was let go; undefined once it cannot be. */
  const sessionOf = (entry: Attached): Promise<TargetSession | undefined> => {
    if (entry.session) {
      return Promise.resolve(entry.session);
    }
    entry.opening ??= bringBack(entry.tab)
      .catch(() => false)
      .then((back) =>
        back && !closed && attached.get(entry.tab.tabId) === entry
          ? open(entry)
          : undefined,
      );
    return entry.opening;
  };

  const createTarget = async (id: number, params: unknown) => {
    const url = (params as undefined | { url?: unknown })?.url;
    const address =
      typeof url === "string" && url !== "about:blank" ? url : undefined;
    if (address !== undefined && isExtensionPage(address)) {
      send({ error: notYourPage(address), id });
      return;
    }
    if (address !== undefined && isLocalAddress(address)) {
      // Asked of an address before any tab is at it, so no page is current.
      const gate = createLocalFileGate({
        currentUrl: noPageYet,
        readLayout: () => sessionLayout({ chatId, sessionId }),
      });
      if (!(await gate.mayOpen(address))) {
        send({ error: notYourFile(address), id });
        return;
      }
    }
    const tab = await openTab(address);
    if (typeof tab === "string") {
      refuse(id, tab);
      return;
    }
    await announce(tab);
    answer(id, {
      targetId: tab.tabId,
    } satisfies Protocol.Target.CreateTargetResponse);
  };

  const closeTarget = async (id: number, params: unknown) => {
    const tabId = (params as undefined | { targetId?: unknown })?.targetId;
    const tab = (await tabs()).find((entry) => entry.tabId === tabId);
    if (!tab) {
      answer(id, { success: false });
      return;
    }
    forget(tab.tabId);
    // A tab an agent opened is an agent's to close; any other is the
    // user's, and closing it only lets go of it.
    const { openedTabs } = await getChatState(chatDir(chatId));
    if (openedTabs.some((opened) => opened.id === tab.targetId)) {
      await askWindow({
        action: { kind: "close", tabId: tab.tabId },
        askedBy: chatId,
        group: resolveChat(chatId),
      });
      await forgetOpenedTabs(chatId, new Set([tab.targetId]));
    }
    answer(id, { success: true } satisfies Protocol.Target.CloseTargetResponse);
  };

  const handleBrowserCommand = async (message: CdpRequest) => {
    const { id, method, params } = message;
    switch (method) {
      case "Target.activateTarget": {
        // Which tab the agent works in is its own business; the window keeps
        // what the user has up.
        answer(id, {});
        return;
      }
      case "Target.attachToTarget": {
        const tabId = (params as undefined | { targetId?: unknown })?.targetId;
        const tab = (await tabs()).find((entry) => entry.tabId === tabId);
        if (!tab) {
          refuse(id, `Target ${String(tabId)} is not one of this chat's tabs`);
          return;
        }
        await announce(tab);
        answer(id, {
          sessionId: attach(tab),
        } satisfies Protocol.Target.AttachToTargetResponse);
        return;
      }
      case "Target.closeTarget": {
        await closeTarget(id, params);
        return;
      }
      case "Target.createBrowserContext":
      case "Target.disposeBrowserContext": {
        // Electron doesn't support CDP browser context management. A synthetic
        // context lets agent-browser's recording flow proceed.
        answer(id, {
          browserContextId: `context-${chatId}`,
        } satisfies Protocol.Target.CreateBrowserContextResponse);
        return;
      }
      case "Target.createTarget": {
        await createTarget(id, params);
        return;
      }
      case "Target.getTargets": {
        const now = await reconcile();
        const titleOf = await titles();
        answer(id, {
          targetInfos: now.map((tab) => targetInfo(tab, titleOf)),
        } satisfies Protocol.Target.GetTargetsResponse);
        return;
      }
      case "Target.setAutoAttach":
      case "Target.setDiscoverTargets": {
        // The tabs are announced as the window lists them, whichever of
        // these the agent asked for; nothing else in the app is ever a
        // target here.
        await reconcile();
        answer(id, {});
        return;
      }
      default: {
        break;
      }
    }
    if (method.startsWith("Target.")) {
      send({ error: { code: -32_601, message: "Method not found" }, id });
      return;
    }
    if (method === "Browser.setDownloadBehavior") {
      downloadBehavior = params ?? {};
      await Promise.all(
        [...attached.values()].flatMap(({ session, tab }) =>
          session
            ? [
                browser
                  .sendCommand(tab.targetId, method, downloadBehavior)
                  .catch(noop),
              ]
            : [],
        ),
      );
      answer(id, {});
      return;
    }
    // A page's own command arrives on its session, behind that page's file
    // gate and teardown. Sent here with none, it would reach a tab with
    // neither, so only the Browser domain is taken here; agent-browser's
    // provider connection is never a direct page, so it sends nothing else
    // without a session.
    if (!method.startsWith("Browser.")) {
      send({ error: { code: -32_601, message: "Method not found" }, id });
      return;
    }
    // Anything else asked of the browser as a whole (its version, the window
    // a tab is in) is answered by a tab whose page is up, the one it names
    // or the first.
    const named = (params as undefined | { targetId?: unknown })?.targetId;
    const live = (await tabs()).filter(
      (entry) => browser.getTargetMeta(entry.targetId) !== null,
    );
    const tab = live.find((entry) => entry.tabId === named) ?? live[0];
    if (!tab) {
      refuse(id, "This chat has no tab open.");
      return;
    }
    browser
      .sendCommand(tab.targetId, method, withTarget(params, tab))
      .then((result) => {
        answer(id, result);
      })
      .catch((error: unknown) => {
        refuse(id, error instanceof Error ? error.message : "Command failed");
      });
  };

  clientWs.on("message", (data) => {
    const message = parseCdpMessage(data);
    if (!message) {
      return;
    }
    const { sessionId: on } = message;
    // The Target domain is answered here over the chat's tabs, whichever
    // session it arrives on: forwarded on a tab's session it would reach a
    // debugger that sees every Electron target, the app window among them.
    // Asking for a page's frames is the one exception, which the tab's
    // session forwards with only frames attached.
    if (
      on &&
      message.method.startsWith("Target.") &&
      message.method !== "Target.setAutoAttach"
    ) {
      queue = queue
        .then(() => handleBrowserCommand(message))
        .catch(workspaceConfig.captureException);
      return;
    }
    if (on) {
      const entry = [...attached.values()].find((each) =>
        each.session ? each.session.owns(on) : each.sessionId === on,
      );
      if (!entry) {
        refuse(message.id, `No session ${on}`);
        return;
      }
      // Bringing a page to the front would pull the user's window to it,
      // which is not the agent's to do.
      if (message.method === "Page.bringToFront") {
        answer(message.id, {});
        return;
      }
      noteTabCommand(entry.tab.targetId, actor);
      if (entry.session) {
        entry.session.run(message);
        return;
      }
      void sessionOf(entry).then((session) => {
        if (session) {
          session.run(message);
        } else {
          refuse(
            message.id,
            `Tab ${entry.tab.tabId} is closed; there is no page to act on.`,
          );
        }
      });
      return;
    }
    queue = queue
      .then(() => handleBrowserCommand(message))
      .catch(workspaceConfig.captureException);
  });

  /** Tells this connection's agent of a tab of the chat it has not heard of, in order with its other commands. */
  const announceOne = (tabId: string) =>
    new Promise<boolean>((resolve) => {
      queue = queue
        .then(async () => {
          const tab = (await tabs()).find((entry) => entry.tabId === tabId);
          if (tab && !closed) {
            await announce(tab);
          }
          resolve(tab !== undefined);
        })
        .catch((error: unknown) => {
          resolve(false);
          workspaceConfig.captureException(error);
        });
    });
  const stopAnnouncing = registerTabAnnouncer(actor, announceOne);

  const end = () => {
    if (closed) {
      return;
    }
    closed = true;
    stopAnnouncing();
    for (const stop of watches.values()) {
      stop();
    }
    watches.clear();
    for (const entry of attached.values()) {
      entry.session?.end();
    }
    attached.clear();
  };
  clientWs.on("close", end);
  clientWs.on("error", end);
}

function isMainFrame(params: unknown): boolean {
  const frame = (params as undefined | { frame?: { parentId?: unknown } })
    ?.frame;
  return frame !== undefined && frame.parentId === undefined;
}

/** Sends a tab that was just made to its first page and waits for the load, capped. */
async function loadInNewTab(
  browser: WorkspaceConfig["browser"],
  targetId: BrowserTargetId,
  url: string,
): Promise<void> {
  const gate = createMainFrameLoadGate();
  const stop = browser.subscribeEvents(
    targetId,
    noop,
    (method, params, frame) => {
      if (frame === undefined) {
        gate.observe(method, params);
      }
    },
  );
  try {
    await browser.sendCommand(targetId, "Page.enable", {});
    const load = gate.nextMainFrameLoad(NAVIGATE_HOLD_CAP_MS);
    const result: unknown = await browser
      .sendCommand(targetId, "Page.navigate", { url })
      .catch(noop);
    if (hasLoaderId(result)) {
      await load.promise;
    } else {
      load.cancel();
    }
  } catch {
    // A guest that went away mid-load: the agent hears it as a closed tab.
  } finally {
    stop();
  }
}

function noop() {
  // A best-effort command on a guest that may already be gone.
}

function noPageYet(): string | undefined {
  return undefined;
}

/** A browser-level command's parameters, with the tab it names in the window's own terms. */
function withTarget(params: unknown, tab: Tab): unknown {
  if (typeof params === "object" && params !== null && "targetId" in params) {
    return { ...params, targetId: tab.targetId };
  }
  return params ?? {};
}
