// Installs, starts, stops and tunnels to Instrument preview builds on a macOS
// test host over SSH, and resets that host when it is a UTM virtual machine.
//
//   node mac-studio-host.mjs install-preview --host <ssh-host> --run <run-id>
//   node mac-studio-host.mjs start  --host <ssh-host> [--name <preview-name>]
//   node mac-studio-host.mjs stop   --host <ssh-host>
//   node mac-studio-host.mjs tunnel --host <ssh-host> [--local-port <port>]
//   node mac-studio-host.mjs status --host <ssh-host>
//   node mac-studio-host.mjs reset-vm --base <utm-vm> --vm <utm-vm> --host <ssh-host> [--dir <folder>]
//
// A preview carries its own bundle id, so macOS keeps its privacy answers
// apart from the installed app's and every build is a first launch. It is
// started with `open`, so the app is its own responsible process and its
// privacy prompts name it rather than the shell that started it.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const CDP_PORT = 48183;
const PREVIEW_ARCHIVE_PATTERN =
  /^Instrument Preview \(([\da-z-]+)\)-.*-arm64-mac\.zip$/u;
const NAME_PATTERN = /^[\da-z-]+$/u;
const HOST_PATTERN = /^[\w.-]+$/u;
const VM_PATTERN = /^[\w .-]+$/u;

class CliError extends Error {}

const argv = process.argv.slice(2);

function fail(message) {
  throw new CliError(message);
}

function takeFlag(name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`Missing value for ${name}.`);
  argv.splice(index, 2);
  return value;
}

async function main() {
  const command = argv.shift();
  const host = takeFlag("--host");
  if (!host || !HOST_PATTERN.test(host)) fail("Pass --host <ssh-host>.");
  switch (command) {
    case "install-preview": {
      const run = takeFlag("--run");
      if (!run || !/^\d+$/u.test(run)) fail("Pass --run <preview run id>.");
      return report(installPreview(host, run));
    }
    case "start": {
      const name = takeFlag("--name", "");
      if (name && !NAME_PATTERN.test(name)) fail(`Invalid name ${name}.`);
      return report(
        runJson(host, startScript(name, Number(takeFlag("--timeout", "60")))),
      );
    }
    case "stop":
      return report(runJson(host, stopScript()));
    case "status":
      return report(runJson(host, statusScript()));
    case "tunnel":
      return tunnel(host, takeFlag("--local-port"));
    case "reset-vm": {
      const base = takeFlag("--base");
      const vm = takeFlag("--vm");
      if (!base || !vm || !VM_PATTERN.test(base) || !VM_PATTERN.test(vm)) {
        fail("Pass --base <clean UTM VM> --vm <UTM VM to replace>.");
      }
      return report(await resetVm(host, base, vm, takeFlag("--dir")));
    }
    default:
      fail(
        `Unknown command ${JSON.stringify(command)}. Use install-preview, start, stop, status, tunnel, or reset-vm.`,
      );
  }
}

function report(value) {
  console.log(JSON.stringify(value, undefined, 2));
}

/** A bash script sent on stdin, so nothing in it has to survive quoting. */
function runRemote(host, script) {
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", host, "bash", "-s"], {
    encoding: "utf8",
    input: script,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(
      `Remote command failed (${result.status}).\n${`${result.stdout}\n${result.stderr}`.trim()}`,
    );
  }
  return result.stdout.trim();
}

function runJson(host, script) {
  const output = runRemote(host, script);
  try {
    return JSON.parse(output.split("\n").at(-1));
  } catch {
    fail(`Remote command did not end with JSON:\n${output}`);
  }
}

const APP_FUNCTIONS = String.raw`
preview_app() {
  # The named preview, or the most recently installed.
  if [ -n "$1" ]; then
    app="/Applications/Instrument Preview ($1).app"
  else
    app=$(ls -dt /Applications/Instrument\ Preview\ \(*\).app 2>/dev/null | head -1)
  fi
  [ -n "$app" ] && [ -d "$app" ] || { echo "No preview is installed $1. Run install-preview first." >&2; exit 1; }
  printf '%s' "$app"
}
# Processes whose command line starts with a prefix, matched as plain text:
# an app's name holds parentheses, which a pgrep pattern would read as a group.
pids_with_prefix() {
  ps -axo pid=,args= | awk -v prefix="$1" '{ pid = $1; sub(/^[ ]*[0-9]+[ ]+/, ""); if (index($0, prefix) == 1) print pid }'
}
main_pids() {
  # Processes running the app's own executable: the main process. Helpers
  # live under Contents/Frameworks and are left to exit with it.
  pids_with_prefix "$1/Contents/MacOS/"
}
# A JSON string, in plain shell: /usr/bin/python3 on a Mac without Apple's
# developer tools raises a dialog offering to install them.
json_escape() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"; }
`;

