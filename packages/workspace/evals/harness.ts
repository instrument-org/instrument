import "dotenv/config";
import {
  aiGatewayApp,
  AIGatewayModelURI,
  noopModelCache,
  type ReasoningEffort,
} from "@instrument-org/ai-gateway";
import { APP_NAME_SLUG } from "@instrument-org/shared";
import { call } from "@orpc/server";
import { execa } from "execa";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import * as _ from "radashi";
import { ulid } from "ulid";
import { createActor } from "xstate";

import type { Session } from "../src/schemas/session";

import {
  attachChats,
  ensurePythonBase,
  prepareBundledSkills,
  workspaceMachine,
} from "../src/electron";
import { type WorkspaceActorRef } from "../src/machines/workspace";
import { createMemoryAppsConfig } from "../src/lib/apps/memory-config";
import { workspaceLayout } from "../src/lib/workspace-layout";
import { setBashWorkerFactory } from "../src/lib/bash-worker/client";
import { isToolPart } from "../src/lib/is-tool-part";
import { listChatBackgroundProcesses } from "../src/lib/background-processes";
import { isWorking } from "../src/lib/chat/activity";
import { isTypedByUser } from "../src/lib/typed-by-user";
import { wakeChatWithTaskEvent } from "../src/lib/chat/wake";
import { type ChatTask, listChildTasks } from "../src/lib/chat/children";
import { outputFolderPath } from "../src/lib/chat/output-folder";
import { openAsks } from "../src/lib/chat/open-asks";
import { ChatReads } from "../src/lib/chat-reads";
import { getUsageSummary } from "../src/lib/usage-summary";
import {
  getUsageSummaryFromMessages,
  type UsageSummary,
} from "../src/lib/usage-summary-compute";
import { publisher } from "../src/rpc/publisher";
import { message as messageRoute } from "../src/rpc/routes/message";
import { session as sessionRoute } from "../src/rpc/routes/session";
import { chats as chatsRoute } from "../src/rpc/routes/chats";
import { permissions as permissionsRoute } from "../src/rpc/routes/permissions";
import { type FileUpload } from "../src/schemas/file-upload";
import { type SessionMessageDataPart } from "../src/schemas/session/message-data-part";
import { type SessionMessagePart } from "../src/schemas/session/message-part";
import { createTsxBashWorker } from "../src/test/helpers/tsx-bash-worker";
import { type ChatId } from "../src/schemas/chat-id";
import { createStubBrowserConfig } from "../src/test/helpers/mock-chat-config";
import { platformSearchClient } from "./lib/platform-search";
import {
  type CostSource,
  costSourceOf,
  describeCost,
  modelCostUSD,
  readChatSpend,
  type RunCost,
  runCostOf,
} from "./lib/run-cost";
import { type AppFixture, seedConnectedApps } from "./lib/connected-app";
import {
  answerSignIn,
  cardOnlySignIns,
  endSignIn,
  type SignInOutcome,
} from "./lib/sign-in-ends";
import { createStandInWindow } from "./lib/stand-in-window";
import { EVAL_MACHINE_DIR_NAME, recordRun } from "./lib/run-record";
import { grantCaseFolders, startRun } from "./lib/start-run";
import { timeOutTaskTurn } from "./lib/time-out-task";
import {
  buildProviderConfigs,
  c,
  fetchOpenRouterCatalog,
  formatCost,
  formatNumber,
  resolveRegistryDir,
  write,
} from "./utils";
import { resolveChat, sessionOfChat } from "../src/lib/record-folders";
import { ensureChat } from "../src/lib/chat/chat-records";
import { createTopic, updateTopic } from "../src/lib/chat/topics";
import { StoreId } from "../src/schemas/store-id";
import { type WorkspaceConfig } from "../src/types";
import { makeToolBinIn } from "../scripts/lib/tool-bin-dir";
import { newDeviceId } from "../src/lib/records/device-id";
import { askedOnCard } from "../src/tools/connect-app-output";

/** The Mac helper a checkout builds, when it has; see the harness input. */
/** The Seatbelt launcher the same build makes, which native commands start through. */
const SEATBELT_LAUNCHER = path.resolve(
  import.meta.dirname,
  "../../../apps/studio/native/mac-helper/.build/bridge/instrument-seatbelt",
);
const MAC_HELPER_BIN = path.resolve(
  import.meta.dirname,
  "../../../apps/studio/native/mac-helper/.build/bridge/instrument-mac",
);
/** The uutils binaries `pnpm --filter @instrument-org/studio uutils:download` vendors. */
const UUTILS_DIR = path.resolve(
  import.meta.dirname,
  "../../../apps/studio/resources/uutils",
);

// The pnpm the app ships, as its JS entry: the workspace runs pnpm with node,
// so a shell shim from PATH (pnpm's own installer writes one) dies on line 2.
const PNPM_BIN = path.join(
  path.dirname(
    createRequire(
      path.resolve(import.meta.dirname, "../../../apps/studio/package.json"),
    ).resolve("pnpm"),
  ),
  "bin",
  "pnpm.mjs",
);

export interface Assertion {
  check: (ctx: AssertionContext) => AssertionResult | Promise<AssertionResult>;
  text: string;
}

export interface AssertionResult {
  evidence: string;
  passed: boolean;
  text: string;
}

function evalPrefix(name: string): string {
  return `${c.dim}[${name}]${c.reset} `;
}

/**
 * There is no default model set, on purpose.
 *
 * A list living in this file is a list nobody re-reads: it goes stale as
 * providers ship, and it answers the question it was written for rather than
 * the one being asked now. Worse, a default is what an unattended agent takes,
 * so the models a change is validated against end up chosen by whoever last
 * edited a constant, months ago, for something else.
 *
 * So `--model` is required, and `eval models` lists what the configured
 * providers can actually run today. Whoever runs the harness picks from that
 * and says why they picked it.
 *
 * The one hint: this is the model the project is usually tested against, named
 * in the error a bare `run` produces so the cheapest reasonable choice is one
 * copy away. Nothing reads it otherwise, so it going stale costs a sentence in
 * an error message rather than a run against a model nobody chose.
 *
 * It is metered, which the free Workers AI models it replaced were not, and
 * that is the price of a floor that passes the behavior the prompts are
 * written to produce. Measured 2026-10-15 across ten models on five cases:
 * every Workers AI and lite model, our own floor among them, left finished
 * work in the chat's folder instead of the person's output folder, and this
 * one did not. A floor that fails the product's own central rule reports a
 * prompt change as working when it is not. Five cases cost about two cents.
 */
export const HOUSE_FLOOR = "anthropic/claude-haiku-5.5";

