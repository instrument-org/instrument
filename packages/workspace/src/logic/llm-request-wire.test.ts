/**
 * Records the exact request bodies our agent path sends each provider, for
 * diffing two builds against each other. It exists for dependency upgrades
 * (the AI SDK and its providers) where the question is whether anything we
 * send upstream changed.
 *
 * Every case runs the real path: stored session -> `prepareModelMessages` ->
 * `fetchAISDKModel` -> the provider's own SDK -> `streamText` with the full
 * tool set and our provider options. Only `fetch` is replaced: it records the
 * request and answers with a minimal stream in that provider's format.
 *
 * Skipped unless WIRE_CAPTURE_DIR is set. To compare two checkouts, run it in
 * each and diff the output:
 *
 *   WIRE_CAPTURE_DIR=/tmp/wire-a pnpm --filter @instrument-org/workspace exec vitest run src/logic/llm-request-wire.test.ts
 *   (same in the other checkout with /tmp/wire-b)
 *   diff -ru /tmp/wire-a /tmp/wire-b
 */
import {
  type AIGatewayModel,
  AIGatewayModelURI,
  CLIENT_SESSION_ID_HEADER,
} from "@instrument-org/ai-gateway";
import { type AIProviderType } from "@instrument-org/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AnyActorRef, createActor, waitFor } from "xstate";

import { generateTitleFromUserMessage } from "../lib/generate-title-from-user-message";
import { Store } from "../lib/store";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { TOOLS } from "../tools/all";
import { llmRequestLogic } from "./llm-request";
import { setWorkspaceServerPort } from "./server/url";

vi.mock(import("ulid"));
vi.mock(import("../lib/session-store-storage"));
vi.mock(import("../lib/get-current-date"));

const captureDir = process.env.WIRE_CAPTURE_DIR;

interface Target {
  author: string;
  name: string;
  provider: AIProviderType;
  providerId: string;
  /** Reasoning metadata as a stored session holds it for this provider. */
  reasoningMetadata?: Record<string, Record<string, unknown>>;
}

const TARGETS: Target[] = [
  {
    author: "anthropic",
    name: "instrument-claude",
    provider: "instrument",
    providerId: "anthropic/claude-sonnet-4.5",
    reasoningMetadata: {
      openrouter: {
        reasoning_details: [
          {
            format: "anthropic-claude-v1",
            index: 0,
            signature: "sig-openrouter",
            text: "Thinking about the file.",
            type: "reasoning.text",
          },
        ],
      },
    },
  },
  {
    author: "openai",
    name: "instrument-gpt",
    provider: "instrument",
    providerId: "openai/gpt-5.1",
    reasoningMetadata: {
      openrouter: {
        reasoning_details: [
          {
            data: "enc-openrouter",
            format: "openai-responses-v1",
            id: "rs_or",
            index: 0,
            type: "reasoning.encrypted",
          },
        ],
      },
    },
  },
  {
    author: "anthropic",
    name: "anthropic",
    provider: "anthropic",
    providerId: "claude-sonnet-4-5",
    reasoningMetadata: { anthropic: { signature: "sig-anthropic" } },
  },
  {
    author: "openai",
    name: "openai",
    provider: "openai",
    providerId: "gpt-5.1",
    reasoningMetadata: {
      openai: { itemId: "rs_1", reasoningEncryptedContent: "enc-openai" },
    },
  },
  {
    author: "google",
    name: "google",
    provider: "google",
    providerId: "gemini-2.5-pro",
    reasoningMetadata: { google: { thoughtSignature: "sig-google" } },
  },
  {
    author: "x-ai",
    name: "xai",
    provider: "x-ai",
    providerId: "grok-4",
  },
  {
    author: "qwen",
    name: "lmstudio",
    provider: "lmstudio",
    providerId: "qwen3-8b",
  },
  {
    author: "meta",
    name: "ollama",
    provider: "ollama",
    providerId: "llama3.2",
  },
];

// 1x1 PNG, so image normalization has a real image to measure and leaves it.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PDF_BASE64 = Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64");

interface RecordedRequest {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  url: string;
}

