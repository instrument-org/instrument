// Drive the running Studio dev app over CDP.
//
// Talks to the debug port directly rather than through the chrome-devtools CLI
// daemon: no socket to go stale when the app restarts, no page ids to be
// invalidated by a reconnect, and a screenshot clip that crops server-side so
// nothing has to redo the device-pixel math. The CLI covers the input side
// perfectly well (it has press_key and type_text); this is about owning the
// lifecycle, not about what it can dispatch.
//
//   node studio-drive.mjs boot --purpose "hotkeys"
//   node studio-drive.mjs state
//   node studio-drive.mjs goto /release-notes
//   node studio-drive.mjs click --text "All file types"
//   node studio-drive.mjs shot out.png --selector '[role=dialog]'
//   node studio-drive.mjs wait 'document.querySelectorAll("webview").length > 0'
//   node studio-drive.mjs rpc workspace.chats.tasks '{"id":"<chat-id>"}'
//   node studio-drive.mjs wait --idle --chat <chat-id> [--task <session-id>]
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
// `boot` starts an instance labeled with a short purpose on a port derived from
// this checkout's path, and every other command reads the record it writes. Two
// things it deliberately does not do:
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
// An instance booted here freezes its main process and preload scripts at the
// bytes they started with (`DISABLE_DEV_RELAUNCH`), because their hot reload is
// a hard kill of the app and a full reload of the renderer respectively, and in
// this checkout it fires on whatever anyone else is writing. Renderer HMR stays
// on: a hot update rebuilds component state, which a run can re-establish, and
// it is the half that pays for itself when the change is the run's own. Pass
// `--hot` to boot an instance that reloads all three, for a run that is testing
// reload behavior or iterating on main. A hand-started instance -- `pnpm dev`,
// `pnpm studio`, the VS Code launch configs, all of which sit on the
// conventional 48160 -- is untouched by this and hot reloads everything.
//
//   node studio-drive.mjs boot --hot --purpose "main process"
//
// An instance booted here never comes on screen by itself. Its windows render,
// take input, and answer screenshots off screen, and keep drawing once
// covered, minimized, or on another Space, so a run never has to raise one,
// and the person at the machine keeps their focus and their Space: anything put
// on screen, even without focus, can scroll a display to another Space. A
// person takes one over by clicking its Dock icon. `--visible` puts the window
// up as a hand-started run would, for a run that needs the window's real
// pixels on screen (`screencapture -l`).
//
// `--inspect <port>` also opens the main process's V8 inspector on that port,
// which is what `main-stalls.mjs` measures the main thread through.
//
// `--own-privacy` (macOS) boots an instance macOS answers with its own privacy
// grants rather than the terminal's, which otherwise hand it Full Disk Access,
// so a protected folder refuses it and its first read asks the way an
// installed app's does. The grants are the instance's dev Electron clone's,
// under its own bundle identifier (`devBundleId` in dev-supervisor.ts), not a
// signed build's, and they outlive the instance: undo one in System Settings
// or with `tccutil reset All <that identifier>`. Stopping it is the same as
// any other.
//
// `--workspace <fixture>` boots against a disposable workspace built from a
// committed fixture (fixtures/workspaces/) instead of the shared dev
// application-data directory, so a run does not depend on what the developer
// happened to do last, and its agents put finished work in a folder beside it
// rather than the developer's own. Add `--fresh` to rebuild it first. Each
// boot starts with no tabs restored; `--keep-tabs` carries the last run's tabs
// over. The flag belongs on every command of that run, not just `boot`: it
// selects both the port and the instance record, so two workspaces from one
// checkout never collide.
//
//   node studio-drive.mjs boot --purpose "document viewer" --workspace documents
//   node studio-drive.mjs shot task.png --workspace documents
//
// `--clean-room <name>` boots a blank workspace instead, as a second process on
// the developer's own application data pinned with INSTRUMENT_WORKSPACE: the
// toolchain and caches are already set up, so it starts as fast as the
// developer's instance, and `--with-sign-ins` copies the developer's account and
// keys into it so it can run a real agent turn. The developer's own instance keeps
// its workspace. Clean rooms not booted for 3 days are reaped like fixtures;
// `--fresh` empties one first.
//
//   node studio-drive.mjs boot --purpose "first chat" --clean-room first-chat --with-sign-ins
//
// `--scenario <name>` boots application data of its own in one app state from
// fixtures/scenarios/<name>.yaml: a workspace, the folder's place, sentinel
// sign-ins and setup's record, rebuilt on every boot. Unlike a fixture it does
// not set SKIP_ONBOARDING, since setup is what most scenarios are about.
// `--account` signs it in too. Like `--workspace`, it belongs on every command.
//
//   node studio-drive.mjs boot --purpose "setup" --scenario beta-tester
//
// The app window's tabs are each a router of their own: `goto` sends the tab
// up (or, with --new-tab, a new tab) to the route, and `state` reports the tab
// up's route, the tabs and a dialog.

// The repo does not lint `.agents`, so these only ever fire when a changed-file
// pass runs without ignores. None is worth reshaping this file for:
// `sort-modules` would order the declarations alphabetically and leave the
// section banners labeling whatever landed under them; the cache-location
// variables belong to a standalone CLI rather than a turbo task; and `dir` is
// how a path is named everywhere this script reaches, from `chatDir` through
// `workspaceConfig.chatsDir` to the `ELECTRON_USER_DATA_DIR` it sets.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DEV_INSTANCE_COLORS } from "../../../../apps/studio/src/shared/dev-instance-colors.ts";
import { SETUP_STEPS } from "../../../../apps/studio/src/shared/setup.ts";
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
  "bash",
  "boot",
  "click",
  "eval",
  // `eval` under another name, for a harness that refuses any command line
  // containing the word.
  "js",
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
const WORKSPACE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// Names the checkout a cache root belongs to, since the root's own name is only
// a hash of its path.
const CHECKOUT_MARKER = "checkout";
// Installed dependencies in a chat's work folder are the only part that grows --
// to hundreds of megabytes once an agent has run an install in one -- and the
// only part deleting does not invalidate. So they go sooner than the workspace does.
const WORK_ARTIFACT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const WORK_ARTIFACT_NAMES = new Set([".venv", "node_modules"]);
// What a fixture, clean room or scenario boot needs free on the cache's volume
// before it builds application data there: a full disk fails every process on
// the machine, other sessions' shells included.
const MIN_FREE_GB = Number(process.env.STUDIO_DRIVE_MIN_FREE_GB ?? 15);

