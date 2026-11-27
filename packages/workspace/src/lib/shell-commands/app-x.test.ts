import { type LanguageModelV4Content } from "@ai-sdk/provider";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { mkdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { forgetApps, seedApp } from "../../test/helpers/seed-app";
import { knowChat } from "../../test/helpers/mock-chat-config";
import { createMemoryAppsConfig } from "../apps/memory-config";
import { grokPlanRefusedLately } from "../apps/x-site";
import { createLocalBashEnv } from "../create-bash-env";
import { chatDir } from "../record-folders";
import { type Role } from "../capabilities/define";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";

const { getXSearchModel } = vi.hoisted(() => ({ getXSearchModel: vi.fn() }));

vi.mock("@instrument-org/ai-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@instrument-org/ai-gateway")>()),
  getXSearchModel,
}));

// Whether the model has the app's guide, which the hand-off test turns off;
// the rest are about what a call does once it goes out.
const guide = vi.hoisted(() => ({ handedOver: true }));
vi.mock("../apps/guide-hand-off", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apps/guide-hand-off")>()),
  anyAppGuideHandedOver: () => guide.handedOver,
  appGuideHandedOver: () => guide.handedOver,
}));

const chatId = ChatIdSchema.parse("app-x-chat");

/** A Grok plan signed in on this computer, as Studio hands the workspace one. */
const GROK_PLAN = {
  apiKey: "grok-token",
  cacheIdentifier: "grok-account",
  id: AIProviderConfigIdSchema.parse("grok-account-1"),
  type: "grok-account" as const,
};

const previous = getWorkspaceConfig();
const plan = { signedIn: true };

beforeEach(async () => {
  guide.handedOver = true;
  plan.signedIn = true;
  getXSearchModel.mockReset();
  setWorkspaceConfig({
    ...previous,
    apps: createMemoryAppsConfig(),
    getAIProviderConfigs: () => (plan.signedIn ? [GROK_PLAN] : []),
  });
  knowChat(chatId);
  await seedApp("x", {
    name: "X",
    setup: { type: "web", url: "https://x.com" },
  });
});

afterEach(async () => {
  setWorkspaceConfig(previous);
  await forgetApps();
});

const searched = (model: MockLanguageModelV4) => ({
  ok: true,
  value: { config: GROK_PLAN, model, tools: {} },
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
  accounts: [
    {
      bio: "Ships things.",
      handle: "@sam",
      id: "901",
      name: "Sam Rivera",
    },
    { bio: "", handle: "kim", id: "902", name: "Kim" },
    { bio: "Made up.", handle: "nobody", id: "903", name: "Nobody" },
  ],
});

