import type { Protocol } from "devtools-protocol";

import { WebSocket } from "ws";

import { isLocalAddress } from "../../../lib/local-page-address";
import { resolveChat } from "../../../lib/record-folders";
import { askWindow, requestWindowTab } from "../../../lib/chat/window-tab";
import { sessionLayout } from "../../../lib/session-layout";
import { heldTabs, updateHeldTabs } from "../../../lib/held-tabs";
import { closeTabsOverCap } from "../../../lib/chat/tab-cap";
import { getBrowserSessionDir } from "../../../lib/chat-dir-utils";
import { publisher } from "../../../rpc/publisher";
import { StoreId } from "../../../schemas/store-id";
import { type ChatId } from "../../../schemas/chat-id";
import { type HeldTab } from "../../../schemas/chat-state";
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
  NAVIGATE_HOLD_CAP_MS,
  notYourFile,
  openTargetSession,
  parseCdpMessage,
  type TargetSession,
} from "./cdp-bridge";

/**
 * How many tabs one task may hold at once. An agent in a loop can open pages
 * faster than anyone closes them, and every one is a tab of the user's chat.
 */
export const TASK_TAB_CAP = 8;

/** A tab the task holds, by the id the agent and the conversation both name it by. */
interface Held {
  /** Whether the tab is in the chat's tabs in the window yet; see HeldTab. */
  inWindow: boolean;
  /** Whether its page has a guest now: one discarded, or not yet shown since a launch, is brought back as it is attached to. */
  live: boolean;
  openedBy: HeldTab["openedBy"];
  tabId: string;
  targetId: BrowserTargetId;
  /** The page's title and address while it has no guest, as the window keeps them. */
  title: string;
  /** The page's address: the guest's, or the one the window keeps for it while it has none. */
  url: string;
}