let recorded: RecordedRequest[] = [];

// Headers that differ by run or by build without changing what the provider
// is asked: credentials, and the SDK's own version stamp.
const DROPPED_HEADERS = new Set([
  "authorization",
  "user-agent",
  "x-api-key",
  "x-goog-api-key",
]);

// Replaced per run by ulid's mock, whose sequence depends on the cases before.
const NORMALIZED_HEADERS = new Set([CLIENT_SESSION_ID_HEADER.toLowerCase()]);

const realFetch = globalThis.fetch;

type Scenario = (context: {
  model: AIGatewayModel.Type;
  sessionId: StoreId.Session;
  target: Target;
}) => SessionMessage.WithParts[];

function assistantMessage(
  sessionId: StoreId.Session,
  model: AIGatewayModel.Type,
  finishReason: "stop" | "tool-calls",
  build: (meta: () => ReturnType<typeof partMetadata>) => unknown[],
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return SessionMessage.WithPartsSchema.parse({
    id,
    metadata: {
      aiGatewayModel: model,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      finishReason,
      modelId: model.canonicalId,
      providerId: model.params.provider,
      sessionId,
    },
    parts: [
      { metadata: stepStartMetadata(id, sessionId), type: "step-start" },
      ...build(() => partMetadata(id, sessionId)),
    ],
    role: "assistant",
  });
}

