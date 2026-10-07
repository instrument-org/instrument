import { type LanguageModelV4FunctionTool } from "@ai-sdk/provider";
import {
  type EffortLevel,
  query,
  type Query,
  type SDKMessage,
  type SDKRateLimitInfo,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { type ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "node:os";

import { claudeCodeEnvironment } from "./environment";

/** The MCP server name our tools are served under, and so their prefix. */
const SERVER_NAME = "instrument";
export const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;

/** The meta key the CLI stamps each MCP call with, naming its tool_use block. */
const TOOL_USE_ID_META = "claudecode/toolUseId";

/** A session nobody has asked for in this long is closed, ending its process. */
const IDLE_MS = 30 * 60 * 1000;

/**
 * How long a session waiting on our tools is kept: long enough for a slow
 * tool, short enough that one our loop gave up on does not live forever.
 */
const AWAITING_TOOLS_MS = 3 * 60 * 60 * 1000;

export interface SessionShape {
  /**
   * Claude Code's own tools this process may run itself, such as WebSearch,
   * which runs on Anthropic's side. Every other built-in stays off.
   */
  builtInTools: string[];
  /** The CLI's config folder, holding the sign-in it uses, when not its default. */
  configDir: string | undefined;
  effort: EffortLevel | undefined;
  executablePath: string;
  modelId: string;
  systemPrompt: string;
  tools: LanguageModelV4FunctionTool[];
}

/**
 * One long-lived CLI process answering one of our agent sessions, step by
 * step. Our loop still runs every tool: a call the model makes is answered
 * over MCP only when our next request arrives carrying its result.
 */
export class ClaudePlanSession {
  /** Tool calls from the last step, waiting on our loop to run them. */
  awaitingToolCallIds: string[] = [];
  busy = false;
  readonly messages: AsyncIterator<SDKMessage, void>;
  /** The built-in tools this process runs itself, which our loop never sees. */
  readonly builtInTools: ReadonlySet<string>;
  modelId: string;
  /** The plan's usage as the CLI last reported it, which it does not repeat every turn. */
  rateLimit: SDKRateLimitInfo | undefined;
  /**
   * A fingerprint of each message of ours this process has been given, in
   * order; its own reply to the last one is what comes next.
   */
  seen: string[] = [];
  private closed = false;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly input = new Pushable<SDKUserMessage>();
  private readonly query: Query;
  private readonly results = new Map<string, Deferred<CallToolResult>>();
  private readonly stderrTail: string[] = [];

  constructor(
    readonly key: string,
    shape: SessionShape,
    private readonly onClose: () => void,
  ) {
    this.builtInTools = new Set(shape.builtInTools);
    this.modelId = shape.modelId;
    const env = claudeCodeEnvironment(shape.configDir);
    this.query = query({
      options: {
        allowedTools: [`mcp__${SERVER_NAME}`, ...shape.builtInTools],
        cwd: homedir(),
        effort: shape.effort,
        env,
        includePartialMessages: true,
        mcpServers: {
          [SERVER_NAME]: {
            instance: this.mcpServer(shape.tools),
            name: SERVER_NAME,
            type: "sdk",
          },
        },
        model: shape.modelId,
        pathToClaudeCodeExecutable: shape.executablePath,
        // The CLI writes no transcript of its own: ours is the record, and a
        // session the user never started has no place in their history.
        persistSession: false,
        settingSources: [],
        settings: { disableClaudeAiConnectors: true },
        stderr: (data) => {
          this.stderrTail.push(data);
          this.stderrTail.splice(0, this.stderrTail.length - 20);
        },
        strictMcpConfig: true,
        // A call to one of our tools by its own name, as our prompts write
        // it, reaches the same tool as its prefixed name.
        toolAliases: Object.fromEntries(
          shape.tools.map((tool) => [tool.name, `${TOOL_PREFIX}${tool.name}`]),
        ),
        systemPrompt: shape.systemPrompt,
        tools: shape.builtInTools,
      },
      prompt: this.input,
    });
    this.messages = this.query[Symbol.asyncIterator]();
    this.touch();
  }

  get stderr() {
    return this.stderrTail.join("");
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.idleTimer);
    for (const deferred of this.results.values()) {
      deferred.resolve({
        content: [{ text: "The session ended.", type: "text" }],
        isError: true,
      });
    }
    this.results.clear();
    this.input.end();
    this.query.close();
    this.onClose();
  }

  /** Answer a tool call the CLI made, whether or not its MCP call has arrived yet. */
  resolveToolCall(toolCallId: string, result: CallToolResult) {
    this.deferred(toolCallId).resolve(result);
  }

  send(content: ContentBlockParam[]) {
    this.input.push({
      message: { content, role: "user" },
      parent_tool_use_id: null,
      type: "user",
    });
  }

  /**
   * One of the CLI's control requests the SDK carries without typing, reached
   * by name. Its answer is the caller's to check.
   */
  async control(name: string, ...args: unknown[]): Promise<unknown> {
    const target: object = this.query;
    const method: unknown =
      name in target ? Reflect.get(target, name) : undefined;
    if (typeof method !== "function") {
      throw new Error(`This Claude Agent SDK has no ${name}.`);
    }
    const result: unknown = await Reflect.apply(method, target, args);
    return result;
  }

  usage() {
    return this.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
  }

  supportedModels() {
    return this.query.supportedModels();
  }

  setModel(modelId: string) {
    return this.query.setModel(modelId);
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.close(),
      this.awaitingToolCallIds.length > 0 ? AWAITING_TOOLS_MS : IDLE_MS,
    );
    this.idleTimer.unref();
  }

  private deferred(toolCallId: string) {
    let deferred = this.results.get(toolCallId);
    if (!deferred) {
      deferred = new Deferred();
      this.results.set(toolCallId, deferred);
    }
    return deferred;
  }

  private mcpServer(tools: LanguageModelV4FunctionTool[]) {
    const server = new McpServer(
      { name: SERVER_NAME, version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    // The low-level handlers, because our tools arrive as JSON Schema rather
    // than as the Zod shapes the high-level registration wants.
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: tools.map((tool) => ({
        // Always in the prompt, as with every other provider, rather than
        // deferred behind Claude Code's tool search, which we leave off.
        _meta: { "anthropic/alwaysLoad": true },
        description: tool.description,
        inputSchema: { ...tool.inputSchema, type: "object" as const },
        name: tool.name,
      })),
    }));
    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolUseId = request.params._meta?.[TOOL_USE_ID_META];
      if (typeof toolUseId !== "string") {
        return {
          content: [{ text: "The call carried no tool_use id.", type: "text" }],
          isError: true,
        };
      }
      const result = await this.deferred(toolUseId).promise;
      this.results.delete(toolUseId);
      return result;
    });
    return server;
  }
}

/**
 * What has to match for a running process to answer a request. The model is
 * left out: a process switches models in place.
 */
export function sessionShapeKey(shape: SessionShape) {
  return JSON.stringify([
    shape.builtInTools,
    shape.configDir,
    shape.executablePath,
    shape.effort,
    shape.systemPrompt,
    shape.tools.map((tool) => [tool.name, tool.description, tool.inputSchema]),
  ]);
}

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  constructor() {
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
}

/** An async iterable fed by `push`, which the CLI reads its turns from. */
class Pushable<T> implements AsyncIterable<T> {
  private done = false;
  private readonly queue: T[] = [];
  private wake: (() => void) | undefined;

  end() {
    this.done = true;
    this.wake?.();
  }

  push(value: T) {
    this.queue.push(value);
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const next = this.queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.done) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }
}
