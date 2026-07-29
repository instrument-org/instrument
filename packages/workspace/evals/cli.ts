import "../scripts/lib/define-globals-apply";

import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";

import { EVALS } from "./cases";
import {
  type CompletedRun,
  DEFAULT_MAX_RUN_TOKENS,
  defineEval,
  MODELS,
  runEvals,
} from "./harness";
import { generateReport } from "./report";
import { c, formatNumber, modelURI } from "./utils";

// Suppress unstorage db0 experimental warning
// https://github.com/unjs/unstorage/blob/main/src/drivers/db0.ts
(
  globalThis as unknown as Record<string, boolean>
).__unstorage_db0_experimental_warning__ = true;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    concurrency: { default: "8", type: "string" },
    "dry-run": { default: false, type: "boolean" },
    "include-context": { default: false, type: "boolean" },
    "max-run-tokens": { type: "string" },
    model: { multiple: true, type: "string" },
    name: { type: "string" },
    prompt: { type: "string" },
    yes: { default: false, short: "y", type: "boolean" },
  },
});

const subcommand = positionals[0];
const includeContextMessages = values["include-context"];
const dryRun = values["dry-run"];
const concurrency = Number.parseInt(values.concurrency, 10);
// A ceiling per run, not per suite: one model failing to make progress should
// not be able to spend the whole budget, and stopping it leaves every other
// run of the suite intact.
const maxRunTokens = values["max-run-tokens"]
  ? Number.parseInt(values["max-run-tokens"], 10)
  : DEFAULT_MAX_RUN_TOKENS;
// Every positional past the subcommand is a pattern, matched as alternatives.
// Reading only the first silently ran a subset: `run region unreadable` looked
// like it covered both suites and covered one.
const namePatterns = positionals.slice(1);
const matchesPattern = (name: string) =>
  namePatterns.length === 0 ||
  namePatterns.some((pattern) =>
    name.toLowerCase().includes(pattern.toLowerCase()),
  );
const patternLabel = namePatterns.join(", ");

/**
 * A bare model name is the common case, so it is read as an OpenRouter slug;
 * pass a full model URI when you need a specific provider or provider config.
 */
const models =
  values.model && values.model.length > 0
    ? values.model.map((model) =>
        model.includes("?") ? model : modelURI.openRouter(model),
      )
    : MODELS;

/**
 * An ad-hoc prompt runs the real agent against one throwaway case, which is the
 * fastest way to see how a model actually uses a tool or a prompt change without
 * committing an eval case for it.
 */
const adHocEval = values.prompt
  ? defineEval({ name: values.name ?? "ad-hoc", prompt: values.prompt })
  : undefined;

if (subcommand !== "run" && subcommand !== "report" && subcommand !== "list") {
  process.stderr.write("Usage: tsx evals/run.ts <run|report|list> [options]\n");
  process.stderr.write(
    "  run [pattern...] Run evals matching any name pattern, then generate report\n",
  );
  process.stderr.write(
    "                   --max-run-tokens <n> caps one run's spend (0 disables)\n",
  );
  process.stderr.write(
    "  report <dir>     Generate report from an existing workspace dir\n",
  );
  process.stderr.write("  list [pattern]   List available evals\n");
  throw new Error(`Unknown subcommand: "${subcommand ?? "(none)"}"`);
}

const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const outputDir = path.resolve(
  import.meta.dirname,
  "..",
  "eval-results.local",
  timestamp,
);

function printSummary({
  outputDir: out,
  rollup,
  workspaceRootDir,
}: {
  outputDir: string;
  rollup: Awaited<ReturnType<typeof generateReport>>;
  workspaceRootDir: string;
}) {
  const relativeOutputDir = `./${path.relative(process.cwd(), out)}`;
  const { assertions } = rollup;
  const passRate =
    assertions.total > 0 ? `${Math.round(assertions.pass_rate * 100)}%` : "n/a";
  process.stdout.write(
    [
      "",
      `${c.dim}┌─ Eval Results ──────────────────────────────────────${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Workspace  :${c.reset} ${workspaceRootDir}`,
      `${c.dim}│${c.reset}  ${c.dim}Results    :${c.reset} ${relativeOutputDir}`,
      ...(rollup.modelURIs.length > 0
        ? rollup.modelURIs.map(
            (m, i) =>
              `${c.dim}│${c.reset}  ${c.dim}${i === 0 ? "Models     " : "           "} :${c.reset} ${c.cyan}${m}${c.reset}`,
          )
        : []),
      `${c.dim}│${c.reset}  ${c.dim}Tasks      :${c.reset} ${c.yellow}${rollup.tasks}${c.reset}`,
      ...(rollup.erroredTasks > 0
        ? [
            `${c.dim}│${c.reset}  ${c.dim}Failed     :${c.reset} ${c.red}${rollup.erroredTasks}/${rollup.tasks} had failed model requests${c.reset}`,
          ]
        : []),
      ...(assertions.total > 0
        ? [
            `${c.dim}│${c.reset}  ${c.dim}Assertions :${c.reset} ${assertions.passed === assertions.total ? c.green : c.yellow}${assertions.passed}/${assertions.total} passed (${passRate})${c.reset}`,
          ]
        : []),
      `${c.dim}└─────────────────────────────────────────────────────${c.reset}`,
      "",
    ].join("\n"),
  );
}

