import { APP_NAME } from "@instrument-org/shared";
import {
  type OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  InvalidGrantError,
  InvalidTokenError,
  OAuthError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { type Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type ContentBlock,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";
import { isPlainObject, noop } from "radashi";

import { checkAppUrl } from "../safe-url";
import { fetchForMcp } from "./fetch";
import { type LocalServerLaunch } from "./local-server";

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
  /** What the connection threw, when it threw, so a caller can tell a server that is not there from a fault. */
  cause?: unknown;
  message: string;
  /**
   * `unauthorized`: the key or sign-in was refused, and a new one may fix it.
   * `forbidden`: the server refused anyway (HTTP 403), which a new sign-in
   * does not change.
   */
  reason: "connect" | "forbidden" | "protocol" | "unapproved" | "unauthorized";
}

interface McpCallResult {
  isError: boolean;
  /** The tool's `structuredContent`, where the server sent one: the result as data rather than prose. */
  structured?: object;
  text: string;
}

interface McpToolSummary {
  /** The server's own hints: whether the tool only reads, or can destroy. */
  annotations?: {
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
    title?: string;
  };
  description: string;
  inputSchema: unknown;
  name: string;
  outputSchema?: unknown;
}

/**
 * Call one MCP tool and flatten its content to text for the agent, keeping
 * its structured result beside the text where the server sent one.
 */
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
  const structured = isPlainObject(result.structuredContent)
    ? result.structuredContent
    : undefined;
  return {
    isError: result.isError === true,
    structured,
    // A server should send the text form too, but one that sends only the
    // data still has said something.
    text:
      text === "" && structured ? JSON.stringify(structured, null, 2) : text,
  };
}

/** List the tools an MCP server exposes (name, description, input schema). */
export async function listMcpTools(client: Client): Promise<McpToolSummary[]> {
  const result = await client.listTools();
  return result.tools.map((tool) => ({
    annotations: tool.annotations,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    name: tool.name,
    outputSchema: tool.outputSchema,
  }));
}

/**
 * The same, for a server that runs on this machine: spawn it, speak MCP over
 * its stdio, and end the process when the operation does. The launch comes
 * from `prepareLocalServer`, which is what decides that a package may run at
 * all; nothing here reads the manifest.
 *
 * A server that dies on startup says why on stderr (a missing app, an
 * unsupported OS), so that is captured and carried into the error rather than
 * left as an unexplained closed pipe.
 */
export async function withLocalMcpClient<T>({
  launch,
  run,
}: {
  launch: LocalServerLaunch;
  run: (client: Client) => Promise<T>;
}): Promise<Result<T, McpConnectionError>> {
  const transport = new StdioClientTransport({
    args: launch.args,
    command: launch.command,
    env: launch.env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-800);
  });
  return runWithTransport(transport, run, () => stderr.trim());
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
  // When present (OAuth apps), the SDK reads/refreshes tokens through the
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
  // Same guard the api path runs, so a manifest cannot send a credential over
  // plain http by choosing the mcp type.
  const unsafe = await checkAppUrl(url);
  if (unsafe !== null) {
    return err({ message: unsafe, reason: "connect" });
  }

  return runWithTransport(
    new StreamableHTTPClientTransport(url, {
      authProvider,
      fetch: fetchForMcp,
      requestInit: {
        headers: authProvider ? {} : authHeaders(config.auth),
        signal,
      },
    }),
    run,
  );
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

/**
 * Connect a client over the given transport, run one operation, and always
 * close. Never throws: connection and protocol failures come back as a typed
 * Result. Connections are made per-operation for simplicity and isolation; a
 * pooled variant can layer on if call latency warrants it.
 */
async function runWithTransport<T>(
  transport: Transport,
  run: (client: Client) => Promise<T>,
  detail?: () => string,
): Promise<Result<T, McpConnectionError>> {
  const client = new Client({ name: APP_NAME, version: "1.0.0" });

  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(noop);
    return err(connectionError(error, "connect", detail?.()));
  }

  try {
    const value = await run(client);
    return ok(value);
  } catch (error) {
    return err(connectionError(error, "protocol", detail?.()));
  } finally {
    await client.close().catch(noop);
  }
}

/**
 * What the SDK threw, as the agent should read it: the HTTP status, the OAuth
 * error code, or the JSON-RPC error's data beside the message, since the SDK
 * keeps those out of `message` and a badly written server is only debuggable
 * from what it actually said.
 */
export function describeMcpFailure(error: unknown): string {
  if (error instanceof StreamableHTTPError) {
    // -1 is the SDK's own code for a response it could not read (an
    // unexpected content type), not a status.
    return error.code === undefined || error.code < 0
      ? error.message
      : `HTTP ${error.code}: ${error.message}`;
  }
  if (error instanceof OAuthError) {
    // `message` is only the server's `error_description`, which may be empty.
    return error.message === ""
      ? `OAuth ${error.errorCode}`
      : `OAuth ${error.errorCode}: ${error.message}`;
  }
  if (error instanceof McpError && error.data !== undefined) {
    return `${error.message} ${JSON.stringify(error.data).slice(0, 800)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether the server refused who is asking, from the SDK's own error types.
 * The token endpoint's `invalid_grant` (a refresh token revoked or expired)
 * reaches here only after the SDK has cleared the tokens and retried, so a new
 * sign-in is what fixes it. `invalid_client` and `unauthorized_client` reach
 * here only after the SDK has cleared the client registration and retried as
 * well: the server refuses this client outright, a new sign-in would meet the
 * same refusal, so they stay plain failures with their code shown.
 */
function authFailure(error: unknown): "forbidden" | "unauthorized" | undefined {
  if (
    error instanceof UnauthorizedError ||
    error instanceof InvalidGrantError ||
    error instanceof InvalidTokenError
  ) {
    return "unauthorized";
  }
  if (error instanceof StreamableHTTPError) {
    if (error.code === 401) {
      return "unauthorized";
    }
    if (error.code === 403) {
      return "forbidden";
    }
  }
  return undefined;
}

/**
 * Whether the server refused Instrument's sign-in client itself
 * (`invalid_client`, `unauthorized_client`), which a new sign-in meets again:
 * the SDK has already cleared the registration and retried by the time one
 * reaches here.
 */
export function clientRefused(error: unknown): boolean {
  return (
    error instanceof OAuthError &&
    (error.errorCode === "invalid_client" ||
      error.errorCode === "unauthorized_client")
  );
}

function connectionError(
  error: unknown,
  phase: "connect" | "protocol",
  said: string | undefined,
): McpConnectionError {
  const reason = authFailure(error) ?? phase;
  const lead = {
    connect: "Could not connect to the MCP server: ",
    forbidden: "The MCP server refused access (forbidden): ",
    protocol: "",
    unauthorized: "The MCP server rejected the credential (unauthorized): ",
  }[reason];
  return {
    cause: error,
    message: `${lead}${describeMcpFailure(error)}${said ? `\n${said}` : ""}`,
    reason,
  };
}