export interface CompletedRun {
  /** Every task this run's chat started, by its session. Empty unless it forked. */
  childSessionIds: StoreId.Session[];
  /** How `costUSD` and `searchCostUSD` were arrived at, step by step. */
  cost: RunCost;
  /** Whether `costUSD` is what the provider billed, a catalog estimate, or both. */
  costSource?: CostSource;
  /**
   * USD for the run's model requests: billed where each response said, else
   * priced from the catalog. Absent when neither could price a step. Web
   * searches are `searchCostUSD`, not this.
   */
  costUSD?: number;
  label: string;
  metrics: RunMetrics;
  /** The sanitized model id, as it appears in the label and the results path. */
  modelLabel: string;
  modelURI: string;
  /** The eval case this run came from, so a report can find it by task id. */
  name: string;
  /** The run's spend at the moment a cap stopped it; absent if it finished. */
  overBudget?: { costUSD?: number; tokens: number };
  /**
   * The build a `~<name>-latest` alias stood for when this ran. Absent for a pinned
   * model, where `modelURI` already says it.
   */
  resolvedModelId?: string;
  /**
   * The session the case's prompt went to: the chat's own, or for a task
   * case, the task the run started from an empty chat.
   */
  sessionId: StoreId.Session;
  /** USD estimated for the run's web searches, apart from `costUSD`. */
  searchCostUSD?: number;
  /** Absent when the agent ended the turn itself. */
  stoppedBy?: RunStop;
  /** The chat the run is in. */
  chatId: ChatId;
  /** This task plus every task it started. Equal to `usage` when it forked nothing. */
  treeUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** 1-based, and only meaningful when `repeat` asked for more than one. */
  trial: number;
  /** The run's session alone, which for a chat is the conversation only. */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/**
 * What a run cost the person waiting on it, as opposed to what it produced.
 * Times are from the case's first message being sent.
 */
export interface RunMetrics {
  /** Cached input tokens across the tree, for pricing a run. */
  cacheReadTokens: number;
  /**
   * When the run was last working: the last turn's end for a task, and the
   * moment the whole tree went quiet for a chat, not the moment the harness
   * finished waiting to be sure of it.
   */
  doneMs: number;
  /**
   * The first non-empty text the run's own agent streamed: the chat's for a
   * chat case, never a task's. Absent when it never wrote any.
   */
  firstTextMs?: number;
  /** See `EvalCase.marks`: milliseconds to each, `null` when never seen. */
  marks?: Record<string, null | number>;
  /**
   * Shell calls anywhere in the tree whose output refused them or named an
   * unknown flag, option or command: a call the agent got wrong. `task`
   * counts the ones that ran a `task` command, the hand-off calls.
   */
  refusals: { all: number; task: number };
  /** `instrument task new` commands the run's own agent ran. */
  taskCommands: { new: number };
  /** Tasks the run started, however deep. */
  tasksCreated: number;
  /** Tool calls by every agent in the tree. */
  toolCalls: number;
  /**
   * Each message the user typed, in order, by how the conversation's own
   * replies to it began: see `TurnShape`.
   */
  turnShapes?: TurnShape[];
  /**
   * Each message the user typed, in order: how long from it being sent to
   * the conversation's last reply before the next one (or the end), the
   * tokens the conversation's own replies spent in that span, and the
   * characters of text they showed. The conversation's own, not its tasks'.
   */
  turns?: { chars: number; ms: number; tokens: number }[];
  /** `duringWork` follow-ups sent after the turn ended instead of inside it. */
  duringWorkMissed?: number;
  /**
   * Characters of assistant text in the run's own sessions: what the user
   * reads. For a chat that is the chat's replies, not its tasks'.
   */
  visibleChars: number;
}

/**
 * How the conversation's replies to one typed message began: the first
 * non-empty text, verbatim; whether it came before the first tool call
 * (absent when nothing called a tool); how many text parts and tool calls
 * the replies held, so a turn that needed no tools and said two things shows
 * as such; every non-empty text part, verbatim, each one a message the user
 * sees; and each step's tokens, cached input included.
 */
export interface TurnShape {
  firstText?: string;
  steps: {
    cacheReadTokens: number;
    inputTokens: number;
    outputTokens: number;
    text: boolean;
    toolCalls: number;
  }[];
  textBeforeTool?: boolean;
  textParts: number;
  texts?: string[];
  toolCalls: number;
}

/**
 * Why a run ended somewhere other than the agent deciding it was finished.
 * `unknown` is what a report over a past workspace can tell: the session was
 * stopped, and nothing recorded on the task says by what.
 */
export type RunStop = "budget" | "case" | "timeout" | "unknown";

/** A run's spend so far, as the caps read it: `costUSD` searches included. */
interface Spend {
  costUSD?: number;
  tokens: number;
  usage: UsageSummary;
}

/**
 * Ceiling on one run's spend in dollars before the harness stops it: its
 * model requests (`RunCost`, billed where the response said) and its
 * searches together.
 *
 * Dollars rather than tokens because an agent's tokens are mostly cache
 * reads, which bill at a tenth of a fresh token or less: a browse-and-build
 * run passed a million tokens for about four cents, and a 35-turn
 * conversation on Claude Haiku 5.5 passed twelve million for under a
 * dollar. Twice that is room for a long legitimate run and a stop for a
 * runaway before it costs real money; a pricier model's long run needs
 * `--max-run-cost` raised.
 */
export const DEFAULT_MAX_RUN_COST_USD = 2;

/**
 * Ceiling on one run's total tokens, by default only for a run whose cost
 * cannot be read (a free model, or one with no catalog price), which the
 * dollar cap cannot see. Measured on such runs: the most expensive legitimate
 * one was around 700K, and the cheapest runaway was 1.3M.
 */
export const DEFAULT_MAX_RUN_TOKENS = 1_000_000;

/**
 * Ceiling on one run's wall clock. The token cap does not cover a run that
 * stops producing anything at all -- a stalled request, a session that never
 * reports itself done -- and that failure hangs the whole suite behind it,
 * which is why every recorded invocation of this harness wraps it in `timeout`.
 */
export const DEFAULT_MAX_RUN_SECONDS = 1800;

/**
 * How often a run's spend is checked against the caps.
 *
 * The check also runs on every completed tool call, which is where a runaway
 * usually shows first. This interval is what covers the case tool calls cannot:
 * a model looping on text or reasoning makes no tool calls at all, so nothing
 * event-driven ever looks at its total.
 *
 * Both readings come from the stored messages, and usage only lands there when
 * an assistant message is saved -- so the total does not move within a turn,
 * however many tool calls that turn makes. The token and cost caps therefore
 * act at step boundaries, and the wall-clock cap is the only thing bounding a
 * single step that will not end.
 */
const ENFORCEMENT_INTERVAL_MS = 15_000;

/**
 * How long a case's own stop waits for the step it stopped at to end, and how
 * often it looks. The provider's last chunk follows the last call it asks for
 * within moments, so this is a ceiling for a stream that stalls.
 */
const STEP_END_WAIT_MS = 10_000;
const STEP_END_POLL_MS = 50;

/** After a stop is issued, how long to wait for the session to actually end. */
const STOP_GRACE_MS = 60_000;

/** How long a `stopChat` follow-up waits, once its moment comes, before pressing Stop. */
const STOP_CHAT_AFTER_MS = 3000;

/**
 * How long every task in a chat's tree has to sit idle before the run
 * is called finished.
 *
 * A chat's own turn ends the moment it hands work off, which is the
 * middle of the run rather than the end of it: the children are still working,
 * and the wake carrying their results back into the conversation is on a 1.5s
 * debounce behind them. A run that stopped at the first `session.done` would
 * score the hand-off and never see the report, which is the half that matters.
 * This has to stay comfortably above that debounce, since the gap between a
 * child finishing and its wake starting a turn reads as quiet.
 */
const TREE_QUIET_MS = 6000;

/** How long between one sign-in answered on a card and the next (`signInsAnswerAs`). */
const SIGN_IN_GAP_MS = 2000;

/** How often the tree is sampled while waiting for it to go quiet. */
const TREE_POLL_MS = 500;

/**
 * How long an answer to a card waits for the asking session's turn to end
 * before it goes in anyway, for an agent that keeps working past an ask.
 */
const ANSWER_AFTER_TURN_MAX_MS = 120_000;

export interface EvalCase {
  /**
   * What the user answers to each `choose` the agent puts to them, in the
   * order it asks, sent through the same route the card answers with. A
   * function gets the question as asked, for an answer that picks one of the
   * choices the model wrote. A question asked past the end of the list is
   * left open, as one the person has not answered.
   */
  answers?: (
    | ((
        input: Extract<
          SessionMessagePart.ToolPartInputAvailable,
          { type: "tool-choose" }
        >["input"],
      ) => ChooseAnswer)
    | ChooseAnswer
  )[];
  /**
   * Connected apps to stand up before the run, each a real loopback server with
   * a real manifest and a connection on record. For the paths that only exist
   * once a service is reachable: calling it, from the chat or a task.
   *
   * One apps directory serves every case in a run, so these are listed in every
   * case's context, not only this one's. Run an app case on its own. A task
   * case reaches these, as every fork reaches the chat's apps.
   */
  apps?: AppFixture[];
  assertions?: Assertion[];
  /**
   * This case's own token cap, over the run's (`--max-run-tokens`), for a
   * long conversation whose legitimate total is past the default. It
   * applies whether or not the run's cost can be read.
   */
  maxRunTokens?: number;
  /**
   * Called with a follow-up's position just before it is sent, for a case
   * that has to see what the run had made by then: a draft the follow-up
   * asks to change, say.
   */
  beforeFollowUp?: (position: number) => Promise<void> | void;
  /**
   * Every folder the agent runs into and asks for is answered as the user
   * saying not now: for what the agent does once a folder is refused.
   */
  declinesFolders?: boolean;
  /** Every app the agent asks to use is answered as the user saying not now. */
  declinesApps?: boolean;
  /** Every app the agent asks to use is answered as the user allowing it. */
  allowsApps?: boolean;
  /**
   * Every sign-in card the conversation's agent puts up (`connect_app` on an
   * app that signs in) ends this way once its turn settles, as the app's
   * callback would record it: the service refusing the account, a sign-in
   * that failed, or one stopped or left to lapse. The chat is woken through
   * the real app-event path. Chat cases only; the run's apps get a sign-in
   * the card can start and nobody finishes.
   */
  signInsEndAs?: SignInOutcome;
  /**
   * Every sign-in card row the conversation's agent puts up is answered once
   * its turn settles, one at a time a couple of seconds apart, the way a
   * person works down a card: connected (as `you@example.com`), or skipped,
   * by slug, connected where the map names nothing. Through the real
   * app-event path, so whatever the answers wake is what the run scores.
   */
  signInsAnswerAs?: Record<string, "connected" | "declined">;
  files?: FileUpload.Type[];
  /**
   * How many folder cards the user allows in this chat, in the order they
   * come up. A card past that goes unanswered, as one nobody clicks.
   */
  allowsFolders?: number;
  /**
   * Folders sent with the prompt, each already granted to the chat
   * (`grantCaseFolders`), as an earlier Allow in it would leave them.
   *
   * `inPlace` attaches the folder where it is rather than a per-run copy:
   * for a folder under the run's home, which `setup` made and which a
   * process with a home of its own (`INSTRUMENT_EVAL_HOME`) does not share.
   */
  folders?: {
    inPlace?: boolean;
    path: string;
  }[];
  /**
   * Further user turns, sent one at a time on the same session once the turn
   * before it has settled. For behavior that only exists across turns: a
   * context rollover, or anything the agent is supposed to carry forward
   * rather than re-derive. Assertions see every session the run produced.
   *
   * A string is sent once the conversation's own turn ends, which for a chat
   * is while its tasks may still be working. `settled` waits for every task
   * in the tree as well, the way a person waits to read a reply before
   * answering it. `afterMs` sends that long after the previous message
   * without waiting at all, so it lands while the work is under way, as a
   * correction typed mid-job does. `duringWork` sends it while the
   * conversation's own agent has a tool call in flight.
   */
  followUps?: (FollowUp | string)[];
  /**
   * For a chat case scored on what the conversation does when a task
   * reports, not on the task's work: every task the conversation starts is
   * stopped as soon as its first turn settles, and the conversation is woken
   * through the real wake path as if it had finished, saying `said` and
   * leaving `leavesOpen` as window tabs it opened. A run's tasks browse in a
   * Chrome of their own, so this is the only way a finish note names a
   * window tab, and it saves the minutes and tokens of the work itself.
   */
  finishesAs?: {
    leavesOpen?: { at: string; id: string }[];
    said: string;
  };
  /**
   * Where the prompt is answered. A chat forks tasks inside the same
   * workspace, so a run of that kind produces the chat's transcript plus one
   * per task it made. A task case runs the agent in a task of a chat the run
   * makes for it (`startRun`), as a fork is told what to do.
   */
  kind?: "chat" | "task";
  /**
   * Moments to time: from the user message containing `after` being sent
   * (the first message when absent) to the first assistant text streamed in
   * the run's own task that matches `match`, so how long the user waited
   * for one answer in particular. Recorded in the run's metrics and in
   * `$HOME/.eval-marks/<task id>.json`, where an assertion reads them, `null`
   * when nothing matched.
   */
  marks?: { after?: string; match: RegExp; name: string }[];
  name: string;
  /**
   * Native commands run under Seatbelt on macOS, as Studio runs them, for
   * every case in the run once any case asks: for a case whose agent may
   * reach for processes it did not start, which unwrapped could reach the
   * rest of this computer's.
   */
  nativeSandbox?: boolean;
  /**
   * The run is not over while a command the agent left running in the
   * background is still going: for a case scored on what the agent does
   * when one ends after its turn and wakes it. A process that never exits
   * holds the run to its time cap.
   */
  outlivesTurn?: boolean;
  /** Read after `setup`, so a getter can name something setup made. */
  prompt: string;
  /**
   * Run before the case's task is created, with the run's home and workspace
   * in place: for fixtures that have to be made rather than copied, such as
   * files whose modification times matter, or a memory already kept.
   */
  setup?: () => Promise<void> | void;
  /**
   * Run once the run has settled, before anything is scored: to record what
   * an assertion reads about the computer at the end (whether a fixture is
   * still running) and to stop what `setup` started and what the run's chat
   * left running.
   */
  teardown?: (run: { chatId: ChatId }) => Promise<void> | void;
  shouldStop?: (
    part: SessionMessagePart.Type,
    chatId: ChatId,
  ) => boolean | Promise<boolean>;
  /**
   * The topic the chat is filed under from its first message, made before
   * the run with these instructions, the way a chat started from a topic in
   * the window is. Chat cases only.
   */
  topic?: { instructions: string; name: string };
  /**
   * What the window showed as the case's message was sent, as the note on it:
   * the tabs open, by their ids, and the page or screen up. The tabs it names
   * are open in a stand-in window for the run, which answers `tab` and makes
   * `--tab` accept a page tab's id.
   */
  viewing?: SessionMessageDataPart.ViewContextDataPart;
}

interface AssertionContext {
  /**
   * Every task this one started, with its sessions: what a chat case
   * needs, since the work it is scored on happened in those rather than in the
   * conversation. A function because reading them costs a directory scan per
   * task and most assertions never ask.
   */
  childSessions: () => Promise<ChildTaskSessions[]>;
  sessions: Session.WithMessagesAndParts[];
  chatId: ChatId;
}

interface ChildTaskSessions {
  /** The task's session, which is its id. */
  sessionId: StoreId.Session;
  /** Its own messages, without the conversation it carries on from. */
  sessions: Session.WithMessagesAndParts[];
  title: string;
}

type ChooseAnswer = SessionMessageDataPart.QuestionAnswerDataPart["answer"];

type FollowUp = FollowUpTiming &
  (
    | { prompt: string }
    | {
        /**
         * The user pressing Stop on one of the chat's tasks, by its handle,
         * in place of a message: what the task's page and the chat's task
         * list do. A person stops a task they can see, so this waits for the
         * chat to start it, and counts `afterMs` from the task's start when
         * that came after the last message. Nothing is pressed when the
         * chat's turn ends without starting it.
         */
        stopTask: string;
      }
    | {
        /**
         * The user pressing Stop beside Send in place of a message: the
         * chat's own turn ends, and its tasks keep working.
         */
        stopChat: true;
      }
    | {
        /**
         * One of the chat's tasks, by its handle, losing its model: every
         * request its running turn makes from here goes past its chunk
         * timeout, until the retries run out and the turn ends on the
         * timeout. Waits for the task the way `stopTask` does.
         */
        timeOutTask: string;
      }
  );

interface FollowUpTiming {
  afterMs?: number;
  /**
   * Sent while the conversation's own agent is mid tool work: once it has
   * finished `afterToolCalls` tool calls since the previous message was sent,
   * at the moment its next call is in flight. For a message that has to land
   * inside foreground work rather than between turns. Sent when the turn ends
   * instead, should it end first; `duringWorkMissed` in the run's metrics
   * counts those, and the report fails a run that has any. With `command`, the call in flight has to be a `bash` call
   * whose command matches it, for a message that has to land inside one
   * command in particular when a step makes several calls at once.
   */
  duringWork?: { afterToolCalls: number; command?: RegExp };
  settled?: boolean;
}

export function defineEval(evalCase: EvalCase): EvalCase {
  return evalCase;
}

/**
 * The short model name a run is labeled and filed under. A report generated
 * from a past workspace has no runs to read this from, only the model URI each
 * chat recorded, so the derivation has to be available on its own.
 */
export function modelLabelFor(uri: string): string {
  const parsed = AIGatewayModelURI.parse(uri);
  return sanitizeCanonicalId(parsed.ok ? parsed.value.canonicalId : uri);
}

export async function runEvals(
  evals: EvalCase[],
  {
    concurrency = 8,
    dryRun = false,
    firstTrial = 1,
    maxRunCostUSD = DEFAULT_MAX_RUN_COST_USD,
    maxRunSeconds = DEFAULT_MAX_RUN_SECONDS,
    maxRunTokens,
    models,
    reasoningEffort,
    repeat = 1,
  }: {
    concurrency?: number;
    dryRun?: boolean;
    /** The number of this process's first trial, for one of several processes. */
    firstTrial?: number;
    /** 0 disables. */
    maxRunCostUSD?: number;
    maxRunSeconds?: number;
    /**
     * 0 disables. Absent, `DEFAULT_MAX_RUN_TOKENS` applies to a run only
     * while its cost cannot be read.
     */
    maxRunTokens?: number;
    models: string[];
    /** Asked of every model request the run makes, through the workspace config. */
    reasoningEffort?: ReasoningEffort;
    repeat?: number;
  },
): Promise<{ runs: CompletedRun[]; workspaceRootDir: string }> {
  const workspaceRootDir = path.join(
    os.tmpdir(),
    `${APP_NAME_SLUG}-evals-${ulid()}`,
  );
  const providerConfigs = buildProviderConfigs();
  const registryDir = resolveRegistryDir();

  write(`${c.dim}Workspace :${c.reset} ${workspaceRootDir}\n`);
  write(`${c.dim}Registry  :${c.reset} ${registryDir}\n`);

  const catalog = await fetchOpenRouterCatalog(models);
  for (const [alias, target] of catalog.aliasTargets) {
    write(
      `${c.dim}Alias     :${c.reset} ${alias} ${c.dim}->${c.reset} ${target}\n`,
    );
  }

  if (dryRun) {
    return { runs: [], workspaceRootDir };
  }

  // Shells run in the bash worker, as they do in Studio.
  setBashWorkerFactory(createTsxBashWorker);

  const runtimeDir = path.join(workspaceRootDir, "runtime");
  makeToolBinIn(runtimeDir);

  const appsConfig = {
    ...createMemoryAppsConfig(),
    ...(evals.some(
      (evalCase) => evalCase.signInsEndAs ?? evalCase.signInsAnswerAs,
    )
      ? { oauth: cardOnlySignIns() }
      : {}),
  };
  const standInWindow = createStandInWindow();
  const stopStandInWindow = standInWindow.listen();
  const actor = createActor(workspaceMachine, {
    input: {
      aiGatewayApp,
      apps: appsConfig,
      appVersion: "0.0.0-test",
      // No window, so a task starts a browser of its own; the stand-in
      // answers for the window's tabs the conversation names.
      browser: standInWindow.browser({
        ...createStubBrowserConfig(),
        hasNoWindow: true,
      }),
      captureException: (...args: unknown[]) => {
        console.error("captureException", ...args);
      },
      deviceId: newDeviceId(),
      getAIProviderConfigs: () => providerConfigs,
      // The Mac helper as a checkout builds it (`pnpm --filter
      // @instrument-org/studio build:mac-helper`), so a run reaches
      // Calendar, Reminders, and Contacts the way the app does; without
      // it the agent has no way into them, as a build without it has none.
      ...(process.platform === "darwin" && fs.existsSync(SEATBELT_LAUNCHER)
        ? { seatbeltHelperPath: SEATBELT_LAUNCHER }
        : {}),
      ...(process.platform === "darwin" && fs.existsSync(MAC_HELPER_BIN)
        ? { macHelperBinPath: MAC_HELPER_BIN }
        : {}),
      modelCache: noopModelCache,
      ...(evals.some((evalCase) => evalCase.nativeSandbox)
        ? { nativeSandbox: true }
        : {}),
      nodeExecEnv: {},
      ...(reasoningEffort ? { reasoningEffort } : {}),
      // A workspace the person picked, which is what makes its top level
      // theirs: each chat's own folder under `Chats/` is then where its
      // finished work goes, as it is for anyone who picked where their
      // Instrument folder is kept. Without this a run measures the
      // fallback, and nothing measures what the prompt tells the agent.
      outputDir: workspaceRootDir,
      pnpmBinPath: PNPM_BIN,
      registryDir,
      rootDir: workspaceRootDir,
      runtimeDir,
      // Inside the run's own folder, so a saved run keeps the chats' work
      // folders beside their records (`buildReportWorkspaceConfig`).
      userDataDir: path.join(workspaceRootDir, EVAL_MACHINE_DIR_NAME),
      workspaceMachineDir: path.join(workspaceRootDir, EVAL_MACHINE_DIR_NAME),
      workFoldersDir: path.join(
        workspaceRootDir,
        EVAL_MACHINE_DIR_NAME,
        "work",
      ),
      systemSkillsDir: path.resolve(import.meta.dirname, "../system-skills"),
      trashItem: () => Promise.reject(new Error("Not implemented")),
      uvBinPath: await execa({ reject: false })`which uv`.then(
        (result) => result.stdout.trim() || "uv",
      ),
      // The uutils Studio vendors, so the shell's GNU text commands are the
      // app's; EVAL_BUILTINS_ONLY=1 leaves them the shell's own, to compare.
      ...(process.env.EVAL_BUILTINS_ONLY === "1" || !fs.existsSync(UUTILS_DIR)
        ? {}
        : { uutilsDir: UUTILS_DIR, uutilsOutsideSandbox: true }),
      webSearch: platformSearchClient(),
    },
  });

  attachChats(actor);
  actor.start();
  // Awaited, unlike the app's: a case's first command may read them.
  await prepareBundledSkills(actor.getSnapshot().context.config);
  // Awaited too, so every case starts as a launch that has finished it, and
  // its context says what `python` already has.
  const pythonBase = await ensurePythonBase();
  if (pythonBase) {
    write(
      `${c.dim}Python    :${c.reset} base packages not installed: ${pythonBase.output.trim()}\n`,
    );
  }

  const runs = models
    .flatMap((uri) => {
      const modelLabel = modelLabelFor(uri);
      return evals.flatMap((evalCase) =>
        _.list(firstTrial, firstTrial + repeat - 1).map((trial) => ({
          evalCase,
          modelLabel,
          trial,
          uri,
        })),
      );
    })
    .map((run, index) => ({ ...run, index }));

  const totalRuns = runs.length;
  let finishedRuns = 0;

  // Seeded once, before any case starts, because the apps a task may reach are
  // read into the session context the first time a session needs model input.
  // One apps directory serves the whole run, so an app a case declares is
  // listed for every case in that run: score an app case on its own.
  const declaredApps = _.unique(
    runs.flatMap((run) => run.evalCase.apps ?? []),
    (app) => app.slug,
  );
  const appFixtures = await seedConnectedApps(declaredApps, {
    apps: appsConfig,
    appsDir: workspaceLayout(workspaceRootDir).appsDir,
  });
  for (const app of declaredApps) {
    write(
      `${c.dim}App       :${c.reset} ${app.slug} ${c.dim}connected${c.reset}\n`,
    );
  }

  // A task id is slugified from the prompt, and the name is claimed by creating
  // the directory. Running one case against several models means several runs
  // want the same slug at the same moment, and they all read it as free before
  // any of them takes it. Creation is serialized so the numeric suffix that
  // already exists for collisions actually gets a chance to apply; only the
  // agent turn is worth running concurrently anyway.
  let creating = Promise.resolve();

  const completed = await _.parallel(
    concurrency,
    runs,
    async ({ evalCase, index, modelLabel, trial, uri }) => {
      const { label } = runKey({ modelLabel, name: evalCase.name, trial });

      write(`${evalPrefix(label)}${c.dim}Starting...${c.reset}\n`);

      const context = {
        workspaceConfig: actor.getSnapshot().context.config,
        workspaceRef: actor,
      };

      standInWindow.seed(evalCase.viewing);
      const created = creating.then(async () => {
        if (evalCase.kind === "chat") {
          ensureWorkspaceFolder();
        }
        await evalCase.setup?.();
        const folders = privateFoldersFor(evalCase, index) ?? [];
        if (evalCase.topic && evalCase.kind === "chat") {
          return openChatUnderTopic(evalCase, evalCase.topic, {
            context,
            folders,
            uri,
          });
        }
        return startRun(
          {
            files: evalCase.files,
            folders: folders.length > 0 ? folders : undefined,
            kind: evalCase.kind ?? "task",
            modelURI: uri,
            name: evalCase.name,
            prompt: evalCase.prompt,
            viewing: evalCase.viewing,
          },
          context,
        );
      });
      // Chained off the settled result so one failed creation does not strand
      // every run behind it.
      creating = created.then(_.noop, _.noop);
      const { id, sessionId } = await created;
      await recordRun(workspaceRootDir, {
        chatId: id,
        home: os.homedir(),
        modelLabel,
        name: evalCase.name,
        sessionId,
        trial,
      });

      write(
        `${evalPrefix(label)}${c.green}Task created${c.reset}${c.dim} (id: ${id})${c.reset}\n`,
      );

      const abortController = new AbortController();
      const price = catalog.priceFor(uri.split("?")[0] ?? uri);
      const startedAt = Date.now();
      let firstTextAt: number | undefined;
      let stoppedBy: RunStop | undefined;
      let stoppingForCase = false;
      let overBudget: CompletedRun["overBudget"];
      // What each question was asked with, by its call's part, for an answer
      // that picks one of the choices the model wrote.
      const chooseInputs = new Map<
        StoreId.Part,
        Extract<
          SessionMessagePart.ToolPartInputAvailable,
          { type: "tool-choose" }
        >["input"]
      >();
      let questionsAnswered = 0;
      const handledAskIds = new Set<string>();
      let foldersAllowed = 0;
      // See `FollowUp.duringWork`: the run's own finished tool calls, and
      // who is waiting for one to be in flight after enough of them.
      const ownToolsDone = new Set<string>();
      // The apps whose sign-in card the conversation put up, for
      // `signInsEndAs` to end once its turn settles.
      const signInCards = new Set<string>();
      const ownToolsStarted = new Set<string>();
      // The commands of the run's own `bash` calls in flight, by call.
      const ownCommandsInFlight = new Map<string, string>();
      let workWaiter:
        | {
            afterCalls: number;
            baseline: number;
            command?: RegExp;
            resolve: () => void;
          }
        | undefined;
      const workWaiterMet = () =>
        workWaiter !== undefined &&
        ownToolsDone.size - workWaiter.baseline >= workWaiter.afterCalls &&
        (workWaiter.command === undefined ||
          [...ownCommandsInFlight.values()].some((command) =>
            workWaiter?.command?.test(command),
          ));
      let duringWorkMissed = 0;
      // See `EvalCase.marks`. Each is timed from when its message is sent.
      const marks: {
        after?: string;
        at?: number;
        match: RegExp;
        name: string;
        sentAt?: number;
      }[] = (evalCase.marks ?? []).map((mark) => ({
        ...mark,
        sentAt:
          mark.after === undefined || evalCase.prompt.includes(mark.after)
            ? startedAt
            : undefined,
      }));
      const roles = new Map<string, string | undefined>();
      const roleOf = async (part: SessionMessagePart.Type) => {
        const { messageId, sessionId: partSessionId } = part.metadata;
        const known = roles.get(messageId);
        if (known) {
          return known;
        }
        const stored = await ChatReads.transcript({
          chatId: id,
          only: new Set([messageId]),
          sessionId: partSessionId,
        });
        const role = stored.isOk() ? stored.value[0]?.role : undefined;
        if (role) {
          roles.set(messageId, role);
        }
        return role;
      };
      // Every part of a message the run's records say moved, read back with
      // what the turn still holds in memory, so a call shows as in flight
      // while it runs. Parts are read again on each change to their message,
      // which the handling below takes, since it keys what it records by call
      // and by mark.
      const partUpdates = (async function* () {
        for await (const change of publisher.subscribe("record.changed", {
          signal: abortController.signal,
        })) {
          if (
            change.id !== id ||
            change.kind !== "messages" ||
            change.message === undefined ||
            change.message.removed ||
            change.message.sessionId !== sessionId
          ) {
            continue;
          }
          const read = await ChatReads.transcript({
            chatId: id,
            only: new Set([change.message.id]),
            sessionId,
          });
          if (read.isErr()) {
            continue;
          }
          for (const message of read.value) {
            for (const part of message.parts) {
              yield { id, part };
            }
          }
        }
      })();

      // A model handed an unrecoverable input can keep trying to recover from
      // it, and nothing in the loop is wrong enough to stop it: each attempt is
      // a legitimate tool call. Measured, one run has reached millions of tokens
      // on a single question before a human noticed. The eval harness is the one
      // place that can see the running total and act on it, so it does.
      const enforceCaps = ({ costUSD, tokens }: Spend) => {
        if (stoppedBy) {
          return;
        }
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        const tokenCap =
          evalCase.maxRunTokens ??
          maxRunTokens ??
          (costUSD === undefined ? DEFAULT_MAX_RUN_TOKENS : 0);
        if (
          maxRunCostUSD > 0 &&
          costUSD !== undefined &&
          costUSD > maxRunCostUSD
        ) {
          stoppedBy = "budget";
          overBudget = { costUSD, tokens };
          process.stderr.write(
            `${evalPrefix(label)}${c.red}Over budget${c.reset}${c.dim}: ${formatCost(costUSD)} > ${formatCost(maxRunCostUSD)}, stopping. Raise with --max-run-cost, or 0 to disable.${c.reset}\n`,
          );
        } else if (tokenCap > 0 && tokens > tokenCap) {
          stoppedBy = "budget";
          overBudget = { costUSD, tokens };
          process.stderr.write(
            `${evalPrefix(label)}${c.red}Over budget${c.reset}${c.dim}: ${formatNumber(tokens)} tokens > ${formatNumber(tokenCap)}, stopping. Raise with --max-run-tokens, or 0 to disable.${c.reset}\n`,
          );
        } else if (maxRunSeconds > 0 && elapsedSeconds > maxRunSeconds) {
          stoppedBy = "timeout";
          process.stderr.write(
            `${evalPrefix(label)}${c.red}Out of time${c.reset}${c.dim}: ${Math.round(elapsedSeconds)}s > ${maxRunSeconds}s, stopping. Raise with --max-run-seconds, or 0 to disable.${c.reset}\n`,
          );
        } else {
          return;
        }
        void call(sessionRoute.stop, { id }, { context });
      };

      // The whole chat's spend, its tasks' included: a runaway task is as much
      // the run's as a runaway conversation.
      const spendOf = async (): Promise<Spend> => {
        const { billed, messages } = await readChatSpend(id);
        const usage = getUsageSummaryFromMessages(messages);
        const cost = runCostOf(messages, {
          billed,
          price,
          priceFor: catalog.priceFor,
        });
        const modelUSD = modelCostUSD(cost);
        return {
          costUSD:
            modelUSD === undefined
              ? undefined
              : modelUSD + cost.search.estimatedUSD,
          tokens: usage.totalTokens,
          usage,
        };
      };
      const enforcementTimer = setInterval(() => {
        void spendOf().then(enforceCaps, _.noop);
      }, ENFORCEMENT_INTERVAL_MS);

      // A question the agent asked, or a folder or app it asked for, shows
      // the person a card, which the case answers the way they would: a
      // scripted pick, a yes, a no, or nothing, leaving the agent to carry on
      // without it. Read on every part and on a timer, since a turn ends on
      // the call that asked and may publish nothing after it.
      let answeringAsks = Promise.resolve();
      const answerAsks = () => {
        answeringAsks = answeringAsks
          .then(async () => {
            for (const ask of await openAsks(id)) {
              if (handledAskIds.has(ask.id)) {
                continue;
              }
              handledAskIds.add(ask.id);
              let answer: () => Promise<unknown>;
              if (ask.kind === "question") {
                const partId = ask.askers[0]?.partId;
                const input = partId ? chooseInputs.get(partId) : undefined;
                const scripted = evalCase.answers?.[questionsAnswered++];
                const picked =
                  typeof scripted === "function"
                    ? input && scripted(input)
                    : scripted;
                write(
                  `${evalPrefix(label)}${c.cyan}choose${c.reset}${c.dim} asked: ${ask.question}${picked ? `; answering ${JSON.stringify(picked)}` : "; leaving it open"}${c.reset}\n`,
                );
                if (!picked) {
                  continue;
                }
                answer = () =>
                  call(
                    chatsRoute.answerQuestion,
                    { answer: picked, askId: ask.id, id },
                    { context },
                  );
              } else {
                const declines =
                  ask.kind === "folder"
                    ? evalCase.declinesFolders
                    : evalCase.declinesApps;
                // A folder outside the run's home is the developer's own, which
                // a model that guesses at the real home asks for, so it is never
                // allowed and never counts against the case's allowance.
                // Both resolved, since a temp home is reached through a
                // symlink as well (`/var` and `/private/var` on macOS).
                const real = (at: string) => {
                  try {
                    return fs.realpathSync(at);
                  } catch {
                    return at;
                  }
                };
                const fromHome = path.relative(
                  real(os.homedir()),
                  real(ask.target),
                );
                const inRunHome =
                  !fromHome.startsWith("..") && !path.isAbsolute(fromHome);
                const allows =
                  ask.kind === "folder"
                    ? !declines &&
                      inRunHome &&
                      foldersAllowed++ < (evalCase.allowsFolders ?? 0)
                    : evalCase.allowsApps;
                write(
                  `${evalPrefix(label)}${c.cyan}asked${c.reset}${c.dim} for ${ask.kind} ${ask.target}${declines ? "; declining" : allows ? "; allowing" : ""}${c.reset}\n`,
                );
                if (!(declines || allows)) {
                  continue;
                }
                answer = () =>
                  call(
                    permissionsRoute.answer,
                    {
                      askId: ask.id,
                      decision: declines ? "declined" : "allowed",
                      id,
                    },
                    { context },
                  );
              }
              // Answered once the asking sessions' turns are over, as a
              // person reading the card would, so the answer arrives as a
              // wake rather than mid-turn.
              void (async () => {
                const until = Date.now() + ANSWER_AFTER_TURN_MAX_MS;
                while (
                  ask.askers.some((asker) => isWorking(id, asker.sessionId)) &&
                  Date.now() < until
                ) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, TREE_POLL_MS),
                  );
                }
                await answer();
              })().catch((error: unknown) => {
                process.stderr.write(
                  `${evalPrefix(label)}${c.red}answering the ${ask.kind} ask failed${c.reset}${c.dim}: ${String(error)}${c.reset}\n`,
                );
              });
            }
          })
          .catch((error: unknown) => {
            process.stderr.write(
              `${evalPrefix(label)}${c.red}reading the chat's cards failed${c.reset}${c.dim}: ${String(error)}${c.reset}\n`,
            );
          });
        return answeringAsks;
      };
      const askTimer = setInterval(() => {
        void answerAsks();
      }, TREE_POLL_MS);

