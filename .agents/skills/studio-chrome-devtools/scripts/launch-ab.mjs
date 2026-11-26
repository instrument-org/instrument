#!/usr/bin/env node
// Times Studio's launch for two production builds, alternating launches of
// each against copies of one seeded fixture, so a launch change is measured
// rather than guessed. Every launch is held off screen (a driven instance),
// starts from the same warm state as the others of its build, and is read
// from its boot marks (`electron-main/lib/boot-timing.ts`) and the window's
// first contentful paint over CDP.
//
//   node launch-ab.mjs snapshot <name>                  # keep this checkout's apps/studio/out as <name>
//   node launch-ab.mjs --a <build> --b <build> [--runs 10] [--workspace documents]
//
// A build is a snapshot name, an `out` folder, a checkout whose apps/studio/out
// is built, or a git revision (built in a detached worktree of its own, cached
// by commit). Build with a preview name, so the launches register a scheme of
// their own and not the installed app's:
//
//   INSTRUMENT_PREVIEW_NAME=launchab pnpm --filter @instrument-org/studio build
//
// Flags: --runs per build (10), --warmup launches per build left out (1),
// --settle ms after the chat list is read before quitting (1000), --timeout
// ms per launch (60000), --no-cdp (marks only), --keep (keep the launch
// folders), --json <file> (every launch's readings).
//
// Prints each mark's median, quartiles and range per build, and the paired
// difference (B minus A) over launches taken side by side. Times are from
// spawning Electron, read from each log line's wall clock (millisecond
// precision). The order is A B B A, repeated, so drift on a busy machine
// falls on both builds.

import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  CHECKOUT_KEY,
  REPO_ROOT,
  sleep,
  STUDIO_DIR,
} from "./studio-app.mjs";

const CACHE_ROOT = path.join(
  process.env.LOCALAPPDATA ??
    (process.platform === "darwin"
      ? path.join(process.env.HOME, "Library", "Caches")
      : (process.env.XDG_CACHE_HOME ?? path.join(process.env.HOME, ".cache"))),
  "instrument-studio-drive",
  CHECKOUT_KEY,
  "launch-ab",
);
const SNAPSHOTS = path.join(CACHE_ROOT, "snapshots");
const REFS = path.join(CACHE_ROOT, "refs");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};
const has = (name) => argv.includes(name);

if (argv[0] === "snapshot") {
  snapshot(argv[1]);
  process.exit(0);
}

const runs = Number(flag("--runs", "10"));
const warmup = Number(flag("--warmup", "1"));
const settleMs = Number(flag("--settle", "1000"));
const timeoutMs = Number(flag("--timeout", "60000"));
const fixture = flag("--workspace", "documents");
const useCdp = !has("--no-cdp");
const jsonOut = flag("--json");
const builds = [
  { input: flag("--a"), label: "A" },
  { input: flag("--b"), label: "B" },
];
if (builds.some((build) => !build.input)) {
  console.error("launch-ab: pass --a <build> and --b <build>");
  process.exit(1);
}

const work = path.join(CACHE_ROOT, `run-${process.pid}`);
mkdirSync(work, { recursive: true });
const seeded = seed(fixture);
for (const build of builds) {
  build.appDir = appDirOf(build.input, build.label);
  build.userDataDir = path.join(work, `data-${build.label}`);
  cpSync(seeded, build.userDataDir, { recursive: true });
  build.launches = [];
}

// The launch under way, which an interrupted run quits rather than leave.
let running;
process.on("SIGINT", () => {
  if (running) {
    try {
      process.kill(-running.pid, "SIGKILL");
    } catch {
      running.kill("SIGKILL");
    }
  }
  process.exit(130);
});

let port = 49_600 + (process.pid % 200);
const order = [];
for (let i = 0; i < warmup; i += 1) {
  order.push(0, 1);
}
for (let i = 0; i < runs; i += 1) {
  order.push(...(i % 2 === 0 ? [0, 1] : [1, 0]));
}
let done = 0;
for (const index of order) {
  const build = builds[index];
  const isWarmup = build.launches.length < warmup;
  const reading = await launch(build, (port += 1));
  build.launches.push({ ...reading, warmup: isWarmup });
  done += 1;
  console.error(
    `${String(done).padStart(3)}/${order.length} ${build.label}${isWarmup ? " (warm-up)" : ""} ${summaryLine(reading)}`,
  );
}