function installPreview(host, run) {
  const listing = spawnSync(
    "gh",
    [
      "api",
      `repos/instrument-org/instrument/actions/runs/${run}/artifacts`,
      "--jq",
      ".artifacts[] | [.id, .name, .expired] | @tsv",
    ],
    { encoding: "utf8" },
  );
  if (listing.status !== 0)
    fail(`gh could not list run ${run}'s artifacts.\n${listing.stderr}`);
  const artifact = listing.stdout
    .trim()
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, name]) => PREVIEW_ARCHIVE_PATTERN.test(name ?? ""));
  if (!artifact)
    fail(
      `Run ${run} has no macOS preview. Was it built with -f os=mac or all, and has that leg finished?`,
    );
  const [id, artifactName, expired] = artifact;
  if (expired === "true") fail(`Run ${run}'s macOS preview has expired.`);
  const [, name] = PREVIEW_ARCHIVE_PATTERN.exec(artifactName);
  const cacheDir = path.join(tmpdir(), "instrument-previews");
  mkdirSync(cacheDir, { recursive: true });
  const local = path.join(cacheDir, `${id}.zip`);
  if (!existsSync(local)) {
    // The artifact is the zip itself; gh run download would unzip it and drop
    // the symlinks a framework's signature depends on.
    const download = spawnSync(
      "sh",
      [
        "-c",
        `gh api "repos/instrument-org/instrument/actions/artifacts/${id}/zip" > "${local}.part" && mv "${local}.part" "${local}"`,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    if (download.status !== 0) fail(`Downloading artifact ${id} failed.`);
  }
  const remote = `/tmp/instrument-preview-${name}.zip`;
  const copy = spawnSync("scp", ["-q", local, `${host}:${remote}`], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (copy.status !== 0) fail(`Copying the preview to ${host} failed.`);
  return runJson(
    host,
    `set -e
${APP_FUNCTIONS}
app="/Applications/Instrument Preview (${name}).app"
rm -rf "$app"
# ditto keeps the bundle's symlinks and signature intact, as Finder would.
ditto -x -k "${remote}" /Applications/
rm -f "${remote}"
signature=$(codesign --verify --deep --strict "$app" 2>&1 && echo valid || echo invalid)
notarized=$(spctl --assess --type execute "$app" 2>&1 && echo accepted || echo rejected)
bundle=$(defaults read "$app/Contents/Info" CFBundleIdentifier)
version=$(defaults read "$app/Contents/Info" CFBundleShortVersionString)
printf '{"app":%s,"bundleId":"%s","name":"${name}","run":"${run}","signature":"%s","gatekeeper":"%s","version":"%s"}\n' "$(json_escape "$app")" "$bundle" "$signature" "$notarized" "$version"`,
  );
}

function startScript(name, timeoutSeconds) {
  return `set -e
${APP_FUNCTIONS}
app=$(preview_app "${name}")
if curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  owner=$(lsof -nP -iTCP:${CDP_PORT} -sTCP:LISTEN -t | head -1)
  owner_path=$(ps -o comm= -p "$owner")
  case "$owner_path" in
    "$app"/*) reused=true ;;
    *) echo "CDP port ${CDP_PORT} is held by $owner_path. Stop it first." >&2; exit 1 ;;
  esac
else
  if [ -n "$(main_pids "$app")" ]; then
    echo "$(basename "$app") is already running without the CDP port. Stop it first." >&2; exit 1
  fi
  reused=false
  # open, so the app is its own responsible process for privacy prompts.
  open -n -g -a "$app" --env DISABLE_AUTO_UPDATE_POLLING=true --args --remote-debugging-port=${CDP_PORT}
fi
for i in $(seq 1 $((${timeoutSeconds} * 2))); do
  if curl -sf "http://127.0.0.1:${CDP_PORT}/json/list" 2>/dev/null | grep -Eq 'app\\.asar/out/renderer|://app/index\\.html'; then
    printf '{"app":%s,"port":${CDP_PORT},"reused":%s}\n' "$(json_escape "$app")" "$reused"
    exit 0
  fi
  sleep 0.5
done
echo "The preview's CDP did not become ready on port ${CDP_PORT} within ${timeoutSeconds} seconds. A first launch may be waiting on a macOS dialog; look at the screen." >&2
exit 1`;
}

function stopScript() {
  return `set -e
${APP_FUNCTIONS}
signaled=""
for app in /Applications/Instrument\\ Preview\\ \\(*\\).app; do
  [ -d "$app" ] || continue
  for pid in $(main_pids "$app"); do kill -TERM "$pid" 2>/dev/null && signaled="$signaled $pid"; done
done
for i in $(seq 1 20); do
  left=$(pids_with_prefix "/Applications/Instrument Preview (")
  [ -z "$left" ] && break
  sleep 0.5
done
killed=""
for pid in $(pids_with_prefix "/Applications/Instrument Preview ("); do kill -KILL "$pid" 2>/dev/null && killed="$killed $pid"; done
# A program a task started can outlive the app holding the CDP socket.
holder=$(lsof -nP -iTCP:${CDP_PORT} -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
[ -n "$holder" ] && kill -KILL "$holder" 2>/dev/null && killed="$killed $holder"
printf '{"signaled":"%s","killed":"%s"}\n' "\${signaled# }" "\${killed# }"`;
}

function statusScript() {
  return `${APP_FUNCTIONS}
items=""
for app in /Applications/Instrument\\ Preview\\ \\(*\\).app; do
  [ -d "$app" ] || continue
  running=false; [ -n "$(main_pids "$app")" ] && running=true
  items="$items$(printf '{"app":%s,"running":%s},' "$(json_escape "$app")" "$running")"
done
cdp=false; curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1 && cdp=true
printf '{"previews":[%s],"cdpLive":%s,"macOS":"%s"}\n' "\${items%,}" "$cdp" "$(sw_vers -productVersion)"`;
}

async function firstFreePort(start) {
  for (let port = start; port < start + 50; port++) {
    const free = await new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  fail(`No free local port from ${start}; pass --local-port.`);
}

async function tunnel(host, requested) {
  const localPort = requested
    ? Number(requested)
    : await firstFreePort(CDP_PORT + 1000);
  console.error(
    `Forwarding http://127.0.0.1:${localPort} to ${host} preview CDP port ${CDP_PORT}. Press Ctrl-C to stop.`,
  );
  const child = spawn(
    "ssh",
    [
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-N",
      "-L",
      `${localPort}:127.0.0.1:${CDP_PORT}`,
      host,
    ],
    { stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  process.exitCode = await new Promise((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );
}

function utm(...args) {
  const result = spawnSync("utmctl", args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    out: `${result.stdout}${result.stderr}`.trim(),
  };
}

/** Hides UTM, as Cmd-H does; its windows come back from the Dock. */
function hideUtm() {
  spawnSync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    "ObjC.import('AppKit'); var a = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.utmapp.UTM'); a.count ? a.firstObject.hide : false",
  ]);
}

/**
 * Has UTM running from an ordinary launch before any command that changes a
 * VM. utmctl launches a stopped UTM hidden, and UTM 4.7.5 launched hidden
 * ignores every such command, with no error, until its main window has been
 * shown once (utmapp/UTM#7949). A background launch shows the window behind
 * the app in front, and it is hidden right after.
 */
async function wakeUtm() {
  if (spawnSync("pgrep", ["-x", "UTM"]).status === 0) return;
  spawnSync("open", ["-g", "-a", "UTM"]);
  await sleep(5000);
  hideUtm();
}

/**
 * Starts a VM without putting its window in front of the person at the Mac.
 * `utmctl start --hide` only closes UTM's library window and still shows the
 * VM's display window, so UTM itself is hidden before the start and for a few
 * seconds after, while the window is ordered in. A start UTM ignored fails
 * here rather than as an SSH timeout minutes later.
 */
async function startHidden(vm) {
  await wakeUtm();
  hideUtm();
  // utmctl reports an error when UTM is already hidden, though the VM starts.
  utm("start", vm, "--hide");
  for (let i = 0; i < 6; i++) {
    hideUtm();
    await sleep(500);
  }
  for (let i = 0; i < 30 && vmStatus(vm) !== "started"; i++) await sleep(1000);
  if (vmStatus(vm) !== "started")
    fail(
      `UTM did not start ${vm}. A UTM launched hidden ignores VM commands until its window has been shown once (utmapp/UTM#7949): open UTM from the Dock, then run this again.`,
    );
}

function vmStatus(vm) {
  return utm("status", vm).out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Replaces a UTM VM with a fresh clone of a clean one, then starts it and
 * waits for SSH: every run that follows is a first launch on a machine no
 * earlier run touched. Runs on the Mac hosting UTM. The clone shares disk
 * with its base until it diverges, so this costs seconds and little space,
 * as long as both are on one volume: `utmctl clone` always writes into
 * UTM's own storage, so with `dir`, the folder holding the base's bundle,
 * the clone is made beside it instead (`cloneBeside`).
 */
async function resetVm(host, base, vm, dir) {
  if (base === vm)
    fail(
      `--vm must name the clone, not the base: resetting ${vm} would delete the clean copy.`,
    );
  await wakeUtm();
  if (vmStatus(base) !== "stopped")
    fail(`${base} must stay stopped; it is the clean copy.`);
  if (dir) checkBaseBundle(base, dir);
  // The clone is thrown away, so it is powered off rather than shut down.
  if (vmStatus(vm) === "started") {
    utm("stop", vm, "--force");
    for (let i = 0; i < 12 && vmStatus(vm) !== "stopped"; i++)
      await sleep(2500);
    if (vmStatus(vm) !== "stopped")
      fail(`${vm} did not stop within 30 seconds, so it was not deleted.`);
  }
  if (!/not found|Error/u.test(vmStatus(vm))) {
    utm("delete", vm);
    // A delete UTM ignored would leave the old clone to be started again.
    if (!/not found|Error/u.test(vmStatus(vm)))
      fail(
        `UTM did not delete ${vm}. A UTM launched hidden ignores VM commands until its window has been shown once (utmapp/UTM#7949): open UTM from the Dock, then run this again.`,
      );
  }
  if (dir) {
    await cloneBeside(base, vm, dir);
  } else {
    const cloned = utm("clone", base, "--name", vm);
    if (!cloned.ok || vmStatus(vm) !== "stopped")
      fail(`Cloning ${base} failed: ${cloned.out}`);
  }
  await startHidden(vm);
  for (let i = 0; i < 36; i++) {
    const probe = spawnSync(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", host, "echo up"],
      { encoding: "utf8" },
    );
    if (probe.stdout.trim() === "up") {
      quietDesktop(host);
      return { base, host, ready: true, vm };
    }
    await sleep(5000);
  }
  fail(`${vm} started but ${host} did not answer SSH within three minutes.`);
}

/** Fails unless `dir` holds the bundle UTM has registered as `base`. */
function checkBaseBundle(base, dir) {
  const from = path.join(dir, `${base}.utm`);
  const baseId = utm("list")
    .out.split("\n")
    .map((line) => /^(\S+)\s+\S+\s+(.+)$/u.exec(line.trim()))
    .find((match) => match?.[2] === base)?.[1];
  const bundleId = spawnSync(
    "plutil",
    ["-extract", "Information.UUID", "raw", path.join(from, "config.plist")],
    { encoding: "utf8" },
  ).stdout.trim();
  if (!baseId || baseId !== bundleId)
    fail(
      `${from} is not the bundle UTM has registered as ${base}. Pass --dir the folder holding ${base}.utm.`,
    );
}

/**
 * Clones the base's bundle in `dir` to `<vm>.utm` beside it with `cp -c`, a
 * copy-on-write clone on APFS, and registers it with UTM as a shortcut, as
 * opening a bundle from outside UTM's storage does. It gets a UUID and name
 * of its own, which is all `utmctl clone` changes in an Apple VM. A bundle
 * left behind by a delete UTM could not reach is removed first.
 */
async function cloneBeside(base, vm, dir) {
  const from = path.join(dir, `${base}.utm`);
  const to = path.join(dir, `${vm}.utm`);
  rmSync(to, { force: true, recursive: true });
  const copied = spawnSync("cp", ["-c", "-R", from, to], { encoding: "utf8" });
  if (copied.status !== 0) {
    rmSync(to, { force: true, recursive: true });
    fail(`Cloning ${from} failed: ${copied.stderr.trim()}`);
  }
  const config = path.join(to, "config.plist");
  for (const [key, value] of [
    ["Information.UUID", randomUUID().toUpperCase()],
    ["Information.Name", vm],
  ]) {
    const set = spawnSync(
      "plutil",
      ["-replace", key, "-string", value, config],
      {
        encoding: "utf8",
      },
    );
    if (set.status !== 0)
      fail(`Could not set ${key} in ${config}: ${set.stderr.trim()}`);
  }
  hideUtm();
  spawnSync("open", ["-g", "-a", "UTM", to]);
  for (let i = 0; i < 20 && vmStatus(vm) !== "stopped"; i++) {
    hideUtm();
    await sleep(500);
  }
  if (vmStatus(vm) !== "stopped")
    fail(
      `UTM did not register ${to}. A UTM launched hidden ignores VM commands until its window has been shown once (utmapp/UTM#7949): open UTM from the Dock, then run this again.`,
    );
}

/**
 * Keeps the clone's desktop drivable for a long run: the base's screen saver
 * starts after about 20 idle minutes and covers privacy prompts, and a click
 * on the wallpaper slides every window away to show the desktop.
 */
function quietDesktop(host) {
  spawnSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      host,
      "defaults -currentHost write com.apple.screensaver idleTime -int 0; defaults write com.apple.WindowManager EnableStandardClickToShowDesktop -bool false; killall WindowManager 2>/dev/null; true",
    ],
    { encoding: "utf8" },
  );
}

// Last, so every constant above is defined before main reads it.
try {
  await main();
} catch (error) {
  console.error(`mac-studio-host: ${error.message}`);
  if (!(error instanceof CliError)) console.error(error.stack);
  process.exitCode = 1;
}
