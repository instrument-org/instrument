import type { Protocol } from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import { Hono } from "hono";
import { WebSocket } from "ws";

import { noteBrowserAgentActivity } from "../../../lib/browser-agent-activity";
import {
  agentPathOfFileUrl,
  agentSpellingOfFileUrls,
  isLocalAddress,
} from "../../../lib/local-page-address";
import { taskFsLayout } from "../../../lib/resolve-workspace-file-path";
import {
  nonTaskMounts,
  type WorkspaceFsLayout,
} from "../../../lib/workspace-fs-layout";
import { TaskIdSchema } from "../../../schemas/task-id";
import { type BrowserTargetId, type WorkspaceConfig } from "../../../types";
import { CDP_BASE_PATH, CDP_PAGE_PATH_PREFIX } from "../constants";
import {
  type WorkspaceServerEnv,
  type WorkspaceServerParentRef,
} from "../types";
import { getWorkspaceServerPort } from "../url";

// CDP wire envelopes. Inbound is from agent-browser (untrusted JSON), outbound
// either has `result` (typed by command) or `error`, plus async event frames.
export interface CdpEventFrame<E extends CdpEventName = CdpEventName> {
  method: E;
  params: CdpEventParams<E>;
  sessionId: string;
}
export interface CdpRequest {
  id?: number;
  method?: string;
  params?: unknown;
  sessionId?: string;
}
export type CdpResponse =
  | { error: { code: number; message: string }; id?: number }
  | { id?: number; result: unknown };
type CdpEventName = keyof ProtocolMapping.Events;
type CdpEventParams<E extends CdpEventName> =
  ProtocolMapping.Events[E][0];

export const cdpBridgeRoute = new Hono<WorkspaceServerEnv>().basePath(
  CDP_BASE_PATH,
);

cdpBridgeRoute.get("/json/version", (c) => {
  const port = getWorkspaceServerPort();
  return c.json({
    Browser: "Electron/Chromium",
    "Protocol-Version": "1.3",
    "User-Agent": "Electron",
    "V8-Version": process.versions.v8,
    "WebKit-Version": "",
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}${CDP_BASE_PATH}/devtools/browser`,
  });
});

cdpBridgeRoute.get("/json", async (c) => {
  const subdomainResult = TaskIdSchema.safeParse(c.req.query("id"));
  if (!subdomainResult.success) {
    return c.json({ error: "id query parameter required" }, 400);
  }

  const { browser } = c.get("workspaceConfig");
  const port = getWorkspaceServerPort();
  const targets = await browser.listTargets(subdomainResult.data);
  // The listing is the agent's, so a local page is named by the agent's path.
  const layout = await taskFsLayout(subdomainResult.data);

  return c.json(
    targets.map((t) => ({
      description: "",
      devtoolsFrontendUrl: "",
      id: t.id,
      title: t.title,
      type: t.type,
      url: agentSpellingOfFileUrls(t.url, layout),
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}${CDP_PAGE_PATH_PREFIX}${t.id}`,
    })),
  );
});

// Commands that operate on the browser-level target tree. We intercept these
// and return synthetic responses scoped to just the single WebContentsView
// target so agent-browser doesn't discover or attach to unrelated Electron
// targets (the Studio renderer, DevTools windows, etc.).
const INTERCEPTED_TARGET_COMMANDS = new Set([
  "Target.activateTarget",
  "Target.attachToTarget",
  "Target.closeTarget",
  "Target.createBrowserContext",
  "Target.createTarget",
  "Target.disposeBrowserContext",
  "Target.getTargets",
  "Target.setAutoAttach",
  "Target.setDiscoverTargets",
]);

// How long a `Page.navigate` answer is held for the main frame's load before
// it is released anyway. Under agent-browser's 30s per-command timeout with
// margin; a page slower than this is better returned (the agent can `wait` or
// re-read) than left to trip that timeout.
export const NAVIGATE_HOLD_CAP_MS = 20_000;