report();
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      builds.map(({ input, label, launches }) => ({ input, label, launches })),
      undefined,
      1,
    ),
  );
}
if (!has("--keep")) {
  rmSync(work, { force: true, recursive: true });
}

// --- builds ------------------------------------------------------------

/** Keeps this checkout's built `apps/studio/out` under a name, as a clone. */
function snapshot(name) {
  if (!name) {
    console.error("launch-ab: snapshot <name>");
    process.exit(1);
  }
  const out = path.join(STUDIO_DIR, "out");
  checkBuilt(out);
  const dir = path.join(SNAPSHOTS, name);
  rmSync(dir, { force: true, recursive: true });
  mkdirSync(dir, { recursive: true });
  cloneTree(out, path.join(dir, "out"));
  console.log(`Kept ${out} as ${name}`);
}

/**
 * The folder Electron runs as the app: a checkout's apps/studio, or one
 * put together from a lone `out` with this checkout's dependencies and
 * resources beside it.
 */
function appDirOf(input, label) {
  const snap = path.join(SNAPSHOTS, input, "out");
  if (existsSync(snap)) {
    return assemble(snap, label);
  }
  const asPath = path.resolve(input);
  if (existsSync(path.join(asPath, "main", "index.js"))) {
    return assemble(asPath, label);
  }
  if (existsSync(path.join(asPath, "apps", "studio", "out"))) {
    checkBuilt(path.join(asPath, "apps", "studio", "out"));
    return path.join(asPath, "apps", "studio");
  }
  return buildRevision(input);
}

function assemble(out, label) {
  checkBuilt(out);
  const dir = path.join(work, `app-${label}`);
  mkdirSync(dir, { recursive: true });
  cloneTree(out, path.join(dir, "out"));
  writeFileSync(
    path.join(dir, "package.json"),
    readFileSync(path.join(STUDIO_DIR, "package.json")),
  );
  for (const name of ["node_modules", "resources", "build"]) {
    symlinkSync(path.join(STUDIO_DIR, name), path.join(dir, name));
  }
  return dir;
}

