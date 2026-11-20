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
import { getWorkspaceConfig } from "../workspace-config";
import { cut, fileText } from "./file-text";
import { ideasFrom } from "./ideas-from";

/**
 * Ideas for what to ask about the tabs in front of the person, for a tab
 * group with no chat in it and for a new chat beside them: one call to the
 * connection's fast model with the tabs' text, which answers up to three
 * lines or none, and no call at all with no tabs. Only a Claude
 * account, a ChatGPT account and Instrument have a fast model to spend on
 * it; on any other connection the ideas never show. Calls the tabs changing
 * set off are paced (`pace`); one the person asks for always goes.
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

/**
 * Three lines of under 60 characters, twice over: Instrument's and
 * ChatGPT's fast models run with thinking off, so the lines are all they
 * spend. Claude Code takes no cap from a call.
 */
const IDEAS_MAX_OUTPUT_TOKENS = 120;

/** How long ideas stay good for the same tabs. */
const CACHE_MS = 15 * 60_000;

/**
 * How often the tabs changing may set off a call: once an interval, which
 * starts at `PACE_START_MS`, doubles each time a set they set off goes
 * untaken, up to `PACE_MAX_MS`, halves when the person moves to another
 * group or opens a file, and starts over when they take an idea or ask.
 */
const PACE_START_MS = 30_000;
const PACE_MAX_MS = 5 * 60_000;

/** When a call the tabs set off finds one running, how long until it is tried again. */
const BUSY_RETRY_MS = 5000;

const pace = {
  intervalMs: PACE_START_MS,
  lastCallAt: 0,
  /** The last set the tabs set off had lines, and none has been taken since. */
  isUntaken: false,
};

/** Calls waiting or running, which go one at a time. */
let calls = 0;
let lastCall: Promise<unknown> = Promise.resolve();

const instructionFor = (aboutWhat: string) =>
  `You suggest what the person might ask ${APP_NAME}'s agent to do next with what they have open. The agent reads and edits their files, browses the web, uses their connected apps, and makes documents, spreadsheets and pages.

Write up to three ideas, one per line, the most useful first: messages they would send, 3 to 9 words, under 60 characters, naming the actual thing ("Compare Growth vs Scale plan features", not "Compare plans").

- ${aboutWhat}
- Never a line that fits any page, such as "Summarize this page".
- Never delete, send, buy, post, book or share anything.
- Never mention tabs or what they were doing.
- Reply NONE only for a blank, error or sign-in page, or one with next to nothing on it, like example.com.

Reply with only the lines or NONE, and nothing else.`;

/** One per trigger, each word for word the same on every call, for the cache. */
const INSTRUCTIONS = {
  "new-tab": instructionFor(
    "Only about what's open beside the new chat, the tab in front first, never anything else.",
  ),
  tabs: instructionFor(
    "Only about what's open here, the tab in front first, never anything else.",
  ),
} satisfies Record<z.output<typeof IdeaTriggerSchema>, string>;

const cache = new Map<string, { at: number; lines: readonly string[] }>();
const asking = new Map<string, Promise<readonly string[]>>();

/** Ideas for a set, or, for a call the tabs set off that had to wait, when to try again. */
export type IdeasAnswer = { lines: readonly string[] } | { retryInMs: number };

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
 * it is shared. A call the person `asked` for waits its turn behind one
 * running; one the tabs set off goes only when the pace allows and nothing
 * is running, and otherwise answers when to try again.
 */