/** A wait for the main frame's load, resolvable early by `cancel`. */
interface HeldNavigate {
  cancel: () => void;
  promise: Promise<void>;
}

/**
 * Tracks which frame is the main one and lets a navigate wait for its load.
 *
 * Electron answers `Page.navigate` the moment the load commits, before the
 * document has parsed, and agent-browser's `open` returns on that answer. So
 * the bridge holds the answer until the main frame's load, which this gate
 * reports from `Page.frameStoppedLoading`. Only the main frame counts: a
 * listing carries a dozen ad iframes, some still finishing the page being left
 * when the navigate is issued, and any one of them stopping would release the
 * hold onto a page whose `<title>` had not parsed. The main frame is the one
 * whose `Page.frameNavigated` carries no `parentId`; its id holds across
 * navigations.
 */
export function createMainFrameLoadGate() {
  let mainFrameId: string | undefined;
  let releasePending: (() => void) | undefined;

  return {
    observe(method: string, params: unknown): void {
      if (method === "Page.frameNavigated") {
        const { frame } = params as Protocol.Page.FrameNavigatedEvent;
        if (frame.parentId === undefined) {
          mainFrameId = frame.id;
        }
        return;
      }
      if (method === "Page.frameStoppedLoading") {
        const { frameId } = params as Protocol.Page.FrameStoppedLoadingEvent;
        if (frameId === mainFrameId) {
          releasePending?.();
        }
      }
    },
    /**
     * A `promise` that resolves on the main frame's next load, or after
     * `capMs`, whichever comes first. Create it before forwarding the navigate
     * so a load racing the answer is not missed; `cancel` resolves it at once
     * (a same-document navigation that will never fire a load).
     */
    nextMainFrameLoad(capMs: number): HeldNavigate {
      let resolveLoad!: () => void;
      const promise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });
      const cap: { timer?: ReturnType<typeof setTimeout> } = {};
      const done = () => {
        clearTimeout(cap.timer);
        if (releasePending === done) {
          releasePending = undefined;
        }
        resolveLoad();
      };
      cap.timer = setTimeout(done, capMs);
      releasePending = done;
      return { cancel: done, promise };
    },
  };
}

export function hasLoaderId(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    typeof (result as { loaderId?: unknown }).loaderId === "string"
  );
}

// Agent traffic that is not the agent doing anything: a recording session acks
// every frame it is handed, so counting those would report the browser as busy
// for as long as the recording runs rather than while something is happening in
// it. Everything else -- clicking, typing, navigating, reading the page --
// counts, because from outside the pane they are all the same news.
const SILENT_COMMANDS = new Set(["Page.screencastFrameAck"]);

/**
 * Commands the agent may still send while its tab shows a file it could not
 * read: leaving or reloading the page, switching on the event domains
 * agent-browser opens a connection with, and undoing a pause it set up before
 * the tab got there. Anything that reads the page, acts in it, or could hold
 * or change it for the person (a request interception, a debugger, blocked
 * addresses, emulation) is refused, and so is any `Target.*` command the
 * bridge does not answer itself.
 */
const PASSES_CLOSED_FILE_GATE =
  /^(?:(?:Page|Runtime|Network|DOM|CSS|Log|Accessibility|Inspector|Security|Performance)\.enable|Page\.(?:navigate|navigateToHistoryEntry|reload|stopLoading|stopScreencast|screencastFrameAck|setLifecycleEventsEnabled)|Fetch\.(?:disable|continueRequest|continueWithAuth|failRequest)|Debugger\.(?:disable|resume))$/;

/**
 * Events that carry a page's content or its addresses, held back while the
 * gate is closed.
 */
const WITHHELD_EVENTS =
  /^(?:Page\.screencastFrame|Runtime\.(?:consoleAPICalled|exceptionThrown|bindingCalled)|Log\..*|DOM\..*|CSS\..*|Accessibility\..*|Debugger\..*|Console\..*|Network\..*|Fetch\..*)$/;

