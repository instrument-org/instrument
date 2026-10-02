import { type ServerType } from "@hono/node-server";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { type WorkspaceConfig } from "../../../types";
import { withCdpBridgeKey } from "../cdp-access";
import { CDP_TASK_PATH_PREFIX } from "../constants";
import { type WorkspaceServerParentRef } from "../types";
import { setupCdpWebSocketBridge } from "./cdp-sockets";

const handled = vi.hoisted(() => ({ count: 0 }));
vi.mock("./cdp-task-bridge", () => ({
  handleTaskCdpClient: (ws: WebSocket) => {
    handled.count += 1;
    ws.close();
  },
}));
vi.mock("./cdp-bridge", () => ({ handleCdpClient: () => undefined }));

let server: Server;
let port: number;

beforeEach(async () => {
  handled.count = 0;
  server = createServer();
  // A plain http server is what @hono/node-server's `serve` returns.
  setupCdpWebSocketBridge(
    server satisfies ServerType,
    {} as WorkspaceConfig, // Unused: the client handlers are mocked.
    {} as WorkspaceServerParentRef,
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  ({ port } = server.address() as AddressInfo); // Listening on TCP.
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function taskUrl() {
  return `ws://127.0.0.1:${port}${CDP_TASK_PATH_PREFIX}read-the-pages`;
}

/** Whether the bridge accepts the upgrade. */
function connects(url: string, headers: Record<string, string> = {}) {
  return new Promise<boolean>((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.once("open", () => {
      ws.close();
      resolve(true);
    });
    ws.once("error", () => {
      resolve(false);
    });
  });
}

describe("the CDP socket bridge", () => {
  it("connects a client carrying this launch's key", async () => {
    expect(await connects(withCdpBridgeKey(taskUrl()))).toBe(true);
    expect(handled.count).toBe(1);
  });

  it.each([
    ["no key", () => taskUrl(), {}],
    ["a wrong key", () => `${taskUrl()}?key=${"0".repeat(64)}`, {}],
    [
      "a page's Origin",
      () => withCdpBridgeKey(taskUrl()),
      { Origin: "https://evil.example" },
    ],
    [
      "a file page's Origin",
      () => withCdpBridgeKey(taskUrl()),
      { Origin: "null" },
    ],
    [
      "a rebound host name",
      () => withCdpBridgeKey(taskUrl()),
      { Host: "evil.example:48100" },
    ],
  ])("refuses %s", async (_label, url, headers) => {
    expect(await connects(url(), headers)).toBe(false);
    expect(handled.count).toBe(0);
  });
});
