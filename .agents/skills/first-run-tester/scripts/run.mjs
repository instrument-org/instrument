#!/usr/bin/env node
// First-run tester: puts a model in front of a first launch of Instrument as
// a brand-new person, with a screen, a mouse and a keyboard, and collects
// what it says out loud.
//
//   node run.mjs preflight --checkout <studio checkout>
//   node run.mjs boot   --checkout <studio checkout> [--scenario returning-user|new]
//                       [--account <account file>] [--api <url>]
//   node run.mjs tester --checkout <studio checkout> --persona personas/<file>.md --name <run>
//                       [--stand-in <account file>] [--first-launch-account <account file>]
//                       [--max-actions 40] [--max-minutes 25] [--budget 25] [--go]
//   node run.mjs report <run name or folder>
//   node run.mjs stop   --checkout <studio checkout>
//
// Every command takes --work <folder> (default ~/.instrument-first-run-tester),
// which holds what a run makes and nothing the repo should keep: sandbox/ (the
// stand-in home, temp folder, profile and the copy of the account the app
// signs in with), runs/<name>/, and bin/onscreen, built from lib/onscreen.swift.
//
// `tester` prints the exact command and what the tester will see, and stops.
// It starts the model only with --go, which is for after the run's thesis and
// mechanism have been approved.
//
// The app under test is a dev build booted off screen by the checkout's own
// studio-drive (`--scenario new`: a first launch with no workspace). The
// tester reaches it only through lib/mcp-server.mjs.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { allowProgramsUnderOuterSandbox } from "./lib/prepare.mjs";
import { openScreen } from "./lib/screen.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const command = argv.shift();
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv.splice(at, 2)[1];
};
const has = (name) => {
  const at = argv.indexOf(name);
  if (at === -1) {
    return false;
  }
  argv.splice(at, 1);
  return true;
};

const WORK = path.resolve(
  flag("--work", path.join(os.homedir(), ".instrument-first-run-tester")),
);
const checkoutFlag = flag("--checkout");
if (!checkoutFlag && !["report"].includes(command)) {
  throw new Error("Name the Studio checkout under test with --checkout.");
}
const CHECKOUT = path.resolve(checkoutFlag ?? ".");
const DRIVE = path.join(
  CHECKOUT,
  ".agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs",
);
const SCENARIO = flag("--scenario", "returning-user");
// Everything the app under test may write, and all of this user's files it
// may read: a stand-in home folder, a temp folder, and the account file.
const SANDBOX = path.join(WORK, "sandbox");
// The stand-in home, seeded from homes/<name>/ on first use.
const HOME_NAME = flag("--home", SCENARIO === "new" ? "first-launch" : SCENARIO);
const SANDBOX_HOME = path.join(SANDBOX, "home", HOME_NAME);
const RUNS = path.join(WORK, "runs");
// The same home and temp folder for every studio-drive command, so each one
// finds the instance record and the cache the boot made under them.
const DRIVE_ENV = { HOME: SANDBOX_HOME, TMPDIR: `${path.join(SANDBOX, "tmp")}/` };
const INSPECT_PORT = flag("--inspect", "9377");
const MODEL = flag("--model", "claude-opus-5-5");
// The developer strip along the bottom of a dev build's window, which a
// released build does not have. Cut from every screenshot.
const CROP_BOTTOM = flag("--crop-bottom", "0");

const drive = (args) =>
  execFileSync(process.execPath, [DRIVE, ...args, "--scenario", SCENARIO], {
    cwd: CHECKOUT,
    encoding: "utf8",
    env: { ...process.env, ...DRIVE_ENV },
  });

/**
 * The Seatbelt profile the whole boot runs under, dev server and app alike,
 * so every process the app starts inherits it. Writes are refused everywhere
 * but the sandbox folder and the checkout; reads are refused under /Users and
 * /Volumes but for those two and the toolchain; nothing may ask the system to
 * open a file or an app, or send another app an Apple event.
 */
