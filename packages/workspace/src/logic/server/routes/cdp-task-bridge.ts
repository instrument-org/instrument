import type { Protocol } from "devtools-protocol";

import { WebSocket } from "ws";

import { isLocalAddress } from "../../../lib/local-page-address";
import { windowTaskId } from "../../../lib/orchestrator/ensure";
import {
  askWindow,
  chatSessionOfTask,
  requestWindowTab,
} from "../../../lib/orchestrator/window-tab";
import { taskFsLayout } from "../../../lib/resolve-workspace-file-path";
import { getBrowserSessionDir, taskDir } from "../../../lib/task-dir-utils";
import { getTaskState, setTaskState } from "../../../lib/task-record";
import { publisher } from "../../../rpc/publisher";
import { type TaskId } from "../../../schemas/task-id";
import { type HeldTab } from "../../../schemas/task-state";
import {
  type BrowserTargetId,
  decodeBrowserTargetId,
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
  openedBy: HeldTab["openedBy"];
  tabId: string;
  targetId: BrowserTargetId;
}

/**
 * The browser a task sees: the tabs of its chat it holds, and nothing else.
 *
 * agent-browser speaks to a whole browser (it discovers pages, attaches to
 * each on a flat session, opens and closes tabs), so this answers the
 * `Target.*` domain truthfully over the tabs in the task's record rather than
 * pinning the connection to one page. Each tab is known to the agent by the
 * window's id for it, the one the conversation's note and `--tab` use.
 * Opening a tab asks the window for one in the task's chat, behind whatever
 * the user has up; closing one the conversation handed over only lets go of
 * it, since that tab is the user's. Nothing here ever selects a tab in the
 * window: switching tabs is the agent's business alone.
 *
 * Each attached tab is a `TargetSession`, the same wiring the page endpoint
 * gives its one page, so the local-file gate, the held navigate, and the
 * teardown hold per tab.
 */
