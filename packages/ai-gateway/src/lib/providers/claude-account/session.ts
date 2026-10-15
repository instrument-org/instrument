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
import { randomUUID } from "node:crypto";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { claudeCodeEnvironment } from "./environment";
import { type ReplayFrame } from "./prompt";
import { OLDEST_CLAUDE_CODE, runsClaudeCode } from "./release";
import { SESSION_CWD } from "./resume-record";

/** The MCP server name our tools are served under, and so their prefix. */
const SERVER_NAME = "instrument";
export const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;

/** The meta key the CLI stamps each MCP call with, naming its tool_use block. */
const TOOL_USE_ID_META = "claudecode/toolUseId";

/**
 * What the model reads where a turn ends on tool results, as Claude Code
 * notes it inside each result: `hook stopped continuation: <this>`. The
 * message it promises comes right after the results, in the same user turn.
 */
const END_TURN_REASON = "A new message follows these results.";

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
export class ClaudeCodeSession {
  /** Tool calls from the last step, waiting on our loop to run them. */
  awaitingToolCallIds: string[] = [];
  busy = false;
  /**
   * Whether Claude Code ends its turn once the tool calls it waits on are
   * answered, instead of asking the model about their results. Set while a
   * message that came in after those results waits to go in as the next turn.
   */
  endTurnAfterTools = false;
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
  private readonly input = new Pushable<SDKUserMessage | AssistantFrame>();
  private readonly query: Query;
  private readonly results = new Map<string, Deferred<CallToolResult>>();
  private readonly stderrTail: string[] = [];

  /**
   * The transcript entry that ends this step's input, before the reply: the
   * message we sent, or the last tool result Claude Code reported taking.
   */
  forkPoint: string | undefined;

  /**
   * @param transcript The Claude Code session this process writes, under
   * its own id, and how it begins: new, resumed where it stopped, or forked
   * from another session's transcript at one of its entries. None for a
   * one-off, which nothing continues and so keeps no transcript.
   */
  constructor(
    readonly key: string,
    shape: SessionShape,
    private readonly onClose: () => void,
    readonly transcript?: {
      claudeSessionId: string;
      start: TranscriptStart;
    },
  ) {
    this.builtInTools = new Set(shape.builtInTools);
    this.modelId = shape.modelId;
    const env = claudeCodeEnvironment(shape.configDir);
    this.query = query({
      options: {
        allowedTools: [`mcp__${SERVER_NAME}`, ...shape.builtInTools],
        cwd: SESSION_CWD,
        effort: shape.effort,
        env,
        hooks: {
          PostToolUse: [
            {
              hooks: [
                () =>
                  Promise.resolve(
                    this.endTurnAfterTools
                      ? { continue: false, stopReason: END_TURN_REASON }
                      : {},
                  ),
              ],
            },
          ],
        },
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
        // Every tool the session may call is in `allowedTools`, and nothing
        // answers a permission prompt, so anything else is refused outright.
        // Left out, the CLI picks its own default, which can be `auto`: a
        // classifier model judging each call on the user's account.
        permissionMode: "dontAsk",
        // Ours is the record, but the CLI's own transcript, kept in the
        // config folder Instrument signs it in through, is what lets a later
        // request resume this session with its tool calls and images intact
        // instead of replaying ours into a new one as text.
        ...transcriptOptions(transcript),
        settingSources: [],
        settings: { disableClaudeAiConnectors: true },
        stderr: (data) => {
          this.stderrTail.push(data);
          this.stderrTail.splice(0, this.stderrTail.length - 20);
        },
        strictMcpConfig: true,
        // Claude Code streams a thinking block with its text left out unless
        // asked for a summary, which is what shows as the model's reasoning.
        thinking: { display: "summarized", type: "adaptive" },
        // A call to one of our tools by its own name, as our prompts write
        // it, reaches the same tool as its prefixed name.
        toolAliases: Object.fromEntries(
          shape.tools.map((tool) => [tool.name, `${TOOL_PREFIX}${tool.name}`]),
        ),
        systemPrompt: shape.systemPrompt,
        tools: shape.builtInTools,
      },
      // Assistant messages of history go in on the same input as the user's.
      // The SDK types that input as user messages only, but writes each one
      // to Claude Code as it is, and Claude Code reads an assistant message
      // there as one of its own.
      prompt: this.input as AsyncIterable<SDKUserMessage>,
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
    const uuid = randomUUID();
    this.input.push({
      // Our words go to the model as written: no `@path` reading a file
      // past our permissions, no `/name` running a command or skill of
      // Claude Code's own, and none of its turn-start attachments.
      client_composed: true,
      message: { content, role: "user" },
      parent_tool_use_id: null,
      type: "user",
      uuid,
    });
    this.forkPoint = uuid;
  }

  /**
   * Gives a process that has seen nothing our history as its own, then sends
   * the last frame, which starts the step. Each earlier user-side frame is
   * appended without a turn, and Claude Code acknowledges it with a result of
   * no turns before the next goes in: sent together, a user frame would be
   * merged into the next one that asks for a turn, out of order.
   */
  async replay(frames: ReplayFrame[]) {
    for (const [index, frame] of frames.entries()) {
      const last = index === frames.length - 1;
      if (frame.role === "assistant") {
        this.input.push({
          message: {
            content: frame.content,
            role: "assistant",
            ...(frame.model && { model: frame.model }),
          },
          parent_tool_use_id: null,
          type: "assistant",
        });
        continue;
      }
      if (last) {
        this.send(frame.content);
        return;
      }
      this.input.push({
        client_composed: true,
        message: { content: frame.content, role: "user" },
        parent_tool_use_id: null,
        shouldQuery: false,
        type: "user",
        uuid: randomUUID(),
      });
      await this.acknowledged();
    }
  }

  /** Waits for Claude Code to take a frame that asked for no turn. */
  private async acknowledged() {
    while (true) {
      const next = await this.messages.next();
      if (next.done) {
        throw new Error(
          `Claude Code exited during the replay.\n${this.stderr}`,
        );
      }
      // An older build takes the frames out of order, which would hand the
      // model a scrambled conversation; failing the step says why instead.
      if (
        next.value.type === "system" &&
        next.value.subtype === "init" &&
        !runsClaudeCode(next.value.claude_code_version)
      ) {
        throw new Error(
          `Claude Code ${next.value.claude_code_version} is older than ${OLDEST_CLAUDE_CODE}, the oldest that takes a replayed conversation in order.`,
        );
      }
      if (next.value.type !== "result") {
        continue;
      }
      if (next.value.num_turns !== 0 || next.value.is_error) {
        throw new Error("Claude Code ran a turn on a frame of history.");
      }
      return;
    }
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

export type TranscriptStart =
  | { kind: "fork"; at: string; from: string }
  | { kind: "new" }
  | { kind: "resume" };

function transcriptOptions(transcript: ClaudeCodeSession["transcript"]) {
  if (transcript === undefined) {
    return { persistSession: false };
  }
  const { claudeSessionId, start } = transcript;
  switch (start.kind) {
    case "new":
      return { sessionId: claudeSessionId };
    case "resume":
      return { resume: claudeSessionId };
    case "fork":
      return {
        forkSession: true,
        resume: start.from,
        resumeSessionAt: start.at,
        sessionId: claudeSessionId,
      };
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

/** An assistant message of history, written to Claude Code's input as is. */
interface AssistantFrame {
  message: {
    content: ContentBlockParam[];
    model?: string;
    role: "assistant";
  };
  parent_tool_use_id: null;
  type: "assistant";
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
