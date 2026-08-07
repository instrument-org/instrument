import fs from "node:fs/promises";
import path from "node:path";

import { getTasks } from "../src/lib/get-tasks";
import { getSessionMarkdown } from "../src/lib/session-to-markdown";
import { Store } from "../src/lib/store";
import { taskDir } from "../src/lib/task-dir-utils";
import { getTaskState } from "../src/lib/task-state-store";
import { getTaskUsageSummary } from "../src/lib/usage-summary";
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
  type RunStop,
  sessionsFor,
} from "./harness";
import { buildReportWorkspaceConfig, c, write } from "./utils";

/** What one run produced, in the form a caller can act on without re-reading. */
interface RunReport {
  assertions: AssertionResult[];
  caseName: string;
  costUSD?: number;
  /** Model requests that genuinely failed. A deliberate stop is not one. */
  erroredRequests: number;
  failed: number;
  label: string;
  modelURI?: string;
  /** Where this run's transcript and assertions were written. */
  outputDir: string;
  passed: number;
  resolvedModelId?: string;
  stoppedBy?: RunStop;
  taskId: string;
  totalTokens: number;
}

interface RollupSummary {
  assertions: {
    failed: number;
    pass_rate: number;
    passed: number;
    total: number;
  };
  /** Approximate, and only for models whose price was known. See `formatCost`. */
  costUSD?: number;
  /** Tasks where at least one model request failed (rate limit, credits, ...). */
  erroredTasks: number;
  modelURIs: string[];
  results: RunReport[];
  /** Tasks the harness or the case ended on purpose. Not a failure. */
  stoppedTasks: number;
  tasks: number;
}

/**
 * Evidence is written whole to `assertions.json` and trimmed for the terminal.
 * One serialized tool call can run to several hundred characters, and a wall of
 * them buries the pass/fail column that is the reason to look at all.
 */
const MAX_CONSOLE_EVIDENCE = 300;

