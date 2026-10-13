/**
 * How the decision models compare on the questions the product asks them.
 *
 * Every shape here is one place Studio or the workspace asks the decision
 * model, built the way that code builds it, against labeled cases in
 * `corpus/`: chat search over the real history size and over the most the
 * product asks about, app search, emoji, filing a draft under a topic,
 * backfilling a new topic, and the retitle check. Each case is one decision
 * as a person waits for it, split into as many parallel requests as the
 * model's cap needs, so latency and cost are per decision, not per request.
 *
 *   pnpm eval:decision                                  the product's models, every shape
 *   pnpm eval:decision --model cf:clef --shape chat-search --repeat 3
 *   pnpm eval:decision --report eval-results.local/decision-<time>.jsonl
 *
 * Models are OpenRouter ids, or `cf:<name>` for Workers AI directly; any id
 * runs, not only the ones in `models.ts`. Needs
 * `APP_OPENROUTER_API_KEY`, and `CLOUDFLARE_ACCOUNT_ID` with
 * `CLOUDFLARE_WORKERS_AI_API_KEY` for `cf:`, in packages/workspace/.env.
 *
 * Accuracy is read through the product's own bars ("found", "wrong"), which
 * were tuned on one model, and as an AUC that needs no bar: how often
 * something that should be offered scores above something that should not.
 * A model with a high AUC and a poor "found" ranks well on its own scale,
 * and would need its bar moved rather than be ruled out.
 */
import "../../scripts/lib/test-node-env";
import "../../scripts/lib/define-globals-apply";
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, stripVTControlCharacters } from "node:util";

import { c } from "../utils";
import { type Asked } from "./client";
import { DECISION_MODELS, findModel } from "./models";
import { allShapes, type Metrics, type Shape } from "./shapes";

const { values } = parseArgs({
  options: {
    concurrency: { default: "4", type: "string" },
    model: { multiple: true, type: "string" },
    repeat: { default: "1", type: "string" },
    report: { type: "string" },
    shape: { multiple: true, type: "string" },
  },
});

interface Run {
  asked?: Omit<Asked, "answers">;
  case: string;
  error?: string;
  metrics?: Metrics;
  model: string;
  shape: string;
}

interface Header {
  models: string[];
  repeat: number;
  shapes: string[];
}

// A results file is a header line and then one line a decision, appended as
// each one lands, so a run stopped partway still has everything it finished
// and `--report` can print it.
const { header, outputPath, runs } = values.report
  ? await readResults(values.report)
  : await runAll();
const models = header.models.map(findModel);
const shapes = allShapes().filter((shape) =>
  header.shapes.includes(shape.name),
);
const { repeat } = header;

for (const shape of shapes) {
  printShape(shape);
}
printCostSummary();
process.stdout.write(
  `\n${c.dim}Results: ${path.relative(process.cwd(), outputPath)}${c.reset}\n`,
);

