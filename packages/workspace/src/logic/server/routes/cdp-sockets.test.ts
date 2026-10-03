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
  page: [] as string[],
  task: [] as string[],
}));

vi.mock(import("./cdp-bridge"), () => ({
  handleCdpClient: (client, targetId) => {
    handled.page.push(targetId);
    client.close();
  },
}));
vi.mock(import("./cdp-task-bridge"), () => ({
  handleTaskCdpClient: (client, taskId) => {
    handled.task.push(taskId);
    client.close();
  },
}));

const TASK_ID = "read-the-page";
const TARGET_ID = "1/ses_01M3AX9RF3C2E9RTATMB602W0B";

let server: Server;
let port: number;

beforeEach(async () => {
  handled.page = [];
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
  it.each([
    { kind: "task" as const, id: TASK_ID },
    { kind: "page" as const, id: TARGET_ID },
  ])("accepts a $kind path carrying the launch's secret", async (target) => {
    expect(await connect(cdpBridgeUrl(port, target))).toBe("open");
    expect(handled[target.kind]).toEqual([target.id]);
  });

  it.each([
    ["no secret", `${CDP_BASE_PATH}/devtools/task/${TASK_ID}`],
    [
      "a wrong secret",
      `${CDP_BASE_PATH}/not-the-secret/devtools/task/${TASK_ID}`,
    ],
    ["an empty secret", `${CDP_BASE_PATH}//devtools/page/${TARGET_ID}`],
  ])("refuses a path with %s", async (_name, path) => {
    expect(await connect(`ws://127.0.0.1:${port}${path}`)).toBe(403);
    expect(handled).toEqual({ page: [], task: [] });
  });

  it("refuses an upgrade carrying an Origin header, secret or not", async () => {
    const url = cdpBridgeUrl(port, { id: TASK_ID, kind: "task" });

    expect(await connect(url, { Origin: "https://example.com" })).toBe(403);
    expect(handled.task).toEqual([]);
  });
});