export async function askIdeas({
  asked,
  key,
  modelURI,
  tabs,
  trigger,
}: {
  asked: boolean;
  key: string;
  modelURI: string;
  tabs: readonly IdeaTab[];
  trigger: z.output<typeof IdeaTriggerSchema>;
}): Promise<IdeasAnswer> {
  if (asked) {
    setPace(PACE_START_MS, "they asked");
    pace.isUntaken = false;
  }
  const kept = cache.get(key);
  if (kept && Date.now() - kept.at < CACHE_MS) {
    return { lines: kept.lines };
  }
  const running = asking.get(key);
  if (running) {
    return { lines: await running };
  }
  if (!asked) {
    const waitMs = pace.lastCallAt + pace.intervalMs - Date.now();
    if (calls > 0 || waitMs > 0) {
      console.info(
        `[ambient-ideas] ${trigger} skipped: ${calls > 0 ? "a call is running" : `${seconds(waitMs)} left of the ${seconds(pace.intervalMs)} interval`}`,
      );
      return { retryInMs: Math.max(waitMs, BUSY_RETRY_MS) };
    }
    if (pace.isUntaken) {
      setPace(
        Math.min(pace.intervalMs * 2, PACE_MAX_MS),
        "the last set went untaken",
      );
    }
  }
  calls += 1;
  const call = lastCall
    .then(() => ask({ asked, modelURI, tabs, trigger }))
    .catch((error: unknown) => {
      getWorkspaceConfig().captureException(error, { area: "ambient-ideas" });
      return [];
    })
    .then((lines) => {
      cache.set(key, { at: Date.now(), lines });
      if (!asked) {
        pace.isUntaken = lines.length > 0;
      }
      return lines;
    })
    .finally(() => {
      calls -= 1;
      asking.delete(key);
    });
  lastCall = call;
  asking.set(key, call);
  return { lines: await call };
}

/**
 * What the person did that changes the pace: took an idea, which starts it
 * over, or moved to another group or opened a file, which steps it back.
 */
export function noteIdeasPace(event: "moved" | "taken") {
  if (event === "taken") {
    setPace(PACE_START_MS, "an idea was taken");
    pace.isUntaken = false;
    return;
  }
  setPace(
    Math.max(PACE_START_MS, pace.intervalMs / 2),
    "moved to another group or opened a file",
  );
}

function setPace(intervalMs: number, why: string) {
  if (intervalMs !== pace.intervalMs) {
    console.info(
      `[ambient-ideas] pace ${seconds(pace.intervalMs)} → ${seconds(intervalMs)}: ${why}`,
    );
  }
  pace.intervalMs = intervalMs;
}

function seconds(ms: number) {
  return `${Math.ceil(ms / 1000)}s`;
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
  asked,
  modelURI,
  tabs,
  trigger,
}: {
  asked: boolean;
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
  // A new tab in a group of its own: nothing to have an idea about.
  if (context === undefined) {
    return [];
  }
  const contextMs = performance.now() - built;
  const instruction = INSTRUCTIONS[trigger];
  pace.lastCallAt = Date.now();
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
      content: instruction,
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
    instruction,
    titles: tabs.map((tab) => tab.title),
  });
  // One line a call, for reading how a connection performs, the Claude Code
  // harness's own overhead among it: what Claude Code timed itself beside
  // what the call took here.
  const turn = claudeCodeTurn(metadata);
  console.info(
    `[ambient-ideas] ${trigger}${asked ? " asked" : ""} on ${config.type} ${fast.value.modelId}: ${lines.length} of ${answer.split("\n").filter(Boolean).length} lines kept, context ${Math.round(contextMs)}ms (${context.length} chars), first words ${firstOutputMs === undefined ? "none" : `${Math.round(firstOutputMs)}ms`}, done ${Math.round(doneMs)}ms, tokens in ${usage.inputTokens ?? "?"} (cache read ${usage.inputTokenDetails.cacheReadTokens ?? "?"}, write ${usage.inputTokenDetails.cacheWriteTokens ?? "?"}) out ${usage.outputTokens ?? "?"}${costUsd === undefined ? "" : `, $${costUsd.toFixed(5)}`}${turn ? `, Claude Code: api ${turn.durationApiMs}ms of ${turn.durationMs}ms, request sent at ${turn.timeToRequestMs ?? "?"}ms, first token at ${turn.ttftMs ?? "?"}ms, process overhead ~${Math.round(doneMs - turn.durationApiMs)}ms` : ""}`,
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

/** What goes to the model: each tab under its budget, or nothing with no tabs. */
async function contextOf(
  tabs: readonly IdeaTab[],
): Promise<string | undefined> {
  if (tabs.length === 0) {
    return undefined;
  }
  const parts = ["What they have open, the tab in front first:"];
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
