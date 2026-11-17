import {
  type AIGatewayProviderConfig,
  AIGatewayModelURI,
  getAISDKFastModel,
  hasFastModel,
} from "@instrument-org/ai-gateway";
import { APP_NAME, pageAddress } from "@instrument-org/shared";
import { streamText } from "ai";
import os from "node:os";
import { z } from "zod";

import { getWorkspaceServerURL } from "../../logic/server/url";
import { activityTelemetry } from "../activity/record";
import { readActions } from "../actions/read";
import { actionSentence } from "../actions/sentence";
import { mayShareActions } from "../actions/sharing";
import { getWorkspaceConfig } from "../workspace-config";
import { cut, fileText } from "./file-text";
import { ideasFrom } from "./ideas-from";

/**
 * Ideas for what to ask about the tabs in front of the person, for a tab
 * group with no chat in it and for a new tab: one call to the connection's
 * fast model with what they did in the app lately and the tabs' text, which
 * answers up to three lines or none. Only a Claude account, a ChatGPT
 * account and Instrument have a fast model to spend on it; on any other
 * connection the ideas never show.
 */

export const IdeaTabSchema = z.object({
  /** A page's text as the window's walker read it, or a PDF's. */
  text: z.string().optional(),
  title: z.string(),
  /** A file or folder on this computer, read here with the app's readers. */
  path: z.string().optional(),
  /** Why a page could not be read, when it couldn't. */
  unreadable: z.string().optional(),
  url: z.string().optional(),
});
export type IdeaTab = z.output<typeof IdeaTabSchema>;

/** What set off a call: the tabs settling, or a new tab showing. */
export const IdeaTriggerSchema = z.enum(["tabs", "new-tab"]);

/**
 * How much of each tab goes in, in characters, about 4 to a token: the tab
 * in front, then the next three, then a line for each of the rest.
 */
const FRONT_CHARS = 12_000;
const NEXT_CHARS = 4000;
const READ_IN_FULL = 4;

/** How far back what the person did is read, and how much of it. */
const ACTIONS_SINCE_MS = 30 * 60_000;
const ACTIONS_MAX = 25;

/**
 * Three lines of under 60 characters, twice over: Instrument's and
 * ChatGPT's fast models run with thinking off, so the lines are all they
 * spend. Claude Code takes no cap from a call.
 */
const IDEAS_MAX_OUTPUT_TOKENS = 120;

/** How long ideas stay good for the same tabs. */
const CACHE_MS = 15 * 60_000;

const IDEAS_INSTRUCTION = `You suggest what the person might ask ${APP_NAME}'s agent to do next with what they have open. The agent reads and edits their files, browses the web, uses their connected apps, and makes documents, spreadsheets and pages.

Write up to three ideas, one per line, the most useful first. Each is a message they would send the agent, in their own words: 3 to 9 words, under 60 characters.

- Only ideas worth a press: specific to what's open, naming the actual thing ("Compare Growth vs Scale plan features", not "Compare plans").
- Lean on what they did most recently.
- Never a line that fits any page: no "Summarize this page", "Explain this", "Tell me more".
- Never delete, send, buy, post, book or share anything.
- Never mention tabs, context, activity, or what they were doing.
- Fewer is fine. Reply NONE when nothing specific and useful comes to mind, or what's open is a sign-in screen, an error or empty.

What is worth a press, and what isn't:

- A pricing page with Starter, Growth and Scale plans: "Compare Growth vs Scale plan features", "Which plan fits a 12-person team?" Not "Summarize the pricing".
- A spreadsheet of Q3 expenses by vendor and category: "Total Q3 spend by category", "Find duplicate vendor charges in Q3". Not "Analyze this spreadsheet".
- A contract draft in a Word document: "List the termination clauses in the Acme contract". Not "Review this document".
- A pull request adding retries to an upload client: "List edge cases the upload retry misses". Not "Explain this code".
- A folder of screenshots from a test run: "Turn the test-run screenshots into a bug report". Not "Describe these images".
- An article about heat pumps, just after searching for installers: "Find heat pump installers near me". Not "Tell me more about heat pumps".
- Several tabs of flights to Lisbon: "Compare the Lisbon flights by price and length". Not "Help me plan a trip".
- A sign-in page, an error page, a blank document or an empty folder: NONE.

Reply with only the lines or NONE: no numbering, bullets, quotes or explanation.`;

const cache = new Map<string, { at: number; lines: readonly string[] }>();
const asking = new Map<string, Promise<readonly string[]>>();

