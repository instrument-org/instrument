import {
  APICallError,
  generateText,
  simulateReadableStream,
  streamText,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { DeviceIdSchema } from "../records/device-id";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { closeWorkspaceDb } from "../workspace-db";
import { lineOf, rowOf } from "./log-file";
import { activityTelemetry, registerActivityTelemetry } from "./record";
import { type ActivityEntry } from "./schema";
import {
  activityCsv,
  insertActivity,
  listActivity,
  summarizeActivity,
} from "./store";

const SECRET = "the words nobody may keep";
const NEWEST_FIRST = { column: "startedAt", direction: "desc" } as const;
const DEVICE = DeviceIdSchema.parse("dev_A1B2C3D4");

let dir: string;
const original = getWorkspaceConfig();

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "activity-test-"));
  setWorkspaceConfig({
    ...original,
    deviceId: DEVICE,
    rootDir: WorkspaceDirSchema.parse(dir),
    workspaceDbFile: AbsolutePathSchema.parse(path.join(dir, "workspace.db")),
  });
});

afterEach(async () => {
  closeWorkspaceDb();
  setWorkspaceConfig(original);
  await fs.rm(dir, { force: true, recursive: true });
});

/** Every row, after the writes the recorder put off to the next tick. */
async function rows() {
  await new Promise((resolve) => setImmediate(resolve));
  return listActivity({
    filter: {},
    limit: 100,
    offset: 0,
    sort: NEWEST_FIRST,
  });
}

const usage = {
  inputTokens: { cacheRead: 30, cacheWrite: 5, noCache: 65, total: 100 },
  outputTokens: { reasoning: 8, text: 12, total: 20 },
};

function answering() {
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ text: SECRET, type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        response: { id: "resp_1", modelId: "served-model" },
        usage,
        warnings: [],
      }),
    modelId: "asked-model",
  });
}

describe("recording through AI SDK telemetry", () => {
  it("writes one row per model call with its usage and the model that answered", async () => {
    await generateText({
      model: answering(),
      prompt: SECRET,
      telemetry: activityTelemetry({
        connection: { displayName: "Mine", id: "c1", type: "openrouter" },
        purpose: "chat-title",
      }),
    });

    const [row, ...rest] = await rows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      cacheReadTokens: 30,
      cacheWriteTokens: 5,
      connectionName: "Mine",
      connectionType: "openrouter",
      finishReason: "stop",
      inputTokens: 100,
      kind: "language",
      modelRequested: "asked-model",
      modelServed: "served-model",
      outputTokens: 20,
      purpose: "chat-title",
      reasoningTokens: 8,
      responseId: "resp_1",
      status: "finished",
      totalTokens: 120,
    });
    // Nothing anyone wrote reaches the record.
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("records a failed call with its error", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () => Promise.reject(new Error("upstream 529")),
    });
    await expect(
      generateText({
        maxRetries: 0,
        model,
        prompt: "hi",
        telemetry: activityTelemetry({ purpose: "chat-title" }),
      }),
    ).rejects.toThrow();

    expect(await rows()).toMatchObject([
      { error: "upstream 529", status: "failed" },
    ]);
  });

  it("records a call a usage limit refused as limited", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () =>
        Promise.reject(
          new APICallError({
            message: "Usage limit reached",
            requestBodyValues: {},
            responseBody: JSON.stringify({
              error: { code: "usage-limit-exceeded" },
            }),
            statusCode: 429,
            url: "https://example.com",
          }),
        ),
    });
    await expect(
      generateText({
        maxRetries: 0,
        model,
        prompt: "hi",
        telemetry: activityTelemetry({ purpose: "chat" }),
      }),
    ).rejects.toThrow();

    expect(await rows()).toMatchObject([{ status: "limited" }]);
  });

  it("records a stream stopped partway as stopped, with no tokens", async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunkDelayInMs: 50,
            chunks: [
              { id: "1", type: "text-start" },
              { delta: "a", id: "1", type: "text-delta" },
              { delta: "b", id: "1", type: "text-delta" },
            ],
          }),
        }),
    });
    const result = streamText({
      abortSignal: controller.signal,
      model,
      prompt: "hi",
      telemetry: activityTelemetry({ purpose: "chat" }),
    });
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        controller.abort();
      }
    }

    expect(await rows()).toMatchObject([
      { inputTokens: null, status: "stopped", totalTokens: null },
    ]);
  });

  it("records a call that names no purpose as Other, once", async () => {
    registerActivityTelemetry();
    await generateText({ model: answering(), prompt: "hi" });
    await generateText({
      model: answering(),
      prompt: "hi",
      telemetry: activityTelemetry({ purpose: "chat-title" }),
    });

    expect((await rows()).map((row) => row.purpose).sort()).toEqual([
      "chat-title",
      "other",
    ]);
  });
});

