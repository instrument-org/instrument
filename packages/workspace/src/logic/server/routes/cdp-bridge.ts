import type { Protocol } from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocket, WebSocketServer } from "ws";

import { ProjectSubdomainSchema } from "../../../schemas/subdomains";
import {
  type BrowserTargetId,
  BrowserTargetIdSchema,
  type WorkspaceConfig,
} from "../../../types";
import { CDP_BASE_PATH, CDP_PAGE_PATH_PREFIX } from "../constants";
import {
  type WorkspaceServerEnv,
  type WorkspaceServerParentRef,
} from "../types";
import { getWorkspaceServerPort } from "../url";

// CDP wire envelopes. Inbound is from agent-browser (untrusted JSON), outbound
// either has `result` (typed by command) or `error`, plus async event frames.
interface CdpEventFrame<E extends CdpEventName = CdpEventName> {
  method: E;
  params: CdpEventParams<E>;
  sessionId: string;
}
type CdpEventName = keyof ProtocolMapping.Events;
type CdpEventParams<E extends CdpEventName> = ProtocolMapping.Events[E][0];
interface CdpRequest {
  id?: number;
  method?: string;
  params?: unknown;
  sessionId?: string;
}
type CdpResponse =
  | { error: { code: number; message: string }; id?: number }
  | { id?: number; result: unknown };

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
  const subdomainResult = ProjectSubdomainSchema.safeParse(
    c.req.query("subdomain"),
  );
  if (!subdomainResult.success) {
    return c.json({ error: "subdomain query parameter required" }, 400);
  }

  const { browser } = c.get("workspaceConfig");
  const port = getWorkspaceServerPort();
  const targets = await browser.listTargets(subdomainResult.data);

  return c.json(
    targets.map((t) => ({
      description: "",
      devtoolsFrontendUrl: "",
      id: t.id,
      title: t.title,
      type: t.type,
      url: t.url,
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}${CDP_PAGE_PATH_PREFIX}${t.id}`,
    })),
  );
});

export function setupCdpWebSocketBridge(
  server: ServerType,
  workspaceConfig: WorkspaceConfig,
  workspaceRef: WorkspaceServerParentRef,
) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url?.startsWith(CDP_PAGE_PATH_PREFIX)) {
      return;
    }

    // The path component IS the target id: `${subdomain}/${sessionId}`.
    // No query parameters; everything routing-relevant is in the path so
    // the WS upgrade alone tells us which (subdomain, sessionId) is wired.
    const rawTargetId = req.url.slice(CDP_PAGE_PATH_PREFIX.length);
    const parsed = BrowserTargetIdSchema.safeParse(rawTargetId.split("?")[0]);
    if (!parsed.success) {
      socket.destroy();
      return;
    }
    const targetId = parsed.data;

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      handleCdpClient(clientWs, targetId, workspaceConfig, workspaceRef);
    });
  });
}

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

function handleCdpClient(
  clientWs: WebSocket,
  targetId: BrowserTargetId,
  workspaceConfig: WorkspaceConfig,
  workspaceRef: WorkspaceServerParentRef,
) {
  let unsubscribe: (() => void) | null = null;

  // Surface this WS connection to the projectBrowser machine so it can fan
  // out `agent-browser close --session <id>` at reap time. Lookup is cheap
  // and missing meta means the target was already destroyed; skip.
  const initialMeta = workspaceConfig.browser.getTargetMeta(targetId);
  if (initialMeta) {
    workspaceRef.send({
      type: "workspaceServer.attachAgentSession",
      value: {
        sessionId: initialMeta.sessionId,
        subdomain: initialMeta.subdomain,
      },
    });
  }

  const send = (payload: CdpEventFrame | CdpResponse) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  };

  const onDetach = () => {
    clientWs.close(1001, "Target detached");
  };

  const onEvent = (method: string, params: unknown) => {
    // Inject the synthetic sessionId so agent-browser can match events to the
    // session it attached to via Target.attachToTarget. Electron emits events
    // without a sessionId since the debugger is browser-level, but agent-browser
    // filters events by sessionId when waiting for Page.loadEventFired etc.
    send({
      method: method as CdpEventName,
      params: params as CdpEventParams<CdpEventName>,
      sessionId: `session-${targetId}`,
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
          sessionId: `session-${targetId}`,
        });
      }
    }
  };

  unsubscribe = workspaceConfig.browser.subscribeEvents(
    targetId,
    onDetach,
    onEvent,
  );

  clientWs.on("message", (data) => {
    let message: CdpRequest;
    try {
      const raw = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.from(data).toString("utf8");
      message = JSON.parse(raw) as CdpRequest;
    } catch {
      return;
    }

    const { id, method, params } = message;
    if (typeof method !== "string") {
      return;
    }

    // Intercept Target.* commands that would otherwise leak all Electron
    // targets through the browser-level debugger.
    if (INTERCEPTED_TARGET_COMMANDS.has(method)) {
      handleInterceptedTargetCommand(
        clientWs,
        id,
        method,
        params,
        targetId,
        workspaceConfig,
      );
      return;
    }

    // Real (non-intercepted) inbound command from agent-browser: count it as
    // agent activity and forward target meta into the projectBrowser machine.
    // The agent is the only writer on this WS so this matches real agent
    // command rate without throttling.
    const meta = workspaceConfig.browser.getTargetMeta(targetId);
    if (meta) {
      workspaceRef.send({
        type: "workspaceServer.updateCdpHeartbeat",
        value: {
          partitionDir: meta.partitionDir,
          sessionId: meta.sessionId,
          subdomain: meta.subdomain,
          targetId,
        },
      });
    }

    // sessionId is present when agent-browser uses flat session mode after
    // Target.attachToTarget. We issued a synthetic sessionId so we just strip
    // it and forward the command directly to the target's debugger.
    workspaceConfig.browser
      .sendCommand(targetId, method, params ?? {})
      .then((result) => {
        send({ id, result });
      })
      .catch((error: unknown) => {
        send({
          error: {
            code: -32_000,
            message: error instanceof Error ? error.message : "Command failed",
          },
          id,
        });
      });
  });

  clientWs.on("close", () => {
    unsubscribe?.();
    unsubscribe = null;
    // Stop any in-progress screencast so the capturePage interval doesn't
    // keep firing into the void (or bleed into the next WS connection for
    // the same target before it sends its own Page.startScreencast).
    workspaceConfig.browser.stopScreencast(targetId);
  });

  clientWs.on("error", () => {
    unsubscribe?.();
    unsubscribe = null;
    workspaceConfig.browser.stopScreencast(targetId);
  });
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