// Read off the raw argv rather than the parsed tail: which instance a command
// talks to has to be settled before anything reads a session record.
const WORKSPACE = flag(process.argv, "--workspace");
// `--clean-room <name>` boots a blank workspace on the shared dev application
// data instead (see prepareCleanRoom). Same rule: it belongs on every command.
const CLEAN_ROOM = flag(process.argv, "--clean-room");
// `--scenario <name>` boots application data of its own in one app state
// (fixtures/scenarios/, see prepareScenario). Same rule again.
const SCENARIO = flag(process.argv, "--scenario");
// What keys the port and the instance record: the fixture, clean room or
// scenario a run is about, or none for the checkout's own instance.
const INSTANCE =
  WORKSPACE ??
  (CLEAN_ROOM && `clean-room-${CLEAN_ROOM}`) ??
  (SCENARIO && `scenario-${SCENARIO}`);
const INSTANCE_FLAG = WORKSPACE
  ? ` --workspace ${WORKSPACE}`
  : CLEAN_ROOM
    ? ` --clean-room ${CLEAN_ROOM}`
    : SCENARIO
      ? ` --scenario ${SCENARIO}`
      : "";

// --- seeded workspaces -------------------------------------------------

/**
 * Where a fixture's workspace is seeded: its userData, and the home beside it.
 * `dirName` names the directory when it is not the fixture's own (a
 * scenario's).
 */
function fixtureDirs(dirName) {
  const userDataDir = path.join(WORKSPACE_CACHE_ROOT, dirName);
  // What the instance gets as INSTRUMENT_DATA_HOME: its chats' work folders
  // and their own folders, beside its data and never in the developer's
  // home, so they are reaped and rebuilt with it.
  return { home: `${userDataDir}-home`, userDataDir };
}