/** Builds a revision in a detached worktree of its own, once per commit. */
function buildRevision(revision) {
  let sha;
  try {
    sha = execFileSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    console.error(
      `launch-ab: ${revision} is no snapshot, built out folder, checkout or revision`,
    );
    process.exit(1);
  }
  const dir = path.join(REFS, sha.slice(0, 12));
  const studio = path.join(dir, "apps", "studio");
  if (existsSync(path.join(studio, "out", "main", "index.js"))) {
    return studio;
  }
  console.error(`launch-ab: building ${revision} (${sha.slice(0, 12)}) in ${dir}`);
  if (!existsSync(dir)) {
    execFileSync("git", ["worktree", "add", "--detach", dir, sha], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  }
  execFileSync(path.join(REPO_ROOT, ".claude", "hooks", "worktree-setup.sh"), [dir], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  execFileSync("pnpm", ["--filter", "@instrument-org/studio", "build"], {
    cwd: dir,
    env: { ...process.env, INSTRUMENT_PREVIEW_NAME: "launchab" },
    stdio: "inherit",
  });
  return studio;
}

/**
 * A build launched unpackaged registers its scheme with the system, so one
 * without a preview name would take the installed app's links.
 */
function checkBuilt(out) {
  const main = path.join(out, "main");
  if (!existsSync(path.join(main, "index.js"))) {
    console.error(`launch-ab: ${out} has no built main process`);
    process.exit(1);
  }
  const named = readdirSync(main).some(
    (file) =>
      file.endsWith(".js") &&
      /previewName: "[^"]+"/.test(readFileSync(path.join(main, file), "utf8")),
  );
  if (!named) {
    console.error(
      `launch-ab: ${out} was built without INSTRUMENT_PREVIEW_NAME, so it would answer the installed app's links. Rebuild with INSTRUMENT_PREVIEW_NAME=launchab.`,
    );
    process.exit(1);
  }
}

/** A copy-on-write clone where the volume makes them (APFS), else a copy. */
function cloneTree(from, to) {
  rmSync(to, { force: true, recursive: true });
  if (process.platform === "darwin") {
    execFileSync("cp", ["-cR", from, to]);
  } else {
    cpSync(from, to, { recursive: true });
  }
}

// --- the fixture -------------------------------------------------------

/** Seeds the fixture once per run, which each build then gets a copy of. */
function seed(name) {
  const dir = path.join(work, "seed");
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/seed-workspace.ts",
      "--out",
      dir,
      "--home",
      `${dir}-home`,
      "--fixture",
      name,
    ],
    {
      cwd: path.join(REPO_ROOT, "packages/workspace"),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (!output.includes("{")) {
    console.error(`launch-ab: the seeder printed no summary for ${name}`);
    process.exit(1);
  }
  return dir;
}

// --- one launch --------------------------------------------------------

/** Launches a build once, reads its marks and quits it. */
async function launch(build, debugPort) {
  const logFile = path.join(build.userDataDir, "logs", "main.log");
  const logStart = existsSync(logFile) ? statSync(logFile).size : 0;
  // The build's own Electron: a lone `out` folder's is this checkout's.
  const electron = path.join(
    build.appDir,
    "node_modules",
    "electron",
    "dist",
    ...(process.platform === "darwin"
      ? ["Electron.app", "Contents", "MacOS", "Electron"]
      : [process.platform === "win32" ? "electron.exe" : "electron"]),
  );
  const spawnedAt = Date.now();
  const child = spawn(
    electron,
    [".", ...(useCdp ? [`--remote-debugging-port=${debugPort}`] : [])],
    {
      cwd: build.appDir,
      detached: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        ELECTRON_USER_DATA_DIR: build.userDataDir,
        INSTRUMENT_DATA_HOME: `${build.userDataDir}-home`,
        INSTRUMENT_OUTPUT_FOLDER: `${build.userDataDir}-output`,
        INSTRUMENT_WORKSPACE: path.join(build.userDataDir, "workspace"),
        SKIP_ONBOARDING: "true",
        DISABLE_AUTO_UPDATE_POLLING: "true",
        // Holds its windows off screen, as studio-drive's are.
        STUDIO_DRIVE_PURPOSE: "launch timing",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  running = child;
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const reading = { marks: {} };
  const deadline = spawnedAt + timeoutMs;
  const paint = useCdp ? firstPaint(debugPort, spawnedAt, deadline) : undefined;
  try {
    while (Date.now() < deadline) {
      reading.marks = marksIn(readFrom(logFile, logStart), spawnedAt);
      if (reading.marks["window chat list read"] !== undefined) {
        break;
      }
      await sleep(100);
    }
    if (reading.marks["window chat list read"] === undefined) {
      reading.error = "no chat list read before the timeout";
    }
    if (paint) {
      Object.assign(reading.marks, await paint);
    }
    await sleep(settleMs);
  } finally {
    await quit(child);
    running = undefined;
  }
  if (reading.error) {
    reading.output = output.slice(-2000);
  }
  return reading;
}

function readFrom(file, start) {
  try {
    return readFileSync(file).subarray(start).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Every `(boot) <name> at <n>ms` line, by name, in ms from the spawn. A
 * window's id leaves its marks' names, the first window's standing. A mark
 * counts from the process's start, which the line logged soonest after its
 * point places on the wall clock (a mark from before the logger was up is
 * logged later than it happened); `process start` is that point.
 */
function marksIn(log, spawnedAt) {
  const lines = [];
  for (const line of log.split("\n")) {
    const match = /^\[([^\]]+)\] \[\w+\] \(boot\) (.+) at (\d+)ms$/.exec(line);
    if (match) {
      lines.push({
        at: Number(match[3]),
        loggedAt: Date.parse(match[1]),
        name: match[2].replace(/^window \S+ /, "window "),
      });
    }
  }
  if (lines.length === 0) {
    return {};
  }
  const startedAt = Math.min(...lines.map((line) => line.loggedAt - line.at));
  const marks = { "process start": startedAt - spawnedAt };
  for (const line of lines) {
    marks[line.name] ??= startedAt + line.at - spawnedAt;
  }
  return marks;
}

/** The app window's navigation and first contentful paint, from the spawn. */
async function firstPaint(debugPort, spawnedAt, deadline) {
  while (Date.now() < deadline) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      ).json();
      const page = targets.find(
        (target) =>
          target.type === "page" && /\/index\.html/.test(target.url),
      );
      if (page) {
        const paint = await readPaint(page.webSocketDebuggerUrl, deadline);
        if (paint) {
          return {
            "navigation start": Math.round(paint.timeOrigin - spawnedAt),
            "first contentful paint": Math.round(
              paint.timeOrigin + paint.fcp - spawnedAt,
            ),
          };
        }
      }
    } catch {
      // Not listening yet.
    }
    await sleep(25);
  }
  return {};
}

async function readPaint(url, deadline) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const mine = (id += 1);
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id === mine) {
          socket.removeEventListener("message", onMessage);
          resolve(message.result?.result?.value);
        }
      };
      socket.addEventListener("message", onMessage);
      socket.send(
        JSON.stringify({
          id: mine,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    });
  try {
    while (Date.now() < deadline) {
      const paint = await evaluate(
        `(() => { const fcp = performance.getEntriesByName("first-contentful-paint")[0]; return fcp ? { timeOrigin: performance.timeOrigin, fcp: fcp.startTime } : null; })()`,
      );
      if (paint) {
        return paint;
      }
      await sleep(50);
    }
  } finally {
    socket.close();
  }
  return undefined;
}