function writeProfile() {
  const real = os.userInfo().homedir;
  const ancestors = new Set();
  for (const leaf of [SANDBOX, CHECKOUT, path.join(real, "Library/pnpm")]) {
    for (let dir = path.dirname(leaf); dir !== "/"; dir = path.dirname(dir)) {
      ancestors.add(dir);
    }
  }
  const q = (value) => JSON.stringify(value);
  const profile = `(version 1)
(allow default)
(deny lsopen)
(deny appleevent-send)
; No privacy prompt (contacts, calendars, microphone, screen) can be raised.
(deny mach-lookup (global-name "com.apple.tccd") (global-name "com.apple.tccd.system"))
(deny file-write*)
(allow file-write*
  (subpath ${q(SANDBOX)})
  (subpath ${q(CHECKOUT)})
  ; pnpm keeps its engine and global state under PNPM_HOME, which the boot
  ; points inside the sandbox; only its lock folders are in the shared /tmp.
  (regex #"^/private/tmp/pnpm-(dir|store-operation)-locks-${os.userInfo().uid}")
  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper")
  (regex #"^/dev/tty") (regex #"^/dev/fd/"))
; No reaching a socket of anything else on this Mac (an SSH agent, another
; app's control socket, other Instrument instances' browser sockets): only
; the sandbox's own, and the system's under /var/run.
(deny network-outbound
  (remote unix-socket (path-regex #"^/private/tmp/"))
  (remote unix-socket (path-regex #"^/Users/"))
  (remote unix-socket (path-regex #"^/private/var/folders/")))
(allow network-outbound
  (remote unix-socket (subpath ${q(SANDBOX)}))
  (remote unix-socket (subpath ${q(CHECKOUT)})))
(deny file-read* (subpath "/Users") (subpath "/Volumes"))
(allow file-read*
  (subpath ${q(SANDBOX)})
  (subpath ${q(CHECKOUT)})
  (subpath ${q(path.join(real, "Library/pnpm"))})
  (subpath ${q(path.join(real, "Library/Keychains"))}))
(allow file-read-metadata
${[...ancestors].map((dir) => `  (literal ${q(dir)})`).join("\n")})
`;
  const file = path.join(SANDBOX, "profile.sb");
  writeFileSync(file, profile);
  return file;
}

