import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ApiConnectorManifest } from "../lib/connectors/manifest";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { AbsolutePathSchema, RelativePathSchema } from "../schemas/paths";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { ConnectorRequest } from "./connector-request";
import { ConnectorTest } from "./connector-test";

const model = createMockAIGatewayModel();

let tmpDir: string;
let dir: string;
let connectorsDir: string;
let server: http.Server;
let baseUrl: string;
let lastAuthHeader: null | string;
let lastVersionHeader: null | string;
let credentials: Record<string, string>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "connector-request-test-"));
  dir = path.join(tmpDir, "app");
  connectorsDir = path.join(tmpDir, "connectors");
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(connectorsDir, { recursive: true });
  credentials = { testapi: "good-token" };

  lastAuthHeader = null;
  lastVersionHeader = null;
  server = http.createServer((req, res) => {
    lastAuthHeader = req.headers.authorization ?? null;
    lastVersionHeader = req.headers["x-api-version"]?.toString() ?? null;
    if (req.headers.authorization !== "Bearer good-token") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.url?.startsWith("/me") === true) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, user: "jeremy" }));
      return;
    }
    if (req.url?.startsWith("/echo-secret") === true) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "good-token" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  await fs.rm(tmpDir, { force: true, recursive: true });
});

function baseExecuteArgs() {
  const taskId = createMockTaskConfigForDir(dir, { model });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    connectors: {
      getCredential: (slug) => Promise.resolve(credentials[slug] ?? null),
    },
    connectorsDir: AbsolutePathSchema.parse(connectorsDir),
  });
  return {
    agentName: "main" as const,
    model,
    signal: AbortSignal.timeout(10_000),
    spawnAgent: vi.fn(),
    taskId,
    taskState: {},
  };
}

async function requestPastGuideGate(
  args: ReturnType<typeof baseExecuteArgs>,
  input: { method?: "GET" | "POST"; path: string; slug: string },
) {
  // First call returns the guide; the repeat performs the request.
  const first = await runTool(ConnectorRequest, {
    ...args,
    input: {
      method: input.method ?? "GET",
      path: input.path,
      slug: input.slug,
    },
  });
  expect(first._unsafeUnwrap().state).toBe("guide");
  return runTool(ConnectorRequest, {
    ...args,
    input: {
      method: input.method ?? "GET",
      path: input.path,
      slug: input.slug,
    },
  });
}

async function writeConnector({
  enabled = true,
  guide = "# Test API\n\nGET /me returns the current user.",
  manifest = {},
  slug = "testapi",
}: {
  enabled?: boolean;
  guide?: string;
  manifest?: Partial<ApiConnectorManifest>;
  slug?: string;
} = {}) {
  const connectorDir = path.join(connectorsDir, slug);
  await fs.mkdir(connectorDir, { recursive: true });
  const full: ApiConnectorManifest = {
    auth: { kind: "bearer" },
    baseUrl,
    displayName: "Test API",
    enabled,
    test: { path: "/me" },
    type: "api",
    ...manifest,
  };
  await fs.writeFile(
    path.join(connectorDir, "connector.json"),
    JSON.stringify(full, null, 2),
  );
  await fs.writeFile(path.join(connectorDir, "guide.md"), guide);
  return slug;
}

