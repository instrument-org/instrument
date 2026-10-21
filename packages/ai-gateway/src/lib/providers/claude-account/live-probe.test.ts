import {
  type LanguageModelV4FunctionTool,
  type LanguageModelV4Message,
} from "@ai-sdk/provider";
import { stepCountIs, streamText, tool } from "ai";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";

import { CLIENT_SESSION_ID_HEADER } from "../../../constants";
import { fetchClaudeAccountUsage } from "./fetch-usage";
import {
  closeClaudeAccountSessions,
  createClaudeAccountLanguageModel,
} from "./language-model";

// Runs against the real `claude` CLI in ~/.local/bin and spends the signed-in
// account's plan, so it only runs when asked: CLAUDE_ACCOUNT_LIVE=1.

/** Begins every system prompt here, so the transcripts it leaves can be told apart. */
const PROBE_MARKER = "You are Pebble.";

const probeStartedAt = Date.now();

// The CLI keeps a transcript of each session in the home folder's Claude
// Code project, beside the person's own, and the provider a resume record
// for each in the config folder. Once every process has finished writing,
// the ones made by this run go: a transcript made since it started that
// holds the marker, and a record naming one of those.
afterAll(async () => {
  if (process.env.CLAUDE_ACCOUNT_LIVE !== "1") {
    return;
  }
  closeClaudeAccountSessions();
  const home = userInfo().homedir;
  const project = join(
    home,
    ".claude",
    "projects",
    realpathSync(home).replaceAll(/[^a-zA-Z0-9]/g, "-"),
  );
  const entries = () => (existsSync(project) ? readdirSync(project) : []);
  // Claude Code appends its last entries as it exits, after `close` returns,
  // and would recreate a transcript removed before then.
  const signature = () =>
    entries()
      .map((name) => {
        const { mtimeMs, size } = statSync(join(project, name));
        return `${name}:${size}:${mtimeMs}`;
      })
      .join();
  let last = signature();
  let stableSince = Date.now();
  const deadline = Date.now() + 15_000;
  while (Date.now() - stableSince < 1500 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const now = signature();
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
  }
  const ours = new Set(
    entries()
      .filter((name) => name.endsWith(".jsonl"))
      .filter((name) => {
        const path = join(project, name);
        return (
          statSync(path).birthtimeMs >= probeStartedAt &&
          readFileSync(path, "utf8").includes(PROBE_MARKER)
        );
      })
      .map((name) => name.replace(/\.jsonl$/, "")),
  );
  for (const id of ours) {
    // With the folder of tool results Claude Code may have made beside it.
    rmSync(join(project, `${id}.jsonl`), { force: true });
    rmSync(join(project, id), { force: true, recursive: true });
  }
  const records = join(home, ".claude", "instrument-sessions");
  for (const name of existsSync(records) ? readdirSync(records) : []) {
    const path = join(records, name);
    const record = z
      .object({ claudeSessionId: z.string() })
      .safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (record.success && ours.has(record.data.claudeSessionId)) {
      rmSync(path, { force: true });
    }
  }
}, 30_000);
it.skipIf(process.env.CLAUDE_ACCOUNT_LIVE !== "1")(
  "runs a multi-step tool turn and a follow-up through the CLI",
  { timeout: 180_000 },
  async () => {
    const model = createClaudeAccountLanguageModel({
      configDir: undefined,
      executablePath: `${homedir()}/.local/bin/claude`,
    })("claude-haiku-4-5");
    const calls: string[] = [];
    const tools = {
      add: tool({
        description: "Add two numbers",
        execute: async ({ a, b }) => {
          calls.push(`add(${a},${b})`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { sum: a + b };
        },
        inputSchema: z.object({ a: z.number(), b: z.number() }),
      }),
    };
    const headers = { [CLIENT_SESSION_ID_HEADER]: "live-probe" };
    const messages: Parameters<typeof streamText>[0]["messages"] = [
      {
        content: `${PROBE_MARKER} Use the add tool for all arithmetic, one call at a time.`,
        role: "system",
      },
      { content: "What is (2+3)+10? Use the tool twice.", role: "user" },
    ];
    const first = streamText({
      allowSystemInMessages: true,
      headers,
      messages,
      model,
      stopWhen: stepCountIs(6),
      tools,
    });
    for await (const part of first.fullStream) {
      if (part.type === "error") {
        throw part.error;
      }
    }
    const firstText = await first.text;
    const steps = await first.steps;
    console.log("TURN 1", calls, steps.length, JSON.stringify(firstText));

    messages.push(...(await first.responseMessages));
    messages.push({
      content: "What's your name, and what was the final sum?",
      role: "user",
    });
    const second = streamText({
      allowSystemInMessages: true,
      headers,
      messages,
      model,
      tools,
    });
    const secondText = await second.text;
    console.log(
      "TURN 2",
      JSON.stringify(secondText),
      JSON.stringify(await second.providerMetadata),
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(secondText).toMatch(/15/);
  },
);

it.skipIf(process.env.CLAUDE_ACCOUNT_LIVE !== "1")(
  "reads the plan's usage windows",
  { timeout: 60_000 },
  async () => {
    const usage = await fetchClaudeAccountUsage({
      configDir: undefined,
      executablePath: `${homedir()}/.local/bin/claude`,
    });
    console.log("USAGE", JSON.stringify(usage));
    expect(usage.windows.length).toBeGreaterThan(0);
  },
);

// Steps driven one doStream at a time, as our agent loop drives them, so a
// test can end the process between steps and hand a step the messages a
// hand-off's wake would carry.
it.skipIf(process.env.CLAUDE_ACCOUNT_LIVE !== "1")(
  "resumes its transcript after the process ends, and takes a wake with tool results",
  { timeout: 300_000 },
  async () => {
    const warnings: string[] = [];
    const infos: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((line) => {
      warnings.push(String(line));
    });
    const info = vi.spyOn(console, "info").mockImplementation((line) => {
      infos.push(String(line));
    });
    const model = createClaudeAccountLanguageModel({
      configDir: undefined,
      executablePath: `${homedir()}/.local/bin/claude`,
    })("claude-haiku-4-5");
    const tools: LanguageModelV4FunctionTool[] = [
      {
        description: "Add two numbers",
        inputSchema: {
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
          type: "object",
        },
        name: "add",
        type: "function",
      },
    ];
    const providerOptions = {
      "claude-account": { sessionId: `live-resume-${randomUUID()}` },
    };
    async function step(prompt: LanguageModelV4Message[]) {
      const { stream } = await model.doStream({
        prompt,
        providerOptions,
        tools,
      });
      let text = "";
      const calls: { input: string; toolCallId: string }[] = [];
      for await (const part of stream) {
        if (part.type === "error") {
          throw part.error;
        }
        if (part.type === "text-delta") {
          text += part.delta;
        }
        if (part.type === "tool-call") {
          calls.push({ input: part.input, toolCallId: part.toolCallId });
        }
      }
      return { calls, text };
    }
    const result = (toolCallId: string, value: string) => ({
      content: [
        {
          output: { type: "text" as const, value },
          toolCallId,
          toolName: "add",
          type: "tool-result" as const,
        },
      ],
      role: "tool" as const,
    });

    const prompt: LanguageModelV4Message[] = [
      {
        content: `${PROBE_MARKER} Use the add tool for all arithmetic, one call at a time.`,
        role: "system",
      },
      {
        content: [
          {
            text: "The secret word is marmalade. What is 2+3? Use the tool.",
            type: "text",
          },
        ],
        role: "user",
      },
    ];
    const first = await step(prompt);
    const [call] = first.calls;
    expect(call).toBeDefined();
    prompt.push(
      {
        content: [
          {
            input: JSON.parse(call?.input ?? "{}") as unknown,
            toolCallId: call?.toolCallId ?? "",
            toolName: "add",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
      result(call?.toolCallId ?? "", "5"),
    );
    const answered = await step(prompt);
    prompt.push({
      content: [{ text: answered.text, type: "text" }],
      role: "assistant",
    });

    // The process ends, as an idle timeout or quitting would end it.
    closeClaudeAccountSessions();
    prompt.push({
      content: [
        {
          text: "Now add 5+10 with the tool.",
          type: "text",
        },
      ],
      role: "user",
    });
    const resumed = await step(prompt);
    console.log("RESUMED", JSON.stringify(resumed));
    const [handOff] = resumed.calls;
    expect(handOff).toBeDefined();

    // The turn ends on the call, as a hand-off's does, and the wake arrives
    // after its result.
    prompt.push(
      {
        content: [
          ...(resumed.text
            ? [{ text: resumed.text, type: "text" as const }]
            : []),
          {
            input: JSON.parse(handOff?.input ?? "{}") as unknown,
            toolCallId: handOff?.toolCallId ?? "",
            toolName: "add",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
      result(handOff?.toolCallId ?? "", "15"),
      {
        content: [
          {
            text: "A task just finished: it found the color teal. Tell me the sum, the color, and the secret word from my first message.",
            type: "text",
          },
        ],
        role: "user",
      },
    );
    const woken = await step(prompt);
    process.stderr.write(
      `WOKEN ${JSON.stringify({ infos, warnings, woken })}\n`,
    );
    warn.mockRestore();
    info.mockRestore();

    expect(woken.text).toMatch(/15/);
    expect(woken.text.toLowerCase()).toContain("teal");
    expect(woken.text.toLowerCase()).toContain("marmalade");
    expect(warnings.filter((line) => line.includes("replay"))).toEqual([]);
    expect(infos.filter((line) => line.includes("resumed"))).toHaveLength(1);
  },
);

// A task's first request is its chat's step that started it, then its
// assignment; the chat's process is still waiting on that step's tool call.
it.skipIf(process.env.CLAUDE_ACCOUNT_LIVE !== "1")(
  "forks a task from its chat's transcript where it branched off",
  { timeout: 300_000 },
  async () => {
    const warnings: string[] = [];
    const infos: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((line) => {
      warnings.push(String(line));
    });
    const info = vi.spyOn(console, "info").mockImplementation((line) => {
      infos.push(String(line));
    });
    const model = createClaudeAccountLanguageModel({
      configDir: undefined,
      executablePath: `${homedir()}/.local/bin/claude`,
    })("claude-haiku-4-5");
    const tools: LanguageModelV4FunctionTool[] = [
      {
        description: "Start a background task with an assignment",
        inputSchema: {
          properties: { assignment: { type: "string" } },
          required: ["assignment"],
          type: "object",
        },
        name: "start_task",
        type: "function",
      },
    ];
    const chatKey = `live-chat-${randomUUID()}`;
    async function step(
      prompt: LanguageModelV4Message[],
      claudeAccount: Record<string, string>,
    ) {
      const { stream } = await model.doStream({
        prompt,
        providerOptions: { "claude-account": claudeAccount },
        tools,
      });
      let text = "";
      const calls: string[] = [];
      for await (const part of stream) {
        if (part.type === "error") {
          throw part.error;
        }
        if (part.type === "text-delta") {
          text += part.delta;
        }
        if (part.type === "tool-call") {
          calls.push(part.toolName);
        }
      }
      return { calls, text };
    }

    const chat: LanguageModelV4Message[] = [
      {
        content: `${PROBE_MARKER} Hand any research to a background task with start_task.`,
        role: "system",
      },
      {
        content: [
          {
            text: "The secret word is marmalade. Start a task to look into jam history.",
            type: "text",
          },
        ],
        role: "user",
      },
    ];
    const handOff = await step(chat, { sessionId: chatKey });
    expect(handOff.calls).toContain("start_task");

    const task = await step(
      [
        ...chat,
        {
          content: [
            {
              text: "Actually, skip the task. Just tell me the secret word from my first message, without calling any tool.",
              type: "text",
            },
          ],
          role: "user",
        },
      ],
      { parentSessionId: chatKey, sessionId: `live-task-${randomUUID()}` },
    );
    process.stderr.write(
      `FORKED ${JSON.stringify({ infos, task, warnings })}\n`,
    );
    warn.mockRestore();
    info.mockRestore();
    closeClaudeAccountSessions();

    expect(task.text.toLowerCase()).toContain("marmalade");
    expect(warnings.filter((line) => line.includes("replay"))).toEqual([]);
    expect(infos.filter((line) => line.includes("forked"))).toHaveLength(1);
  },
);

// A call the user stopped comes back as a failed result, with what was said
// next after it, as the user's.
it.skipIf(process.env.CLAUDE_ACCOUNT_LIVE !== "1")(
  "ends the turn on a failed tool result and takes the message after it",
  { timeout: 180_000 },
  async () => {
    const model = createClaudeAccountLanguageModel({
      configDir: undefined,
      executablePath: `${homedir()}/.local/bin/claude`,
    })("claude-haiku-4-5");
    const tools: LanguageModelV4FunctionTool[] = [
      {
        description: "Wait the given number of seconds",
        inputSchema: {
          properties: { seconds: { type: "number" } },
          required: ["seconds"],
          type: "object",
        },
        name: "wait",
        type: "function",
      },
    ];
    const providerOptions = {
      "claude-account": { sessionId: `live-stopped-${randomUUID()}` },
    };
    async function step(prompt: LanguageModelV4Message[]) {
      const { stream } = await model.doStream({
        prompt,
        providerOptions,
        tools,
      });
      let text = "";
      const calls: { input: string; toolCallId: string }[] = [];
      for await (const part of stream) {
        if (part.type === "error") {
          throw part.error;
        }
        if (part.type === "text-delta") {
          text += part.delta;
        }
        if (part.type === "tool-call") {
          calls.push({ input: part.input, toolCallId: part.toolCallId });
        }
      }
      return { calls, text };
    }
    const prompt: LanguageModelV4Message[] = [
      { content: `${PROBE_MARKER} Use the wait tool to wait.`, role: "system" },
      {
        content: [{ text: "Wait 120 seconds with the tool.", type: "text" }],
        role: "user",
      },
    ];
    const first = await step(prompt);
    const [call] = first.calls;
    expect(call).toBeDefined();
    prompt.push(
      {
        content: [
          {
            input: JSON.parse(call?.input ?? "{}") as unknown,
            toolCallId: call?.toolCallId ?? "",
            toolName: "wait",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
      {
        content: [
          {
            output: {
              type: "error-text",
              value:
                "The user stopped this. Do not run it again unless they ask.",
            },
            toolCallId: call?.toolCallId ?? "",
            toolName: "wait",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
      {
        content: [
          { text: "What happened? Answer without any tool.", type: "text" },
        ],
        role: "user",
      },
    );
    const asked = await step(prompt);
    process.stderr.write(`STOPPED ${JSON.stringify(asked)}\n`);
    closeClaudeAccountSessions();
    expect(asked.text.toLowerCase()).toMatch(/stop/);
  },
);