/** Runs the seeder for a fixture and answers its JSON summary. */
function runSeeder(name, flags, dirName = name) {
  const { home, userDataDir } = fixtureDirs(dirName);
  let output;
  try {
    output = execFileSync(
      "pnpm",
      [
        "workspace:seed",
        "--out",
        userDataDir,
        "--home",
        home,
        "--fixture",
        name,
        ...flags,
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
  return JSON.parse(output.slice(start));
}

/** Records that a fixture was used, since reaping goes by mtime. */
function touchFixture(name) {
  const { home, userDataDir } = fixtureDirs(name);
  for (const dir of [userDataDir, home, `${userDataDir}-output`]) {
    try {
      utimesSync(dir, new Date(), new Date());
    } catch {
      // Not made yet, which the next seed does.
    }
  }
}

/**
 * Build (or reuse) the workspace this boot will run against, and hand back the
 * directory to point `ELECTRON_USER_DATA_DIR` at. The seeder is idempotent and
 * fast, so calling it on every boot is cheaper than reasoning about whether the
 * fixture has changed since last time. `dirName` names the directory when it
 * is not the fixture's own (a scenario's).
 */
function prepareWorkspace(name, { dirName = name, fresh, keepTabs }) {
  reapStaleWorkspaces();

  const { home, userDataDir } = fixtureDirs(dirName);
  mkdirSync(WORKSPACE_CACHE_ROOT, { recursive: true });

  const result = runSeeder(name, fresh ? ["--fresh"] : [], dirName);

  // Where its agents put finished work. Not in its application data, which
  // the agent's rules close, and not the flavor's folder in the home folder,
  // where a workspace in the app's own data sends it otherwise: that is the
  // developer's real one. Beside it, so it is reaped and rebuilt with it.
  const outputDir = `${userDataDir}-output`;
  if (fresh) {
    rmSync(outputDir, { force: true, recursive: true });
  }
  mkdirSync(outputDir, { recursive: true });

  // Reaping goes by mtime, so record that this workspace was used even when the
  // seeder had nothing to do and the app writes nothing before it is killed.
  touchFixture(dirName);

  reapWorkArtifacts(home);

  // The window's tabs, panes and chat groups live in the layout.json of the
  // workspace's machine folder, which the seeder never writes, so without this
  // every tab a run opens comes back on every later boot of the fixture.
  const machineDir = workspaceMachineDir(
    userDataDir,
    path.join(userDataDir, "workspace"),
  );
  if (!keepTabs && machineDir) {
    rmSync(path.join(machineDir, "window", "layout.json"), { force: true });
  }

  return { home, outputDir, tasks: result.tasks, userDataDir };
}

// --- clean rooms -------------------------------------------------------

const CLEAN_ROOMS_ROOT = path.join(WORKSPACE_CACHE_ROOT, "clean-rooms");

// The sign-in stores a clean room can start from, as the app names them in a
// workspace's keys folder (workspace-management.ts in Studio). Not the
// ChatGPT account: its refresh token rotates on every use, so a clean room holding
// a copy would sign the developer's own instance out the first time either
// refreshed.
const SIGN_IN_FILES = ["session-dev.json", "providers.json"];

/**
 * The app's folder on this computer for the workspace at `workspaceDir`, where
 * its keys, browser profiles and window state are: `machine/<local id>/` in
 * the application data, by the id the registry there gives it
 * (workspaceMachineDirOf in Studio), or `workspaces-data/<local id>/` while
 * no build since that folder's rename has opened it. Undefined while it is
 * not registered.
 */
function workspaceMachineDir(userDataDir, workspaceDir) {
  let registry;
  try {
    registry = JSON.parse(
      readFileSync(path.join(userDataDir, "workspaces.json"), "utf8"),
    );
  } catch {
    registry = { workspaces: [] };
  }
  const entry = (registry.workspaces ?? []).find(
    (candidate) =>
      typeof candidate?.path === "string" &&
      path.resolve(userDataDir, candidate.path) === path.resolve(workspaceDir),
  );
  if (typeof entry?.id !== "string") {
    return undefined;
  }
  const current = path.join(userDataDir, "machine", entry.id);
  const former = path.join(userDataDir, "workspaces-data", entry.id);
  return !existsSync(current) && existsSync(former) ? former : current;
}

function readIdentity(workspaceDir) {
  try {
    return JSON.parse(
      readFileSync(
        path.join(workspaceDir, ".instrument", "workspace.json"),
        "utf8",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Where a workspace's sign-ins are: in its machine folder once the app moved
 * them there (format 1), and in its settings folder before.
 */
function keysDirOf(userDataDir, workspaceDir) {
  const machineDir = movedMachineDir(userDataDir, workspaceDir);
  return machineDir
    ? path.join(machineDir, "keys")
    : path.join(workspaceDir, ".instrument", "settings");
}

/** The workspace's machine folder, once the app has moved its data there. */
function movedMachineDir(userDataDir, workspaceDir) {
  return readIdentity(workspaceDir).formatVersion >= 1
    ? workspaceMachineDir(userDataDir, workspaceDir)
    : undefined;
}

/**
 * The shared dev application-data directory, where the app keeps the
 * developer's default workspace. Mirrors setup-environment.ts.
 */
function devUserDataDir() {
  const suffix = process.env.ELECTRON_DEV_USER_FOLDER_SUFFIX;
  const name = `Instrument (Dev${suffix ? ` (${suffix})` : ""})`;
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", name);
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
      name,
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    name,
  );
}

/**
 * A blank workspace for this run, kept beside the fixture caches and opened by
 * a second process on the developer's own application data, pinned with
 * INSTRUMENT_WORKSPACE. Unlike a fixture it shares the machine's toolchain and
 * caches, so it boots as fast as the developer's instance does, and with
 * `withSignIns` it can run a real agent turn on the developer's sign-ins. The
 * app lists it in the dev panel as agent-made; studio-drive reaps it.
 */
function prepareCleanRoom(name, { purpose, withSignIns }) {
  reapStaleCleanRooms();

  const dir = path.join(CLEAN_ROOMS_ROOT, name);
  const privateDir = path.join(dir, ".instrument");
  const identity = path.join(privateDir, "workspace.json");
  mkdirSync(privateDir, { recursive: true });
  if (!existsSync(identity)) {
    writeFileSync(
      identity,
      `${JSON.stringify(
        {
          color: "purple",
          createdBy: { kind: "agent", purpose },
          // A blank workspace is in the format this build keeps
          // (WORKSPACE_FORMAT_VERSION in Studio's workspaces.ts), so the
          // launch moves nothing of the person's out of it. Developer mode,
          // which the dev panel and `rpc` need, is a dev build's default.
          formatVersion: 2,
          name: `Clean room: ${name}`,
          settingsVersion: 1,
        },
        undefined,
        2,
      )}\n`,
    );
  }
  // What the instance gets as INSTRUMENT_DATA_HOME, as for a fixture.
  const home = `${dir}-home`;
  mkdirSync(home, { recursive: true });

  if (withSignIns) {
    // Into the settings folder until the app has opened the clean room once,
    // and moves them on into its machine folder itself.
    const from = keysDirOf(
      devUserDataDir(),
      path.join(devUserDataDir(), "workspace"),
    );
    const keysDir = keysDirOf(devUserDataDir(), dir);
    mkdirSync(keysDir, { recursive: true });
    for (const file of SIGN_IN_FILES) {
      const target = path.join(keysDir, file);
      if (existsSync(path.join(from, file)) && !existsSync(target)) {
        copyFileSync(path.join(from, file), target);
      }
    }
  }

  // Reaping goes by mtime, as for fixtures.
  utimesSync(dir, new Date(), new Date());
  utimesSync(home, new Date(), new Date());
  reapWorkArtifacts(home);
  return { dir, home };
}

// --- scenarios ---------------------------------------------------------

const SCENARIOS_DIR = path.join(REPO_ROOT, "fixtures", "scenarios");

// The ChatGPT plan scope a sign-in has to carry for its account to count,
// as the built-in sign-in setup names it (chatgpt-sign-in-setup.ts).
const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";

/** The keys a scenario may set, so a typo fails rather than doing nothing. */
const SCENARIO_KEYS = new Set([
  "accountCheck",
  "description",
  "folder",
  "network",
  "notificationAnswer",
  "notifications",
  "outputFolder",
  "setup",
  "signIns",
  "workspace",
]);

function readScenario(name) {
  const file = path.join(SCENARIOS_DIR, `${name}.yaml`);
  if (!existsSync(file)) {
    const known = existsSync(SCENARIOS_DIR)
      ? readdirSync(SCENARIOS_DIR)
          .filter((entry) => entry.endsWith(".yaml"))
          .map((entry) => entry.replace(/\.yaml$/, ""))
      : [];
    fail(`No scenario "${name}". Scenarios: ${known.join(", ") || "none"}`);
  }
  // The workspace package's copy, since the repo root has none of its own.
  const yaml = createRequire(
    path.join(REPO_ROOT, "packages", "workspace", "package.json"),
  )("yaml");
  const scenario = yaml.parse(readFileSync(file, "utf8")) ?? {};
  const unknown = Object.keys(scenario).filter(
    (key) => !SCENARIO_KEYS.has(key),
  );
  if (unknown.length > 0) {
    fail(`${file} has keys no scenario takes: ${unknown.join(", ")}`);
  }
  for (const step of [
    ...(scenario.setup?.answered ?? []),
    ...(scenario.setup?.addedLater ?? []),
  ]) {
    if (!SETUP_STEPS.includes(step)) {
      fail(
        `${file} names a step setup has no ${JSON.stringify(step)}. Steps: ${SETUP_STEPS.join(", ")}`,
      );
    }
  }
  return scenario;
}

/**
 * Builds a scenario's application data from scratch, so every boot lands in
 * the same state however the last run left it: its workspace (a fixture, or
 * none yet), the folder's place, sentinel sign-ins, and setup's record. What
 * comes from outside the app (macOS's notification answer, the network)
 * comes back as the environment the boot sets.
 */
function prepareScenario(name, { keepTabs }) {
  const scenario = readScenario(name);
  const dirName = `scenario-${name}`;
  const base = path.join(WORKSPACE_CACHE_ROOT, dirName);
  rmSync(base, { force: true, recursive: true });
  rmSync(`${base}-output`, { force: true, recursive: true });
  rmSync(`${base}-home`, { force: true, recursive: true });
  const seeded = scenario.workspace
    ? prepareWorkspace(scenario.workspace, { dirName, keepTabs })
    : undefined;
  if (!seeded) {
    reapStaleWorkspaces();
    mkdirSync(base, { recursive: true });
  }
  const userDataDir = seeded?.userDataDir ?? base;
  const workspaceDir = path.join(userDataDir, "workspace");

  // Where finished work goes. `documents` stands in for the folder in
  // Documents an earlier build sent it to, inside the scenario's own
  // folder: a development build never looks in the real one. It is named
  // for the development build (`HOME_FOLDERS`), which looks for its own
  // flavor's folder there as a release build looks for `Instrument`.
  // A Mac always has Documents, so the stand-in home has one too.
  mkdirSync(path.join(`${userDataDir}-home`, "Documents"), { recursive: true });
  let outputDir = `${userDataDir}-output`;
  if (scenario.outputFolder === "documents") {
    outputDir = path.join(`${userDataDir}-home`, "Documents", "Instrument Dev");
    mkdirSync(path.join(outputDir, "Squares"), { recursive: true });
    writeFileSync(
      path.join(outputDir, "Finished before.md"),
      "# Earlier work\n",
    );
    writeFileSync(
      path.join(outputDir, "Squares", "notes.txt"),
      "Red and blue squares, made earlier.\n",
    );
  } else if (scenario.outputFolder !== undefined) {
    fail(`outputFolder takes only "documents", not ${scenario.outputFolder}`);
  }
  mkdirSync(outputDir, { recursive: true });

  if (scenario.folder === "move-pending") {
    // The move Continue on the folder step records before its restart, which
    // this launch makes.
    const target = path.join(`${userDataDir}-home`, "Instrument");
    mkdirSync(target, { recursive: true });
    // A launch has always settled the workspace before a move is asked
    // for, and the launch that makes one opens only a folder with an
    // identity.
    const identity = path.join(workspaceDir, ".instrument", "workspace.json");
    if (!existsSync(identity)) {
      mkdirSync(path.dirname(identity), { recursive: true });
      writeFileSync(identity, `${JSON.stringify({ name: "Default" })}\n`);
    }
    const registryFile = path.join(userDataDir, "workspaces.json");
    let registry = {};
    try {
      registry = JSON.parse(readFileSync(registryFile, "utf8"));
    } catch {
      // None yet: the app registers the default workspace at launch.
    }
    const others = (registry.workspaces ?? []).filter(
      (entry) => entry?.id !== "default",
    );
    const own = (registry.workspaces ?? []).find(
      (entry) => entry?.id === "default",
    );
    writeFileSync(
      registryFile,
      `${JSON.stringify({
        ...registry,
        active: registry.active ?? "default",
        workspaces: [
          ...others,
          {
            path: "workspace",
            ...own,
            id: "default",
            pendingMove: { from: workspaceDir, to: target },
          },
        ],
      })}\n`,
    );
  } else if (scenario.folder !== undefined && scenario.folder !== "app-data") {
    fail(`folder takes "app-data" or "move-pending", not ${scenario.folder}`);
  }

  for (const signIn of scenario.signIns ?? []) {
    if (signIn !== "chatgpt") {
      fail(`signIns takes only "chatgpt", not ${signIn}`);
    }
    // A sign-in that passes every check the app makes on disk and fails any
    // real request: the token is not one.
    const keysDir = keysDirOf(userDataDir, workspaceDir);
    mkdirSync(keysDir, { recursive: true });
    writeFileSync(
      path.join(keysDir, "chatgpt-account.json"),
      `${JSON.stringify({
        registrations: {
          "scenario-chatgpt": {
            accessToken: "scenario-sentinel-not-a-token",
            addedAt: Date.now(),
            clientId: "scenario-sentinel",
            email: "scenario@example.com",
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
            id: "scenario-chatgpt",
            scopes: ["openid", CHATGPT_PLAN_SCOPE],
            subject: "scenario-sentinel",
          },
        },
      })}\n`,
      { mode: 0o600 },
    );
  }

  if (scenario.setup) {
    // As setup itself writes it (setup-step.ts): finishing answers every
    // step, and `addedLater` takes back the ones a later build added.
    const at = new Date().toISOString();
    const answered = Object.fromEntries(
      (scenario.setup.finished ? SETUP_STEPS : (scenario.setup.answered ?? []))
        .filter((step) => !(scenario.setup.addedLater ?? []).includes(step))
        .map((step) => [step, at]),
    );
    writeFileSync(
      path.join(userDataDir, "machine-state.json"),
      `${JSON.stringify({
        setup: {
          answered,
          ...(scenario.setup.finished && { finishedAt: at }),
        },
      })}\n`,
    );
  }

  return {
    env: {
      // The folders setup offers, inside the scenario's own folder.
      INSTRUMENT_SETUP_HOME: `${userDataDir}-home`,
      ...(scenario.notifications && {
        INSTRUMENT_NOTIFICATION_STATUS: scenario.notifications,
      }),
      ...(scenario.notificationAnswer && {
        INSTRUMENT_NOTIFICATION_ANSWER: scenario.notificationAnswer,
      }),
      ...(scenario.network && { INSTRUMENT_NETWORK_STATUS: scenario.network }),
      ...(scenario.accountCheck && {
        INSTRUMENT_ACCOUNT_CHECK: scenario.accountCheck,
      }),
    },
    home: `${userDataDir}-home`,
    outputDir,
    userDataDir,
    workspaceDir,
  };
}

// --- accounts --------------------------------------------------------

/**
 * The Instrument account `--account` names: a JSON file with the API to talk
 * to (`api`) and a session token on it (`token`), plus the account's `email`
 * for the record. The platform's own tooling writes these; nothing here
 * knows how the account was made.
 */
function readAccount(file) {
  let account;
  try {
    account = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Could not read the account file ${file}: ${error.message}`);
  }
  if (
    typeof account?.token !== "string" ||
    !account.token ||
    !URL.canParse(account.api ?? "")
  ) {
    fail(
      `${file} is not an account file: it needs an \`api\` URL and a \`token\`.`,
    );
  }
  // The app joins paths onto the server, which a query or fragment would
  // swallow: Settings refuses them too (PlatformApiServerSchema).
  const api = new URL(account.api);
  if (!["http:", "https:"].includes(api.protocol) || api.search || api.hash) {
    fail(
      `${file} names an \`api\` the app cannot use: it needs an http(s) address with no query or fragment.`,
    );
  }
  return {
    api: account.api.replace(/\/+$/, ""),
    email: typeof account.email === "string" ? account.email : undefined,
    file: path.resolve(file),
    token: account.token,
  };
}

/**
 * Signs the workspace at `workspaceDir` in as `account`: the session the app
 * reads (plain JSON in a dev build). Replaces any session the workspace held.
 */
function signInAs(account, userDataDir, workspaceDir) {
  const keysDir = keysDirOf(userDataDir, workspaceDir);
  mkdirSync(keysDir, { recursive: true });
  writeFileSync(
    path.join(keysDir, "session-dev.json"),
    `${JSON.stringify({ apiBearerTokens: { [new URL(account.api).origin]: account.token } })}\n`,
    { mode: 0o600 },
  );
}

function reapStaleCleanRooms() {
  reapGoneCheckouts();
  reapOlderThan(CLEAN_ROOMS_ROOT, WORKSPACE_MAX_AGE_MS, {
    // Its machine folder in the shared application data, whose sign-ins would
    // otherwise outlive it there.
    beforeRemove: (dir) => {
      const machineDir = workspaceMachineDir(devUserDataDir(), dir);
      if (machineDir) {
        rmSync(machineDir, { force: true, recursive: true });
      }
    },
  });
}

function reapStaleWorkspaces() {
  reapGoneCheckouts();
  reapOlderThan(WORKSPACE_CACHE_ROOT, WORKSPACE_MAX_AGE_MS, {
    // Its own mtime only moves when a clean room is added or removed; the clean
    // rooms inside are reaped one by one instead.
    keep: new Set([path.basename(CLEAN_ROOMS_ROOT)]),
  });
}

/**
 * Drops the caches of checkouts that no longer exist. A worktree removed once
 * it lands never boots again, so its own reaping never runs and its fixtures
 * and clean rooms would stay for good. A root without the marker is left alone.
 */
function reapGoneCheckouts() {
  mkdirSync(WORKSPACE_CACHE_ROOT, { recursive: true });
  writeFileSync(path.join(WORKSPACE_CACHE_ROOT, CHECKOUT_MARKER), REPO_ROOT);
  const parent = path.dirname(WORKSPACE_CACHE_ROOT);
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === CHECKOUT_KEY) {
      continue;
    }
    const root = path.join(parent, entry.name);
    try {
      const checkout = readFileSync(path.join(root, CHECKOUT_MARKER), "utf8");
      if (!existsSync(checkout)) {
        rmSync(root, { force: true, recursive: true });
      }
    } catch {
      // No marker, or another boot reaped it between the listing and the
      // read. Housekeeping must never be what ends a run.
    }
  }
}

function reapOlderThan(
  root,
  maxAgeMs,
  { beforeRemove = () => {}, keep = new Set() } = {},
) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) {
      continue;
    }
    const dir = path.join(root, entry.name);
    try {
      if (Date.now() - statSync(dir).mtimeMs > maxAgeMs) {
        beforeRemove(dir);
        rmSync(dir, { force: true, recursive: true });
      }
    } catch {
      // Another boot in this checkout reaped it between the listing and the
      // stat. Housekeeping must never be what ends a run.
    }
  }
}