/** The connection a model URI runs through, when it has a fast model to spend. */
function fastConnection(
  modelURI: string,
): AIGatewayProviderConfig.Type | undefined {
  const parsed = AIGatewayModelURI.parse(modelURI);
  if (!parsed.ok) {
    return undefined;
  }
  const config = getWorkspaceConfig()
    .getAIProviderConfigs()
    .find((candidate) => candidate.id === parsed.value.params.providerConfigId);
  return config && hasFastModel(config.type) ? config : undefined;
}

/**
 * Up to three ideas for `tabs`, the one in front first, on the fast model of
 * the connection `modelURI` runs through; none where it has no fast model,
 * where the model has nothing specific, or when the call fails. The same
 * `key` within a while answers from memory, and a call already running for
 * it is shared.
 */
export function askIdeas({
  key,
  modelURI,
  tabs,
  trigger,
}: {
  key: string;
  modelURI: string;
  tabs: readonly IdeaTab[];
  trigger: z.output<typeof IdeaTriggerSchema>;
}): Promise<readonly string[]> {
  const kept = cache.get(key);
  if (kept && Date.now() - kept.at < CACHE_MS) {
    return Promise.resolve(kept.lines);
  }
  const running = asking.get(key);
  if (running) {
    return running;
  }
  const asked = ask({ modelURI, tabs, trigger })
    .catch((error: unknown) => {
      getWorkspaceConfig().captureException(error, { area: "ambient-ideas" });
      return [];
    })
    .then((lines) => {
      cache.set(key, { at: Date.now(), lines });
      return lines;
    })
    .finally(() => asking.delete(key));
  asking.set(key, asked);
  return asked;
}

/** Whether ideas can show at all for chats started on `modelURI`. */
export function ideasAvailable(modelURI: string): boolean {
  try {
    return fastConnection(modelURI) !== undefined;
  } catch {
    return false;
  }
}

async function ask({
  modelURI,
  tabs,
  trigger,
}: {
  modelURI: string;
  tabs: readonly IdeaTab[];
  trigger: z.output<typeof IdeaTriggerSchema>;
}): Promise<readonly string[]> {
  const config = fastConnection(modelURI);
  if (!config) {
    return [];
  }
  const workspaceConfig = getWorkspaceConfig();
  const fast = await getAISDKFastModel({
    config,
    modelCache: workspaceConfig.modelCache,
    workspaceServerURL: getWorkspaceServerURL(),
  });
  if (!fast.ok) {
    return [];
  }
  const built = performance.now();
  const context = await contextOf(tabs);
  // A new tab in a group of its own, with nothing done lately: nothing to
  // have an idea about.
  if (context === undefined) {
    return [];
  }
  const contextMs = performance.now() - built;
  const startedAt = performance.now();
  let firstOutputMs: number | undefined;
  let costUsd: number | undefined;
  const result = streamText({
    abortSignal: AbortSignal.timeout(30_000),
    maxOutputTokens: IDEAS_MAX_OUTPUT_TOKENS,
    model: fast.value.model,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta" && firstOutputMs === undefined) {
        firstOutputMs = performance.now() - startedAt;
      }
    },
    // The instruction is the same on every call, so it ends a cached
    // prefix where the provider caches only what it is told to; the tabs
    // after it change with every call.
    instructions: {
      content: IDEAS_INSTRUCTION,
      providerOptions: fast.value.cachePoint as never, // each provider's own options, typed per provider upstream
      role: "system",
    },
    prompt: context,
    providerOptions: fast.value.providerOptions as never, // each provider's own options, typed per provider upstream
    telemetry: activityTelemetry({
      connection: {
        displayName: config.displayName,
        id: config.id,
        type: config.type,
      },
      details: () => ({ costUsd, firstOutputMs, trigger }),
      purpose: "ambient-ideas",
      surface: "tabs",
    }),
  });
  const answer = await result.text;
  const doneMs = performance.now() - startedAt;
  const [usage, metadata, finishReason] = await Promise.all([
    result.totalUsage,
    result.providerMetadata,
    result.finishReason,
  ]);
  costUsd = costOf(metadata);
  // A line the cap cut off is half an idea.
  const whole =
    finishReason === "length"
      ? answer.split("\n").slice(0, -1).join("\n")
      : answer;
  const lines = ideasFrom(whole, {
    instruction: IDEAS_INSTRUCTION,
    titles: tabs.map((tab) => tab.title),
  });
  // One line a call, for reading how a connection performs, the Claude Code
  // harness's own overhead among it: what Claude Code timed itself beside
  // what the call took here.
  const turn = claudeCodeTurn(metadata);
  console.info(
    `[ambient-ideas] ${trigger} on ${config.type} ${fast.value.modelId}: ${lines.length} of ${answer.split("\n").filter(Boolean).length} lines kept, context ${Math.round(contextMs)}ms (${context.length} chars), first words ${firstOutputMs === undefined ? "none" : `${Math.round(firstOutputMs)}ms`}, done ${Math.round(doneMs)}ms, tokens in ${usage.inputTokens ?? "?"} (cache read ${usage.inputTokenDetails.cacheReadTokens ?? "?"}, write ${usage.inputTokenDetails.cacheWriteTokens ?? "?"}) out ${usage.outputTokens ?? "?"}${costUsd === undefined ? "" : `, $${costUsd.toFixed(5)}`}${turn ? `, Claude Code: api ${turn.durationApiMs}ms of ${turn.durationMs}ms, request sent at ${turn.timeToRequestMs ?? "?"}ms, first token at ${turn.ttftMs ?? "?"}ms, process overhead ~${Math.round(doneMs - turn.durationApiMs)}ms` : ""}`,
  );
  return lines;
}

