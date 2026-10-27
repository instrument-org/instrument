import fs from "node:fs/promises";
import path from "node:path";

import { getChatInfos } from "../src/lib/chat-info";
import { listChildTasks } from "../src/lib/chat/children";
import { getSessionMarkdown } from "../src/lib/session-to-markdown";
import { isToolPart } from "../src/lib/is-tool-part";
import { SessionMessage } from "../src/schemas/session/message";
import { ChatReads } from "../src/lib/chat-reads";
import { chatDir, resolveChat, sessionOfChat } from "../src/lib/record-folders";
import {
  ChatRecords,
  installChatRecords,
  writingChatRecords,
} from "../src/lib/records/chat-records";
import { workDir } from "../src/lib/work-dir";
import { chatModelURI } from "../src/lib/chat-settings";
import { getUsageSummary } from "../src/lib/usage-summary";
import {
  hasWorkspaceConfig,
  setWorkspaceConfig,
} from "../src/lib/workspace-config";
import {
  type AssertionResult,
  type CompletedRun,
  type EvalCase,
  modelLabelFor,
  runKey,
  type RunMetrics,
  type RunStop,
  childSessionsOf,
  childTasksOf,
  sessionsFor,
} from "./harness";
import {
  type GitProvenance,
  gitProvenance,
  systemPromptDigest,
} from "./provenance";
import {
  buildReportWorkspaceConfig,
  c,
  fetchOpenRouterCatalog,
  type OpenRouterCatalog,
  write,
} from "./utils";
import { readRunRecord } from "./lib/run-record";
import {
  addRunCosts,
  type CostSource,
  costSourceOf,
  modelCostUSD,
  readChatSpend,
  type RunCost,
  runCostOf,
} from "./lib/run-cost";
import { renderUserView } from "./lib/user-view";
import { StoreId } from "../src/schemas/store-id";
import { type ChatId } from "../src/schemas/chat-id";

export interface RollupSummary {
  assertions: {
    failed: number;
    pass_rate: number;
    passed: number;
    total: number;
  };
  /** Every run's `RunCost` added up. */
  cost: RunCost;
  costSource?: CostSource;
  /** The runs' model requests, searches apart. See `CompletedRun.costUSD`. */
  costUSD?: number;
  /** Tasks where at least one model request failed (rate limit, credits, ...). */
  erroredTasks: number;
  modelURIs: string[];
  /** What this run measured, for a reader who has only the directory. */
  provenance: {
    generatedAt: string;
    git?: GitProvenance;
    /**
     * Distinct across the run's tasks, so more than one says the session
     * context was rebuilt part way through and the tasks were not all scored
     * against the same prompt.
     */
    systemPromptSha256: string[];
  };
  results: RunReport[];
  /** Estimated, apart from `costUSD`. See `RunCost.search`. */
  searchCostUSD?: number;
  /** Tasks the harness or the case ended on purpose. Not a failure. */
  stoppedTasks: number;
  tasks: number;
}

/** What one run produced, in the form a caller can act on without re-reading. */
export interface RunReport {
  assertions: AssertionResult[];
  caseName: string;
  cost: RunCost;
  costSource?: CostSource;
  costUSD?: number;
  /** Model requests that genuinely failed. A deliberate stop is not one. */
  erroredRequests: number;
  failed: number;
  label: string;
  /** Present only for runs this process watched. See `RunMetrics`. */
  metrics?: RunMetrics;
  modelURI?: string;
  /** Where this run's transcript and assertions were written. */
  outputDir: string;
  passed: number;
  resolvedModelId?: string;
  searchCostUSD?: number;
  stoppedBy?: RunStop;
  /** The system prompt this task was scored against. See `provenance`. */
  systemPromptSha256?: string;
  chatId: string;
  totalTokens: number;
  /** 1-based: which of a `--repeat` run's trials this was. */
  trial: number;
  /** This task plus every task it started, for runs this process watched. */
  treeTokens?: number;
  treeUsage?: CompletedRun["treeUsage"];
}

/**
 * Evidence is written whole to `assertions.json` and trimmed for the terminal.
 * One serialized tool call can run to several hundred characters, and a wall of
 * them buries the pass/fail column that is the reason to look at all.
 */
const MAX_CONSOLE_EVIDENCE = 300;