/**
 * Events that name an address, held back whenever the address is a file the
 * agent could not read: a navigation's own events arrive before the document
 * it loads, so the gate has not closed yet.
 */
const ADDRESSED_EVENTS = /^(?:Network|Fetch|Page)\./;

/** The overrides a closing connection puts back, each as its neutral value. */
const TEARDOWN_RESETS: [string, Record<string, unknown>][] = [
  ["Network.setBlockedURLs", { urls: [] }],
  ["Network.setExtraHTTPHeaders", { headers: {} }],
  ["Network.setCacheDisabled", { cacheDisabled: false }],
  [
    "Network.emulateNetworkConditions",
    {
      downloadThroughput: -1,
      latency: 0,
      offline: false,
      uploadThroughput: -1,
    },
  ],
  ["Emulation.setScriptExecutionDisabled", { value: false }],
  ["Emulation.setCPUThrottlingRate", { rate: 1 }],
  ["Emulation.setEmulatedMedia", { features: [], media: "" }],
];

/**
 * Connections to each target, so the main process forgets an agent's folders
 * only once no agent is connected to the tab.
 */
const connectionsByTarget = new Map<BrowserTargetId, number>();

/** One page an agent's connection drives, under the session id its frames carry. */
export interface TargetSession {
  /** Stops listening to the page and puts back what the agent changed on it. */
  end: () => void;
  /** Handles one of the agent's commands for this page, in arrival order. */
  run: (message: CdpRequest) => void;
  sessionId: string;
  targetId: BrowserTargetId;
}

/**
 * Whether the page in a tab is a local file the agent could not have read.
 *
 * Judged against the address the guest shows now, as the main process sees
 * it, on every command and event; never against the last navigation event
 * the bridge happened to hear, which a page can outrun and the agent can
 * switch off. Closed until the task's layout has been read, so a command
 * racing that first read is refused rather than answered. Every read of the
 * layout is handed to `onLayout`, which is how the main process learns the
 * folders a page in this tab may not take it out of.
 */
export function createLocalFileGate({
  currentUrl,
  onLayout,
  readLayout,
}: {
  currentUrl: () => string | undefined;
  onLayout?: (layout: WorkspaceFsLayout) => void;
  readLayout: (() => Promise<WorkspaceFsLayout>) | undefined;
}) {
  let layout: undefined | WorkspaceFsLayout;
  let loaded = false;

  const read = async () => {
    const next = await readLayout?.();
    if (next) {
      layout = next;
      onLayout?.(next);
    }
    loaded = true;
  };

  return {
    /** Whether an address is a file on this computer the agent could not read. */
    hides(url: string | undefined) {
      return (
        url !== undefined &&
        isLocalAddress(url) &&
        (layout === undefined || agentPathOfFileUrl(layout, url) === null)
      );
    },
    isClosed() {
      if (!loaded) {
        return true;
      }
      const url = currentUrl();
      return (
        url !== undefined &&
        isLocalAddress(url) &&
        (layout === undefined || agentPathOfFileUrl(layout, url) === null)
      );
    },
    load: read,
    /** Rereads the layout, since a folder may have been attached since. */
    async mayOpen(url: string) {
      await read();
      return layout !== undefined && agentPathOfFileUrl(layout, url) !== null;
    },
  };
}

/**
 * A connection pinned to one page: the page endpoint, which a chat's
 * conversation and a task no chat owns are handed. The `Target.*` domain is
 * answered here with that one page, so the agent can never discover or attach
 * to any other.
 */
