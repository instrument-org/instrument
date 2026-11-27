import {
  CLIENT_SESSION_ID_HEADER,
  getXSearchModel,
  type XSearchOptions,
} from "@instrument-org/ai-gateway";
import { APICallError, generateText, Output } from "ai";
import { dedent } from "radashi";
import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { getWorkspaceServerURL } from "../../logic/server/url";
import { activityTelemetry } from "../activity/record";
import { NO_ALLOWANCE_PATTERN } from "../classify-provider-error";
import { getCurrentDate } from "../get-current-date";
import { getWorkspaceConfig } from "../workspace-config";
import { type Capability, defineCapability } from "./define";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_PEOPLE = 10;
const MAX_PEOPLE = 20;
/** Searches one call makes at most, each a request on the user's plan. */
const MAX_PAGES = 5;
/** Accounts xAI takes in one search, allowed or excluded. */
const MAX_HANDLES = 20;
/**
 * Rounds of searching Grok makes in one request (xAI's `max_turns`), so one
 * request stays a lookup: xAI calls 3 to 5 balanced, and the pages a long
 * search asks for are requests of their own.
 */
const MAX_SEARCH_TURNS = 3;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const PostsSchema = z.object({
  posts: z.array(
    z.object({
      // Pages back from it, so a date in any other form is refused.
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("When it was posted, YYYY-MM-DD."),
      handle: z.string().describe("The author's handle, without the @."),
      text: z
        .string()
        .describe(
          "The post's words exactly as written, then what its images or video show when you looked at them.",
        ),
      url: z.string().describe("https://x.com/<handle>/status/<id>"),
    }),
  ),
});
type Post = z.output<typeof PostsSchema>["posts"][number];

const AccountsSchema = z.object({
  accounts: z.array(
    z.object({
      bio: z
        .string()
        .describe("The account's bio exactly as written, empty if none."),
      handle: z.string().describe("The account's handle, without the @."),
      id: z
        .string()
        .describe(
          "The account's numeric id, as its profile's citation names it: https://x.com/i/user/<id>.",
        ),
      name: z.string().describe("The account's display name."),
    }),
  ),
});

const AccountOutput = z.object({
  bio: z.string(),
  handle: z.string(),
  name: z.string(),
  url: z.string(),
});
type Account = z.output<typeof AccountOutput>;

/** The chat and session a search is made for, which its record of model requests files it under. */
interface SearchContext {
  chatId: ChatId;
  sessionId: StoreId.Session;
}

