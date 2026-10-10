/**
 * Runs the hand-off suite (`cases/handoff.ts`) as a matrix of case, model,
 * and trial, each run in a process of its own with a home of its own, then
 * tabulates what they cost the user.
 *
 * One process per run because a run's fixtures and output live in its home
 * and workspace folder, which a process shares across everything it runs.
 *
 *   node --import tsx evals/handoff-matrix.ts run --model glm --repeat 3
 *   node --import tsx evals/handoff-matrix.ts run --model plan-luna --model or-haiku55 --cases guide,email --out <dir>
 *   node --import tsx evals/handoff-matrix.ts summarize <dir>
 *   node --import tsx evals/handoff-matrix.ts rescore <dir>
 *   node --import tsx evals/handoff-matrix.ts plan-usage
 *   node --import tsx evals/handoff-matrix.ts openrouter-usage
 *
 * Runs, logs and homes go in `runs/`, `logs/` and `homes/` under the output
 * folder, with `matrix.json` and `report.md` beside them. `--cases` narrows
 * the matrix: `--cases guide,email`. `--out` adds to an existing output
 * folder.
 *
 * Models are limited to the ChatGPT plan (`plan-luna`, `plan-sol`),
 * Workers AI (`glm`, or `cf:<id>`), and the metered models cleared for spend
 * through OpenRouter: `or-luna` (`openai/gpt-5.6-luna`), `or-luna6`
 * (`openai/gpt-6-luna`), `or-glm` (`z-ai/glm-5.3-flash`) and `or-haiku55`
 * (`anthropic/claude-haiku-5.5`); anything else metered is refused. Every metered provider key is blanked in the child's
 * environment, so nothing a run does can fall back to one, except the
 * OpenRouter key on an `or-*` run, where `evals/lib/pin-openrouter-model.ts`
 * refuses any OpenRouter request naming a model other than that run's own (an
 * image model, a search model, another cleared model). `openrouter-usage`
 * reads the key's spend, before and after.
 */
import dotenv from "dotenv";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as _ from "radashi";

import type { TurnShape } from "./harness";

const PACKAGE_DIR = path.resolve(import.meta.dirname, "..");

/** Every case, with the kind of ask it stands for. */
const CASES: Record<string, string> = {
  guide: "small",
  email: "small",
  "two-jobs": "small",
  "file-qa": "small",
  refinement: "small",
  pdfs: "deliverable",
  cart: "deliverable",
  document: "deliverable",
  "browser-form": "deliverable",
  correction: "background",
  responsiveness: "background",
  "two-backgrounds": "background",
  dictation: "ambiguity",
  "ambiguous-cleanup": "ambiguity",
  "vague-cleanup": "ambiguity",
  "long-chat": "context",
  memory: "context",
  "earlier-preference": "context",
  "topic-instruction": "context",
  weather: "research",
  research: "research",
  "long-work": "context",
  "interrupt-foreground": "background",
  "parallel-scratch": "background",
  // Whole-design scenarios (`cases/scenarios.ts`): run only when named.
  fleet: "scenario",
  "interrupt-chain": "scenario",
  "stop-all": "scenario",
  steer: "scenario",
  "long-context": "scenario",
  injection: "scenario",
  "injection-fork": "scenario",
  "slow-wake": "scenario",
  // Messages typed mid-work (`cases/interruptions.ts`): run only when named.
  "interrupt-fragments": "interruption",
  "interrupt-correction": "interruption",
  "interrupt-added-step": "interruption",
  "interrupt-later-wish": "interruption",
  "interrupt-stop": "interruption",
  "holdout-unrelated": "interruption",
  "holdout-issue": "interruption",
  "holdout-month": "interruption",
};

const SLUGS = Object.keys(CASES);

/**
 * Per-run token caps above the harness's default, for cases whose runs pass
 * it while still on track: `long-work` on Haiku does.
 * `--max-run-tokens` sets one cap for every case instead.
 */
const CASE_MAX_RUN_TOKENS: Record<string, number> = {
  "long-work": 2_500_000,
  fleet: 2_500_000,
  "long-context": 2_500_000,
};

