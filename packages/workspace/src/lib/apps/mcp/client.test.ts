import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isExpectedNetworkError } from "@instrument-org/shared";
import {
  InvalidGrantError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isPlainObject } from "radashi";
import { z } from "zod";

import {
  callMcpTool,
  describeMcpFailure,
  listMcpTools,
  withLocalMcpClient,
  withMcpClient,
} from "./client";

let server: http.Server;
let baseUrl: string;
let requiredToken: null | string;
/** A response sent in place of the server's, to every request or to one method's. */
let refusal: { body: string; method?: string; status: number } | undefined;

// Stand up a real MCP server over Streamable HTTP so the client wrapper is
// exercised end to end (initialize handshake, tools/list, tools/call), plus a
// bearer-token gate to prove auth headers are sent.
beforeEach(async () => {
  requiredToken = "good-token";
  refusal = undefined;

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

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body: unknown =
        chunks.length > 0
          ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
          : undefined;

      const method =
        isPlainObject(body) && "method" in body ? body.method : undefined;
      if (
        refusal &&
        (refusal.method === undefined || refusal.method === method)
      ) {
        res.writeHead(refusal.status, { "content-type": "text/plain" });
        res.end(refusal.body);
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

    const { message, reason } = result._unsafeUnwrapErr();
    expect({ message, reason }).toMatchInlineSnapshot(`
      {
        "message": "The MCP server rejected the credential (unauthorized): HTTP 401: Streamable HTTP error: Error POSTing to endpoint: {"error":"unauthorized"}",
        "reason": "unauthorized",
      }
    `);
  });

  // A missing permission: signing in again would change nothing.
  it("reports forbidden, with what the server said, on a 403", async () => {
    refusal = { body: "This workspace has no API access.", status: 403 };
    const result = await withMcpClient({
      config: { auth: { kind: "bearer", value: "good-token" }, url: baseUrl },
      run: (client) => listMcpTools(client),
    });

    const { message, reason } = result._unsafeUnwrapErr();
    expect({ message, reason }).toMatchInlineSnapshot(`
      {
        "message": "The MCP server refused access (forbidden): HTTP 403: Streamable HTTP error: Error POSTing to endpoint: This workspace has no API access.",
        "reason": "forbidden",
      }
    `);
  });

  // A body that mentions a 401, a port or an "unauthorized" page is still the
  // server's 500, and the agent reads it whole.
  it("keeps a failure whose body mentions 401 a plain failure", async () => {
    refusal = {
      body: "<h1>Unauthorized proxy on :4012</h1> upstream 401 retried",
      status: 502,
    };
    const result = await withMcpClient({
      config: { auth: { kind: "bearer", value: "good-token" }, url: baseUrl },
      run: (client) => listMcpTools(client),
    });

    const { message, reason } = result._unsafeUnwrapErr();
    expect({ message, reason }).toMatchInlineSnapshot(`
      {
        "message": "Could not connect to the MCP server: HTTP 502: Streamable HTTP error: Error POSTing to endpoint: <h1>Unauthorized proxy on :4012</h1> upstream 401 retried",
        "reason": "connect",
      }
    `);
  });

  it("classifies a refusal after the connect the same way", async () => {
    refusal = { body: "token expired", method: "tools/list", status: 401 };
    const result = await withMcpClient({
      config: { auth: { kind: "bearer", value: "good-token" }, url: baseUrl },
      run: (client) => listMcpTools(client),
    });

    const { message, reason } = result._unsafeUnwrapErr();
    expect({ message, reason }).toMatchInlineSnapshot(`
      {
        "message": "The MCP server rejected the credential (unauthorized): HTTP 401: Streamable HTTP error: Error POSTing to endpoint: token expired",
        "reason": "unauthorized",
      }
    `);
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
});

describe("withLocalMcpClient", () => {
  it("carries what a server that dies on startup wrote to stderr", async () => {
    const result = await withLocalMcpClient({
      launch: {
        args: [
          "-e",
          "console.error('needs the desktop app running'); process.exit(1)",
        ],
        command: process.execPath,
        env: {},
      },
      run: (client) => listMcpTools(client),
    });

    const { message, reason } = result._unsafeUnwrapErr();
    expect(reason).toBe("connect");
    expect(message).toMatch(/needs the desktop app running$/);
  });
});

describe("describeMcpFailure", () => {
  it("puts the status, OAuth code and error data beside the message", () => {
    const described = {
      http: new StreamableHTTPError(500, "Error POSTing to endpoint: boom"),
      jsonRpc: new McpError(-32_602, "Invalid params", { field: "q" }),
      oauth: new ServerError("HTTP 403: Raw body: nope"),
      oauthNoDescription: new InvalidGrantError(""),
      string: "plain words",
      unreadable: new StreamableHTTPError(
        -1,
        "Unexpected content type: text/html",
      ),
    };
    expect(
      Object.fromEntries(
        Object.entries(described).map(([key, error]) => [
          key,
          describeMcpFailure(error),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "http": "HTTP 500: Streamable HTTP error: Error POSTing to endpoint: boom",
        "jsonRpc": "MCP error -32602: Invalid params {"field":"q"}",
        "oauth": "OAuth server_error: HTTP 403: Raw body: nope",
        "oauthNoDescription": "OAuth invalid_grant",
        "string": "plain words",
        "unreadable": "Streamable HTTP error: Unexpected content type: text/html",
      }
    `);
  });
});
