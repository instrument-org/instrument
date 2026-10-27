import {
  CLIENT_SESSION_ID_HEADER,
  getXSearchModel,
  type XSearchOptions,
} from "@instrument-org/ai-gateway";
import { APICallError, generateText, Output } from "ai";
import { defineCommand } from "just-bash";
import { dedent } from "radashi";
import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { getWorkspaceServerURL } from "../../logic/server/url";
import { activityTelemetry } from "../activity/record";
import { NO_ALLOWANCE_PATTERN } from "../classify-provider-error";
import { getCurrentDate } from "../get-current-date";
import { getWorkspaceConfig } from "../workspace-config";
import {
  defineSubcommands,
  type SubcommandInput,
  subcommand,
} from "./subcommands";
import { X_COMMAND } from "./x-command";

export { X_COMMAND } from "./x-command";

const NAME = X_COMMAND.name;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Searches one command makes at most, each a request on the user's plan. */
const MAX_PAGES = 5;
/** Accounts xAI takes in one search, allowed or excluded. */
const MAX_HANDLES = 10;

const USAGE = `Usage: ${NAME} search ["<words>"] [--from <handle>] [--exclude <handle>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--limit <n>] [--media] [--json]
       ${NAME} thread <post url> [--limit <n>] [--media] [--json]

  ${NAME} search "<words>"
      Posts on X about the words, newest first, found by Grok on the user's
      Grok account. Grok searches by keyword and by meaning, so the words can
      be plain language or X's search operators (min_faves:100,
      filter:media, lang:en, "exact phrase").
  ${NAME} search --from <handle>
      That account's latest posts.
  ${NAME} thread <post url>
      The conversation a post is in, oldest first: the posts it replies to,
      the post, and its replies.

      --from <handle>     Only posts by this account (repeat, up to ${String(MAX_HANDLES)}).
      --exclude <handle>  No posts by this account (repeat; not with --from).
      --since <date>      Only posts from this day on.
      --until <date>      Only posts up to and including this day.
      --limit <n>         At most this many posts (${String(DEFAULT_LIMIT)} unless given, up to ${String(MAX_LIMIT)}).
      --media             Grok also looks at the images and video in posts, so
                          what a picture shows can match and is described in
                          the post's text. Slower, and costs more of the plan.
      --json              Print the posts as a JSON array of
                          {"handle", "date", "text", "url"} instead of text,
                          to pipe into jq or save to a file.

  Every post printed is one xAI's search returned and cited; its url is the
  post's own. Each search is a request on the user's Grok plan, and a
  search with --limit past one page makes up to ${String(MAX_PAGES)}.
`;

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

/** What `x` needs from the `bash` call it runs inside. */
export interface XCommandContext {
  chatId: ChatId;
  sessionId: StoreId.Session;
}

/**
 * X search as a command rather than a tool: it is there in every shell on
 * every model, so the tool definitions a provider caches never change with
 * whether a Grok account is signed in, and a missing account, a usage limit
 * or a refusal reaches the agent as the reason it failed. Its posts are data
 * the agent can pipe and keep, which a tool's result is not.
 */
export function createXCommand(context: XCommandContext) {
  return defineCommand(NAME, (args, ctx) => runX(args, context, ctx));
}

const runX = defineSubcommands<XCommandContext>({
  name: NAME,
  subcommands: {
    search: subcommand({
      booleans: ["json", "media"],
      flags: ["exclude", "from", "limit", "since", "until"],
      repeatable: ["exclude", "from"],
      run: (input, context, { signal }) => search(input, context, signal),
    }),
    thread: subcommand({
      booleans: ["json", "media"],
      flags: ["limit"],
      positional: 1,
      run: (input, context, { signal }) => thread(input, context, signal),
    }),
  },
  usage: USAGE,
});

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

async function search(
  input: SubcommandInput,
  context: XCommandContext,
  signal: AbortSignal | undefined,
) {
  const query = input.positional.join(" ").trim();
  const from = handlesOf(input.all("from"), "from");
  const exclude = handlesOf(input.all("exclude"), "exclude");
  const since = dateOf(input.value("since"), "since");
  const until = dateOf(input.value("until"), "until");
  const count = limitOf(input.value("limit"));
  if (!query && from.length === 0) {
    throw new Error(
      `search: what to search for? Give words, --from <handle>, or both.`,
    );
  }
  if (from.length > 0 && exclude.length > 0) {
    throw new Error("--from and --exclude can't be used together.");
  }
  const media = input.has("media");
  const authors = from.map((handle) => `@${handle}`).join(", ");

  // One search answers with the newest page of posts however often it is
  // repeated, so the next page is asked for as the posts up to the oldest day
  // found so far, until there are enough or a page brings nothing new.
  const posts: Post[] = [];
  let through = until;
  for (let page = 0; page < MAX_PAGES && posts.length < count; page++) {
    const wanted = count - posts.length;
    const found = await searchOnce({
      context,
      options: {
        ...(from.length > 0 && { allowedXHandles: from }),
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
        query ? `Posts about: ${query}` : `The latest posts by ${authors}.`,
        query && from.length > 0 && `Only posts by ${authors}.`,
        since && `Posted on or after ${since}.`,
        through && `Posted on or before ${through}.`,
        `Newest first, at most ${String(wanted)} posts.`,
      ],
      signal,
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
  return print(posts.slice(0, count), input.has("json"));
}

async function thread(
  input: SubcommandInput,
  context: XCommandContext,
  signal: AbortSignal | undefined,
) {
  const url = input.positional[0] ?? "";
  if (!statusId(url)) {
    throw new Error(
      `thread: which post? Give its link, https://x.com/<handle>/status/<id>.`,
    );
  }
  const count = limitOf(input.value("limit"));
  const posts = await searchOnce({
    context,
    options: input.has("media")
      ? { enableImageUnderstanding: true, enableVideoUnderstanding: true }
      : {},
    prompt: [
      `The thread of this post: ${url}`,
      "The posts it replies to, the post itself, and its replies, oldest first.",
      `At most ${String(count)} posts.`,
    ],
    signal,
  });
  posts.sort((a, b) => a.date.localeCompare(b.date));
  return print(posts.slice(0, count), input.has("json"));
}

function print(posts: Post[], json: boolean) {
  if (json) {
    return `${JSON.stringify(posts, null, 2)}\n`;
  }
  if (posts.length === 0) {
    return "No posts found.\n";
  }
  return `${posts
    .map((post) => `@${post.handle} · ${post.date}\n${post.text}\n${post.url}`)
    .join("\n\n")}\n`;
}

function handlesOf(given: string[], flag: string): string[] {
  const handles = given.map((handle) => handle.replace(/^@/, ""));
  if (handles.length > MAX_HANDLES) {
    throw new Error(
      `--${flag} takes up to ${String(MAX_HANDLES)} accounts in one search.`,
    );
  }
  return handles;
}

function dateOf(value: string | undefined, flag: string) {
  if (value !== undefined && !DATE.test(value)) {
    throw new Error(`--${flag} takes a day as YYYY-MM-DD, not "${value}".`);
  }
  return value;
}

function limitOf(value: string | undefined): number {
  if (
    value !== undefined &&
    (!/^[1-9]\d*$/.test(value) || Number(value) > MAX_LIMIT)
  ) {
    throw new Error(
      `--limit takes a number of posts up to ${String(MAX_LIMIT)}, not "${value}".`,
    );
  }
  return Number(value ?? DEFAULT_LIMIT);
}

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
  context: XCommandContext;
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