/**
 * Each run's rendered transcript is the point of an ad-hoc run: it is where you
 * read what the agent actually did, tool call by tool call.
 */
function printTranscripts({
  outputDir: out,
  runs,
}: {
  outputDir: string;
  runs: CompletedRun[];
}) {
  if (runs.length === 0) {
    return;
  }
  process.stdout.write(
    [
      `${c.dim}Transcripts:${c.reset}`,
      ...runs.map(
        (run) =>
          `  ${c.cyan}${run.label}${c.reset}  ${path.relative(process.cwd(), path.join(out, run.taskId, "session.md"))}`,
      ),
      "",
    ].join("\n"),
  );
}

if (subcommand === "list") {
  const filtered = EVALS.filter((e) => matchesPattern(e.name));

  if (filtered.length === 0) {
    process.stderr.write(`No evals matched pattern: "${patternLabel}"\n`);
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1);
  }

  process.stdout.write(
    [
      "",
      `${c.dim}Available evals (${filtered.length}):${c.reset}`,
      ...filtered.map((e) => `  ${c.dim}-${c.reset} ${e.name}`),
      "",
    ].join("\n"),
  );
} else if (subcommand === "report") {
  const workspaceRootDir = positionals[1];

  if (!workspaceRootDir) {
    process.stderr.write(
      "Error: report subcommand requires a workspace directory argument\n",
    );
    throw new Error(
      "report subcommand requires a workspace directory argument",
    );
  }

  const absoluteWorkspaceDir = path.resolve(workspaceRootDir);
  process.stdout.write(`Workspace: ${absoluteWorkspaceDir}\n`);

  const rollup = await generateReport({
    evalCases: EVALS,
    includeContextMessages,
    outputDir,
    workspaceRootDir: absoluteWorkspaceDir,
  });

  printSummary({ outputDir, rollup, workspaceRootDir: absoluteWorkspaceDir });
} else {
  const filteredEvals = adHocEval
    ? [adHocEval]
    : EVALS.filter((e) => matchesPattern(e.name));

  if (filteredEvals.length === 0) {
    process.stderr.write(`No evals matched pattern: "${patternLabel}"\n`);
    throw new Error(`No evals matched pattern: "${patternLabel}"`);
  }

  const totalRuns = filteredEvals.length * models.length;

  process.stdout.write(
    [
      "",
      `${c.dim}┌─ Eval Plan ─────────────────────────────────────────${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Evals       :${c.reset} ${c.yellow}${filteredEvals.length}${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Models      :${c.reset} ${c.yellow}${models.length}${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Total runs  :${c.reset} ${c.yellow}${totalRuns}${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Concurrency :${c.reset} ${concurrency}`,
      `${c.dim}│${c.reset}  ${c.dim}Dry run     :${c.reset} ${dryRun ? "yes" : "no"}`,
      `${c.dim}│${c.reset}  ${c.dim}Token cap   :${c.reset} ${maxRunTokens > 0 ? `${formatNumber(maxRunTokens)} per run` : "none"}`,
      `${c.dim}├─────────────────────────────────────────────────────${c.reset}`,
      ...filteredEvals.map(
        (e) => `${c.dim}│${c.reset}  ${c.dim}-${c.reset} ${e.name}`,
      ),
      `${c.dim}├─────────────────────────────────────────────────────${c.reset}`,
      ...models.map(
        (m) =>
          `${c.dim}│${c.reset}  ${c.dim}-${c.reset} ${c.cyan}${m}${c.reset}`,
      ),
      `${c.dim}└─────────────────────────────────────────────────────${c.reset}`,
      "",
    ].join("\n"),
  );

  if (!dryRun && !values.yes) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question("Proceed? (y/N) ");
    rl.close();
    if (answer.toLowerCase() !== "y") {
      process.stdout.write("Aborted.\n");
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(0);
    }
    process.stdout.write("\n");
  }

  const { runs, workspaceRootDir } = await runEvals(filteredEvals, {
    concurrency,
    dryRun,
    maxRunTokens,
    models,
  });

  const capped = runs.filter((run) => run.overBudget !== undefined);
  if (capped.length > 0) {
    // Loud and above the summary, because a stopped run still produces a task
    // and a transcript and otherwise reads exactly like one that finished.
    process.stderr.write(
      [
        "",
        `${c.red}${capped.length} run(s) stopped at the token cap${c.reset}${c.dim} -- their results are partial:${c.reset}`,
        ...capped.map(
          (run) =>
            `  ${c.cyan}${run.label}${c.reset} ${c.dim}(${formatNumber(run.overBudget ?? 0)} tokens)${c.reset}`,
        ),
        "",
      ].join("\n"),
    );
  }

  if (!dryRun) {
    process.stdout.write(
      `\n${c.green}All evals complete.${c.reset} ${c.dim}Generating report...${c.reset}\n`,
    );

    const rollup = await generateReport({
      evalCases: filteredEvals,
      includeContextMessages,
      outputDir,
      runs,
      workspaceRootDir,
    });

    printSummary({ outputDir, rollup, workspaceRootDir });
    printTranscripts({ outputDir, runs });
  }
}