/** Cases that need the plan's own web search, which Workers AI runs lack. */
const PLAN_ONLY = new Set(["research"]);

/** A tool-using turn that shows the user more messages than this is chatty. */
const CHATTY_MESSAGES = 2;

/** A first reply later than this held the user waiting on a foreground turn. */
const BLOCKING_MS = 20_000;

/** The ask the bar's "small asks" are read from. */
const SMALL = new Set(
  Object.entries(CASES)
    .filter(([, category]) => category === "small")
    .map(([slug]) => slug),
);

const WORKERS_AI = "providerConfigId=workers-ai-config-id";
const PLAN = "providerConfigId=chatgpt-plan";

/**
 * The metered models a run may spend on, through OpenRouter, by alias. A run
 * on one is pinned to that model alone.
 */
const OPENROUTER_MODELS: Record<string, string> = {
  "or-glm": "z-ai/glm-5.3-flash",
  "or-haiku55": "anthropic/claude-haiku-5.5",
  "or-luna": "openai/gpt-5.6-luna",
  "or-luna6": "openai/gpt-6-luna",
};

function openRouterUri(model: string): string {
  return `${model}?provider=openrouter&providerConfigId=openrouter-config-id`;
}

/** The OpenRouter model a resolved URI is pinned to, if it is a cleared one. */
function pinnedOpenRouterModel(uri?: string): string | undefined {
  return Object.values(OPENROUTER_MODELS).find(
    (model) => uri === openRouterUri(model),
  );
}

const MODEL_ALIASES: Record<string, string> = {
  glm: `zai-org/glm-5.3-flash?provider=openai-compatible&${WORKERS_AI}`,
  ...Object.fromEntries(
    Object.entries(OPENROUTER_MODELS).map(([alias, model]) => [
      alias,
      openRouterUri(model),
    ]),
  ),
  "plan-luna": `openai/gpt-5.6-luna?provider=chatgpt&${PLAN}`,
  "plan-sol": `openai/gpt-5.6-sol?provider=chatgpt&${PLAN}`,
};

/**
 * Every provider key a run could spend metered money through. Set empty in
 * the child, which the env schema reads as unset and `dotenv` leaves alone,
 * so neither a model URI nor a product fallback (a title model, a search
 * model) can reach one.
 */
const METERED_KEYS = [
  "APP_AI_API_KEY",
  "APP_AI_GATEWAY_API_KEY",
  "APP_ANTHROPIC_API_KEY",
  "APP_CEREBRAS_API_KEY",
  "APP_GOOGLE_API_KEY",
  "APP_GROQ_API_KEY",
  "APP_OPENAI_API_KEY",
  "APP_OPENCODE_GO_API_KEY",
  "APP_OPENCODE_ZEN_API_KEY",
  "APP_OPENROUTER_API_KEY",
  "APP_ZAI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];

/** What a plan run's log says when the plan itself refused it. */
const PLAN_REFUSED =
  /usage_limit|usage limit|rate_limit|rate limit|Too Many Requests|Unauthorized|subscription_sharing|invalid_api_key|token.{0,20}expired|status(?:Code)?\W{1,3}(?:401|403|429)\b/i;

interface RunRecord {
  assertions: { evidence: string; passed: boolean; text: string }[];
  erroredRequests: number;
  exitCode: number | null;
  /**
   * OpenRouter requests `pin-openrouter-model.ts` refused because they named
   * a model the run was not cleared to spend on.
   */
  guardRefusals?: number;
  metrics?: {
    autoForks?: number;
    cacheReadTokens?: number;
    duringWorkMissed?: number;
    doneMs: number;
    firstTextMs?: number;
    marks?: Record<string, null | number>;
    refusals?: { all: number; task: number };
    taskCommands?: { new: number };
    tasksCreated: number;
    toolCalls: number;
    turns?: { chars: number; ms: number; tokens: number }[];
    turnShapes?: TurnShape[];
    visibleChars: number;
  };
  model: string;
  /**
   * Workers AI rate-limit waits the run sat through, whose seconds are in
   * its timings.
   */
  rateLimitWaits?: number;
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

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    cases: { type: "string" },
    concurrency: { default: "4", type: "string" },
    "max-run-seconds": { default: "900", type: "string" },
    "max-run-tokens": { type: "string" },
    model: { multiple: true, type: "string" },
    out: { type: "string" },
    repeat: { default: "1", type: "string" },
  },
});

