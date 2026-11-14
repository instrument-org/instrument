import {
  type LanguageModelV4FunctionTool,
  type LanguageModelV4Message,
  type LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, realpathSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  utimes,
  writeFile,
} from "node:fs/promises";
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
  /** How many messages the process has been sent. */
  received: () => number;
}

/** Every process started, in order, and the child each was spawned as. */
const cli = vi.hoisted(() => ({
  children: [] as { emit: (event: string) => boolean }[],
  started: [] as FakeProcess[],
}));

/** A child that runs nothing, and closes when its fake process ends. */
vi.mock("node:child_process", async (importOriginal) => {
  const { EventEmitter } = await import("node:events");
  return {
    ...(await importOriginal<typeof import("node:child_process")>()),
    spawn: () => {
      const child = Object.assign(new EventEmitter(), {
        stderr: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
      });
      cli.children.push(child);
      return child;
    },
  };
});

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
    options.spawnClaudeCodeProcess?.({
      args: [],
      command: "claude",
      env: {},
      signal: new AbortController().signal,
    });
    const child = cli.children.at(-1);
    const exit = () => {
      ended = true;
      wake?.();
      child?.emit("close");
    };
    let received = 0;
    void (async () => {
      for await (const input of prompt) {
        void input;
        received += 1;
      }
    })();
    cli.started.push({
      emit: (message) => {
        output.push(message);
        wake?.();
      },
      exit,
      options,
      received: () => received,
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

/** The transcript a process writes as its first step starts. */
async function startTranscript(configDir: string, process: FakeProcess) {
  const claudeSessionId = process.options.sessionId ?? "";
  const file = transcriptFile(configDir, claudeSessionId);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "");
  return claudeSessionId;
}

/** The transcripts in a config folder, and the ones its records name. */
async function transcriptsOf(configDir: string) {
  const records = join(configDir, "instrument-sessions");
  const named: unknown[] = [];
  for (const name of await readdir(records).catch(() => [])) {
    const record: unknown = JSON.parse(
      await readFile(join(records, name), "utf8"),
    );
    named.push(
      typeof record === "object" && record !== null
        ? Reflect.get(record, "claudeSessionId")
        : undefined,
    );
  }
  const files = await readdir(join(transcriptFile(configDir, "any"), ".."));
  return {
    kept: files.map((name) => name.replace(/\.jsonl$/, "")).toSorted(),
    named,
  };
}

it("removes the transcript of a resume stopped on its first step", async () => {
  const { claudeSessionId, configDir } = await afterFirstStep();
  const stop = new AbortController();
  const { parts, process } = await startStep(
    await launch(configDir),
    SECOND_TURN,
    stop.signal,
  );
  expect(await startTranscript(configDir, process)).not.toBe(claudeSessionId);

  stop.abort();

  expect((await parts).map((part) => part.type)).toContain("error");
  await vi.waitFor(async () => {
    expect(await transcriptsOf(configDir)).toEqual({
      kept: [claudeSessionId],
      named: [claudeSessionId],
    });
  });
});

it("removes the transcript of a cold start that fails on its first step", async () => {
  const { claudeSessionId, configDir } = await afterFirstStep();
  const { parts, process } = await startStep(await launch(configDir), [
    { content: "You are a test.", role: "system" },
    { content: [{ text: "something else", type: "text" }], role: "user" },
  ]);
  expect(process.options.resume).toBeUndefined();
  expect(await startTranscript(configDir, process)).not.toBe(claudeSessionId);

  process.exit();

  expect((await parts).map((part) => part.type)).toContain("error");
  await vi.waitFor(async () => {
    expect(await transcriptsOf(configDir)).toEqual({ kept: [], named: [] });
  });
});

it("keeps the transcript its record names when a live process is stopped on its second step", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "language-model-"));
  const model = await launch(configDir);
  const first = await startStep(model, FIRST_TURN);
  const claudeSessionId = await startTranscript(configDir, first.process);
  reply(first.process, "leaf-1");
  await first.parts;
  const sent = first.process.received();
  const started = cli.started.length;

  const stop = new AbortController();
  const { stream } = await model.doStream({
    abortSignal: stop.signal,
    prompt: SECOND_TURN,
    providerOptions: { "claude-account": { sessionId: "ses_1" } },
    tools: TOOLS,
  });
  const reader = stream.getReader();
  await vi.waitFor(() => {
    expect(first.process.received()).toBeGreaterThan(sent);
  });
  stop.abort();
  const types: string[] = [];
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    types.push(next.value.type);
  }
  // Longer than removing a transcript takes once its process has exited.
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(types).toContain("error");
  expect(cli.started).toHaveLength(started);
  expect(await transcriptsOf(configDir)).toEqual({
    kept: [claudeSessionId],
    named: [claudeSessionId],
  });
});

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
