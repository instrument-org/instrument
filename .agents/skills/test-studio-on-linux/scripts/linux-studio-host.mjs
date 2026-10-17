import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

// cspell:ignore Xauthority cmdline expanduser isdigit listdir ltnp rsplit splitlines urlopen -- Python builtins, ss flags and proc entries inside the generated host script

const PROFILE_RELATIVE_PATH = ".instrument/studio-host.json";
// A preview build unpacks under its own name rather than installing, so its
// target names only a port and the transient unit it runs as; the executable is
// found at start, from the preview name or the most recently unpacked.
const PREVIEW_TARGET = "preview";
const PROFILE_KEYS = {
  installed: "installed",
  preview: "preview",
};
const PREVIEW_ARCHIVE_PATTERN =
  /^Instrument Preview \(([\da-z-]+)\)-linux-.*-(arm64|x64)\.tar\.gz$/u;
const PREVIEW_NAME_PATTERN = /^[\da-z-]+$/u;
const PREVIEWS_DIR = "~/.local/share/instrument-previews";
const TARGETS = new Set(Object.keys(PROFILE_KEYS));

class CliError extends Error {}

const argv = process.argv.slice(2);

try {
  await main();
} catch (error) {
  console.error(`linux-studio-host: ${error.message}`);
  if (!(error instanceof CliError)) {
    console.error(error.stack);
  }
  process.exitCode = 1;
}

function assertNoArguments() {
  if (argv.length > 0) {
    fail(
      `Unexpected argument${argv.length === 1 ? "" : "s"}: ${argv.join(" ")}`,
    );
  }
}

async function firstFreePort(start) {
  for (let port = start; port < start + 50; port++) {
    try {
      await assertPortAvailable(port);
      return port;
    } catch {
      // Taken; try the next one.
    }
  }
  fail(
    `No free local port between ${start} and ${start + 49}; pass --local-port.`,
  );
}

function assertPortAvailable(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail(`Invalid local port ${JSON.stringify(port)}.`);
  }
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => {
      reject(new Error(`Local port ${port} is already in use.`));
    });
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

/**
 * Python that establishes `profile` and `target`. Every target's endpoint is
 * loopback-only on one host, so a profile that reuses a port or a unit across
 * targets would have two of them fighting over the same listener without
 * either saying so.
 */
function baseScript(selectedTarget) {
  return `import json, os, re, subprocess, sys, time, urllib.request

PROFILE_PATH = os.path.join(os.path.expanduser("~"), "${PROFILE_RELATIVE_PATH}")


def fail(message):
    raise SystemExit("linux-studio-host: " + message)


try:
    with open(PROFILE_PATH, encoding="utf-8") as handle:
        profile = json.load(handle)
except FileNotFoundError:
    fail("Missing host profile: " + PROFILE_PATH)
except ValueError as error:
    fail("Host profile is not valid JSON: %s" % error)

if profile.get("schemaVersion") != 1:
    fail("Unsupported host profile schema: %r" % profile.get("schemaVersion"))

configured = [profile[key] for key in ("dev", "devSeeded", "installed", "preview") if profile.get(key)]
ports = [entry.get("cdpPort") for entry in configured]
units = [entry.get("unit") for entry in configured]
if len(set(ports)) != len(ports):
    fail("The host profile must give each target its own CDP port.")
if len(set(units)) != len(units):
    fail("The host profile must give each target its own systemd unit.")

target = profile.get("${PROFILE_KEYS[selectedTarget]}")
if not target:
    fail("The host profile has no ${PROFILE_KEYS[selectedTarget]} entry. See references/host-enrollment.md.")
`;
}

/**
 * Python that reports what is behind the CDP port. The owning process is read
 * from the listener rather than from the unit, so a port answering because
 * something else claimed it is distinguishable from the enrolled app.
 */
