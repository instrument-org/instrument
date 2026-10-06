/**
 * Runs the hand-off suite (`cases/handoff.ts`) as a matrix of case, arm,
 * model, and trial, each run in a process of its own with a home of its own,
 * then tabulates what they cost the user.
 *
 * One process per run because a run's fixtures and output live in its home
 * and workspace folder, which a process shares across everything it runs,
 * and because arms c and v each change an agent for the whole process.
 *
 *   node --import tsx evals/handoff-matrix.ts run --model luna --repeat 3
 *   node --import tsx evals/handoff-matrix.ts summarize <dir>
 *
 * `--model` takes `luna` or `sol` (the ChatGPT plan's GPT-5.6 tiers, read
 * through the token Studio holds) or any model URI the eval CLI accepts.
 * Arms: a, today's chat; b, a task given the user's words; c, the one-agent
 * prototype (the driver sets `INSTRUMENT_EVAL_ONE_AGENT=1`); v, b in the
 * chat's voice. `--cases` and `--arms` narrow the matrix:
 * `--cases guide,email --arms a,b`.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as _ from "radashi";

const PACKAGE_DIR = path.resolve(import.meta.dirname, "..");

const SLUGS = [
  "guide",
  "email",
  "pdfs",
  "cart",
  "dictation",
  "weather",
  "two-jobs",
  "correction",
  "long-chat",
  "memory",
];

/**
 * a: today's chat. b: a task given the user's words. c: the one-agent
 * prototype. v: b in the chat's voice.
 */
const ARMS = ["a", "b", "c", "v"];

/** A first reply later than this held the user waiting on a foreground turn. */
const BLOCKING_MS = 20_000;

/**
 * `luna` and `sol` run metered through the OpenAI key: the plan does not
 * offer GPT-6 Luna, and its token lasts an hour unless Studio is open to
 * renew it. `plan-luna` and `plan-sol` are the plan's GPT-5.6 tiers.
 */
const MODEL_ALIASES: Record<string, string> = {
  luna: "openai/gpt-6-luna?provider=openai&providerConfigId=openai-config-id",
  "plan-luna":
    "openai/gpt-5.6-luna?provider=chatgpt&providerConfigId=chatgpt-plan",
  "plan-sol":
    "openai/gpt-5.6-sol?provider=chatgpt&providerConfigId=chatgpt-plan",
  sol: "openai/gpt-5.6-sol?provider=openai&providerConfigId=openai-config-id",
};

/**
 * USD per million tokens, as OpenAI lists them (and OpenRouter repeats):
 * fresh input, cached input, output. Hosted web search is billed per call on
 * top and is not counted here.
 */
const PRICES: Record<string, [number, number, number]> = {
  "gpt-5.6-luna": [0.2, 0.02, 1.2],
  "gpt-5.6-sol": [2, 0.2, 10],
  "gpt-6-luna": [0.1, 0.01, 0.5],
};

interface RunRecord {
  arm: string;
  assertions: { evidence: string; passed: boolean; text: string }[];
  costUSD?: number;
  erroredRequests: number;
  exitCode: number | null;
  metrics?: {
    doneMs: number;
    cacheReadTokens?: number;
    firstTextMs?: number;
    taskCommands?: { fork: number; new: number };
    tasksCreated: number;
    toolCalls: number;
    visibleChars: number;
  };
  model: string;
  /** The child's results folder, transcripts included. */
  resultsDir?: string;
  slug: string;
  stoppedBy?: string;
  treeTokens?: number;
  treeUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  trial: number;
}

/** What a run would cost metered, plan or not; undefined for an unpriced model. */
function costOf(record: RunRecord): number | undefined {
  const price = PRICES[modelName(record.model)];
  if (!price || !record.treeUsage) {
    return undefined;
  }
  const cached = record.metrics?.cacheReadTokens ?? 0;
  const [fresh, reused, output] = price;
  return (
    (Math.max(0, record.treeUsage.inputTokens - cached) * fresh +
      cached * reused +
      record.treeUsage.outputTokens * output) /
    1e6
  );
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    arms: { type: "string" },
    cases: { type: "string" },
    concurrency: { default: "4", type: "string" },
    "max-run-seconds": { default: "900", type: "string" },
    model: { multiple: true, type: "string" },
    repeat: { default: "1", type: "string" },
  },
});

const [subcommand, target] = positionals;

