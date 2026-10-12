import { generateText, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { aiUsageTelemetry, registerAIUsageTelemetry } from "./record";
import { type AIUsageEntry } from "./schema";
import {
  aiUsageCsv,
  closeAIUsageStore,
  insertAIUsage,
  listAIUsage,
  summarizeAIUsage,
} from "./store";

const SECRET = "the words nobody may keep";
const NEWEST_FIRST = { column: "startedAt", direction: "desc" } as const;

let dir: string;
const original = getWorkspaceConfig();

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-usage-test-"));
  setWorkspaceConfig({
    ...original,
    aiUsageFile: AbsolutePathSchema.parse(path.join(dir, "requests.db")),
  });
});

afterEach(async () => {
  closeAIUsageStore();
  setWorkspaceConfig(original);
  await fs.rm(dir, { force: true, recursive: true });
});

/** Every row, after the writes the recorder put off to the next tick. */
async function rows() {
  await new Promise((resolve) => setImmediate(resolve));
  return listAIUsage({ filter: {}, limit: 100, offset: 0, sort: NEWEST_FIRST });
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
      telemetry: aiUsageTelemetry({
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
        telemetry: aiUsageTelemetry({ purpose: "chat-title" }),
      }),
    ).rejects.toThrow();

    expect(await rows()).toMatchObject([
      { error: "upstream 529", status: "failed" },
    ]);
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
      telemetry: aiUsageTelemetry({ purpose: "chat" }),
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
    registerAIUsageTelemetry();
    await generateText({ model: answering(), prompt: "hi" });
    await generateText({
      model: answering(),
      prompt: "hi",
      telemetry: aiUsageTelemetry({ purpose: "chat-title" }),
    });

    expect((await rows()).map((row) => row.purpose).sort()).toEqual([
      "chat-title",
      "other",
    ]);
  });
});

describe("the store", () => {
  const entry = (over: Partial<AIUsageEntry>): AIUsageEntry => ({
    kind: "language",
    purpose: "chat",
    startedAt: Date.UTC(2026, 9, 10, 10),
    status: "finished",
    ...over,
  });

  beforeEach(() => {
    insertAIUsage(
      entry({
        chatId: "c-lisbon",
        inputTokens: 900,
        modelRequested: "sonnet",
        outputTokens: 100,
      }),
    );
    insertAIUsage(
      entry({
        chatId: "c-lisbon",
        inputTokens: 400,
        kind: "decision",
        modelServed: "clef-flash",
        purpose: "emoji-suggestion",
        startedAt: Date.UTC(2026, 9, 10, 11),
      }),
    );
    insertAIUsage(
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
    expect(summarizeAIUsage({ kind: ["decision"] })).toMatchObject({
      requests: 2,
      tokens: 5400,
    });
    expect(
      summarizeAIUsage({ kind: ["decision"], origin: ["chat:c-lisbon"] }),
    ).toMatchObject({ requests: 1, tokens: 400 });
    expect(summarizeAIUsage({ since: Date.UTC(2026, 9, 10) }).requests).toBe(2);
  });

  it("counts each filter's values under every filter but its own", () => {
    const { facets } = summarizeAIUsage({ kind: ["decision"] });
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
    const byTokens = listAIUsage({
      filter: {},
      limit: 10,
      offset: 0,
      sort: { column: "totalTokens", direction: "desc" },
    });
    expect(byTokens.map((row) => row.totalTokens)).toEqual([5000, 1000, 400]);
    const byModel = listAIUsage({
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
    const [header, row, ...rest] = aiUsageCsv({
      purpose: ["settings-search"],
    }).split("\n");
    expect(rest).toEqual([""]);
    expect(header?.split(",").length).toBe(row?.split(",").length);
    // The request id is generated, so the line is compared without it.
    expect(row?.replace(/,[0-9A-Z]{26},/, ",<id>,")).toMatchInlineSnapshot(
      `"2026-10-09T00:00:00.000Z,,finished,decision,settings-search,,,settings,,,clef,5000,,,,,5000,,,<id>,"`,
    );
  });
});
