import { APP_NAME } from "@instrument-org/shared";
import {
  type OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";
import { noop } from "radashi";

import { isLoopbackHost } from "../manifest";
import { checkPublicUrl } from "../safe-url";

/**
 * How to reach and authenticate to an MCP server. Token auth injects a static
 * header (the credential from the app's store); "none" is for open servers.
 * OAuth is a later addition -- the transport already accepts an authProvider,
 * so it slots in here without changing callers.
 */
export interface McpConnectionConfig {
  auth:
    | { header: string; kind: "header"; value: string }
    | { kind: "bearer"; value: string }
    | { kind: "none" };
  url: string;
}

export interface McpConnectionError {
  message: string;
  reason: "connect" | "protocol" | "unauthorized";
}

interface McpCallResult {
  isError: boolean;
  text: string;
}

interface McpToolSummary {
  description: string;
  inputSchema: unknown;
  name: string;
}

/** Call one MCP tool and flatten its content to text for the agent. */
export async function callMcpTool(
  client: Client,
  { args, name }: { args: Record<string, unknown>; name: string },
): Promise<McpCallResult> {
  const result = await client.callTool({ arguments: args, name });
  const content: ContentBlock[] = Array.isArray(result.content)
    ? (result.content as ContentBlock[])
    : [];
  const text = content
    .map((item) =>
      item.type === "text" ? item.text : `[${item.type} content]`,
    )
    .join("\n");
  return { isError: result.isError === true, text };
}

/** List the tools an MCP server exposes (name, description, input schema). */
export async function listMcpTools(client: Client): Promise<McpToolSummary[]> {
  const result = await client.listTools();
  return result.tools.map((tool) => ({
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    name: tool.name,
  }));
}

/**
 * Open a connected MCP client over Streamable HTTP with the given auth, run an
 * operation, and always close the transport afterward. Connections are made
 * per-operation for simplicity and isolation; a pooled variant can layer on if
 * call latency warrants it. Never throws -- connection and protocol failures
 * come back as a typed Result.
 */
export async function withMcpClient<T>({
  authProvider,
  config,
  run,
  signal,
}: {
  // When present (OAuth connectors), the SDK reads/refreshes tokens through the
  // provider and injects the Authorization header itself; config.auth is
  // ignored. On a missing/expired token with no interactive follow-up the
  // connect throws UnauthorizedError, surfaced here as `unauthorized`.
  authProvider?: OAuthClientProvider;
  config: McpConnectionConfig;
  run: (client: Client) => Promise<T>;
  signal?: AbortSignal;
}): Promise<Result<T, McpConnectionError>> {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    return err({
      message: `Invalid MCP server URL: ${config.url}`,
      reason: "connect",
    });
  }
  // Same guard the api path runs, so a manifest cannot reach a private address
  // by choosing the mcp type: the agent picks this hostname too.
  const unsafe = await checkPublicUrl(url, {
    allowLoopback: isLoopbackHost(url.hostname),
  });
  if (unsafe !== null) {
    return err({ message: unsafe, reason: "connect" });
  }

  const transport = new StreamableHTTPClientTransport(url, {
    authProvider,
    requestInit: {
      headers: authProvider ? {} : authHeaders(config.auth),
      signal,
    },
  });
  const client = new Client({ name: APP_NAME, version: "1.0.0" });

  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(noop);
    const message = error instanceof Error ? error.message : String(error);
    // cspell:ignore unauthor
    const unauthorized =
      error instanceof UnauthorizedError || /401|unauthor/i.test(message);
    return err({
      message: unauthorized
        ? `The MCP server rejected the credential (unauthorized): ${message}`
        : `Could not connect to the MCP server: ${message}`,
      reason: unauthorized ? "unauthorized" : "connect",
    });
  }

  try {
    const value = await run(client);
    return ok(value);
  } catch (error) {
    return err({
      message: error instanceof Error ? error.message : String(error),
      reason: "protocol",
    });
  } finally {
    await client.close().catch(noop);
  }
}

function authHeaders(
  auth: McpConnectionConfig["auth"],
): Record<string, string> {
  switch (auth.kind) {
    case "bearer": {
      return { Authorization: `Bearer ${auth.value}` };
    }
    case "header": {
      return { [auth.header]: auth.value };
    }
    case "none": {
      return {};
    }
  }
}