function cdpFunction() {
  return `def fetch_json(url):
    with urllib.request.urlopen(url, timeout=3) as response:
        return json.load(response)


def listener_owner(port):
    try:
        listing = subprocess.run(
            ["ss", "-ltnp", "sport = :%d" % port],
            capture_output=True, text=True, timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    for line in listing.splitlines():
        if line.startswith("State"):
            continue
        fields = line.split()
        if len(fields) < 4:
            continue
        match = re.search(r"pid=(\\d+)", line)
        if not match:
            continue
        pid = int(match.group(1))
        try:
            executable = os.readlink("/proc/%d/exe" % pid)
        except OSError:
            executable = None
        try:
            with open("/proc/%d/cmdline" % pid, "rb") as handle:
                command_line = " ".join(
                    part for part in handle.read().decode("utf-8", "replace").split("\\0") if part
                )
        except OSError:
            command_line = None
        return {
            "commandLine": command_line,
            "executablePath": executable,
            # ss renders the port after the last colon, which is the only split
            # that survives an IPv6 local address.
            "localAddress": fields[3].rsplit(":", 1)[0],
            "processId": pid,
        }
    return {}


def cdp_status(port):
    try:
        version = fetch_json("http://127.0.0.1:%d/json/version" % port)
        targets = fetch_json("http://127.0.0.1:%d/json/list" % port)
    except Exception:
        return {"live": False}
    return {
        "browser": version.get("Browser"),
        "live": True,
        "owner": listener_owner(port),
        "targets": [
            {"title": entry.get("title"), "type": entry.get("type"), "url": entry.get("url")}
            for entry in targets
        ],
        "userAgent": version.get("User-Agent"),
    }


def assert_target_cdp(status):
    if not status.get("live"):
        return
    agent = status.get("userAgent") or ""
    if "Instrument/" not in agent or "Instrument(Dev)/" in agent:
        fail("CDP port %d belongs to an unexpected application: %s" % (target["cdpPort"], agent))
    owner = status.get("owner") or {}
    if owner.get("executablePath") != target["executable"]:
        fail(
            "CDP port %d is owned by %s, not the configured installed executable"
            % (target["cdpPort"], owner.get("executablePath"))
        )
    if owner.get("localAddress") not in ("127.0.0.1", "[::1]", "::1"):
        fail("CDP port %d is not bound to loopback: %s" % (target["cdpPort"], owner.get("localAddress")))


def renderer_ready(status):
    return any(
        entry.get("type") == "page"
        and re.match(r"^file://.*/resources/app\\.asar/out/renderer/", entry.get("url") or "")
        for entry in status.get("targets") or []
    )
`;
}

function fail(message) {
  throw new CliError(message);
}

/**
 * Python that reports the unit as systemd sees it. The contract is checked
 * against `ExecStart` and `Environment` as strings because that is what the
 * unit actually runs, rather than what a unit file on disk says it would.
 */
function inspectFunction() {
  return `def unit_properties(unit):
    listing = subprocess.run(
        [
            "systemctl", "--user", "show", unit,
            "--property=ActiveState,Environment,ExecStart,LoadState,MainPID,SubState,UnitFileState,WorkingDirectory",
        ],
        capture_output=True, text=True, timeout=10,
    ).stdout
    properties = {}
    for line in listing.splitlines():
        if "=" in line:
            key, _, value = line.partition("=")
            properties[key] = value
    return properties


def graphical_session():
    listing = subprocess.run(
        ["systemctl", "--user", "show-environment"], capture_output=True, text=True, timeout=10,
    ).stdout
    environment = {}
    for line in listing.splitlines():
        if "=" in line:
            key, _, value = line.partition("=")
            environment[key] = value
    return {
        "display": environment.get("DISPLAY"),
        # The launcher inherits this environment rather than pinning it: the
        # Xauthority path is regenerated every login, so a unit that hardcoded
        # it would work until the next reboot.
        "present": bool(environment.get("DISPLAY") or environment.get("WAYLAND_DISPLAY")),
        "waylandDisplay": environment.get("WAYLAND_DISPLAY"),
        "xdgRuntimeDir": environment.get("XDG_RUNTIME_DIR"),
    }


def app_scopes():
    """Scopes holding the configured executable.

    GNOME re-homes a launched app into its own app scope, so the unit's cgroup
    is empty by the time systemd reports the unit stopped and its children
    survive. They are found by reading each process's own cgroup rather than by
    guessing a scope name, which also catches a helper shell that inherited the
    listening socket without being the executable itself.
    """
    scopes = set()
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            if os.readlink("/proc/%s/exe" % entry) != target["executable"]:
                continue
            with open("/proc/%s/cgroup" % entry, encoding="utf-8") as handle:
                cgroup = handle.read().strip()
        except OSError:
            continue
        name = cgroup.rsplit("/", 1)[-1]
        if name.endswith(".scope"):
            scopes.add(name)
    return sorted(scopes)


def running_outside_unit():
    listing = subprocess.run(
        ["pgrep", "-a", "-f", "^" + re.escape(target["executable"])],
        capture_output=True, text=True, timeout=10,
    ).stdout
    return [line for line in listing.splitlines() if line.strip()]


def validation(properties, status):
    # None for a preview with nothing running or unpacked: then nothing can match it.
    executable = target.get("executable")
    exec_start = properties.get("ExecStart") or ""
    owner = status.get("owner") or {}
    agent = status.get("userAgent") or ""
    return {
        "cdpConfigured": ("--remote-debugging-port=%d" % target["cdpPort"]) in exec_start,
        "commandConfigured": bool(executable) and executable in exec_start,
        "loopback": bool(status.get("live")) and owner.get("localAddress") in ("127.0.0.1", "[::1]", "::1"),
        "ownerMatches": bool(status.get("live")) and bool(executable) and owner.get("executablePath") == executable,
        "rendererReady": renderer_ready(status),
        "updaterPollingDisabled": "DISABLE_AUTO_UPDATE_POLLING=true" in (properties.get("Environment") or ""),
        "userAgentMatches": "Instrument/" in agent and "Instrument(Dev)/" not in agent,
        "workingDirectoryMatches": bool(executable) and (properties.get("WorkingDirectory") or "") == os.path.dirname(executable),
    }
`;
}

