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
import { type Session } from "../src/schemas/session";
import {
  type AssertionResult,
  type CompletedRun,
  type EvalCase,
} from "./harness";
import { buildReportWorkspaceConfig, c } from "./utils";

interface RollupSummary {
  assertions: {
    failed: number;
    pass_rate: number;
    passed: number;
    total: number;
  };
  /** Tasks where at least one model request failed (rate limit, credits, ...). */
  erroredTasks: number;
  modelURIs: string[];
  tasks: number;
}

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
  const evalCasesByTaskId = new Map(
    runs.flatMap((run) => {
      const found = evalCasesByName.get(run.name);
      return found ? [[run.taskId, found] as const] : [];
    }),
  );
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
    process.stdout.write("No tasks found in workspace.\n");
    return {
      assertions: { failed: 0, pass_rate: 0, passed: 0, total: 0 },
      erroredTasks: 0,
      modelURIs: [],
      tasks: 0,
    };
  }

  process.stdout.write(
    `${c.dim}Generating report for${c.reset} ${c.yellow}${tasks.length}${c.reset} ${c.dim}task(s)...${c.reset}\n`,
  );

  let rollupPassed = 0;
  let rollupFailed = 0;
  let rollupErroredTasks = 0;
  const rollupModelURIs = new Set<string>();

  for (const task of tasks) {
    const taskId = task.id;

    const taskState = await getTaskState(taskDir(taskId));
    const taskModelURI = taskState.selectedModelURI;
    if (taskModelURI) {
      rollupModelURIs.add(taskModelURI);
    }

    const sessionsResult = await Store.getSessions(taskId);

    if (sessionsResult.isErr()) {
      process.stderr.write(
        `Error loading sessions for ${task.title}: ${sessionsResult.error.message}\n`,
      );
      continue;
    }

    const rootSessions = sessionsResult.value;

    if (rootSessions.length > 1) {
      process.stderr.write(
        `Warning: task "${task.title}" has ${rootSessions.length} root sessions (expected 1). Using the first one.\n`,
      );
    }

    const rootSession = rootSessions[0];
    if (!rootSession) {
      process.stderr.write(
        `Warning: task "${task.title}" has no root session, skipping.\n`,
      );
      continue;
    }

    const markdown = await getSessionMarkdown({
      includeContextMessages,
      sessionId: rootSession.id,
      taskId,
    });

    const taskOutputDir = path.join(outputDir, task.id);
    await fs.mkdir(taskOutputDir, { recursive: true });

    const stats = await getTaskUsageSummary(taskId);

    // A run whose every step failed on a 402/429 still reaches this point having
    // produced a task and a transcript, so without this it reports exactly like a
    // run that worked. Surfacing it here is what keeps the summary trustworthy.
    const sessionWithParts = await Store.getSessionWithMessagesAndParts(
      rootSession.id,
      taskId,
    );
    const apiErrors = sessionWithParts.isOk()
      ? sessionWithParts.value.messages.flatMap((message) =>
          message.role === "assistant" && message.metadata.error
            ? [message.metadata.error]
            : [],
        )
      : [];
    if (apiErrors.length > 0) {
      rollupErroredTasks += 1;
      await fs.writeFile(
        path.join(taskOutputDir, "errors.json"),
        JSON.stringify(apiErrors, null, 2),
        "utf8",
      );
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

    const evalCase =
      evalCasesByTaskId.get(task.id) ??
      evalCasesByName.get(task.id) ??
      [...evalCasesByName.entries()].find(([name]) =>
        task.id.endsWith(`-${name}`),
      )?.[1];
    await fs.writeFile(
      path.join(taskOutputDir, "eval-case.json"),
      JSON.stringify({ modelURI: taskModelURI, name: task.id }, null, 2),
      "utf8",
    );

    if (evalCase?.assertions && evalCase.assertions.length > 0) {
      const allSessionsResult = await Store.getSessions(taskId, {
        includeChildSessions: true,
      });
      const allSessionsList = allSessionsResult.isOk()
        ? allSessionsResult.value
        : [];
      const sessionsWithParts: Session.WithMessagesAndParts[] = [];
      for (const s of allSessionsList) {
        const r = await Store.getSessionWithMessagesAndParts(s.id, taskId);
        if (r.isOk()) {
          sessionsWithParts.push(r.value);
        }
      }
      const sessions = sessionsWithParts;
      const assertionResults: AssertionResult[] = await Promise.all(
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
        return `    ${icon} ${r.text} ${c.dim}—${c.reset} ${r.evidence}`;
      });
      const passColor = passed === total ? c.green : c.yellow;
      process.stdout.write(
        `  ${c.dim}[${c.reset}${task.id}${c.dim}]${c.reset} ${passColor}${passed}/${total} passed${c.reset}\n${lines.join("\n")}\n`,
      );
    } else {
      process.stdout.write(
        `  ${c.dim}[${c.reset}${task.id}${c.dim}]${c.reset}\n`,
      );
    }

    if (apiErrors.length > 0) {
      const firstLine =
        apiErrors[0]?.message.split("\n")[0] ?? "see errors.json";
      process.stdout.write(
        `    ${c.red}✗ ${apiErrors.length} model request(s) failed${c.reset} ${c.dim}${firstLine}${c.reset}\n`,
      );
    }
  }

  const rollupTotal = rollupPassed + rollupFailed;
  const rollup: RollupSummary = {
    assertions: {
      failed: rollupFailed,
      pass_rate: rollupTotal > 0 ? rollupPassed / rollupTotal : 0,
      passed: rollupPassed,
      total: rollupTotal,
    },
    erroredTasks: rollupErroredTasks,
    modelURIs: [...rollupModelURIs],
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