      void (async () => {
        try {
          for await (const event of partUpdates) {
            // The run's own session: a task's parts are in the chat's store
            // too, and are the task's.
            if (
              event.id !== id ||
              event.part.metadata.sessionId !== sessionId
            ) {
              continue;
            }

            const part = event.part;

            // Every message's parts are published, the user's and the
            // context's included, and a part does not say whose it is. Those
            // are stored before their parts are published, so a text part
            // whose message is not yet stored, or is stored as the
            // assistant's, is a reply being streamed.
            if (
              firstTextAt === undefined &&
              part.type === "text" &&
              part.text.trim() !== ""
            ) {
              const seenAt = Date.now();
              const stored = await ChatReads.transcript({
                chatId: id,
                only: new Set([part.metadata.messageId]),
                sessionId: part.metadata.sessionId,
              });
              const role = stored.isOk() ? stored.value[0]?.role : undefined;
              if (role === undefined || role === "assistant") {
                firstTextAt ??= seenAt;
              }
            }

            if (part.type === "text") {
              const open = marks.filter(
                (mark) =>
                  mark.sentAt !== undefined &&
                  mark.at === undefined &&
                  mark.match.test(part.text),
              );
              if (open.length > 0) {
                const seenAt = Date.now();
                if ((await roleOf(part)) !== "user") {
                  for (const mark of open) {
                    mark.at ??= seenAt;
                  }
                }
              }
            }

            if (isToolPart(part)) {
              if (
                part.state === "output-available" ||
                part.state === "output-error"
              ) {
                ownToolsDone.add(part.toolCallId);
                ownCommandsInFlight.delete(part.toolCallId);
              } else if (
                part.state === "input-available" &&
                !ownToolsStarted.has(part.toolCallId)
              ) {
                ownToolsStarted.add(part.toolCallId);
                if (part.type === "tool-bash" && part.input?.command) {
                  ownCommandsInFlight.set(part.toolCallId, part.input.command);
                }
                if (workWaiter && workWaiterMet()) {
                  workWaiter.resolve();
                  workWaiter = undefined;
                }
              }
            }

            if (
              part.type === "tool-connect_app" &&
              part.state === "output-available"
            ) {
              for (const row of askedOnCard(part.output)) {
                if (row.kind === "sign-in") {
                  signInCards.add(row.slug);
                }
              }
            }

            if (
              part.type === "tool-choose" &&
              part.state === "input-available"
            ) {
              chooseInputs.set(part.metadata.id, part.input);
            }

            await answerAsks();

            if (
              isToolPart(part) &&
              part.state !== "input-streaming" &&
              part.state !== "input-available"
            ) {
              const isError = part.state === "output-error";
              const stream = isError ? process.stderr : process.stdout;
              const spend = await spendOf();
              const { usage } = spend;
              const toolName = part.type.replace("tool-", "");
              const toolLabel = isError
                ? `${c.red}${toolName} ERROR${c.reset}`
                : `${c.cyan}${toolName}${c.reset}`;
              const statsSuffix = `  ${c.dim}tokens=${c.reset}${formatNumber(usage.totalTokens)}${c.dim} (in=${formatNumber(usage.inputTokens)} out=${formatNumber(usage.outputTokens)}) msgs=${c.reset}${c.yellow}${usage.messageCount}${c.reset}${spend.costUSD === undefined ? "" : `${c.dim} cost=${c.reset}${formatCost(spend.costUSD)}`}`;
              const line = `${evalPrefix(label)}${toolLabel}${statsSuffix}\n`;
              if (isError) {
                stream.write(line);
              } else {
                write(line);
              }

              enforceCaps(spend);
            }

            if (!stoppingForCase && (await evalCase.shouldStop?.(part, id))) {
              stoppingForCase = true;
              stoppedBy ??= "case";
              write(
                `${evalPrefix(label)}${c.yellow}shouldStop returned true, stopping session...${c.reset}\n`,
              );
              // Once the step that made the part has ended, since the step's
              // usage arrives in the provider's last chunk and a stop before
              // that leaves a step the provider billed with no usage at all.
              // The call it asked for may start meanwhile; the stop ends it.
              void stepEnded(id, part.metadata).then(() =>
                call(sessionRoute.stop, { id }, { context }),
              );
            }
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            throw error;
          }
        }
      })();

