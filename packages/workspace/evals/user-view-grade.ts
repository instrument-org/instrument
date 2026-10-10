/**
 * Grades a matrix's chat runs from the user's side of the screen.
 *
 * Each chat run writes `user-view.md` beside its transcript: what the user
 * typed and what the chat wrote back, and nothing else. A grader model reads
 * that alone, as the user, and marks each criterion below pass, fail, or
 * n/a with a reason. It is a soft score, read beside the hard assertions,
 * never a gate: the rubric is the user's expectations, not the product's
 * mechanics, so a reply can pass every assertion and still read wrong.
 *
 *   node --import tsx evals/user-view-grade.ts <matrix-dir> [--trials 1]
 *
 * Writes `grades.json` and `grades.md` into the matrix folder. Runs whose
 * slug starts `holdout-` are tabulated apart, since they are kept back from
 * whoever tunes the agent's prompt.
 *
 * The grader is Haiku 5.5 through OpenRouter, the key read from this shell
 * or the package's `.env`, never printed.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as _ from "radashi";

const PACKAGE_DIR = path.resolve(import.meta.dirname, "..");
const GRADER_MODEL = "anthropic/claude-haiku-5.5";

const CRITERIA = {
  meant:
    "It answered what I meant, reading my messages together: fragments of one thought were taken as one request, and a correction or an added step changed the work.",
  machinery:
    "It never talked about its own machinery (tasks, background work, jobs, notes, forks, steps, checks finishing) unless I brought it up. Saying it is looking, or that something is done, is fine; narrating how it is organized internally is not.",
  twice:
    "Nothing in its replies suggests it did the same thing twice, repeated itself, or answered the same thing in two separate messages.",
  later:
    "It honored what I said later over what I said first: a correction, a narrower wish, or a stop won, and nothing it said afterwards went against it.",
  links:
    "Anything I would want to click (a web page, a file, a thing it made) is a clickable Markdown link or a files block, not a bare domain or path in a sentence. Mark n/a when nothing it said needed a link.",
  register:
    "Its replies are terse and matter-of-fact and match how I wrote: no padding, no restating my request, no ceremony, no system-sounding phrasing.",
} as const;

type Criterion = keyof typeof CRITERIA;

interface Grade {
  reason: string;
  verdict: "fail" | "n/a" | "pass";
}

interface RunGrade {
  grades: Partial<Record<Criterion, Grade>>;
  key: string;
  model: string;
  slug: string;
  userView: string;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { concurrency: { default: "4", type: "string" } },
});

const matrixArg = positionals[0];
if (!matrixArg) {
  throw new Error("Usage: user-view-grade.ts <matrix-dir>");
}
const matrixDir = path.resolve(matrixArg);

function openRouterKey(): string {
  const fromEnv = process.env.APP_OPENROUTER_API_KEY;
  if (fromEnv) {
    return fromEnv;
  }
  const file = path.join(PACKAGE_DIR, ".env");
  const key = fs.existsSync(file)
    ? dotenv.parse(fs.readFileSync(file)).APP_OPENROUTER_API_KEY
    : undefined;
  if (!key) {
    throw new Error(
      "The grader needs APP_OPENROUTER_API_KEY, in this shell or the package's .env.",
    );
  }
  return key;
}

/** The run's `user-view.md`, under its results folder, if it wrote one. */
function userViewOf(resultsDir: string, slug: string): string | undefined {
  const caseDir = path.resolve(PACKAGE_DIR, resultsDir, `handoff-${slug}`);
  if (!fs.existsSync(caseDir)) {
    return undefined;
  }
  for (const model of fs.readdirSync(caseDir)) {
    const file = path.join(caseDir, model, "user-view.md");
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, "utf8");
    }
  }
  return undefined;
}

const PROMPT = (userView: string) =>
  `You are the user in this chat with an assistant on your computer. Below is exactly what you saw: your own messages and the assistant's replies, in order. Several of your messages were typed while the assistant was still working on an earlier one.

Judge the conversation against each of your expectations below. Use only what is on the page; do not guess at what happened behind it.

${Object.entries(CRITERIA)
  .map(([id, text]) => `- ${id}: ${text}`)
  .join("\n")}

Reply with JSON only, one entry per expectation:
{"meant": {"verdict": "pass" | "fail" | "n/a", "reason": "<one line, quoting the assistant where it helps>"}, ...}

The conversation:

${userView}`;