/**
 * The calls a run asked for and never made: a tool part still waiting for its
 * input to finish arriving, or holding a finished input that was never run.
 *
 * The sweep settles a dangling part when a session is stopped, so one still
 * open once a run is over means the run ended between the model asking for
 * the call and the call being made. The assertions then measure a session
 * that never happened, which is not the same as a model getting something
 * wrong, and a report that cannot tell them apart says the wrong thing about
 * both.
 */
export function unfinishedCalls(
  messages: readonly SessionMessage.WithParts[],
): { messageId: string; state: string; type: string }[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      isToolPart(part) &&
      (part.state === "input-available" || part.state === "input-streaming")
        ? [{ messageId: message.id, state: part.state, type: part.type }]
        : [],
    ),
  );
}

export async function generateReport({
  caseForRoots,
  evalCases = [],
  includeContextMessages = false,
  outputDir,
  runs = [],
  workspaceRootDir,
}: {
  /**
   * The case every task that no chat started is scored as, for a workspace
   * that holds one case's run. Without the runs that made it, a chat is
   * known only by the title it was given since, not by its case's name.
   */
  caseForRoots?: string;
  evalCases?: EvalCase[];
  includeContextMessages?: boolean;
  outputDir: string;
  runs?: CompletedRun[];
  workspaceRootDir: string;
}): Promise<RollupSummary> {
  // Only a report for runs this process just watched can speak for the tree
  // they ran against. `pnpm eval report` re-scores sessions recorded whenever,
  // from whatever checkout is standing here now, and stamping today's commit on
  // last week's numbers is worse than leaving the field out. The prompt digest
  // is read from the sessions either way, so a re-report keeps the half that
  // describes the run rather than the reader.
  const git =
    runs.length > 0 ? await gitProvenance(import.meta.dirname) : undefined;
  const evalCasesByName = new Map(evalCases.map((e) => [e.name, e]));
  // A task's id is slugified from its prompt, not from the case name, so a name
  // can only be recovered from the run that produced it. Without this the match
  // below almost never succeeds and every committed assertion silently reports
  // nothing, which reads exactly like having no assertions to begin with.
  const runsByChatId = new Map(runs.map((run) => [run.chatId, run] as const));
  const absoluteWorkspaceDir = path.resolve(workspaceRootDir);
  const workspaceConfig = buildReportWorkspaceConfig(absoluteWorkspaceDir);
  // `chatDir()` and friends read the config from its module singleton, which the
  // `run` flow populates when the workspace machine boots. Reporting on a past
  // workspace dir never boots one, so seed it here -- but only when it is absent,
  // so a report generated at the end of a run keeps the machine's own config.
  if (!hasWorkspaceConfig()) {
    setWorkspaceConfig(workspaceConfig);
  }
  // Every read of a chat goes through the records a workspace puts in place
  // as it opens, so a re-report puts its own there the same way. It only
  // reads, and the process ends with the report.
  if (!writingChatRecords()) {
    installChatRecords(
      new ChatRecords({
        app: workspaceConfig.appVersion,
        device: workspaceConfig.deviceId,
        dirOf: chatDir,
      }),
    );
  }

  const listed = await getChatInfos({
    direction: "asc",
    sortBy: "createdAt",
  });
  // A task case runs in a chat nobody writes in (`startRun`), which has no
  // transcript to report.
  const tasks = (
    await Promise.all(
      listed.map(async (task) =>
        resolveChat(task.id) && !(await chatModelURI(task.id)) ? [] : [task],
      ),
    )
  ).flat();

  if (tasks.length === 0) {
    write("No tasks found in workspace.\n");
    return {
      assertions: { failed: 0, pass_rate: 0, passed: 0, total: 0 },
      cost: addRunCosts([]),
      erroredTasks: 0,
      modelURIs: [],
      provenance: {
        generatedAt: new Date().toISOString(),
        git,
        systemPromptSha256: [],
      },
      results: [],
      stoppedTasks: 0,
      tasks: 0,
    };
  }

  write(
    `${c.dim}Generating report for${c.reset} ${c.yellow}${tasks.length}${c.reset} ${c.dim}task(s)...${c.reset}\n`,
  );

  let rollupPassed = 0;
  let rollupFailed = 0;
  let rollupErroredTasks = 0;
  let rollupStoppedTasks = 0;
  const rollupPromptDigests = new Set<string>();
  // Prices for runs this process did not watch, fetched once per model.
  const catalogs = new Map<string, Promise<OpenRouterCatalog>>();
  const rollupModelURIs = new Set<string>();
  const results: RunReport[] = [];
  // A case run several times against one model would otherwise write every
  // trial to the same place. `report <dir>` has no trial numbers to read, so
  // the collision is settled here rather than assumed away.
  const claimedDirs = new Set<string>();

  for (const task of tasks) {
    const chatId = task.id;
    const run = runsByChatId.get(chatId);

    const taskModelURI = run?.modelURI ?? (await chatModelURI(chatId));
    if (taskModelURI) {
      rollupModelURIs.add(taskModelURI);
    }

    // A run this process did not watch is known by what the harness recorded
    // when it started (`recordRun`), so a report over a past workspace dir is
    // still matched to its case and filed by case, model and trial rather
    // than by a chat title or a slug of the prompt, which named nothing anyone
    // could act on.
    const recorded = run
      ? undefined
      : await readRunRecord(absoluteWorkspaceDir, chatId);
    const known = run ?? recorded;
    const rootSession = known
      ? { id: StoreId.SessionSchema.parse(known.sessionId), title: known.name }
      : await runSessionOf(chatId);
    if (!rootSession) {
      continue;
    }

    // A run from before runs were recorded: the session it went to carries
    // its case's name, which the harness gave it at creation (`startRun`),
    // unless the app has titled it since.
    const caseName = known?.name ?? caseForRoots ?? rootSession.title;
    const evalCase =
      evalCasesByName.get(caseName) ??
      evalCasesByName.get(task.id) ??
      [...evalCasesByName.entries()].find(([name]) =>
        task.id.endsWith(`-${name}`),
      )?.[1];

    const key = runKey({
      modelLabel: known?.modelLabel ?? modelLabelFor(taskModelURI ?? "unknown"),
      name: caseName,
      trial: known?.trial ?? 1,
    });
    let { dir: relativeDir, label } = key;
    for (let n = 2; claimedDirs.has(relativeDir); n += 1) {
      relativeDir = `${key.dir}-${n}`;
      label = `${key.label}-${n}`;
    }
    claimedDirs.add(relativeDir);

    const markdown = await getSessionMarkdown({
      includeContextMessages,
      sessionId: rootSession.id,
      chatId,
    });

    const taskOutputDir = path.join(outputDir, relativeDir);
    await fs.mkdir(taskOutputDir, { recursive: true });

    const stats = await getUsageSummary(chatId, {
      sessionId: rootSession.id,
    });

    // A run whose every step failed on a 402/429 still reaches this point having
    // produced a task and a transcript, so without this it reports exactly like a
    // run that worked. Surfacing it here is what keeps the summary trustworthy.
    //
    // An abort is not one of those. Both the token cap and a case's own
    // `shouldStop` end the session, and an aborted request stores an error like
    // any other -- so counting them together reported six cases working exactly
    // as designed as six provider failures, and the only way to tell was to open
    // the stored errors by hand.
    const sessionWithParts = await ChatReads.sessionWithMessages({
      chatId,
      sessionId: rootSession.id,
    });
    const messageErrors = sessionWithParts.isOk()
      ? sessionWithParts.value.messages.flatMap((message) =>
          message.role === "assistant" && message.metadata.error
            ? [message.metadata.error]
            : [],
        )
      : [];
    const apiErrors = messageErrors.filter((error) => error.kind !== "aborted");
    const aborted = messageErrors.length - apiErrors.length;
    const stoppedBy = run?.stoppedBy ?? (aborted > 0 ? "unknown" : undefined);
    // A call the run never finished. The sweep settles a dangling part when a
    // session is stopped, so one still open at report time means the run ended
    // between the model asking for the call and the call being made: the
    // assertions then measure a session that never happened, and counting it
    // as a pass with failures says the model was wrong about something it was
    // never given the chance to do.
    const unfinished = unfinishedCalls(
      sessionWithParts.isOk() ? sessionWithParts.value.messages : [],
    );
    const neverRan = stoppedBy === undefined && unfinished.length > 0;
    if (apiErrors.length > 0 || neverRan) {
      rollupErroredTasks += 1;
      await fs.writeFile(
        path.join(taskOutputDir, "errors.json"),
        JSON.stringify(
          { ...(neverRan && { unfinishedCalls: unfinished }), apiErrors },
          null,
          2,
        ),
        "utf8",
      );
    }
    if (stoppedBy) {
      rollupStoppedTasks += 1;
    }

    let cost = run?.cost;
    if (!cost) {
      const modelKey = taskModelURI ?? "";
      const catalog =
        catalogs.get(modelKey) ??
        fetchOpenRouterCatalog(taskModelURI ? [taskModelURI] : []);
      catalogs.set(modelKey, catalog);
      const { priceFor } = await catalog;
      const spent = await readChatSpend(chatId, [
        rootSession.id,
        ...(await childTasksOf(chatId, rootSession.id)),
      ]);
      cost = runCostOf(spent.messages, {
        billed: spent.billed,
        price: taskModelURI
          ? priceFor(taskModelURI.split("?")[0] ?? taskModelURI)
          : undefined,
        priceFor,
      });
    }
    const costUSD = modelCostUSD(cost);
    const searchCostUSD =
      cost.search.searches > 0 ? cost.search.estimatedUSD : undefined;

    await fs.writeFile(
      path.join(taskOutputDir, "session.md"),
      markdown,
      "utf8",
    );
    await fs.writeFile(
      path.join(taskOutputDir, "stats.json"),
      JSON.stringify(stats, null, 2),
      "utf8",
    );
    // What the run made, and beside it the chat's records.
    await fs
      .symlink(workDir(chatId), path.join(taskOutputDir, "task"))
      .catch(() => {
        return;
      });
    await fs
      .symlink(chatDir(chatId), path.join(taskOutputDir, "record"))
      .catch(() => {
        return;
      });

    if (!evalCase) {
      process.stderr.write(
        `Warning: no eval case matched "${caseName}" (${task.id}); its assertions, if any, were not run.\n`,
      );
    }

    // Read once for both the digest and the assertions: the digest has to be
    // recorded for every task, including one with no assertions to run, and
    // that is the case where the old code never loaded the sessions at all.
    const sessions = await sessionsFor(chatId, rootSession.id);
    const systemPromptSha256 = systemPromptDigest(sessions);
    if (evalCase?.kind === "chat") {
      await fs.writeFile(
        path.join(taskOutputDir, "user-view.md"),
        renderUserView(sessions),
        "utf8",
      );
    }
    if (systemPromptSha256) {
      rollupPromptDigests.add(systemPromptSha256);
    }

    await fs.writeFile(
      path.join(taskOutputDir, "eval-case.json"),
      JSON.stringify(
        {
          cost,
          costSource: costSourceOf(cost),
          costUSD,
          metrics: run?.metrics,
          modelURI: taskModelURI,
          name: caseName,
          treeUsage: run?.treeUsage,
          resolvedModelId: run?.resolvedModelId,
          searchCostUSD,
          stoppedBy,
          systemPromptSha256,
          chatId: task.id,
          trial: known?.trial ?? 1,
        },
        null,
        2,
      ),
      "utf8",
    );

    let assertionResults: AssertionResult[] = [];
    if (evalCase?.assertions && evalCase.assertions.length > 0) {
      // A conversation that forks does much of what it is being scored on
      // inside its tasks, which are sessions of the chat's beside its own, so
      // `sessions` alone cannot see the work. Read lazily: only a chat case
      // has children, and only some of its assertions ask.
      const childSessions = () => childSessionsOf(chatId, rootSession.id);
      assertionResults = await Promise.all(
        // A check that throws fails that assertion alone, so one broken
        // check does not take the rest of the report down with it.
        evalCase.assertions.map((a) =>
          Promise.resolve()
            .then(() => a.check({ childSessions, sessions, chatId }))
            .catch(
              (error: unknown): AssertionResult => ({
                evidence: `check threw: ${error instanceof Error ? error.message : String(error)}`,
                passed: false,
                text: a.text,
              }),
            ),
        ),
      );
      // A follow-up that had to land mid-work and landed after the turn
      // instead scored the case against a moment that never happened.
      const missed = run?.metrics?.duringWorkMissed ?? 0;
      if (missed > 0) {
        assertionResults.push({
          evidence: `${String(missed)} sent after the turn ended instead`,
          passed: false,
          text: "every mid-work follow-up landed while the work ran",
        });
      }
      const passed = assertionResults.filter((r) => r.passed).length;
      const failed = assertionResults.filter((r) => !r.passed).length;
      const total = assertionResults.length;
      rollupPassed += passed;
      rollupFailed += failed;

      const assertionsOutput = {
        assertion_results: assertionResults,
        summary: {
          failed,
          pass_rate: total > 0 ? passed / total : 0,
          passed,
          total,
        },
      };
      await fs.writeFile(
        path.join(taskOutputDir, "assertions.json"),
        JSON.stringify(assertionsOutput, null, 2),
        "utf8",
      );

      const lines = assertionResults.map((r) => {
        const icon = r.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
        return `    ${icon} ${r.text} ${c.dim}—${c.reset} ${truncate(r.evidence)}`;
      });
      const passColor = passed === total ? c.green : c.yellow;
      write(
        `  ${c.dim}[${c.reset}${label}${c.dim}]${c.reset} ${passColor}${passed}/${total} passed${c.reset}\n${lines.join("\n")}\n`,
      );
    } else {
      write(`  ${c.dim}[${c.reset}${label}${c.dim}]${c.reset}\n`);
    }

    if (stoppedBy) {
      write(
        `    ${c.yellow}■ stopped (${stoppedBy})${c.reset}${c.dim} — not a model failure${c.reset}\n`,
      );
    }
    if (apiErrors.length > 0) {
      const firstLine =
        apiErrors[0]?.message.split("\n")[0] ?? "see errors.json";
      write(
        `    ${c.red}✗ ${apiErrors.length} model request(s) failed${c.reset} ${c.dim}${firstLine}${c.reset}\n`,
      );
    }

    results.push({
      assertions: assertionResults,
      caseName,
      cost,
      costSource: costSourceOf(cost),
      costUSD,
      erroredRequests: apiErrors.length,
      failed: assertionResults.filter((r) => !r.passed).length,
      label,
      metrics: run?.metrics,
      modelURI: taskModelURI,
      outputDir: relativeDir,
      passed: assertionResults.filter((r) => r.passed).length,
      resolvedModelId: run?.resolvedModelId,
      searchCostUSD,
      stoppedBy,
      systemPromptSha256,
      chatId: task.id,
      totalTokens: stats.totalTokens,
      trial: known?.trial ?? 1,
      treeTokens: run?.treeUsage.totalTokens,
      treeUsage: run?.treeUsage,
    });
  }

  const rollupTotal = rollupPassed + rollupFailed;
  const rollupCost = addRunCosts(results.map((result) => result.cost));
  const rollup: RollupSummary = {
    assertions: {
      failed: rollupFailed,
      pass_rate: rollupTotal > 0 ? rollupPassed / rollupTotal : 0,
      passed: rollupPassed,
      total: rollupTotal,
    },
    cost: rollupCost,
    costSource: costSourceOf(rollupCost),
    costUSD: modelCostUSD(rollupCost),
    erroredTasks: rollupErroredTasks,
    modelURIs: [...rollupModelURIs],
    provenance: {
      generatedAt: new Date().toISOString(),
      git,
      systemPromptSha256: [...rollupPromptDigests].sort(),
    },
    results,
    searchCostUSD:
      rollupCost.search.searches > 0
        ? rollupCost.search.estimatedUSD
        : undefined,
    stoppedTasks: rollupStoppedTasks,
    tasks: tasks.length,
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "summary.json"),
    JSON.stringify(rollup, null, 2),
    "utf8",
  );

  return rollup;
}