function today() {
  return getCurrentDate().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function postInstructions() {
  return dedent`
    You find posts on X with x_search and return them as data. Today is ${today()}. Never answer from memory, and never ask anything back: search with what you were given.

    - The author and date filters given are already applied to x_search. Search again when the posts found are fewer than the number asked for and there may be more; stop when you have that many or a search finds nothing new.
    - Return the posts x_search found that fit, each with its author's handle, its date, its words exactly as written, and its link. Only posts x_search returned; none when nothing fits.
  `;
}

function accountInstructions() {
  return dedent`
    You find accounts on X with x_search's user search and return them as data. Today is ${today()}. Never answer from memory, and never ask anything back: search with what you were given.

    - Return the accounts the user search found that fit, each with its handle, display name, bio exactly as written, and numeric id, the number in its profile's citation (https://x.com/i/user/<id>). Only accounts x_search returned; none when nothing fits.
  `;
}

/** A handle as X shows it, `@` and all, as xAI takes it: without the `@`. */
const Handles = z
  .array(z.string().transform((handle) => handle.replace(/^@/, "")))
  .max(
    MAX_HANDLES,
    `takes up to ${String(MAX_HANDLES)} accounts in one search.`,
  )
  .default([]);

const Day = (field: string) =>
  z
    .string()
    .regex(DATE, `${field} takes a day as YYYY-MM-DD.`)
    .optional()
    .meta({
      description: `${field === "since" ? "Only posts from this day on" : "Only posts up to and including this day"}, YYYY-MM-DD (UTC).`,
    });

const limitError = (max: number, what: string) =>
  `limit takes a number of ${what} up to ${String(max)}.`;

const Limit = (fallback: number, max: number, what: string) =>
  z
    .number({ error: limitError(max, what) })
    .int(limitError(max, what))
    .min(1, limitError(max, what))
    .max(max, limitError(max, what))
    .default(fallback)
    .meta({
      description: `At most this many ${what} (${String(fallback)} unless given, up to ${String(max)}).`,
    });

const Media = z.boolean().default(false).meta({
  description:
    "Grok also looks at the images and video in posts, so what a picture shows can match and is described in the post's text. Slower, and costs more of the plan.",
});

const PostsOutput = PostsSchema.shape.posts;

/**
 * X search, as one of the tools every app on X's site has
 * (`lib/apps/x-site.ts`): the agent reaches it with `instrument app call`
 * and in a script as the app's own, whatever model the chat runs on, and
 * a missing plan, a usage limit or a refusal reaches it as the reason the
 * call failed. Each call is a request on the user's Grok plan.
 */
const xSearch = defineCapability({
  input: z.object({
    query: z.string().default("").meta({
      description:
        "The words to search for: plain language, or X's search operators (see the app's guide).",
    }),
    from: Handles.meta({
      description: `Only posts by these accounts (up to ${String(MAX_HANDLES)}). Not with exclude.`,
    }),
    exclude: Handles.meta({
      description: `No posts by these accounts (up to ${String(MAX_HANDLES)}). Not with from.`,
    }),
    since: Day("since"),
    until: Day("until"),
    sort: z.enum(["latest", "top"]).default("latest").meta({
      description:
        "latest: newest first (unless given). top: the most engaged posts first.",
    }),
    limit: Limit(DEFAULT_LIMIT, MAX_LIMIT, "posts"),
    media: Media,
  }),
  name: "x.search",
  output: PostsOutput,
  async run({ exclude, from, limit, media, query, since, sort, until }, ctx) {
    const words = query.trim();
    if (!words && from.length === 0) {
      throw new Error(
        "search: what to search for? Give a query, from, or both.",
      );
    }
    if (from.length > 0 && exclude.length > 0) {
      throw new Error(
        "from and exclude can't be used together: xAI takes one or the other in a search.",
      );
    }
    const authors = from.map((handle) => `@${handle}`).join(", ");
    const options: XSearchOptions = {
      ...(from.length > 0 && { allowedXHandles: from }),
      ...(exclude.length > 0 && { excludedXHandles: exclude }),
      ...(since && { fromDate: since }),
      ...(media && {
        enableImageUnderstanding: true,
        enableVideoUnderstanding: true,
      }),
    };
    const asked = (wanted: number, through: string | undefined) => [
      words ? `Posts about: ${words}` : `The latest posts by ${authors}.`,
      words && from.length > 0 && `Only posts by ${authors}.`,
      since && `Posted on or after ${since}.`,
      through && `Posted on or before ${through}.`,
      sort === "top"
        ? `X's Top results: the most engaged posts first, at most ${String(wanted)} posts.`
        : `X's Latest results: newest first, at most ${String(wanted)} posts.`,
    ];

    if (sort === "top") {
      // Top results are not in date order, so there is no page to ask for
      // next by date: one search, in the order it ranked them.
      const found = await searchPosts({
        context: ctx,
        options: { ...options, ...(until && { toDate: nextDay(until) }) },
        prompt: asked(limit, until),
        signal: ctx.signal,
      });
      return found.slice(0, limit);
    }

    // One search answers with the newest page of posts however often it is
    // repeated, so the next page is asked for as the posts up to the oldest day
    // found so far, until there are enough or a page brings nothing new.
    const posts: Post[] = [];
    let through = until;
    for (let page = 0; page < MAX_PAGES && posts.length < limit; page++) {
      const found = await searchPosts({
        context: ctx,
        options: {
          ...options,
          // xAI's end date is exclusive.
          ...(through && { toDate: nextDay(through) }),
        },
        prompt: asked(limit - posts.length, through),
        signal: ctx.signal,
      });
      const seen = new Set(posts.map((post) => post.url));
      const fresh = found.filter((post) => !seen.has(post.url));
      if (fresh.length === 0) {
        break;
      }
      posts.push(...fresh);
      through = fresh.map((post) => post.date).toSorted()[0];
    }
    posts.sort((a, b) => b.date.localeCompare(a.date));
    return posts.slice(0, limit);
  },
  summary:
    "Posts on X matching a query, an account's latest (from alone), or both: newest first, or the most engaged with sort top.",
  surfaces: {},
  text: (posts) => JSON.stringify(posts, null, 2),
});

const xThread = defineCapability({
  input: z.object({
    url: z.string().meta({
      description: "The post's link, https://x.com/<handle>/status/<id>.",
    }),
    limit: Limit(DEFAULT_LIMIT, MAX_LIMIT, "posts"),
    media: Media,
  }),
  name: "x.thread",
  output: PostsOutput,
  async run({ limit, media, url }, ctx) {
    if (!statusId(url)) {
      throw new Error(
        "thread: which post? Give its link, https://x.com/<handle>/status/<id>.",
      );
    }
    const posts = await searchPosts({
      context: ctx,
      options: media
        ? { enableImageUnderstanding: true, enableVideoUnderstanding: true }
        : {},
      prompt: [
        `The thread of this post: ${url}`,
        "The posts it replies to, the post itself, and its replies, oldest first.",
        `At most ${String(limit)} posts.`,
      ],
      signal: ctx.signal,
    });
    posts.sort((a, b) => a.date.localeCompare(b.date));
    return posts.slice(0, limit);
  },
  summary:
    "The conversation a post is in, oldest first: the posts it replies to, the post, and its replies.",
  surfaces: {},
  text: (posts) => JSON.stringify(posts, null, 2),
});

const xPeople = defineCapability({
  input: z.object({
    query: z
      .string()
      .trim()
      .min(1, "people: who? Give a name or what they post about.")
      .meta({
        description:
          'Who to find: a name, or what the accounts are about ("Rust compiler contributors").',
      }),
    limit: Limit(DEFAULT_PEOPLE, MAX_PEOPLE, "accounts"),
  }),
  name: "x.people",
  output: z.array(AccountOutput),
  async run({ limit, query }, ctx) {
    const accounts = await searchAccounts({
      context: ctx,
      prompt: [`Accounts on X: ${query}`, `At most ${String(limit)} accounts.`],
      signal: ctx.signal,
    });
    return accounts.slice(0, limit);
  },
  summary:
    "Accounts on X by name or by what they post about: handle, name, bio and link.",
  surfaces: {},
  text: (accounts) => JSON.stringify(accounts, null, 2),
});

/** One of the tools an X app lists, by the name `instrument app call` takes. */
export interface XTool {
  capability: Capability;
  name: string;
}

/** Every X tool, in the order `instrument app tools` lists them. */
export const X_TOOLS: readonly XTool[] = [
  { capability: xSearch, name: "search" },
  { capability: xThread, name: "thread" },
  { capability: xPeople, name: "people" },
];

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** What a plan-less or refused search says, in place of any post. */
const NO_GROK_ACCOUNT =
  "there is no Grok account to search X with: none is signed in on this computer, or xAI refused the one that is.";

/** One search of X, answering with the posts it cited. */
async function searchPosts({
  context,
  options,
  prompt,
  signal,
}: {
  context: SearchContext;
  options: XSearchOptions;
  prompt: (false | string | undefined)[];
  signal: AbortSignal | undefined;
}): Promise<Post[]> {
  const { output, sources } = await searchX<z.output<typeof PostsSchema>>({
    context,
    instructions: postInstructions(),
    options,
    output: firstObjectOutput(PostsSchema),
    prompt,
    signal,
  });
  return cited(output.posts, sources);
}

/** One search of X's accounts, answering with the ones it cited. */
async function searchAccounts({
  context,
  prompt,
  signal,
}: {
  context: SearchContext;
  prompt: string[];
  signal: AbortSignal | undefined;
}): Promise<Account[]> {
  const { output, sources } = await searchX<z.output<typeof AccountsSchema>>({
    context,
    instructions: accountInstructions(),
    options: {},
    output: firstObjectOutput(AccountsSchema),
    prompt,
    signal,
  });
  return citedAccounts(output.accounts, sources);
}

/** One request to Grok with `x_search`: its structured answer and the addresses it cited. */
async function searchX<Shape>({
  context: { chatId, sessionId },
  instructions,
  options,
  output,
  prompt,
  signal,
}: {
  context: SearchContext;
  instructions: string;
  options: XSearchOptions;
  output: ReturnType<typeof firstObjectOutput<Shape>>;
  prompt: (false | string | undefined)[];
  signal: AbortSignal | undefined;
}): Promise<{ output: Shape; sources: string[] }> {
  const workspaceConfig = getWorkspaceConfig();
  const resolved = await getXSearchModel({
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    options,
    workspaceServerURL: getWorkspaceServerURL(),
  });
  if (!resolved.ok) {
    throw new Error(NO_GROK_ACCOUNT);
  }
  const { config, model, tools } = resolved.value;

  try {
    const result = await generateText({
      abortSignal: signal,
      headers: { [CLIENT_SESSION_ID_HEADER]: sessionId },
      instructions,
      model,
      // A refusal xAI repeats on every try (no subscription, a spent
      // allowance) reaches the agent at once; it can make the call again.
      maxRetries: 0,
      output,
      prompt: prompt.filter(Boolean).join("\n"),
      providerOptions: { xai: { maxTurns: MAX_SEARCH_TURNS } },
      telemetry: activityTelemetry({
        chatId,
        connection: config,
        kind: "search",
        purpose: "x-search",
        sessionId,
      }),
      tools,
    });
    return {
      output: result.output,
      sources: result.sources.flatMap((source) =>
        source.sourceType === "url" ? [source.url] : [],
      ),
    };
  } catch (error) {
    throw new Error(refusal(error), { cause: error });
  }
}

/**
 * The answer as structured output, read from the first JSON object in the
 * reply. xAI now and then sends its answer twice in one response, and the two
 * copies arrive joined (`{...}{...}`), which is no JSON at all.
 */
function firstObjectOutput<Shape>(schema: z.ZodType<Shape>) {
  const output = Output.object({ schema });
  return {
    ...output,
    parseCompleteOutput: (
      { text }: { text: string },
      context: Parameters<typeof output.parseCompleteOutput>[1],
    ) => output.parseCompleteOutput({ text: firstObject(text) }, context),
  };
}

/** The first complete top-level `{...}` in `text`, or the text as it is. */
function firstObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    return text;
  }
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === "\\") {
        index++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}" && --depth === 0) {
      return text.slice(start, index + 1);
    }
  }
  return text;
}

