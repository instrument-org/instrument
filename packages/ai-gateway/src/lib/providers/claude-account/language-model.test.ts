import {
  type LanguageModelV4FunctionTool,
  type LanguageModelV4Message,
  type LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { SESSION_CWD } from "./resume-record";

/** One fake Claude Code process: what it was started with, and its output. */
interface FakeProcess {
  emit: (
    message: { type: SDKMessage["type"] } & Record<string, unknown>,
  ) => void;
  /** Ends the process, as one that exits by itself does. */
  exit: () => void;
  options: Options;
}

/** Every process started, in order. */
const cli = vi.hoisted(() => ({ started: [] as FakeProcess[] }));

/**
 * Claude Code, as far as starting a step goes: each process reports what the
 * test has it report, and ends when closed or told to exit.
 */
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({
    options,
    prompt,
  }: {
    options: Options;
    prompt: AsyncIterable<unknown>;
  }) => {
    const output: unknown[] = [];
    let ended = false;
    let wake: (() => void) | undefined;
    const exit = () => {
      ended = true;
      wake?.();
    };
    void (async () => {
      for await (const input of prompt) {
        void input;
      }
    })();
    cli.started.push({
      emit: (message) => {
        output.push(message);
        wake?.();
      },
      exit,
      options,
    });
    return {
      close: exit,
      async *[Symbol.asyncIterator]() {
        while (true) {
          const next = output.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (ended) {
            return;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    };
  },
}));

const TOOLS: LanguageModelV4FunctionTool[] = [
  {
    description: "Runs a command.",
    inputSchema: { properties: {}, type: "object" },
    name: "bash",
    type: "function",
  },
];

const FIRST_TURN: LanguageModelV4Message[] = [
  { content: "You are a test.", role: "system" },
  { content: [{ text: "hi", type: "text" }], role: "user" },
];

const SECOND_TURN: LanguageModelV4Message[] = [
  ...FIRST_TURN,
  { content: [{ text: "hello", type: "text" }], role: "assistant" },
  { content: [{ text: "again", type: "text" }], role: "user" },
];

/** The model as a launch of the app has it, with no process or sweep yet. */
async function launch(configDir: string) {
  vi.resetModules();
  const { createClaudeAccountLanguageModel } = await import("./language-model");
  return createClaudeAccountLanguageModel({
    configDir,
    executablePath: "claude",
    providerConfigId: "claude",
  })("claude-test");
}

/** Starts a step of the test's one chat, and waits for its process. */
async function startStep(
  model: Awaited<ReturnType<typeof launch>>,
  prompt: LanguageModelV4Message[],
  abortSignal?: AbortSignal,
) {
  const before = cli.started.length;
  const { stream } = await model.doStream({
    abortSignal,
    prompt,
    providerOptions: { "claude-account": { sessionId: "ses_1" } },
    tools: TOOLS,
  });
  const parts = (async () => {
    const read: LanguageModelV4StreamPart[] = [];
    for await (const part of stream) {
      read.push(part);
    }
    return read;
  })();
  await vi.waitFor(() => {
    expect(cli.started).toHaveLength(before + 1);
  });
  const process = cli.started.at(-1);
  if (process === undefined) {
    throw new Error("No process started.");
  }
  return { parts, process };
}

/** Has `process` reply and end its turn, on the transcript entry `leaf`. */
function reply(process: FakeProcess, leaf: string) {
  process.emit({
    message: { content: [{ text: "hello", type: "text" }] },
    parent_tool_use_id: null,
    type: "assistant",
    uuid: leaf,
  });
  process.emit({
    is_error: false,
    modelUsage: {},
    num_turns: 1,
    subtype: "success",
    type: "result",
  });
}

function transcriptFile(configDir: string, claudeSessionId: string) {
  return join(
    configDir,
    "projects",
    realpathSync(SESSION_CWD).replaceAll(/[^a-zA-Z0-9]/g, "-"),
    `${claudeSessionId}.jsonl`,
  );
}

/**
 * A config folder a chat's first step finished in, with the transcript
 * Claude Code would have written for it. Returns that transcript's id.
 */
async function afterFirstStep() {
  const configDir = await mkdtemp(join(tmpdir(), "language-model-"));
  const { parts, process } = await startStep(
    await launch(configDir),
    FIRST_TURN,
  );
  reply(process, "leaf-1");
  await parts;
  const claudeSessionId = process.options.sessionId ?? "";
  const file = transcriptFile(configDir, claudeSessionId);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(
    file,
    [
      {
        message: { content: [{ text: "hi", type: "text" }], role: "user" },
        type: "user",
        uuid: "entry-1",
      },
      {
        message: {
          content: [{ text: "hello", type: "text" }],
          role: "assistant",
        },
        type: "assistant",
        uuid: "leaf-1",
      },
    ]
      .map((entry) => `${JSON.stringify(entry)}\n`)
      .join(""),
  );
  return { claudeSessionId, configDir };
}

it("resumes a chat left for a month on the first step after a launch", async () => {
  const { claudeSessionId, configDir } = await afterFirstStep();
  const records = join(configDir, "instrument-sessions");
  const then = Date.now() / 1000 - 31 * 24 * 60 * 60;
  for (const name of await readdir(records)) {
    await utimes(join(records, name), then, then);
  }

  const { parts, process } = await startStep(
    await launch(configDir),
    SECOND_TURN,
  );
  // Longer than a sweep still running takes to reach the one record.
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect({
    records: await readdir(records),
    resume: process.options.resume,
    resumeSessionAt: process.options.resumeSessionAt,
    transcript: existsSync(transcriptFile(configDir, claudeSessionId)),
  }).toEqual({
    records: [expect.stringMatching(/\.json$/)],
    resume: claudeSessionId,
    resumeSessionAt: "leaf-1",
    transcript: true,
  });
  reply(process, "leaf-2");
  await parts;
});

it.each([
  {
    fail: (process: FakeProcess) => {
      process.emit({
        errors: ["The entry to carry on from is not in this session."],
        is_error: true,
        num_turns: 0,
        subtype: "error_during_execution",
        type: "result",
      });
    },
    how: "fails in words nothing here knows, before any reply",
    records: 0,
  },
  {
    fail: (process: FakeProcess) => {
      process.exit();
    },
    how: "exits by itself before any reply",
    records: 0,
  },
  {
    fail: (process: FakeProcess) => {
      process.emit({
        error: "authentication_failed",
        message: { content: [{ text: "Please run /login", type: "text" }] },
        parent_tool_use_id: null,
        type: "assistant",
        uuid: "leaf-2",
      });
    },
    how: "is refused for its sign-in",
    records: 1,
  },
  {
    fail: (_process: FakeProcess, stop: AbortController) => {
      stop.abort();
    },
    how: "is stopped before any reply",
    records: 1,
  },
])(
  "keeps $records records when a resumed step $how",
  async ({ fail, records }) => {
    const { claudeSessionId, configDir } = await afterFirstStep();
    const stop = new AbortController();
    const { parts, process } = await startStep(
      await launch(configDir),
      SECOND_TURN,
      stop.signal,
    );
    expect(process.options.resume).toBe(claudeSessionId);

    fail(process, stop);

    expect((await parts).map((part) => part.type)).toContain("error");
    expect(await readdir(join(configDir, "instrument-sessions"))).toHaveLength(
      records,
    );
  },
);