const [subcommand, target] = positionals;

/** A model URI this runner will spend on, or a refusal saying why not. */
function resolveModel(model: string): string {
  const uri = model.startsWith("cf:")
    ? `${model.slice(3).replace(/^@cf\//, "")}?provider=openai-compatible&${WORKERS_AI}`
    : (MODEL_ALIASES[model] ?? model);
  const isPlan = uri.includes("provider=chatgpt&") && uri.includes(PLAN);
  if (
    !isPlan &&
    !uri.includes(WORKERS_AI) &&
    pinnedOpenRouterModel(uri) === undefined
  ) {
    throw new Error(
      `Refusing ${model}: this runner spends only on the ChatGPT plan, Workers AI, and ${Object.keys(OPENROUTER_MODELS).join(", ")} through OpenRouter, never another metered model.`,
    );
  }
  return uri;
}

function isPlanModel(uri: string): boolean {
  return uri.includes(PLAN);
}

/** Set once a plan run is refused by the plan; later plan runs are skipped. */
let planHalted: string | undefined;

async function run() {
  const models = (values.model ?? []).map(resolveModel);
  if (models.length === 0) {
    throw new Error("--model is required");
  }
  const slugs =
    values.cases?.split(",") ??
    SLUGS.filter(
      (slug) => CASES[slug] !== "scenario" && CASES[slug] !== "interruption",
    );
  const unknown = slugs.filter((slug) => !(slug in CASES));
  if (unknown.length > 0) {
    throw new Error(`Unknown cases: ${unknown.join(", ")}`);
  }
  const repeat = Number.parseInt(values.repeat, 10);
  const concurrency = Number.parseInt(values.concurrency, 10);
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const outDir = values.out
    ? path.resolve(values.out)
    : path.join(PACKAGE_DIR, "eval-results.local", `handoff-${stamp}`);
  for (const sub of ["runs", "logs", "homes"]) {
    fs.mkdirSync(path.join(outDir, sub), { recursive: true });
  }

  // Trials outermost, so a run cut short still has every cell sampled.
  const plan = _.list(1, repeat).flatMap((trial) =>
    models.flatMap((model) =>
      slugs
        .filter((slug) => isPlanModel(model) || !PLAN_ONLY.has(slug))
        .map((slug) => ({ model, slug, trial })),
    ),
  );
  process.stderr.write(`${plan.length} runs into ${outDir}\n`);

  let done = 0;
  await _.parallel(concurrency, plan, async (one) => {
    if (isPlanModel(one.model) && planHalted) {
      done += 1;
      process.stderr.write(
        `[${done}/${plan.length}] ${one.slug} skipped: the plan stopped answering (${planHalted})\n`,
      );
      return;
    }
    const record = await runOne(one, outDir);
    done += 1;
    const held = record.assertions.filter((a) => a.passed).length;
    process.stderr.write(
      `[${done}/${plan.length}] ${one.slug} ${modelName(one.model)} #${one.trial}: ${held}/${record.assertions.length}, ${Math.round((record.metrics?.doneMs ?? 0) / 1000)}s, ${record.treeTokens ?? "?"} tokens${record.stoppedBy ? `, stopped (${record.stoppedBy})` : ""}\n`,
    );
  });
  if (planHalted) {
    process.stderr.write(
      `\nThe plan portion stopped early: ${planHalted}. Runs after that point were skipped, not scored.\n`,
    );
  }
  summarize(outDir);
}

/**
 * The environment a child runs in: no metered keys but the OpenRouter one
 * on an `or-*` run, pinned to its one model.
 */
function childEnv(home: string, model?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.APP_CHATGPT_PLAN_TOKEN;
  for (const key of METERED_KEYS) {
    env[key] = "";
  }
  const pinned = pinnedOpenRouterModel(model);
  return {
    ...env,
    ...(pinned === undefined
      ? {}
      : { APP_OPENROUTER_API_KEY: openRouterKey() }),
    INSTRUMENT_EVAL_HOME: home,
    INSTRUMENT_EVAL_OPENROUTER_MODEL: pinned ?? "",
    NO_COLOR: "1",
  };
}