export async function generateReport({
  evalCases = [],
  includeContextMessages = false,
  outputDir,
  runs = [],
  workspaceRootDir,
}: {
  evalCases?: EvalCase[];
  includeContextMessages?: boolean;
  outputDir: string;
  runs?: CompletedRun[];
  workspaceRootDir: string;
}): Promise<RollupSummary> {
  const evalCasesByName = new Map(evalCases.map((e) => [e.name, e]));
  // A task's id is slugified from its prompt, not from the case name, so a name
  // can only be recovered from the run that produced it. Without this the match
  // below almost never succeeds and every committed assertion silently reports
  // nothing, which reads exactly like having no assertions to begin with.
  const runsByTaskId = new Map(runs.map((run) => [run.taskId, run] as const));
  const absoluteWorkspaceDir = path.resolve(workspaceRootDir);
  const workspaceConfig = buildReportWorkspaceConfig(absoluteWorkspaceDir);
  // `taskDir()` and friends read the config from its module singleton, which the
  // `run` flow populates when the workspace machine boots. Reporting on a past
  // workspace dir never boots one, so seed it here -- but only when it is absent,
  // so a report generated at the end of a run keeps the machine's own config.
  if (!hasWorkspaceConfig()) {
    setWorkspaceConfig(workspaceConfig);
  }

  const { tasks } = await getTasks(workspaceConfig, {
    direction: "asc",
    sortBy: "createdAt",
  });

  if (tasks.length === 0) {
    write("No tasks found in workspace.\n");
    return {
      assertions: { failed: 0, pass_rate: 0, passed: 0, total: 0 },
      erroredTasks: 0,
      modelURIs: [],
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
  let rollupCost = 0;
  let sawPrice = false;
  const rollupModelURIs = new Set<string>();
  const results: RunReport[] = [];
  // A case run several times against one model would otherwise write every
  // trial to the same place. `report <dir>` has no trial numbers to read, so
  // the collision is settled here rather than assumed away.
  const claimedDirs = new Set<string>();

  for (const task of tasks) {
    const taskId = task.id;
    const run = runsByTaskId.get(taskId);

    const taskState = await getTaskState(taskDir(taskId));
    const taskModelURI = run?.modelURI ?? taskState.selectedModelURI;
    if (taskModelURI) {
      rollupModelURIs.add(taskModelURI);
    }

    // `task.title` is the case name the harness passed at creation, so the pair
    // that names a run survives even without the runs that produced it: a report
    // over a past workspace dir is still filed by case and model rather than by
    // a slug of the prompt with a numeric suffix, which named nothing anyone
    // could act on.
    const caseName = run?.name ?? task.title;
    const evalCase =
      evalCasesByName.get(caseName) ??
      evalCasesByName.get(task.id) ??
      [...evalCasesByName.entries()].find(([name]) =>
        task.id.endsWith(`-${name}`),
      )?.[1];

    const key = runKey({
      modelLabel: run?.modelLabel ?? modelLabelFor(taskModelURI ?? "unknown"),
      name: caseName,
      trial: run?.trial ?? 1,
    });
    let { dir: relativeDir, label } = key;
    for (let n = 2; claimedDirs.has(relativeDir); n += 1) {
      relativeDir = `${key.dir}-${n}`;
      label = `${key.label}-${n}`;
    }
    claimedDirs.add(relativeDir);

    const sessionsResult = await Store.getSessions(taskId);

    if (sessionsResult.isErr()) {
      process.stderr.write(
        `Error loading sessions for ${label}: ${sessionsResult.error.message}\n`,
      );
      continue;
    }

    const rootSessions = sessionsResult.value;

    if (rootSessions.length > 1) {
      process.stderr.write(
        `Warning: ${label} has ${rootSessions.length} root sessions (expected 1). Using the first one.\n`,
      );
    }

    const rootSession = rootSessions[0];
    if (!rootSession) {
      process.stderr.write(
        `Warning: ${label} has no root session, skipping.\n`,
      );
      continue;
    }

    const markdown = await getSessionMarkdown({
      includeContextMessages,
      sessionId: rootSession.id,
      taskId,
    });

    const taskOutputDir = path.join(outputDir, relativeDir);
    await fs.mkdir(taskOutputDir, { recursive: true });

    const stats = await getTaskUsageSummary(taskId);

    // A run whose every step failed on a 402/429 still reaches this point having
    // produced a task and a transcript, so without this it reports exactly like a
    // run that worked. Surfacing it here is what keeps the summary trustworthy.
    //
    // An abort is not one of those. Both the token cap and a case's own
    // `shouldStop` end the session, and an aborted request stores an error like
    // any other -- so counting them together reported six cases working exactly
    // as designed as six provider failures, and the only way to tell was to open
    // the stored errors by hand.
    const sessionWithParts = await Store.getSessionWithMessagesAndParts(
      rootSession.id,
      taskId,
    );
    const messageErrors = sessionWithParts.isOk()
      ? sessionWithParts.value.messages.flatMap((message) =>
          message.role === "assistant" && message.metadata.error
            ? [message.metadata.error]
            : [],
        )
      : [];
    const apiErrors = messageErrors.filter((error) => error.kind !== "aborted");
    const aborted = messageErrors.length - apiErrors.length;
    if (apiErrors.length > 0) {
      rollupErroredTasks += 1;
      await fs.writeFile(
        path.join(taskOutputDir, "errors.json"),
        JSON.stringify(apiErrors, null, 2),
        "utf8",
      );
    }
    const stoppedBy = run?.stoppedBy ?? (aborted > 0 ? "unknown" : undefined);
    if (stoppedBy) {
      rollupStoppedTasks += 1;
    }

    if (run?.costUSD !== undefined) {
      rollupCost += run.costUSD;
      sawPrice = true;
    }

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
    const symlinkPath = path.join(taskOutputDir, "task");
    await fs.symlink(taskDir(taskId), symlinkPath).catch(() => {
      return;
    });

    if (!evalCase) {
      process.stderr.write(
        `Warning: no eval case matched "${caseName}" (${task.id}); its assertions, if any, were not run.\n`,
      );
    }
    await fs.writeFile(
      path.join(taskOutputDir, "eval-case.json"),
      JSON.stringify(
        {
          costUSD: run?.costUSD,
          modelURI: taskModelURI,
          name: caseName,
          resolvedModelId: run?.resolvedModelId,
          stoppedBy,
          taskId: task.id,
        },
        null,
        2,
      ),
      "utf8",
    );

    let assertionResults: AssertionResult[] = [];
    if (evalCase?.assertions && evalCase.assertions.length > 0) {
      const sessions = await sessionsFor(taskId);
      assertionResults = await Promise.all(
        evalCase.assertions.map((a) =>
          Promise.resolve(a.check({ sessions, taskId })),
        ),
      );
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
      costUSD: run?.costUSD,
      erroredRequests: apiErrors.length,
      failed: assertionResults.filter((r) => !r.passed).length,
      label,
      modelURI: taskModelURI,
      outputDir: relativeDir,
      passed: assertionResults.filter((r) => r.passed).length,
      resolvedModelId: run?.resolvedModelId,
      stoppedBy,
      taskId: task.id,
      totalTokens: stats.totalTokens,
    });
  }

  const rollupTotal = rollupPassed + rollupFailed;
  const rollup: RollupSummary = {
    assertions: {
      failed: rollupFailed,
      pass_rate: rollupTotal > 0 ? rollupPassed / rollupTotal : 0,
      passed: rollupPassed,
      total: rollupTotal,
    },
    costUSD: sawPrice ? rollupCost : undefined,
    erroredTasks: rollupErroredTasks,
    modelURIs: [...rollupModelURIs],
    results,
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

function truncate(text: string): string {
  return text.length <= MAX_CONSOLE_EVIDENCE
    ? text
    : `${text.slice(0, MAX_CONSOLE_EVIDENCE)}...`;
}