/**
 * The session a run past its process went to, read from its chat, with its
 * title: the chat's own conversation when the case's prompt was typed there,
 * else the task a task case started from the empty chat. A task case's chat
 * is not always empty: the task's finish can wake it, which writes a
 * text-less message there and a turn after it.
 */
async function runSessionOf(
  chatId: ChatId,
): Promise<undefined | { id: StoreId.Session; title: string }> {
  const own = resolveChat(chatId) ? sessionOfChat(chatId) : undefined;
  if (!own) {
    process.stderr.write(`Warning: ${chatId} has no session, skipping.\n`);
    return undefined;
  }
  const said = await ChatReads.transcript({ chatId, sessionId: own });
  const typed =
    said.isOk() &&
    said.value.some(
      (message) =>
        message.role === "user" &&
        message.parts.some(
          (part) => part.type === "text" && part.text.trim() !== "",
        ),
    );
  const id = typed ? own : ((await listChildTasks(chatId))[0]?.id ?? own);
  const session = await ChatReads.session({ chatId: chatId, sessionId: id });
  return { id, title: session.isOk() ? session.value.title : chatId };
}

function truncate(text: string): string {
  return text.length <= MAX_CONSOLE_EVIDENCE
    ? text
    : `${text.slice(0, MAX_CONSOLE_EVIDENCE)}...`;
}

