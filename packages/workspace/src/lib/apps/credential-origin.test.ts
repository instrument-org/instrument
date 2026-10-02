import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createAppCommand } from "../shell-commands/app";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { readConnection, recordConnection } from "./connection";
import { createMemoryAppsConfig } from "./memory-config";
import { withAppMcpClient } from "./mcp/run";
import { loadApp } from "./store";

const taskId = TaskIdSchema.parse("credential-origin-task");
const KEY = "sk-the-users-own-key";
const apps = getWorkspaceConfig().apps;

/** A loopback service that answers 200 and keeps each Authorization it was sent. */
interface Service {
  close: () => Promise<void>;
  origin: string;
  seen: (string | undefined)[];
}

async function service(): Promise<Service> {
  const seen: (string | undefined)[] = [];
  const server: Server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo; // Listening on TCP.
  return {
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
    origin: `http://127.0.0.1:${port}`,
    seen,
  };
}

async function app(stdin: string | undefined, ...args: string[]) {
  return createAppCommand({ taskId }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: stdin === undefined ? EMPTY_BYTES : encodeUtf8ToBytes(stdin),
    }),
  );
}

/**
 * An API app at `origin`, with its guide written so the test reaches the
 * canary. Replaces the one an earlier test left in the shared apps folder.
 */
async function apiApp(slug: string, origin: string) {
  await app(
    undefined,
    "new",
    slug,
    "--name",
    "Service",
    "--api",
    origin,
    "--auth",
    "bearer",
    "--test",
    "/me",
    "--force",
  );
  await app(
    "# Service\n\nA test service.\n\n## Endpoints\n\nGET /me\n\n## Conventions\n\nNone known.\n",
    "guide",
    slug,
  );
}

let home: Service;
let elsewhere: Service;

beforeEach(async () => {
  home = await service();
  elsewhere = await service();
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    apps: createMemoryAppsConfig({ credentials: { svc: KEY } }),
  });
});

afterEach(async () => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps });
  await home.close();
  await elsewhere.close();
});

describe("a stored key and the address it was given for", () => {
  it("goes to the origin the user gave it for", async () => {
    await apiApp("svc", home.origin);
    await recordConnection("svc", {
      credentialOrigin: home.origin,
      status: "needs-key",
    });

    const result = await app(undefined, "test", "svc");

    expect(result.exitCode).toBe(0);
    expect(home.seen).toEqual([`Bearer ${KEY}`]);
    expect((await readConnection("svc"))?.status).toBe("connected");
  });

  it("is not sent after the manifest is rewritten to another origin, and the app needs a key", async () => {
    await apiApp("svc", home.origin);
    await recordConnection("svc", {
      credentialOrigin: home.origin,
      status: "needs-key",
    });
    expect((await app(undefined, "test", "svc")).exitCode).toBe(0);

    await apiApp("svc", elsewhere.origin);
    const result = await app(undefined, "test", "svc");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAIL credential:");
    expect(result.stderr).toContain(
      `was given for ${new URL(home.origin).host}`,
    );
    expect(elsewhere.seen).toEqual([]);
    expect((await readConnection("svc"))?.status).toBe("needs-key");
  });

  it("is not sent by a request either", async () => {
    await apiApp("svc", elsewhere.origin);
    await recordConnection("svc", {
      credentialOrigin: home.origin,
      // Connected on this very manifest, which only a test could have earned:
      // the request's own check is what stands in the way here.
      manifestHash: (
        await loadApp(getWorkspaceConfig().appsDir, "svc")
      )._unsafeUnwrap().manifestHash,
      status: "connected",
    });

    // The first request in a task is answered with the guide.
    await app(undefined, "request", "svc", "GET", "/me");
    const result = await app(undefined, "request", "svc", "GET", "/me");

    expect(result.exitCode).toBe(1);
    expect(elsewhere.seen).toEqual([]);
  });

  it("adopts the current origin for a record kept before origins were, while it is connected on this manifest", async () => {
    await apiApp("svc", home.origin);
    const { manifestHash } = (
      await loadApp(getWorkspaceConfig().appsDir, "svc")
    )._unsafeUnwrap();
    await recordConnection("svc", { manifestHash, status: "connected" });

    const result = await app(undefined, "test", "svc");

    expect(result.exitCode).toBe(0);
    expect(home.seen).toEqual([`Bearer ${KEY}`]);
    expect((await readConnection("svc"))?.credentialOrigin).toBe(home.origin);
  });

  it("asks again for a record kept before origins were, once the manifest changed", async () => {
    await apiApp("svc", home.origin);
    const { manifestHash } = (
      await loadApp(getWorkspaceConfig().appsDir, "svc")
    )._unsafeUnwrap();
    await recordConnection("svc", { manifestHash, status: "connected" });
    await apiApp("svc", elsewhere.origin);

    const result = await app(undefined, "test", "svc");

    expect(result.exitCode).toBe(1);
    expect(elsewhere.seen).toEqual([]);
    expect((await readConnection("svc"))?.status).toBe("needs-key");
  });
});

describe("an MCP app's stored key", () => {
  it("never reaches a server other than the one it was given for", async () => {
    const manifest = {
      auth: { kind: "bearer" as const },
      name: "Service",
      type: "mcp" as const,
      url: `${elsewhere.origin}/mcp`,
    };
    await recordConnection("svc", {
      credentialOrigin: home.origin,
      status: "connected",
    });

    const result = await withAppMcpClient({
      credential: KEY,
      manifest,
      manifestHash: "any",
      run: () => Promise.resolve(undefined),
      slug: "svc",
    });

    expect(result._unsafeUnwrapErr().reason).toBe("unauthorized");
    expect(elsewhere.seen).toEqual([]);
  });
});
