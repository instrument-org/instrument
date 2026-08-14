// Drive the running Studio dev app over CDP.
//
// Talks to the debug port directly rather than through the chrome-devtools CLI
// daemon: no socket to go stale when the app restarts, no page ids to be
// invalidated by a reconnect, and a screenshot clip that crops server-side so
// nothing has to redo the device-pixel math. The CLI covers the input side
// perfectly well (it has press_key and type_text); this is about owning the
// lifecycle, not about what it can dispatch.
//
//   node studio-drive.mjs boot          # start an instance this session owns
//   node studio-drive.mjs state
//   node studio-drive.mjs goto /release-notes
//   node studio-drive.mjs click --text "All file types"
//   node studio-drive.mjs press ?
//   node studio-drive.mjs shot out.png --selector '[role=dialog]'
//   node studio-drive.mjs wait 'document.querySelectorAll("webview").length > 0'
//   node studio-drive.mjs rpc workspace.task.list '{}'
//   node studio-drive.mjs wait --idle --task <id>
//   node studio-drive.mjs run sequence.mjs
//   node studio-drive.mjs stop
//
// One command is one process and one connection, which is the right shape for a
// single question and the wrong one for a sequence: the connection costs 3ms and
// the primitive behind it costs under 30ms, while deciding the next command
// costs seconds. `run` is the answer to that -- it hands a script the app from
// studio-app.mjs, so a sequence pays for one decision instead of one per step.
// Reach for it as soon as you know two things you want to do.
//
// Route/modal commands go through `window.__studioDrive`, the dev-only handle
// the renderer attaches (client/lib/studio-drive.ts). `rpc` goes through
// `window.__studioDebug`, the Developer-Mode-gated bridge onto the real oRPC
// client (client/lib/debug-rpc-bridge.ts). Everything else is CDP.
//
// Reach for `rpc` before the DOM whenever the question is about state rather
// than about pixels: whether a turn is still running, what a task holds, what a
// route would return. Reading it out of `document.body.innerText` is a guess
// about rendering; the route is the thing the UI itself renders from.
//
// `boot` starts an instance on a port derived from this checkout's path, and
// every other command reads the record it writes. Two things it deliberately
// does not do:
//
// - Fall back to the conventional 48160. That one is almost always a window a
//   person is using: driving it means their clicks fight yours, their quit ends
//   your run, and your navigation moves the app out from under them.
// - Scan for whatever port happens to be free. Two checkouts booting at once
//   can both see the same port free and both spawn; the one that loses the bind
//   would then connect to the winner's window and drive the wrong app. A port
//   per checkout means they never contend in the first place.
//
// Pass `--port` to target a specific instance on purpose.
//
// `--workspace <fixture>` boots against a disposable workspace built from a
// committed fixture (fixtures/workspaces/) instead of the shared dev
// application-data directory, so a run does not depend on what the developer
// happened to do last. Add `--fresh` to rebuild it first. The flag belongs on
// every command of that run, not just `boot`: it selects both the port and the
// instance record, so two workspaces from one checkout never collide.
//
//   node studio-drive.mjs boot --workspace documents
//   node studio-drive.mjs shot task.png --workspace documents

// The repo does not lint `.agents`, so these only ever fire when a changed-file
// pass runs without ignores. None is worth reshaping this file for:
// `sort-modules` would order the declarations alphabetically and leave the
// section banners labeling whatever landed under them; the cache-location
// variables belong to a standalone CLI rather than a turbo task; and `dir` is
// how a path is named everywhere this script reaches, from `taskDir` through
// `workspaceConfig.tasksDir` to the `ELECTRON_USER_DATA_DIR` it sets.
/* eslint-disable perfectionist/sort-modules */
/* eslint-disable turbo/no-undeclared-env-vars */
/* eslint-disable unicorn/prevent-abbreviations */

import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CHECKOUT_KEY,
  checkoutPort,
  connect,
  DriveError,
  evaluate,
  fail,
  isAlive,
  isPortLive,
  openCdp,
  readSession,
  REPO_ROOT,
  resolvePort,
  sessionFile,
  sleep,
  STUDIO_DIR,
  waitForDriveHandle,
  writeSession,
} from "./studio-app.mjs";

