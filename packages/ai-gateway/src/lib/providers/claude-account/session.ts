import {
  type LanguageModelV4FunctionTool,
  type LanguageModelV4Message,
} from "@ai-sdk/provider";
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
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  endTurnOnResults,
  historyFrameTaken,
  type MessageSource,
} from "./cli-messages";
import { type Continuation, transientPrintsOf } from "./continuation";
import { claudeCodeEnvironment } from "./environment";
import { type ReplayFrame, toolResultToMCP, turnContent } from "./prompt";
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
export class ClaudeCodeSession implements MessageSource {
  /** Tool calls from the last step, waiting on our loop to run them. */
  awaitingToolCallIds: string[] = [];
  busy = false;
  readonly messages: AsyncIterator<SDKMessage, void>;
  /** The built-in tools this process runs itself, which our loop never sees. */
  readonly builtInTools: ReadonlySet<string>;
  /**
   * The context window Claude Code said it ran this step's model in, which
   * only the result ending a turn reports.
   */
  contextWindow: number | undefined;
  modelId: string;
  /** The plan's usage as the CLI last reported it, which it does not repeat every turn. */
  rateLimit: SDKRateLimitInfo | undefined;
  /**
   * A fingerprint of each message of ours this process has been given, in
   * order; its own reply to the last one is what comes next.
   */
  seen: string[] = [];
  /**
   * A fingerprint of each transient note this process has been given since
   * it began its current turn, which a step in the same turn does not send
   * again.
   */
  notesGiven = new Set<string>();
  private closed = false;
  /**
   * Whether Claude Code ends its turn once the tool calls it waits on are
   * answered, instead of asking the model about their results. Set while a
   * message that came in after those results waits to go in as the next turn.
   */
  private endTurnAfterTools = false;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly input = new Pushable<SDKUserMessage | AssistantFrame>();
  private readonly query: Query;
  private readonly results = new Map<string, Deferred<CallToolResult>>();
  private readonly stderrTail: string[] = [];
  private readonly exit = new Deferred<void>();

  /**
   * The transcript entry that ends this step's input, before the reply: the
   * message we sent, or the last tool result Claude Code reported taking.
   */
  forkPoint: string | undefined;

  /**
   * The transcript entry this step's reply ends on so far: the last of the
   * assistant entries Claude Code reported, which a later resume cuts the
   * transcript back to.
   */
  leaf: string | undefined;

  /**
   * @param transcript The Claude Code session this process writes, under
   * its own id, and how it begins: new, or forked from a transcript at one
   * of its entries (its own slot's last finished step, or the step a task
   * branched off its chat at). None for a one-off, which nothing continues
   * and so keeps no transcript.
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
        // PostToolBatch runs once every call of the step has its result,
        // failed ones included. PostToolUse runs only for a result that
        // succeeded, and PostToolUseFailure, which runs for the rest, cannot
        // end the turn.
        hooks: {
          PostToolBatch: [
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
        // Spawned here, as the SDK would, so that `exited` can say when the
        // process is gone.
        spawnClaudeCodeProcess: (spawned) => {
          const child = spawn(spawned.command, spawned.args, {
            cwd: spawned.cwd,
            env: spawned.env,
            signal: spawned.signal,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          });
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (data: string) => {
            this.stderrTail.push(data);
            this.stderrTail.splice(0, this.stderrTail.length - 20);
          });
          child.once("close", () => this.exit.resolve());
          child.once("error", () => this.exit.resolve());
          return child;
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

  /**
   * Settles once the process has exited. Claude Code writes the last entries
   * of its transcript as it exits, a moment after `close`, so another process
   * on that transcript starts only after.
   */
  get exited() {
    return this.exit.promise;
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

  /**
   * Starts a step on `seen`, our messages it answers. Until `endStep`, a
   * request for this session gets a process of its own instead.
   */
  beginStep(seen: string[]) {
    this.busy = true;
    this.awaitingToolCallIds = [];
    this.contextWindow = undefined;
    this.forkPoint = undefined;
    this.leaf = undefined;
    this.seen = seen;
    this.touch();
  }

  endStep() {
    this.busy = false;
    this.touch();
  }

  /** Switches the process to `modelId`, before a step that asks for it. */
  async useModel(modelId: string) {
    if (this.modelId !== modelId) {
      await this.query.setModel(modelId);
      this.modelId = modelId;
    }
  }

  /** Carries this process on from what it saw, with what the request adds. */
  async continueWith(continuation: Continuation) {
    if (continuation.kind === "turn") {
      this.noteGiven(continuation.messages, { newTurn: true });
      this.send(turnContent(continuation.messages));
      return;
    }
    // A message sent while Claude Code waits on our tools would be folded
    // into the last result's own text, where a model can take it for
    // something the tool returned. So the turn ends on the results, and the
    // message goes in after them as a turn of its own, which reaches the
    // model beside them, as the user's.
    const { followedBy, results } = continuation;
    this.endTurnAfterTools = followedBy.length > 0;
    try {
      for (const part of results) {
        this.resolveToolCall(part.toolCallId, toolResultToMCP(part.output));
      }
      if (followedBy.length > 0) {
        await endTurnOnResults(this);
        this.noteGiven(followedBy, { newTurn: false });
        this.send(turnContent(followedBy));
      }
    } finally {
      this.endTurnAfterTools = false;
    }
  }

  /**
   * Notes the transient messages among `messages` as given, as a new turn's
   * only notes when it starts one.
   */
  noteGiven(
    messages: LanguageModelV4Message[],
    { newTurn }: { newTurn: boolean },
  ) {
    if (newTurn) {
      this.notesGiven.clear();
    }
    for (const print of transientPrintsOf(messages)) {
      this.notesGiven.add(print);
    }
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
      await historyFrameTaken(this);
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

  /** What the context holds on the current model, and how much it can. */
  contextUsage() {
    return this.query.getContextUsage({ detail: "summary" });
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
  | { kind: "new" };

function transcriptOptions(transcript: ClaudeCodeSession["transcript"]) {
  if (transcript === undefined) {
    return { persistSession: false };
  }
  const { claudeSessionId, start } = transcript;
  switch (start.kind) {
    case "new":
      return { sessionId: claudeSessionId };
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