export function handleCdpClient(
  clientWs: WebSocket,
  targetId: BrowserTargetId,
  workspaceConfig: WorkspaceConfig,
  workspaceRef: WorkspaceServerParentRef,
) {
  const send = (payload: CdpEventFrame | CdpResponse) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  };
  const session = openTargetSession({
    onDetach: () => {
      clientWs.close(1001, "Target detached");
    },
    send,
    sessionId: `session-${targetId}`,
    targetId,
    workspaceConfig,
    workspaceRef,
  });

  clientWs.on("message", (data) => {
    const message = parseCdpMessage(data);
    if (!message) {
      return;
    }
    // Intercept Target.* commands that would otherwise leak all Electron
    // targets through the browser-level debugger.
    if (
      typeof message.method === "string" &&
      INTERCEPTED_TARGET_COMMANDS.has(message.method)
    ) {
      handleInterceptedTargetCommand(
        clientWs,
        message.id,
        message.method,
        message.params,
        targetId,
        workspaceConfig,
      );
      return;
    }
    session.run(message);
  });

  clientWs.on("close", session.end);
  clientWs.on("error", session.end);
}

/** The refusal of a local file the agent's own tools could not read. */
export function notYourFile(url: string) {
  return {
    code: -32_000,
    message: `${url} is not a file you can open. Open a file by the path you reach it at (agent-browser open work/page.html).`,
  };
}

/**
 * Wires one page to an agent's connection: its events go out tagged with
 * `sessionId`, its commands go to the page's debugger behind the local-file
 * gate, a navigation's answer waits for the main frame's load, and ending the
 * session undoes what the agent set up on the page. `send` writes a frame to
 * the connection; `onDetach` hears the page going away.
 */