/**
 * The OpenRouter key, from this shell or the package's `.env`, for an
 * `or-*` run and for reading the key's spend. Never printed.
 */
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
      "or-* models need APP_OPENROUTER_API_KEY, in this shell or the package's .env.",
    );
  }
  return key;
}

/**
 * What the OpenRouter key has spent, as OpenRouter reports it, and what the
 * account has left, for reading before and after a matrix. Reading it spends
 * nothing. Prints figures only, never the key.
 */
async function openRouterUsage() {
  const headers = { Authorization: `Bearer ${openRouterKey()}` };
  const [key, credits] = await Promise.all(
    ["key", "credits"].map(async (route) => {
      const response = await fetch(`https://openrouter.ai/api/v1/${route}`, {
        headers,
      });
      const body: unknown = await response.json().catch(() => undefined);
      const data =
        typeof body === "object" && body !== null && "data" in body
          ? (body.data as Record<string, unknown>)
          : undefined;
      return { data, status: response.status };
    }),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        account:
          credits?.data === undefined
            ? { status: credits?.status }
            : {
                totalCredits: credits.data.total_credits,
                totalUsage: credits.data.total_usage,
              },
        at: new Date().toISOString(),
        key:
          key?.data === undefined
            ? { status: key?.status }
            : {
                limit: key.data.limit,
                limitRemaining: key.data.limit_remaining,
                usage: key.data.usage,
                usageDaily: key.data.usage_daily,
              },
      },
      null,
      2,
    )}\n`,
  );
}

async function runOne(
  { model, slug, trial }: { model: string; slug: string; trial: number },
  outDir: string,
): Promise<RunRecord> {
  const key = `${slug}-${modelName(model)}-${trial}`;
  const env = childEnv(path.join(outDir, "homes", key), model);
  const log = fs.createWriteStream(path.join(outDir, "logs", `${key}.log`));
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  // A run that dies before its task exists, on a rate limit, measured
  // nothing; it is started again rather than scored. Not on the plan, where
  // a rate limit is the plan saying stop.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await nextStartSlot();
    if (isPlanModel(model)) {
      const token = planToken();
      if (!token) {
        log.end();
        return emptyRecord({ model, slug, trial }, outDir, key);
      }
      env.APP_CHATGPT_PLAN_TOKEN = token;
    }
    ({ exitCode, stderr, stdout } = await spawnRun(
      [
        "run",
        `handoff-${slug}`,
        "--model",
        model,
        "--paid",
        "-y",
        "--json",
        "--max-run-seconds",
        values["max-run-seconds"],
        ...((values["max-run-tokens"] ?? CASE_MAX_RUN_TOKENS[slug])
          ? [
              "--max-run-tokens",
              values["max-run-tokens"] ?? String(CASE_MAX_RUN_TOKENS[slug]),
            ]
          : []),
      ],
      env,
      log,
    ));
    const started = /Task created/.test(stderr);
    if (isPlanModel(model)) {
      break;
    }
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
    assertions: [],
    erroredRequests: 0,
    exitCode,
    guardRefusals: stderr.match(/^openrouter-guard refused/gm)?.length ?? 0,
    model,
    rateLimitWaits: stderr.match(/^rate-limit wait/gm)?.length ?? 0,
    resultsDir: /Results\s*:\s*(\S+)/.exec(stderr)?.[1],
    slug,
    trial,
  };
  const line = stdout.split("\n").find((one) => one.startsWith("{"));
  if (line) {
    const rollup = JSON.parse(line) as {
      results: (Omit<RunRecord, "exitCode" | "model" | "slug" | "trial"> & {
        caseName: string;
      })[];
    };
    const result = rollup.results.find(
      (one) => one.caseName === `handoff-${slug}`,
    );
    if (result) {
      Object.assign(record, {
        assertions: result.assertions,
        erroredRequests: result.erroredRequests,
        metrics: result.metrics,
        stoppedBy: result.stoppedBy,
        treeTokens: result.treeTokens,
        treeUsage: result.treeUsage,
      });
    }
  }
  // Only a run whose requests failed is read for why, since a passing run's
  // log can name a limit in what it worked on.
  if (isPlanModel(model) && (record.erroredRequests > 0 || !record.metrics)) {
    const refused = PLAN_REFUSED.exec(stderr)?.[0];
    if (refused) {
      planHalted ??= `a run's log says "${refused}" (${key})`;
    }
  }
  fs.writeFileSync(
    path.join(outDir, "runs", `${key}.json`),
    JSON.stringify(record, null, 2),
  );
  return record;
}