async function main() {
  const command = argv.shift();
  const host = takeFlag("--host");
  const target = takeFlag("--target", "installed");

  if (!host) {
    fail("Pass --host <ssh-host>.");
  }
  if (!TARGETS.has(target)) {
    fail(
      `Unknown target ${JSON.stringify(target)}. Use ${[...TARGETS].join(", ")}.`,
    );
  }

  if (target === PREVIEW_TARGET && ["start", "stop"].includes(command)) {
    const name = command === "start" ? takeFlag("--name", "") : "";
    const timeout = Number(takeFlag("--timeout", "45"));
    assertNoArguments();
    if (name && !PREVIEW_NAME_PATTERN.test(name)) {
      fail(`Invalid preview name ${JSON.stringify(name)}.`);
    }
    report(
      runPythonJson(
        host,
        command === "start"
          ? previewStartScript(name, timeout)
          : previewStopScript(),
      ),
    );
    return;
  }

  switch (command) {
    case "remove-preview": {
      const names = takeFlag("--name", "");
      const keepLatest = argv.includes("--all-but-latest");
      if (keepLatest) argv.splice(argv.indexOf("--all-but-latest"), 1);
      assertNoArguments();
      const list = names.split(",").filter(Boolean);
      if (list.some((name) => !PREVIEW_NAME_PATTERN.test(name))) {
        fail("Invalid preview name.");
      }
      if (list.length === 0 && !keepLatest) {
        fail("Pass --name <preview>[,<preview>…] or --all-but-latest.");
      }
      report(
        runPythonJson(
          host,
          `import json, os, shutil
root = os.path.expanduser("${PREVIEWS_DIR}")
folders = sorted((entry for entry in os.listdir(root) if os.path.isdir(os.path.join(root, entry))), key=lambda entry: os.path.getmtime(os.path.join(root, entry)), reverse=True) if os.path.isdir(root) else []
names = folders[1:] if ${keepLatest ? "True" : "False"} else ${JSON.stringify(list)}
running = set()
for pid in filter(str.isdigit, os.listdir("/proc")):
    try:
        running.add(os.readlink("/proc/%s/exe" % pid))
    except OSError:
        pass
removed, skipped = [], []
for name in names:
    folder = os.path.join(root, name)
    if not os.path.isdir(folder):
        skipped.append(name + " (not installed)")
        continue
    if any(path.startswith(folder + "/") for path in running):
        skipped.append(name + " (running)")
        continue
    shutil.rmtree(folder, ignore_errors=True)
    shutil.rmtree(os.path.expanduser("~/.config/Instrument Preview (%s)" % name), ignore_errors=True)
    removed.append(name)
free = shutil.disk_usage(os.path.expanduser("~")).free // (1 << 30)
print(json.dumps({"removed": removed, "skipped": skipped, "freeGB": free}))`,
        ),
      );
      return;
    }
    case "install-preview": {
      const run = takeFlag("--run");
      assertNoArguments();
      if (!run || !/^\d+$/u.test(run)) {
        fail("Pass --run <preview workflow run id>.");
      }
      report(installPreview(host, run));
      break;
    }
    case "profile": {
      assertNoArguments();
      report(readProfile(host, target));
      break;
    }
    case "start": {
      const timeout = Number(takeFlag("--timeout", "45"));
      if (!Number.isFinite(timeout) || timeout <= 0) {
        fail("--timeout must be a positive number of seconds.");
      }
      assertNoArguments();
      report(runPythonJson(host, startScript(target, timeout)));
      break;
    }
    case "status": {
      assertNoArguments();
      report(runPythonJson(host, statusScript(target)));
      break;
    }
    case "stop": {
      assertNoArguments();
      report(runPythonJson(host, stopScript(target)));
      break;
    }
    case "vm-start":
    case "vm-stop": {
      const vm = takeFlag("--vm");
      assertNoArguments();
      if (!vm) {
        fail("Pass --vm <UTM virtual machine name>.");
      }
      report(
        command === "vm-start"
          ? await startVm(host, vm)
          : await stopVm(host, vm),
      );
      break;
    }
    case "tunnel": {
      const remotePort = targetConfig(
        readProfile(host, target),
        target,
      ).cdpPort;
      const requestedPort = takeFlag("--local-port");
      assertNoArguments();
      // A port given is used or refused; without one, the first free port from
      // the conventional one up, since another tunnel (another host's, another
      // session's) may already hold it. The forwarding line names the port.
      const localPort = requestedPort
        ? Number(requestedPort)
        : await firstFreePort(remotePort + 1000);
      await assertPortAvailable(localPort);
      console.error(
        `Forwarding http://127.0.0.1:${localPort} to ${host} ${target} CDP port ${remotePort}. Press Ctrl-C to stop.`,
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
          `${localPort}:127.0.0.1:${remotePort}`,
          host,
        ],
        { stdio: "inherit" },
      );
      for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => child.kill(signal));
      }
      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      process.exitCode = exitCode ?? 1;
      break;
    }
    default: {
      fail(
        `Unknown command ${JSON.stringify(command)}. Use install-preview, profile, remove-preview, start, status, stop, tunnel, vm-start, or vm-stop.`,
      );
    }
  }
}

