import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const PROFILE_RELATIVE_PATH = ".instrument/studio-host.json";
const PROFILE_KEYS = {
  installed: "installed",
};
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

configured = [profile[key] for key in ("dev", "devSeeded", "installed") if profile.get(key)]
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
    executable = target["executable"]
    exec_start = properties.get("ExecStart") or ""
    owner = status.get("owner") or {}
    agent = status.get("userAgent") or ""
    return {
        "cdpConfigured": ("--remote-debugging-port=%d" % target["cdpPort"]) in exec_start,
        "commandConfigured": executable in exec_start,
        "loopback": bool(status.get("live")) and owner.get("localAddress") in ("127.0.0.1", "[::1]", "::1"),
        "ownerMatches": bool(status.get("live")) and owner.get("executablePath") == executable,
        "rendererReady": renderer_ready(status),
        "updaterPollingDisabled": "DISABLE_AUTO_UPDATE_POLLING=true" in (properties.get("Environment") or ""),
        "userAgentMatches": "Instrument/" in agent and "Instrument(Dev)/" not in agent,
        "workingDirectoryMatches": (properties.get("WorkingDirectory") or "") == os.path.dirname(executable),
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

  switch (command) {
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
    case "tunnel": {
      const remotePort = targetConfig(
        readProfile(host, target),
        target,
      ).cdpPort;
      const localPort = Number(
        takeFlag("--local-port", String(remotePort + 1000)),
      );
      assertNoArguments();
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
        `Unknown command ${JSON.stringify(command)}. Use profile, start, status, stop, or tunnel.`,
      );
    }
  }
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
  return `${baseScript(selectedTarget)}
${cdpFunction()}
${inspectFunction()}
properties = unit_properties(target["unit"])
status = cdp_status(target["cdpPort"])
try:
    version = subprocess.run(
        ["dpkg-query", "-W", "-f=\${Version}", "instrument"],
        capture_output=True, text=True, timeout=10,
    ).stdout.strip() or None
except (OSError, subprocess.SubprocessError):
    version = None

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
        "exists": os.path.exists(target["executable"]),
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
  if (typeof config.executable !== "string") {
    fail(`The host profile must define ${key}.executable.`);
  }
  return config;
}
