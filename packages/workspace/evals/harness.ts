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
import os from "node:os";
import path from "node:path";
import * as _ from "radashi";
import { ulid } from "ulid";
import { createActor } from "xstate";
import { type z } from "zod";

import type { Session } from "../src/schemas/session";

import { attachChats, workspaceMachine } from "../src/electron";
import { type WorkspaceActorRef } from "../src/machines/workspace";
import { createMemoryAppsConfig } from "../src/lib/apps/memory-config";
import { setBashWorkerFactory } from "../src/lib/bash-worker/client";
import { isToolPart } from "../src/lib/is-tool-part";
import { isWorking } from "../src/lib/chat/activity";
import { isTypedByUser } from "../src/lib/typed-by-user";
import { expectStop, wakeChatWithTaskEvent } from "../src/lib/chat/wake";
import { listChildTasks } from "../src/lib/chat/children";
import { outputFolderPath } from "../src/lib/chat/output-folder";
import { Store } from "../src/lib/store";
import { updateChatSettings } from "../src/lib/chat-settings";
import { getUsageSummary } from "../src/lib/usage-summary";
import { publisher } from "../src/rpc/publisher";
import { message as messageRoute } from "../src/rpc/routes/message";
import { session as sessionRoute } from "../src/rpc/routes/session";
import { type FileUpload } from "../src/schemas/file-upload";
import { type SessionMessageDataPart } from "../src/schemas/session/message-data-part";
import { type SessionMessagePart } from "../src/schemas/session/message-part";
import { createTsxBashWorker } from "../src/test/helpers/tsx-bash-worker";
import { type ChatId } from "../src/schemas/chat-id";
import { unavailableWebSearchClient } from "../src/schemas/web-search";
import { createStubBrowserConfig } from "../src/test/helpers/mock-chat-config";
import { type Choose } from "../src/tools/choose";
import { type AppFixture, seedConnectedApps } from "./lib/connected-app";
import { createStandInWindow } from "./lib/stand-in-window";
import { startRun } from "./lib/start-run";
import {
  buildProviderConfigs,
  c,
  costOfUsage,
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

/** The Mac helper a checkout builds, when it has; see the harness input. */
const MAC_HELPER_BIN = path.resolve(
  import.meta.dirname,
  "../../../apps/studio/native/mac-helper/.build/bridge/instrument-mac",
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
 */
export const HOUSE_FLOOR = "zai-org/glm-5.3-flash";

export interface CompletedRun {
  /** Every task this run's chat started, by its session. Empty unless it forked. */
  childSessionIds: StoreId.Session[];
  /** Approximate USD, when the model's price is known. See `formatCost`. */
  costUSD?: number;
  label: string;
  metrics: RunMetrics;
  /** The sanitized model id, as it appears in the label and the results path. */
  modelLabel: string;
  modelURI: string;
  /** The eval case this run came from, so a report can find it by task id. */
  name: string;
  /** Tokens at the moment the cap stopped this run; absent if it finished. */
  overBudget?: number;
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
  /** `task new` commands the run's own agent ran. */
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

/**
 * Ceiling on one run's total tokens before the harness stops it.
 *
 * Set from measurement rather than taste: the most expensive legitimate run
 * observed was around 700K, and the cheapest runaway was 1.3M. Anything past
 * this is a model that has stopped making progress, and the cost of letting it
 * continue is unbounded.
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
 * however many tool calls that turn makes. The token cap therefore acts at turn
 * boundaries, and the wall-clock cap is the only thing bounding a single turn
 * that will not end.
 */
const ENFORCEMENT_INTERVAL_MS = 15_000;

/** After a stop is issued, how long to wait for the session to actually end. */
const STOP_GRACE_MS = 60_000;

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

/** How often the tree is sampled while waiting for it to go quiet. */
const TREE_POLL_MS = 500;

export interface EvalCase {
  /**
   * What the user answers to each `choose` the agent puts to them, in the
   * order it asks, sent through the same route the card answers with. A
   * function gets the question as asked, for an answer that picks one of the
   * choices the model wrote. A question asked past the end of the list stops
   * the run, since nothing else would answer it and the turn would wait out
   * the clock.
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
   * Called with a follow-up's position just before it is sent, for a case
   * that has to see what the run had made by then: a draft the follow-up
   * asks to change, say.
   */
  beforeFollowUp?: (position: number) => Promise<void> | void;
  files?: FileUpload.Type[];
  /**
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
  /** Read after `setup`, so a getter can name something setup made. */
  prompt: string;
  /**
   * Run before the case's task is created, with the run's home and workspace
   * in place: for fixtures that have to be made rather than copied, such as
   * files whose modification times matter, or a memory already kept.
   */
  setup?: () => Promise<void> | void;
  shouldStop?: (
    part: SessionMessagePart.Type,
    chatId: ChatId,
  ) => boolean | Promise<boolean>;
  /**
   * Topics the chat is filed under from its first message, made before the
   * run with these instructions, the way a chat started from a topic in the
   * window is. Chat cases only.
   */
  topics?: { instructions: string; name: string }[];
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

type ChooseAnswer = z.output<typeof Choose.outputSchema>;

type FollowUp = FollowUpTiming &
  (
    | { prompt: string }
    | {
        /**
         * The user pressing Stop on one of the chat's tasks, by its handle,
         * in place of a message: what the task's page and the chat's task
         * list do.
         */
        stopTask: string;
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
   * counts those.
   */
  duringWork?: { afterToolCalls: number };
  settled?: boolean;
}

export function defineEval(evalCase: EvalCase): EvalCase {
  return evalCase;
}

/**
 * The short model name a run is labeled and filed under. A report generated
 * from a past workspace has no runs to read this from, only the model URI each
 * task recorded, so the derivation has to be available on its own.
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
    maxRunSeconds = DEFAULT_MAX_RUN_SECONDS,
    maxRunTokens = DEFAULT_MAX_RUN_TOKENS,
    models,
    reasoningEffort,
    repeat = 1,
  }: {
    concurrency?: number;
    dryRun?: boolean;
    maxRunSeconds?: number;
    maxRunTokens?: number;
    models: string[];
    /** Asked of every task this run creates, the conversation's own included. */
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

  // Shells run in the bash worker, as they do in Studio. On this thread,
  // just-bash's defenses wrap the whole process's environment while a script
  // runs, which breaks anything else here that writes it, the Claude Agent
  // SDK among them.
  setBashWorkerFactory(createTsxBashWorker);

  const appsConfig = createMemoryAppsConfig();
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
      captureEvent: () => {
        return;
      },
      captureException: (...args: unknown[]) => {
        console.error("captureException", ...args);
      },
      defaultTaskTemplateDir: path.resolve(
        import.meta.dirname,
        "../templates/default",
      ),
      getAIProviderConfigs: () => providerConfigs,
      isExternalBrowserEnabled: () => true,
      // The Mac helper as a checkout builds it (`pnpm --filter
      // @instrument-org/studio build:mac-helper`), so a run reaches
      // Calendar, Reminders, and Contacts the way the app does; without
      // it the agent falls back to osascript, as a build without it would.
      ...(process.platform === "darwin" && fs.existsSync(MAC_HELPER_BIN)
        ? { macHelperBinPath: MAC_HELPER_BIN }
        : {}),
      modelCache: noopModelCache,
      nodeExecEnv: {},
      pnpmBinPath: await execa({ reject: false })`which pnpm`.then(
        (result) => result.stdout.trim() || "pnpm",
      ),
      preparedSkillsDir: path.join(workspaceRootDir, "prepared-skills"),
      registryDir,
      rootDir: workspaceRootDir,
      systemSkillsDir: path.resolve(import.meta.dirname, "../system-skills"),
      trashItem: () => Promise.reject(new Error("Not implemented")),
      uvBinPath: await execa({ reject: false })`which uv`.then(
        (result) => result.stdout.trim() || "uv",
      ),
      uvDataDir: path.join(workspaceRootDir, "uv-data"),
      webSearch: unavailableWebSearchClient,
    },
  });

  attachChats(actor);
  actor.start();

  const runs = models
    .flatMap((uri) => {
      const modelLabel = modelLabelFor(uri);
      return evals.flatMap((evalCase) =>
        _.list(1, repeat).map((trial) => ({
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
    appsDir: path.join(workspaceRootDir, "apps"),
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
        if (evalCase.topics && evalCase.kind === "chat") {
          return openChatUnderTopics(evalCase, evalCase.topics, {
            context,
            folders,
            uri,
          });
        }
        return startRun(
          {
            // A task case is handed the apps it declares, the way a chat
            // hands them, so it hears about them in its context.
            apps:
              evalCase.kind === "chat"
                ? undefined
                : evalCase.apps?.map((app) => app.slug),
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

      // Written straight onto the task rather than passed through `create`,
      // which has no input for it: every turn of this run then reads it, the
      // conversation's and each of its tasks'.
      if (reasoningEffort) {
        await updateChatSettings(id, { reasoningEffort });
      }

      write(
        `${evalPrefix(label)}${c.green}Task created${c.reset}${c.dim} (id: ${id})${c.reset}\n`,
      );

      const abortController = new AbortController();
      const startedAt = Date.now();
      let firstTextAt: number | undefined;
      let stoppedBy: RunStop | undefined;
      let overBudget: number | undefined;
      // Each question once: a part is published again on every update.
      const askedIds = new Set<string>();
      // See `FollowUp.duringWork`: the run's own finished tool calls, and
      // who is waiting for one to be in flight after enough of them.
      const ownToolsDone = new Set<string>();
      const ownToolsStarted = new Set<string>();
      let workWaiter:
        | { afterCalls: number; baseline: number; resolve: () => void }
        | undefined;
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
        const stored = await Store.getMessages({
          messageIds: [messageId],
          sessionId: partSessionId,
          chatId: id,
        });
        const role = stored.isOk() ? stored.value[0]?.role : undefined;
        if (role) {
          roles.set(messageId, role);
        }
        return role;
      };
      const partUpdates = publisher.subscribe("part.updated", {
        signal: abortController.signal,
      });

      // A model handed an unrecoverable input can keep trying to recover from
      // it, and nothing in the loop is wrong enough to stop it: each attempt is
      // a legitimate tool call. Measured, one run has reached millions of tokens
      // on a single question before a human noticed. The eval harness is the one
      // place that can see the running total and act on it, so it does.
      const enforceCaps = (totalTokens: number) => {
        if (stoppedBy) {
          return;
        }
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        if (maxRunTokens > 0 && totalTokens > maxRunTokens) {
          stoppedBy = "budget";
          overBudget = totalTokens;
          process.stderr.write(
            `${evalPrefix(label)}${c.red}Over budget${c.reset}${c.dim}: ${formatNumber(totalTokens)} tokens > ${formatNumber(maxRunTokens)}, stopping. Raise with --max-run-tokens, or 0 to disable.${c.reset}\n`,
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
      const enforcementTimer = setInterval(() => {
        void getUsageSummary(id).then((usage) => {
          enforceCaps(usage.totalTokens);
        }, _.noop);
      }, ENFORCEMENT_INTERVAL_MS);

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
              const stored = await Store.getMessages({
                messageIds: [part.metadata.messageId],
                sessionId: part.metadata.sessionId,
                chatId: id,
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
              } else if (
                part.state === "input-available" &&
                !ownToolsStarted.has(part.toolCallId)
              ) {
                ownToolsStarted.add(part.toolCallId);
                if (
                  workWaiter &&
                  ownToolsDone.size - workWaiter.baseline >=
                    workWaiter.afterCalls
                ) {
                  workWaiter.resolve();
                  workWaiter = undefined;
                }
              }
            }

            if (
              part.type === "tool-choose" &&
              part.state === "input-available" &&
              !askedIds.has(part.toolCallId)
            ) {
              askedIds.add(part.toolCallId);
              const scripted = evalCase.answers?.[askedIds.size - 1];
              const answer =
                typeof scripted === "function"
                  ? scripted(part.input)
                  : scripted;
              write(
                `${evalPrefix(label)}${c.cyan}choose${c.reset}${c.dim} asked: ${part.input.question}${c.reset}\n`,
              );
              if (answer) {
                write(
                  `${evalPrefix(label)}${c.dim}Answering: ${JSON.stringify(answer)}${c.reset}\n`,
                );
                void call(
                  sessionRoute.answerToolCall,
                  {
                    id,
                    output: answer,
                    toolCallId: part.toolCallId,
                    toolName: "choose",
                  },
                  { context },
                );
              } else {
                stoppedBy ??= "case";
                write(
                  `${evalPrefix(label)}${c.yellow}No scripted answer for question ${askedIds.size}, stopping session...${c.reset}\n`,
                );
                void call(sessionRoute.stop, { id }, { context });
              }
            }

            if (
              isToolPart(part) &&
              part.state !== "input-streaming" &&
              part.state !== "input-available"
            ) {
              const isError = part.state === "output-error";
              const stream = isError ? process.stderr : process.stdout;
              const usage = await getUsageSummary(id);
              const toolName = part.type.replace("tool-", "");
              const toolLabel = isError
                ? `${c.red}${toolName} ERROR${c.reset}`
                : `${c.cyan}${toolName}${c.reset}`;
              const statsSuffix = `  ${c.dim}tokens=${c.reset}${formatNumber(usage.totalTokens)}${c.dim} (in=${formatNumber(usage.inputTokens)} out=${formatNumber(usage.outputTokens)}) msgs=${c.reset}${c.yellow}${usage.messageCount}${c.reset}`;
              const line = `${evalPrefix(label)}${toolLabel}${statsSuffix}\n`;
              if (isError) {
                stream.write(line);
              } else {
                write(line);
              }

              enforceCaps(usage.totalTokens);
            }

            if (await evalCase.shouldStop?.(part, id)) {
              stoppedBy ??= "case";
              write(
                `${evalPrefix(label)}${c.yellow}shouldStop returned true, stopping session...${c.reset}\n`,
              );
              void call(sessionRoute.stop, { id }, { context });
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
        if (followUp.duringWork !== undefined) {
          const { afterToolCalls } = followUp.duringWork;
          const inFlight = new Promise<"in flight">((resolve) => {
            workWaiter = {
              afterCalls: afterToolCalls,
              baseline: toolsAtLastSend,
              resolve: () => {
                resolve("in flight");
              },
            };
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
              Math.max(0, lastSentAt + (followUp.afterMs ?? 0) - Date.now()),
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
          const task = (await listChildTasks(id)).find(
            (child) => child.handle === followUp.stopTask,
          );
          write(
            `${evalPrefix(label)}${c.dim}Stop: ${followUp.stopTask}${task ? "" : " (no such task)"}${c.reset}\n`,
          );
          if (task) {
            await call(
              sessionRoute.stop,
              { id, sessionId: task.id },
              { context },
            );
          }
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
      if ((evalCase.kind === "chat" || followUps.some(isTimed)) && !stoppedBy) {
        const settled = await waitForTreeQuiet(id, {
          timeoutMs: remainingMs() ?? DEFAULT_MAX_RUN_SECONDS * 1000,
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
      abortController.abort();

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
      const price = catalog.priceFor(uri.split("?")[0] ?? uri);
      const costUSD = price
        ? [usage, ...childUsages].reduce(
            (sum, one) => sum + costOfUsage(one, price),
            0,
          )
        : undefined;

      finishedRuns += 1;
      write(
        `${evalPrefix(label)}${c.green}Done.${c.reset}${c.dim} (${finishedRuns}/${totalRuns} complete, ${formatNumber(treeUsage.totalTokens)} tokens${childSessionIds.length > 0 ? ` across ${childSessionIds.length + 1} tasks` : ""}${costUSD === undefined ? "" : `, ~${formatCost(costUSD)}`})${c.reset}\n`,
      );

      return {
        childSessionIds,
        costUSD,
        label,
        metrics,
        modelLabel,
        modelURI: uri,
        name: evalCase.name,
        overBudget,
        resolvedModelId: catalog.aliasTargets.get(uri.split("?")[0] ?? uri),
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
    : (await Store.getSessions(chatId)).map((list) =>
        list.map((session) => session.id),
      );
  if (!Array.isArray(ids) && ids.isErr()) {
    return [];
  }
  const sessions: Session.WithMessagesAndParts[] = [];
  for (const id of Array.isArray(ids) ? ids : ids.value) {
    const session = await Store.getSession(id, chatId);
    const messages = await Store.getMessagesWithParts({
      inherited: false,
      sessionId: id,
      chatId,
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
async function childTasksOf(
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
 * Opens a chat filed under `topics` the way the window's first send from a
 * topic does: the chat's record, then its first message with the topic ids,
 * which tag the chat before that message is written, so its note carries
 * their instructions.
 */
async function openChatUnderTopics(
  evalCase: EvalCase,
  topics: NonNullable<EvalCase["topics"]>,
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
  const topicIds: string[] = [];
  for (const { instructions, name } of topics) {
    const topic = await createTopic({ name });
    await updateTopic(topic.id, { instructions });
    topicIds.push(topic.id);
  }
  const newSessionId = StoreId.newSessionId();
  const id = await ensureChat(newSessionId, evalCase.prompt);
  const { sessionId } = await call(
    messageRoute.create,
    {
      files: evalCase.files,
      folders: folders.length > 0 ? folders : undefined,
      id,
      modelURI: uri,
      newSessionId,
      prompt: evalCase.prompt,
      topics: topicIds,
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
            ...command.matchAll(/(?:^|[\n;&|])\s*task new\b/g),
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
              /(?:^|[\n;&|(])\s*task\s+[a-z]/.test(part.input?.command ?? "")
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
    expectStop(child.id, { by: "chat", wakesChat: false });
    workspaceRef.send({
      type: "stopSessions",
      value: { id: chatId, sessionId: child.id },
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
  { timeoutMs }: { timeoutMs: number },
): Promise<{ quietSince: number; status: "quiet" } | { status: "timeout" }> {
  const deadline = Date.now() + timeoutMs;
  let quietSince: number | undefined;
  while (Date.now() < deadline) {
    const working = isWorking(rootChatId);
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
