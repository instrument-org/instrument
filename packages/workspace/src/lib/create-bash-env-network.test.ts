import dns from "node:dns/promises";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";

// Only a real request through a real shell proves the network config handed
// to just-bash holds: the internet, loopback, and redirects across origins.
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
  // Two loopback servers, each a different origin: one standing in for a
  // service the agent started or one on the user's network, the other for
  // the host a redirect from it lands on.
  let service: http.Server;
  let serviceUrl: string;
  let elsewhere: http.Server;
  let elsewhereAuthorization: string | undefined;

  beforeAll(async () => {
    elsewhere = await listen((req, res) => {
      elsewhereAuthorization = req.headers.authorization;
      res.end("elsewhere");
    });
    const elsewherePort = portOf(elsewhere);
    service = await listen((req, res) => {
      if (req.url === "/to-elsewhere") {
        res.writeHead(302, { Location: `http://127.0.0.1:${elsewherePort}/` });
        res.end();
        return;
      }
      res.end("pool temperature 28C");
    });
    serviceUrl = `http://127.0.0.1:${portOf(service)}`;
  });

  afterAll(async () => {
    await Promise.all([close(service), close(elsewhere)]);
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

  it("drops the Authorization header on a redirect to another origin", async () => {
    elsewhereAuthorization = "unset";
    const result = await run(
      `curl -sSL -H 'Authorization: Bearer secret' ${serviceUrl}/to-elsewhere`,
    );

    expect(result.stdout).toBe("elsewhere");
    expect(elsewhereAuthorization).toBeUndefined();
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
