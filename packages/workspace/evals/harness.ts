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

import type { Session } from "../src/schemas/session";

import { attachOrchestrator, workspaceMachine } from "../src/electron";
import { createMemoryAppsConfig } from "../src/lib/apps/memory-config";
import { isToolPart } from "../src/lib/is-tool-part";
import { isWorking } from "../src/lib/orchestrator/activity";
import { listChildTasks } from "../src/lib/orchestrator/children";
import { outputFolderPath } from "../src/lib/orchestrator/output-folder";
import { createProject } from "../src/lib/project";
import { Store } from "../src/lib/store";
import { updateTaskSettings } from "../src/lib/task-settings";
import { getTaskUsageSummary } from "../src/lib/usage-summary";
import { publisher } from "../src/rpc/publisher";
import { message as messageRoute } from "../src/rpc/routes/message";
import { session as sessionRoute } from "../src/rpc/routes/session";
import { task as taskRoute } from "../src/rpc/routes/task";
import { type FileUpload } from "../src/schemas/file-upload";
import { type FolderAttachment } from "../src/schemas/folder-attachment";
import { type ProjectId } from "../src/schemas/project-id";
import { type SessionMessagePart } from "../src/schemas/session/message-part";
import { type StoreId } from "../src/schemas/store-id";
import { type TaskId } from "../src/schemas/task-id";
import { type TaskKind } from "../src/schemas/task-kind";
import { unavailableWebSearchClient } from "../src/schemas/web-search";
import { createStubBrowserConfig } from "../src/test/helpers/mock-task-config";
import {
  buildProviderConfigs,
  c,
  fetchOpenRouterCatalog,
  formatCost,
  formatNumber,
  modelURI,
  resolveRegistryDir,
  write,
} from "./utils";

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
 * What a change is validated against by default: the current frontier model
 * from each closed provider, plus the strongest open-weights one, because a
 * harness affordance that only one family finds is not built yet.
 *
 * OpenRouter's `~author/<name>-latest` aliases move as new builds ship, so this list
 * does not need editing to stay representative -- and `runEvals` prints what
 * each one resolved to, since a result against "latest" is otherwise
 * unattributable a month later. OpenAI is the exception and stays pinned:
 * `~openai/gpt-latest` resolves to the reasoning line, not the model the app's
 * auto setting actually sends users to.
 */
export const MODELS = [
  modelURI.openRouter("~anthropic/claude-sonnet-latest"),
  modelURI.openRouter("~google/gemini-pro-latest"),
  modelURI.openRouter("openai/gpt-5.6-luna"),
  modelURI.openRouter("~moonshotai/kimi-latest"),
];

export interface CompletedRun {
  /** Every task this run's task started, however deep. Empty unless it delegated. */
  childTaskIds: TaskId[];
  /** Approximate USD, when the model's price is known. See `formatCost`. */
  costUSD?: number;
  label: string;
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
  /** This task alone, which for an orchestrator is the conversation only. */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
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
 * How long every task in an orchestrator's tree has to sit idle before the run
 * is called finished.
 *
 * An orchestrator's own turn ends the moment it hands work off, which is the
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

export interface ChildTaskSessions {
  sessions: Session.WithMessagesAndParts[];
  taskId: TaskId;
  title: string;
}

export interface EvalCase {
  assertions?: Assertion[];
  files?: FileUpload.Type[];
  folders?: { access?: FolderAttachment.Access; path: string }[];
  /**
   * Further user turns, sent one at a time on the same session once the turn
   * before it has settled. For behavior that only exists across turns: a
   * context rollover, or anything the agent is supposed to carry forward
   * rather than re-derive. Assertions see every session the run produced.
   */
  followUps?: string[];
  /**
   * Which agent answers the prompt. An orchestrator delegates to tasks it
   * creates inside the same workspace, so a run of that kind produces the
   * orchestrator's transcript plus one per task it made.
   */
  kind?: TaskKind;
  name: string;
  /**
   * Run the task inside a project created for it. The only way to exercise the
   * standing project context and the `/project` mount: both hang off the task's
   * project, so a task created without one has neither.
   */
  project?: { instructions?: string; name: string };
  prompt: string;
  shouldStop?: (
    part: SessionMessagePart.Type,
    taskId: TaskId,
  ) => boolean | Promise<boolean>;
}

interface AssertionContext {
  /**
   * Every task this one started, with its sessions: what an orchestrator case
   * needs, since the work it is scored on happened in those rather than in the
   * conversation. A function because reading them costs a directory scan per
   * task and most assertions never ask.
   */
  childSessions: () => Promise<ChildTaskSessions[]>;
  sessions: Session.WithMessagesAndParts[];
  taskId: TaskId;
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
    models = MODELS,
    reasoningEffort,
    repeat = 1,
  }: {
    concurrency?: number;
    dryRun?: boolean;
    maxRunSeconds?: number;
    maxRunTokens?: number;
    models?: string[];
    /** Asked of every task this run creates, the conversation's own included. */
    reasoningEffort?: ReasoningEffort;
    repeat?: number;
  } = {},
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

