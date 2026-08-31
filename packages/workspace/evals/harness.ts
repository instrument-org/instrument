import "dotenv/config";
import {
  aiGatewayApp,
  AIGatewayModelURI,
  noopModelCache,
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

import { workspaceMachine } from "../src/electron";
import { isToolPart } from "../src/lib/is-tool-part";
import { createProject } from "../src/lib/project";
import { Store } from "../src/lib/store";
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
  /** 1-based, and only meaningful when `repeat` asked for more than one. */
  trial: number;
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
    repeat = 1,
  }: {
    concurrency?: number;
    dryRun?: boolean;
    maxRunSeconds?: number;
    maxRunTokens?: number;
    models?: string[];
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
        return call(
          taskRoute.create,
          {
            files: evalCase.files,
            folders: privateFoldersFor(evalCase, index),
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
      const doneTimeoutMs =
        maxRunSeconds > 0 ? maxRunSeconds * 1000 + STOP_GRACE_MS : undefined;
      let outcome = await waitForSessionDone(sessionId, id, {
        timeoutMs: doneTimeoutMs,
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
          timeoutMs: doneTimeoutMs,
        });
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
      const price = catalog.priceFor(uri.split("?")[0] ?? uri);
      const costUSD = price
        ? usage.inputTokens * price.prompt +
          usage.outputTokens * price.completion
        : undefined;

      finishedRuns += 1;
      write(
        `${evalPrefix(label)}${c.green}Done.${c.reset}${c.dim} (${finishedRuns}/${totalRuns} complete, ${formatNumber(usage.totalTokens)} tokens${costUSD === undefined ? "" : `, ~${formatCost(costUSD)}`})${c.reset}\n`,
      );

      return {
        costUSD,
        label,
        modelLabel,
        modelURI: uri,
        name: evalCase.name,
        overBudget,
        resolvedModelId: catalog.aliasTargets.get(uri.split("?")[0] ?? uri),
        stoppedBy,
        taskId: id,
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