async function grade(
  userView: string,
  key: string,
): Promise<RunGrade["grades"]> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        body: JSON.stringify({
          messages: [{ content: PROMPT(userView), role: "user" }],
          model: GRADER_MODEL,
          response_format: { type: "json_object" },
          temperature: 0,
        }),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
      continue;
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const json = /\{[\s\S]*\}/.exec(content)?.[0];
    if (!json) {
      continue;
    }
    try {
      return JSON.parse(json) as RunGrade["grades"];
    } catch {
      continue;
    }
  }
  return {};
}

function rate(runs: RunGrade[], criterion: Criterion): string {
  const graded = runs.filter(
    (run) => run.grades[criterion]?.verdict !== "n/a" && run.grades[criterion],
  );
  const passed = graded.filter(
    (run) => run.grades[criterion]?.verdict === "pass",
  ).length;
  return graded.length === 0 ? "n/a" : `${passed}/${graded.length}`;
}

function table(title: string, runs: RunGrade[]): string {
  const models = [...new Set(runs.map((run) => run.model))].toSorted();
  const criteria = Object.keys(CRITERIA) as Criterion[];
  return [
    `## ${title}`,
    "",
    `| model | ${criteria.join(" | ")} |`,
    `|---|${criteria.map(() => "---").join("|")}|`,
    ...models.map(
      (model) =>
        `| ${model} | ${criteria
          .map((criterion) =>
            rate(
              runs.filter((run) => run.model === model),
              criterion,
            ),
          )
          .join(" | ")} |`,
    ),
    "",
  ].join("\n");
}

async function main() {
  const key = openRouterKey();
  const runsDir = path.join(matrixDir, "runs");
  const records = fs
    .readdirSync(runsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      key: file.replace(/\.json$/, ""),
      record: JSON.parse(fs.readFileSync(path.join(runsDir, file), "utf8")) as {
        model: string;
        resultsDir?: string;
        slug: string;
      },
    }));
  const graded: RunGrade[] = [];
  await _.parallel(
    Number(values.concurrency),
    records,
    async ({ key: runKey, record }) => {
      const userView = record.resultsDir
        ? userViewOf(record.resultsDir, record.slug)
        : undefined;
      if (!userView) {
        process.stderr.write(`${runKey}: no user-view.md, skipped\n`);
        return;
      }
      const grades = await grade(userView, key);
      const model =
        /(?:^|\/)([^/?]+)(?:\?|$)/.exec(record.model)?.[1] ?? record.model;
      graded.push({ grades, key: runKey, model, slug: record.slug, userView });
      process.stderr.write(
        `${runKey}: ${Object.entries(grades)
          .map(([id, one]) => `${id} ${one?.verdict ?? "?"}`)
          .join(", ")}\n`,
      );
    },
  );
  graded.sort((a, b) => a.key.localeCompare(b.key));
  const kept = graded.filter((run) => !run.slug.startsWith("holdout-"));
  const held = graded.filter((run) => run.slug.startsWith("holdout-"));
  fs.writeFileSync(
    path.join(matrixDir, "grades.json"),
    JSON.stringify(graded, null, 2),
  );
  const markdown = [
    `# User-view grades (${GRADER_MODEL})`,
    "",
    table("Tuning cases", kept),
    table("Holdout cases", held),
    "## Per run",
    "",
    ...graded.map(
      (run) =>
        `- ${run.key}: ${Object.entries(run.grades)
          .map(
            ([id, one]) =>
              `${id} ${one?.verdict ?? "?"}${one?.verdict === "fail" ? ` (${one.reason})` : ""}`,
          )
          .join("; ")}`,
    ),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(matrixDir, "grades.md"), markdown);
  process.stdout.write(
    `${table("Tuning cases", kept)}\n${table("Holdout cases", held)}`,
  );
}

await main();
