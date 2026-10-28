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
import { defineCapability } from "./define";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Searches one command makes at most, each a request on the user's plan. */
const MAX_PAGES = 5;
/** Accounts xAI takes in one search, allowed or excluded. */
const MAX_HANDLES = 10;

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

/** The chat and session a search is made for, which its record of model requests files it under. */
interface SearchContext {
  chatId: ChatId;
  sessionId: StoreId.Session;
}

function instructions() {
  const today = getCurrentDate().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return dedent`
    You find posts on X with x_search and return them as data. Today is ${today}. Never answer from memory, and never ask anything back: search with what you were given.

    - The author and date filters given are already applied to x_search. Search again when the posts found are fewer than the number asked for and there may be more; stop when you have that many or a search finds nothing new.
    - Return the posts x_search found that fit, each with its author's handle, its date, its words exactly as written, and its link. Only posts x_search returned; none when nothing fits.
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
      description: `${field === "since" ? "Only posts from this day on" : "Only posts up to and including this day"}, YYYY-MM-DD.`,
    });

const Limit = z
  .number({
    error: `limit takes a number of posts up to ${String(MAX_LIMIT)}.`,
  })
  .int(`limit takes a number of posts up to ${String(MAX_LIMIT)}.`)
  .min(1, `limit takes a number of posts up to ${String(MAX_LIMIT)}.`)
  .max(MAX_LIMIT, `limit takes a number of posts up to ${String(MAX_LIMIT)}.`)
  .default(DEFAULT_LIMIT)
  .meta({
    description: `At most this many posts (${String(DEFAULT_LIMIT)} unless given, up to ${String(MAX_LIMIT)}).`,
  });

const Media = z.boolean().default(false).meta({
  description:
    "Grok also looks at the images and video in posts, so what a picture shows can match and is described in the post's text. Slower, and costs more of the plan.",
});

const PostsOutput = PostsSchema.shape.posts;

/**
 * The posts as text, one after another, each with its author, date and
 * link; `--json` prints them as the array instead.
 */
function postsText(posts: readonly Post[]): string {
  if (posts.length === 0) {
    return "No posts found.";
  }
  return posts
    .map((post) => `@${post.handle} · ${post.date}\n${post.text}\n${post.url}`)
    .join("\n\n");
}

const FLAG_HELP = `Every post printed is one xAI's search returned and cited; its url is the
post's own. Each search is a request on the user's Grok plan, and a
search with --limit past one page makes up to ${String(MAX_PAGES)}. --json prints the
posts as a JSON array of {"handle", "date", "text", "url"}, to pipe into jq
or save to a file.`;

/**
 * X search as a command rather than a tool: it is there in every shell on
 * every model, so the tool definitions a provider caches never change with
 * whether a Grok account is signed in, and a missing account, a usage limit
 * or a refusal reaches the agent as the reason it failed. Its posts are data
 * the agent can pipe and keep, which a tool's result is not.
 */
export const xSearch = defineCapability({
  input: z.object({
    query: z.string().default("").meta({
      description:
        'The words to search for: plain language, or X\'s search operators (min_faves:100, filter:media, lang:en, "exact phrase").',
    }),
    by: Handles.meta({
      description: `Only posts by these accounts (up to ${String(MAX_HANDLES)}).`,
    }),
    exclude: Handles.meta({
      description:
        "No posts by these accounts, in a search not limited to accounts.",
    }),
    since: Day("since"),
    until: Day("until"),
    limit: Limit,
    media: Media,
  }),
  name: "x.search",
  output: PostsOutput,
  async run({ by, exclude, limit, media, query, since, until }, ctx) {
    const words = query.trim();
    if (!words && by.length === 0) {
      throw new Error(
        `search: what to search for? Give words, --from <handle>, or both.`,
      );
    }
    if (by.length > 0 && exclude.length > 0) {
      throw new Error("--from and --exclude can't be used together.");
    }
    const authors = by.map((handle) => `@${handle}`).join(", ");

    // One search answers with the newest page of posts however often it is
    // repeated, so the next page is asked for as the posts up to the oldest day
    // found so far, until there are enough or a page brings nothing new.
    const posts: Post[] = [];
    let through = until;
    for (let page = 0; page < MAX_PAGES && posts.length < limit; page++) {
      const wanted = limit - posts.length;
      const found = await searchOnce({
        context: ctx,
        options: {
          ...(by.length > 0 && { allowedXHandles: by }),
          ...(exclude.length > 0 && { excludedXHandles: exclude }),
          ...(since && { fromDate: since }),
          // xAI's end date is exclusive.
          ...(through && { toDate: nextDay(through) }),
          ...(media && {
            enableImageUnderstanding: true,
            enableVideoUnderstanding: true,
          }),
        },
        prompt: [
          words ? `Posts about: ${words}` : `The latest posts by ${authors}.`,
          words && by.length > 0 && `Only posts by ${authors}.`,
          since && `Posted on or after ${since}.`,
          through && `Posted on or before ${through}.`,
          `Newest first, at most ${String(wanted)} posts.`,
        ],
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
    "Posts on X about the words, newest first, found by Grok on the user's Grok account; --from <handle> alone for that account's latest.",
  surfaces: {
    cli: {
      flagNames: { by: "from" },
      help: FLAG_HELP,
      positional: ["query"],
      rest: true,
      words: ["x", "search"],
    },
    script: { positional: ["query"] },
  },
  text: postsText,
});

export const xThread = defineCapability({
  input: z.object({
    url: z.string().meta({
      description: "The post's link, https://x.com/<handle>/status/<id>.",
    }),
    limit: Limit,
    media: Media,
  }),
  name: "x.thread",
  output: PostsOutput,
  async run({ limit, media, url }, ctx) {
    if (!statusId(url)) {
      throw new Error(
        `thread: which post? Give its link, https://x.com/<handle>/status/<id>.`,
      );
    }
    const posts = await searchOnce({
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
  surfaces: {
    cli: { help: "", positional: ["url"], words: ["x", "thread"] },
    script: { positional: ["url"] },
  },
  text: postsText,
});

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** One search of X, answering with the posts it cited. */
async function searchOnce({
  context: { chatId, sessionId },
  options,
  prompt,
  signal,
}: {
  context: SearchContext;
  options: XSearchOptions;
  prompt: (false | string | undefined)[];
  signal: AbortSignal | undefined;
}): Promise<Post[]> {
  const workspaceConfig = getWorkspaceConfig();
  const resolved = await getXSearchModel({
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    options,
    workspaceServerURL: getWorkspaceServerURL(),
  });
  if (!resolved.ok) {
    throw new Error(
      "there is no Grok account to search X with: none is signed in, or xAI refused the one that is. The user can sign in with Grok, or see why it was refused, under [Grok account](instrument://settings/grok-account).",
    );
  }
  const { config, model, tools } = resolved.value;

  try {
    const result = await generateText({
      abortSignal: signal,
      headers: { [CLIENT_SESSION_ID_HEADER]: sessionId },
      instructions: instructions(),
      model,
      // A refusal xAI repeats on every try (no subscription, a spent
      // allowance) reaches the agent at once; it can run the command again.
      maxRetries: 0,
      output: firstObjectOutput(),
      prompt: prompt.filter(Boolean).join("\n"),
      telemetry: activityTelemetry({
        chatId,
        connection: config,
        kind: "search",
        purpose: "x-search",
        sessionId,
      }),
      tools,
    });
    return cited(
      result.output.posts,
      result.sources.flatMap((source) =>
        source.sourceType === "url" ? [source.url] : [],
      ),
    );
  } catch (error) {
    throw new Error(refusal(error), { cause: error });
  }
}

/**
 * The posts as structured output, read from the first JSON object in the
 * reply. xAI now and then sends its answer twice in one response, and the two
 * copies arrive joined (`{...}{...}`), which is no JSON at all.
 */
function firstObjectOutput() {
  const output = Output.object({ schema: PostsSchema });
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