  const actor = createActor(workspaceMachine, {
    input: {
      aiGatewayApp,
      apps: createMemoryAppsConfig(),
      appVersion: "0.0.0-test",
      browser: createStubBrowserConfig(),
      captureEvent: () => {
        return;
      },
      captureException: (...args: unknown[]) => {
        // eslint-disable-next-line no-console
        console.error("captureException", ...args);
      },
      defaultTaskTemplateDir: path.resolve(
        import.meta.dirname,
        "../templates/default",
      ),
      getAIProviderConfigs: () => providerConfigs,
      isExternalBrowserEnabled: () => true,
      modelCache: noopModelCache,
      nodeExecEnv: {},
      pnpmBinPath: await execa({ reject: false })`which pnpm`.then(
        (result) => result.stdout.trim() || "pnpm",
      ),
      preparedSkillsDir: path.join(workspaceRootDir, "prepared-skills"),
      registryDir,
      rootDir: workspaceRootDir,
      shimClientDir: "dev-server",
      systemSkillsDir: path.resolve(import.meta.dirname, "../system-skills"),
      trashItem: () => Promise.reject(new Error("Not implemented")),
      uvBinPath: await execa({ reject: false })`which uv`.then(
        (result) => result.stdout.trim() || "uv",
      ),
      uvDataDir: path.join(workspaceRootDir, "uv-data"),
      webSearch: unavailableWebSearchClient,
    },
  });

  attachOrchestrator(actor);
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