/**
 * Drops installed dependencies a live agent run left at the top of a chat's
 * work folder, where its first `pip install` and `pnpm add` put them. A seeded
 * transcript never creates these, so a workspace only used for driving stays in
 * the low megabytes and this finds nothing.
 */
function reapWorkArtifacts(home) {
  for (const workDir of workDirs(home)) {
    for (const name of WORK_ARTIFACT_NAMES) {
      const dir = path.join(workDir, name);
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

/**
 * Every chat's work folder under a home the instance was given
 * (INSTRUMENT_DATA_HOME): `<data folder>/work/<workspace>/<chat id>/`, the
 * data folder being the flavor's (`.instrument-dev` for a dev build;
 * HOME_FOLDERS in the shared package). A chat's tasks work in its folder.
 */
function workDirs(home) {
  const children = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name));
    } catch {
      return [];
    }
  };
  return children(home)
    .filter((dir) => path.basename(dir).startsWith("."))
    .flatMap((dataDir) => children(path.join(dataDir, "work")))
    .flatMap(children);
}

// --- lifecycle ---------------------------------------------------------

/**
 * Whether the app answering on `port` runs this checkout's code: a dev
 * renderer loads its dependencies from the checkout's own folder, by its
 * path.
 */
async function servesThisCheckout(port) {
  let cdp;
  try {
    cdp = await openCdp(`http://127.0.0.1:${port}`);
    const sources = await evaluate(
      cdp,
      'performance.getEntriesByType("resource").map((entry) => entry.name)',
    );
    const own = `/@fs${REPO_ROOT.split(path.sep).join("/")}/`;
    return sources.some((source) => {
      try {
        return decodeURIComponent(new URL(source).pathname).startsWith(own);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  } finally {
    cdp?.close();
  }
}

/**
 * Fails the boot when the volume the caches live on has less than
 * `MIN_FREE_GB` free, naming what can go. Measured on the nearest folder that
 * exists, since the first boot of a checkout has not made its own yet.
 */
function refuseWhenDiskIsLow() {
  const caches = path.dirname(WORKSPACE_CACHE_ROOT);
  let dir = WORKSPACE_CACHE_ROOT;
  while (!existsSync(dir) && path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
  }
  const { bavail, bsize } = statfsSync(dir);
  const freeGb = (Number(bavail) * Number(bsize)) / 1024 ** 3;
  if (freeGb >= MIN_FREE_GB) {
    return;
  }
  fail(
    `Only ${freeGb.toFixed(1)} GB is free on the volume with studio-drive's caches, under the ${MIN_FREE_GB} GB a boot needs (STUDIO_DRIVE_MIN_FREE_GB sets it).\n` +
      `Each checkout's caches are a folder in ${caches}, named by a hash of its path, with a \`checkout\` file naming the checkout. ` +
      `Inside, \`scenario-<name>\` (with its \`-home\` and \`-output\`), each fixture's folder and \`clean-rooms/<name>\` are rebuilt on the next boot, so they can go once their instance is stopped (\`studio-drive.mjs stop --scenario <name>\`, \`--workspace <fixture>\` or \`--clean-room <name>\`, run from that checkout). ` +
      `Never delete one whose instance is running.`,
  );
}

async function cmdBoot(
  explicitPort,
  {
    account: accountFile,
    fresh,
    hot,
    inspect,
    keepTabs,
    ownPrivacy,
    purpose: rawPurpose,
    visible,
    withSignIns,
  },
) {
  const purpose = normalizePurpose(rawPurpose);
  if ([WORKSPACE, CLEAN_ROOM, SCENARIO].filter(Boolean).length > 1) {
    fail(
      "Pass one of --workspace, --clean-room or --scenario: a fixture and a scenario bring their own application data, a clean room uses yours.",
    );
  }
  if (accountFile && !WORKSPACE && !CLEAN_ROOM && !SCENARIO) {
    fail(
      "--account signs a disposable workspace in, so it needs --workspace, --clean-room or --scenario: your own workspace keeps your own sign-in.",
    );
  }
  const account = accountFile ? readAccount(accountFile) : undefined;
  const existing = readSession(INSTANCE);
  if (existing && (await isPortLive(existing.port))) {
    // The port comes from a hash with a few hundred values, so a live one
    // may be another checkout's instance that took it after this one's
    // stopped. Reused only once it is seen to run this checkout's code.
    if (!(await servesThisCheckout(existing.port))) {
      fail(
        `Port ${existing.port} answers, but not with this checkout's app, so the instance recorded for it is gone.\n` +
          `Delete its record, ${sessionFile(INSTANCE)}, rather than running stop, which signals the recorded process. Then boot with --port to pick another port.`,
      );
    }
    // Which API an instance talks to is fixed when its dev server starts.
    if ((existing.account?.file ?? undefined) !== account?.file) {
      fail(
        `The running instance on port ${existing.port} is signed in ${existing.account ? `as ${existing.account.email ?? existing.account.file}` : "as its workspace was"}, not as this boot asks.\n` +
          `Run \`studio-drive.mjs stop${INSTANCE_FLAG}\`, then boot it again.`,
      );
    }
    if (fresh) {
      fail(
        `--fresh rebuilds the workspace on disk and the instance on port ${existing.port} has it open.\n` +
          `Run \`studio-drive.mjs stop${INSTANCE_FLAG}\` first.`,
      );
    }
    if (existing.purpose !== purpose) {
      fail(
        `The running instance is labeled ${JSON.stringify(existing.purpose ?? "unlabeled")}, not ${JSON.stringify(purpose)}.\n` +
          `Run \`studio-drive.mjs stop${INSTANCE_FLAG}\`, then boot it with the new purpose.`,
      );
    }
    // Reload behavior is fixed when the dev server starts, so it is the running
    // instance's and not this command's. Said out loud rather than silently
    // ignored: a run that asked for one mode and got the other would otherwise
    // discover it as an app that did or did not restart when it expected.
    // Skipped when the record predates the field, since which mode that
    // instance is in is exactly what it does not say.
    if (Boolean(existing.ownPrivacy) !== Boolean(ownPrivacy)) {
      fail(
        `The running instance on port ${existing.port} was booted ${existing.ownPrivacy ? "with" : "without"} --own-privacy.\n` +
          `Run \`studio-drive.mjs stop${INSTANCE_FLAG}\`, then boot it the other way.`,
      );
    }
    if (visible && existing.offScreen) {
      fail(
        `The running instance on port ${existing.port} was booted without --visible, so it stays off screen until someone clicks its Dock icon.\n` +
          `Run \`studio-drive.mjs stop${INSTANCE_FLAG}\`, then boot it with --visible.`,
      );
    }
    if (existing.hot !== undefined && existing.hot !== hot) {
      console.error(
        `studio-drive: reusing the instance on port ${existing.port}, which was booted ` +
          `${existing.hot ? "with" : "without"} main/preload hot reload. Stop it first to boot the other way.`,
      );
    }
    if (WORKSPACE) {
      // The seed the instance has open must still be what the fixture and
      // the seeder build, or the run drives a workspace nobody committed.
      if (!runSeeder(WORKSPACE, ["--check"]).current) {
        fail(
          `The fixture "${WORKSPACE}" or the seeder changed since the instance on port ${existing.port} was seeded.\n` +
            `Run \`studio-drive.mjs stop${INSTANCE_FLAG}\`, then boot again to reseed it.`,
        );
      }
      touchFixture(WORKSPACE);
    }
    return { ...existing, reused: true };
  }

  const port = explicitPort ? Number(explicitPort) : checkoutPort(INSTANCE);
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

  if (WORKSPACE || CLEAN_ROOM || SCENARIO) {
    refuseWhenDiskIsLow();
  }
  const workspace = WORKSPACE
    ? prepareWorkspace(WORKSPACE, { fresh, keepTabs })
    : undefined;
  if (CLEAN_ROOM && fresh) {
    for (const dir of [
      path.join(CLEAN_ROOMS_ROOT, CLEAN_ROOM),
      path.join(CLEAN_ROOMS_ROOT, `${CLEAN_ROOM}-home`),
    ]) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
  const cleanRoom = CLEAN_ROOM
    ? prepareCleanRoom(CLEAN_ROOM, { purpose, withSignIns })
    : undefined;
  const scenario = SCENARIO
    ? prepareScenario(SCENARIO, { keepTabs })
    : undefined;
  if (account) {
    if (scenario) {
      signInAs(account, scenario.userDataDir, scenario.workspaceDir);
    } else if (workspace) {
      signInAs(
        account,
        workspace.userDataDir,
        path.join(workspace.userDataDir, "workspace"),
      );
    } else if (cleanRoom) {
      signInAs(account, devUserDataDir(), cleanRoom.dir);
    }
  }

  const file = sessionFile(INSTANCE);
  mkdirSync(path.dirname(file), { recursive: true });
  const color = pickColor(purpose, file);
  const logFile = file.replace(/\.json$/, ".log");
  const log = openSync(logFile, "a");

  // What `pnpm dev` expands to, minus the two node processes that expansion
  // costs: `pnpm run` plus `cross-env` add about half a second to every boot
  // and nothing else. Keep this in step with the `dev` script in
  // apps/studio/package.json, which is the thing it is standing in for.
  //
  // Through the dev supervisor, which starts electron-vite again when the app
  // restarts itself (a workspace switch), so this pid stays the instance's
  // across one and the CDP port comes back on the same number.
  const child = spawn(
    process.execPath,
    [
      path.join(STUDIO_DIR, "scripts/dev-supervisor.ts"),
      "dev",
      "--sourcemap",
      ...(inspect ? ["--inspect", inspect] : []),
    ],
    {
      cwd: STUDIO_DIR,
      detached: true,
      env: {
        ...process.env,
        // Main and preload stay at the bytes this boot builds, so nobody else's
        // write kills the app or reloads the renderer under a run. `--hot` opts
        // back into electron-vite's default. See the header for why the
        // renderer is not included.
        DISABLE_DEV_RELAUNCH: hot ? undefined : "true",
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
        STUDIO_DRIVE_COLOR: color,
        STUDIO_OWN_PRIVACY: ownPrivacy ? "1" : undefined,
        STUDIO_DRIVE_PURPOSE: purpose,
        STUDIO_DRIVE_VISIBLE: visible ? "1" : undefined,
        // A seeded workspace has no provider credentials and must not: they
        // cannot be committed. Without this the app opens on setup.
        ...(workspace && {
          ELECTRON_USER_DATA_DIR: workspace.userDataDir,
          INSTRUMENT_DATA_HOME: workspace.home,
          INSTRUMENT_OUTPUT_FOLDER: workspace.outputDir,
          SKIP_ONBOARDING: "true",
        }),
        // Pinned rather than switched to, so the developer's own instance keeps
        // opening the workspace it had. Setup's record is the developer's
        // application data's, so setup stays out of the way whatever it says.
        ...(cleanRoom && {
          INSTRUMENT_DATA_HOME: cleanRoom.home,
          INSTRUMENT_WORKSPACE: cleanRoom.dir,
          SKIP_ONBOARDING: "true",
        }),
        // A scenario is about the state setup reads, so setup decides.
        ...(scenario && {
          ...scenario.env,
          ELECTRON_USER_DATA_DIR: scenario.userDataDir,
          INSTRUMENT_DATA_HOME: scenario.home,
          INSTRUMENT_OUTPUT_FOLDER: scenario.outputDir,
          SKIP_ONBOARDING: undefined,
        }),
        // The account's API, over the build's (electron-vite takes a variable
        // already in the environment over the .env files) and over the server
        // chosen in Settings, which every dev instance on the machine shares.
        ...(account && {
          INSTRUMENT_PLATFORM_API: account.api,
          MAIN_VITE_APP_API_BASE_URL: account.api,
        }),
      },
      stdio: ["ignore", log, log],
    },
  );
  child.unref();

  const session = {
    color,
    hot: Boolean(hot),
    ...(inspect && { inspectPort: Number(inspect) }),
    logFile,
    ...(!visible && { offScreen: true }),
    ...(ownPrivacy && { ownPrivacy: true }),
    pid: child.pid,
    port,
    purpose,
    startedAt: new Date().toISOString(),
    ...(workspace && { tasks: workspace.tasks, workspace: WORKSPACE }),
    ...(cleanRoom && { cleanRoom: cleanRoom.dir }),
    ...(scenario && { scenario: SCENARIO }),
    ...(account && {
      account: { api: account.api, email: account.email, file: account.file },
    }),
  };
  writeSession(INSTANCE, session);

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
          writeSession(INSTANCE, booted);
          return { ...booted, reused: false };
        } finally {
          cdp.close();
        }
      } catch {
        // Renderer not serving a target yet; keep waiting. A launch that
        // refused its workspace never serves one, only its own window, which
        // is drivable as it is.
        try {
          (
            await openCdp(`http://127.0.0.1:${port}`, { page: "refusal" })
          ).close();
          return { ...session, refusal: true, reused: false };
        } catch {
          // Not that either.
        }
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
  const session = readSession(INSTANCE);
  if (!session) {
    return { stopped: false };
  }
  try {
    // The dev server is the process group leader; the Electron app is its child.
    process.kill(-session.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  rmSync(sessionFile(INSTANCE), { force: true });
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

  // An empty object rather than undefined, so a script reading args.x without
  // --args gets undefined for the field instead of a TypeError.
  let args = {};
  if (rawArgs !== undefined) {
    try {
      // `@<file>` reads the JSON from a file, for arguments a shell would
      // mangle: backslashes in a Windows path, quotes inside a prompt.
      args = JSON.parse(
        rawArgs.startsWith("@")
          ? readFileSync(rawArgs.slice(1), "utf8")
          : rawArgs,
      );
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

  // --quiet drops the per-step trace from a run that succeeds, for a script
  // whose own return value already says what happened: each step records the
  // value it returned, and a few RPC reads make that hundreds of kilobytes.
  const quiet = process.argv.includes("--quiet");
  const app = await connect({
    allowReload: process.argv.includes("--allow-reload"),
    page: flag(process.argv, "--page"),
    port: flag(process.argv, "--port"),
    workspace: INSTANCE,
  });

  try {
    const value = await run(app, args);
    return {
      ok: true,
      steps: app.trace.length,
      ...(!quiet && { trace: app.trace }),
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
      // A failure keeps the trace even when quiet, without the values each
      // step returned, which are what makes it long.
      trace: quiet
        ? app.trace.map(({ value: _value, ...entry }) => entry)
        : app.trace,
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

/**
 * The color this instance's Dock dot and dev pill wear. Each purpose has a
 * color of its own, so "hotkeys" comes back the same every time it is booted,
 * unless a live instance from any checkout already wears it; then it takes the
 * next one along that none does. Past six live instances, colors repeat.
 */
function pickColor(purpose, ownFile) {
  const names = Object.keys(DEV_INSTANCE_COLORS);
  const dir = path.dirname(ownFile);
  const taken = new Set(
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(dir, name))
      .filter((file) => file !== ownFile)
      .map((file) => {
        try {
          return JSON.parse(readFileSync(file, "utf8"));
        } catch {
          return undefined;
        }
      })
      .filter((session) => session?.pid && isAlive(session.pid))
      .map((session) => session.color),
  );
  const start =
    createHash("sha256").update(purpose).digest().readUInt16BE(0) %
    names.length;
  for (let step = 0; step < names.length; step++) {
    const name = names[(start + step) % names.length];
    if (!taken.has(name)) {
      return name;
    }
  }
  return names[start];
}

function normalizePurpose(rawPurpose) {
  if (!rawPurpose || rawPurpose.startsWith("--")) {
    fail(
      'Pass --purpose with one or two short words describing this instance, such as --purpose "hotkeys".',
    );
  }
  const purpose = rawPurpose.trim().replaceAll(/\s+/g, " ");
  if (!purpose) {
    fail("--purpose cannot be empty.");
  }
  if (purpose.length > 24) {
    fail(`--purpose must be at most 24 characters; got ${purpose.length}.`);
  }
  return purpose;
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
          account: flag(argv, "--account"),
          fresh: argv.includes("--fresh"),
          hot: argv.includes("--hot"),
          inspect: flag(argv, "--inspect"),
          keepTabs: argv.includes("--keep-tabs"),
          ownPrivacy: argv.includes("--own-privacy"),
          purpose: flag(argv, "--purpose"),
          visible: argv.includes("--visible"),
          withSignIns: argv.includes("--with-sign-ins"),
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
            workspace: INSTANCE,
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
 * A write under `src/client` hot-updates the renderer, and one the update
 * cannot be applied to reloads the page outright, so an instance can still be
 * reset by another agent, a commit, or a formatter mid-run. Unreported, that
 * arrives as a click that stopped working or a screenshot of a route nobody
 * left, and the time goes into debugging the app rather than the harness. An
 * instance booted here holds its main process and preload scripts still, so the
 * larger reset -- the app relaunching underneath the run -- is not among the
 * things this has to catch; a `--hot` one is exposed to that too.
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
  const session = readSession(INSTANCE);
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
    // An update proves the checkout changed. On a frozen instance only the
    // renderer half of that change is running, and the other half fails as a
    // fix that did not work rather than as code that never loaded: a component
    // edit appears immediately, an edit beside it under `electron-main` or in a
    // package does not, and nothing about the app says which it just showed
    // you.
    if (!session.hot) {
      console.error(
        "studio-drive: this instance froze main and preload at boot, so only " +
          "changes under src/client are live in it. Anything else you have " +
          "edited since it started needs `stop` and `boot` again to load.",
      );
    }
  }

  writeSession(INSTANCE, { ...session, load });
}

async function runAgainstInstance() {
  // A single command reports a reload rather than refusing over it: the caller
  // is standing right there, and the next command re-establishes whatever was
  // lost. `run` takes the stricter default, because a sequence cannot.
  const app = await connect({
    allowReload: true,
    page: flag(argv, "--page"),
    port: flag(argv, "--port"),
    workspace: INSTANCE,
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
    case "bash": {
      return cmdBash(
        app,
        flag(argv, "--file")
          ? readFileSync(flag(argv, "--file"), "utf8").trim()
          : positional.join(" "),
      );
    }
    case "click": {
      return app.click(
        flag(argv, "--selector")
          ? { selector: flag(argv, "--selector") }
          : (flag(argv, "--text") ?? positional[0]),
        undefined,
        // `--right` goes last: like every flag here it takes the word after
        // it, so `click --right Name` would read Name as its value.
        {
          button: argv.includes("--right") ? "right" : "left",
          count: argv.includes("--double") ? 2 : 1,
        },
      );
    }
    case "eval":
    case "js": {
      return app.eval(positional.join(" "));
    }
    case "goto": {
      return app.goto(positional[0], { newTab: argv.includes("--new-tab") });
    }
    case "modal": {
      return cmdModal(
        app,
        argv.includes("--close") ? "--close" : positional[0],
      );
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
            ...(await resolveTarget(app)),
            settleMs: Number(flag(argv, "--settle", "2000")),
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

/**
 * One command in a chat's real sandbox, with stdout and stderr kept apart.
 * `run-bash` in a checkout answers a different question: it builds its own
 * sandbox from that checkout's dependencies, so it cannot see what a packaged
 * build bundles. Reach for this whenever the question is about the app that is
 * running rather than about the shell in the abstract.
 *
 * The session is the task's when `--task` (or the active tab) names one, and
 * otherwise the chat's own, which `chats.byId` reports.
 */
async function cmdBash(app, commandText) {
  if (!commandText) {
    fail(
      `Usage: bash <command> [--chat <chat-id>] [--task <session-id>]\n` +
        `  bash 'ffprobe /nope.mp4 2>/dev/null; echo exit=$?' --chat <chat-id>\n` +
        `Needs Developer Mode on, and a build carrying workspace.debug.runBash.`,
    );
  }
  const { chatId, sessionId: taskSession } = await resolveTarget(app);
  let sessionId = taskSession;
  if (!sessionId) {
    const chat = await app.rpc("workspace.chats.byId", { id: chatId });
    if (!chat) {
      fail(`No chat ${chatId}.`);
    }
    sessionId = chat.sessionId;
  }
  return app.rpc("workspace.debug.runBash", {
    chatId,
    command: commandText,
    sessionId,
  });
}

async function cmdRpc(app, route, rawInput) {
  if (!route) {
    fail(
      `Usage: rpc <route> [json]\n` +
        `  rpc workspace.chats.byId '{"id":"<chat-id>"}'\n` +
        `  rpc workspace.chats.tasks '{"id":"<chat-id>"}'`,
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

/**
 * The chat named by `--chat`, and the task in it by `--task` (its session),
 * or else what the active tab is showing: a chat at `/chats/<id>`, a task at
 * `/tasks/<session>?chat=<id>`.
 */
async function resolveTarget(app) {
  const chatId = flag(argv, "--chat");
  const sessionId = flag(argv, "--task");
  if (chatId) {
    return { chatId, ...(sessionId ? { sessionId } : {}) };
  }
  // Reading the active tab needs the dev-only handle, though the commands
  // themselves do not. Say so here rather than spending the handle's timeout
  // to report a missing dev build, which is not what a packaged build is
  // missing.
  if (!(await evaluate(app.cdp, "Boolean(window.__studioDrive)"))) {
    fail(
      "Pass --chat. Taking the chat from the active tab needs the dev-only handle, " +
        "which a packaged build omits; the command itself does not.",
    );
  }
  const { path: routePath } = await evaluate(
    app.cdp,
    "window.__studioDrive.state()",
  );
  const url = new URL(routePath ?? "/", "app://studio");
  const chat = /^\/chats\/([^/]+)$/.exec(url.pathname);
  if (chat) {
    return { chatId: decodeURIComponent(chat[1]) };
  }
  const task = /^\/tasks\/([^/]+)$/.exec(url.pathname);
  const taskChat = url.searchParams.get("chat");
  if (task && taskChat) {
    return { chatId: taskChat, sessionId: decodeURIComponent(task[1]) };
  }
  fail(
    `No --chat, and the active tab is not a chat or a task (path: ${routePath ?? "none"}).`,
  );
}