const ClaudeCodeTurnSchema = z.object({
  costUsd: z.number(),
  durationApiMs: z.number(),
  durationMs: z.number(),
  timeToRequestMs: z.number().nullable(),
  ttftMs: z.number().nullable(),
});

function claudeCodeTurn(metadata: unknown) {
  const parsed = z
    .object({ "claude-account": z.object({ turn: ClaudeCodeTurnSchema }) })
    .safeParse(metadata);
  return parsed.success ? parsed.data["claude-account"].turn : undefined;
}

/** What the call cost, where its provider says: Claude Code's estimate, or an OpenRouter-shaped usage's cost. */
function costOf(metadata: unknown): number | undefined {
  const turn = claudeCodeTurn(metadata);
  if (turn) {
    return turn.costUsd;
  }
  const routed = z
    .object({ openrouter: z.object({ usage: z.object({ cost: z.number() }) }) })
    .safeParse(metadata);
  return routed.success ? routed.data.openrouter.usage.cost : undefined;
}

/** A path as the person reads it, their home folder as `~`. */
function readablePath(hostPath: string): string {
  const home = os.homedir();
  return hostPath.startsWith(`${home}/`)
    ? `~${hostPath.slice(home.length)}`
    : hostPath;
}

/** What goes to the model: what the person did lately, then each tab under its budget. */
async function contextOf(
  tabs: readonly IdeaTab[],
): Promise<string | undefined> {
  const parts: string[] = [];
  if (mayShareActions()) {
    const now = Date.now();
    const actions = (await readActions({ since: now - ACTIONS_SINCE_MS }))
      .filter((action) => action.kind !== "capped")
      .toReversed()
      .slice(0, ACTIONS_MAX);
    if (actions.length > 0) {
      parts.push(
        "What they did in the app lately, newest first:",
        ...actions.map(
          (action) =>
            `- ${Math.max(1, Math.round((now - Date.parse(action.at)) / 60_000))}m ago · ${actionSentence(action, readablePath)}`,
        ),
        "",
      );
    }
  }
  if (tabs.length === 0) {
    return parts.length === 0
      ? undefined
      : [...parts, "Nothing else is open beside the new tab."].join("\n");
  }
  parts.push("What they have open, the tab in front first:");
  for (const [index, tab] of tabs.entries()) {
    const where = tab.path
      ? readablePath(tab.path)
      : tab.url
        ? pageAddress(tab.url)
        : undefined;
    const heading = `\n## ${index === 0 ? "In front: " : ""}${tab.title}${where ? ` (${where})` : ""}`;
    if (index >= READ_IN_FULL) {
      parts.push(heading);
      continue;
    }
    const budget = index === 0 ? FRONT_CHARS : NEXT_CHARS;
    const read: { text: string } | { unreadable: string } =
      tab.text !== undefined
        ? { text: cut(tab.text, budget) }
        : tab.path
          ? await fileText(tab.path, budget)
          : { unreadable: tab.unreadable ?? "not read" };
    parts.push(
      heading,
      "text" in read
        ? read.text
        : `(This one couldn't be read: ${tab.unreadable ?? read.unreadable}.)`,
    );
  }
  return parts.join("\n");
}
