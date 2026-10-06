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

import { AGENTS } from "../src/agents/all";
import { attachChats, workspaceMachine } from "../src/electron";
import { type WorkspaceActorRef } from "../src/machines/workspace";
import { createMemoryAppsConfig } from "../src/lib/apps/memory-config";
import { isToolPart } from "../src/lib/is-tool-part";
import { isWorking } from "../src/lib/chat/activity";
import { expectStop, wakeChatWithTaskEvent } from "../src/lib/chat/wake";
import { listChildTasks } from "../src/lib/chat/children";
import { outputFolderPath } from "../src/lib/chat/output-folder";
import { Store } from "../src/lib/store";
import { updateTaskSettings } from "../src/lib/task-settings";
import { getTaskUsageSummary } from "../src/lib/usage-summary";
import { publisher } from "../src/rpc/publisher";
import { message as messageRoute } from "../src/rpc/routes/message";
import { session as sessionRoute } from "../src/rpc/routes/session";
import { task as taskRoute } from "../src/rpc/routes/task";
import { type FileUpload } from "../src/schemas/file-upload";
import { type FolderAttachment } from "../src/schemas/folder-attachment";
import { type SessionMessageDataPart } from "../src/schemas/session/message-data-part";
import { type SessionMessagePart } from "../src/schemas/session/message-part";
import { type StoreId } from "../src/schemas/store-id";
import { type TaskId } from "../src/schemas/task-id";
import { unavailableWebSearchClient } from "../src/schemas/web-search";
import { createStubBrowserConfig } from "../src/test/helpers/mock-task-config";
import { type Choose } from "../src/tools/choose";
import { type AppFixture, seedConnectedApps } from "./lib/connected-app";
import { createStandInWindow } from "./lib/stand-in-window";
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
import { resolveChat } from "../src/lib/record-folders";

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
  /** Every task this run's task started, however deep. Empty unless it delegated. */
  childTaskIds: TaskId[];
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
  /** Absent when the agent ended the turn itself. */
  stoppedBy?: RunStop;
  taskId: TaskId;
  /** This task plus every task it started. Equal to `usage` when it delegated nothing. */
  treeUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** 1-based, and only meaningful when `repeat` asked for more than one. */
  trial: number;
  /** This task alone, which for a chat is the conversation only. */
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
  /** `task fork` and `task new` commands the run's own agent ran. */
  taskCommands: { fork: number; new: number };
  /** Tasks the run started, however deep. */
  tasksCreated: number;
  /** Tool calls by every agent in the tree. */
  toolCalls: number;
  /**
   * Characters of assistant text in the run's own sessions: what the user
   * reads. For a chat that is the chat's replies, not its tasks'.
   */
  visibleChars: number;
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
   * once a service is reachable: handing one to a task, and calling it.
   *
   * One apps directory serves every case in a run, so these are listed in every
   * case's context, not only this one's. Run an app case on its own.
   */
  apps?: AppFixture[];
  assertions?: Assertion[];
  files?: FileUpload.Type[];
  /**
   * `inPlace` attaches the folder where it is rather than a per-run copy:
   * for a folder under the run's home, which `setup` made and which a
   * process with a home of its own (`INSTRUMENT_EVAL_HOME`) does not share.
   */
  folders?: {
    access?: FolderAttachment.Access;
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
   * correction typed mid-job does.
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
   * Which agent answers the prompt. A chat delegates to tasks it
   * creates inside the same workspace, so a run of that kind produces the
   * chat's transcript plus one per task it made.
   */
  kind?: "chat" | "task";
  name: string;
  prompt: string;
  /**
   * Run before the case's task is created, with the run's home and workspace
   * in place: for fixtures that have to be made rather than copied, such as
   * files whose modification times matter, or a memory already kept.
   */
  setup?: () => Promise<void> | void;
  shouldStop?: (
    part: SessionMessagePart.Type,
    taskId: TaskId,
  ) => boolean | Promise<boolean>;
  /**
   * Text appended to every task agent's system prompt in this process. The
   * prompt is the agent's, not the task's, so every case in one run has to
   * agree on it; a run that mixes them is refused.
   */
  taskSystemAppend?: () => string;
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
  taskId: TaskId;
}

interface ChildTaskSessions {
  sessions: Session.WithMessagesAndParts[];
  taskId: TaskId;
  title: string;
}

type ChooseAnswer = z.output<typeof Choose.outputSchema>;

interface FollowUp {
  afterMs?: number;
  prompt: string;
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

