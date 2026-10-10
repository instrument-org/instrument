import dns from "node:dns/promises";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getWorkspaceServerPort,
  setWorkspaceServerPort,
} from "../logic/server/url";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";

// The shell's network commands go through `createSandboxFetch` rather than
// just-bash's own fetch, and only a real request through a real shell proves
// that wiring holds: the command, the fetch handed to just-bash, and the
// refusal of the workspace server's port, redirects included.
const REACHABLE_HOST = "registry.npmjs.org";
const REACHABLE_URL = `https://${REACHABLE_HOST}/-/ping`;

// The one external name CI already depends on: if it cannot be reached, the
// install that produced this checkout could not have run either. Resolving it
// up front separates "the machine is offline" from "the sandbox cannot fetch",
// so a developer working on a plane sees a skip rather than a failure.
const online = await dns
  .lookup(REACHABLE_HOST)
  .then(() => true)
  .catch(() => false);

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let chatId: ReturnType<typeof createMockChatConfigForDir>;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-network-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(taskRoot, ".instrument"), { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(taskRoot), { model });
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("bash sandbox networking", () => {
  it.skipIf(!online)(
    "downloads a file with curl",
    async () => {
      const result = await run(
        `curl -sS -w '%{http_code}' -o work/ping.json ${REACHABLE_URL}`,
      );

      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200");
      expect(result.exitCode).toBe(0);
    },
    30_000,
  );
});

describe("bash sandbox networking on this computer", () => {
  // Two loopback servers: one standing in for a service the agent started or
  // one on the user's network, the other for the workspace server, whose port
  // is the one the shell's fetch refuses.
  let service: http.Server;
  let serviceUrl: string;
  let workspaceServer: http.Server;
  let workspaceServerHits: number;
  let originalPort: number;

  beforeAll(async () => {
    workspaceServerHits = 0;
    workspaceServer = await listen((_req, res) => {
      workspaceServerHits++;
      res.end("workspace server");
    });
    const workspacePort = portOf(workspaceServer);
    service = await listen((req, res) => {
      if (req.url === "/to-workspace-server") {
        res.writeHead(302, {
          Location: `http://127.0.0.1:${workspacePort}/_instrument/cdp`,
        });
        res.end();
        return;
      }
      res.end("pool temperature 28C");
    });
    serviceUrl = `http://127.0.0.1:${portOf(service)}`;
    originalPort = getWorkspaceServerPort();
    setWorkspaceServerPort(workspacePort);
  });

  afterAll(async () => {
    setWorkspaceServerPort(originalPort);
    await Promise.all([close(service), close(workspaceServer)]);
  });

  it("reaches a loopback server with curl", async () => {
    const result = await run(`curl -sS ${serviceUrl}/`);

    expect(result.stdout).toBe("pool temperature 28C");
    expect(result.exitCode).toBe(0);
  });

  it("reaches a loopback server with js-exec's fetch", async () => {
    const result = await run(
      `js-exec -c 'const r = await fetch("${serviceUrl}/"); console.log(await r.text())'`,
    );

    expect(result.stdout.trim()).toBe("pool temperature 28C");
    expect(result.exitCode).toBe(0);
  });

  it("refuses the workspace server's port", async () => {
    const port = portOf(workspaceServer);
    const result = await run(`curl -sS http://localhost:${port}/`);

    expect(result.stderr).toContain("workspace server");
    expect(result.exitCode).toBe(7);
    expect(workspaceServerHits).toBe(0);
  });

  it("refuses a redirect into the workspace server", async () => {
    const result = await run(`curl -sSL ${serviceUrl}/to-workspace-server`);

    expect(result.stderr).toContain("workspace server");
    expect(result.exitCode).toBe(7);
    expect(workspaceServerHits).toBe(0);
  });
});

async function listen(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function portOf(server: http.Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  return address.port;
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
