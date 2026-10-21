import {
  type LanguageModelV4Message,
  type LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";
import {
  type HookCallbackMatcher,
  type HookEvent,
  type HookInput,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it, vi } from "vitest";

import { transientPrintsOf } from "./continuation";
import { ClaudeCodeSession } from "./session";

/** What the fake Claude Code below was started with, and what it was sent. */
const cli = vi.hoisted(() => ({
  inputs: [] as unknown[],
  options: undefined as Options | undefined,
  output: [] as unknown[],
  wake: undefined as (() => void) | undefined,
}));

/**
 * Claude Code, as far as a step ending on tool results goes: it reports what
 * it is given on `output` and reads its input from the prompt.
 */
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({
    options,
    prompt,
  }: {
    options: Options;
    prompt: AsyncIterable<unknown>;
  }) => {
    cli.options = options;
    cli.inputs = [];
    cli.output = [];
    void (async () => {
      for await (const input of prompt) {
        cli.inputs.push(input);
      }
    })();
    return {
      close: () => {},
      async *[Symbol.asyncIterator]() {
        while (true) {
          const next = cli.output.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            cli.wake = resolve;
          });
        }
      },
    };
  },
}));

/** Reports `message`, which carries only the fields the session reads. */
function emit(message: { type: SDKMessage["type"] } & Record<string, unknown>) {
  cli.output.push(message);
  cli.wake?.();
}

/** Runs the hooks registered for `event`, as Claude Code runs them. */
async function runHooks(event: HookEvent, input: HookInput) {
  const matchers: HookCallbackMatcher[] = cli.options?.hooks?.[event] ?? [];
  const outputs = await Promise.all(
    matchers.flatMap((matcher) =>
      matcher.hooks.map((hook) =>
        hook(input, undefined, { signal: new AbortController().signal }),
      ),
    ),
  );
  return outputs.some((output) => "continue" in output && !output.continue);
}

/**
 * Claude Code's MCP call for `toolUseId` and what follows its result. As
 * probed against Claude Code 2.1.304: a result that succeeded runs
 * PostToolUse, a failed one PostToolUseFailure, whose `continue: false` is
 * not heeded, and then PostToolBatch runs for the step. A hook that stops
 * continuation ends the turn on the results; otherwise the model is asked.
 */
async function pendingCall(session: ClaudeCodeSession, toolUseId: string) {
  const server = Reflect.get(
    cli.options?.mcpServers?.instrument ?? {},
    "instance",
  ) as McpServer; // The SDK's config type leaves the instance untyped.
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  await client.connect(clientSide);
  const base = {
    cwd: "/",
    session_id: session.key,
    tool_input: {},
    tool_name: "mcp__instrument__bash",
    tool_use_id: toolUseId,
    transcript_path: "",
  };
  const done = (async () => {
    const result = await client.callTool({
      _meta: { "claudecode/toolUseId": toolUseId },
      arguments: {},
      name: "bash",
    });
    let ended = false;
    if (result.isError === true) {
      await runHooks("PostToolUseFailure", {
        ...base,
        error: "failed",
        hook_event_name: "PostToolUseFailure",
      });
    } else {
      ended = await runHooks("PostToolUse", {
        ...base,
        hook_event_name: "PostToolUse",
        tool_response: result.content,
      });
    }
    const batchEnded = await runHooks("PostToolBatch", {
      ...base,
      hook_event_name: "PostToolBatch",
      tool_calls: [{ ...base, tool_response: result.content }],
    });
    emit(
      ended || batchEnded
        ? { is_error: false, num_turns: 1, subtype: "success", type: "result" }
        : { message: { content: [] }, type: "assistant" },
    );
  })();
  return { done };
}

it.each([
  { output: { type: "error-text", value: "The user stopped this." } },
  { output: { type: "text", value: "done" } },
] satisfies Pick<LanguageModelV4ToolResultPart, "output">[])(
  "ends the turn on a $output.type result and sends the message after it as its own turn",
  async ({ output }) => {
    const session = new ClaudeCodeSession(
      "chat",
      {
        builtInTools: [],
        configDir: undefined,
        effort: undefined,
        executablePath: "claude",
        modelId: "claude-haiku-5.5",
        systemPrompt: "",
        tools: [
          {
            description: "Run a command",
            inputSchema: { type: "object" },
            name: "bash",
            type: "function",
          },
        ],
      },
      () => {},
    );
    const call = await pendingCall(session, "toolu_1");
    await session.continueWith({
      followedBy: [
        { content: [{ text: "what happened?", type: "text" }], role: "user" },
      ],
      kind: "tool-results",
      results: [
        {
          output,
          toolCallId: "toolu_1",
          toolName: "bash",
          type: "tool-result",
        },
      ],
    });
    await call.done;
    await vi.waitFor(() => expect(cli.inputs).toHaveLength(1));
    expect(cli.inputs).toMatchObject([
      {
        message: {
          content: [{ text: "what happened?", type: "text" }],
          role: "user",
        },
        type: "user",
      },
    ]);
    session.close();
  },
);

it("remembers the notes it was given since its turn began", () => {
  const session = new ClaudeCodeSession(
    "chat",
    {
      builtInTools: [],
      configDir: undefined,
      effort: undefined,
      executablePath: "claude",
      modelId: "claude-haiku-5.5",
      systemPrompt: "",
      tools: [],
    },
    () => {},
  );
  const note = (text: string): LanguageModelV4Message => ({
    content: [{ text, type: "text" }],
    providerOptions: { instrument: { transient: true } },
    role: "user",
  });
  const said: LanguageModelV4Message = {
    content: [{ text: "hi", type: "text" }],
    role: "user",
  };
  session.noteGiven([said, note("budget")], { newTurn: true });
  session.noteGiven([note("rollover")], { newTurn: false });
  expect(session.notesGiven).toEqual(
    new Set(transientPrintsOf([note("budget"), note("rollover")])),
  );
  session.noteGiven([said, note("budget, later")], { newTurn: true });
  expect(session.notesGiven).toEqual(
    new Set(transientPrintsOf([note("budget, later")])),
  );
  session.close();
});
