import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const PROFILE_RELATIVE_PATH = String.raw`.instrument\studio-host.json`;
const TARGETS = new Set(["dev", "installed"]);

class CliError extends Error {}

const argv = process.argv.slice(2);

try {
  await main();
} catch (error) {
  console.error(`windows-studio-host: ${error.message}`);
  if (!(error instanceof CliError)) {
    console.error(error.stack);
  }
  process.exitCode = 1;
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

function baseScript() {
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$profilePath = Join-Path $HOME '${PROFILE_RELATIVE_PATH}'
if (-not (Test-Path -LiteralPath $profilePath)) {
  throw "Missing host profile: $profilePath"
}
$profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
if ($profile.schemaVersion -ne 1) {
  throw "Unsupported host profile schema: $($profile.schemaVersion)"
}`;
}

function cdpFunction() {
  return `function Get-CdpStatus([int] $port) {
  try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2
    $targetSummaries = @()
    foreach ($target in $targets) {
      $targetSummaries += [ordered]@{ title = $target.title; type = $target.type; url = $target.url }
    }
    return [ordered]@{
      browser = $version.Browser
      live = $true
      targets = $targetSummaries
      userAgent = $version.'User-Agent'
    }
  } catch {
    return [ordered]@{ live = $false }
  }
}`;
}

function fail(message) {
  throw new CliError(message);
}

async function main() {
  const command = argv.shift();
  const host = takeFlag("--host");
  const target = takeFlag("--target", "dev");

  if (!host) {
    fail("Pass --host <ssh-host>.");
  }
  if (!TARGETS.has(target)) {
    fail(`Unknown target ${JSON.stringify(target)}. Use dev or installed.`);
  }

  switch (command) {
    case "profile": {
      report(readProfile(host));
      break;
    }
    case "start": {
      const timeout = Number(
        takeFlag("--timeout", target === "dev" ? "180" : "45"),
      );
      report(runPowerShellJson(host, startScript(target, timeout)));
      break;
    }
    case "status": {
      report(runPowerShellJson(host, statusScript()));
      break;
    }
    case "stop": {
      report(runPowerShellJson(host, stopScript(target)));
      break;
    }
    case "tunnel": {
      const profile = readProfile(host);
      const remotePort = targetConfig(profile, target).cdpPort;
      const localPort = Number(
        takeFlag("--local-port", String(remotePort + 1000)),
      );
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
      const exitCode = await new Promise((resolve) =>
        child.on("exit", resolve),
      );
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

function readProfile(hostName) {
  const script = `${baseScript()}
$profile | ConvertTo-Json -Depth 8 -Compress`;
  const profile = runPowerShellJson(hostName, script);
  targetConfig(profile, "dev");
  targetConfig(profile, "installed");
  if (
    typeof profile.repo !== "string" ||
    typeof profile.nodeHome !== "string"
  ) {
    fail("The host profile must define repo and nodeHome.");
  }
  return profile;
}

function report(value) {
  console.log(JSON.stringify(value, undefined, 2));
}

function runPowerShell(hostName, script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(
    "ssh",
    [
      hostName,
      "powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encoded,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
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

function runPowerShellJson(hostName, script) {
  const output = runPowerShell(hostName, script);
  try {
    return JSON.parse(output);
  } catch {
    fail(`Remote command did not return JSON:\n${output}`);
  }
}

function startScript(selectedTarget, timeoutSeconds) {
  const targetProperty =
    selectedTarget === "dev" ? "$profile.dev" : "$profile.installed";
  const installedGuard =
    selectedTarget === "installed"
      ? `if (-not (Get-CdpStatus -port $target.cdpPort).live) {
  $runningInstalled = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Instrument.exe' -and $_.ExecutablePath -eq $profile.installed.executable }
  if ($runningInstalled) {
    throw 'The installed app is already running without the configured CDP endpoint. Close it before starting the installed test target.'
  }
}`
      : "";
  const identityFunction =
    selectedTarget === "dev"
      ? `function Assert-TargetCdp($cdp) {
  if ($cdp.live -and $cdp.userAgent -notlike '*Instrument(Dev)/*') {
    throw "CDP port $($target.cdpPort) belongs to an unexpected application: $($cdp.userAgent)"
  }
}`
      : `function Assert-TargetCdp($cdp) {
  if ($cdp.live -and ($cdp.userAgent -notlike '*Instrument/*' -or $cdp.userAgent -like '*Instrument(Dev)/*')) {
    throw "CDP port $($target.cdpPort) belongs to an unexpected application: $($cdp.userAgent)"
  }
}`;
  return `${baseScript()}
${cdpFunction()}
$target = ${targetProperty}
${identityFunction}
$task = Get-ScheduledTask -TaskName $target.taskName -ErrorAction SilentlyContinue
if (-not $task) {
  throw "Missing scheduled task: $($target.taskName)"
}
$taskArguments = [string]::Join(' ', @($task.Actions | ForEach-Object { $_.Arguments }))
${
  selectedTarget === "installed"
    ? `if ($taskArguments -notmatch 'DISABLE_AUTO_UPDATE_POLLING=true' -or $taskArguments -notmatch "--remote-debugging-port=$($target.cdpPort)") {
  throw 'The installed task must disable updater polling and pass its configured CDP port.'
}`
    : `if ($taskArguments -notmatch "REMOTE_DEBUGGING_PORT=$($target.cdpPort)") {
  throw 'The development task does not set its configured CDP port.'
}`
}
${installedGuard}
$existing = Get-CdpStatus -port $target.cdpPort
Assert-TargetCdp $existing
if (-not $existing.live) {
  Start-ScheduledTask -TaskName $target.taskName
}
$deadline = (Get-Date).AddSeconds(${timeoutSeconds})
do {
  $cdp = Get-CdpStatus -port $target.cdpPort
  if ($cdp.live) {
    Assert-TargetCdp $cdp
    [ordered]@{ cdp = $cdp; port = $target.cdpPort; reused = $existing.live; target = '${selectedTarget}'; taskName = $target.taskName } | ConvertTo-Json -Depth 8 -Compress
    exit 0
  }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
throw "${selectedTarget} CDP did not become ready on port $($target.cdpPort) within ${timeoutSeconds} seconds."`;
}

function statusScript() {
  return `${baseScript()}
${cdpFunction()}
function Get-TaskStatus($target) {
  $task = Get-ScheduledTask -TaskName $target.taskName -ErrorAction SilentlyContinue
  if (-not $task) {
    return [ordered]@{ exists = $false; taskName = $target.taskName }
  }
  $info = Get-ScheduledTaskInfo -TaskName $target.taskName
  $arguments = [string]::Join(' ', @($task.Actions | ForEach-Object { $_.Arguments }))
  return [ordered]@{
    action = @($task.Actions | ForEach-Object { [ordered]@{ arguments = $_.Arguments; execute = $_.Execute; workingDirectory = $_.WorkingDirectory } })
    cdp = Get-CdpStatus -port $target.cdpPort
    exists = $true
    lastTaskResult = $info.LastTaskResult
    port = $target.cdpPort
    state = [string] $task.State
    taskName = $target.taskName
    validation = [ordered]@{
      cdpConfigured = $arguments -match "(?:REMOTE_DEBUGGING_PORT=|--remote-debugging-port=)$($target.cdpPort)"
      updaterPollingDisabled = $arguments -match 'DISABLE_AUTO_UPDATE_POLLING=true'
    }
  }
}
Set-Location -LiteralPath $profile.repo
$gitStatus = @(git -c core.fsmonitor=false status --short)
$result = [ordered]@{
  dev = Get-TaskStatus $profile.dev
  git = [ordered]@{
    branch = git branch --show-current
    dirty = $gitStatus.Count -gt 0
    head = git rev-parse HEAD
    status = $gitStatus
  }
  installed = Get-TaskStatus $profile.installed
  installedExecutable = [ordered]@{
    exists = Test-Path -LiteralPath $profile.installed.executable
    path = $profile.installed.executable
    version = if (Test-Path -LiteralPath $profile.installed.executable) { (Get-Item -LiteralPath $profile.installed.executable).VersionInfo.ProductVersion } else { $null }
  }
  nodeHome = $profile.nodeHome
  profilePath = $profilePath
  repo = $profile.repo
  schemaVersion = $profile.schemaVersion
}
$result | ConvertTo-Json -Depth 10 -Compress`;
}

function stopScript(selectedTarget) {
  const body =
    selectedTarget === "dev"
      ? `$needle = $profile.repo
$processes = @(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*$needle*" -and $_.Name -in @('cmd.exe', 'electron.exe', 'node.exe', 'pnpm.exe', 'turbo.exe')
})
$ids = @($processes.ProcessId)
$roots = @($processes | Where-Object { $ids -notcontains $_.ParentProcessId })`
      : `$processes = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'Instrument.exe' -and $_.ExecutablePath -eq $profile.installed.executable
})
$ids = @($processes.ProcessId)
$roots = @($processes | Where-Object { $ids -notcontains $_.ParentProcessId })`;
  const targetProperty =
    selectedTarget === "dev" ? "$profile.dev" : "$profile.installed";
  return `${baseScript()}
$target = ${targetProperty}
Stop-ScheduledTask -TaskName $target.taskName -ErrorAction SilentlyContinue
${body}
$stopped = @()
foreach ($root in $roots) {
  & taskkill.exe /PID $root.ProcessId /T /F | Out-Null
  if ($LASTEXITCODE -eq 0) { $stopped += $root.ProcessId }
}
[ordered]@{ stoppedProcessTrees = $stopped; target = '${selectedTarget}'; taskName = $target.taskName } | ConvertTo-Json -Depth 4 -Compress`;
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
  const config = profile[selectedTarget];
  if (
    !config ||
    typeof config.cdpPort !== "number" ||
    typeof config.taskName !== "string"
  ) {
    fail(
      `The host profile must define ${selectedTarget}.cdpPort and ${selectedTarget}.taskName.`,
    );
  }
  return config;
}