const COMMANDS = new Set([
  "boot",
  "click",
  "eval",
  "goto",
  "modal",
  "port",
  "press",
  "rpc",
  "run",
  "shot",
  "snapshot",
  "state",
  "stop",
  "type",
  "wait",
]);

// A seeded workspace is rebuilt from its fixture in seconds, so it is cache and
// not data: never in the repo, and never in the shared application-data
// directory where it would mix with someone's real tasks.
const WORKSPACE_CACHE_ROOT = path.join(
  process.env.LOCALAPPDATA ??
    (process.platform === "darwin"
      ? path.join(homedir(), "Library", "Caches")
      : (process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"))),
  "instrument-studio-drive",
  CHECKOUT_KEY,
);

// Workspaces nobody has driven in this long are dropped at the next boot,
// because nobody runs a clean command. Losing one costs a reseed.
const WORKSPACE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// Installed dependencies inside a task are the only part that grows -- to
// hundreds of megabytes once an agent has run an install in one -- and the only
// part deleting does not invalidate. So they go sooner than the workspace does.
const WORK_ARTIFACT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const WORK_ARTIFACT_NAMES = new Set([".venv", "node_modules"]);

// Read off the raw argv rather than the parsed tail: which instance a command
// talks to has to be settled before anything reads a session record.
const WORKSPACE = flag(process.argv, "--workspace");

// --- seeded workspaces -------------------------------------------------

/**
 * Build (or reuse) the workspace this boot will run against, and hand back the
 * directory to point `ELECTRON_USER_DATA_DIR` at. The seeder is idempotent and
 * fast, so calling it on every boot is cheaper than reasoning about whether the
 * fixture has changed since last time.
 */
function prepareWorkspace(name, { fresh }) {
  reapStaleWorkspaces();

  const userDataDir = path.join(WORKSPACE_CACHE_ROOT, name);
  mkdirSync(WORKSPACE_CACHE_ROOT, { recursive: true });

  let output;
  try {
    output = execFileSync(
      "pnpm",
      [
        "workspace:seed",
        "--out",
        userDataDir,
        "--fixture",
        name,
        ...(fresh ? ["--fresh"] : []),
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
  } catch {
    fail(`Could not seed workspace "${name}". See the seeder output above.`);
  }

  // The seeder prints its summary last; pnpm's own banner precedes it.
  const start = output.indexOf("{");
  if (start === -1) {
    fail(`The seeder printed no summary for "${name}":\n${output}`);
  }
  const result = JSON.parse(output.slice(start));

  // Reaping goes by mtime, so record that this workspace was used even when the
  // seeder had nothing to do and the app writes nothing before it is killed.
  utimesSync(userDataDir, new Date(), new Date());

  reapWorkArtifacts(path.join(userDataDir, "workspace", "tasks"));

  return { tasks: result.tasks, userDataDir };
}

function reapStaleWorkspaces() {
  let entries;
  try {
    entries = readdirSync(WORKSPACE_CACHE_ROOT, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(WORKSPACE_CACHE_ROOT, entry.name);
    try {
      if (Date.now() - statSync(dir).mtimeMs > WORKSPACE_MAX_AGE_MS) {
        rmSync(dir, { force: true, recursive: true });
      }
    } catch {
      // Another boot in this checkout reaped it between the listing and the
      // stat. Housekeeping must never be what ends a run.
    }
  }
}

/**
 * Drops installed dependencies left inside tasks by a live agent run. A replay
 * never creates these, so a workspace only used for driving stays in the low
 * megabytes and this finds nothing.
 */
function reapWorkArtifacts(tasksDir) {
  let tasks;
  try {
    tasks = readdirSync(tasksDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const task of tasks) {
    if (!task.isDirectory()) {
      continue;
    }
    for (const name of WORK_ARTIFACT_NAMES) {
      const dir = path.join(tasksDir, task.name, "work", name);
      try {
        if (Date.now() - statSync(dir).mtimeMs > WORK_ARTIFACT_MAX_AGE_MS) {
          rmSync(dir, { force: true, recursive: true });
        }
      } catch {
        // Not there, which is the normal case.
      }
    }
  }
}

// --- lifecycle ---------------------------------------------------------

async function cmdBoot(explicitPort, { fresh }) {
  const existing = readSession(WORKSPACE);
  if (existing && (await isPortLive(existing.port))) {
    if (fresh) {
      fail(
        `--fresh rebuilds the workspace on disk and the instance on port ${existing.port} has it open.\n` +
          `Run \`studio-drive.mjs stop${WORKSPACE ? ` --workspace ${WORKSPACE}` : ""}\` first.`,
      );
    }
    return { ...existing, reused: true };
  }

  const port = explicitPort ? Number(explicitPort) : checkoutPort(WORKSPACE);
  // Refuse rather than scanning for the next free port. Scanning is what makes
  // this dangerous: two checkouts booting at once can both see a port free,
  // both spawn, and the one that loses the bind then connects to the winner's
  // window and drives the wrong app believing it is its own.
  //
  // Checked before the workspace is built so a boot that cannot proceed does
  // not pay for a seed first.
  if (await isPortLive(port)) {
    fail(
      `Port ${port} belongs to this checkout but something is already on it.\n` +
        `Stop it (\`studio-drive.mjs stop\`, or quit that window) or pass --port to target it deliberately.`,
    );
  }

  const workspace = WORKSPACE
    ? prepareWorkspace(WORKSPACE, { fresh })
    : undefined;

  const file = sessionFile(WORKSPACE);
  mkdirSync(path.dirname(file), { recursive: true });
  const logFile = file.replace(/\.json$/, ".log");
  const log = openSync(logFile, "a");

  // What `pnpm dev` expands to, minus the two node processes that expansion
  // costs: `pnpm run` plus `cross-env` add about half a second to every boot
  // and nothing else. Keep this in step with the `dev` script in
  // apps/studio/package.json, which is the thing it is standing in for.
  //
  // The bin shim rather than the .js entry, because the shim is what exports
  // the NODE_PATH into .pnpm that the config's `require.resolve` of
  // ffmpeg-static and friends resolves through.
  const child = spawn(
    path.join(STUDIO_DIR, "node_modules/.bin/electron-vite"),
    ["dev", "--sourcemap"],
    {
      cwd: STUDIO_DIR,
      detached: true,
      env: {
        ...process.env,
        // Set by some editor integrations; leaving it on makes Electron run as
        // plain Node and exit without ever opening a window.
        ELECTRON_RUN_AS_NODE: undefined,
        NODE_OPTIONS: "--enable-source-maps",
        // `pnpm run` puts these in front of PATH, and a booted app inherits it
        // all the way down to the commands an agent runs. Kept identical so a
        // driven instance resolves binaries the way a hand-started one does.
        PATH: [
          path.join(STUDIO_DIR, "node_modules/.bin"),
          path.join(REPO_ROOT, "node_modules/.bin"),
          process.env.PATH,
        ].join(path.delimiter),
        REMOTE_DEBUGGING_PORT: String(port),
        // A seeded workspace has no provider credentials and must not: they
        // cannot be committed. Without this the app opens the onboarding window
        // and never reveals the main one, which reads as a hang.
        ...(workspace && {
          ELECTRON_USER_DATA_DIR: workspace.userDataDir,
          SKIP_ONBOARDING: "true",
        }),
      },
      stdio: ["ignore", log, log],
    },
  );
  child.unref();

  const session = {
    logFile,
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
    ...(workspace && { tasks: workspace.tasks, workspace: WORKSPACE }),
  };
  writeSession(WORKSPACE, session);

  // Ready means the renderer has attached its handle, not that the port
  // answers: the debug endpoint is up well before the app can be driven.
  const deadline = Date.now() + 180_000;
  for (;;) {
    // If the process we started is gone, whatever answers on this port is not
    // ours -- most likely we lost the bind and something else took it.
    if (!isAlive(child.pid)) {
      fail(`Studio exited during startup. See ${logFile}`);
    }
    if (await isPortLive(port)) {
      try {
        const cdp = await openCdp(`http://127.0.0.1:${port}`);
        try {
          await waitForDriveHandle(cdp);
          // Seeded here so the first command after a boot compares against this
          // load rather than reporting it as a reload.
          const load = await evaluate(
            cdp,
            "window.__studioDrive?.load?.() ?? null",
          );
          const booted = { ...session, ...(load && { load }) };
          writeSession(WORKSPACE, booted);
          return { ...booted, reused: false };
        } finally {
          cdp.close();
        }
      } catch {
        // Renderer not serving a target yet; keep waiting.
      }
    }
    if (Date.now() > deadline) {
      fail(`Studio did not become drivable within 180s. See ${logFile}`);
    }
    // Polled tightly rather than on a lazy interval. The debug port comes up
    // partway through a boot that only takes a few seconds, so a coarse
    // interval spends most of its last sleep with the app already sitting
    // there waiting to be driven -- and that shows up as boot time in every
    // measurement anyone takes through this script.
    await sleep(100);
  }
}

function cmdStop() {
  const session = readSession(WORKSPACE);
  if (!session) {
    return { stopped: false };
  }
  try {
    // The dev server is the process group leader; the Electron app is its child.
    process.kill(-session.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  rmSync(sessionFile(WORKSPACE), { force: true });
  return { port: session.port, stopped: true };
}

// --- running a sequence ------------------------------------------------

/**
 * Run a script against one held connection.
 *
 * The script default-exports a function taking `(app, args)`. It gets the whole
 * of studio-app.mjs through `app`, and anything that module has no verb for
 * through `app.cdp`, so a sequence is limited by what CDP can do rather than by
 * what this file has been taught to parse.
 *
 * The trace comes back either way. A script that stops at step 7 reports the
 * six that worked and why the seventh did not, which is the whole reason to
 * prefer this over a shell chain: `&&` leaves the caller to work out how far it
 * got from whatever the last command happened to print.
 */
async function cmdRun(file, rawArgs) {
  let source = file;
  if (file === "-" || file === undefined) {
    const stdin = await readStdin();
    if (!stdin.trim()) {
      fail(
        `Usage: run <script.mjs> [--args '<json>'], or run - with the script on stdin.\n\n` +
          `  export default async (app, args) => {\n` +
          `    await app.goto("/skills");\n` +
          `    await app.click("New skill");\n` +
          `    await app.waitFor('document.querySelector("[role=dialog]")');\n` +
          `    return app.state();\n` +
          `  };`,
      );
    }
    // Node cannot import a module from a stream, and a data: URL cannot resolve
    // a relative import back to this directory. A file next to the script it
    // came from keeps `import "./studio-app.mjs"` working inside it.
    source = path.join(
      tmpdir(),
      "instrument-studio-drive",
      `sequence-${process.pid}.mjs`,
    );
    mkdirSync(path.dirname(source), { recursive: true });
    writeFileSync(source, stdin);
  }

  let args;
  if (rawArgs !== undefined) {
    try {
      args = JSON.parse(rawArgs);
    } catch (error) {
      fail(`--args is not JSON: ${error.message}`);
    }
  }

  const module = await import(pathToFileURL(path.resolve(source)).href);
  const run = module.default ?? module.run;
  if (typeof run !== "function") {
    fail(
      `${source} must default-export a function taking (app, args). Got ${typeof run}.`,
    );
  }

  const app = await connect({
    allowReload: process.argv.includes("--allow-reload"),
    port: flag(process.argv, "--port"),
    workspace: WORKSPACE,
  });

  try {
    const value = await run(app, args);
    return {
      ok: true,
      steps: app.trace.length,
      trace: app.trace,
      ...(value !== undefined && { value }),
    };
  } catch (error) {
    // Reported as the command's result rather than thrown, so the trace of what
    // did happen survives. The non-zero exit still marks it as a failure.
    process.exitCode = 1;
    return {
      error: error.message,
      ok: false,
      steps: app.trace.length,
      stoppedAt: app.trace.at(-1)?.label,
      trace: app.trace,
    };
  } finally {
    app.close();
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      resolve(data);
    });
    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}

// --- plumbing ----------------------------------------------------------

function flag(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function report(result) {
  // A tree is the one result worth more as text than as a field: JSON would
  // render it as one line of `\n`, which is the shape it is here to avoid.
  if (result && typeof result === "object" && "tree" in result) {
    const { tree, ...rest } = result;
    console.log(JSON.stringify(rest, undefined, 2));
    console.log(tree);
    return;
  }
  console.log(JSON.stringify(result, undefined, 2));
}

const [command, ...argv] = process.argv.slice(2);
const positional = argv.filter(
  (a, index) =>
    !a.startsWith("--") && !(index > 0 && argv[index - 1].startsWith("--")),
);

try {
  // Checked before anything talks to an instance, so a typo says so rather than
  // reporting that nothing is running.
  if (!COMMANDS.has(command)) {
    fail(
      `Unknown command ${JSON.stringify(command)}.\n` +
        `Commands: ${[...COMMANDS].join(", ")}`,
    );
  }
  // Lifecycle commands manage the instance rather than talk to one.
  switch (command) {
    case "boot": {
      report(
        await cmdBoot(flag(argv, "--port"), {
          fresh: argv.includes("--fresh"),
        }),
      );

      break;
    }
    case "port": {
      // The bare number rather than a JSON field: this exists so another script
      // can point itself at this checkout's instance in one substitution, and
      // there is one derivation of that port rather than a copy per tool.
      console.log(
        String(
          await resolvePort({
            port: flag(argv, "--port"),
            workspace: WORKSPACE,
          }),
        ),
      );

      break;
    }
    case "run": {
      report(await cmdRun(positional[0], flag(argv, "--args")));

      break;
    }
    case "stop": {
      report(cmdStop());

      break;
    }
    default: {
      report(await runAgainstInstance());
    }
  }
} catch (error) {
  console.error(`studio-drive: ${error.message}`);
  if (!(error instanceof DriveError)) {
    console.error(error.stack);
  }
  process.exitCode = 1;
}

/**
 * Says so when the app has reloaded since the last command ran against it.
 *
 * Any write in the checkout relaunches the main process or hot-updates the
 * renderer, so an instance can be reset by another agent, a commit, or a
 * formatter mid-run. Unreported, that arrives as a click that stopped working
 * or a screenshot of a route nobody left, and the time goes into debugging the
 * app rather than the harness.
 *
 * On stderr, so it cannot be mistaken for the command's own output. Only
 * tracked for an instance this script booted, since the last-seen values live
 * in its session record, and concurrent runs share that record: the report goes
 * to whichever command reads it first.
 *
 * A sequence under `run` does not need this: it holds one connection, so it
 * notices a reload landing between its own steps and stops there.
 */
async function reportReload(app) {
  const session = readSession(WORKSPACE);
  if (!session) {
    return;
  }
  // Absent on a packaged build, and mid-reload before the renderer re-attaches
  // it. Neither is worth a message of its own here.
  const load = await evaluate(
    app.cdp,
    "window.__studioDrive?.load?.() ?? null",
  );
  if (!load) {
    return;
  }

  const seen = session.load;
  if (seen && load.id !== seen.id) {
    console.error(
      "studio-drive: the app reloaded since the last command. Whatever was " +
        "navigated to, opened, or typed is gone; a result that disagrees with " +
        "the last one may be reporting that rather than the change.",
    );
  } else if (seen && load.updates > seen.updates) {
    const count = load.updates - seen.updates;
    console.error(
      `studio-drive: ${count} hot update${count === 1 ? "" : "s"} landed since ` +
        "the last command. Component state under them was rebuilt.",
    );
  }

  writeSession(WORKSPACE, { ...session, load });
}

async function runAgainstInstance() {
  // A single command reports a reload rather than refusing over it: the caller
  // is standing right there, and the next command re-establishes whatever was
  // lost. `run` takes the stricter default, because a sequence cannot.
  const app = await connect({
    allowReload: true,
    port: flag(argv, "--port"),
    workspace: WORKSPACE,
  });
  try {
    await reportReload(app);
    return await dispatch(app);
  } finally {
    app.close();
  }
}

async function dispatch(app) {
  switch (command) {
    case "click": {
      return app.click(
        flag(argv, "--selector")
          ? { selector: flag(argv, "--selector") }
          : (flag(argv, "--text") ?? positional[0]),
      );
    }
    case "eval": {
      return app.eval(positional.join(" "));
    }
    case "goto": {
      return app.goto(positional[0], { newTab: argv.includes("--new-tab") });
    }
    case "modal": {
      return cmdModal(app, argv[0]);
    }
    case "press": {
      return app.press(positional[0]);
    }
    case "rpc": {
      return cmdRpc(app, positional[0], positional[1]);
    }
    case "shot": {
      return app.shot(positional[0], {
        pad: Number(flag(argv, "--pad", "0")),
        selector: flag(argv, "--selector"),
        text: flag(argv, "--text"),
      });
    }
    case "snapshot": {
      return app.snapshot({
        depth: Number(flag(argv, "--depth", "12")),
        selector: flag(argv, "--selector") ?? positional[0],
      });
    }
    case "state": {
      return app.state();
    }
    case "type": {
      return app.type(positional.join(" "));
    }
    case "wait": {
      return argv.includes("--idle")
        ? app.waitForIdle({
            settleMs: Number(flag(argv, "--settle", "2000")),
            taskId: await resolveTaskId(app, flag(argv, "--task")),
            // A turn is minutes of work, not the seconds a DOM predicate waits.
            timeout: Number(flag(argv, "--timeout", "600000")),
          })
        : app.waitFor(positional.join(" "), {
            timeout: Number(flag(argv, "--timeout", "15000")),
          });
    }
  }
}

async function cmdModal(app, name) {
  if (name === "--close") {
    return app.closeModal();
  }
  // Checked against the openers the renderer actually has, rather than a copy
  // kept here that would go stale the first time one is added. An unchecked
  // name reaches the app as `MODAL_OPENERS[name] is not a function`, which
  // reads like a bug in the app and is not one.
  await waitForDriveHandle(app.cdp);
  const names = await evaluate(app.cdp, "window.__studioDrive.modals()");
  if (name === undefined || !names.includes(name)) {
    fail(
      `${name === undefined ? "Which modal?" : `No modal named ${JSON.stringify(name)}.`}\n` +
        `Names: ${names.join(", ")}\n` +
        `Close the open one with \`modal --close\`.`,
    );
  }
  return app.openModal(name);
}

async function cmdRpc(app, route, rawInput) {
  if (!route) {
    fail(
      `Usage: rpc <route> [json]\n` +
        `  rpc workspace.task.list '{}'\n` +
        `  rpc workspace.task.agentStatus.byIds '{"ids":["<task-id>"]}'`,
    );
  }

  let input;
  if (rawInput !== undefined) {
    try {
      input = JSON.parse(rawInput);
    } catch (error) {
      fail(
        `Input is not JSON: ${error.message}\n` +
          `Quote it as one shell argument: rpc ${route} '{"id":"..."}'`,
      );
    }
  }

  return app.rpc(route, input);
}

/** The task named on the command line, or the one the active tab is showing. */
async function resolveTaskId(app, explicit) {
  if (explicit) {
    return explicit;
  }
  // Reading the active tab needs the dev-only handle, though the wait itself
  // does not. Say so here rather than spending the handle's timeout to report
  // a missing dev build, which is not what a packaged build is missing.
  if (!(await evaluate(app.cdp, "Boolean(window.__studioDrive)"))) {
    fail(
      "Pass --task. Taking the task from the active tab needs the dev-only handle, " +
        "which a packaged build omits; the wait itself does not.",
    );
  }
  const { path: routePath } = await evaluate(
    app.cdp,
    "window.__studioDrive.state()",
  );
  const match = /^\/tasks\/([^/]+)/.exec(routePath ?? "");
  if (!match) {
    fail(
      `No --task, and the active tab is not a task (path: ${routePath ?? "none"}).`,
    );
  }
  return match[1];
}

/* eslint-enable perfectionist/sort-modules */
/* eslint-enable turbo/no-undeclared-env-vars */
/* eslint-enable unicorn/prevent-abbreviations */
