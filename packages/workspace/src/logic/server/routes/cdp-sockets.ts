import { type ServerType } from "@hono/node-server";
import { type IncomingMessage } from "node:http";
import { type Duplex } from "node:stream";
import { WebSocketServer } from "ws";

import { TaskIdSchema } from "../../../schemas/task-id";
import { BrowserTargetIdSchema, type WorkspaceConfig } from "../../../types";
import { isAuthorizedCdpRequest } from "../cdp-access";
import {
  CDP_BASE_PATH,
  CDP_PAGE_PATH_PREFIX,
  CDP_TASK_PATH_PREFIX,
} from "../constants";
import { type WorkspaceServerParentRef } from "../types";
import { handleCdpClient } from "./cdp-bridge";
import { handleTaskCdpClient } from "./cdp-task-bridge";

/**
 * Routes an agent's CDP connection by its path: a task's whole browser, the
 * tabs it holds, or one page by its target id. A connection without this
 * launch's key, or from a browser page, is refused before any routing.
 */
export function setupCdpWebSocketBridge(
  server: ServerType,
  workspaceConfig: WorkspaceConfig,
  workspaceRef: WorkspaceServerParentRef,
) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url?.startsWith(CDP_BASE_PATH)) {
      return;
    }
    if (
      !isAuthorizedCdpRequest({
        host: req.headers.host,
        origin: req.headers.origin,
        url: req.url,
      })
    ) {
      socket.destroy();
      return;
    }
    if (req.url?.startsWith(CDP_TASK_PATH_PREFIX)) {
      const taskId = TaskIdSchema.safeParse(
        req.url.slice(CDP_TASK_PATH_PREFIX.length).split("?")[0],
      );
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
    if (!req.url.startsWith(CDP_PAGE_PATH_PREFIX)) {
      socket.destroy();
      return;
    }

    // The path component IS the target id: `${id}/${sessionId}`.
    // No query parameters; everything routing-relevant is in the path so
    // the WS upgrade alone tells us which (id, sessionId) is wired.
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
