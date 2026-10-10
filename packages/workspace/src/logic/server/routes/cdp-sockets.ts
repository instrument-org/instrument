import { type ServerType } from "@hono/node-server";
import { type IncomingMessage } from "node:http";
import { type Duplex } from "node:stream";
import { WebSocketServer } from "ws";

import { StoreId } from "../../../schemas/store-id";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { type WorkspaceConfig } from "../../../types";
import { parseCdpBridgePath } from "../cdp-bridge-path";
import { type WorkspaceServerParentRef } from "../types";
import { handleTaskCdpClient } from "./cdp-task-bridge";

/**
 * Routes an agent's CDP connection by its path to the browser of the session
 * it names: the tabs that session holds. Every path carries the launch's bridge
 * secret (`cdp-bridge-path.ts`), and an upgrade carrying an
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

    const taskId = ChatIdSchema.safeParse(target.taskId);
    const sessionId = StoreId.SessionSchema.safeParse(target.sessionId);
    if (!taskId.success || !sessionId.success) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      handleTaskCdpClient(
        clientWs,
        { sessionId: sessionId.data, taskId: taskId.data },
        workspaceConfig,
        workspaceRef,
      );
    });
  });
}

function refuse(socket: Duplex): void {
  socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
}