function utm(...args) {
  const result = spawnSync("utmctl", args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    out: `${result.stdout}${result.stderr}`.trim(),
  };
}

function answersSsh(host) {
  const probe = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", host, "echo up"],
    { encoding: "utf8" },
  );
  return probe.stdout.trim() === "up";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the UTM guest the host runs in, when this Mac hosts it, and waits for
 * SSH. The guest keeps its state between runs (the signed-in browser, the
 * installed release app), so unlike the Mac VM it is started, never replaced.
 */
async function startVm(host, vm) {
  const status = utm("status", vm).out;
  if (/not found|Error/u.test(status))
    fail(`No UTM virtual machine named ${vm}.`);
  if (answersSsh(host)) return { host, ready: true, started: false, vm };
  if (status !== "started") utm("start", vm, "--hide");
  for (let i = 0; i < 36; i++) {
    if (answersSsh(host)) return { host, ready: true, started: true, vm };
    await sleep(5000);
  }
  fail(`${vm} started but ${host} did not answer SSH within three minutes.`);
}

/**
 * Shuts the guest down from inside, so its disk and the release app's data are
 * left as a normal shutdown leaves them, and waits for UTM to report it
 * stopped. Never forces: a guest that will not stop is reported instead.
 */
async function stopVm(host, vm) {
  if (utm("status", vm).out === "stopped") return { stopped: true, vm };
  spawnSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      host,
      "sudo -n systemctl poweroff",
    ],
    {
      encoding: "utf8",
    },
  );
  for (let i = 0; i < 24; i++) {
    if (utm("status", vm).out === "stopped") return { stopped: true, vm };
    await sleep(5000);
  }
  fail(`${vm} did not stop within two minutes; it was left running.`);
}