  const taskSystemAppends = _.unique(
    evals.map((evalCase) => evalCase.taskSystemAppend),
  );
  if (taskSystemAppends.length > 1) {
    throw new Error(
      "These cases disagree on the task agent's system prompt, which is one per process. Run the cases with taskSystemAppend in a run of their own.",
    );
  }
  const [taskSystemAppend] = taskSystemAppends;
  if (taskSystemAppend) {
    appendToTaskSystemPrompt(taskSystemAppend);
  }

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
      // Arm C of the one-agent comparison: every chat runs `agents/one.ts`.
      isOneAgentEnabled: () => process.env.INSTRUMENT_EVAL_ONE_AGENT === "1",
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
        return call(
          taskRoute.create,
          {
            files: evalCase.files,
            folders: folders.length > 0 ? folders : undefined,
            chat: evalCase.kind === "chat",
            modelURI: uri,
            name: evalCase.name,
            prompt: evalCase.prompt,
            viewing: evalCase.viewing,
          },
          { context },
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
        await updateTaskSettings(id, { reasoningEffort });
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

      const enforcementTimer = setInterval(() => {
        void getTaskUsageSummary(id).then((usage) => {
          enforceCaps(usage.totalTokens);
        }, _.noop);
      }, ENFORCEMENT_INTERVAL_MS);

      void (async () => {
        try {
          for await (const event of partUpdates) {
            if (event.id !== id) {
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
                taskId: id,
              });
              const role = stored.isOk() ? stored.value[0]?.role : undefined;
              if (role === undefined || role === "assistant") {
                firstTextAt ??= seenAt;
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
              const usage = await getTaskUsageSummary(id);
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
      const isTimed = (followUp?: FollowUp) => followUp?.afterMs !== undefined;
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
        if (followUp.afterMs !== undefined) {
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
        const steering = isTimed(followUp) && isWorking(id);
        write(
          `${evalPrefix(label)}${c.dim}Follow-up${steering ? " (mid-turn)" : ""}: ${followUp.prompt.slice(0, 60)}${c.reset}\n`,
        );
        await call(
          messageRoute.create,
          { id, modelURI: uri, prompt: followUp.prompt, sessionId },
          { context },
        );
        lastSentAt = Date.now();
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

      const usage = await getTaskUsageSummary(id);
      // What a delegating run actually spent is the conversation plus every
      // task it started; the conversation's own total is a fraction of it, and
      // reporting only that would make delegation look free.
      const childTaskIds = await treeTaskIds(id);
      const childUsages = await Promise.all(
        childTaskIds.map((childId) => getTaskUsageSummary(childId)),
      );
      const treeUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      for (const one of [usage, ...childUsages]) {
        treeUsage.inputTokens += one.inputTokens;
        treeUsage.outputTokens += one.outputTokens;
        treeUsage.totalTokens += one.totalTokens;
      }
      const metrics = {
        ...(await metricsFor(id, childTaskIds, {
          doneAt,
          firstTextAt,
          startedAt,
        })),
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
        `${evalPrefix(label)}${c.green}Done.${c.reset}${c.dim} (${finishedRuns}/${totalRuns} complete, ${formatNumber(treeUsage.totalTokens)} tokens${childTaskIds.length > 0 ? ` across ${childTaskIds.length + 1} tasks` : ""}${costUSD === undefined ? "" : `, ~${formatCost(costUSD)}`})${c.reset}\n`,
      );

      return {
        childTaskIds,
        costUSD,
        label,
        metrics,
        modelLabel,
        modelURI: uri,
        name: evalCase.name,
        overBudget,
        resolvedModelId: catalog.aliasTargets.get(uri.split("?")[0] ?? uri),
        stoppedBy,
        taskId: id,
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
 * Every session of a task, parts included, which is what an assertion reads and
 * what a suite needs to render anything of its own afterwards. Exported because
 * each standalone runner had otherwise written this same function privately.
 */
export async function sessionsFor(
  taskId: TaskId,
): Promise<Session.WithMessagesAndParts[]> {
  const list = await Store.getSessions(taskId, { includeChildSessions: true });
  if (list.isErr()) {
    return [];
  }
  const sessions: Session.WithMessagesAndParts[] = [];
  for (const session of list.value) {
    const withParts = await Store.getSessionWithMessagesAndParts(
      session.id,
      taskId,
    );
    if (withParts.isOk()) {
      sessions.push(withParts.value);
    }
  }
  return sessions;
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
 * A read-only attachment is shared instead. Nothing a run does can change it,
 * so the isolation the copy buys is worth nothing there, while the copy itself
 * is a per-run walk of the whole tree: a case that attaches a folder large
 * enough to be interesting spends longer copying it than the agent spends
 * working in it.
 *
 * The basename is preserved because it becomes the mount name, which the case's
 * own prompt refers to ("my Reports folder").
 */
function privateFoldersFor(evalCase: EvalCase, index: number) {
  return evalCase.folders?.map(({ inPlace, ...folder }) => {
    if (folder.access === "read-only" || inPlace) {
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
 * Appends to the task agent's system prompt for the rest of the process,
 * both where the baseline is built and where a stored one is checked
 * against it, so the two agree and the baseline is not rebuilt every turn.
 */
function appendToTaskSystemPrompt(extra: () => string) {
  const agent = AGENTS.main;
  const baseSystemPrompt = agent.systemPrompt;
  const baseGetMessages = agent.getMessages;
  agent.systemPrompt = () => `${baseSystemPrompt()}\n\n${extra()}`;
  agent.getMessages = async (options) => {
    const base = baseSystemPrompt();
    return (await baseGetMessages(options)).map((message) =>
      message.metadata.realRole === "system"
        ? {
            ...message,
            parts: message.parts.map((part) =>
              part.type === "text" && part.text === base
                ? { ...part, text: `${part.text}\n\n${extra()}` }
                : part,
            ),
          }
        : message,
    );
  };
}

/** See `RunMetrics`. */
async function metricsFor(
  taskId: TaskId,
  childTaskIds: TaskId[],
  {
    doneAt,
    firstTextAt,
    startedAt,
  }: { doneAt: number; firstTextAt?: number; startedAt: number },
): Promise<Omit<RunMetrics, "cacheReadTokens">> {
  const own = await Store.getSessions(taskId);
  let visibleChars = 0;
  const taskCommands = { fork: 0, new: 0 };
  for (const session of own.isOk() ? own.value : []) {
    const withParts = await Store.getSessionWithMessagesAndParts(
      session.id,
      taskId,
    );
    for (const message of withParts.isOk() ? withParts.value.messages : []) {
      if (message.role !== "assistant") {
        continue;
      }
      for (const part of message.parts) {
        if (part.type === "text") {
          visibleChars += part.text.trim().length;
        }
        if (part.type === "tool-bash" && part.input?.command) {
          const command: string = part.input.command;
          taskCommands.fork += [
            ...command.matchAll(/(?:^|[\n;&|])\s*task fork\b/g),
          ].length;
          taskCommands.new += [
            ...command.matchAll(/(?:^|[\n;&|])\s*task new\b/g),
          ].length;
        }
      }
    }
  }
  let toolCalls = 0;
  for (const one of [taskId, ...childTaskIds]) {
    for (const session of await sessionsFor(one)) {
      for (const message of session.messages) {
        toolCalls += message.parts.filter((part) => isToolPart(part)).length;
      }
    }
  }
  return {
    doneMs: doneAt - startedAt,
    firstTextMs:
      firstTextAt === undefined ? undefined : firstTextAt - startedAt,
    taskCommands,
    tasksCreated: childTaskIds.length,
    toolCalls,
    visibleChars,
  };
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
  chatId: TaskId,
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
    expectStop(child.id);
    workspaceRef.send({ type: "stopSessions", value: { id: child.id } });
    while (isWorking(child.id)) {
      await new Promise((resolve) => setTimeout(resolve, TREE_POLL_MS));
    }
    for (const tab of leavesOpen) {
      standInWindow.openPage(tab);
    }
    wakeChatWithTaskEvent(
      chatId,
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
        taskId: child.id,
        title: child.title,
      },
      workspaceRef,
    );
  }
}

/** Every task descended from this one, however deep. */
async function treeTaskIds(rootTaskId: TaskId): Promise<TaskId[]> {
  const found: TaskId[] = [];
  const frontier = [rootTaskId];
  while (frontier.length > 0) {
    const next = frontier.pop();
    if (next === undefined) {
      break;
    }
    const chatId = resolveChat(next);
    for (const child of chatId ? await listChildTasks(chatId) : []) {
      found.push(child.id);
      frontier.push(child.id);
    }
  }
  return found;
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
 * Waits until no task in this run's tree has been working for a continuous
 * stretch, so a lull between a child finishing and its wake reaching the
 * chat is not mistaken for the end.
 *
 * Scoped to the tree rather than the workspace because one workspace holds
 * every concurrent run of a suite, and waiting on all of them would make each
 * run as long as the slowest.
 */
async function waitForTreeQuiet(
  rootTaskId: TaskId,
  { timeoutMs }: { timeoutMs: number },
): Promise<{ quietSince: number; status: "quiet" } | { status: "timeout" }> {
  const deadline = Date.now() + timeoutMs;
  let quietSince: number | undefined;
  while (Date.now() < deadline) {
    const working = [rootTaskId, ...(await treeTaskIds(rootTaskId))].some(
      (taskId) => isWorking(taskId),
    );
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