      // A stop that never takes effect would otherwise hold the whole suite
      // behind this one run for as long as the process lives.
      //
      // One deadline for the whole run rather than one per wait. A case with a
      // follow-up waits three times -- first turn, follow-up turn, then the
      // tree going quiet -- and a per-wait cap let a run take three times the
      // number the operator set, which is how `--max-run-seconds 900` produced
      // a run still going three quarters of an hour later.
      const runDeadline =
        maxRunSeconds > 0
          ? startedAt + maxRunSeconds * 1000 + STOP_GRACE_MS
          : undefined;
      const remainingMs = () =>
        runDeadline === undefined
          ? undefined
          : Math.max(0, runDeadline - Date.now());
      const followUps = (evalCase.followUps ?? []).map((followUp) =>
        typeof followUp === "string" ? { prompt: followUp } : followUp,
      );
      const isTimed = (followUp?: FollowUp) =>
        followUp?.afterMs !== undefined || followUp?.duringWork !== undefined;
      // Counted from each message sent, so a `duringWork` follow-up waits on
      // tool calls of the turn it is meant to land in.
      let toolsAtLastSend = 0;
      let turn = waitForSessionDone(sessionId, id, {
        timeoutMs: remainingMs(),
      });
      let outcome: "done" | "timeout" = "done";
      let doneAt = startedAt;
      let lastSentAt = startedAt;
      if (!isTimed(followUps[0])) {
        outcome = await turn;
        doneAt = Date.now();
      }

