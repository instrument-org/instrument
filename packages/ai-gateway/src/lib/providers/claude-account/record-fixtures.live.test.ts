import {
  type LanguageModelV4FunctionTool,
  type LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { pumpStep, type StepSession } from "./language-model";
import { ClaudeCodeSession } from "./session";
import { type RecordedStep, scrubMessage } from "./step-fixtures";

// Records what real Claude Code sends for one step, as fixtures the stream
// mapping is tested against offline. It runs the `claude` in ~/.local/bin on
// the signed-in account, so it only runs when asked: CLAUDE_ACCOUNT_RECORD=1.
// Re-record after an Agent SDK bump.

const FIXTURES = path.join(import.meta.dirname, "fixtures");

const ADD: LanguageModelV4FunctionTool = {
  description: "Add two numbers.",
  inputSchema: {
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
    type: "object",
  },
  name: "add",
  type: "function",
};

/** Run one step on `session`, keeping every message the step read. */
async function recordStep(session: ClaudeCodeSession): Promise<RecordedStep> {
  const messages: SDKMessage[] = [];
  const source: StepSession = {
    awaitingToolCallIds: session.awaitingToolCallIds,
    builtInTools: session.builtInTools,
    messages: {
      next: async () => {
        const next = await session.messages.next();
        if (!next.done) {
          messages.push(next.value);
        }
        return next;
      },
    },
    rateLimit: session.rateLimit,
    stderr: session.stderr,
  };
  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    start: async (controller) => {
      await pumpStep(source, controller);
      controller.close();
    },
  });
  for await (const _ of stream) {
    // Only the messages matter here.
  }
  session.awaitingToolCallIds = source.awaitingToolCallIds;
  return {
    builtInTools: [...session.builtInTools],
    messages: messages.flatMap((message) => scrubMessage(message) ?? []),
  };
}

function open(
  key: string,
  options: {
    builtInTools?: string[];
    effort?: "high";
    modelId?: string;
    tools?: LanguageModelV4FunctionTool[];
  },
) {
  return new ClaudeCodeSession(
    key,
    {
      builtInTools: options.builtInTools ?? [],
      configDir: undefined,
      effort: options.effort,
      executablePath: `${homedir()}/.local/bin/claude`,
      modelId: options.modelId ?? "claude-sonnet-5-5",
      systemPrompt: "You are a terse assistant.",
      tools: options.tools ?? [],
    },
    () => {},
  );
}

async function save(name: string, steps: RecordedStep[]) {
  await mkdir(FIXTURES, { recursive: true });
  await writeFile(
    path.join(FIXTURES, `${name}.json`),
    `${JSON.stringify(steps, null, 2)}\n`,
  );
}

it.skipIf(process.env.CLAUDE_ACCOUNT_RECORD !== "1")(
  "records Claude Code steps as fixtures",
  { timeout: 300_000 },
  async () => {
    // Haiku thinks on this one every time; Sonnet often answers outright.
    const thinking = open("record-thinking", {
      effort: "high",
      modelId: "claude-haiku-4-5",
    });
    thinking.send([
      {
        text: "A bat and a ball cost $1.10. The bat costs $1 more than the ball. Work it out carefully, then give the ball's price.",
        type: "text",
      },
    ]);
    await save("text-and-thinking", [await recordStep(thinking)]);
    thinking.close();

    const oneTool = open("record-tool", { tools: [ADD] });
    oneTool.send([
      {
        text: "Use the add tool to add 2 and 3, then say the sum.",
        type: "text",
      },
    ]);
    const call = await recordStep(oneTool);
    for (const id of oneTool.awaitingToolCallIds) {
      oneTool.resolveToolCall(id, { content: [{ text: "5", type: "text" }] });
    }
    await save("tool-call-and-follow-up", [call, await recordStep(oneTool)]);
    oneTool.close();

    const twoTools = open("record-parallel", { tools: [ADD] });
    twoTools.send([
      {
        text: "In one step, call add twice at the same time: 1+2 and 3+4. Then give both sums.",
        type: "text",
      },
    ]);
    const calls = await recordStep(twoTools);
    for (const id of twoTools.awaitingToolCallIds) {
      twoTools.resolveToolCall(id, {
        content: [{ text: "3 and 7", type: "text" }],
      });
    }
    await save("parallel-tool-calls", [calls, await recordStep(twoTools)]);
    twoTools.close();

    const search = open("record-search", {
      builtInTools: ["WebSearch"],
      tools: [ADD],
    });
    search.send([
      {
        text: "Search the web for the latest stable Electron version and answer in one sentence.",
        type: "text",
      },
    ]);
    const searched = await recordStep(search);
    await save("native-web-search", [searched]);
    search.close();
    expect(searched.messages.length).toBeGreaterThan(0);
  },
);