/** The least, the middle, and the most of one figure across a case's trials. */
interface Range {
  max: number;
  median: number;
  min: number;
}

/** One case on one model across every trial that reported it. */
export interface CaseSpread {
  assertions: { passed: number; total: number };
  caseName: string;
  /** Over the trials that could price their model requests. */
  costUSD?: Range;
  modelURI?: string;
  /** Trials that hit a cap or a case stop, by what stopped them. */
  stopped: Partial<Record<RunStop, number>>;
  /** This task plus every task it started, where known. */
  tokens: Range;
  trials: number;
}

/**
 * A `--repeat` run's trials as one report: every trial's results, each
 * filed under its own trial's directory and numbered, and the spread of
 * each case's cost and tokens across them.
 */
export interface TrialsSummary extends RollupSummary {
  spread: CaseSpread[];
  trials: { exitCode: number; reported: boolean; trial: number }[];
}

function rangeOf(values: number[]): Range | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    max: sorted.at(-1) ?? 0,
    median:
      sorted.length % 2 === 1
        ? (sorted[middle] ?? 0)
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2,
    min: sorted[0] ?? 0,
  };
}

export function spreadOf(results: readonly RunReport[]): CaseSpread[] {
  const groups = new Map<string, RunReport[]>();
  for (const result of results) {
    const key = `${result.caseName}\u0000${result.modelURI ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.values()].map((group) => {
    const [first] = group;
    const stopped: CaseSpread["stopped"] = {};
    for (const result of group) {
      if (result.stoppedBy) {
        stopped[result.stoppedBy] = (stopped[result.stoppedBy] ?? 0) + 1;
      }
    }
    return {
      assertions: {
        passed: group.reduce((sum, result) => sum + result.passed, 0),
        total: group.reduce(
          (sum, result) => sum + result.passed + result.failed,
          0,
        ),
      },
      caseName: first?.caseName ?? "",
      costUSD: rangeOf(
        group.flatMap((result) =>
          result.costUSD === undefined
            ? []
            : [result.costUSD + (result.searchCostUSD ?? 0)],
        ),
      ),
      modelURI: first?.modelURI,
      stopped,
      tokens: rangeOf(
        group.map((result) => result.treeTokens ?? result.totalTokens),
      ) ?? { max: 0, median: 0, min: 0 },
      trials: group.length,
    };
  });
}

/**
 * Each trial's own report, made in a directory of its own under the run's
 * (`trial-<n>/`), as one: results keep their trial number and point into
 * that directory, and the totals are over every trial.
 */
export function combineTrials(
  trials: readonly {
    exitCode: number;
    rollup?: RollupSummary;
    trial: number;
  }[],
): TrialsSummary {
  const rollups = trials.flatMap(({ rollup, trial }) =>
    rollup ? [{ rollup, trial }] : [],
  );
  const results = rollups.flatMap(({ rollup, trial }) =>
    rollup.results.map((result) => ({
      ...result,
      outputDir: path.join(`trial-${String(trial)}`, result.outputDir),
      trial,
    })),
  );
  const passed = rollups.reduce(
    (sum, { rollup }) => sum + rollup.assertions.passed,
    0,
  );
  const failed = rollups.reduce(
    (sum, { rollup }) => sum + rollup.assertions.failed,
    0,
  );
  const cost = addRunCosts(results.map((result) => result.cost));
  return {
    assertions: {
      failed,
      pass_rate: passed + failed > 0 ? passed / (passed + failed) : 0,
      passed,
      total: passed + failed,
    },
    cost,
    costSource: costSourceOf(cost),
    costUSD: modelCostUSD(cost),
    erroredTasks: rollups.reduce(
      (sum, { rollup }) => sum + rollup.erroredTasks,
      0,
    ),
    modelURIs: [...new Set(rollups.flatMap(({ rollup }) => rollup.modelURIs))],
    provenance: {
      generatedAt: new Date().toISOString(),
      git: rollups[0]?.rollup.provenance.git,
      systemPromptSha256: [
        ...new Set(
          rollups.flatMap(({ rollup }) => rollup.provenance.systemPromptSha256),
        ),
      ].sort(),
    },
    results,
    searchCostUSD:
      cost.search.searches > 0 ? cost.search.estimatedUSD : undefined,
    spread: spreadOf(results),
    stoppedTasks: rollups.reduce(
      (sum, { rollup }) => sum + rollup.stoppedTasks,
      0,
    ),
    tasks: rollups.reduce((sum, { rollup }) => sum + rollup.tasks, 0),
    trials: trials.map(({ exitCode, rollup, trial }) => ({
      exitCode,
      reported: rollup !== undefined,
      trial,
    })),
  };
}