export function handleTaskCdpClient(
  clientWs: WebSocket,
  taskId: TaskId,
  workspaceConfig: WorkspaceConfig,
  workspaceRef: WorkspaceServerParentRef,
) {
  const { browser } = workspaceConfig;
  const sessions = new Map<string, TargetSession>();
  /** The tabs the agent has been told of, so a change to the record is told as one. */
  const announced = new Map<string, Held>();
  /** A download setting the agent asked for, applied to every tab it holds, those it opens later included. */
  let downloadBehavior: unknown;
  let closed = false;

  const send = (payload: CdpEventFrame | CdpResponse) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  };
  const answer = (id: number | undefined, result: unknown) => {
    send({ id, result });
  };
  const refuse = (id: number | undefined, message: string) => {
    send({ error: { code: -32_000, message }, id });
  };
  /** A browser-level event, which carries no session. */
  const event = (method: string, params: unknown) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ method, params }));
    }
  };

  /** The tabs the task holds that are open, in the order it came by them. */
  const held = async (): Promise<Held[]> => {
    const state = await getTaskState(taskDir(taskId));
    return (state.browserTabs ?? []).flatMap((tab) => {
      const decoded = decodeBrowserTargetId(tab.id);
      return decoded && browser.getTargetMeta(tab.id)
        ? [
            {
              openedBy: tab.openedBy,
              tabId: decoded.sessionId,
              targetId: tab.id,
            },
          ]
        : [];
    });
  };

  const targetInfo = (tab: Held): Protocol.Target.TargetInfo => ({
    attached: sessions.has(tab.tabId),
    canAccessOpener: false,
    targetId: tab.tabId,
    title: "",
    type: "page",
    url: browser.getTargetUrl(tab.targetId) ?? "about:blank",
  });

  const detach = (tabId: string) => {
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

  const announce = (tab: Held) => {
    if (!announced.has(tab.tabId)) {
      announced.set(tab.tabId, tab);
      event("Target.targetCreated", { targetInfo: targetInfo(tab) });
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
      announce(tab);
    }
    return now;
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
      send,
      sessionId: `session-${tab.tabId}`,
      targetId: tab.targetId,
      workspaceConfig,
      workspaceRef,
    });
    sessions.set(tab.tabId, session);
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

  const holdOpened = async (targetId: BrowserTargetId) => {
    const state = await getTaskState(taskDir(taskId));
    await setTaskState(taskDir(taskId), {
      browserTabs: [
        ...(state.browserTabs ?? []),
        { id: targetId, openedBy: "task" },
      ],
    });
  };

  const release = async (targetId: BrowserTargetId) => {
    const state = await getTaskState(taskDir(taskId));
    await setTaskState(taskDir(taskId), {
      browserTabs: (state.browserTabs ?? []).filter(
        (tab) => tab.id !== targetId,
      ),
    });
  };

  const createTarget = async (id: number | undefined, params: unknown) => {
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
        readLayout: () => taskFsLayout(taskId),
      });
      if (!(await gate.mayOpen(address))) {
        send({ error: notYourFile(address), id });
        return;
      }
    }
    const tabId = await requestWindowTab({
      askedBy: taskId,
      group: await chatSessionOfTask(taskId),
      show: false,
      ...(address === undefined ? {} : { url: address }),
    });
    if (!tabId) {
      refuse(id, "The window did not open a tab. Try again.");
      return;
    }
    // The window opens the guest too; asking here as well waits for it to
    // attach, and asking twice for one tab makes one guest.
    const { targetId } = await browser.createTarget(
      await windowTaskId(),
      tabId,
      getBrowserSessionDir(),
      "orchestrator",
    );
    // Whichever of the two asks made the guest, it is sent to the page here,
    // and the answer waits for the page's load, the way a navigation's does on
    // any tab: `tab new <url>` then reads the page it asked for.
    if (address !== undefined) {
      await loadInNewTab(browser, targetId, address);
    }
    await holdOpened(targetId);
    announce({ openedBy: "task", tabId, targetId });
    answer(id, {
      targetId: tabId,
    } satisfies Protocol.Target.CreateTargetResponse);
  };

  const closeTarget = async (id: number | undefined, params: unknown) => {
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
    // user's, and closing it only lets go of it.
    if (tab.openedBy === "task") {
      await askWindow({
        action: { kind: "close", tabId: tab.tabId },
        askedBy: taskId,
        group: await chatSessionOfTask(taskId),
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
        announce(tab);
        answer(id, {
          sessionId: attach(tab).sessionId,
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
          browserContextId: `context-${taskId}`,
        } satisfies Protocol.Target.CreateBrowserContextResponse);
        return;
      }
      case "Target.createTarget": {
        await createTarget(id, params);
        return;
      }
      case "Target.getTargets": {
        const now = await reconcile();
        answer(id, {
          targetInfos: now.map(targetInfo),
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
    if (typeof method === "string" && method.startsWith("Target.")) {
      send({ error: { code: -32_601, message: "Method not found" }, id });
      return;
    }
    const now = await held();
    if (method === "Browser.setDownloadBehavior") {
      downloadBehavior = params ?? {};
      await Promise.all(
        now.map((tab) =>
          browser
            .sendCommand(tab.targetId, method, downloadBehavior)
            .catch(noop),
        ),
      );
      answer(id, {});
      return;
    }
    // Anything else asked of the browser as a whole (its version, the window
    // a tab is in) is answered by a tab it holds, the one it names first.
    const named = (params as undefined | { targetId?: unknown })?.targetId;
    const tab = now.find((entry) => entry.tabId === named) ?? now[0];
    if (!tab || typeof method !== "string") {
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

  // Browser-level commands run in arrival order; a page's own commands run in
  // their session's order, beside the others.
  let queue = Promise.resolve();

  clientWs.on("message", (data) => {
    const message = parseCdpMessage(data);
    if (!message) {
      return;
    }
    const session = message.sessionId
      ? [...sessions.values()].find(
          (entry) => entry.sessionId === message.sessionId,
        )
      : undefined;
    if (message.sessionId) {
      if (!session) {
        refuse(message.id, `No session ${message.sessionId}`);
        return;
      }
      // A page's own auto-attach would announce its frames as sessions of
      // their own, and bringing a page to the front would pull the user's
      // window to it; neither is the agent's to do.
      if (
        message.method === "Target.setAutoAttach" ||
        message.method === "Page.bringToFront"
      ) {
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
  const stopWatching = publisher.subscribe("task.stateUpdated", (update) => {
    if (update.id === taskId && !closed) {
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
    for (const session of sessions.values()) {
      session.end();
    }
    sessions.clear();
  };
  clientWs.on("close", end);
  clientWs.on("error", end);
}

/** Sends a tab that was just made to its first page and waits for the load, capped. */
async function loadInNewTab(
  browser: WorkspaceConfig["browser"],
  targetId: BrowserTargetId,
  url: string,
): Promise<void> {
  const gate = createMainFrameLoadGate();
  const stop = browser.subscribeEvents(targetId, noop, (method, params) => {
    gate.observe(method, params);
  });
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