describe("the store", () => {
  const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
    kind: "language",
    purpose: "chat",
    startedAt: Date.UTC(2026, 9, 10, 10),
    status: "finished",
    ...over,
  });

  beforeEach(() => {
    insertActivity(
      entry({
        chatId: "c-lisbon",
        inputTokens: 900,
        modelRequested: "sonnet",
        outputTokens: 100,
      }),
    );
    insertActivity(
      entry({
        chatId: "c-lisbon",
        inputTokens: 400,
        kind: "decision",
        modelServed: "clef-flash",
        purpose: "emoji-suggestion",
        startedAt: Date.UTC(2026, 9, 10, 11),
      }),
    );
    insertActivity(
      entry({
        inputTokens: 5000,
        kind: "decision",
        modelServed: "clef",
        purpose: "settings-search",
        surface: "settings",
        startedAt: Date.UTC(2026, 9, 9),
      }),
    );
  });

  it("stacks filters and totals what they leave", () => {
    expect(summarizeActivity({ kind: ["decision"] })).toMatchObject({
      requests: 2,
      tokens: 5400,
    });
    expect(
      summarizeActivity({ kind: ["decision"], origin: ["chat:c-lisbon"] }),
    ).toMatchObject({ requests: 1, tokens: 400 });
    expect(summarizeActivity({ since: Date.UTC(2026, 9, 10) }).requests).toBe(
      2,
    );
  });

  it("counts each filter's values under every filter but its own", () => {
    const { facets } = summarizeActivity({ kind: ["decision"] });
    expect(facets.kind).toEqual([
      { count: 2, value: "decision" },
      { count: 1, value: "language" },
    ]);
    expect(facets.origin).toEqual([
      { count: 1, value: "chat:c-lisbon" },
      { count: 1, value: "surface:settings" },
    ]);
  });

  it("sorts by any column, keeping rows with nothing to sort by last", () => {
    const byTokens = listActivity({
      filter: {},
      limit: 10,
      offset: 0,
      sort: { column: "totalTokens", direction: "desc" },
    });
    expect(byTokens.map((row) => row.totalTokens)).toEqual([5000, 1000, 400]);
    const byModel = listActivity({
      filter: {},
      limit: 10,
      offset: 0,
      sort: { column: "model", direction: "asc" },
    });
    expect(byModel.map((row) => row.modelServed ?? row.modelRequested)).toEqual(
      ["clef", "clef-flash", "sonnet"],
    );
  });

  it("exports what the filters show as CSV", () => {
    const [header, row, ...rest] = activityCsv({
      purpose: ["settings-search"],
    }).split("\n");
    expect(rest).toEqual([""]);
    expect(header?.split(",").length).toBe(row?.split(",").length);
    // The request id is generated, so the line is compared without it.
    expect(row?.replace(/,[0-9A-Z]{26},/, ",<id>,")).toMatchInlineSnapshot(
      `"2026-10-09T00:00:00.000Z,,finished,decision,settings-search,,,settings,dev_A1B2C3D4,,,clef,,5000,,,,,5000,,,<id>,"`,
    );
  });
});