function freeGb() {
  const line = execFileSync("df", ["-g", "/System/Volumes/Data"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .pop();
  return Number(line.split(/\s+/)[3]);
}

function preflight() {
  const checks = {
    checkout: CHECKOUT,
    checkoutHead: execFileSync("git", ["describe", "--tags", "--always"], {
      cwd: CHECKOUT,
      encoding: "utf8",
    }).trim(),
    claude: spawnSync("claude", ["--version"], { encoding: "utf8" }).stdout?.trim(),
    freeGb: freeGb(),
    node: process.version,
  };
  if (checks.freeGb < 15) {
    throw new Error(`Only ${checks.freeGb} GB free; a boot needs 15.`);
  }
  return checks;
}

async function boot() {
  preflight();
  const api = flag("--api");
  const account = flag("--account");
  mkdirSync(path.join(SANDBOX, "tmp"), { recursive: true });
  const seed = path.join(HERE, "homes", HOME_NAME);
  if (!existsSync(SANDBOX_HOME) && existsSync(seed)) {
    cpSync(seed, SANDBOX_HOME, { recursive: true });
  }
  // The app reads the account from inside the sandbox, the only place it may.
  const accountCopy = path.join(SANDBOX, "operator", "account.json");
  if (account) {
    mkdirSync(path.dirname(accountCopy), { recursive: true, mode: 0o700 });
    copyFileSync(path.resolve(account), accountCopy);
    chmodSync(accountCopy, 0o600);
  }
  const out = execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-f",
      writeProfile(),
      process.execPath,
      DRIVE,
      "boot",
      "--purpose",
      "first run",
      "--inspect",
      INSPECT_PORT,
      "--scenario",
      SCENARIO,
      ...(account ? ["--account", accountCopy] : []),
    ],
    {
      cwd: CHECKOUT,
      encoding: "utf8",
      env: {
        // Only what a boot needs from this shell: nothing of its tokens,
        // agent sockets or session ids reaches the app.
        ...Object.fromEntries(
          ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME", "SHELL", "TERM", "TZ"]
            .filter((name) => process.env[name] !== undefined)
            .map((name) => [name, process.env[name]]),
        ),
        ...DRIVE_ENV,
        // The notifications step's Allow answers itself rather than putting
        // macOS's prompt on the screen of the person at this Mac, and its
        // test notification counts as clicked, since the tester cannot reach
        // a real one (the guard records it instead of posting it).
        INSTRUMENT_NOTIFICATION_ANSWER: "clicked",
        // Chromium cannot start its own helper sandbox inside this profile,
        // so its helpers run under the profile alone (electron-vite reads it).
        NO_SANDBOX: "1",
        // pnpm's own engine store and global folder, which it writes to now
        // and then, inside the sandbox instead of the real ~/Library/pnpm.
        PNPM_HOME: path.join(SANDBOX, "pnpm-home"),
        // Dictation records Chromium's test tone and never asks for the
        // microphone.
        FAKE_MICROPHONE: "true",
        ...(api && { INSTRUMENT_PLATFORM_API: api, MAIN_VITE_APP_API_BASE_URL: api }),
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const session = JSON.parse(out.slice(out.indexOf("{")));
  const { version } = JSON.parse(
    readFileSync(path.join(CHECKOUT, "apps/studio/package.json"), "utf8"),
  );
  // A first launch has no workspace for that switch to be set in yet; the
  // tool server sets it once setup has placed one (`firstLaunchSignIn`).
  if (SCENARIO !== "new") {
    await allowProgramsUnderOuterSandbox({ port: session.port, version });
  }
  // The first frame takes a while to draw; the tester starts on a drawn window.
  const screen = openScreen({ port: session.port });
  for (let attempt = 0; attempt < 90; attempt++) {
    const shot = await screen.capture();
    if (shot.png.length > 8000) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  screen.close();
  // Kept for the tester's server, which watches this instance and ends it.
  writeFileSync(path.join(SANDBOX, "instance.json"), `${JSON.stringify(session, null, 2)}\n`);
  return session;
}

/** The on-screen watchdog, compiled once into the work folder. */
function onscreenBin() {
  const bin = path.join(WORK, "bin", "onscreen");
  if (!existsSync(bin)) {
    mkdirSync(path.dirname(bin), { recursive: true });
    execFileSync("swiftc", ["-O", "-o", bin, path.join(HERE, "lib/onscreen.swift")], {
      stdio: "inherit",
    });
  }
  return bin;
}

function testerPlan() {
  const persona = flag("--persona");
  if (!persona) {
    throw new Error("Name the persona with --persona personas/<file>.md.");
  }
  const name = flag("--name", `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
  const standIn = flag("--stand-in");
  const firstLaunch = flag("--first-launch-account");
  const maxActions = flag("--max-actions", "40");
  const maxMinutes = flag("--max-minutes", "25");
  const budget = flag("--budget", "25");
  const runDir = path.join(RUNS, name);
  if (existsSync(path.join(runDir, "steps.jsonl"))) {
    throw new Error(`${runDir} already holds a run; pick another --name.`);
  }
  mkdirSync(runDir, { recursive: true });
  // The booted instance's port; --port names one without asking, to print
  // the command before anything is running.
  const port = flag("--port") ?? drive(["port"]).trim();

  const system = readFileSync(path.join(HERE, "prompts/system.md"), "utf8").replace(
    "{{PERSONA}}",
    readFileSync(
      existsSync(path.resolve(persona)) ? path.resolve(persona) : path.resolve(HERE, persona),
      "utf8",
    ).trim(),
  );
  const systemFile = path.join(runDir, "system.md");
  writeFileSync(systemFile, system);
  const mcpFile = path.join(runDir, "mcp.json");
  writeFileSync(
    mcpFile,
    `${JSON.stringify(
      {
        mcpServers: {
          screen: {
            args: [path.join(HERE, "lib/mcp-server.mjs")],
            command: process.execPath,
            env: {
              FRT_CROP_BOTTOM: CROP_BOTTOM,
              FRT_INSPECT_PORT: INSPECT_PORT,
              FRT_MAX_ACTIONS: maxActions,
              FRT_MAX_MINUTES: maxMinutes,
              FRT_PORT: port,
              FRT_RUN_DIR: runDir,
              FRT_ONSCREEN_BIN: onscreenBin(),
              FRT_SUPERVISOR_PID: String(
                JSON.parse(readFileSync(path.join(SANDBOX, "instance.json"), "utf8")).pid,
              ),
              ...(standIn && { FRT_STANDIN: path.resolve(standIn) }),
              ...(firstLaunch && { FRT_FIRST_LAUNCH_ACCOUNT: path.resolve(firstLaunch) }),
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const kickoff = readFileSync(path.join(HERE, "prompts/kickoff.txt"), "utf8").trim();
  // Run from an empty folder under the system's temp directory, so nothing
  // above it carries a CLAUDE.md or project settings.
  const cwd = path.join(os.tmpdir(), `first-run-tester-${name}`);
  mkdirSync(cwd, { recursive: true });
  const args = [
    "-p",
    kickoff,
    "--model",
    MODEL,
    "--system-prompt-file",
    systemFile,
    // No built-in tools at all: no Bash, no file reads, no web.
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    mcpFile,
    "--allowedTools",
    "mcp__screen__*",
    // No user, project or local settings: no CLAUDE.md, hooks, memory or plugins.
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-chrome",
    "--exclude-dynamic-system-prompt-sections",
    "--max-budget-usd",
    budget,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  return { args, cwd, maxActions, maxMinutes, name, port, runDir };
}

async function tester() {
  const go = has("--go");
  const plan = testerPlan();
  const shown = `cd ${plan.cwd} && claude ${plan.args
    .map((arg) => (/^[\w./=*-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(" ")} > ${plan.runDir}/transcript.jsonl`;
  writeFileSync(path.join(plan.runDir, "command.txt"), `${shown}\n`);
  if (!go) {
    console.log(shown);
    console.log(
      `\nNot started. System prompt: ${plan.runDir}/system.md. Pass --go once the run is approved.`,
    );
    return;
  }
  const transcript = createWriteStream(path.join(plan.runDir, "transcript.jsonl"));
  // FRT_FAKE_TESTER names a script to run in the model's place, for checking
  // this runner with no model call.
  const fake = process.env.FRT_FAKE_TESTER;
  const child = fake
    ? spawn(process.execPath, [fake, plan.runDir], { stdio: ["ignore", "pipe", "inherit"] })
    : spawn("claude", plan.args, { cwd: plan.cwd, stdio: ["ignore", "pipe", "inherit"] });
  child.stdout.pipe(transcript);
  const startedAt = Date.now();
  let ended = null;
  const end = (why) => {
    if (!ended) {
      ended = why;
      child.kill("SIGTERM");
    }
  };
  // A rig that fails ends the session within seconds: the server leaves
  // rig-failed.json, and nothing the tester could still do is worth waiting
  // for. A finished session gets a minute to say goodbye. A session with no
  // step logged for longer than any call may take is stuck.
  const stepsFile = path.join(plan.runDir, "steps.jsonl");
  let finishedAt = null;
  const watch = setInterval(() => {
    if (existsSync(path.join(plan.runDir, "rig-failed.json"))) {
      return end("rig-failed");
    }
    if (existsSync(path.join(plan.runDir, "finish.json"))) {
      finishedAt ??= Date.now();
      if (Date.now() - finishedAt > 60_000) {
        return end("finished");
      }
      return;
    }
    const lastStep = existsSync(stepsFile) ? statSync(stepsFile).mtimeMs : startedAt;
    if (Date.now() - lastStep > 6 * 60_000) {
      return end("stalled");
    }
    if (Date.now() - startedAt > (Number(plan.maxMinutes) + 10) * 60_000) {
      return end("over-time");
    }
  }, 2000);
  const code = await new Promise((resolve) => child.on("close", resolve));
  clearInterval(watch);
  const lines = (file) =>
    existsSync(path.join(plan.runDir, file))
      ? readFileSync(path.join(plan.runDir, file), "utf8").trim().split("\n").filter(Boolean)
      : [];
  const steps = lines("steps.jsonl").map((line) => JSON.parse(line));
  let modelResult = null;
  for (const line of lines("transcript.jsonl")) {
    try {
      const record = JSON.parse(line);
      if (record.type === "result") {
        modelResult = record;
      }
    } catch {
      // Not a record.
    }
  }
  // What the rig itself did or blocked, for discounting: each kind counted,
  // with the steps it happened at.
  const rigNotes = {};
  for (const step of steps.filter((each) => each.rigNote)) {
    const kind =
      step.rigNote === "blocked-outside" ? `blocked-outside:${step.outside?.kind}` : step.rigNote;
    (rigNotes[kind] ??= []).push(step.step);
  }
  // "Open in Safari" and the like run the system's `open`, which the profile
  // refuses; the app says so in its own log, once per try.
  const logsDir = path.join(CHECKOUT, "apps/studio/.logs");
  let blockedOpens = 0;
  if (existsSync(logsDir)) {
    for (const name of readdirSync(logsDir).filter((each) => each.endsWith("Z.jsonl"))) {
      for (const line of readFileSync(path.join(logsDir, name), "utf8").split("\n")) {
        const at = /"time":"([^"]+)"/.exec(line)?.[1];
        if (at && Date.parse(at) >= startedAt && line.includes("Couldn't open the file")) {
          blockedOpens++;
        }
      }
    }
  }
  const result = {
    actions: steps.filter((step) => step.action).length,
    blockedOpens,
    rigNotes,
    costUsd: modelResult?.total_cost_usd ?? null,
    ended:
      ended ?? (existsSync(path.join(plan.runDir, "finish.json")) ? "finished" : "tester-exited"),
    exitCode: code,
    rigFailure: existsSync(path.join(plan.runDir, "rig-failed.json"))
      ? JSON.parse(readFileSync(path.join(plan.runDir, "rig-failed.json"), "utf8"))
      : null,
    run: plan.name,
    stumbles: lines("stumbles.jsonl").length,
    wallSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  writeFileSync(path.join(plan.runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  console.log(report(plan.runDir));
}

/** The run as one Markdown timeline, to lay beside a person's transcript. */
function report(runDir) {
  const read = (file) =>
    existsSync(path.join(runDir, file))
      ? readFileSync(path.join(runDir, file), "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const steps = read("steps.jsonl");
  const stumbles = read("stumbles.jsonl");
  const lines = [`# First-run tester: ${path.basename(runDir)}`, ""];
  lines.push(`## Stumbles (${stumbles.length}), as the tester wrote them`, "");
  for (const [index, stumble] of stumbles.entries()) {
    lines.push(
      `${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ""}. **${stumble.severity}**, step ${stumble.step}, ${stumble.elapsed}, \`${stumble.screenshot}\``,
      `   - ${stumble.what_happened}`,
      ...(stumble.what_i_wanted ? [`   - Wanted: ${stumble.what_i_wanted}`] : []),
    );
  }
  lines.push("", "## Timeline", "");
  for (const step of steps) {
    if (step.rigNote && !step.outside) {
      lines.push(
        `- ${step.elapsed} rig note: ${step.rigNote}${step.seconds ? ` (${step.seconds} s)` : ""}${step.tool ? `, ${step.tool}` : ""}`,
      );
    } else if (step.restarted) {
      lines.push(`- ${step.elapsed} the app restarted itself (its process left and a new one came up)`);
    } else if (step.outside) {
      lines.push(`- ${step.elapsed} outside the window: ${step.outside.kind} ${JSON.stringify(step.outside.detail)}`);
    } else if (step.stumble) {
      lines.push(`- ${step.elapsed} **stumble (${step.severity})**: ${step.what_happened}`);
    } else if (step.finish) {
      lines.push("", "## Closing words", "", step.finish.overall, "", `Got done: ${step.finish.got_done}`);
    } else if (step.tool === "look") {
      lines.push(`- ${step.elapsed} step ${step.step} look → \`${step.screenshot}\``);
    } else if (step.tool) {
      lines.push(
        `- ${step.elapsed} step ${step.step} **${step.tool}** ${JSON.stringify(step.input)} → \`${step.screenshot}\`${step.error ? ` (failed: ${step.error})` : ""}`,
        ...(step.reaction_to_previous ? [`  - Reaction to the last result: ${step.reaction_to_previous}`] : []),
        `  - Sees: ${step.i_see}`,
        `  - Expects: ${step.i_expect}`,
      );
    } else if (step.harnessError) {
      lines.push(`- harness error: ${step.harnessError}`);
    }
  }
  const file = path.join(runDir, "report.md");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

switch (command) {
  case "preflight":
    console.log(JSON.stringify(preflight(), null, 2));
    break;
  case "boot":
    console.log(JSON.stringify(await boot(), null, 2));
    break;
  case "tester":
    await tester();
    break;
  case "report":
    console.log(
      report(existsSync(path.join(RUNS, argv[0] ?? "")) ? path.join(RUNS, argv[0]) : path.resolve(argv[0])),
    );
    break;
  case "stop":
    console.log(drive(["stop"]));
    break;
  default:
    console.error("Commands: preflight, boot, tester, report, stop");
    process.exit(2);
}
