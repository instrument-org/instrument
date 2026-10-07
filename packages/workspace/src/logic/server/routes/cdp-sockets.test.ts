import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { type WorkspaceConfig } from "../../../types";
import { cdpBridgeUrl } from "../cdp-bridge-path";
import { CDP_BASE_PATH } from "../constants";
import { type WorkspaceServerParentRef } from "../types";
import { setupCdpWebSocketBridge } from "./cdp-sockets";

const handled = vi.hoisted(() => ({
  task: [] as string[],
}));

vi.mock(import("./cdp-task-bridge"), () => ({
  handleTaskCdpClient: (client, taskId) => {
    handled.task.push(taskId);
    client.close();
  },
}));

const TASK_ID = "read-the-page";

let server: Server;
let port: number;

beforeEach(async () => {
  handled.task = [];
  server = createServer();
  setupCdpWebSocketBridge(
    server,
    {} as WorkspaceConfig,
    {} as WorkspaceServerParentRef,
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Whether the bridge took the upgrade, or the status it answered instead. */
function connect(url: string, headers: Record<string, string> = {}) {
  return new Promise<"open" | number>((resolve) => {
    const socket = new WebSocket(url, { headers });
    socket.on("open", () => {
      socket.close();
      resolve("open");
    });
    socket.on("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
    });
    socket.on("error", () => {
      resolve(0);
    });
  });
}

describe("setupCdpWebSocketBridge", () => {
  it("accepts a task's path carrying the launch's secret", async () => {
    expect(await connect(cdpBridgeUrl(port, TASK_ID))).toBe("open");
    expect(handled.task).toEqual([TASK_ID]);
  });

  it.each([
    ["no secret", `${CDP_BASE_PATH}/devtools/task/${TASK_ID}`],
    [
      "a wrong secret",
      `${CDP_BASE_PATH}/not-the-secret/devtools/task/${TASK_ID}`,
    ],
    ["an empty secret", `${CDP_BASE_PATH}//devtools/task/${TASK_ID}`],
  ])("refuses a path with %s", async (_name, path) => {
    expect(await connect(`ws://127.0.0.1:${port}${path}`)).toBe(403);
    expect(handled.task).toEqual([]);
  });

  it("refuses an upgrade carrying an Origin header, secret or not", async () => {
    const url = cdpBridgeUrl(port, TASK_ID);

    expect(await connect(url, { Origin: "https://example.com" })).toBe(403);
    expect(handled.task).toEqual([]);
  });
});
