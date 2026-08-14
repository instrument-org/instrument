import "../scripts/lib/define-globals-apply";

import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";

import { EVALS } from "./cases";
import {
  type CompletedRun,
  DEFAULT_MAX_RUN_SECONDS,
  DEFAULT_MAX_RUN_TOKENS,
  defineEval,
  MODELS,
  runEvals,
} from "./harness";
import { generateReport } from "./report";
import {
  c,
  formatCost,
  formatNumber,
  modelURI,
  setHumanOutputStream,
  write,
} from "./utils";

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
    json: { default: false, type: "boolean" },
    "max-run-seconds": { type: "string" },
    "max-run-tokens": { type: "string" },
    model: { multiple: true, type: "string" },
    name: { type: "string" },
    prompt: { type: "string" },
    repeat: { default: "1", type: "string" },
    yes: { default: false, short: "y", type: "boolean" },
  },
});

// With `--json`, stdout carries the report and nothing else, so a caller can
// pipe the run into a parser. Narration moves to stderr, and so does anything
// else that writes to stdout along the way: the workspace server announces its
// port there, and one such line ahead of the report is the difference between
// valid JSON and a parse error.
//
// The report is a single line for the same reason. A failing run invoked
// through `pnpm run` gets pnpm's own epilogue appended to stdout, which nothing
// here can suppress, so `| head -1` has to be enough to recover the report.
const emitReport = (() => {
  if (!values.json) {
    return (text: string) => {
      write(text);
    };
  }
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  // Genuinely a different type: the assignment target carries every overload of
  // `write`, and the replacement only ever forwards one call to stderr.
  process.stdout.write = ((...args: Parameters<typeof process.stderr.write>) =>
    process.stderr.write(...args)) as typeof process.stdout.write;
  setHumanOutputStream(process.stderr);
  return (text: string) => {
    stdoutWrite(text);
  };
})();

const subcommand = positionals[0];
const includeContextMessages = values["include-context"];
const dryRun = values["dry-run"];
const concurrency = Number.parseInt(values.concurrency, 10);
const repeat = Number.parseInt(values.repeat, 10);
// A ceiling per run, not per suite: one model failing to make progress should
// not be able to spend the whole budget, and stopping it leaves every other
// run of the suite intact.
const maxRunTokens = values["max-run-tokens"]
  ? Number.parseInt(values["max-run-tokens"], 10)
  : DEFAULT_MAX_RUN_TOKENS;