function cannedResponse(pathname: string) {
  const stream = (body: string, type = "text/event-stream") =>
    new Response(body, { headers: { "content-type": type }, status: 200 });

  if (pathname.endsWith("/chat/completions")) {
    const chunk = {
      choices: [{ delta: { content: "ok", role: "assistant" }, index: 0 }],
      created: 0,
      id: "chatcmpl-1",
      model: "m",
      object: "chat.completion.chunk",
    };
    return stream(
      sse([
        chunk,
        {
          ...chunk,
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
        },
      ]) + "data: [DONE]\n\n",
    );
  }
  if (pathname.endsWith("/responses")) {
    return stream(
      sse([
        {
          response: {
            created_at: 0,
            id: "resp_1",
            model: "m",
            object: "response",
            output: [],
            service_tier: null,
            status: "in_progress",
          },
          sequence_number: 0,
          type: "response.created",
        },
        {
          item: {
            content: [],
            id: "msg_1",
            role: "assistant",
            status: "in_progress",
            type: "message",
          },
          output_index: 0,
          sequence_number: 1,
          type: "response.output_item.added",
        },
        {
          content_index: 0,
          delta: "ok",
          item_id: "msg_1",
          logprobs: [],
          output_index: 0,
          sequence_number: 2,
          type: "response.output_text.delta",
        },
        {
          item: {
            content: [{ annotations: [], text: "ok", type: "output_text" }],
            id: "msg_1",
            role: "assistant",
            status: "completed",
            type: "message",
          },
          output_index: 0,
          sequence_number: 3,
          type: "response.output_item.done",
        },
        {
          response: {
            created_at: 0,
            id: "resp_1",
            incomplete_details: null,
            model: "m",
            object: "response",
            output: [
              {
                content: [{ annotations: [], text: "ok", type: "output_text" }],
                id: "msg_1",
                role: "assistant",
                status: "completed",
                type: "message",
              },
            ],
            service_tier: null,
            status: "completed",
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 2,
            },
          },
          sequence_number: 4,
          type: "response.completed",
        },
      ]),
    );
  }
  if (pathname.endsWith("/messages")) {
    return stream(
      sse(
        [
          {
            message: {
              content: [],
              id: "msg_1",
              model: "m",
              role: "assistant",
              stop_reason: null,
              stop_sequence: null,
              type: "message",
              usage: { input_tokens: 1, output_tokens: 1 },
            },
            type: "message_start",
          },
          {
            content_block: { text: "", type: "text" },
            index: 0,
            type: "content_block_start",
          },
          {
            delta: { text: "ok", type: "text_delta" },
            index: 0,
            type: "content_block_delta",
          },
          { index: 0, type: "content_block_stop" },
          {
            delta: { stop_reason: "end_turn", stop_sequence: null },
            type: "message_delta",
            usage: { output_tokens: 1 },
          },
          { type: "message_stop" },
        ],
        true,
      ),
    );
  }
  if (pathname.includes(":streamGenerateContent")) {
    return stream(
      sse([
        {
          candidates: [
            {
              content: { parts: [{ text: "ok" }], role: "model" },
              finishReason: "STOP",
              index: 0,
            },
          ],
          usageMetadata: {
            candidatesTokenCount: 1,
            promptTokenCount: 1,
            totalTokenCount: 2,
          },
        },
      ]),
    );
  }
  if (pathname.endsWith("/api/chat")) {
    const base = { created_at: "2026-01-01T00:00:00Z", model: "m" };
    return stream(
      [
        { ...base, done: false, message: { content: "ok", role: "assistant" } },
        {
          ...base,
          done: true,
          done_reason: "stop",
          eval_count: 1,
          eval_duration: 1,
          load_duration: 1,
          message: { content: "", role: "assistant" },
          prompt_eval_count: 1,
          prompt_eval_duration: 1,
          total_duration: 1,
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
      "application/x-ndjson",
    );
  }
  return new Response(JSON.stringify({ error: `unhandled ${pathname}` }), {
    headers: { "content-type": "application/json" },
    status: 404,
  });
}

function modelFor(target: Target): AIGatewayModel.Type {
  const model = createMockAIGatewayModel({
    author: target.author,
    canonicalId: target.providerId.replace(/^[^/]+\//, ""),
    features: ["inputFile", "inputImage", "inputText", "outputText", "tools"],
    provider: target.provider,
    providerConfigId: `${target.name}-config`,
    providerId: target.providerId,
  });
  return {
    ...model,
    reasoning: {
      efforts: ["low", "medium", "high"],
      enabledByDefault: true,
      mandatory: false,
    },
    uri: AIGatewayModelURI.fromModel(model),
  };
}

function partMetadata(messageId: StoreId.Message, sessionId: StoreId.Session) {
  return {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    endedAt: new Date("2026-01-01T00:00:01.000Z"),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  };
}

function recordingFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  // An SDK that downloads a `data:` URL itself is decoding, not calling out.
  if (url.protocol === "data:") {
    return realFetch(input, init);
  }
  return request.text().then((text) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers) {
      if (NORMALIZED_HEADERS.has(key)) {
        headers[key] = "<normalized>";
      } else if (!DROPPED_HEADERS.has(key)) {
        headers[key] = value;
      }
    }
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Recorded as text.
    }
    recorded.push({
      body,
      headers,
      method: request.method,
      url: `${url.pathname.replace(/^.*\/providers\/[^/]+/, "<provider>")}${url.search}`,
    });
    return cannedResponse(url.pathname);
  });
}

function sse(events: unknown[], named = false) {
  return events
    .map((event) => {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      return named && typeof event === "object" && event && "type" in event
        ? `event: ${String(event.type)}\n${data}`
        : data;
    })
    .join("");
}

function stepStartMetadata(
  messageId: StoreId.Message,
  sessionId: StoreId.Session,
) {
  return { ...partMetadata(messageId, sessionId), stepCount: 1 };
}

function userMessage(
  sessionId: StoreId.Session,
  build: (meta: () => ReturnType<typeof partMetadata>) => unknown[],
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  // Parsed like a stored row, so a fixture that drifts from the schema fails
  // here rather than sending something no session could hold.
  return SessionMessage.WithPartsSchema.parse({
    id,
    metadata: { createdAt: new Date("2026-01-01T00:00:00.000Z"), sessionId },
    parts: build(() => partMetadata(id, sessionId)),
    role: "user",
  });
}

const text = (meta: () => ReturnType<typeof partMetadata>, value: string) => ({
  metadata: meta(),
  state: "done",
  text: value,
  type: "text",
});