async function run() {
  const models = (values.model ?? []).map(
    (model) => MODEL_ALIASES[model] ?? model,
  );
  if (models.length === 0) {
    throw new Error("--model is required");
  }
  const slugs = values.cases?.split(",") ?? SLUGS;
  const arms = values.arms?.split(",") ?? ARMS;
  const repeat = Number.parseInt(values.repeat, 10);
  const concurrency = Number.parseInt(values.concurrency, 10);
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const outDir = path.join(
    PACKAGE_DIR,
    "eval-results.local",
    `handoff-${stamp}`,
  );
  fs.mkdirSync(path.join(outDir, "runs"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });

  // Trials outermost, so a run cut short still has every cell sampled.
  const plan = _.list(1, repeat).flatMap((trial) =>
    models.flatMap((model) =>
      slugs.flatMap((slug) => arms.map((arm) => ({ arm, model, slug, trial }))),
    ),
  );
  process.stderr.write(`${plan.length} runs into ${outDir}\n`);

  let done = 0;
  await _.parallel(concurrency, plan, async (one) => {
    const record = await runOne(one, outDir);
    done += 1;
    const passed = record.assertions.filter((a) => a.passed).length;
    process.stderr.write(
      `[${done}/${plan.length}] ${one.slug}-${one.arm} ${modelName(one.model)} #${one.trial}: ${passed}/${record.assertions.length}, ${Math.round((record.metrics?.doneMs ?? 0) / 1000)}s, ${record.treeTokens ?? "?"} tokens${record.stoppedBy ? `, stopped (${record.stoppedBy})` : ""}\n`,
    );
  });
  summarize(outDir);
}

