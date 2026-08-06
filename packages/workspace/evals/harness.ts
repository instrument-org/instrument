import "dotenv/config";
import {
  aiGatewayApp,
  AIGatewayModelURI,
  noopModelCache,
} from "@instrument-org/ai-gateway";
import { APP_NAME_SLUG } from "@instrument-org/shared";
import { call } from "@orpc/server";
import { execa } from "execa";
import os from "node:os";
import path from "node:path";
import * as _ from "radashi";
import { ulid } from "ulid";
import { createActor } from "xstate";

import type { Session } from "../src/schemas/session";

import { workspaceMachine } from "../src/electron";
import { isToolPart } from "../src/lib/is-tool-part";
import { createProject } from "../src/lib/project";
import { getTaskUsageSummary } from "../src/lib/usage-summary";
import { publisher } from "../src/rpc/publisher";
import { session as sessionRoute } from "../src/rpc/routes/session";
import { task as taskRoute } from "../src/rpc/routes/task";
import { type FileUpload } from "../src/schemas/file-upload";
import { type ProjectId } from "../src/schemas/project-id";
import { type SessionMessagePart } from "../src/schemas/session/message-part";
import { type StoreId } from "../src/schemas/store-id";
import { type TaskId } from "../src/schemas/task-id";
import { unavailableWebSearchClient } from "../src/schemas/web-search";
import { createStubBrowserConfig } from "../src/test/helpers/mock-task-config";
import {
  buildProviderConfigs,
  c,
  formatNumber,
  modelURI,
  resolveOpenRouterAliases,
  resolveRegistryDir,
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
  label: string;
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
  taskId: TaskId;
}

/**
 * Ceiling on one run's total tokens before the harness stops it.
 *
 * Set from measurement rather than taste: the most expensive legitimate run
 * observed was around 700K, and the cheapest runaway was 1.3M. Anything past
 * this is a model that has stopped making progress, and the cost of letting it
 * continue is unbounded.
 */
export const DEFAULT_MAX_RUN_TOKENS = 1_000_000;

export interface EvalCase {
  assertions?: Assertion[];
  files?: FileUpload.Type[];
  folders?: { path: string }[];
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

export async function runEvals(
  evals: EvalCase[],
  {
    concurrency = 3,
    dryRun = false,
    maxRunTokens = DEFAULT_MAX_RUN_TOKENS,
    models = MODELS,
  }: {
    concurrency?: number;
    dryRun?: boolean;
    maxRunTokens?: number;
    models?: string[];
  } = {},
): Promise<{ runs: CompletedRun[]; workspaceRootDir: string }> {
  const workspaceRootDir = path.join(
    os.tmpdir(),
    `${APP_NAME_SLUG}-evals-${ulid()}`,
  );
  const providerConfigs = buildProviderConfigs();
  const registryDir = resolveRegistryDir();

  process.stdout.write(`${c.dim}Workspace :${c.reset} ${workspaceRootDir}\n`);
  process.stdout.write(`${c.dim}Registry  :${c.reset} ${registryDir}\n`);

  const aliasTargets = await resolveOpenRouterAliases(models);
  for (const [alias, target] of aliasTargets) {
    process.stdout.write(
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

  const runs = models.flatMap((uri) => {
    const parsed = AIGatewayModelURI.parse(uri);
    const canonicalId = parsed.ok ? parsed.value.canonicalId : uri;
    const modelPrefix = sanitizeCanonicalId(canonicalId);
    return evals.map((evalCase) => ({ evalCase, modelPrefix, uri }));
  }).map((run, index) => ({ ...run, index }));

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
    async ({ evalCase, index, modelPrefix, uri }) => {
      const label =
        models.length > 1 ? `${evalCase.name}/${modelPrefix}` : evalCase.name;

      process.stdout.write(
        `${evalPrefix(label)}${c.dim}Starting...${c.reset}\n`,
      );

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
            name: `${evalCase.project.name} ${modelPrefix} ${index}`,
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
            folders: evalCase.folders,
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

      process.stdout.write(
        `${evalPrefix(label)}${c.green}Task created${c.reset}${c.dim} (id: ${id})${c.reset}\n`,
      );

      const abortController = new AbortController();
      let stoppedForBudget = false;
      let overBudget: number | undefined;
      const partUpdates = publisher.subscribe("part.updated", {
        signal: abortController.signal,
      });

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
              const taskId = id;
              const usage = await getTaskUsageSummary(taskId);
              const toolName = part.type.replace("tool-", "");
              const toolLabel = isError
                ? `${c.red}${toolName} ERROR${c.reset}`
                : `${c.cyan}${toolName}${c.reset}`;
              const statsSuffix = `  ${c.dim}tokens=${c.reset}${formatNumber(usage.totalTokens)}${c.dim} (in=${formatNumber(usage.inputTokens)} out=${formatNumber(usage.outputTokens)}) msgs=${c.reset}${c.yellow}${usage.messageCount}${c.reset}`;
              stream.write(`${evalPrefix(label)}${toolLabel}${statsSuffix}\n`);

              // A model handed an unrecoverable input can keep trying to
              // recover from it, and nothing in the loop is wrong enough to
              // stop it: each attempt is a legitimate tool call. Measured, one
              // run has reached millions of tokens on a single question before
              // a human noticed. The eval harness is the one place that can see
              // the running total and act on it, so it does.
              if (
                maxRunTokens > 0 &&
                usage.totalTokens > maxRunTokens &&
                !stoppedForBudget
              ) {
                stoppedForBudget = true;
                overBudget = usage.totalTokens;
                process.stderr.write(
                  `${evalPrefix(label)}${c.red}Over budget${c.reset}${c.dim}: ${formatNumber(usage.totalTokens)} tokens > ${formatNumber(maxRunTokens)}, stopping. Raise with --max-run-tokens, or 0 to disable.${c.reset}\n`,
                );
                void call(sessionRoute.stop, { id }, { context });
              }
            }

            if (await evalCase.shouldStop?.(part, id)) {
              process.stdout.write(
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

      await waitForSessionDone(sessionId, id);
      abortController.abort();

      process.stdout.write(`${evalPrefix(label)}${c.green}Done.${c.reset}\n`);

      return {
        label,
        modelURI: uri,
        name: evalCase.name,
        overBudget,
        resolvedModelId: aliasTargets.get(uri.split("?")[0] ?? uri),
        taskId: id,
      };
    },
  );

  actor.stop();

  return { runs: completed, workspaceRootDir };
}

function sanitizeCanonicalId(canonicalId: string): string {
  return canonicalId.replaceAll(/[^a-z0-9-]/gi, "-");
}

async function waitForSessionDone(
  sessionId: StoreId.Session,
  id: string,
): Promise<void> {
  return new Promise((resolve) => {
    const abortController = new AbortController();
    const unsubscribe = publisher.subscribe("session.done", {
      signal: abortController.signal,
    });

    void (async () => {
      try {
        for await (const event of unsubscribe) {
          if (event.sessionId === sessionId && event.id === id) {
            abortController.abort();
            resolve();
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