const maxRunSeconds = values["max-run-seconds"]
  ? Number.parseInt(values["max-run-seconds"], 10)
  : DEFAULT_MAX_RUN_SECONDS;
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
    "                   --max-run-seconds <n> caps one run's wall clock (0 disables)\n",
  );
  process.stderr.write(
    "                   --repeat <n> runs every case n times per model\n",
  );
  process.stderr.write(
    "                   --json prints the report as one line on stdout (see summary.json)\n",
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

type Rollup = Awaited<ReturnType<typeof generateReport>>;

/**
 * Exit status is the only part of a run a caller can read without parsing
 * anything. A failed assertion, a refused request, and a run that hit a cap all
 * count: the last one produced partial results, and passing it as a success is
 * the same trap as reporting a rate-limited run like one that worked. A case
 * stopping itself through `shouldStop` is not that -- it is the case working.
 */
function exitCodeFor(rollup: Rollup): number {
  const capped = rollup.results.some(
    (result) => result.stoppedBy === "budget" || result.stoppedBy === "timeout",
  );
  return rollup.assertions.failed > 0 || rollup.erroredTasks > 0 || capped
    ? 1
    : 0;
}

const short = (sha: string) => sha.slice(0, 12);

function printSummary({
  outputDir: out,
  rollup,
  workspaceRootDir,
}: {
  outputDir: string;
  rollup: Rollup;
  workspaceRootDir: string;
}) {
  const relativeOutputDir = `./${path.relative(process.cwd(), out)}`;
  const { assertions } = rollup;
  const passRate =
    assertions.total > 0 ? `${Math.round(assertions.pass_rate * 100)}%` : "n/a";
  write(
    [
      "",
      `${c.dim}┌─ Eval Results ──────────────────────────────────────${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Workspace  :${c.reset} ${workspaceRootDir}`,
      `${c.dim}│${c.reset}  ${c.dim}Results    :${c.reset} ${relativeOutputDir}`,
      ...(rollup.modelURIs.length > 0
        ? rollup.modelURIs.map(
            (m, i) =>
              `${c.dim}│${c.reset}  ${c.dim}${i === 0 ? "Models     " : "           "}:${c.reset} ${c.cyan}${m}${c.reset}`,
          )
        : []),
      ...provenanceLines(rollup.provenance),
      `${c.dim}│${c.reset}  ${c.dim}Tasks      :${c.reset} ${c.yellow}${rollup.tasks}${c.reset}`,
      ...(rollup.stoppedTasks > 0
        ? [
            `${c.dim}│${c.reset}  ${c.dim}Stopped    :${c.reset} ${c.yellow}${rollup.stoppedTasks}/${rollup.tasks} ended deliberately${c.reset}`,
          ]
        : []),
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
      ...(rollup.costUSD === undefined
        ? []
        : [
            `${c.dim}│${c.reset}  ${c.dim}Cost       :${c.reset} ${c.yellow}~${formatCost(rollup.costUSD)}${c.reset}${c.dim} (approximate)${c.reset}`,
          ]),
      `${c.dim}└─────────────────────────────────────────────────────${c.reset}`,
      "",
      `${c.dim}Re-run the assertions against these same sessions, at no cost:${c.reset}`,
      `  pnpm eval report ${workspaceRootDir}`,
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
  rollup,
}: {
  outputDir: string;
  rollup: Rollup;
}) {
  if (rollup.results.length === 0) {
    return;
  }
  write(
    [
      `${c.dim}Transcripts:${c.reset}`,
      ...rollup.results.map(
        (result) =>
          `  ${c.cyan}${result.label}${c.reset}  ${path.relative(process.cwd(), path.join(out, result.outputDir, "session.md"))}`,
      ),
      "",
    ].join("\n"),
  );
}

/**
 * What the run measured, said at the point the operator can still act on it.
 *
 * The dirty flag is the one worth the line. Measuring an edit before committing
 * it is the ordinary way a prompt change gets scored, and the numbers then
 * belong to a tree that no commit describes -- which is invisible afterwards
 * unless the run said so while someone was watching.
 */
function provenanceLines(provenance: Rollup["provenance"]): string[] {
  const { git, systemPromptSha256 } = provenance;
  return [
    ...(git
      ? [
          `${c.dim}│${c.reset}  ${c.dim}Commit     :${c.reset} ${short(git.commit)}${git.branch ? ` ${c.dim}on${c.reset} ${git.branch}` : ""}${
            git.dirty ? ` ${c.yellow}+ uncommitted changes${c.reset}` : ""
          }`,
        ]
      : []),
    ...(systemPromptSha256.length > 0
      ? [
          `${c.dim}│${c.reset}  ${c.dim}Prompt     :${c.reset} ${systemPromptSha256.map(short).join(", ")}${
            systemPromptSha256.length > 1
              ? ` ${c.yellow}(context was rebuilt mid-run)${c.reset}`
              : ""
          }`,
        ]
      : []),
  ];
}

if (subcommand === "list") {
  const filtered = EVALS.filter((e) => matchesPattern(e.name));

  if (filtered.length === 0) {
    process.stderr.write(`No evals matched pattern: "${patternLabel}"\n`);
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1);
  }

  write(
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
  write(`Workspace: ${absoluteWorkspaceDir}\n`);

  const rollup = await generateReport({
    evalCases: EVALS,
    includeContextMessages,
    outputDir,
    workspaceRootDir: absoluteWorkspaceDir,
  });

  printSummary({ outputDir, rollup, workspaceRootDir: absoluteWorkspaceDir });
  if (values.json) {
    emitReport(`${JSON.stringify(rollup)}\n`);
  }
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(exitCodeFor(rollup));
} else {
  const filteredEvals = adHocEval
    ? [adHocEval]
    : EVALS.filter((e) => matchesPattern(e.name));

  if (filteredEvals.length === 0) {
    process.stderr.write(`No evals matched pattern: "${patternLabel}"\n`);
    throw new Error(`No evals matched pattern: "${patternLabel}"`);
  }

  const totalRuns = filteredEvals.length * models.length * repeat;

  write(
    [
      "",
      `${c.dim}┌─ Eval Plan ─────────────────────────────────────────${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Evals       :${c.reset} ${c.yellow}${filteredEvals.length}${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Models      :${c.reset} ${c.yellow}${models.length}${c.reset}`,
      ...(repeat > 1
        ? [
            `${c.dim}│${c.reset}  ${c.dim}Repeat      :${c.reset} ${c.yellow}${repeat}${c.reset}`,
          ]
        : []),
      `${c.dim}│${c.reset}  ${c.dim}Total runs  :${c.reset} ${c.yellow}${totalRuns}${c.reset}`,
      `${c.dim}│${c.reset}  ${c.dim}Concurrency :${c.reset} ${concurrency}`,
      `${c.dim}│${c.reset}  ${c.dim}Dry run     :${c.reset} ${dryRun ? "yes" : "no"}`,
      `${c.dim}│${c.reset}  ${c.dim}Token cap   :${c.reset} ${maxRunTokens > 0 ? `${formatNumber(maxRunTokens)} per run` : "none"}`,
      `${c.dim}│${c.reset}  ${c.dim}Time cap    :${c.reset} ${maxRunSeconds > 0 ? `${maxRunSeconds}s per run` : "none"}`,
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

  // Nothing is watching a piped or backgrounded run, so a prompt there is a
  // hang rather than a safeguard. It is worth having when a person is present
  // and could still say no, which is exactly when stdin is a terminal.
  if (!dryRun && !values.yes && process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    const answer = await rl.question("Proceed? (y/N) ");
    rl.close();
    if (answer.toLowerCase() !== "y") {
      write("Aborted.\n");
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(0);
    }
    write("\n");
  }

  const { runs, workspaceRootDir } = await runEvals(filteredEvals, {
    concurrency,
    dryRun,
    maxRunSeconds,
    maxRunTokens,
    models,
    repeat,
  });

  reportStopped(runs);

  if (!dryRun) {
    write(
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
    printTranscripts({ outputDir, rollup });
    if (values.json) {
      emitReport(`${JSON.stringify(rollup)}\n`);
    }
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(exitCodeFor(rollup));
  }
}

/**
 * Loud and above the summary, because a run stopped early still produces a task
 * and a transcript and otherwise reads exactly like one that finished.
 */
function reportStopped(runs: CompletedRun[]) {
  const capped = runs.filter(
    (run) => run.stoppedBy === "budget" || run.stoppedBy === "timeout",
  );
  if (capped.length === 0) {
    return;
  }
  process.stderr.write(
    [
      "",
      `${c.red}${capped.length} run(s) hit a cap${c.reset}${c.dim} -- their results are partial:${c.reset}`,
      ...capped.map(
        (run) =>
          `  ${c.cyan}${run.label}${c.reset} ${c.dim}(${run.stoppedBy === "budget" ? `${formatNumber(run.overBudget ?? 0)} tokens` : "out of time"})${c.reset}`,
      ),
      "",
    ].join("\n"),
  );
}
