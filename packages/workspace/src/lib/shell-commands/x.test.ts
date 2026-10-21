import { type LanguageModelV4Content } from "@ai-sdk/provider";
import { APICallError } from "ai";
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
    tools: {},
  },
});

const ANSWER = JSON.stringify({
  posts: [
    {
      date: "2026-10-19",
      handle: "sam",
      text: "Shipped it. {not a brace that counts}",
      url: "https://x.com/sam/status/111",
    },
    {
      date: "2026-10-18",
      handle: "sam",
      text: "A post nobody cited.",
      url: "https://x.com/sam/status/222",
    },
  ],
});

/** A search that found two posts and cited only the first. */
function answering(
  onPrompt?: (prompt: unknown) => void,
  { doubled = false } = {},
) {
  const content: LanguageModelV4Content[] = [
    {
      id: "s1",
      sourceType: "url",
      type: "source",
      url: "https://x.com/i/status/111",
    },
    // xAI now and then sends its answer twice, joined.
    { text: doubled ? `${ANSWER}${ANSWER}` : ANSWER, type: "text" },
  ];
  return new MockLanguageModelV4({
    doGenerate: (options) => {
      onPrompt?.(options.prompt.at(-1)?.content);
      return Promise.resolve({
        content,
        finishReason: { raw: "stop", unified: "stop" },
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: undefined,
            total: 1,
          },
          outputTokens: { reasoning: undefined, text: undefined, total: 1 },
        },
        warnings: [],
      });
    },
  });
}

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
  it("prints an account's latest posts that the search cited, paging back until nothing is new", async () => {
    const prompts: unknown[] = [];
    getXSearchModel.mockResolvedValue(
      searched(answering((sent) => prompts.push(sent))),
    );

    const result = await run(["search", "--from", "@sam", "--limit", "3"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "@sam · 2026-10-19
      Shipped it. {not a brace that counts}
      https://x.com/sam/status/111
      "
    `);
    // The second page asks up to the oldest day found, finds only the same
    // post, and ends the search.
    expect(prompts).toMatchInlineSnapshot(`
      [
        [
          {
            "text": "The latest posts by @sam.
      Newest first, at most 3 posts.",
            "type": "text",
          },
        ],
        [
          {
            "text": "The latest posts by @sam.
      Posted on or before 2026-10-19.
      Newest first, at most 2 posts.",
            "type": "text",
          },
        ],
      ]
    `);
    // xAI's end date is exclusive, so the day itself is asked for as the next.
    expect(getXSearchModel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: { allowedXHandles: ["sam"], toDate: "2026-10-20" },
      }),
    );
  });

  it("reads a post's thread oldest first", async () => {
    const prompts: unknown[] = [];
    getXSearchModel.mockResolvedValue(
      searched(answering((sent) => prompts.push(sent))),
    );

    const result = await run([
      "thread",
      "https://x.com/sam/status/111",
      "--media",
    ]);

    expect(result.exitCode).toBe(0);
    expect(prompts).toMatchInlineSnapshot(`
      [
        [
          {
            "text": "The thread of this post: https://x.com/sam/status/111
      The posts it replies to, the post itself, and its replies, oldest first.
      At most 10 posts.",
            "type": "text",
          },
        ],
      ]
    `);
    expect(getXSearchModel).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          enableImageUnderstanding: true,
          enableVideoUnderstanding: true,
        },
      }),
    );
  });

  it("refuses --from with --exclude, which xAI takes one at a time", async () => {
    const result = await run([
      "search",
      "news",
      "--from",
      "sam",
      "--exclude",
      "kim",
    ]);

    expect(result.exitCode).toBe(1);
    expect(getXSearchModel).not.toHaveBeenCalled();
  });

  it("prints the posts as JSON to pipe", async () => {
    getXSearchModel.mockResolvedValue(searched(answering()));

    const result = await run(["search", "shipping", "--json"]);

    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      [
        {
          "date": "2026-10-19",
          "handle": "sam",
          "text": "Shipped it. {not a brace that counts}",
          "url": "https://x.com/sam/status/111",
        },
      ]
    `);
  });

  it("reads the posts when xAI sends its answer twice", async () => {
    getXSearchModel.mockResolvedValue(
      searched(answering(undefined, { doubled: true })),
    );

    const result = await run(["search", "shipping", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveLength(1);
  });

  it("asks for words or an account when given neither", async () => {
    const result = await run(["search"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument x: search: what to search for? Give words, --from <handle>, or both.
      "
    `);
    expect(getXSearchModel).not.toHaveBeenCalled();
  });

  it("says no Grok account is signed in", async () => {
    getXSearchModel.mockResolvedValue({ ok: false });

    const result = await run(["search", "anything"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument x: there is no Grok account to search X with: none is signed in, or xAI refused the one that is. The user can sign in with Grok, or see why it was refused, under [Grok account](instrument://settings/grok-account).
      "
    `);
  });

  it("passes on xAI's refusal as the reason", async () => {
    getXSearchModel.mockResolvedValue(
      searched(
        new MockLanguageModelV4({
          doGenerate: () => {
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
      "instrument x: xAI refused the Grok account (403). Its plan may not include this, or signing in again under [Grok account](instrument://settings/grok-account) may help. xAI said: You have either run out of available resources or do not have an active Grok subscription.
      "
    `);
  });

  it("refuses a date it cannot read", async () => {
    const result = await run(["search", "anything", "--since", "last week"]);

    expect(result.exitCode).toBe(1);
    expect(getXSearchModel).not.toHaveBeenCalled();
  });
});