/**
 * The posts whose status the search cited, so every one printed is a post x_search
 * returned rather than one the model wrote: a citation names the status by
 * id (`x.com/i/status/<id>`), which a post's own link ends with.
 */
function cited(posts: Post[], sources: string[]): Post[] {
  const statusIds = new Set(sources.flatMap((url) => statusId(url) ?? []));
  return posts.flatMap((post) => {
    const id = statusId(post.url);
    return id && statusIds.has(id)
      ? [{ ...post, url: `https://x.com/${post.handle}/status/${id}` }]
      : [];
  });
}

/**
 * The accounts the search cited, so every one printed is an account x_search
 * returned rather than one the model wrote: a citation names a profile by
 * its id (`x.com/i/user/<id>`), or a page of the account's own by its handle.
 */
function citedAccounts(
  accounts: z.output<typeof AccountsSchema>["accounts"],
  sources: string[],
): Account[] {
  const userIds = new Set(
    sources.flatMap((url) => /\/i\/user\/(\d+)/.exec(url)?.[1] ?? []),
  );
  const handles = new Set(
    sources.flatMap((url) => {
      const first = pathStart(url);
      return first === undefined || first === "i" ? [] : [first];
    }),
  );
  return accounts.flatMap(({ bio, handle, id, name }) => {
    const bare = handle.replace(/^@/, "");
    return userIds.has(id) || handles.has(bare.toLowerCase())
      ? [{ bio, handle: bare, name, url: `https://x.com/${bare}` }]
      : [];
  });
}

