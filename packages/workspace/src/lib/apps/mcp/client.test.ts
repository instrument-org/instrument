import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isExpectedNetworkError } from "@instrument-org/shared";
import { z } from "zod";

import { getWorkspaceServerPort } from "../../../logic/server/url";
import { callMcpTool, listMcpTools, withMcpClient } from "./client";

// Only the workspace-server case below reaches a resolver -- every other case
// here is on a port the guard answers without a lookup -- but it is mocked so
// the suite never depends on the network.
vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn() },
}));
const { default: dns } = await import("node:dns/promises");

let server: http.Server;
let baseUrl: string;
let requiredToken: null | string;

// Stand up a real MCP server over Streamable HTTP so the client wrapper is
// exercised end to end (initialize handshake, tools/list, tools/call), plus a
// bearer-token gate to prove auth headers are sent.
beforeEach(async () => {
  requiredToken = "good-token";

  server = http.createServer((req, res) => {
    void (async () => {
      if (
        requiredToken !== null &&
        req.headers.authorization !== `Bearer ${requiredToken}`
      ) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const mcp = new McpServer({ name: "mock", version: "1.0.0" });
      mcp.registerTool(
        "echo",
        {
          description: "Echo the message back",
          inputSchema: { message: z.string() },
        },
        ({ message }) => ({
          content: [{ text: `echo: ${message}`, type: "text" }],
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
});

describe("withMcpClient", () => {
  it("connects, lists tools, and calls a tool with token auth", async () => {
    const result = await withMcpClient({
      config: { auth: { kind: "bearer", value: "good-token" }, url: baseUrl },
      run: async (client) => {
        const tools = await listMcpTools(client);
        const call = await callMcpTool(client, {
          args: { message: "hi" },
          name: "echo",
        });
        return { call, tools };
      },
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.tools.map((t) => t.name)).toContain("echo");
    expect(value.call.text).toBe("echo: hi");
    expect(value.call.isError).toBe(false);
  });

  it("reports unauthorized when the token is wrong", async () => {
    const result = await withMcpClient({
      config: { auth: { kind: "bearer", value: "bad-token" }, url: baseUrl },
      run: (client) => listMcpTools(client),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().reason).toBe("unauthorized");
  });

  // A desktop app's local server while the app is closed: the cause is kept
  // so the caller can treat it as the network failure it is, not a fault.
  it("keeps the network failure as the cause when nothing is listening", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => {
      closed.listen(0, "127.0.0.1", resolve);
    });
    const address = closed.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise((resolve) => closed.close(resolve));

    const result = await withMcpClient({
      config: { auth: { kind: "none" }, url: `http://127.0.0.1:${port}/mcp` },
      run: (client) => listMcpTools(client),
    });

    const error = result._unsafeUnwrapErr();
    expect(error.reason).toBe("connect");
    expect(isExpectedNetworkError(error.cause)).toBe(true);
  });

  it("rejects non-https, non-loopback URLs before connecting", async () => {
    const result = await withMcpClient({
      config: { auth: { kind: "none" }, url: "http://example.com/mcp" },
      run: (client) => listMcpTools(client),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().reason).toBe("connect");
  });

  // The agent writes the manifest, so an mcp app must not be the softer
  // way to reach the workspace server than an api one.
  it("rejects an https URL whose hostname resolves to the workspace server", async () => {
    // @ts-expect-error -- the `all: true` overload is one of several on lookup.
    vi.mocked(dns.lookup).mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ]);

    const result = await withMcpClient({
      config: {
        auth: { kind: "none" },
        url: `https://loopback.example:${getWorkspaceServerPort()}/mcp`,
      },
      run: (client) => listMcpTools(client),
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.reason).toBe("connect");
    expect(error.message).toContain("workspace server");
  });
});