/** A search that found two posts and three accounts, and cited one post and two accounts. */
function answering(
  onCall?: (sent: { prompt: unknown; providerOptions: unknown }) => void,
  { doubled = false } = {},
) {
  const content: LanguageModelV4Content[] = [
    {
      id: "s1",
      sourceType: "url",
      type: "source",
      url: "https://x.com/i/status/111",
    },
    {
      id: "s2",
      sourceType: "url",
      type: "source",
      url: "https://x.com/i/user/901",
    },
    { id: "s3", sourceType: "url", type: "source", url: "https://x.com/Kim" },
    // xAI now and then sends its answer twice, joined.
    { text: doubled ? `${ANSWER}${ANSWER}` : ANSWER, type: "text" },
  ];
  return new MockLanguageModelV4({
    doGenerate: (options) => {
      onCall?.({
        prompt: options.prompt.at(-1)?.content,
        providerOptions: options.providerOptions,
      });
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

async function app(args: string[], role: Role = "chat") {
  const fs = new InMemoryFs();
  await fs.mkdir("/Users/sam/chat", { recursive: true });
  return createAppCommand({
    chatId,
    role,
    sessionId: StoreId.newSessionId(),
  }).execute(
    args,
    createCommandContext({
      cwd: "/Users/sam/chat",
      env: new Map<string, string>(),
      fs,
      stdin: EMPTY_BYTES,
    }),
  );
}

describe("an app on x.com", () => {
  it("lists the X tools, with or without a Grok plan", async () => {
    plan.signedIn = false;
    const result = await app(["tools", "x"]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "3 tools on x. \`instrument app tool x <name>\` shows one with the JSON it takes; \`instrument app call x <name> '<json>'\` runs it, and in a script \`await instrument.apps["x"].<name>({...})\` (Node) or \`instrument.app("x").<name>(...)\` (Python) returns it as a value.
      - search: Posts on X matching a query, an account's latest (from alone), or both: newest first, or the most engaged with sort top.
      - thread: The conversation a post is in, oldest first: the posts it replies to, the post, and its replies.
      - people: Accounts on X by name or by what they post about: handle, name, bio and link.
      "
    `);
  });

  it("shows a tool with the JSON it takes", async () => {
    const result = await app(["tool", "x", "search"]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "search
      Posts on X matching a query, an account's latest (from alone), or both: newest first, or the most engaged with sort top.

      input: {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "query": {
            "default": "",
            "description": "The words to search for: plain language, or X's search operators (see the app's guide).",
            "type": "string"
          },
          "from": {
            "description": "Only posts by these accounts (up to 20). Not with exclude.",
            "maxItems": 20,
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "exclude": {
            "description": "No posts by these accounts (up to 20). Not with from.",
            "maxItems": 20,
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "since": {
            "description": "Only posts from this day on, YYYY-MM-DD (UTC).",
            "type": "string",
            "pattern": "^\\\\d{4}-\\\\d{2}-\\\\d{2}$"
          },
          "until": {
            "description": "Only posts up to and including this day, YYYY-MM-DD (UTC).",
            "type": "string",
            "pattern": "^\\\\d{4}-\\\\d{2}-\\\\d{2}$"
          },
          "sort": {
            "default": "latest",
            "description": "latest: newest first (unless given). top: the most engaged posts first.",
            "type": "string",
            "enum": [
              "latest",
              "top"
            ]
          },
          "limit": {
            "default": 10,
            "description": "At most this many posts (10 unless given, up to 50).",
            "type": "integer",
            "minimum": 1,
            "maximum": 50
          },
          "media": {
            "default": false,
            "description": "Grok also looks at the images and video in posts, so what a picture shows can match and is described in the post's text. Slower, and costs more of the plan.",
            "type": "boolean"
          }
        }
      }

      \`instrument app call x search '<json>'\` runs it.
      "
    `);
  });

  it("hands over its guide, with what the X tools take, before the first call", async () => {
    guide.handedOver = false;
    const result = await app(["call", "x", "search", '{"query": "pixel"}']);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('before the first request to "x"');
    expect(result.stderr).toContain("min_faves:N");
    expect(getXSearchModel).not.toHaveBeenCalled();
  });

  it("refuses requests and documents, which are worked on the site", async () => {
    const result = await app(["request", "x", "GET", "/home"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument app: "x" is X: Instrument's own X tools search it (\`instrument app tools x\`), and the rest is worked on https://x.com in a tab, signed in in Instrument's browser.
      "
    `);
  });
});

describe("an X tool with no Grok plan signed in", () => {
  async function unsigned(role: Role) {
    plan.signedIn = false;
    const result = await app(
      ["call", "x", "search", '{"query": "pixel"}'],
      role,
    );
    expect(result.exitCode).toBe(1);
    expect(getXSearchModel).not.toHaveBeenCalled();
    return result.stderr;
  }

  it("has the chat ask for the plan on connect_app", async () => {
    expect(await unsigned("chat")).toMatchInlineSnapshot(`
      "instrument app: "x" searches X on the user's Grok plan, which isn't signed in on this computer. Ask for it with connect_app naming "x": its row signs the user in to their Grok plan.
      "
    `);
    // So connect_app's row for X asks for the plan.
    expect(grokPlanRefusedLately(chatId)).toBe(true);
  });

  it("refuses the same way when the plan goes between the gate and the search", async () => {
    getXSearchModel.mockResolvedValue({ error: new Error("none"), ok: false });
    const result = await app(["call", "x", "search", '{"query": "pixel"}']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument app: "x" searches X on the user's Grok plan, which isn't signed in on this computer. Ask for it with connect_app naming "x": its row signs the user in to their Grok plan.
      "
    `);
  });

  it("has a task leave the asking to the chat", async () => {
    expect(await unsigned("task")).toMatchInlineSnapshot(`
      "instrument app: "x" searches X on the user's Grok plan, which isn't signed in on this computer. Setting up and connecting apps is the chat's. End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on.
      "
    `);
  });
});

describe("app call x search", () => {
  it("answers an account's latest posts that the search cited, paging back until nothing is new", async () => {
    const sent: unknown[] = [];
    getXSearchModel.mockResolvedValue(
      searched(answering(({ prompt }) => sent.push(prompt))),
    );

    const result = await app([
      "call",
      "x",
      "search",
      '{"from": ["@sam"], "limit": 3}',
    ]);

    expect(result.stderr).toBe("");
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
    // The second page asks up to the oldest day found, finds only the same
    // post, and ends the search.
    expect(sent).toMatchInlineSnapshot(`
      [
        [
          {
            "text": "The latest posts by @sam.
      X's Latest results: newest first, at most 3 posts.",
            "type": "text",
          },
        ],
        [
          {
            "text": "The latest posts by @sam.
      Posted on or before 2026-10-19.
      X's Latest results: newest first, at most 2 posts.",
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

  it("asks for top results in one search, rounds bounded", async () => {
    const sent: { prompt: unknown; providerOptions: unknown }[] = [];
    getXSearchModel.mockResolvedValue(
      searched(answering((call) => sent.push(call))),
    );

    const result = await app([
      "call",
      "x",
      "search",
      '{"query": "pixel", "sort": "top", "until": "2026-10-19"}',
    ]);

    expect(result.stderr).toBe("");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.providerOptions).toEqual({ xai: { maxTurns: 3 } });
    expect(getXSearchModel).toHaveBeenCalledWith(
      expect.objectContaining({ options: { toDate: "2026-10-20" } }),
    );
  });

  it("reads the posts when xAI sends its answer twice", async () => {
    getXSearchModel.mockResolvedValue(
      searched(answering(undefined, { doubled: true })),
    );

    const result = await app(["call", "x", "search", '{"query": "ship"}']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveLength(1);
  });

  it.each([
    [
      '{"query": "news", "from": ["sam"], "exclude": ["kim"]}',
      "from and exclude",
    ],
    ["{}", "search: what to search for?"],
    ['{"query": "news", "since": "last week"}', "since takes a day"],
    ['{"query": "news", "sort": "oldest"}', "It takes:"],
  ])("refuses %s before searching", async (args, said) => {
    const result = await app(["call", "x", "search", args]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(said);
    expect(getXSearchModel).not.toHaveBeenCalled();
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

    const result = await app(["call", "x", "search", '{"query": "pixel"}']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument app: xAI refused the Grok account (403). Its plan may not include this, or signing in again under [Grok account](instrument://settings/grok-account) may help. xAI said: You have either run out of available resources or do not have an active Grok subscription.
      "
    `);
  });
});

describe("app call x thread", () => {
  it("reads a post's thread oldest first", async () => {
    const sent: unknown[] = [];
    getXSearchModel.mockResolvedValue(
      searched(answering(({ prompt }) => sent.push(prompt))),
    );

    const result = await app([
      "call",
      "x",
      "thread",
      '{"url": "https://x.com/sam/status/111", "media": true}',
    ]);

    expect(result.stderr).toBe("");
    expect(sent).toMatchInlineSnapshot(`
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
});

describe("app call x people", () => {
  it("answers the accounts the search cited, by profile id or by handle", async () => {
    getXSearchModel.mockResolvedValue(searched(answering()));

    const result = await app([
      "call",
      "x",
      "people",
      '{"query": "people who ship"}',
    ]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      [
        {
          "bio": "Ships things.",
          "handle": "sam",
          "name": "Sam Rivera",
          "url": "https://x.com/sam",
        },
        {
          "bio": "",
          "handle": "kim",
          "name": "Kim",
          "url": "https://x.com/kim",
        },
      ]
    `);
  });
});

describe("the X tools in a script", () => {
  it("hands the posts back as a value", async () => {
    getXSearchModel.mockResolvedValue(searched(answering()));
    await mkdir(chatDir(chatId), { recursive: true });
    const bash = await createLocalBashEnv({
      chatId,
      sessionId: StoreId.newSessionId(),
    });

    const result = await bash.exec(`node --input-type=module <<'EOF'
const posts = await instrument.apps.x.search({ query: "ship" });
console.log(posts.length, posts[0].url);
EOF`);

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("1 https://x.com/sam/status/111\n");
  });
});