const SCENARIOS: Record<string, Scenario> = {
  "images-and-files": ({ model, sessionId }) => [
    userMessage(sessionId, (meta) => [
      text(meta, "What is in these?"),
      {
        filename: "pixel.png",
        mediaType: "image/png",
        metadata: meta(),
        type: "file",
        url: `data:image/png;base64,${PNG_BASE64}`,
      },
      {
        filename: "doc.pdf",
        mediaType: "application/pdf",
        metadata: meta(),
        type: "file",
        url: `data:application/pdf;base64,${PDF_BASE64}`,
      },
    ]),
    assistantMessage(sessionId, model, "tool-calls", (meta) => [
      {
        input: { explanation: "Reading the image", filePath: "pixel.png" },
        metadata: meta(),
        output: {
          base64Data: PNG_BASE64,
          filePath: "pixel.png",
          height: 1,
          mimeType: "image/png",
          modifiedAt: 0,
          state: "image",
          width: 1,
        },
        state: "output-available",
        toolCallId: "call_image",
        type: "tool-read_file",
      },
      {
        input: { explanation: "Reading the PDF", filePath: "doc.pdf" },
        metadata: meta(),
        output: {
          base64Data: PDF_BASE64,
          filePath: "doc.pdf",
          mimeType: "application/pdf",
          modifiedAt: 0,
          state: "pdf",
        },
        state: "output-available",
        toolCallId: "call_pdf",
        type: "tool-read_file",
      },
    ]),
    assistantMessage(sessionId, model, "stop", (meta) => [
      text(meta, "A pixel and an empty PDF."),
    ]),
    userMessage(sessionId, (meta) => [text(meta, "Thanks.")]),
  ],
  "plain-text": ({ sessionId }) => [
    userMessage(sessionId, (meta) => [text(meta, "Say hello.")]),
  ],
  "reasoning-replay": ({ model, sessionId, target }) => [
    userMessage(sessionId, (meta) => [text(meta, "Read notes.md.")]),
    assistantMessage(sessionId, model, "tool-calls", (meta) => [
      {
        metadata: meta(),
        ...(target.reasoningMetadata
          ? { providerMetadata: target.reasoningMetadata }
          : {}),
        state: "done",
        text: "Thinking about the file.",
        type: "reasoning",
      },
      {
        input: { explanation: "Reading the notes", filePath: "notes.md" },
        metadata: meta(),
        output: {
          content: "# Notes\nShip it.",
          displayedLines: 2,
          filePath: "notes.md",
          hasMoreLines: false,
          modifiedAt: 0,
          offset: 1,
          state: "exists",
          totalLines: 2,
          truncatedByBytes: false,
        },
        state: "output-available",
        toolCallId: "call_notes",
        type: "tool-read_file",
      },
    ]),
    assistantMessage(sessionId, model, "stop", (meta) => [
      {
        metadata: meta(),
        ...(target.reasoningMetadata
          ? { providerMetadata: target.reasoningMetadata }
          : {}),
        state: "done",
        text: "The notes say to ship.",
        type: "reasoning",
      },
      text(meta, "The notes say: ship it."),
    ]),
    userMessage(sessionId, (meta) => [text(meta, "And then?")]),
  ],
  "tool-calls-and-errors": ({ model, sessionId }) => [
    userMessage(sessionId, (meta) => [text(meta, "Run the tests.")]),
    assistantMessage(sessionId, model, "tool-calls", (meta) => [
      text(meta, "Running them."),
      {
        input: {
          command: "pnpm test",
          explanation: "Running the tests",
          timeoutMs: 120_000,
        },
        metadata: meta(),
        output: {
          command: "pnpm test",
          commands: ["pnpm"],
          durationMs: 1200,
          exitCode: 0,
          output: "all green",
        },
        state: "output-available",
        toolCallId: "call_bash_ok",
        type: "tool-bash",
      },
    ]),
    assistantMessage(sessionId, model, "tool-calls", (meta) => [
      {
        errorText: "Command timed out after 120000ms",
        input: {
          command: "pnpm e2e",
          explanation: "Running end-to-end tests",
          timeoutMs: 120_000,
        },
        metadata: meta(),
        state: "output-error",
        toolCallId: "call_bash_error",
        type: "tool-bash",
      },
      {
        errorText:
          "Invalid input for tool read_file: Type validation failed: Value: {}.",
        input: {},
        metadata: meta(),
        rawInput: {},
        state: "output-error",
        toolCallId: "call_invalid",
        type: "tool-read_file",
      },
    ]),
    assistantMessage(sessionId, model, "stop", (meta) => [
      text(meta, "Unit tests pass; end-to-end timed out."),
    ]),
    userMessage(sessionId, (meta) => [text(meta, "Try again.")]),
  ],
};