/** A run that never started, filed so the summary counts it as left out. */
function emptyRecord(
  one: { model: string; slug: string; trial: number },
  outDir: string,
  key: string,
): RunRecord {
  const record: RunRecord = {
    ...one,
    assertions: [],
    erroredRequests: 1,
    exitCode: null,
  };
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
      "--import",
      "./evals/lib/retry-workers-ai-rate-limits.ts",
      "--import",
      "./evals/lib/pin-openrouter-model.ts",
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
 * The plan token Studio holds, when it has long enough left to cover a run.
 * It lasts an hour and only Studio renews it (renewing it here would sign
 * Studio out), so an expired or expiring token stops the plan portion rather
 * than being waited out or worked around. Never printed.
 */
function planToken(): string | undefined {
  let token: string;
  try {
    token = execFileSync("pnpm", ["--silent", "script:chatgpt-plan-token"], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    planHalted ??=
      "no plan token: Studio is not signed in to the plan, or its token has expired";
    return undefined;
  }
  // A run started with less than its cap left on the token can outlive it.
  const marginMs = (Number(values["max-run-seconds"]) + 120) * 1000;
  if (tokenExpiresAt(token) - Date.now() < marginMs) {
    planHalted ??=
      "the plan token expires before another run could finish; Studio renews it only when it next uses the plan";
    return undefined;
  }
  return token;
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

/**
 * How much of the plan's usage windows is spent, as the plan reports it, for
 * reading before and after a matrix. Reading it spends nothing.
 */
async function planUsage() {
  const token = planToken();
  if (!token) {
    process.stderr.write(`${planHalted ?? "no plan token"}\n`);
    process.exit(1);
  }
  const claims: unknown = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
  );
  const auth =
    typeof claims === "object" && claims !== null
      ? (claims as Record<string, unknown>)["https://api.openai.com/auth"]
      : undefined;
  const account =
    typeof auth === "object" && auth !== null && "chatgpt_account_id" in auth
      ? String(auth.chatgpt_account_id)
      : undefined;
  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(account ? { "ChatGPT-Account-Id": account } : {}),
    },
  });
  const body: unknown = await response.json().catch(() => undefined);
  const limits =
    typeof body === "object" && body !== null && "rate_limit" in body
      ? body.rate_limit
      : undefined;
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), limits, status: response.status, tokenMinutesLeft: Math.round((tokenExpiresAt(token) - Date.now()) / 60_000) }, null, 2)}\n`,
  );
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
      ["report", workspace, "--json", "--name", `handoff-${record.slug}`],
      childEnv(path.join(outDir, "homes", key)),
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
        ).results.find((one) => one.caseName === `handoff-${record.slug}`)
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

function passed(record: RunRecord): boolean {
  return (
    record.assertions.length > 0 &&
    record.assertions.every((assertion) => assertion.passed)
  );
}

function readRecords(outDir: string): RunRecord[] {
  return fs
    .readdirSync(path.join(outDir, "runs"))
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(
          fs.readFileSync(path.join(outDir, "runs", name), "utf8"),
        ) as RunRecord,
    );
}

function summarize(outDir: string) {
  const records = readRecords(outDir);
  const cells = _.group(
    records,
    (record) => `${record.slug}|${modelName(record.model)}`,
  );
  const seconds = (ms?: number) =>
    ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}`;
  const whole = (n?: number) => (n === undefined ? "-" : String(Math.round(n)));
  const pickFrom =
    (list: RunRecord[]) => (read: (record: RunRecord) => number | undefined) =>
      median(
        list.flatMap((record) => {
          const value = read(record);
          return value === undefined ? [] : [value];
        }),
      );
  const rows = Object.entries(cells)
    .map(([key, all = []]) => {
      const [slug = "", model = ""] = key.split("|");
      // A run whose model requests failed (rate limits, exhausted credits)
      // says nothing about the agent; it is counted in the notes and left out.
      const list = all.filter(isScorable);
      const pick = pickFrom(list);
      const quick = list.flatMap((record) => {
        const value = record.metrics?.marks?.["quick answer"];
        return value === undefined ? [] : [value];
      });
      return {
        cells: [
          slug,
          CASES[slug] ?? "",
          model,
          `${list.filter(passed).length}/${list.length}`,
          seconds(pick((record) => record.metrics?.firstTextMs)),
          seconds(pick((record) => record.metrics?.doneMs)),
          whole(pick((record) => record.treeTokens)),
          whole(pick((record) => record.metrics?.cacheReadTokens)),
          whole(pick((record) => record.metrics?.visibleChars)),
          `${whole(pick((record) => record.metrics?.tasksCreated))} (${list.filter((record) => (record.metrics?.taskCommands?.new ?? 0) > 0).length}n/${list.filter((record) => (record.metrics?.autoForks ?? 0) > 0).length}i)`,
          `${list.reduce((sum, record) => sum + (record.metrics?.refusals?.task ?? 0), 0)}/${list.reduce((sum, record) => sum + (record.metrics?.refusals?.all ?? 0), 0)}`,
          quick.length > 0
            ? quick
                .map((value) =>
                  value === null ? "never" : `${(value / 1000).toFixed(1)}`,
                )
                .join(", ")
            : "",
          [
            all.length > list.length
              ? `${all.length - list.length} left out: provider errors or not started`
              : "",
            list.some((record) => record.stoppedBy)
              ? `${list.filter((record) => record.stoppedBy).length} stopped`
              : "",
            list.some((record) => (record.guardRefusals ?? 0) > 0)
              ? `${list.reduce((sum, record) => sum + (record.guardRefusals ?? 0), 0)} OpenRouter requests refused by the guard`
              : "",
            list.some((record) => (record.rateLimitWaits ?? 0) > 0)
              ? `${list.filter((record) => (record.rateLimitWaits ?? 0) > 0).length} waited on rate limits`
              : "",
            list.some(
              (record) => (record.metrics?.firstTextMs ?? 0) > BLOCKING_MS,
            )
              ? `${list.filter((record) => (record.metrics?.firstTextMs ?? 0) > BLOCKING_MS).length} first text >20s`
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
        a.model.localeCompare(b.model),
    );
  const header = [
    "case",
    "kind",
    "model",
    "pass",
    "first text s",
    "done s",
    "tokens",
    "cached",
    "visible chars",
    "tasks (runs that ran task new/forked on interrupt)",
    "refusals task/all",
    "quick answer s",
    "notes",
  ];
  const table = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.cells.join(" | ")} |`),
  ].join("\n");

  // Per model, the figures the bar reads.
  const byModel = _.group(records.filter(isScorable), (record) =>
    modelName(record.model),
  );
  const barRows = Object.entries(byModel)
    .map(([model, list = []]) => {
      const small = list.filter((record) => SMALL.has(record.slug));
      const pickSmall = pickFrom(small);
      const pickAll = pickFrom(list);
      const badCalls = list.filter(
        (record) => (record.metrics?.refusals?.task ?? 0) > 0,
      ).length;
      return `| ${model} | ${list.filter(passed).length}/${list.length} | ${seconds(pickSmall((record) => record.metrics?.doneMs))} | ${seconds(pickAll((record) => record.metrics?.firstTextMs))} | ${seconds(_.max(list.map((record) => record.metrics?.firstTextMs ?? 0)) ?? undefined)} | ${badCalls}/${list.length} |`;
    })
    .toSorted();
  const bar = [
    "| model | pass | small asks: median done s | median first text s | worst first text s | runs with a refused task call |",
    "| --- | --- | --- | --- | --- | --- |",
    ...barRows,
  ].join("\n");

  const byKind = _.group(
    records.filter(isScorable),
    (record) => `${CASES[record.slug] ?? ""}|${modelName(record.model)}`,
  );
  const kindRows = Object.entries(byKind)
    .map(([key, list = []]) => {
      const [kind = "", model = ""] = key.split("|");
      return `| ${kind} | ${model} | ${list.filter(passed).length}/${list.length} | ${seconds(pickFrom(list)((record) => record.metrics?.doneMs))} |`;
    })
    .toSorted();
  const kinds = [
    "| kind | model | pass | median done s |",
    "| --- | --- | --- | --- |",
    ...kindRows,
  ].join("\n");

  const failures = records
    .filter(isScorable)
    .filter((record) =>
      record.assertions.some((assertion) => !assertion.passed),
    )
    .toSorted((a, b) => a.slug.localeCompare(b.slug))
    .flatMap((record) =>
      record.assertions
        .filter((assertion) => !assertion.passed)
        .map(
          (assertion) =>
            `- ${record.slug} ${modelName(record.model)} #${record.trial}: ${assertion.text}: ${assertion.evidence.slice(0, 240).replaceAll("\n", " ")}`,
        ),
    );
  const firstLines = firstLineReport(records.filter(isScorable));
  const report = `${table}\n\nMedians per cell. Pass is runs where every assertion passed, out of runs where no model request failed. Tasks is the median number of forks the run started, then how many runs ran \`task new\` and how many the harness forked when the user wrote mid-turn. Refusals are shell calls a refusal or an unknown flag answered, summed over the cell: the ones running a \`task\` command, then all. Quick answer is each run's wait for the answer to the mid-job question, in seconds.\n\n## Per model\n\n${bar}\n\n## Per kind\n\n${kinds}\n\n## Failed assertions\n\n${failures.join("\n") || "none"}\n\n## First lines\n\n${firstLines}\n`;
  fs.writeFileSync(path.join(outDir, "report.md"), report);
  fs.writeFileSync(
    path.join(outDir, "matrix.json"),
    JSON.stringify(records, null, 2),
  );
  process.stdout.write(`${report}\n${outDir}\n`);
}