/** Quits the app as a person would, then makes sure nothing of it is left. */
async function quit(child) {
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i += 1) {
    await sleep(100);
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The group is gone.
  }
  // The next launch waits on a profile the last one still holds.
  await sleep(500);
}

// --- the report --------------------------------------------------------

function summaryLine(reading) {
  if (reading.error) {
    return `failed: ${reading.error}`;
  }
  return Object.entries(reading.marks)
    .sort(([, a], [, b]) => a - b)
    .map(([name, ms]) => `${name} ${ms}`)
    .join(", ");
}

function quantile(sorted, q) {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (at - low));
}

function stats(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    max: sorted.at(-1),
    median: quantile(sorted, 0.5),
    min: sorted[0],
    n: sorted.length,
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
  };
}

function report() {
  const measured = builds.map((build) =>
    build.launches.filter((run) => !run.warmup && !run.error),
  );
  const names = new Set(measured.flat().flatMap((run) => Object.keys(run.marks)));
  const rows = [...names]
    .map((name) => {
      const [a, b] = measured.map((launches) =>
        launches.map((run) => run.marks[name]).filter((ms) => ms !== undefined),
      );
      // Pairs are the nth launch of each build, taken side by side; a pair
      // where either failed is left out, never shifted onto the next.
      const [paired, other] = builds.map((build) =>
        build.launches.filter((run) => !run.warmup),
      );
      const pairs = [];
      for (let i = 0; i < Math.min(paired.length, other.length); i += 1) {
        const [x, y] = [paired[i].marks[name], other[i].marks[name]];
        if (!paired[i].error && !other[i].error && x !== undefined && y !== undefined) {
          pairs.push(y - x);
        }
      }
      return { a: stats(a), b: stats(b), diff: stats(pairs), lower: pairs.filter((d) => d < 0).length, name, pairs: pairs.length };
    })
    .sort((x, y) => (x.a.median || x.b.median) - (y.a.median || y.b.median));

  const cell = (s) =>
    s.n === 0 ? "-" : `${s.median} [${s.p25}..${s.p75}] (${s.min}..${s.max})`;
  console.log(`\nA: ${builds[0].input}\nB: ${builds[1].input}`);
  console.log(
    `${runs} launches each after ${warmup} warm-up, ${fixture} fixture, ms from spawn: median [quartiles] (range)\n`,
  );
  console.log("| mark | A | B | B - A paired | B lower |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(
      `| ${row.name} | ${cell(row.a)} | ${cell(row.b)} | ${cell(row.diff)} | ${row.lower}/${row.pairs} |`,
    );
  }
  const failed = builds.flatMap((build) =>
    build.launches.filter((run) => run.error).map((run) => `${build.label}: ${run.error}`),
  );
  if (failed.length > 0) {
    console.log(`\n${failed.length} launches failed:\n${failed.join("\n")}`);
  }
}