/** The first part of an X address's path, lowercased, or nothing for another site. */
function pathStart(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/(?:^|\.)(?:x|twitter)\.com$/.test(parsed.hostname)) {
      return undefined;
    }
    return parsed.pathname.split("/")[1]?.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function statusId(url: string): string | undefined {
  return /\/status\/(\d+)/.exec(url)?.[1];
}

/** What went wrong, as the agent should hear it and pass on to the user. */
function refusal(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const detail = error.responseBody?.trim() || error.message;
    if (
      error.statusCode === 429 &&
      NO_ALLOWANCE_PATTERN.test(`${error.message}\n${detail}`)
    ) {
      return "the Grok account has no Grok subscription, so xAI allows it no requests. It needs an eligible paid plan with Grok API access; [Grok account](instrument://settings/grok-account) in Settings shows its plan.";
    }
    if (error.statusCode === 429) {
      return `the Grok account hit its usage limit; try again later. xAI said: ${detail}`;
    }
    if (error.statusCode === 401 || error.statusCode === 403) {
      return `xAI refused the Grok account (${String(error.statusCode)}). Its plan may not include this, or signing in again under [Grok account](instrument://settings/grok-account) may help. xAI said: ${detail}`;
    }
    return `X search failed (${String(error.statusCode ?? "no status")}): ${detail}`;
  }
  return `X search failed: ${error instanceof Error ? error.message : String(error)}`;
}