describe("connector_request", () => {
  it("gates the first call on the guide, then injects auth and succeeds", async () => {
    const slug = await writeConnector();
    const args = baseExecuteArgs();

    const result = await requestPastGuideGate(args, { path: "/me", slug });
    const output = result._unsafeUnwrap();
    expect(output.state).toBe("success");
    if (output.state !== "success") {
      throw new Error("expected success");
    }
    expect(output.status).toBe(200);
    expect(output.bodyText).toContain("jeremy");
    expect(lastAuthHeader).toBe("Bearer good-token");
  });

  it("sends static manifest headers with every request", async () => {
    const slug = await writeConnector({
      manifest: { headers: { "X-Api-Version": "2022-06-28" } },
    });
    const args = baseExecuteArgs();

    const result = await requestPastGuideGate(args, { path: "/me", slug });
    expect(result._unsafeUnwrap().state).toBe("success");
    expect(lastVersionHeader).toBe("2022-06-28");
  });

  it("redacts the credential from response bodies", async () => {
    const slug = await writeConnector();
    const args = baseExecuteArgs();

    const result = await requestPastGuideGate(args, {
      path: "/echo-secret",
      slug,
    });
    const output = result._unsafeUnwrap();
    if (output.state !== "success") {
      throw new Error("expected success");
    }
    expect(output.bodyText).not.toContain("good-token");
    expect(output.bodyText).toContain("[REDACTED]");
  });

  it("refuses disabled connectors", async () => {
    const slug = await writeConnector({ enabled: false });
    const args = baseExecuteArgs();

    const result = await runTool(ConnectorRequest, {
      ...args,
      input: { method: "GET" as const, path: "/me", slug },
    });
    const output = result._unsafeUnwrap();
    expect(output.state).toBe("failure");
    if (output.state !== "failure") {
      throw new Error("expected failure");
    }
    expect(output.message).toContain("disabled");
  });

  it("fails cleanly when no credential is stored", async () => {
    const slug = await writeConnector();
    credentials = {};
    const args = baseExecuteArgs();

    const result = await requestPastGuideGate(args, { path: "/me", slug });
    const output = result._unsafeUnwrap();
    expect(output.state).toBe("failure");
    if (output.state !== "failure") {
      throw new Error("expected failure");
    }
    expect(output.message).toContain("connector_credential_prompt");
  });

  it("refuses unknown connectors with a helpful error", async () => {
    const args = baseExecuteArgs();
    const result = await runTool(ConnectorRequest, {
      ...args,
      input: { method: "GET" as const, path: "/me", slug: "nope" },
    });
    expect(result._unsafeUnwrap().state).toBe("failure");
  });
});

describe("connector_request model output", () => {
  it("describes display-only spills as complete saved bodies", () => {
    const result = ConnectorRequest.toModelOutput({
      input: { method: "GET", path: "/items", slug: "testapi" },
      output: {
        bodyText: "x".repeat(60_000),
        contentType: "application/json",
        method: "GET",
        responseTruncated: false,
        slug: "testapi",
        spillFilePath: RelativePathSchema.parse(
          ".instrument/tool-output/part-123.txt",
        ),
        state: "success",
        status: 200,
        url: "https://api.example.test/items",
      },
      toolCallId: "part-123",
    });

    const value = (result as { value: string }).value;
    expect(value).toContain("Complete body saved to:");
    expect(value).not.toContain("Partial capped body saved to:");
  });

  it("describes capped response spills as partial saved bodies", () => {
    const result = ConnectorRequest.toModelOutput({
      input: { method: "GET", path: "/items", slug: "testapi" },
      output: {
        bodyText: "x".repeat(60_000),
        contentType: "application/json",
        method: "GET",
        responseTruncated: true,
        slug: "testapi",
        spillFilePath: RelativePathSchema.parse(
          ".instrument/tool-output/part-123.txt",
        ),
        state: "success",
        status: 200,
        url: "https://api.example.test/items",
      },
      toolCallId: "part-123",
    });

    const value = (result as { value: string }).value;
    expect(value).toContain("Partial capped body saved to:");
    expect(value).toContain("request less data, paginate");
    expect(value).not.toContain("Complete body saved to:");
  });
});

describe("vertical slice: test-then-use", () => {
  it("connector_test enables a green connector and connector_request uses it", async () => {
    const slug = await writeConnector({ enabled: false });
    const args = baseExecuteArgs();

    const testResult = await runTool(ConnectorTest, {
      ...args,
      input: { slug },
    });
    const report = testResult._unsafeUnwrap();
    expect(report.passed).toBe(true);
    expect(report.enabled).toBe(true);

    // The manifest on disk was flipped to enabled.
    const manifestRaw = await fs.readFile(
      path.join(connectorsDir, slug, "connector.json"),
      "utf8",
    );
    expect(JSON.parse(manifestRaw)).toMatchObject({ enabled: true });

    const result = await requestPastGuideGate(args, { path: "/me", slug });
    const output = result._unsafeUnwrap();
    expect(output.state).toBe("success");
  });

  it("connector_test reports failures without enabling", async () => {
    const slug = await writeConnector({ enabled: false });
    credentials = { testapi: "bad-token" };
    const args = baseExecuteArgs();

    const testResult = await runTool(ConnectorTest, {
      ...args,
      input: { slug },
    });
    const report = testResult._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.enabled).toBe(false);

    const manifestRaw = await fs.readFile(
      path.join(connectorsDir, slug, "connector.json"),
      "utf8",
    );
    expect(JSON.parse(manifestRaw)).toMatchObject({ enabled: false });
  });
});