      if (evalCase.finishesAs && !stoppedBy && outcome !== "timeout") {
        await standInForTasks(id, evalCase.finishesAs, {
          standInWindow,
          workspaceRef: actor,
        });
      }

      if (evalCase.signInsEndAs && !stoppedBy && outcome !== "timeout") {
        for (const slug of signInCards) {
          write(
            `${evalPrefix(label)}${c.dim}Sign-in to ${slug} ends: ${evalCase.signInsEndAs.ended ?? "failed"}${c.reset}\n`,
          );
          await endSignIn(slug, evalCase.signInsEndAs);
        }
        signInCards.clear();
      }

      if (evalCase.signInsAnswerAs && !stoppedBy && outcome !== "timeout") {
        for (const slug of signInCards) {
          await new Promise((resolve) => setTimeout(resolve, SIGN_IN_GAP_MS));
          const answer = evalCase.signInsAnswerAs[slug] ?? "connected";
          write(
            `${evalPrefix(label)}${c.dim}Sign-in to ${slug}: ${answer}${c.reset}\n`,
          );
          await answerSignIn(slug, answer, {
            account: "you@example.com",
            appsDir: workspaceLayout(workspaceRootDir).appsDir,
          });
        }
        signInCards.clear();
      }

      // Follow-ups run before the teardown below, so the caps timer and the
      // part subscription cover the whole conversation rather than its first
      // turn: a run that loops on turn four is the same runaway as one that
      // loops on turn one. A turn that stopped or timed out ends the run
      // rather than asking the next question into a session that is not
      // listening.
      for (const [position, followUp] of followUps.entries()) {
        if (stoppedBy || outcome === "timeout") {
          break;
        }
        // A slow model can still be writing `instrument task new` when `afterMs` has
        // passed since the message that asked for it.
        const taskToStop =
          "stopTask" in followUp
            ? await taskOnceStarted(id, followUp.stopTask, turn)
            : "timeOutTask" in followUp
              ? await taskOnceStarted(id, followUp.timeOutTask, turn)
              : undefined;
        const timedFrom = Math.max(
          lastSentAt,
          taskToStop?.createdAt.getTime() ?? 0,
        );
        if (followUp.duringWork !== undefined) {
          const { afterToolCalls, command } = followUp.duringWork;
          const inFlight = new Promise<"in flight">((resolve) => {
            workWaiter = {
              afterCalls: afterToolCalls,
              baseline: toolsAtLastSend,
              ...(command ? { command } : {}),
              resolve: () => {
                resolve("in flight");
              },
            };
            // A call already in flight as the wait begins counts.
            if (workWaiterMet()) {
              resolve("in flight");
            }
          });
          const first = await Promise.race([inFlight, turn]);
          workWaiter = undefined;
          if (first !== "in flight") {
            duringWorkMissed += 1;
          }
        } else if (followUp.afterMs !== undefined) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.max(0, timedFrom + (followUp.afterMs ?? 0) - Date.now()),
            ),
          );
        } else if (followUp.settled && evalCase.kind === "chat") {
          await waitForTreeQuiet(id, {
            timeoutMs: remainingMs() ?? DEFAULT_MAX_RUN_SECONDS * 1000,
          });
        }
        // A message sent into a turn in progress is heard between its steps,
        // and that turn's end is the one still awaited; sent to a session at
        // rest, it starts a turn of its own.
        await evalCase.beforeFollowUp?.(position);
        if ("stopTask" in followUp) {
          write(
            `${evalPrefix(label)}${c.dim}Stop: ${followUp.stopTask}${taskToStop ? "" : " (no such task)"}${c.reset}\n`,
          );
          if (taskToStop) {
            await call(
              sessionRoute.stop,
              { id, sessionId: taskToStop.id },
              { context },
            );
          }
          lastSentAt = Date.now();
          continue;
        }
        if ("timeOutTask" in followUp) {
          write(
            `${evalPrefix(label)}${c.dim}Time out: ${followUp.timeOutTask}${taskToStop ? "" : " (no such task)"}${c.reset}\n`,
          );
          if (taskToStop) {
            const { timeouts } = await timeOutTaskTurn(
              actor,
              { chatId: id, sessionId: taskToStop.id },
              Date.now() + (remainingMs() ?? DEFAULT_MAX_RUN_SECONDS * 1000),
            );
            write(
              `${evalPrefix(label)}${c.dim}Timed out ${String(timeouts)} requests of ${followUp.timeOutTask}${c.reset}\n`,
            );
          }
          lastSentAt = Date.now();
          continue;
        }
        if ("stopChat" in followUp) {
          // A person presses Stop on a command they have watched start, not
          // on one still being written.
          await new Promise((resolve) =>
            setTimeout(resolve, STOP_CHAT_AFTER_MS),
          );
          write(
            `${evalPrefix(label)}${c.dim}Stop: the chat's turn${c.reset}\n`,
          );
          await call(sessionRoute.stop, { id, sessionId }, { context });
          lastSentAt = Date.now();
          continue;
        }
        const steering = isTimed(followUp) && isWorking(id, sessionId);
        write(
          `${evalPrefix(label)}${c.dim}Follow-up${steering ? " (mid-turn)" : ""}: ${followUp.prompt.slice(0, 60)}${c.reset}\n`,
        );
        const sendingAt = Date.now();
        for (const mark of marks) {
          if (
            mark.sentAt === undefined &&
            mark.after !== undefined &&
            followUp.prompt.includes(mark.after)
          ) {
            mark.sentAt = sendingAt;
          }
        }
        await call(
          messageRoute.create,
          { id, modelURI: uri, prompt: followUp.prompt, sessionId },
          { context },
        );
        lastSentAt = Date.now();
        toolsAtLastSend = ownToolsDone.size;
        if (!steering) {
          turn = waitForSessionDone(sessionId, id, {
            timeoutMs: remainingMs(),
          });
        }
        if (!isTimed(followUps[position + 1])) {
          outcome = await turn;
          doneAt = Date.now();
        }
      }

      // The children and the wake they trigger are the rest of a chat
      // run. Everything above this line has only watched the conversation.
      // A message sent mid-turn that the turn ended before hearing runs as a
      // turn of its own, so a timed follow-up waits the same way.
      if (
        (evalCase.kind === "chat" ||
          followUps.some(isTimed) ||
          evalCase.outlivesTurn) &&
        !stoppedBy
      ) {
        const settled = await waitForTreeQuiet(id, {
          timeoutMs: remainingMs() ?? DEFAULT_MAX_RUN_SECONDS * 1000,
          untilBackgroundEnds: evalCase.outlivesTurn,
        });
        if (settled.status === "timeout") {
          stoppedBy = "timeout";
          process.stderr.write(
            `${evalPrefix(label)}${c.red}Tree never settled${c.reset}${c.dim}: a task in this run was still working when time ran out.${c.reset}\n`,
          );
        } else {
          doneAt = Math.max(doneAt, settled.quietSince);
        }
      }

      clearInterval(enforcementTimer);
      clearInterval(askTimer);
      abortController.abort();
      await evalCase.teardown?.({ chatId: id });

      if (outcome === "timeout") {
        stoppedBy = "timeout";
        process.stderr.write(
          `${evalPrefix(label)}${c.red}Abandoned${c.reset}${c.dim}: the session never reported itself done.${c.reset}\n`,
        );
      }

      const usage = await getUsageSummary(id, { sessionId });
      // What a forking run actually spent is the conversation plus every
      // task it started; the conversation's own total is a fraction of it, and
      // reporting only that would make forking look free.
      const childSessionIds = await childTasksOf(id, sessionId);
      const childUsages = await Promise.all(
        childSessionIds.map((childId) =>
          getUsageSummary(id, { sessionId: childId }),
        ),
      );
      const treeUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      for (const one of [usage, ...childUsages]) {
        treeUsage.inputTokens += one.inputTokens;
        treeUsage.outputTokens += one.outputTokens;
        treeUsage.totalTokens += one.totalTokens;
      }
      const markTimes =
        marks.length > 0
          ? Object.fromEntries(
              marks.map((mark) => [
                mark.name,
                mark.at === undefined || mark.sentAt === undefined
                  ? null
                  : mark.at - mark.sentAt,
              ]),
            )
          : undefined;
      if (markTimes) {
        const marksDir = path.join(os.homedir(), ".eval-marks");
        fs.mkdirSync(marksDir, { recursive: true });
        fs.writeFileSync(
          path.join(marksDir, `${id}.json`),
          JSON.stringify(markTimes),
        );
      }
      const metrics = {
        ...(await metricsFor(id, sessionId, childSessionIds, {
          doneAt,
          firstTextAt,
          startedAt,
        })),
        ...(markTimes ? { marks: markTimes } : {}),
        ...(evalCase.followUps?.some(
          (followUp) =>
            typeof followUp !== "string" && followUp.duringWork !== undefined,
        )
          ? { duringWorkMissed }
          : {}),
        cacheReadTokens: [usage, ...childUsages].reduce(
          (sum, one) => sum + one.inputTokenDetails.cacheReadTokens,
          0,
        ),
      };
      const spent = await readChatSpend(id, [sessionId, ...childSessionIds]);
      const cost = runCostOf(spent.messages, {
        billed: spent.billed,
        price,
        priceFor: catalog.priceFor,
      });
      const costUSD = modelCostUSD(cost);
      const costLine = describeCost(cost);

      finishedRuns += 1;
      write(
        `${evalPrefix(label)}${c.green}Done.${c.reset}${c.dim} (${finishedRuns}/${totalRuns} complete, ${formatNumber(treeUsage.totalTokens)} tokens${childSessionIds.length > 0 ? ` across ${childSessionIds.length + 1} tasks` : ""}${costLine === undefined ? "" : `, ${costLine}`})${c.reset}\n`,
      );

      return {
        childSessionIds,
        cost,
        costSource: costSourceOf(cost),
        costUSD,
        label,
        metrics,
        modelLabel,
        modelURI: uri,
        name: evalCase.name,
        overBudget,
        resolvedModelId: catalog.aliasTargets.get(uri.split("?")[0] ?? uri),
        searchCostUSD:
          cost.search.searches > 0 ? cost.search.estimatedUSD : undefined,
        sessionId,
        stoppedBy,
        chatId: id,
        treeUsage,
        trial,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        },
      };
    },
  );

  await appFixtures.close();
  stopStandInWindow();
  actor.stop();

  return { runs: completed, workspaceRootDir };
}