export function openTargetSession({
  onDetach,
  send,
  sessionId,
  targetId,
  workspaceConfig,
  workspaceRef,
}: {
  onDetach: () => void;
  send: (payload: CdpEventFrame | CdpResponse) => void;
  sessionId: string;
  targetId: BrowserTargetId;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceServerParentRef;
}): TargetSession {
  let unsubscribe: (() => void) | null = null;

  // Surface this page's connection to the taskBrowser machine so it can fan
  // out `agent-browser close --session <id>` at reap time. Lookup is cheap
  // and missing meta means the target was already destroyed; skip.
  const initialMeta = workspaceConfig.browser.getTargetMeta(targetId);
  if (initialMeta) {
    workspaceRef.send({
      type: "workspaceServer.attachAgentSession",
      value: {
        id: initialMeta.id,
        sessionId: initialMeta.sessionId,
      },
    });
  }

  // Gates a held `Page.navigate` response on the main frame's load (see the
  // command handler).
  const loadGate = createMainFrameLoadGate();

  // Which local files this agent may look at: the ones its own tools reach.
  // Commands are handled in arrival order behind `queue`, and the first one
  // waits for the layout and the page's current address, so nothing is
  // answered against a page the bridge has not yet judged.
  // Set once the session has ended, after which a layout read still in
  // flight must not hand the main process folders nobody is connected for.
  let ended = false;
  const fileGate = createLocalFileGate({
    currentUrl: () => workspaceConfig.browser.getTargetUrl(targetId),
    onLayout: (layout) => {
      if (!ended) {
        workspaceConfig.browser.setAgentFileRoots(
          targetId,
          hostRootsOf(layout),
        );
      }
    },
    readLayout: initialMeta ? () => taskFsLayout(initialMeta.id) : undefined,
  });
  let queue = fileGate.load().catch(workspaceConfig.captureException);

  connectionsByTarget.set(
    targetId,
    (connectionsByTarget.get(targetId) ?? 0) + 1,
  );

  const onEvent = (method: string, params: unknown) => {
    // A request's events come before the document it loads, so one taking the
    // tab to a file the agent may not see is held back on its address alone.
    // Every event still counts toward a held navigation's load, whether or not
    // the agent hears it.
    loadGate.observe(method, params);
    if (
      (WITHHELD_EVENTS.test(method) && fileGate.isClosed()) ||
      (ADDRESSED_EVENTS.test(method) && fileGate.hides(addressOfEvent(params)))
    ) {
      // A pause the agent set up before the tab got here would hold a page
      // it may not see; the bridge lets it go rather than the agent.
      if (method === "Fetch.requestPaused") {
        const { requestId } = params as Protocol.Fetch.RequestPausedEvent;
        void workspaceConfig.browser
          .sendCommand(targetId, "Fetch.continueRequest", { requestId })
          .catch(noop);
      }
      if (method === "Network.requestIntercepted") {
        const { interceptionId } =
          params as Protocol.Network.RequestInterceptedEvent;
        void workspaceConfig.browser
          .sendCommand(targetId, "Network.continueInterceptedRequest", {
            interceptionId,
          })
          .catch(noop);
      }
      if (method === "Debugger.paused") {
        void workspaceConfig.browser
          .sendCommand(targetId, "Debugger.resume", {})
          .catch(noop);
      }
      return;
    }

    // Tag the event with the session the agent attached under, so it can
    // match events to the page they came from. Electron emits events without
    // a sessionId since the debugger is browser-level, but agent-browser
    // filters events by sessionId when waiting for Page.loadEventFired etc.
    send({
      method: method as CdpEventName,
      params: params as CdpEventParams<CdpEventName>,
      sessionId,
    });

    // Synthesize Page.loadEventFired from Page.frameStoppedLoading.
    // Electron's debugger does not emit Page.loadEventFired natively; agent-
    // browser's poll_network_idle uses it as the idle-timer trigger when the
    // Network pending set is already empty (e.g. cached page loads). Without
    // this, poll_network_idle falls back to a 600ms recv-timeout cycle before
    // setting idle_start, adding unnecessary latency after every navigation.
    if (method === "Page.frameStoppedLoading") {
      const { frameId } = params as Protocol.Page.FrameStoppedLoadingEvent;
      if (frameId) {
        send({
          method: "Page.loadEventFired",
          params: {
            timestamp: Date.now() / 1000,
          } satisfies Protocol.Page.LoadEventFiredEvent,
          sessionId,
        });
      }
    }
  };

  unsubscribe = workspaceConfig.browser.subscribeEvents(
    targetId,
    onDetach,
    onEvent,
  );

  const handleCommand = async (message: CdpRequest) => {
    const { id, method, params } = message;
    if (typeof method !== "string") {
      return;
    }

    // A local file opens at its `file://` address for the agent exactly as it
    // does for the person, and only when the agent's own tools could read it:
    // that address space is the whole computer.
    const navigatedTo = navigationTargetOf(method, params);
    if (
      navigatedTo !== undefined &&
      isLocalAddress(navigatedTo) &&
      !(await fileGate.mayOpen(navigatedTo))
    ) {
      send({ error: notYourFile(navigatedTo), id });
      return;
    }

    // A page can still take its tab to a file the agent could not have
    // opened (a link, a script setting `location`), and the person can open
    // one in a tab the agent drives. Until the tab leaves it, the agent may
    // navigate away and nothing else.
    if (fileGate.isClosed() && !PASSES_CLOSED_FILE_GATE.test(method)) {
      send({
        error: {
          code: -32_000,
          message:
            "This tab is showing a file outside the folders you can read, so it cannot be read or used from here. Open one of your own pages, or ask the user.",
        },
        id,
      });
      return;
    }

    // Real inbound command from agent-browser: count it as agent activity and
    // forward target meta into the taskBrowser machine. The agent is the only
    // writer on this page so this matches real agent command rate without
    // throttling.
    const meta = workspaceConfig.browser.getTargetMeta(targetId);
    if (meta) {
      workspaceRef.send({
        type: "workspaceServer.updateCdpHeartbeat",
        value: {
          id: meta.id,
          partitionDir: meta.partitionDir,
          sessionId: meta.sessionId,
          targetId,
        },
      });
      if (!SILENT_COMMANDS.has(method)) {
        noteBrowserAgentActivity(meta.id, targetId);
      }
    }

    // Arm the main-frame-load wait before forwarding the navigate, so a load
    // that lands between the command resolving and the await cannot be missed.
    const heldNavigate =
      method === "Page.navigate"
        ? loadGate.nextMainFrameLoad(NAVIGATE_HOLD_CAP_MS)
        : undefined;

    // The session id the agent sent is ours, so the command goes straight to
    // the page's own debugger without it.
    workspaceConfig.browser
      .sendCommand(targetId, method, params ?? {})
      .then(async (result) => {
        // Electron answers `Page.navigate` as soon as the load is committed,
        // and agent-browser's `open` returns on that answer rather than
        // blocking for the load event -- so a read one step later saw an empty
        // page. Hold the answer until the main frame's load (`heldNavigate`),
        // capped so a page that never fires it still returns well inside
        // agent-browser's own 30s command timeout. A same-document navigation
        // carries no `loaderId` and fires no load, so it is not held.
        if (heldNavigate) {
          if (hasLoaderId(result)) {
            await heldNavigate.promise;
          } else {
            heldNavigate.cancel();
          }
        }
        send({ id, result });
      })
      .catch((error: unknown) => {
        heldNavigate?.cancel();
        send({
          error: {
            code: -32_000,
            message: error instanceof Error ? error.message : "Command failed",
          },
          id,
        });
      });
  };

  const end = () => {
    unsubscribe?.();
    unsubscribe = null;
    // Stop any in-progress screencast so the capturePage interval doesn't
    // keep firing into the void (or bleed into the next connection for the
    // same target before it sends its own Page.startScreencast).
    workspaceConfig.browser.stopScreencast(targetId);
    if (ended) {
      return;
    }
    ended = true;
    // An interception or a debugger this connection set up would otherwise
    // go on holding the person's page with nobody left to release it.
    void workspaceConfig.browser
      .sendCommand(targetId, "Fetch.disable", {})
      .catch(noop);
    void workspaceConfig.browser
      .sendCommand(targetId, "Network.setRequestInterception", { patterns: [] })
      .catch(noop);
    void workspaceConfig.browser
      .sendCommand(targetId, "Debugger.disable", {})
      .catch(noop);
    // Nor may anything it set up to change the page go on changing it for
    // the person: blocked addresses, disabled scripts, a throttled CPU or
    // network.
    for (const [method, params] of TEARDOWN_RESETS) {
      void workspaceConfig.browser
        .sendCommand(targetId, method, params)
        .catch(noop);
    }
    const remaining = (connectionsByTarget.get(targetId) ?? 1) - 1;
    if (remaining > 0) {
      connectionsByTarget.set(targetId, remaining);
    } else {
      connectionsByTarget.delete(targetId);
      workspaceConfig.browser.setAgentFileRoots(targetId, null);
    }
  };

  return {
    end,
    run: (message) => {
      queue = queue
        .then(() => handleCommand(message))
        .catch(workspaceConfig.captureException);
    },
    sessionId,
    targetId,
  };
}

