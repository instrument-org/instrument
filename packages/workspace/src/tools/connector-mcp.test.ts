import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type McpConnectorManifest } from "../lib/connectors/manifest";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { AbsolutePathSchema } from "../schemas/paths";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { ConnectorMcp } from "./connector-mcp";

const model = createMockAIGatewayModel();

let tmpDir: string;
let dir: string;
let connectorsDir: string;
let server: http.Server;
let baseUrl: string;
let credentials: Record<string, string>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "connector-mcp-tool-"));
  dir = path.join(tmpDir, "app");
  connectorsDir = path.join(tmpDir, "connectors");
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(connectorsDir, { recursive: true });
  credentials = { linear: "good-token" };

  server = http.createServer((req, res) => {
    void (async () => {
      if (req.headers.authorization !== "Bearer good-token") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const mcp = new McpServer({ name: "mock", version: "1.0.0" });
      mcp.registerTool(
        "list_issues",
        {
          description: "List issues",
          inputSchema: { assignee: z.string().optional() },
        },
        ({ assignee }) => ({
          content: [
            { text: `issues for ${assignee ?? "everyone"}`, type: "text" },
          ],
        }),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body: unknown =
        chunks.length > 0
          ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
          : undefined;
      await transport.handleRequest(req, res, body);
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}/mcp`;
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
    signal: AbortSignal.timeout(15_000),
    spawnAgent: vi.fn(),
    taskId,
    taskState: {},
  };
}

async function pastGuide(
  args: ReturnType<typeof baseExecuteArgs>,
  input: {
    action: "call_tool" | "list_tools";
    args?: Record<string, unknown>;
    slug: string;
    tool?: string;
  },
) {
  const first = await runTool(ConnectorMcp, { ...args, input });
  expect(first._unsafeUnwrap().state).toBe("guide");
  return runTool(ConnectorMcp, { ...args, input });
}

async function writeMcpConnector() {
  const connectorDir = path.join(connectorsDir, "linear");
  await fs.mkdir(connectorDir, { recursive: true });
  const manifest: McpConnectorManifest = {
    auth: { kind: "bearer" },
    displayName: "Linear",
    enabled: true,
    type: "mcp",
    url: baseUrl,
  };
  await fs.writeFile(
    path.join(connectorDir, "connector.json"),
    JSON.stringify(manifest, null, 2),
  );
  await fs.writeFile(
    path.join(connectorDir, "guide.md"),
    "# Linear\n\nUse list_issues.",
  );
}

describe("connector_mcp", () => {
  it("gates on the guide, then lists tools over MCP with token auth", async () => {
    await writeMcpConnector();
    const args = baseExecuteArgs();

    const result = await pastGuide(args, {
      action: "list_tools",
      slug: "linear",
    });
    const output = result._unsafeUnwrap();
    expect(output.state).toBe("tools");
    if (output.state !== "tools") {
      throw new Error("expected tools");
    }
    expect(output.tools.map((t) => t.name)).toContain("list_issues");
  });

  it("calls a tool and returns its (untrusted-wrapped) result", async () => {
    await writeMcpConnector();
    const args = baseExecuteArgs();

    const result = await pastGuide(args, {
      action: "call_tool",
      args: { assignee: "me" },
      slug: "linear",
      tool: "list_issues",
    });
    const output = result._unsafeUnwrap();
    expect(output.state).toBe("result");
    if (output.state !== "result") {
      throw new Error("expected result");
    }
    expect(output.text).toContain("issues for me");

    const modelOut = ConnectorMcp.toModelOutput({
      input: { action: "call_tool", slug: "linear", tool: "list_issues" },
      output,
      toolCallId: "p1",
    });
    expect((modelOut as { value: string }).value).toContain(
      "[UNTRUSTED CONTENT BEGIN]",
    );
  });

  it("fails cleanly when the credential is wrong", async () => {
    await writeMcpConnector();
    credentials = { linear: "bad-token" };
    const args = baseExecuteArgs();

    const result = await pastGuide(args, {
      action: "list_tools",
      slug: "linear",
    });
    expect(result._unsafeUnwrap().state).toBe("failure");
  });

  it("refuses an API connector", async () => {
    const apiDir = path.join(connectorsDir, "notion");
    await fs.mkdir(apiDir, { recursive: true });
    await fs.writeFile(
      path.join(apiDir, "connector.json"),
      JSON.stringify({
        auth: { kind: "bearer" },
        baseUrl: "https://api.notion.com/v1",
        displayName: "Notion",
        enabled: true,
        test: { path: "/users/me" },
        type: "api",
      }),
    );
    await fs.writeFile(path.join(apiDir, "guide.md"), "# Notion");
    const args = baseExecuteArgs();

    const result = await runTool(ConnectorMcp, {
      ...args,
      input: { action: "list_tools", slug: "notion" },
    });
    const output = result._unsafeUnwrap();
    expect(output.state).toBe("failure");
    if (output.state !== "failure") {
      throw new Error("expected failure");
    }
    expect(output.message).toContain("connector_request");
  });
});