/** The label and the results path a run is filed under. */
export function runKey(run: {
  modelLabel: string;
  name: string;
  trial: number;
}): { dir: string; label: string } {
  const suffix = run.trial > 1 ? `-trial-${run.trial}` : "";
  return {
    dir: path.join(run.name, `${run.modelLabel}${suffix}`),
    label: `${run.name}/${run.modelLabel}${suffix}`,
  };
}

/**
 * A run's session, parts included, which is what an assertion reads and what
 * a suite needs to render anything of its own afterwards: the one named, or a
 * chat's own conversation. A task's comes with only its own messages, never
 * the conversation it carries on from. Exported because each standalone
 * runner had otherwise written this same function privately.
 */
export async function sessionsFor(
  chatId: ChatId,
  sessionId?: StoreId.Session,
): Promise<Session.WithMessagesAndParts[]> {
  const ids = sessionId
    ? [sessionId]
    : (await ChatReads.sessions({ chatId })).map((list) =>
        list.map((session) => session.id),
      );
  if (!Array.isArray(ids) && ids.isErr()) {
    return [];
  }
  const sessions: Session.WithMessagesAndParts[] = [];
  for (const id of Array.isArray(ids) ? ids : ids.value) {
    const session = await ChatReads.session({ chatId, sessionId: id });
    const messages = await ChatReads.transcript({
      bytes: true,
      chatId,
      inherited: false,
      sessionId: id,
    });
    if (session.isOk() && messages.isOk()) {
      sessions.push({ ...session.value, messages: messages.value });
    }
  }
  return sessions;
}