/**
 * How the replies began, per model: the figures for each model, then every
 * run's first line verbatim, so filler and a guess stated before any check
 * can be read.
 */
function firstLineReport(records: RunRecord[]): string {
  const seconds = (ms?: number) =>
    ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}`;
  const groups = Object.entries(
    _.group(records, (record) => modelName(record.model)),
  ).toSorted(([a], [b]) => a.localeCompare(b));
  const rows = groups.map(([model, list = []]) => {
    const pick = (read: (record: RunRecord) => number | undefined) =>
      median(
        list.flatMap((record) => {
          const value = read(record);
          return value === undefined ? [] : [value];
        }),
      );
    const opened = list.flatMap((record) => {
      const first = record.metrics?.turnShapes?.[0]?.textBeforeTool;
      return first === undefined ? [] : [first];
    });
    const laterOpened = list.flatMap(
      (record) =>
        record.metrics?.turnShapes
          ?.slice(1)
          .flatMap((shape) =>
            shape.textBeforeTool === undefined ? [] : [shape.textBeforeTool],
          ) ?? [],
    );
    const noToolTurns = list.flatMap(
      (record) =>
        record.metrics?.turnShapes?.filter((shape) => shape.toolCalls === 0) ??
        [],
    );
    const toolTurns = list.flatMap(
      (record) =>
        record.metrics?.turnShapes?.filter((shape) => shape.toolCalls > 0) ??
        [],
    );
    const chatty = toolTurns.filter(
      (shape) => shape.textParts > CHATTY_MESSAGES,
    ).length;
    return `| ${model} | ${list.filter(passed).length}/${list.length} | ${seconds(pick((record) => record.metrics?.firstTextMs))} | ${seconds(_.max(list.map((record) => record.metrics?.firstTextMs ?? 0)) ?? undefined)} | ${opened.filter(Boolean).length}/${opened.length} | ${laterOpened.filter(Boolean).length}/${laterOpened.length} | ${chatty}/${toolTurns.length} (${toolTurns.length === 0 ? 0 : Math.round((chatty / toolTurns.length) * 100)}%) | ${median(toolTurns.map((shape) => shape.textParts)) ?? "-"} | ${median(list.map((record) => _.max((record.metrics?.turnShapes ?? []).map((shape) => shape.textParts)) ?? 0)) ?? "-"} | ${seconds(pick((record) => record.metrics?.doneMs))} | ${Math.round(pick((record) => record.treeTokens) ?? 0)} | ${noToolTurns.filter((shape) => shape.textParts > 1).length}/${noToolTurns.length} |`;
  });
  const chattyTurns = groups.flatMap(([key, list = []]) =>
    list
      .toSorted(
        (a, b) =>
          SLUGS.indexOf(a.slug) - SLUGS.indexOf(b.slug) || a.trial - b.trial,
      )
      .flatMap((record) =>
        (record.metrics?.turnShapes ?? []).flatMap((shape, at) =>
          shape.toolCalls > 0 && shape.textParts > CHATTY_MESSAGES
            ? [
                `- ${key}, ${record.slug} #${record.trial} turn ${at + 1} (${shape.textParts} messages, ${shape.toolCalls} tool calls)`,
                ...(shape.texts ?? [shape.firstText ?? ""]).map(
                  (text) => `  - ${JSON.stringify(text)}`,
                ),
              ]
            : [],
        ),
      ),
  );
  const lines = groups.map(([key, list = []]) => {
    const runs = list
      .toSorted(
        (a, b) =>
          SLUGS.indexOf(a.slug) - SLUGS.indexOf(b.slug) || a.trial - b.trial,
      )
      .map((record) => {
        const shapes = record.metrics?.turnShapes ?? [];
        const first = shapes[0];
        const order =
          first?.textBeforeTool === undefined
            ? "no tools"
            : first.textBeforeTool
              ? "text first"
              : "tool first";
        const later = shapes
          .slice(1)
          .map(
            (shape, at) =>
              `  - turn ${at + 2}${shape.toolCalls === 0 ? `, no tools, ${shape.textParts} text parts` : ""}: ${JSON.stringify(shape.firstText ?? "")}`,
          );
        return [
          `- ${record.slug} #${record.trial} (${seconds(record.metrics?.firstTextMs)}s, ${order}${first?.toolCalls === 0 && first.textParts > 1 ? `, ${first.textParts} text parts` : ""}): ${JSON.stringify(first?.firstText ?? "")}`,
          ...later,
        ].join("\n");
      });
    return `### ${key}\n\n${runs.join("\n")}`;
  });
  return [
    `| model | pass | median first text s | worst first text s | tool-using first turns with text before the first tool | same, later turns | tool-using turns with more than ${CHATTY_MESSAGES} visible messages | median visible messages per tool-using turn | median per-run max visible messages in a turn | median done s | median tokens | no-tool turns with more than one text part |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "Visible messages are the non-empty text parts of the chat's own replies to one typed message, each one a message the user sees.",
    "",
    `### Tool-using turns with more than ${CHATTY_MESSAGES} visible messages`,
    "",
    chattyTurns.join("\n") || "none",
    "",
    ...lines,
  ].join("\n");
}

if (subcommand === "summarize" && target) {
  summarize(path.resolve(target));
} else if (subcommand === "rescore" && target) {
  await rescore(path.resolve(target));
} else if (subcommand === "run") {
  await run();
} else if (subcommand === "plan-usage") {
  await planUsage();
} else if (subcommand === "openrouter-usage") {
  await openRouterUsage();
} else {
  process.stderr.write(
    "Usage: handoff-matrix.ts run --model <glm|plan-luna|plan-sol|or-luna|or-luna6|or-glm|or-haiku55|cf:id> [--model ...] [--repeat n] [--concurrency n] [--max-run-tokens n] [--cases guide,email] [--out dir]\n       handoff-matrix.ts summarize <dir>\n       handoff-matrix.ts rescore <dir>\n       handoff-matrix.ts plan-usage\n       handoff-matrix.ts openrouter-usage\n",
  );
  process.exit(1);
}