/**
 * The browser a task sees: the tabs of its chat it holds, and nothing else.
 *
 * agent-browser speaks to a whole browser (it discovers pages, attaches to
 * each on a flat session, opens and closes tabs), so this answers the
 * `Target.*` domain truthfully over the tabs in the task's record rather than
 * pinning the connection to one page. Each tab is known to the agent by the
 * window's id for it, the one the conversation's note and `--tab` use.
 * Opening a tab at an address asks the window for one in the task's chat,
 * behind whatever the user has up. A page asked for with no address, which
 * agent-browser does for nearly any command when it has none, is made with
 * no tab, and joins the chat's tabs as it first goes somewhere; one it never
 * sends anywhere is closed as the session's turn ends. Closing one the conversation handed over only lets go of
 * it, since that tab is the user's. Nothing here ever selects a tab in the
 * window: switching tabs is the agent's business alone.
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
  const sessions = new Map<string, TargetSession>();
  /** Per attached tab, the watch that tells the agent where the tab has gone. */
  const watches = new Map<string, () => void>();
  /** The tabs the agent has been told of, so a change to the record is told as one. */
  const announced = new Map<string, Held>();
  /** A download setting the agent asked for, applied to every tab it holds, those it opens later included. */
  let downloadBehavior: unknown;
  let closed = false;
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
   * The tabs the task holds that are open, in the order it came by them: a
   * page with a guest, and a tab of the chat's whose page was discarded or
   * has not been shown since a launch, which the window keeps the address
   * of. A page with no tab and no guest is gone.
   */
  const held = async (): Promise<Held[]> => {
    const records = await heldTabs(chatId, sessionId);
    const resting = records.some(
      (tab) => tab.inWindow && !browser.getTargetMeta(tab.id),
    );
    const listed = resting
      ? ((
          await askWindow({
            action: { kind: "list" },
            askedBy: chatId,
            group: resolveChat(chatId),
          })
        )?.tabs ?? [])
      : [];
    return records.flatMap((tab): Held[] => {
      const base = {
        inWindow: tab.inWindow,
        openedBy: tab.openedBy,
        tabId: tab.id,
        targetId: tab.id,
      };
      if (browser.getTargetMeta(tab.id)) {
        return [
          {
            ...base,
            live: true,
            title: "",
            url: browser.getTargetUrl(tab.id) ?? "about:blank",
          },
        ];
      }
      const kept = listed.find((entry) => entry.id === tab.id);
      return tab.inWindow && kept?.kind === "page"
        ? [{ ...base, live: false, title: kept.title, url: kept.url }]
        : [];
    });
  };

  /** Brings back the guest of a tab whose page was let go, before it is driven. */
  const bringBack = async (tab: Held): Promise<boolean> => {
    if (tab.live) {
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
    tab: Held,
    titleOf: Map<BrowserTargetId, string>,
  ): Protocol.Target.TargetInfo => ({
    attached: sessions.has(tab.tabId),
    canAccessOpener: false,
    targetId: tab.tabId,
    title: titleOf.get(tab.targetId) ?? tab.title,
    type: "page",
    url: browser.getTargetUrl(tab.targetId) ?? tab.url,
  });

  const detach = (tabId: string) => {
    watches.get(tabId)?.();
    watches.delete(tabId);
    const session = sessions.get(tabId);
    if (session) {
      sessions.delete(tabId);
      session.end();
      event("Target.detachedFromTarget", {
        sessionId: session.sessionId,
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

  const announce = async (tab: Held) => {
    if (!announced.has(tab.tabId)) {
      announced.set(tab.tabId, tab);
      event("Target.targetCreated", {
        targetInfo: targetInfo(tab, await titles()),
      });
    }
  };

  /** Brings what the agent knows up to the record: tabs handed over or taken back since. */
  const reconcile = async () => {
    const now = await held();
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
  const watch = (tab: Held) => {
    const told = async () => {
      if (sessions.has(tab.tabId)) {
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
          queue = queue
            .then(() => intoWindow(tab))
            .then(told)
            .catch(workspaceConfig.captureException);
        }
      }),
    );
  };

  const attach = (tab: Held): TargetSession => {
    const existing = sessions.get(tab.tabId);
    if (existing) {
      return existing;
    }
    const session = openTargetSession({
      // The user closed the tab, or the window it was in.
      onDetach: () => {
        forget(tab.tabId);
      },
      readLayout: () => sessionLayout({ chatId, sessionId }),
      send,
      sessionId: `session-${tab.tabId}`,
      targetId: tab.targetId,
      workspaceConfig,
      workspaceRef,
    });
    sessions.set(tab.tabId, session);
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

  const holdOpened = async (
    targetId: BrowserTargetId,
    { inWindow }: { inWindow: boolean },
  ) => {
    await updateHeldTabs(chatId, sessionId, (tabs) => [
      ...tabs,
      { id: targetId, inWindow, openedBy: "task" },
    ]);
  };

  /**
   * Gives a page made with no tab its tab in the chat, the first time it is
   * somewhere: from then on it is a page of the user's chat like any other.
   */
  const intoWindow = async (tab: Held) => {
    const url = browser.getTargetUrl(tab.targetId);
    if (url === undefined || url === "about:blank") {
      return;
    }
    const record = (await heldTabs(chatId, sessionId)).find(
      (entry) => entry.id === tab.targetId,
    );
    if (!record || record.inWindow) {
      return;
    }
    const adopted = await askWindow({
      action: { kind: "adopt", tabId: tab.tabId, url },
      askedBy: chatId,
      group: resolveChat(chatId),
    });
    if (adopted?.tabId === undefined) {
      return;
    }
    await updateHeldTabs(chatId, sessionId, (tabs) =>
      tabs.map((entry) =>
        entry.id === tab.targetId ? { ...entry, inWindow: true } : entry,
      ),
    );
  };

  const release = async (targetId: BrowserTargetId) => {
    await updateHeldTabs(chatId, sessionId, (tabs) =>
      tabs.filter((tab) => tab.id !== targetId),
    );
  };

  const createTarget = async (id: number, params: unknown) => {
    const url = (params as undefined | { url?: unknown })?.url;
    const address =
      typeof url === "string" && url !== "about:blank" ? url : undefined;
    const now = await held();
    if (now.length >= TASK_TAB_CAP) {
      refuse(
        id,
        `This task has ${TASK_TAB_CAP} tabs open, which is as many as it may hold. Close one it is done with (agent-browser tab close <id>) before opening another.`,
      );
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
    if (address === undefined) {
      // A page with nothing at it yet: a guest with no tab, which the chat
      // is not shown until it goes somewhere (see intoWindow).
      const targetId = browserTargetOf(StoreId.newTabId());
      const made = await browser
        .createTarget(targetId, getBrowserSessionDir())
        .then(() => true)
        .catch((error: unknown) => {
          console.warn(
            `A task's new page did not open (targetId=${targetId}):`,
            error,
          );
          return false;
        });
      if (!made) {
        refuse(id, "The browser did not open a page. Try again.");
        return;
      }
      await holdOpened(targetId, { inWindow: false });
      await announce({
        inWindow: false,
        live: true,
        openedBy: "task",
        tabId: targetId,
        targetId,
        title: "",
        url: "about:blank",
      });
      answer(id, {
        targetId,
      } satisfies Protocol.Target.CreateTargetResponse);
      return;
    }
    const tabId = await requestWindowTab({
      askedBy: chatId,
      group: resolveChat(chatId),
      show: false,
      url: address,
    });
    if (!tabId) {
      refuse(id, "The window did not open a tab. Try again.");
      return;
    }
    // The window opens the guest too; asking here as well waits for it to
    // attach, and asking twice for one tab makes one guest.
    const targetId = browserTargetOf(tabId);
    const made = await browser
      .createTarget(targetId, getBrowserSessionDir())
      .then(() => true)
      .catch(() => false);
    if (!made) {
      refuse(id, "The window did not open a tab. Try again.");
      return;
    }
    // Whichever of the two asks made the guest, it is sent to the page here,
    // and the answer waits for the page's load, the way a navigation's does on
    // any tab: `tab new <url>` then reads the page it asked for.
    await loadInNewTab(browser, targetId, address);
    await holdOpened(targetId, { inWindow: true });
    // One more tab out of sight may put the chat past what it may keep.
    void closeTabsOverCap(chatId).catch(workspaceConfig.captureException);
    await announce({
      inWindow: true,
      live: true,
      openedBy: "task",
      tabId,
      targetId,
      title: "",
      url: address,
    });
    answer(id, {
      targetId: tabId,
    } satisfies Protocol.Target.CreateTargetResponse);
  };

  const closeTarget = async (id: number, params: unknown) => {
    const tabId = (params as undefined | { targetId?: unknown })?.targetId;
    const tabs = await held();
    const tab = tabs.find((entry) => entry.tabId === tabId);
    if (!tab) {
      answer(id, { success: false });
      return;
    }
    forget(tab.tabId);
    await release(tab.targetId);
    // A tab the task opened is the task's to close; one it was handed is the
    // user's, and closing it only lets go of it. A page that never got a tab
    // has only its guest to close.
    if (!tab.inWindow) {
      await browser.closeTarget(tab.targetId);
    } else if (tab.openedBy === "task") {
      await askWindow({
        action: { kind: "close", tabId: tab.tabId },
        askedBy: chatId,
        group: resolveChat(chatId),
      });
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
        const tabs = await held();
        const tab = tabs.find((entry) => entry.tabId === tabId);
        if (!tab) {
          refuse(id, `Target ${String(tabId)} is not one of this task's tabs`);
          return;
        }
        const back = await bringBack(tab).catch(() => false);
        if (!back) {
          refuse(id, `Tab ${tab.tabId} is closed; there is no page to act on.`);
          return;
        }
        await announce(tab);
        answer(id, {
          sessionId: attach({ ...tab, live: true }).sessionId,
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
        // The tabs are announced as the record names them, whichever of these
        // the agent asked for; nothing else in the app is ever a target here.
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
    const now = await held();
    if (method === "Browser.setDownloadBehavior") {
      downloadBehavior = params ?? {};
      await Promise.all(
        now
          .filter((tab) => tab.live)
          .map((tab) =>
            browser
              .sendCommand(tab.targetId, method, downloadBehavior)
              .catch(noop),
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
    // a tab is in) is answered by a tab it holds, the one it names first.
    const named = (params as undefined | { targetId?: unknown })?.targetId;
    const live = now.filter((entry) => entry.live);
    const tab = live.find((entry) => entry.tabId === named) ?? live[0];
    if (!tab) {
      refuse(id, "This task has no tab open.");
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
    const session = on
      ? [...sessions.values()].find((entry) => entry.owns(on))
      : undefined;
    // The Target domain is answered here over the tabs the task holds,
    // whichever session it arrives on: forwarded on a tab's session it would
    // reach a debugger that sees every Electron target, the app window among
    // them. Asking for a page's frames is the one exception, which the tab's
    // session forwards with only frames attached.
    if (
      message.sessionId &&
      message.method.startsWith("Target.") &&
      message.method !== "Target.setAutoAttach"
    ) {
      queue = queue
        .then(() => handleBrowserCommand(message))
        .catch(workspaceConfig.captureException);
      return;
    }
    if (message.sessionId) {
      if (!session) {
        refuse(message.id, `No session ${message.sessionId}`);
        return;
      }
      // Bringing a page to the front would pull the user's window to it,
      // which is not the agent's to do.
      if (message.method === "Page.bringToFront") {
        answer(message.id, {});
        return;
      }
      session.run(message);
      return;
    }
    queue = queue
      .then(() => handleBrowserCommand(message))
      .catch(workspaceConfig.captureException);
  });

  // A tab handed over, or taken back, while the agent is connected.
  const stopWatching = publisher.subscribe("record.changed", (change) => {
    if (change.id === chatId && change.kind === "state" && !closed) {
      queue = queue
        .then(async () => {
          await reconcile();
        })
        .catch(workspaceConfig.captureException);
    }
  });

  const end = () => {
    if (closed) {
      return;
    }
    closed = true;
    stopWatching();
    for (const stop of watches.values()) {
      stop();
    }
    watches.clear();
    for (const session of sessions.values()) {
      session.end();
    }
    sessions.clear();
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
function withTarget(params: unknown, tab: Held): unknown {
  if (typeof params === "object" && params !== null && "targetId" in params) {
    return { ...params, targetId: tab.targetId };
  }
  return params ?? {};
}