/**
 * The tasks a run started: those of its chat when the run is the chat's own
 * conversation, and none for a task case, whose session starts nothing.
 */
export async function childTasksOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<StoreId.Session[]> {
  if (!resolveChat(chatId) || sessionOfChat(chatId) !== sessionId) {
    return [];
  }
  return (await listChildTasks(chatId)).map((task) => task.id);
}

/**
 * The tasks a run's chat started, each with its own messages: what a chat
 * case is scored on when the work happened in them.
 */
export async function childSessionsOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<ChildTaskSessions[]> {
  if (!resolveChat(chatId) || sessionOfChat(chatId) !== sessionId) {
    return [];
  }
  return Promise.all(
    (await listChildTasks(chatId)).map(async (child) => ({
      sessionId: child.id,
      sessions: await sessionsFor(chatId, child.id),
      title: child.title,
    })),
  );
}

/**
 * The workspace folder results go to when nobody said where, made the way
 * `window.ensure` makes it in the app. A chat reaches it and the home folder
 * without being sent either (folder-reach.ts), so neither rides on a message:
 * sent, they would arrive as folders the user attached, which the app never
 * says.
 *
 * Both derive from `$HOME`, sandboxed away from the developer's real files by
 * `evals/lib/sandbox-home` but shared across runs in one process, so run
 * chat cases at low concurrency and give a separate process its own
 * `INSTRUMENT_EVAL_HOME` when two runs must not see each other's output.
 */
function ensureWorkspaceFolder() {
  fs.mkdirSync(outputFolderPath(), { recursive: true });
}

/**
 * A run's own copy of each folder the case attaches.
 *
 * One case runs against every model at once, and they would otherwise share a
 * single directory: a read-write attachment means each run sees the files the
 * others just wrote, and a model that finds three charts it did not make
 * behaves nothing like one working in the folder the user actually has.
 *
 * A folder marked `inPlace` is attached where it is instead: one `setup`
 * made under the run's home, or one too large to copy for every run. A
 * granted folder is the chat's to write, so a committed fixture is never
 * attached in place.
 *
 * The basename is preserved because it becomes the mount name, which the case's
 * own prompt refers to ("my Reports folder").
 */
function privateFoldersFor(evalCase: EvalCase, index: number) {
  return evalCase.folders?.map(({ inPlace, ...folder }) => {
    if (inPlace) {
      return folder;
    }
    const root = path.join(
      os.tmpdir(),
      `${APP_NAME_SLUG}-eval-folders-${ulid()}-${index}`,
      path.basename(folder.path),
    );
    fs.cpSync(folder.path, root, { recursive: true });
    return { ...folder, path: root };
  });
}

/**
 * Opens a chat filed under `topic` the way the window's first send from a
 * topic does: the chat's record, then its first message with the topic id,
 * which files the chat before that message is written, so its note carries
 * the topic's instructions.
 */
async function openChatUnderTopic(
  evalCase: EvalCase,
  { instructions, name }: NonNullable<EvalCase["topic"]>,
  {
    context,
    folders,
    uri,
  }: {
    context: {
      workspaceConfig: WorkspaceConfig;
      workspaceRef: WorkspaceActorRef;
    };
    folders: { path: string }[];
    uri: string;
  },
): Promise<{ id: ChatId; sessionId: StoreId.Session }> {
  const topic = await createTopic({ name });
  await updateTopic(topic.id, { instructions });
  const newSessionId = StoreId.newSessionId();
  const id = await ensureChat(newSessionId, evalCase.prompt);
  await grantCaseFolders(id, folders);
  const { sessionId } = await call(
    messageRoute.create,
    {
      files: evalCase.files,
      folders: folders.length > 0 ? folders : undefined,
      id,
      modelURI: uri,
      prompt: evalCase.prompt,
      topic: topic.id,
      viewing: evalCase.viewing,
    },
    { context },
  );
  return { id, sessionId };
}

/**
 * What a shell says when it turns a call down: the product's own refusals
 * ("refuses", "refused") and a command line it could not parse.
 */
const REFUSED =
  /\brefus(?:es|ed|ing)\b|unknown (?:flag|option|command|subcommand|argument)|unrecognized (?:option|argument|command)|invalid (?:flag|option)/i;

