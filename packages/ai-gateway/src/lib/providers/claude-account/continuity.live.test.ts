import {
  type LanguageModelV4FunctionTool,
  type LanguageModelV4Message,
  type LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import {
  closeClaudeAccountSessions,
  createClaudeAccountLanguageModel,
} from "./language-model";

// Carries one chat through what a synced chat meets on the Claude account,
// against the real `claude` CLI and the signed-in account's plan, so it only
// runs when asked: CLAUDE_ACCOUNT_LIVE=1. Each check asks about a picture
// whose color only a model shown that picture can name. Pick the models with
// CLAUDE_CONTINUITY_MODEL and CLAUDE_CONTINUITY_SWITCH_MODEL and the CLI with
// CLAUDE_CONTINUITY_CLI. A JSON report goes to CLAUDE_CONTINUITY_OUT (a temp
// folder when unset).
const live = process.env.CLAUDE_ACCOUNT_LIVE === "1";
const modelId = process.env.CLAUDE_CONTINUITY_MODEL ?? "claude-sonnet-5-5";
const switchModelId =
  process.env.CLAUDE_CONTINUITY_SWITCH_MODEL ?? "claude-haiku-5-5";
const realHome = userInfo().homedir;
const executablePath =
  process.env.CLAUDE_CONTINUITY_CLI ?? `${realHome}/.local/bin/claude`;
const outDir =
  process.env.CLAUDE_CONTINUITY_OUT ??
  join(tmpdir(), `claude-continuity-${Date.now()}`);

const CODE_WORD = "PELICAN-42";

/**
 * Each view's screenshot: a caption naming its badge, and a solid color the
 * caption never names, so only a model shown the picture can say it.
 */
const VIEWS = {
  a: {
    badge: "AMBER-7",
    color: /magenta|fuchsia|pink|purple/i,
    rgb: [255, 0, 255],
  },
  b: { badge: "BIRCH-3", color: /green|lime/i, rgb: [0, 200, 0] },
  c: { badge: "CEDAR-9", color: /orange/i, rgb: [255, 140, 0] },
  d: { badge: "DAHLIA-5", color: /blue/i, rgb: [0, 90, 255] },
  e: { badge: "EBONY-1", color: /yellow|gold/i, rgb: [240, 220, 0] },
  f: { badge: "FERN-2", color: /red|crimson|scarlet/i, rgb: [220, 0, 0] },
  g: {
    badge: "GINKGO-4",
    color: /cyan|teal|turquoise|aqua/i,
    rgb: [0, 200, 200],
  },
} as const;
type ViewName = keyof typeof VIEWS;
const COLOR_WORDS =
  /magenta|fuchsia|pink|purple|green|lime|orange|blue|yellow|gold|red|crimson|scarlet|cyan|teal|turquoise|aqua/i;

const tools: LanguageModelV4FunctionTool[] = [
  {
    description:
      "Take a screenshot of one view of the dashboard. Returns the picture and a caption.",
    inputSchema: {
      properties: {
        view: { enum: Object.keys(VIEWS), type: "string" },
      },
      required: ["view"],
      type: "object",
    },
    name: "screenshot",
    type: "function",
  },
  {
    description: "Look up a fact by key. Returns the fact as text.",
    inputSchema: {
      properties: { key: { type: "string" } },
      required: ["key"],
      type: "object",
    },
    name: "lookup",
    type: "function",
  },
  {
    description: "Start a background task with an assignment.",
    inputSchema: {
      properties: { assignment: { type: "string" } },
      required: ["assignment"],
      type: "object",
    },
    name: "start_task",
    type: "function",
  },
];

/** A solid-color PNG. */
function solidPng(rgb: readonly number[], size = 48) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xff_ff_ff_ff;
    for (const byte of bytes) {
      c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    }
    return (c ^ 0xff_ff_ff_ff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: size }, () => [...rgb]).flat()),
  ]);
  const pixels = deflateSync(
    Buffer.concat(Array.from({ length: size }, () => row)),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function screenshotOf(viewName: string): LanguageModelV4ToolResultOutput {
  const view = viewName in VIEWS ? VIEWS[viewName as ViewName] : VIEWS.a;
  return {
    type: "content",
    value: [
      {
        text: `Screenshot of view ${viewName}. Its status badge reads ${view.badge}.`,
        type: "text",
      },
      {
        data: { data: solidPng(view.rgb), type: "data" },
        mediaType: "image/png",
        type: "file",
      },
    ],
  };
}

function runTool(
  name: string,
  input: Record<string, unknown>,
): LanguageModelV4ToolResultOutput {
  switch (name) {
    case "screenshot": {
      return screenshotOf(String(input.view));
    }
    case "lookup": {
      return {
        type: "text",
        value: `The fact for ${String(input.key)} is: the server room is on floor 9.`,
      };
    }
    default: {
      return { type: "text", value: "Started." };
    }
  }
}

/**
 * What one Mac keeps of a chat's Claude Code sessions outside our records:
 * the resume records in the config folder, and the transcripts Claude Code
 * files under the home folder its processes run in, beside the user's own
 * sessions started there. A transcript is this test's when it ever held
 * `marker`, which the chat's first message carries, and a record is this
 * test's when its transcript is; nothing else is touched. Moving both aside
 * is what leaving a Mac looks like to the next one; moving them back is
 * coming home to it.
 */
function localState(marker: string) {
  const records = join(realHome, ".claude", "instrument-sessions");
  const project = join(
    realHome,
    ".claude",
    "projects",
    realpathSync(realHome).replaceAll(/[^a-zA-Z0-9]/g, "-"),
  );
  const sessionIds = new Set<string>();
  const entries = () => (existsSync(project) ? readdirSync(project) : []);
  const ours = () => {
    for (const name of entries()) {
      if (
        name.endsWith(".jsonl") &&
        readFileSync(join(project, name), "utf8").includes(marker)
      ) {
        sessionIds.add(name.replace(/\.jsonl$/, ""));
      }
    }
    // A session's folder of tool results, if Claude Code made one, goes
    // with its transcript.
    const transcripts = entries().filter((name) =>
      sessionIds.has(name.replace(/\.jsonl$/, "")),
    );
    const recordNames = (
      existsSync(records) ? readdirSync(records) : []
    ).filter((name) => {
      try {
        const { claudeSessionId } = z
          .object({ claudeSessionId: z.string() })
          .parse(JSON.parse(readFileSync(join(records, name), "utf8")));
        return sessionIds.has(claudeSessionId);
      } catch {
        return false;
      }
    });
    return {
      records: recordNames.map((name) => join(records, name)),
      transcripts: transcripts.map((name) => join(project, name)),
    };
  };
  const move = (from: string[], to: string) => {
    mkdirSync(to, { recursive: true });
    for (const path of from) {
      renameSync(path, join(to, path.split("/").at(-1) ?? ""));
    }
  };
  const restore = (from: string, to: string) => {
    if (!existsSync(from)) {
      return;
    }
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      renameSync(join(from, name), join(to, name));
    }
    rmSync(from, { force: true, recursive: true });
  };
  /**
   * Waits for closed processes to finish writing: Claude Code appends its
   * last entries as it exits, after `close` returns, and would recreate a
   * transcript moved away before then.
   */
  const settle = async () => {
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
  };
  return {
    settle,
    /** Puts this Mac's files away under `device`, as if on another Mac. */
    async leave(device: string) {
      await settle();
      const { records: recordPaths, transcripts } = ours();
      move(recordPaths, join(outDir, "devices", device, "records"));
      move(transcripts, join(outDir, "devices", device, "project"));
    },
    /** Brings `device`'s files back, as they were when it was left. */
    async arrive(device: string) {
      await settle();
      restore(join(outDir, "devices", device, "records"), records);
      restore(join(outDir, "devices", device, "project"), project);
    },
    /** The transcript the newest of this test's resume records names. */
    newestTranscript() {
      const newest = ours()
        .records.toSorted((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
        .map((path) => ({
          path,
          sessionId: z
            .object({ claudeSessionId: z.string() })
            .parse(JSON.parse(readFileSync(path, "utf8"))).claudeSessionId,
        }))
        .at(-1);
      return newest && join(project, `${newest.sessionId}.jsonl`);
    },
    /** Removes every file of this test's, on every device. */
    async clear() {
      await settle();
      const { records: recordPaths, transcripts } = ours();
      for (const path of [...recordPaths, ...transcripts]) {
        rmSync(path, { force: true, recursive: true });
      }
      rmSync(join(outDir, "devices"), { force: true, recursive: true });
    },
  };
}

interface StepReport {
  cacheRead: number;
  cacheWrite: number;
  error?: string;
  finish: string;
  firstPartMs: number;
  label: string;
  model: string;
  noCache: number;
  output: number;
  path: string[];
  reasoningSigned: number;
  text: string;
  toolCalls: string[];
  totalMs: number;
}

it.skipIf(!live)(
  "a synced chat on the Claude account",
  { timeout: 1_800_000 },
  async () => {
    mkdirSync(outDir, { recursive: true });
    const chatKey = `continuity-${randomUUID()}`;
    const state = localState(chatKey);

    const logs: string[] = [];
    const capture = (line: unknown) => {
      logs.push(String(line));
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(capture);
    const info = vi.spyOn(console, "info").mockImplementation(capture);
    const models = {
      main: createClaudeAccountLanguageModel({
        configDir: undefined,
        executablePath,
      })(modelId),
      switched: createClaudeAccountLanguageModel({
        configDir: undefined,
        executablePath,
      })(switchModelId),
    };
    const reports: StepReport[] = [];

    async function step(
      label: string,
      prompt: LanguageModelV4Message[],
      {
        claudeAccount = { sessionId: chatKey },
        model = models.main,
      }: {
        claudeAccount?: Record<string, string>;
        model?: (typeof models)["main"];
      } = {},
    ) {
      const logStart = logs.length;
      const started = performance.now();
      let firstPartMs = -1;
      const { stream } = await model.doStream({
        prompt,
        providerOptions: { "claude-account": claudeAccount },
        tools,
      });
      const report: StepReport = {
        cacheRead: 0,
        cacheWrite: 0,
        finish: "",
        firstPartMs: 0,
        label,
        model: model.modelId,
        noCache: 0,
        output: 0,
        path: [],
        reasoningSigned: 0,
        text: "",
        toolCalls: [],
        totalMs: 0,
      };
      const assistant: Extract<LanguageModelV4Message, { role: "assistant" }> =
        {
          content: [],
          role: "assistant",
        };
      const reasoning = new Map<string, string>();
      for await (const part of stream) {
        if (
          firstPartMs < 0 &&
          (part.type === "text-delta" ||
            part.type === "reasoning-delta" ||
            part.type === "tool-input-start")
        ) {
          firstPartMs = performance.now() - started;
        }
        switch (part.type) {
          case "error": {
            report.error = String(part.error);
            break;
          }
          case "text-delta": {
            report.text += part.delta;
            break;
          }
          case "reasoning-start": {
            reasoning.set(part.id, "");
            break;
          }
          case "reasoning-delta": {
            reasoning.set(part.id, (reasoning.get(part.id) ?? "") + part.delta);
            break;
          }
          case "reasoning-end": {
            if (part.providerMetadata?.["claude-account"]) {
              report.reasoningSigned++;
            }
            assistant.content.push({
              providerOptions: part.providerMetadata,
              text: reasoning.get(part.id) ?? "",
              type: "reasoning",
            });
            break;
          }
          case "tool-call": {
            report.toolCalls.push(part.toolName);
            assistant.content.push({
              input: JSON.parse(part.input) as unknown,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              type: "tool-call",
            });
            break;
          }
          case "finish": {
            report.finish = part.finishReason.unified;
            report.cacheRead = part.usage.inputTokens.cacheRead ?? 0;
            report.cacheWrite = part.usage.inputTokens.cacheWrite ?? 0;
            report.noCache = part.usage.inputTokens.noCache ?? 0;
            report.output = part.usage.outputTokens.total ?? 0;
            break;
          }
          default: {
            break;
          }
        }
      }
      if (report.text) {
        assistant.content.push({ text: report.text, type: "text" });
      }
      report.firstPartMs = Math.round(firstPartMs);
      report.totalMs = Math.round(performance.now() - started);
      report.path = logs
        .slice(logStart)
        .filter((line) => line.includes("[claude-account]"))
        .map((line) => line.replace(/^\[claude-account\] session \S+ /, ""));
      reports.push(report);
      return { assistant, report };
    }

    /** Runs steps until the model stops calling tools, answering each call. */
    async function turn(
      label: string,
      prompt: LanguageModelV4Message[],
      {
        between,
        model,
      }: {
        between?: (stepIndex: number) => void;
        model?: (typeof models)["main"];
      } = {},
    ) {
      const first = reports.length;
      for (let index = 0; index < 6; index++) {
        const { assistant, report } = await step(`${label}#${index}`, prompt, {
          model,
        });
        prompt.push(assistant);
        if (report.error || report.finish !== "tool-calls") {
          return {
            ...report,
            path: reports.slice(first).flatMap((r) => r.path),
          };
        }
        between?.(index);
        prompt.push({
          content: assistant.content.flatMap((part) =>
            part.type === "tool-call"
              ? [
                  {
                    output: runTool(
                      part.toolName,
                      (part.input ?? {}) as Record<string, unknown>,
                    ),
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    type: "tool-result" as const,
                  },
                ]
              : [],
          ),
          role: "tool",
        });
      }
      throw new Error(`${label} ran past six steps`);
    }

    const user = (text: string): LanguageModelV4Message => ({
      content: [{ text, type: "text" }],
      role: "user",
    });
    const colorOf = (view: ViewName) =>
      `the dominant color of the picture in view ${view}'s screenshot (look at the picture itself; its caption does not say)`;
    const ask = (question: string) =>
      user(`Without calling any tool, answer in one line: ${question}.`);
    const checks: Record<
      string,
      { ok: boolean; path: string[]; text: string }
    > = {};
    const check = (
      name: string,
      report: { path: string[]; text: string },
      ok: boolean,
      route?: RegExp,
    ) => {
      // A step the running process continues logs no route.
      const routed =
        route === undefined
          ? report.path.length === 0
          : report.path.some((line) => route.test(line));
      checks[name] = { ok: ok && routed, path: report.path, text: report.text };
      expect.soft(ok, `${name}: ${report.text}`).toBe(true);
      expect
        .soft(routed, `${name} route: ${report.path.join(" | ")}`)
        .toBe(true);
    };

    try {
      const prompt: LanguageModelV4Message[] = [
        {
          content:
            "You are Pebble, a terse assistant. Call tools when asked. Keep answers to one or two lines.",
          role: "system",
        },
        user(
          `(Test run ${chatKey}.) The code word is ${CODE_WORD}. Take screenshots of views a, b, c and e with the screenshot tool, one call each. Then reply with only the four badge texts. Do not describe the pictures.`,
        ),
      ];
      const first = await turn("1-tool-turn", prompt);

      // Quitting the app, or an idle timeout, ends the process; its transcript
      // is still on this Mac.
      closeClaudeAccountSessions();
      prompt.push(
        ask(`the code word from my first message, and ${colorOf("a")}`),
      );
      const restart = await turn("2-restart", prompt);
      check(
        "restart",
        restart,
        restart.text.includes(CODE_WORD) && VIEWS.a.color.test(restart.text),
        /resumed its Claude Code transcript/,
      );

      // A Claude Code that writes its transcript in a shape this build does
      // not read.
      closeClaudeAccountSessions();
      await state.settle();
      const transcript = state.newestTranscript();
      if (transcript !== undefined && existsSync(transcript)) {
        writeFileSync(
          transcript,
          readFileSync(transcript, "utf8").replaceAll('"message":', '"msg":'),
        );
      }
      prompt.push(ask(colorOf("e")));
      const drift = await turn("3-drifted-transcript", prompt);
      check(
        "drift",
        drift,
        VIEWS.e.color.test(drift.text),
        /started from a native replay/,
      );

      // Mac B: the chat's records synced, nothing of Mac A's Claude Code did.
      // It answers about A's pictures and takes one of its own.
      closeClaudeAccountSessions();
      await state.leave("mac-a");
      prompt.push(
        user(
          `First, without tools: ${colorOf("b")}. Then take a screenshot of view f and reply with its badge text only. Do not describe it.`,
        ),
      );
      const macB = await turn("4-mac-b", prompt);
      check(
        "mac B",
        macB,
        VIEWS.b.color.test(macB.text) && macB.text.includes(VIEWS.f.badge),
        /started from a native replay/,
      );

      // Back on Mac A, whose resume record and transcript stop before B's
      // turn: resuming them would lose it.
      closeClaudeAccountSessions();
      await state.leave("mac-b");
      await state.arrive("mac-a");
      prompt.push(ask(colorOf("f")));
      const backOnA = await turn("5-back-on-mac-a", prompt);
      check(
        "back on A",
        backOnA,
        VIEWS.f.color.test(backOnA.text),
        /restarted from a native replay/,
      );

      // While A's process still runs, a turn arrives from another Mac whose
      // chat ran on another provider, on Windows: a foreign tool call id, a
      // Windows path, and a picture.
      const foreignCall = "functions.screenshot:0";
      prompt.push(
        user("Take a screenshot of view g."),
        {
          content: [
            { text: "Taking it.", type: "text" },
            {
              input: { view: "g" },
              toolCallId: foreignCall,
              toolName: "screenshot",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
        {
          content: [
            {
              output: {
                type: "content",
                value: [
                  {
                    text: `Saved to C:\\Users\\pebble\\Pictures\\view-g.png\r\nIts status badge reads ${VIEWS.g.badge}.`,
                    type: "text",
                  },
                  {
                    data: { data: solidPng(VIEWS.g.rgb), type: "data" },
                    mediaType: "image/png",
                    type: "file",
                  },
                ],
              },
              toolCallId: foreignCall,
              toolName: "screenshot",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
        { content: [{ text: "Done.", type: "text" }], role: "assistant" },
        ask(`the badge text of view g, and ${colorOf("g")}`),
      );
      const foreign = await turn("6-windows-provider-turn", prompt);
      check(
        "foreign turn",
        foreign,
        foreign.text.includes(VIEWS.g.badge) &&
          VIEWS.g.color.test(foreign.text),
        /restarted from a native replay/,
      );

      // The chat's model changes while its process runs.
      prompt.push(ask(`the code word, and ${colorOf("c")}`));
      const switchedLive = await turn("7-model-switch-live", prompt, {
        model: models.switched,
      });
      check(
        "model switch, live",
        switchedLive,
        switchedLive.text.includes(CODE_WORD) &&
          VIEWS.c.color.test(switchedLive.text),
      );

      // Mac C, on the switched model, with Claude's signed thinking from the
      // other model in the records.
      closeClaudeAccountSessions();
      await state.leave("mac-a2");
      prompt.push(ask(colorOf("b")));
      const switchedCold = await turn("8-model-switch-mac-c", prompt, {
        model: models.switched,
      });
      check(
        "model switch, Mac C",
        switchedCold,
        VIEWS.b.color.test(switchedCold.text),
        /started from a native replay/,
      );

      // Home to A and the first model; the process ends while our loop runs a
      // tool, as a crash or quit would.
      closeClaudeAccountSessions();
      await state.leave("mac-c");
      await state.arrive("mac-a2");
      prompt.push(
        user(
          `Take a screenshot of view d, then tell me its badge text and ${colorOf("d")}.`,
        ),
      );
      const midLoop = await turn("9-restart-mid-tool-loop", prompt, {
        between: () => {
          closeClaudeAccountSessions();
        },
      });
      check(
        "mid tool loop",
        midLoop,
        midLoop.text.includes(VIEWS.d.badge) &&
          VIEWS.d.color.test(midLoop.text),
        /native replay/,
      );

      // A task forked from the chat's step that started it: that step's
      // input, then the task's assignment.
      prompt.push(
        user(
          "Start a background task to research jam history with start_task. Do nothing else.",
        ),
      );
      const handOffInput = [...prompt];
      const handOff = await step("10-hand-off", prompt);
      prompt.push(handOff.assistant);
      const task = await step(
        "11-task-first-step",
        [
          ...handOffInput,
          user(
            `You are task t1. Before anything else, without tools, answer in one line: the code word, and ${colorOf("f")}.`,
          ),
        ],
        {
          claudeAccount: {
            parentSessionId: chatKey,
            sessionId: `${chatKey}-t1`,
          },
        },
      );
      check(
        "task fork",
        task.report,
        task.report.text.includes(CODE_WORD) &&
          VIEWS.f.color.test(task.report.text),
        /forked its parent's Claude Code transcript|native replay/,
      );

      const summary = {
        checks: Object.fromEntries(
          Object.entries(checks).map(([name, { ok }]) => [name, ok]),
        ),
        cli: executablePath,
        // A color said before it was asked for would let a later answer copy it.
        leaked: COLOR_WORDS.test(first.text),
        models: [modelId, switchModelId],
      };
      writeFileSync(
        join(outDir, "report.json"),
        JSON.stringify({ checks, logs, reports, summary }, null, 2),
      );
      process.stderr.write(`CONTINUITY ${JSON.stringify(summary)}\n`);
      for (const report of reports) {
        process.stderr.write(
          `  ${report.label.padEnd(28)} ${report.model.padEnd(18)} first=${report.firstPartMs}ms read=${report.cacheRead} write=${report.cacheWrite} new=${report.noCache} signed=${report.reasoningSigned} ${report.error ? `ERROR ${report.error.slice(0, 160)}` : ""} ${report.path.join(" | ")}\n`,
        );
      }
      expect(reports.filter((report) => report.error)).toEqual([]);
    } finally {
      closeClaudeAccountSessions();
      warn.mockRestore();
      info.mockRestore();
      await state.clear();
    }
  },
);