describe("the log in the workspace", () => {
  const OTHER = DeviceIdSchema.parse("dev_Z9Y8X7W6");

  const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
    kind: "language",
    purpose: "chat",
    startedAt: Date.UTC(2026, 9, 10, 10),
    status: "finished",
    ...over,
  });

  /** A row as another device would have logged it. */
  const theirs = (id: string, startedAt = Date.UTC(2026, 9, 12)) =>
    lineOf({
      cacheReadTokens: null,
      cacheWriteTokens: null,
      chatId: "c-kyoto",
      connectionName: "Anthropic",
      connectionType: "anthropic",
      device: OTHER,
      durationMs: 600,
      error: null,
      finishReason: "stop",
      id,
      imageQuality: null,
      inputTokens: 1401,
      kind: "language",
      modelRequested: "claude-haiku-5-5",
      modelServed: null,
      outputTokens: 18,
      purpose: "chat-title",
      reasoningTokens: null,
      responseId: "msg_1",
      sessionId: null,
      startedAt,
      status: "finished",
      surface: null,
      totalTokens: 1419,
    });

  it("keeps an image's quality through its line", () => {
    const row = rowOf(theirs("01MIMAGE"), OTHER);
    if (!row) {
      throw new Error("the line did not read back");
    }
    const line = lineOf({ ...row, imageQuality: "low", kind: "image" });
    expect(line).toContain('"imageQuality":"low"');
    expect(rowOf(line, OTHER)?.imageQuality).toBe("low");
    expect(rowOf(theirs("01MTEXT"), OTHER)?.imageQuality).toBeNull();
  });

  const fileOf = (device: string, month: string) =>
    path.join(
      dir,
      ".instrument",
      "devices",
      device,
      "activity",
      `${month}.jsonl`,
    );

  async function writeTheirs(month: string, contents: string) {
    await fs.mkdir(path.dirname(fileOf(OTHER, month)), { recursive: true });
    await fs.appendFile(fileOf(OTHER, month), contents);
  }

  const ids = () =>
    listActivity({
      filter: {},
      limit: 100,
      offset: 0,
      sort: NEWEST_FIRST,
    }).map((row) => `${row.device ?? "none"}:${row.id}`);

  it("appends each request to this device's file for its month, without the connection's id", async () => {
    insertActivity(
      entry({
        connectionName: "Anthropic",
        connectionType: "anthropic",
        inputTokens: 10,
        outputTokens: 2,
      }),
    );

    const [line] = (await fs.readFile(fileOf(DEVICE, "2026-10"), "utf8"))
      .trim()
      .split("\n");
    expect(JSON.parse(line ?? "")).toMatchObject({
      at: "2026-10-10T10:00:00.000Z",
      connection: { name: "Anthropic", type: "anthropic" },
      kind: "language",
      purpose: "chat",
      status: "finished",
      tokens: { input: 10, output: 2, total: 12 },
    });
    expect(line).not.toContain("connectionId");
    expect(line).not.toContain("null");
  });

  it.each([
    [
      "the last moment of October",
      Date.UTC(2026, 9, 31, 23, 59, 59),
      "2026-10",
    ],
    ["the first of November", Date.UTC(2026, 10, 1), "2026-11"],
  ])("files a request at %s under %s", async (_when, startedAt, month) => {
    insertActivity(entry({ startedAt }));

    expect(await fs.readdir(path.dirname(fileOf(DEVICE, month)))).toEqual([
      `${month}.jsonl`,
    ]);
  });

  it("reads every device's files into the index, and rebuilds it from them", async () => {
    insertActivity(entry({}));
    await writeTheirs("2026-10", theirs("01THEIRS0000000000000000A"));
    await writeTheirs(
      "2026-09",
      theirs("01THEIRS0000000000000000B", Date.UTC(2026, 8, 1)),
    );

    expect(ids()).toHaveLength(3);
    expect(ids().filter((id) => id.startsWith(OTHER))).toEqual([
      `${OTHER}:01THEIRS0000000000000000A`,
      `${OTHER}:01THEIRS0000000000000000B`,
    ]);

    closeWorkspaceDb();
    await fs.rm(path.join(dir, "workspace.db"));

    expect(ids()).toHaveLength(3);
  });

  it("reads only what a file gained, once per line", async () => {
    await writeTheirs("2026-10", theirs("01THEIRS0000000000000000A"));
    expect(ids()).toHaveLength(1);

    await writeTheirs("2026-10", theirs("01THEIRS0000000000000000B"));
    // A sync engine's second copy of a line already read changes nothing.
    await writeTheirs("2026-10", theirs("01THEIRS0000000000000000A"));

    expect(ids().toSorted()).toEqual([
      `${OTHER}:01THEIRS0000000000000000A`,
      `${OTHER}:01THEIRS0000000000000000B`,
    ]);
  });

  it("leaves a last line with no newline yet until it is whole", async () => {
    const line = theirs("01THEIRS0000000000000000B");
    await writeTheirs(
      "2026-10",
      theirs("01THEIRS0000000000000000A") + line.slice(0, 40),
    );
    expect(ids()).toEqual([`${OTHER}:01THEIRS0000000000000000A`]);

    await writeTheirs("2026-10", line.slice(40));

    expect(ids()).toHaveLength(2);
  });
});
