import {
  CLIENT_SESSION_ID_HEADER,
  getXSearchModel,
} from "@instrument-org/ai-gateway";
import { APICallError, streamText } from "ai";
import { defineCommand } from "just-bash";
import { dedent } from "radashi";

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

const USAGE = `Usage: ${NAME} search "<query>" [--from <handle>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--limit <n>]

  ${NAME} search "<query>"
      Posts on X that answer the query, each with its author, date and link,
      found by Grok on the user's Grok account.
      --from <handle>   Only posts by this account (repeat for several).
      --since <date>    Only posts from this day on.
      --until <date>    Only posts up to this day.
      --limit <n>       At most this many posts.
`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What `x` needs from the `bash` call it runs inside. */
export interface XCommandContext {
  chatId: ChatId;
  sessionId: StoreId.Session;
}

/**
 * X search as a command rather than a tool: it is there in every shell on
 * every model, so the tool definitions a provider caches never change with
 * whether a Grok account is signed in, and a missing account, a usage limit
 * or a refusal reaches the agent as the reason it failed.
 */
export function createXCommand(context: XCommandContext) {
  return defineCommand(NAME, (args, ctx) => runX(args, context, ctx));
}

const runX = defineSubcommands<XCommandContext>({
  name: NAME,
  subcommands: {
    search: subcommand({
      flags: ["from", "limit", "since", "until"],
      repeatable: ["from"],
      run: (input, context, { signal }) =>
        search(
          {
            from: input.all("from"),
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
    You look up posts on X now with x_search and report what you find. Today is ${today}. Never answer from memory, and never ask a question back: whoever asked cannot answer, so search with what you were given.

    - Search once; search again only when the first results miss the query entirely. The filters given are already applied to x_search: "my" or "latest" in a query searched with an author filter means that author's newest posts.
    - List the posts that answer the query, newest first: the author's handle, the date, the post's words as written, and its link (https://x.com/<handle>/status/<id>). Then, in a sentence or two, what they add up to when that helps.
    - Leave out anything you did not find. When nothing matches, say so plainly.
  `;
}

async function search(
  {
    from,
    limit,
    query,
    since,
    until,
  }: {
    from: string[];
    limit?: string;
    query: string;
    since?: string;
    until?: string;
  },
  { chatId, sessionId }: XCommandContext,
  signal: AbortSignal | undefined,
) {
  if (!query) {
    throw new Error(`search: what to search for? ${USAGE}`);
  }
  if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) {
    throw new Error(`--limit takes a number of posts, not "${limit}".`);
  }
  for (const [flag, value] of [
    ["since", since],
    ["until", until],
  ] as const) {
    if (value !== undefined && !DATE.test(value)) {
      throw new Error(`--${flag} takes a day as YYYY-MM-DD, not "${value}".`);
    }
  }
  const workspaceConfig = getWorkspaceConfig();
  const resolved = await getXSearchModel({
    configs: workspaceConfig.getAIProviderConfigs(),
    fromDate: since,
    handles: from.map((handle) => handle.replace(/^@/, "")),
    modelCache: workspaceConfig.modelCache,
    toDate: until,
    workspaceServerURL: getWorkspaceServerURL(),
  });
  if (!resolved.ok) {
    throw new Error(
      "no Grok account is signed in, so X can't be searched. The user can sign in with Grok under Settings › Providers.",
    );
  }
  const { config, model, tools } = resolved.value;
  const handles = from.map((handle) => `@${handle.replace(/^@/, "")}`);
  const prompt = [
    `Search X for: ${query}`,
    handles.length > 0 && `Only posts by ${handles.join(", ")}.`,
    since && `Posted on or after ${since}.`,
    until && `Posted on or before ${until}.`,
    limit && `At most ${limit} posts.`,
  ]
    .filter(Boolean)
    .join("\n");

  const sources = new Map<string, string | undefined>();
  let text = "";
  try {
    const result = streamText({
      abortSignal: signal,
      headers: { [CLIENT_SESSION_ID_HEADER]: sessionId },
      instructions: instructions(),
      model,
      prompt,
      telemetry: activityTelemetry({
        chatId,
        connection: config,
        kind: "search",
        purpose: "x-search",
        sessionId,
      }),
      toolChoice: "required",
      tools,
    });
    for await (const part of result.stream) {
      if (part.type === "error") {
        throw part.error;
      }
      if (part.type === "text-delta") {
        text += part.text;
      } else if (part.type === "source" && part.sourceType === "url") {
        sources.set(part.url, part.title);
      }
    }
  } catch (error) {
    throw new Error(refusal(error), { cause: error });
  }

  const links = [...sources].map(
    ([url, title]) =>
      `- ${title && title !== url ? `[${title}](${url})` : url}`,
  );
  return (
    [
      text.trim() || "Nothing found.",
      ...(links.length > 0 ? ["", "Sources:", ...links] : []),
    ].join("\n") + "\n"
  );
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
