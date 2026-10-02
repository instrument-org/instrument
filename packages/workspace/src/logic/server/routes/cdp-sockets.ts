import { type ServerType } from "@hono/node-server";
import { type IncomingMessage } from "node:http";
import { type Duplex } from "node:stream";
import { WebSocketServer } from "ws";

import { TaskIdSchema } from "../../../schemas/task-id";
import { BrowserTargetIdSchema, type WorkspaceConfig } from "../../../types";
import { parseCdpBridgePath } from "../cdp-bridge-path";
import { type WorkspaceServerParentRef } from "../types";
import { handleCdpClient } from "./cdp-bridge";
import { handleTaskCdpClient } from "./cdp-task-bridge";

/**
 * Routes an agent's CDP connection by its path: a task's whole browser, the
 * tabs it holds, or one page by its target id. Every path carries the
 * launch's bridge secret (`cdp-bridge-path.ts`), and an upgrade carrying an
 * `Origin` header is refused whatever its path: browsers always send one on a
 * WebSocket, and agent-browser's client never does, so the header marks a web
 * page trying its luck against loopback.
 */
export function setupCdpWebSocketBridge(
  server: ServerType,
  workspaceConfig: WorkspaceConfig,
  workspaceRef: WorkspaceServerParentRef,
) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const target = parseCdpBridgePath(req.url);
    if (target === undefined) {
      return;
    }
    if (target === "refused" || req.headers.origin !== undefined) {
      refuse(socket);
      return;
    }

    if (target.kind === "task") {
      const taskId = TaskIdSchema.safeParse(target.id);
      if (!taskId.success) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        handleTaskCdpClient(
          clientWs,
          taskId.data,
          workspaceConfig,
          workspaceRef,
        );
      });
      return;
    }

    // The path component IS the target id: `${id}/${sessionId}`.
    // No query parameters; everything routing-relevant is in the path so
    // the WS upgrade alone tells us which (id, sessionId) is wired.
    const parsed = BrowserTargetIdSchema.safeParse(target.id);
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

function refuse(socket: Duplex): void {
  socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
}