/** A frame from the agent, or undefined for one that is not JSON. */
export function parseCdpMessage(
  data: ArrayBuffer | Buffer | Buffer[],
): CdpRequest | undefined {
  try {
    const raw = Buffer.isBuffer(data)
      ? data.toString("utf8")
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : Buffer.from(data).toString("utf8");
    return JSON.parse(raw) as CdpRequest;
  } catch {
    return undefined;
  }
}

/** The address an event is about, when it names one. */
function addressOfEvent(params: unknown) {
  const event = params as
    | undefined
    | {
        documentURL?: unknown;
        frame?: { url?: unknown };
        request?: { url?: unknown };
        response?: { url?: unknown };
        url?: unknown;
      };
  const url =
    event?.request?.url ??
    event?.response?.url ??
    event?.documentURL ??
    event?.frame?.url ??
    event?.url;
  return typeof url === "string" ? url : undefined;
}

function handleInterceptedTargetCommand(
  clientWs: WebSocket,
  id: number | undefined,
  method: string,
  params: unknown,
  targetId: BrowserTargetId,
  workspaceConfig: WorkspaceConfig,
) {
  const send = (payload: CdpResponse) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  };

  switch (method) {
    case "Target.activateTarget":
    case "Target.closeTarget": {
      // Silently succeed; lifecycle is managed by BrowserViewManager.
      send({ id, result: {} });
      return;
    }

    case "Target.attachToTarget": {
      const p = params as Protocol.Target.AttachToTargetRequest | undefined;
      const requestedId = p?.targetId;
      // Only allow attaching to the target this connection owns.
      if (requestedId && requestedId !== targetId) {
        send({
          error: {
            code: -32_000,
            message: `Target ${requestedId} is not accessible from this connection`,
          },
          id,
        });
        return;
      }
      // The WebContentsView debugger is already attached at the browser level;
      // Electron doesn't support Target.attachToTarget with our integer-based
      // targetId. Return a synthetic sessionId - commands sent with this
      // sessionId are stripped of it and forwarded directly to the debugger.
      const result: Protocol.Target.AttachToTargetResponse = {
        sessionId: `session-${targetId}`,
      };
      send({ id, result });
      return;
    }
    case "Target.createBrowserContext":
    case "Target.disposeBrowserContext": {
      // Electron doesn't support CDP browser context management. Return a
      // synthetic context ID so agent-browser's recording flow can proceed.
      // Download behavior is handled via Browser.setDownloadBehavior interception
      // in BrowserViewManager.
      const result: Protocol.Target.CreateBrowserContextResponse = {
        browserContextId: `context-${targetId}`,
      };
      send({ id, result });
      return;
    }

    case "Target.createTarget": {
      // agent-browser may try to open a new tab; redirect it to the existing
      // target rather than creating one (which is not supported on a
      // WebContentsView debugger). If a URL was requested, navigate to it.
      const cp = params as Protocol.Target.CreateTargetRequest | undefined;
      const url = cp?.url;
      const result: Protocol.Target.CreateTargetResponse = { targetId };
      if (url && url !== "about:blank") {
        workspaceConfig.browser
          .sendCommand(targetId, "Page.navigate", { url })
          .then(() => {
            send({ id, result });
          })
          .catch(() => {
            send({ id, result });
          });
      } else {
        send({ id, result });
      }
      return;
    }

    case "Target.getTargets": {
      // Return a synthetic single-target list scoped to just this view.
      // The underlying Target.getTargets leaks all Electron targets because
      // the WebContentsView debugger is browser-level.
      const result: Protocol.Target.GetTargetsResponse = {
        targetInfos: [
          {
            attached: true,
            canAccessOpener: false,
            targetId,
            title: "",
            type: "page",
            url: "",
          },
        ],
      };
      send({ id, result });
      return;
    }

    case "Target.setAutoAttach": {
      // Do not forward to Electron. Forwarding causes Electron to emit
      // Target.attachedToTarget events for real iframe sub-sessions. Those
      // real sub-session IDs leak into agent-browser's iframe_sessions map,
      // causing subsequent CDP commands (Page.enable, Network.enable,
      // Accessibility.getFullAXTree) to be sent with the wrong session ID
      // and potentially hang or fail. We are running in a flat, single-target
      // model; Electron's WebContentsView debugger already auto-attaches to
      // frames at the browser level.
      send({ id, result: {} });
      return;
    }

    case "Target.setDiscoverTargets": {
      // Acknowledge but do nothing; we don't emit Target.targetCreated events.
      send({ id, result: {} });
      return;
    }

    default: {
      send({ error: { code: -32_601, message: "Method not found" }, id });
    }
  }
}

/** The host folders behind every mount of a layout. */
function hostRootsOf(layout: WorkspaceFsLayout) {
  return [layout.task, ...nonTaskMounts(layout)].map((mount) => mount.hostRoot);
}

/** The address a command asks the guest to load, for the commands that carry one. */
function navigationTargetOf(method: string, params: unknown) {
  if (method !== "Page.navigate" && method !== "Target.createTarget") {
    return;
  }
  const url = (params as undefined | { url?: unknown })?.url;
  return typeof url === "string" ? url : undefined;
}

function noop() {
  // A best-effort command on a guest that may already be gone.
}