async function runOne(
  {
    arm,
    model,
    slug,
    trial,
  }: { arm: string; model: string; slug: string; trial: number },
  outDir: string,
): Promise<RunRecord> {
  const key = `${slug}-${arm}-${modelName(model)}-${trial}`;
  const home = path.join(outDir, "homes", key);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INSTRUMENT_EVAL_HOME: home,
    NO_COLOR: "1",
    ...(arm === "c" ? { INSTRUMENT_EVAL_ONE_AGENT: "1" } : {}),
  };
  const log = fs.createWriteStream(path.join(outDir, "logs", `${key}.log`));
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  // A run that dies before its task exists, on a rate limit, measured
  // nothing; it is started again rather than scored.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await nextStartSlot();
    if (model.includes("provider=chatgpt")) {
      env.APP_CHATGPT_PLAN_TOKEN = await planToken();
    }
    ({ exitCode, stderr, stdout } = await spawnRun(
      [
        "run",
        `handoff-${slug}-${arm}`,
        "--model",
        model,
        "--paid",
        "-y",
        "--json",
        "--max-run-seconds",
        values["max-run-seconds"],
      ],
      env,
      log,
    ));
    const started = /Task created/.test(stderr);
    if (started || !/429|Too Many Requests/.test(stderr)) {
      break;
    }
    log.write(
      `\n--- attempt ${attempt} hit a rate limit before starting; retrying ---\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 15_000 * attempt));
  }
  log.end();

  const record: RunRecord = {
    arm,
    assertions: [],
    erroredRequests: 0,
    exitCode,
    model,
    resultsDir: /Results\s*:\s*(\S+)/.exec(stderr)?.[1],
    slug,
    trial,
  };
  const line = stdout.split("\n").find((one) => one.startsWith("{"));
  if (line) {
    const rollup = JSON.parse(line) as {
      results: (Omit<
        RunRecord,
        "arm" | "exitCode" | "model" | "slug" | "trial"
      > & {
        caseName: string;
      })[];
    };
    const result = rollup.results.find(
      (one) => one.caseName === `handoff-${slug}-${arm}`,
    );
    if (result) {
      Object.assign(record, {
        assertions: result.assertions,
        costUSD: result.costUSD,
        erroredRequests: result.erroredRequests,
        metrics: result.metrics,
        stoppedBy: result.stoppedBy,
        treeTokens: result.treeTokens,
        treeUsage: result.treeUsage,
      });
    }
  }
  fs.writeFileSync(
    path.join(outDir, "runs", `${key}.json`),
    JSON.stringify(record, null, 2),
  );
  return record;
}

let nextStartAt = 0;

/** Spaces process starts out, since each one reads the model catalogs. */
async function nextStartSlot() {
  const wait = nextStartAt - Date.now();
  nextStartAt = Math.max(Date.now(), nextStartAt) + 4000;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

function spawnRun(
  args: string[],
  env: NodeJS.ProcessEnv,
  log: fs.WriteStream,
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      "--import",
      "./evals/lib/memoize-model-catalogs.ts",
      "evals/cli.ts",
      ...args,
    ],
    { cwd: PACKAGE_DIR, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    log.write(chunk);
  });
  return new Promise((resolve) => {
    child.on("close", (exitCode) => {
      resolve({ exitCode, stderr, stdout });
    });
  });
}

/**
 * The plan token Studio holds, once it has long enough left to cover a run.
 * It lasts an hour and only Studio renews it (renewing it here would sign
 * Studio out), so a matrix longer than that waits here, saying so, until
 * Studio next uses the plan or shows its ChatGPT card in Settings.
 */
async function planToken(): Promise<string> {
  let said = false;
  for (;;) {
    const token = execFileSync(
      "pnpm",
      ["--silent", "script:chatgpt-plan-token"],
      {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    // A run started with less than its cap left on the token can outlive it.
    const marginMs = (Number(values["max-run-seconds"]) + 120) * 1000;
    if (tokenExpiresAt(token) - Date.now() > marginMs) {
      return token;
    }
    if (!said) {
      process.stderr.write(
        "The ChatGPT plan token expires before a run could finish; waiting for Studio to renew it (open Settings > ChatGPT in Studio).\n",
      );
      said = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

function tokenExpiresAt(token: string): number {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    return typeof payload === "object" &&
      payload !== null &&
      "exp" in payload &&
      typeof payload.exp === "number"
      ? payload.exp * 1000
      : 0;
  } catch {
    return 0;
  }
}

function modelName(uri: string): string {
  return (uri.split("?")[0] ?? uri).replace(/^.*\//, "");
}

function median(numbers: number[]): number | undefined {
  if (numbers.length === 0) {
    return undefined;
  }
  const sorted = numbers.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Scores every run in `outDir` again against its own workspace and home,
 * with the assertions as they stand now, at no model cost. The timings and
 * token counts are the run's and are kept.
 */
async function rescore(outDir: string) {
  const keys = fs
    .readdirSync(path.join(outDir, "runs"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""));
  await _.parallel(4, keys, async (key) => {
    const file = path.join(outDir, "runs", `${key}.json`);
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord;
    const log = fs.readFileSync(
      path.join(outDir, "logs", `${key}.log`),
      "utf8",
    );
    const workspace = /Workspace\s*:\s*(\S+)/.exec(log)?.[1];
    if (!workspace || !fs.existsSync(workspace)) {
      process.stderr.write(`${key}: no workspace to re-score\n`);
      return;
    }
    const sink = fs.createWriteStream(
      path.join(outDir, "logs", `${key}.rescore.log`),
    );
    const { stdout } = await spawnRun(
      [
        "report",
        workspace,
        "--json",
        "--name",
        `handoff-${record.slug}-${record.arm}`,
      ],
      {
        ...process.env,
        INSTRUMENT_EVAL_HOME: path.join(outDir, "homes", key),
        NO_COLOR: "1",
      },
      sink,
    );
    sink.end();
    const line = stdout.split("\n").find((one) => one.startsWith("{"));
    const result = line
      ? (
          JSON.parse(line) as {
            results: {
              assertions: RunRecord["assertions"];
              caseName: string;
            }[];
          }
        ).results.find(
          (one) => one.caseName === `handoff-${record.slug}-${record.arm}`,
        )
      : undefined;
    if (!result) {
      process.stderr.write(`${key}: the report had no result for it\n`);
      return;
    }
    record.assertions = result.assertions;
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
  });
  summarize(outDir);
}

function isScorable(record: RunRecord): boolean {
  return record.erroredRequests === 0 && record.metrics !== undefined;
}

function summarize(outDir: string) {
  const records = fs
    .readdirSync(path.join(outDir, "runs"))
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(
          fs.readFileSync(path.join(outDir, "runs", name), "utf8"),
        ) as RunRecord,
    );
  const cells = _.group(
    records,
    (record) => `${record.slug}|${record.arm}|${modelName(record.model)}`,
  );
  const seconds = (ms?: number) =>
    ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}`;
  const whole = (n?: number) => (n === undefined ? "-" : String(Math.round(n)));
  const rows = Object.entries(cells)
    .map(([key, all = []]) => {
      const [slug = "", arm = "", model = ""] = key.split("|");
      // A run whose model requests failed (rate limits, exhausted credits)
      // says nothing about the arm; it is counted in the notes and left out.
      const list = all.filter(isScorable);
      const passed = list.filter(
        (record) =>
          record.assertions.length > 0 &&
          record.assertions.every((assertion) => assertion.passed),
      ).length;
      const pick = (read: (record: RunRecord) => number | undefined) =>
        median(
          list.flatMap((record) => {
            const value = read(record);
            return value === undefined ? [] : [value];
          }),
        );
      return {
        arm,
        cells: [
          slug,
          arm,
          model,
          `${passed}/${list.length}`,
          seconds(pick((record) => record.metrics?.firstTextMs)),
          seconds(pick((record) => record.metrics?.doneMs)),
          whole(pick((record) => record.treeTokens)),
          (() => {
            const cost = pick(costOf);
            return cost === undefined ? "-" : `$${cost.toFixed(3)}`;
          })(),
          whole(pick((record) => record.metrics?.visibleChars)),
          whole(pick((record) => record.metrics?.tasksCreated)),
          `${list.filter((record) => (record.metrics?.taskCommands?.fork ?? 0) > 0).length}/${list.filter((record) => record.metrics?.tasksCreated === 0).length}`,
          String(
            list.filter(
              (record) => (record.metrics?.firstTextMs ?? 0) > BLOCKING_MS,
            ).length,
          ),
          whole(pick((record) => record.metrics?.toolCalls)),
          [
            all.length > list.length
              ? `${all.length - list.length} left out: provider errors`
              : "",
            list.some((record) => record.stoppedBy)
              ? `${list.filter((record) => record.stoppedBy).length} stopped`
              : "",
          ]
            .filter(Boolean)
            .join(", "),
        ],
        model,
        slug,
      };
    })
    .toSorted(
      (a, b) =>
        SLUGS.indexOf(a.slug) - SLUGS.indexOf(b.slug) ||
        a.model.localeCompare(b.model) ||
        a.arm.localeCompare(b.arm),
    );
  const header = [
    "case",
    "arm",
    "model",
    "pass",
    "first text s",
    "done s",
    "tokens",
    "cost",
    "visible chars",
    "tasks",
    "forked/foreground",
    "first text >20s",
    "tool calls",
    "notes",
  ];
  const table = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.cells.join(" | ")} |`),
  ].join("\n");
  const failures = records
    .filter(isScorable)
    .filter((record) =>
      record.assertions.some((assertion) => !assertion.passed),
    )
    .toSorted((a, b) => `${a.slug}${a.arm}`.localeCompare(`${b.slug}${b.arm}`))
    .flatMap((record) =>
      record.assertions
        .filter((assertion) => !assertion.passed)
        .map(
          (assertion) =>
            `- ${record.slug}-${record.arm} ${modelName(record.model)} #${record.trial}: ${assertion.text}: ${assertion.evidence.slice(0, 240).replaceAll("\n", " ")}`,
        ),
    );
  const total = records.reduce((sum, record) => sum + (costOf(record) ?? 0), 0);
  const report = `${table}\n\nTotal at metered prices: $${total.toFixed(2)} across ${records.length} runs (web search calls not counted).\n\nMedians per cell. Cost is what the run would bill metered, cache included. Pass is runs where every assertion passed, out of runs where no model request failed. Forked/foreground counts runs that ran \`task fork\` and runs that started no task at all. First text >20s counts runs whose first visible reply came more than 20s after the message.\n\n## Failed assertions\n\n${failures.join("\n") || "none"}\n`;
  fs.writeFileSync(path.join(outDir, "report.md"), report);
  fs.writeFileSync(
    path.join(outDir, "matrix.json"),
    JSON.stringify(records, null, 2),
  );
  process.stdout.write(`${report}\n${outDir}\n`);
}

if (subcommand === "summarize" && target) {
  summarize(path.resolve(target));
} else if (subcommand === "rescore" && target) {
  await rescore(path.resolve(target));
} else if (subcommand === "run") {
  await run();
} else {
  process.stderr.write(
    "Usage: handoff-matrix.ts run --model <luna|sol|uri> [--repeat n] [--concurrency n] [--cases guide,email] [--arms a,b,c,v]\n       handoff-matrix.ts summarize <dir>\n       handoff-matrix.ts rescore <dir>\n",
  );
  process.exit(1);
}
