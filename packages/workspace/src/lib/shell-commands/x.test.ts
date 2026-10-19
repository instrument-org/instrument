import { type LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { createXCommand } from "./x";

const { getXSearchModel } = vi.hoisted(() => ({ getXSearchModel: vi.fn() }));

vi.mock("@instrument-org/ai-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@instrument-org/ai-gateway")>()),
  getXSearchModel,
}));

const searched = (model: MockLanguageModelV4) => ({
  ok: true,
  value: {
    config: { id: "grok-account", type: "grok-account" },
    model,
    tools: {
      x_search: {
        args: {},
        id: "xai.x_search",
        inputSchema: { jsonSchema: {} },
        type: "provider",
      },
    },
  },
});

function run(args: string[]) {
  return createXCommand({
    chatId: ChatIdSchema.parse("x-command-test"),
    sessionId: StoreId.newSessionId(),
  }).execute(
    args,
    createCommandContext({
      cwd: "/Users/sam/chat",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
}

beforeEach(() => {
  getXSearchModel.mockReset();
});

describe("instrument x search", () => {
  it("prints what Grok found, with each post's link once", async () => {
    let prompt: unknown;
    getXSearchModel.mockResolvedValue(
      searched(
        new MockLanguageModelV4({
          doStream: (options) => {
            prompt = options.prompt.at(-1)?.content;
            return Promise.resolve({
              stream: simulateReadableStream({
                chunks: [
                  {
                    input: "{}",
                    providerExecuted: true,
                    toolCallId: "c",
                    toolName: "x_search",
                    type: "tool-call",
                  },
                  {
                    result: {},
                    toolCallId: "c",
                    toolName: "x_search",
                    type: "tool-result",
                  },
                  { id: "t", type: "text-start" },
                  { delta: "@sam: hello", id: "t", type: "text-delta" },
                  { id: "t", type: "text-end" },
                  {
                    id: "s",
                    sourceType: "url",
                    title: "https://x.com/i/status/1",
                    type: "source",
                    url: "https://x.com/i/status/1",
                  },
                  {
                    finishReason: { raw: "stop", unified: "stop" },
                    type: "finish",
                    usage: {
                      inputTokens: {
                        cacheRead: undefined,
                        cacheWrite: undefined,
                        noCache: undefined,
                        total: 1,
                      },
                      outputTokens: {
                        reasoning: undefined,
                        text: undefined,
                        total: 1,
                      },
                    },
                  },
                ] satisfies LanguageModelV4StreamPart[],
              }),
            });
          },
        }),
      ),
    );

    const result = await run(["search", "latest", "--from", "@sam"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "@sam: hello

      Sources:
      - https://x.com/i/status/1
      "
    `);
    expect(prompt).toMatchInlineSnapshot(`
      [
        {
          "text": "Search X for: latest
      Only posts by @sam.",
          "type": "text",
        },
      ]
    `);
    expect(getXSearchModel).toHaveBeenCalledWith(
      expect.objectContaining({ handles: ["sam"] }),
    );
  });

  it("says no Grok account is signed in", async () => {
    getXSearchModel.mockResolvedValue({ ok: false });

    const result = await run(["search", "anything"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument x: no Grok account is signed in, so X can't be searched. The user can sign in with Grok under Settings › Providers.
      "
    `);
  });

  it("passes on xAI's refusal as the reason", async () => {
    getXSearchModel.mockResolvedValue(
      searched(
        new MockLanguageModelV4({
          doStream: () => {
            throw new APICallError({
              message: "Forbidden",
              requestBodyValues: {},
              responseBody:
                "You have either run out of available resources or do not have an active Grok subscription.",
              statusCode: 403,
              url: "https://api.x.ai/v1/responses",
            });
          },
        }),
      ),
    );

    const result = await run(["search", "anything"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument x: xAI refused the Grok account (403). Its plan may not include this, or signing in again under Settings › Providers may help. xAI said: You have either run out of available resources or do not have an active Grok subscription.
      "
    `);
  });

  it("refuses a date it cannot read", async () => {
    const result = await run(["search", "anything", "--since", "last week"]);

    expect(result.exitCode).toBe(1);
    expect(getXSearchModel).not.toHaveBeenCalled();
  });
});