/** See `RunMetrics`. */
async function metricsFor(
  chatId: ChatId,
  sessionId: StoreId.Session,
  childSessionIds: StoreId.Session[],
  {
    doneAt,
    firstTextAt,
    startedAt,
  }: { doneAt: number; firstTextAt?: number; startedAt: number },
): Promise<Omit<RunMetrics, "cacheReadTokens">> {
  let visibleChars = 0;
  const taskCommands = { new: 0 };
  const turns: NonNullable<RunMetrics["turns"]> = [];
  const turnShapes: TurnShape[] = [];
  for (const session of await sessionsFor(chatId, sessionId)) {
    turns.push(...turnsOf(session.messages));
    turnShapes.push(...turnShapesOf(session.messages));
    for (const message of session.messages) {
      if (message.role !== "assistant") {
        continue;
      }
      for (const part of message.parts) {
        if (part.type === "text") {
          visibleChars += part.text.trim().length;
        }
        if (part.type === "tool-bash" && part.input?.command) {
          const command: string = part.input.command;
          taskCommands.new += [
            ...command.matchAll(/(?:^|[\n;&|])\s*instrument task new\b/g),
          ].length;
        }
      }
    }
  }
  let toolCalls = 0;
  const refusals = { all: 0, task: 0 };
  for (const one of [sessionId, ...childSessionIds]) {
    for (const session of await sessionsFor(chatId, one)) {
      for (const message of session.messages) {
        toolCalls += message.parts.filter((part) => isToolPart(part)).length;
        for (const part of message.parts) {
          if (part.type !== "tool-bash") {
            continue;
          }
          const said =
            part.state === "output-available"
              ? part.output.output
              : part.state === "output-error"
                ? part.errorText
                : "";
          if (REFUSED.test(said)) {
            refusals.all += 1;
            if (
              /(?:^|[\n;&|(])\s*instrument\s+task\s+[a-z]/.test(
                part.input?.command ?? "",
              )
            ) {
              refusals.task += 1;
            }
          }
        }
      }
    }
  }
  return {
    doneMs: doneAt - startedAt,
    firstTextMs:
      firstTextAt === undefined ? undefined : firstTextAt - startedAt,
    refusals,
    taskCommands,
    tasksCreated: childSessionIds.length,
    toolCalls,
    turns,
    turnShapes,
    visibleChars,
  };
}

/** See `TurnShape`. */
function turnShapesOf(
  messages: Session.WithMessagesAndParts["messages"],
): TurnShape[] {
  const shapes: TurnShape[] = [];
  messages.forEach((message, index) => {
    if (message.role !== "user" || !isTypedByUser(message)) {
      return;
    }
    const next = messages.findIndex(
      (later, at) => at > index && later.role === "user",
    );
    const replies = messages
      .slice(index + 1, next === -1 ? undefined : next)
      .filter((reply) => reply.role === "assistant");
    const parts = replies.flatMap((reply) => reply.parts);
    const texts = parts.filter(
      (part) => part.type === "text" && part.text.trim() !== "",
    );
    const firstText = parts.findIndex(
      (part) => part.type === "text" && part.text.trim() !== "",
    );
    const firstTool = parts.findIndex((part) => isToolPart(part));
    const first = parts[firstText];
    shapes.push({
      ...(first?.type === "text" ? { firstText: first.text.trim() } : {}),
      steps: replies.map((reply) => ({
        cacheReadTokens:
          reply.metadata.usage?.inputTokenDetails.cacheReadTokens ?? 0,
        inputTokens: reply.metadata.usage?.inputTokens ?? 0,
        outputTokens: reply.metadata.usage?.outputTokens ?? 0,
        text: reply.parts.some(
          (part) => part.type === "text" && part.text.trim() !== "",
        ),
        toolCalls: reply.parts.filter((part) => isToolPart(part)).length,
      })),
      ...(firstTool === -1
        ? {}
        : { textBeforeTool: firstText !== -1 && firstText < firstTool }),
      textParts: texts.length,
      texts: texts.flatMap((part) =>
        part.type === "text" ? [part.text.trim()] : [],
      ),
      toolCalls: parts.filter((part) => isToolPart(part)).length,
    });
  });
  return shapes;
}

/**
 * Each message the user typed and the replies that answered it: the
 * assistant messages after it up to the next message of the user's or of the
 * harness (a wake), timed to the last of them finishing. See `RunMetrics`.
 */
function turnsOf(
  messages: Session.WithMessagesAndParts["messages"],
): NonNullable<RunMetrics["turns"]> {
  const turns: NonNullable<RunMetrics["turns"]> = [];
  messages.forEach((message, index) => {
    if (message.role !== "user" || !isTypedByUser(message)) {
      return;
    }
    const next = messages.findIndex(
      (later, at) => at > index && later.role === "user",
    );
    const replies = messages
      .slice(index + 1, next === -1 ? undefined : next)
      .filter((reply) => reply.role === "assistant");
    const last = replies.at(-1);
    const endedAt = last
      ? (last.metadata.finishedAt ?? last.metadata.createdAt).getTime()
      : message.metadata.createdAt.getTime();
    turns.push({
      chars: replies.reduce(
        (sum, reply) =>
          sum +
          reply.parts.reduce(
            (chars, part) =>
              chars + (part.type === "text" ? part.text.trim().length : 0),
            0,
          ),
        0,
      ),
      ms: endedAt - message.metadata.createdAt.getTime(),
      tokens: replies.reduce(
        (sum, reply) => sum + (reply.metadata.usage?.totalTokens ?? 0),
        0,
      ),
    });
  });
  return turns;
}

function sanitizeCanonicalId(canonicalId: string): string {
  return canonicalId.replaceAll(/[^a-z0-9-]/gi, "-");
}

/**
 * Stops each task the conversation started and wakes it as though the task
 * had finished: see `EvalCase.finishesAs`. The stop is one the conversation
 * expects, so it wakes nothing of its own.
 */
async function standInForTasks(
  chatId: ChatId,
  { leavesOpen = [], said }: NonNullable<EvalCase["finishesAs"]>,
  {
    standInWindow,
    workspaceRef,
  }: {
    standInWindow: ReturnType<typeof createStandInWindow>;
    workspaceRef: WorkspaceActorRef;
  },
) {
  const resolved = resolveChat(chatId);
  for (const child of resolved ? await listChildTasks(resolved) : []) {
    workspaceRef.send({
      type: "stopSessions",
      value: {
        id: chatId,
        notice: { by: "agent", wakesChat: false },
        sessionId: child.id,
      },
    });
    while (isWorking(chatId, child.id)) {
      await new Promise((resolve) => setTimeout(resolve, TREE_POLL_MS));
    }
    for (const tab of leavesOpen) {
      standInWindow.openPage(tab);
    }
    wakeChatWithTaskEvent(
      child.chatId,
      {
        status: "done",
        summary: said,
        ...(leavesOpen.length > 0
          ? {
              tabs: leavesOpen.map(({ at, id }) => ({
                id,
                openedBy: "task" as const,
                url: at,
              })),
            }
          : {}),
        handle: child.handle,
        sessionId: child.id,
        title: child.title,
      },
      workspaceRef,
    );
  }
}

/**
 * The chat's task by its handle, once the chat has started it; none when
 * `turn`, the chat's turn that would start it, ends first.
 */
async function taskOnceStarted(
  chatId: ChatId,
  handle: string,
  turn: Promise<unknown>,
): Promise<ChatTask | undefined> {
  let turnOver = false;
  void turn.then(() => {
    turnOver = true;
  });
  for (;;) {
    const task = (await listChildTasks(chatId)).find(
      (child) => child.handle === handle,
    );
    if (task || turnOver) {
      return task;
    }
    await Promise.race([
      turn,
      new Promise((resolve) => setTimeout(resolve, TREE_POLL_MS)),
    ]);
  }
}

/**
 * Resolves once the assistant message `messageId` has finished, stopped or
 * failed, or after `STEP_END_WAIT_MS` regardless.
 */
async function stepEnded(
  chatId: ChatId,
  {
    messageId,
    sessionId,
  }: { messageId: StoreId.Message; sessionId: StoreId.Session },
): Promise<void> {
  const deadline = Date.now() + STEP_END_WAIT_MS;
  while (Date.now() < deadline) {
    const read = await ChatReads.transcript({
      chatId,
      only: new Set([messageId]),
      sessionId,
    });
    const message = read.isOk() ? read.value[0] : undefined;
    if (message?.role !== "assistant" || message.metadata.finishedAt) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, STEP_END_POLL_MS));
  }
}

async function waitForSessionDone(
  sessionId: StoreId.Session,
  id: string,
  { timeoutMs }: { timeoutMs?: number } = {},
): Promise<"done" | "timeout"> {
  return new Promise((resolve) => {
    const abortController = new AbortController();
    const unsubscribe = publisher.subscribe("session.done", {
      signal: abortController.signal,
    });

    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            abortController.abort();
            resolve("timeout");
          }, timeoutMs);

    void (async () => {
      try {
        for await (const event of unsubscribe) {
          if (event.sessionId === sessionId && event.id === id) {
            clearTimeout(timer);
            abortController.abort();
            resolve("done");
            return;
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          throw error;
        }
      }
    })();
  });
}

/**
 * Waits until no session of this run's chat, its own or a task's, has been
 * working for a continuous stretch, so a lull between a child finishing and
 * its wake reaching the chat is not mistaken for the end.
 *
 * Scoped to the chat rather than the workspace because one workspace holds
 * every concurrent run of a suite, and waiting on all of them would make each
 * run as long as the slowest.
 */
async function waitForTreeQuiet(
  rootChatId: ChatId,
  {
    timeoutMs,
    untilBackgroundEnds = false,
  }: {
    timeoutMs: number;
    /** Count a background process still running as work under way. */
    untilBackgroundEnds?: boolean;
  },
): Promise<{ quietSince: number; status: "quiet" } | { status: "timeout" }> {
  const deadline = Date.now() + timeoutMs;
  let quietSince: number | undefined;
  while (Date.now() < deadline) {
    const working =
      isWorking(rootChatId) ||
      (untilBackgroundEnds &&
        listChatBackgroundProcesses(rootChatId).some(
          (process) => process.status === "running",
        ));
    if (working) {
      quietSince = undefined;
    } else {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= TREE_QUIET_MS) {
        return { quietSince, status: "quiet" };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, TREE_POLL_MS));
  }
  return { status: "timeout" };
}