async function runAll() {
  const selectedModels = values.model?.length
    ? values.model.map(findModel)
    : DECISION_MODELS;
  const selectedShapes = allShapes().filter(
    (shape) =>
      !values.shape?.length ||
      values.shape.some((pattern) => shape.name.includes(pattern)),
  );
  const started: Header = {
    models: selectedModels.map((model) => model.id),
    repeat: Number.parseInt(values.repeat, 10),
    shapes: selectedShapes.map((shape) => shape.name),
  };
  const concurrency = Number.parseInt(values.concurrency, 10);
  const file = path.resolve(
    import.meta.dirname,
    "../..",
    "eval-results.local",
    `decision-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.jsonl`,
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(started)}\n`);

  const finished: Run[] = [];
  const perModel = selectedShapes.reduce(
    (n, shape) => n + shape.cases.length * started.repeat,
    0,
  );
  const left = new Map(selectedModels.map((model) => [model.id, perModel]));
  const total = perModel * selectedModels.length;

  // Models run side by side, each with its own few cases in flight, so one
  // model's rate limit or stall slows only its own numbers.
  await Promise.all(
    selectedModels.map(async (model) => {
      for (const shape of selectedShapes) {
        const jobs = shape.cases.flatMap((shapeCase) =>
          Array.from({ length: started.repeat }, () => shapeCase),
        );
        await pool(jobs, concurrency, async (shapeCase) => {
          const run: Run = {
            case: shapeCase.label,
            model: model.id,
            shape: shape.name,
          };
          try {
            const { asked, metrics } = await shapeCase.run(model);
            const { answers: _, ...rest } = asked;
            run.asked = rest;
            run.metrics = metrics;
          } catch (error) {
            run.error = error instanceof Error ? error.message : String(error);
          }
          finished.push(run);
          await fs.appendFile(file, `${JSON.stringify(run)}\n`);
          left.set(model.id, (left.get(model.id) ?? 1) - 1);
          reportProgress(finished.length, total, left);
        });
      }
    }),
  );
  process.stderr.write("\n");
  return { header: started, outputPath: file, runs: finished };
}

/** A count that rewrites itself in a terminal, and every tenth to a log, naming the models still going once few are. */
function reportProgress(
  done: number,
  total: number,
  left: Map<string, number>,
) {
  const going = [...left].filter(([, count]) => count > 0);
  const waiting =
    going.length > 0 && going.length <= 3
      ? `  (${going.map(([id, count]) => `${id} ${count}`).join(", ")})`
      : "";
  if (process.stderr.isTTY) {
    process.stderr.write(
      `\r${c.dim}${done}/${total} decisions${waiting}${c.reset}\u001B[K`,
    );
  } else if (done % 10 === 0 || done === total) {
    process.stderr.write(`${done}/${total} decisions${waiting}\n`);
  }
}

async function readResults(given: string) {
  // pnpm runs the script from the package; a path is meant from where it was typed.
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), given);
  const [first, ...rest] = (await fs.readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean);
  if (!first) {
    throw new Error(`${file} is empty`);
  }
  return {
    // Written by this script, so read back as the shapes it wrote.
    header: JSON.parse(first) as Header,
    outputPath: file,
    runs: rest.map((line) => JSON.parse(line) as Run),
  };
}

function printShape(shape: Shape) {
  const rows = models.map((model) => {
    const mine = runs.filter(
      (run) => run.shape === shape.name && run.model === model.id,
    );
    const ok = mine.filter((run) => run.metrics && run.asked);
    // Counts are averaged over repeats so a column reads as one pass.
    const counts: Record<string, number> = {};
    for (const run of ok) {
      for (const [key, value] of Object.entries(run.metrics?.counts ?? {})) {
        counts[key] = (counts[key] ?? 0) + value / repeat;
      }
    }
    for (const [key, value] of Object.entries(counts)) {
      counts[key] = Math.round(value * 10) / 10;
    }
    const positives = ok.flatMap((run) => run.metrics?.positives ?? []);
    const negatives = ok.flatMap((run) => run.metrics?.negatives ?? []);
    const ranked = { of: 0, top: 0 };
    for (const run of ok) {
      const top = topR(run.metrics);
      if (top) {
        ranked.of += top.of / repeat;
        ranked.top += top.top / repeat;
      }
    }
    ranked.of = Math.round(ranked.of * 10) / 10;
    ranked.top = Math.round(ranked.top * 10) / 10;
    const ms = ok.map((run) => run.asked?.ms ?? 0).toSorted((a, b) => a - b);
    const cost = ok.reduce((sum, run) => sum + (run.asked?.cost ?? 0), 0);
    const tokens = ok.reduce(
      (sum, run) => sum + (run.asked?.inputTokens ?? 0),
      0,
    );
    const retries = ok.reduce((sum, run) => sum + (run.asked?.retries ?? 0), 0);
    const failed = mine.length - ok.length;
    return [
      model.id,
      ...shape.columns.map((column) =>
        ok.length ? column.value(counts) : "-",
      ),
      positives.length && negatives.length
        ? auc(positives, negatives).toFixed(4)
        : "-",
      ranked.of ? `${ranked.top}/${ranked.of}` : "-",
      ms.length ? String(percentile(ms, 0.5)) : "-",
      ms.length ? String(percentile(ms, 0.9)) : "-",
      ok.length ? String(Math.round(tokens / ok.length)) : "-",
      ok.length ? formatDollars((cost / ok.length) * 1000) : "-",
      [
        failed ? `${c.red}${failed} failed${c.reset}` : "",
        retries ? `${retries} retried` : "",
      ]
        .filter(Boolean)
        .join(", "),
    ];
  });
  process.stdout.write(
    `\n${c.cyan}${shape.name}${c.reset}  ${c.dim}${shape.about}${c.reset}\n`,
  );
  printTable(
    [
      "model",
      ...shape.columns.map((column) => column.header),
      "AUC",
      "top R",
      "p50 ms",
      "p90 ms",
      "tokens",
      "$ / 1k",
      "",
    ],
    rows,
  );
  const failures = runs.filter((run) => run.shape === shape.name && run.error);
  for (const model of models) {
    const first = failures.find((run) => run.model === model.id);
    if (first) {
      process.stdout.write(
        `  ${c.red}${model.id}${c.reset} ${c.dim}${(first.error ?? "").slice(0, 200)}${c.reset}\n`,
      );
    }
  }
}

/** What one pass over every selected case cost per model, and how that splits by shape. */
function printCostSummary() {
  process.stdout.write(
    `\n${c.cyan}cost of one pass${c.reset}  ${c.dim}every selected case once${c.reset}\n`,
  );
  printTable(
    ["model", ...shapes.map((shape) => shape.name), "total"],
    models.map((model) => {
      const perShape = shapes.map(
        (shape) =>
          runs
            .filter((run) => run.shape === shape.name && run.model === model.id)
            .reduce((sum, run) => sum + (run.asked?.cost ?? 0), 0) / repeat,
      );
      return [
        model.id,
        ...perShape.map(formatDollars),
        formatDollars(perShape.reduce((a, b) => a + b, 0)),
      ];
    }),
  );
}

/**
 * Of the R things a case should offer, how many rank in its top R once the
 * merely acceptable ones are set aside: a ranking measure with no bar, and
 * per case, so it is not padded by the hundreds of plainly wrong candidates
 * every case has. Ties go against the model.
 */
function topR(metrics: Metrics | undefined) {
  const positives = metrics?.positives ?? [];
  const negatives = metrics?.negatives ?? [];
  if (positives.length === 0 || negatives.length === 0) {
    return undefined;
  }
  const ranked = [
    ...negatives.map((score) => ({ positive: false, score })),
    ...positives.map((score) => ({ positive: true, score })),
  ].toSorted(
    (a, b) => b.score - a.score || Number(a.positive) - Number(b.positive),
  );
  return {
    of: positives.length,
    top: ranked.slice(0, positives.length).filter((item) => item.positive)
      .length,
  };
}

/** How often a positive scores above a negative, pooled over every case, ties counting half. */
function auc(positives: number[], negatives: number[]): number {
  const sorted = negatives.toSorted((a, b) => a - b);
  let wins = 0;
  for (const score of positives) {
    const below = lowerBound(sorted, score);
    const notAbove = upperBound(sorted, score);
    wins += below + (notAbove - below) / 2;
  }
  return wins / (positives.length * negatives.length);
}

/** Where `value` would go in `sorted`: before its equals, or with `after`, past them. */
function lowerBound(sorted: number[], value: number, after = false): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const at = sorted[mid] ?? Infinity;
    if (at < value || (after && at === value)) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function upperBound(sorted: number[], value: number): number {
  return lowerBound(sorted, value, true);
}

function percentile(sorted: number[], p: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
}

function formatDollars(dollars: number): string {
  if (dollars === 0) {
    return "$0";
  }
  return dollars < 0.01 ? `$${dollars.toFixed(5)}` : `$${dollars.toFixed(3)}`;
}

function printTable(headers: string[], rows: string[][]) {
  // Width by visible characters, so a colored cell does not push its column.
  const visible = (text: string) => stripVTControlCharacters(text).length;
  const widths = headers.map((heading, index) =>
    Math.max(visible(heading), ...rows.map((row) => visible(row[index] ?? ""))),
  );
  const line = (cells: string[]) =>
    `  ${cells.map((cell, index) => cell + " ".repeat((widths[index] ?? 0) - visible(cell))).join("  ")}\n`;
  process.stdout.write(`${c.dim}${line(headers)}${c.reset}`);
  for (const row of rows) {
    process.stdout.write(line(row));
  }
}

async function pool<T>(
  items: T[],
  size: number,
  work: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item !== undefined) {
          await work(item);
        }
      }
    }),
  );
}
