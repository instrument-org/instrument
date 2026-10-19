import {
  CLIENT_SESSION_ID_HEADER,
  getXSearchModel,
} from "@instrument-org/ai-gateway";
import { APICallError, generateText, Output } from "ai";
import { defineCommand } from "just-bash";
import { dedent } from "radashi";
import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { getWorkspaceServerURL } from "../../logic/server/url";
import { activityTelemetry } from "../activity/record";
import { getCurrentDate } from "../get-current-date";
import { getWorkspaceConfig } from "../workspace-config";
import { defineSubcommands, subcommand } from "./subcommands";
import { X_COMMAND } from "./x-command";

export { X_COMMAND } from "./x-command";

const NAME = X_COMMAND.name;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Searches one command makes at most, each a request on the user's plan. */
const MAX_PAGES = 5;

const USAGE = `Usage: ${NAME} search ["<words>"] [--from <handle>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--limit <n>] [--json]

  ${NAME} search "<words>"
      Posts on X about the words, newest first, found by Grok on the user's
      Grok account. The words say what the posts are about in plain language;
      who, when and how many go in the flags, not in X's search operators.
  ${NAME} search --from <handle>
      That account's latest posts.

      --from <handle>   Only posts by this account (repeat for several).
      --since <date>    Only posts from this day on.
      --until <date>    Only posts up to this day.
      --limit <n>       At most this many posts (${String(DEFAULT_LIMIT)} unless given, up to ${String(MAX_LIMIT)}).
      --json            Print the posts as a JSON array of
                        {"handle", "date", "text", "url"} instead of text,
                        to pipe into jq or save to a file.

  Every post printed is one xAI's search returned and cited; its url is the
  post's own. Each search is a request on the user's Grok plan.
`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const PostsSchema = z.object({
  posts: z.array(
    z.object({
      date: z.string().describe("When it was posted, YYYY-MM-DD."),
      handle: z.string().describe("The author's handle, without the @."),
      text: z.string().describe("The post's words exactly as written."),
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
      booleans: ["json"],
      flags: ["from", "limit", "since", "until"],
      repeatable: ["from"],
      run: (input, context, { signal }) =>
        search(
          {
            from: input.all("from"),
            json: input.has("json"),
            limit: input.value("limit"),
            query: input.positional.join(" ").trim(),
            since: input.value("since"),
            until: input.value("until"),
          },
          context,
          signal,
        ),
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

    - The author and date filters given are already applied to x_search. Search again when the posts found are fewer than the number asked for and there may be more, such as earlier ones; stop when you have that many or a search finds nothing new.
    - Return the posts x_search found that fit, newest first, each with its author's handle, its date, its words exactly as written, and its link. Only posts x_search returned; none when nothing fits.
  `;
}

async function search(
  {
    from,
    json,
    limit,
    query,
    since,
    until,
  }: {
    from: string[];
    json: boolean;
    limit?: string;
    query: string;
    since?: string;
    until?: string;
  },
  { chatId, sessionId }: XCommandContext,
  signal: AbortSignal | undefined,
) {
  const handles = from.map((handle) => handle.replace(/^@/, ""));
  if (!query && handles.length === 0) {
    throw new Error(
      `search: what to search for? Give words, --from <handle>, or both.`,
    );
  }
  if (
    limit !== undefined &&
    (!/^[1-9]\d*$/.test(limit) || Number(limit) > MAX_LIMIT)
  ) {
    throw new Error(
      `--limit takes a number of posts up to ${String(MAX_LIMIT)}, not "${limit}".`,
    );
  }
  for (const [flag, value] of [
    ["since", since],
    ["until", until],
  ] as const) {
    if (value !== undefined && !DATE.test(value)) {
      throw new Error(`--${flag} takes a day as YYYY-MM-DD, not "${value}".`);
    }
  }
  const count = Number(limit ?? DEFAULT_LIMIT);
  // One search answers with the newest page of posts however often it is
  // repeated, so the next page is asked for as the posts up to the oldest day
  // found so far, until there are enough or a page brings nothing new.
  const posts: Post[] = [];
  let before = until;
  for (let page = 0; page < MAX_PAGES && posts.length < count; page++) {
    const found = await searchOnce({
      before,
      chatId,
      count: count - posts.length,
      handles,
      query,
      sessionId,
      signal,
      since,
    });
    const seen = new Set(posts.map((post) => post.url));
    const fresh = found.filter((post) => !seen.has(post.url));
    if (fresh.length === 0) {
      break;
    }
    posts.push(...fresh);
    before = fresh.map((post) => post.date).toSorted()[0];
  }
  posts.sort((a, b) => b.date.localeCompare(a.date));
  posts.splice(count);
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

/** One search of X, answering with the posts it cited. */
async function searchOnce({
  before,
  chatId,
  count,
  handles,
  query,
  sessionId,
  signal,
  since,
}: XCommandContext & {
  /** `YYYY-MM-DD`, inclusive. */
  before?: string;
  count: number;
  handles: string[];
  query: string;
  signal: AbortSignal | undefined;
  since?: string;
}): Promise<Post[]> {
  const workspaceConfig = getWorkspaceConfig();
  const resolved = await getXSearchModel({
    configs: workspaceConfig.getAIProviderConfigs(),
    fromDate: since,
    handles,
    modelCache: workspaceConfig.modelCache,
    toDate: before,
    workspaceServerURL: getWorkspaceServerURL(),
  });
  if (!resolved.ok) {
    throw new Error(
      "no Grok account is signed in, so X can't be searched. The user can sign in with Grok under Settings › Providers.",
    );
  }
  const { config, model, tools } = resolved.value;
  const authors = handles.map((handle) => `@${handle}`).join(", ");
  const prompt = [
    query ? `Posts about: ${query}` : `The latest posts by ${authors}.`,
    query && handles.length > 0 && `Only posts by ${authors}.`,
    since && `Posted on or after ${since}.`,
    before && `Posted on or before ${before}.`,
    `At most ${String(count)} posts.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateText({
      abortSignal: signal,
      headers: { [CLIENT_SESSION_ID_HEADER]: sessionId },
      instructions: instructions(),
      model,
      output: firstObjectOutput(),
      prompt,
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
    if (error.statusCode === 429) {
      return `the Grok account hit its usage limit; try again later. xAI said: ${detail}`;
    }
    if (error.statusCode === 401 || error.statusCode === 403) {
      return `xAI refused the Grok account (${String(error.statusCode)}). Its plan may not include this, or signing in again under Settings › Providers may help. xAI said: ${detail}`;
    }
    return `X search failed (${String(error.statusCode ?? "no status")}): ${detail}`;
  }
  return `X search failed: ${error instanceof Error ? error.message : String(error)}`;
}