function readProfile(hostName, selectedTarget) {
  const profile = runPythonJson(
    hostName,
    `${baseScript(selectedTarget)}
print(json.dumps(profile))`,
  );
  targetConfig(profile, selectedTarget);
  return profile;
}

function report(value) {
  console.log(JSON.stringify(value, undefined, 2));
}

/**
 * The script arrives on stdin rather than as an argument, so nothing in it has
 * to survive a shell's quoting on the way to the host.
 */
function runPython(hostName, script) {
  const result = spawnSync("ssh", [hostName, "python3", "-"], {
    encoding: "utf8",
    input: script,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    fail(
      `Remote command failed with exit code ${result.status}.${detail ? `\n${detail}` : ""}`,
    );
  }
  return result.stdout.trim();
}

function runPythonJson(hostName, script) {
  const output = runPython(hostName, script);
  try {
    return JSON.parse(output);
  } catch {
    fail(`Remote command did not return JSON:\n${output}`);
  }
}

function startScript(selectedTarget, timeoutSeconds) {
  return `${baseScript(selectedTarget)}
${cdpFunction()}
${inspectFunction()}
properties = unit_properties(target["unit"])
if properties.get("LoadState") != "loaded":
    fail("Missing systemd user unit: %s" % target["unit"])

checks = validation(properties, {"live": False})
if not checks["commandConfigured"] or not checks["cdpConfigured"] or not checks["updaterPollingDisabled"]:
    fail(
        "%s must launch the configured executable, disable updater polling, and pass its configured CDP port."
        % target["unit"]
    )
if not checks["workingDirectoryMatches"]:
    fail(
        "The installed unit working directory is %s, expected %s"
        % (properties.get("WorkingDirectory"), os.path.dirname(target["executable"]))
    )

session = graphical_session()
if not session["present"]:
    fail(
        "No graphical session is available to the systemd user manager. Log into the desktop, then retry."
    )

existing = cdp_status(target["cdpPort"])
assert_target_cdp(existing)
# A packaged build already running without the debug flag holds the
# single-instance lock, so a second launch would exit rather than add CDP.
if not existing["live"] and running_outside_unit():
    fail(
        "The installed app is already running without the configured CDP endpoint. Stop it before starting the installed target."
    )

if not existing["live"]:
    subprocess.run(["systemctl", "--user", "start", target["unit"]], check=True, timeout=30)

deadline = time.monotonic() + ${timeoutSeconds}
while time.monotonic() < deadline:
    status = cdp_status(target["cdpPort"])
    if status["live"]:
        assert_target_cdp(status)
        if renderer_ready(status):
            print(json.dumps({
                "cdp": status,
                "port": target["cdpPort"],
                "reused": existing["live"],
                "session": session,
                "target": "${selectedTarget}",
                "unit": target["unit"],
            }))
            raise SystemExit(0)
    time.sleep(0.5)

# A listener that accepts and never answers is a blocked main thread rather
# than an app that failed to start: /json/* needs a UI-thread hop, and a
# desktop-modal secret prompt holds that thread until someone clears it.
if listener_owner(target["cdpPort"]):
    fail(
        "CDP port %d accepted connections but never answered within ${timeoutSeconds} seconds. "
        "The app's main thread is blocked, and an unlocked-keyring prompt waiting on the desktop is the "
        "usual cause. Clear it, then retry." % target["cdpPort"]
    )

fail("${selectedTarget} CDP did not become ready on port %d within ${timeoutSeconds} seconds." % target["cdpPort"])`;
}

function statusScript(selectedTarget) {
  const isPreview = selectedTarget === PREVIEW_TARGET;
  return `${baseScript(selectedTarget)}
${cdpFunction()}
${inspectFunction()}
${isPreview ? previewFunction() : ""}
properties = unit_properties(target["unit"])
status = cdp_status(target["cdpPort"])
${
  isPreview
    ? `# A preview's profile entry names no executable. Its executable is the
# one holding the port, else one running, else the newest unpacked (what
# start would run), else none.
running = sorted({path for _, path in preview_processes()})
try:
    newest = preview_executable("")
except SystemExit:
    newest = None
target["executable"] = (status.get("owner") or {}).get("executablePath") or (running[0] if running else None) or newest
# The installed package's version says nothing about a preview.
version = None`
    : `try:
    version = subprocess.run(
        ["dpkg-query", "-W", "-f=\${Version}", "instrument"],
        capture_output=True, text=True, timeout=10,
    ).stdout.strip() or None
except (OSError, subprocess.SubprocessError):
    version = None`
}

print(json.dumps({
    "installed": {
        "activeState": properties.get("ActiveState"),
        "cdp": status,
        "execStart": properties.get("ExecStart"),
        "exists": properties.get("LoadState") == "loaded",
        "mainPid": properties.get("MainPID"),
        "port": target["cdpPort"],
        # True alongside a dead cdp entry means the process is up and holding
        # the port while something blocks it, which reads very differently from
        # an app that never started.
        "portListening": bool(listener_owner(target["cdpPort"])),
        "subState": properties.get("SubState"),
        "unit": target["unit"],
        "validation": validation(properties, status),
    },
    "installedExecutable": {
        "exists": bool(target["executable"]) and os.path.exists(target["executable"]),
        "path": target["executable"],
        "version": version,
    },
    "profilePath": PROFILE_PATH,
    "schemaVersion": profile.get("schemaVersion"),
    "session": graphical_session(),
}))`;
}

/**
 * Stopping the unit is enough on its own: systemd kills the whole cgroup, so
 * the renderer and GPU children go with the main process rather than needing a
 * process tree walked by hand. Anything left afterwards was started outside the
 * unit and is reported rather than killed.
 */
function stopScript(selectedTarget) {
  return `${baseScript(selectedTarget)}
${cdpFunction()}
${inspectFunction()}
subprocess.run(["systemctl", "--user", "stop", target["unit"]], check=False, timeout=60)
stopped_scopes = app_scopes()
for scope in stopped_scopes:
    subprocess.run(["systemctl", "--user", "stop", scope], check=False, timeout=60)
# An app killed rather than stopped leaves the unit failed, which is accurate
# but makes the next status read as a problem when nothing is wrong.
subprocess.run(["systemctl", "--user", "reset-failed", target["unit"]], check=False, timeout=30)
properties = unit_properties(target["unit"])
print(json.dumps({
    "activeState": properties.get("ActiveState"),
    "cdp": cdp_status(target["cdpPort"]),
    "portReleased": not listener_owner(target["cdpPort"]),
    "stoppedScopes": stopped_scopes,
    "survivingProcesses": running_outside_unit(),
    "target": "${selectedTarget}",
    "unit": target["unit"],
}))`;
}

function takeFlag(name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${name}.`);
  }
  argv.splice(index, 2);
  return value;
}

function targetConfig(profile, selectedTarget) {
  const key = PROFILE_KEYS[selectedTarget];
  const config = profile[key];
  if (
    !config ||
    !Number.isInteger(config.cdpPort) ||
    config.cdpPort < 1 ||
    config.cdpPort > 65_535 ||
    typeof config.unit !== "string"
  ) {
    fail(`The host profile must define ${key}.cdpPort and ${key}.unit.`);
  }
  if (
    selectedTarget !== PREVIEW_TARGET &&
    typeof config.executable !== "string"
  ) {
    fail(`The host profile must define ${key}.executable.`);
  }
  return config;
}

/**
 * Fetches a preview run's archive for the host's architecture through gh
 * (cached locally by artifact id), copies it over and unpacks it under the
 * previews folder. The archive rather than the AppImage, which needs FUSE.
 */
function installPreview(hostName, run) {
  const machine = runPython(
    hostName,
    "import platform; print(platform.machine())",
  );
  const arch = { aarch64: "arm64", x86_64: "x64" }[machine];
  if (!arch) fail(`Unknown host architecture ${JSON.stringify(machine)}.`);
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
  if (listing.status !== 0) {
    fail(`gh could not list run ${run}'s artifacts.\n${listing.stderr}`);
  }
  const artifact = listing.stdout
    .trim()
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, name]) => PREVIEW_ARCHIVE_PATTERN.exec(name ?? "")?.[2] === arch);
  if (!artifact) {
    fail(
      `Run ${run} has no Linux ${arch} archive. Was it built with -f os=linux or all, and has the Linux leg finished?`,
    );
  }
  const [id, artifactName, expired] = artifact;
  if (expired === "true") fail(`Run ${run}'s archive has expired.`);
  const [, name] = PREVIEW_ARCHIVE_PATTERN.exec(artifactName);
  const cacheDir = path.join(tmpdir(), "instrument-previews");
  mkdirSync(cacheDir, { recursive: true });
  const local = path.join(cacheDir, `${id}.tar.gz`);
  if (!existsSync(local)) {
    // gh run download expects every artifact to be a zip; this endpoint
    // returns an unzipped upload as the file itself.
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
  const remote = `/tmp/instrument-preview-${name}.tar.gz`;
  const copy = spawnSync("scp", ["-q", local, `${hostName}:${remote}`], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (copy.status !== 0) fail(`Copying the archive to ${hostName} failed.`);
  return runPythonJson(
    hostName,
    `import json, os, shutil, subprocess, tarfile, tempfile

name = "${name}"
root = os.path.expanduser("${PREVIEWS_DIR}")
dest = os.path.join(root, name)
archive = "${remote}"
os.makedirs(root, exist_ok=True)
if os.path.isdir(dest):
    shutil.rmtree(dest)
staging = tempfile.mkdtemp(dir=root)
with tarfile.open(archive) as handle:
    handle.extractall(staging, filter="tar")
os.remove(archive)
entries = os.listdir(staging)
top = os.path.join(staging, entries[0]) if len(entries) == 1 else staging
os.rename(top, dest)
if top != staging:
    os.rmdir(staging)
# The archive's folder carries the build's epoch-0 time, so it is stamped with
# the install time: "the newest preview" is decided by that time.
os.utime(dest, None)
# Chromium's setuid sandbox helper has to be owned by root and setuid, which
# an archive cannot carry; without it the app refuses to start.
sandbox = os.path.join(dest, "chrome-sandbox")
sandbox_ready = (
    subprocess.run(["sudo", "-n", "chown", "root:root", sandbox]).returncode == 0
    and subprocess.run(["sudo", "-n", "chmod", "4755", sandbox]).returncode == 0
)
executables = [
    os.path.join(dest, entry)
    for entry in os.listdir(dest)
    if entry.startswith("instrument-preview-") and os.access(os.path.join(dest, entry), os.X_OK)
]
print(json.dumps({
    "executable": executables[0] if executables else None,
    "name": name,
    "run": "${run}",
    "sandboxReady": sandbox_ready,
}))`,
  );
}

/** Python that finds an unpacked preview: the one named, or the newest. */
function previewFunction() {
  return `def preview_executable(name):
    root = os.path.expanduser("${PREVIEWS_DIR}")
    if name:
        folder = os.path.join(root, name)
    else:
        folders = [os.path.join(root, entry) for entry in os.listdir(root)] if os.path.isdir(root) else []
        folders = [entry for entry in folders if os.path.isdir(entry)]
        folder = max(folders, key=os.path.getmtime) if folders else None
    if not folder or not os.path.isdir(folder):
        fail("No preview is unpacked%s. Run install-preview first." % (" as " + name if name else ""))
    for entry in sorted(os.listdir(folder)):
        candidate = os.path.join(folder, entry)
        if entry.startswith("instrument-preview-") and os.access(candidate, os.X_OK) and os.path.isfile(candidate):
            return candidate
    fail("%s holds no instrument-preview executable." % folder)


def preview_processes():
    root = os.path.realpath(os.path.expanduser("${PREVIEWS_DIR}")) + os.sep
    found = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            executable = os.readlink("/proc/%s/exe" % entry)
        except OSError:
            continue
        if executable.startswith(root):
            found.append((int(entry), executable))
    return found
`;
}

/**
 * Python that runs a preview as a transient user unit, which inherits the
 * graphical session's environment the way the installed unit does, and waits
 * for its renderer. The unit lasts as long as any process in it, so a restart
 * the app makes for itself survives the exit of the process that started it.
 */
function previewStartScript(name, timeoutSeconds) {
  return `${baseScript(PREVIEW_TARGET)}
${cdpFunction()}
${inspectFunction()}
${previewFunction()}
executable = preview_executable("${name}")
existing = cdp_status(target["cdpPort"])
if existing["live"] and (existing.get("owner") or {}).get("executablePath") != executable:
    fail("CDP port %d is held by %s. Stop the preview target first." % (target["cdpPort"], (existing.get("owner") or {}).get("executablePath")))
if not existing["live"]:
    if any(path == executable for _, path in preview_processes()):
        fail("%s is already running without the CDP port. Stop the preview target first." % os.path.basename(executable))
    if not graphical_session()["present"]:
        fail("No graphical session is available to the systemd user manager. Log into the desktop, then retry.")
    subprocess.run(["systemctl", "--user", "reset-failed", target["unit"]], check=False, capture_output=True, timeout=30)
    subprocess.run(
        [
            "systemd-run", "--user", "--collect", "--unit=" + target["unit"],
            "--property=ExitType=cgroup",
            "--setenv=DISABLE_AUTO_UPDATE_POLLING=true",
            "--working-directory=" + os.path.dirname(executable),
            executable, "--remote-debugging-port=%d" % target["cdpPort"],
        ],
        check=True, capture_output=True, timeout=30,
    )

deadline = time.monotonic() + ${timeoutSeconds}
while time.monotonic() < deadline:
    status = cdp_status(target["cdpPort"])
    if status["live"] and renderer_ready(status):
        print(json.dumps({
            "cdp": status,
            "executable": executable,
            "port": target["cdpPort"],
            "reused": existing["live"],
            "target": "${PREVIEW_TARGET}",
            "unit": target["unit"],
        }))
        raise SystemExit(0)
    time.sleep(0.5)
if listener_owner(target["cdpPort"]):
    fail(
        "CDP port %d accepted connections but never answered within ${timeoutSeconds} seconds. "
        "An unlocked-keyring prompt waiting on the desktop is the usual cause. Clear it, then retry." % target["cdpPort"]
    )
fail("The preview's CDP did not become ready on port %d within ${timeoutSeconds} seconds." % target["cdpPort"])`;
}

/**
 * Python that stops every unpacked preview. GNOME can re-home an app's
 * processes into a scope of their own, so they are found by executable and
 * signaled directly once the unit is stopped.
 */
function previewStopScript() {
  return `${baseScript(PREVIEW_TARGET)}
${cdpFunction()}
${previewFunction()}
import signal
# The main process alone gets SIGTERM, the way a person quitting would end
# it. Signaling the whole unit at once (what systemctl stop, logout and
# shutdown do) also kills the GPU process mid-teardown, Chromium exits with
# "GPU process isn't usable", and the main thread spins until systemd's
# 90-second SIGKILL. The unit is stopped once its main process is gone.
# The main process is the one whose command line carries no --type=: the
# zygote, GPU, renderers and crash handler all say what they are, and some
# are not its children, so a parent check misses them.
def is_main(pid):
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as handle:
            return b"--type=" not in handle.read()
    except OSError:
        return False
stopped = []
for pid, _ in preview_processes():
    if not is_main(pid):
        continue
    try:
        os.kill(pid, signal.SIGTERM)
        stopped.append(pid)
    except OSError:
        pass
deadline = time.monotonic() + 10
while preview_processes() and time.monotonic() < deadline:
    time.sleep(0.25)
killed = []
for pid, _ in preview_processes():
    try:
        os.kill(pid, signal.SIGKILL)
        killed.append(pid)
    except OSError:
        pass
time.sleep(1)
# A program a task started can outlive the app (reparented to the user's
# systemd, in the desktop's scope rather than the unit) still holding the CDP
# socket it inherited, and the next start then hangs on that port. Whatever
# holds the preview's port now is left over from the preview, so it goes too.
orphans = []
owner = listener_owner(target["cdpPort"])
if owner.get("processId"):
    try:
        os.kill(owner["processId"], signal.SIGKILL)
        orphans.append({"pid": owner["processId"], "commandLine": owner.get("commandLine")})
    except OSError:
        pass
subprocess.run(["systemctl", "--user", "stop", "--no-block", target["unit"]], check=False, capture_output=True, timeout=30)
subprocess.run(["systemctl", "--user", "reset-failed", target["unit"]], check=False, capture_output=True, timeout=30)
print(json.dumps({
    "killedAfterIgnoringTerm": killed,
    "killedHoldingPort": orphans,
    "signaled": stopped,
    "target": "${PREVIEW_TARGET}",
}))`;
}