      // One project per run. Disambiguated by the run's index rather than by the
      // case name, because the project name reaches the agent as "this task
      // belongs to the X project" -- a case named for what it is checking would
      // be telling the model the answer.
      const created = creating.then(async () => {
        let projectId: ProjectId | undefined;
        if (evalCase.project) {
          const project = await createProject({
            instructions: evalCase.project.instructions,
            name: `${evalCase.project.name} ${modelLabel} ${index}`,
          });
          if (project.isErr()) {
            throw project.error;
          }
          projectId = project.value.id;
        }
        const folders = [
          ...(privateFoldersFor(evalCase, index) ?? []),
          ...(evalCase.kind === "orchestrator" ? orchestratorFolders() : []),
        ];
        return call(
          taskRoute.create,
          {
            files: evalCase.files,
            folders: folders.length > 0 ? folders : undefined,
            kind: evalCase.kind,
            modelURI: uri,
            name: evalCase.name,
            projectId,
            prompt: evalCase.prompt,
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
      let stoppedBy: RunStop | undefined;
      let overBudget: number | undefined;
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
      let outcome = await waitForSessionDone(sessionId, id, {
        timeoutMs: remainingMs(),
      });

      // Follow-ups run before the teardown below, so the caps timer and the
      // part subscription cover the whole conversation rather than its first
      // turn: a run that loops on turn four is the same runaway as one that
      // loops on turn one. A turn that stopped or timed out ends the run
      // rather than asking the next question into a session that is not
      // listening.
      for (const followUp of evalCase.followUps ?? []) {
        if (stoppedBy || outcome === "timeout") {
          break;
        }
        write(
          `${evalPrefix(label)}${c.dim}Follow-up: ${followUp.slice(0, 60)}${c.reset}\n`,
        );
        await call(
          messageRoute.create,
          { id, modelURI: uri, prompt: followUp, sessionId },
          { context },
        );
        outcome = await waitForSessionDone(sessionId, id, {
          timeoutMs: remainingMs(),
        });
      }

      // The children and the wake they trigger are the rest of an orchestrator
      // run. Everything above this line has only watched the conversation.
      if (evalCase.kind === "orchestrator" && !stoppedBy) {
        const settled = await waitForTreeQuiet(id, {
          timeoutMs: remainingMs() ?? DEFAULT_MAX_RUN_SECONDS * 1000,
        });
        if (settled === "timeout") {
          stoppedBy = "timeout";
          process.stderr.write(
            `${evalPrefix(label)}${c.red}Tree never settled${c.reset}${c.dim}: a task in this run was still working when time ran out.${c.reset}\n`,
          );
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
      const price = catalog.priceFor(uri.split("?")[0] ?? uri);
      const costUSD = price
        ? treeUsage.inputTokens * price.prompt +
          treeUsage.outputTokens * price.completion
        : undefined;

      finishedRuns += 1;
      write(
        `${evalPrefix(label)}${c.green}Done.${c.reset}${c.dim} (${finishedRuns}/${totalRuns} complete, ${formatNumber(treeUsage.totalTokens)} tokens${childTaskIds.length > 0 ? ` across ${childTaskIds.length + 1} tasks` : ""}${costUSD === undefined ? "" : `, ~${formatCost(costUSD)}`})${c.reset}\n`,
      );

      return {
        childTaskIds,
        costUSD,
        label,
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
 * The two folders `orchestrator.ensure` attaches to the conversation in the
 * app: the user's home, and the workspace folder inside it that results go to
 * when nobody said where.
 *
 * They ride on the first message rather than being attached after the task is
 * created, because the session's context baseline is written the first time the
 * session needs model input and then reused byte for byte. A folder attached a
 * moment too late is a folder the agent is never told about, and an
 * orchestrator that believes it has no mounts cannot read back what its own
 * children wrote: measured, it spends ten tool calls and 240K tokens hunting a
 * file it was told to have them write, against two and 96K when it can see it.
 *
 * Unlike a case's own folders these are not copied per run, because `task new`
 * hands every child the workspace folder from the same `$HOME`-derived global:
 * a private copy for the conversation would put the children somewhere else.
 * They are sandboxed away from the developer's real files by
 * `evals/lib/sandbox-home`, but still shared across runs in one process, so run
 * orchestrator cases at low concurrency and give a separate process its own
 * `INSTRUMENT_EVAL_HOME` when two runs must not see each other's output.
 */
function orchestratorFolders(): { access: "read-write"; path: string }[] {
  const workspaceFolder = outputFolderPath();
  fs.mkdirSync(workspaceFolder, { recursive: true });
  return [
    { access: "read-write", path: os.homedir() },
    { access: "read-write", path: workspaceFolder },
  ];
}

/**
 * A run's own copy of each folder the case attaches.
 *
 * One case runs against every model at once, and they would otherwise share a
 * single directory: a read-write attachment means each run sees the files the
 * others just wrote, and a model that finds three charts it did not make
 * behaves nothing like one working in the folder the user actually has. The
 * copy is cheap next to an agent turn, so it is unconditional rather than
 * limited to writable attachments.
 *
 * The basename is preserved because it becomes the mount name, which the case's
 * own prompt refers to ("my Reports folder").
 */
function privateFoldersFor(evalCase: EvalCase, index: number) {
  return evalCase.folders?.map((folder) => {
    const root = path.join(
      os.tmpdir(),
      `${APP_NAME_SLUG}-eval-folders-${ulid()}-${index}`,
      path.basename(folder.path),
    );
    fs.cpSync(folder.path, root, { recursive: true });
    return { ...folder, path: root };
  });
}

function sanitizeCanonicalId(canonicalId: string): string {
  return canonicalId.replaceAll(/[^a-z0-9-]/gi, "-");
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
    for (const child of await listChildTasks(next)) {
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
 * orchestrator is not mistaken for the end.
 *
 * Scoped to the tree rather than the workspace because one workspace holds
 * every concurrent run of a suite, and waiting on all of them would make each
 * run as long as the slowest.
 */
async function waitForTreeQuiet(
  rootTaskId: TaskId,
  { timeoutMs }: { timeoutMs: number },
): Promise<"quiet" | "timeout"> {
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
        return "quiet";
      }
    }
    await new Promise((resolve) => setTimeout(resolve, TREE_POLL_MS));
  }
  return "timeout";
}