describe.skipIf(!captureDir)("llm request wire capture", () => {
  beforeEach(() => {
    recorded = [];
    setWorkspaceServerPort(4555);
    vi.stubGlobal("fetch", recordingFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function write(target: Target, scenario: string, outcome: unknown) {
    const dir = path.join(captureDir ?? "", target.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${scenario}.json`),
      `${JSON.stringify({ outcome, requests: recorded }, null, 2)}\n`,
    );
  }

  describe.each(TARGETS)("$name", (target) => {
    it.each(Object.keys(SCENARIOS))("%s", async (scenario) => {
      const model = modelFor(target);
      const taskId = createMockTaskConfig(TaskIdSchema.parse("wire"), {
        catalog: [model],
        model,
      });
      const sessionId = StoreId.newSessionId();
      await Store.saveSession(
        { createdAt: new Date(0), id: sessionId, title: "Wire" },
        taskId,
      );
      const build = SCENARIOS[scenario];
      for (const message of build?.({ model, sessionId, target }) ?? []) {
        const saved = await Store.saveMessageWithParts(message, taskId);
        saved._unsafeUnwrap();
      }

      const contextMessage = (
        realRole: "system" | "user",
        value: string,
      ): SessionMessage.ContextWithParts => {
        const id = StoreId.newMessageId();
        return {
          id,
          metadata: {
            agentName: "main",
            createdAt: new Date(0),
            realRole,
            sessionId,
          },
          parts: [
            {
              metadata: partMetadata(id, sessionId),
              text: value,
              type: "text",
            },
          ],
          role: "session-context",
        };
      };

      const actor = createActor(llmRequestLogic, {
        input: {
          agent: {
            agentTools: {},
            getMessages: () =>
              Promise.resolve([
                contextMessage("system", "You are a careful agent."),
                contextMessage("user", "<task_layout>work/</task_layout>"),
              ]),
            getTools: () => Promise.resolve(Object.values(TOOLS)),
            name: "instrument",
            onFinish: () => Promise.resolve(),
            onStart: () => Promise.resolve(),
            shouldContinue: () => Promise.resolve(true),
            systemPrompt: () => "You are a careful agent.",
          },
          model,
          self: { send: vi.fn() } as unknown as AnyActorRef,
          sessionId,
          stepCount: 1,
          taskId,
        },
      });
      actor.start();
      const snapshot = await waitFor(
        actor,
        (state) => state.status !== "active",
      );
      const output = snapshot.output;
      write(target, scenario, {
        error: output?.message.metadata.error,
        finishReason: output?.message.metadata.finishReason,
        status: snapshot.status,
      });
      // A provider error still resolves the request; it is recorded above.
      expect(snapshot.status).toBe("done");
    });

    it("title", async () => {
      const model = modelFor(target);
      createMockTaskConfig(TaskIdSchema.parse("wire"), {
        catalog: [model],
        model,
      });
      const sessionId = StoreId.newSessionId();
      const message = userMessage(sessionId, (meta) => [
        text(meta, "Plan a trip to Lisbon in May with a budget spreadsheet."),
      ]);
      if (message.role !== "user") {
        throw new Error("Expected a user message");
      }
      const result = await generateTitleFromUserMessage({
        message,
        model,
        workspaceConfig: getWorkspaceConfig(),
      });
      write(target, "title", {
        // Titles are generated without streaming, so the canned stream cannot
        // parse and this case checks only the request.
        error: result.isErr() ? result.error.message : undefined,
        title: result.isOk() ? result.value : undefined,
      });
      expect(recorded).toHaveLength(1);
    });
  });
});
