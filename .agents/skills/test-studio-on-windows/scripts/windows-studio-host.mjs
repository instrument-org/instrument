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
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop | Select-Object -First 1
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    $targetSummaries = @()
    foreach ($target in $targets) {
      $targetSummaries += [ordered]@{ title = $target.title; type = $target.type; url = $target.url }
    }
    return [ordered]@{
      browser = $version.Browser
      live = $true
      owner = [ordered]@{
        commandLine = $owner.CommandLine
        executablePath = $owner.ExecutablePath
        localAddress = $listener.LocalAddress
        name = $owner.Name
        processId = $owner.ProcessId
      }
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
      assertNoArguments();
      report(readProfile(host));
      break;
    }
    case "start": {
      const timeout = Number(
        takeFlag("--timeout", target === "dev" ? "180" : "45"),
      );
      if (!Number.isFinite(timeout) || timeout <= 0) {
        fail("--timeout must be a positive number of seconds.");
      }
      assertNoArguments();
      report(runPowerShellJson(host, startScript(target, timeout)));
      break;
    }
    case "status": {
      assertNoArguments();
      report(runPowerShellJson(host, statusScript()));
      break;
    }
    case "stop": {
      assertNoArguments();
      report(runPowerShellJson(host, stopScript(target)));
      break;
    }
    case "tunnel": {
      const profile = readProfile(host);
      const remotePort = targetConfig(profile, target).cdpPort;
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
  if (-not $cdp.live) { return }
  if ($cdp.userAgent -notlike '*Instrument(Dev)/*') {
    throw "CDP port $($target.cdpPort) belongs to an unexpected application: $($cdp.userAgent)"
  }
  if (-not $cdp.owner.executablePath) {
    throw "CDP port $($target.cdpPort) has no inspectable owning executable"
  }
  $expectedPrefix = [IO.Path]::GetFullPath($profile.repo).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $ownerPath = [IO.Path]::GetFullPath($cdp.owner.executablePath)
  if (-not $ownerPath.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "CDP port $($target.cdpPort) is owned by $ownerPath, outside the configured checkout"
  }
  if ($cdp.owner.localAddress -notin @('127.0.0.1', '::1')) {
    throw "CDP port $($target.cdpPort) is not bound to loopback: $($cdp.owner.localAddress)"
  }
}
function Test-TargetReady($cdp) {
  return @($cdp.targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'http://localhost:*/renderer/*' }).Count -gt 0
}`
      : `function Assert-TargetCdp($cdp) {
  if (-not $cdp.live) { return }
  if ($cdp.userAgent -notlike '*Instrument/*' -or $cdp.userAgent -like '*Instrument(Dev)/*') {
    throw "CDP port $($target.cdpPort) belongs to an unexpected application: $($cdp.userAgent)"
  }
  if (-not [string]::Equals($cdp.owner.executablePath, $profile.installed.executable, [StringComparison]::OrdinalIgnoreCase)) {
    throw "CDP port $($target.cdpPort) is owned by $($cdp.owner.executablePath), not the configured installed executable"
  }
  if ($cdp.owner.localAddress -notin @('127.0.0.1', '::1')) {
    throw "CDP port $($target.cdpPort) is not bound to loopback: $($cdp.owner.localAddress)"
  }
}
function Test-TargetReady($cdp) {
  return @($cdp.targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'file:///*/resources/app.asar/out/renderer/*' }).Count -gt 0
}`;
  const taskContract =
    selectedTarget === "dev"
      ? `$taskAction = @($task.Actions)[0]
$expectedWorkingDirectory = [IO.Path]::Combine($profile.repo, 'apps', 'studio')
if (-not [string]::Equals($taskAction.WorkingDirectory, $expectedWorkingDirectory, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The development task working directory is $($taskAction.WorkingDirectory), expected $expectedWorkingDirectory"
}
if ($taskArguments.IndexOf($profile.nodeHome, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $taskArguments.IndexOf('pnpm.cmd run dev', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $taskArguments -notmatch "REMOTE_DEBUGGING_PORT=$($target.cdpPort)") {
  throw 'The development task must use the configured Node installation, CDP port, and direct Studio command.'
}`
      : `$taskAction = @($task.Actions)[0]
$expectedWorkingDirectory = Split-Path -Parent $profile.installed.executable
if (-not [string]::Equals($taskAction.WorkingDirectory, $expectedWorkingDirectory, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The installed task working directory is $($taskAction.WorkingDirectory), expected $expectedWorkingDirectory"
}
if ($taskArguments.IndexOf($profile.installed.executable, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $taskArguments -notmatch 'DISABLE_AUTO_UPDATE_POLLING=true' -or $taskArguments -notmatch "--remote-debugging-port=$($target.cdpPort)") {
  throw 'The installed task must use the configured executable, disable updater polling, and pass its configured CDP port.'
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
${taskContract}
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
    if (Test-TargetReady $cdp) {
      [ordered]@{ cdp = $cdp; port = $target.cdpPort; reused = $existing.live; target = '${selectedTarget}'; taskName = $target.taskName } | ConvertTo-Json -Depth 8 -Compress
      exit 0
    }
  }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
throw "${selectedTarget} CDP did not become ready on port $($target.cdpPort) within ${timeoutSeconds} seconds."`;
}

function statusScript() {
  return `${baseScript()}
${cdpFunction()}
function Get-TaskStatus($target, [string] $kind) {
  $task = Get-ScheduledTask -TaskName $target.taskName -ErrorAction SilentlyContinue
  if (-not $task) {
    return [ordered]@{ exists = $false; taskName = $target.taskName }
  }
  $info = Get-ScheduledTaskInfo -TaskName $target.taskName
  $action = @($task.Actions)[0]
  $arguments = [string]::Join(' ', @($task.Actions | ForEach-Object { $_.Arguments }))
  $cdp = Get-CdpStatus -port $target.cdpPort
  $loopback = $cdp.live -and $cdp.owner.localAddress -in @('127.0.0.1', '::1')
  if ($kind -eq 'dev') {
    $expectedWorkingDirectory = [IO.Path]::Combine($profile.repo, 'apps', 'studio')
    $expectedPrefix = [IO.Path]::GetFullPath($profile.repo).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $ownerMatches = $cdp.live -and $cdp.owner.executablePath -and [IO.Path]::GetFullPath($cdp.owner.executablePath).StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)
    $rendererReady = @($cdp.targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'http://localhost:*/renderer/*' }).Count -gt 0
    $userAgentMatches = $cdp.live -and $cdp.userAgent -like '*Instrument(Dev)/*'
    $commandConfigured = $arguments.IndexOf($profile.nodeHome, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $arguments.IndexOf('pnpm.cmd run dev', [StringComparison]::OrdinalIgnoreCase) -ge 0
  } else {
    $expectedWorkingDirectory = Split-Path -Parent $profile.installed.executable
    $ownerMatches = $cdp.live -and [string]::Equals($cdp.owner.executablePath, $profile.installed.executable, [StringComparison]::OrdinalIgnoreCase)
    $rendererReady = @($cdp.targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'file:///*/resources/app.asar/out/renderer/*' }).Count -gt 0
    $userAgentMatches = $cdp.live -and $cdp.userAgent -like '*Instrument/*' -and $cdp.userAgent -notlike '*Instrument(Dev)/*'
    $commandConfigured = $arguments.IndexOf($profile.installed.executable, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  return [ordered]@{
    action = @($task.Actions | ForEach-Object { [ordered]@{ arguments = $_.Arguments; execute = $_.Execute; workingDirectory = $_.WorkingDirectory } })
    cdp = $cdp
    exists = $true
    lastTaskResult = $info.LastTaskResult
    port = $target.cdpPort
    state = [string] $task.State
    taskName = $target.taskName
    validation = [ordered]@{
      cdpConfigured = $arguments -match "(?:REMOTE_DEBUGGING_PORT=|--remote-debugging-port=)$($target.cdpPort)"
      commandConfigured = $commandConfigured
      loopback = $loopback
      ownerMatches = $ownerMatches
      rendererReady = $rendererReady
      updaterPollingDisabled = $arguments -match 'DISABLE_AUTO_UPDATE_POLLING=true'
      userAgentMatches = $userAgentMatches
      workingDirectoryMatches = [string]::Equals($action.WorkingDirectory, $expectedWorkingDirectory, [StringComparison]::OrdinalIgnoreCase)
    }
  }
}
Set-Location -LiteralPath $profile.repo
$gitStatus = @(git -c core.fsmonitor=false status --short)
if ($LASTEXITCODE -ne 0) { throw 'git status failed in the configured checkout' }
$gitBranch = git branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'git branch failed in the configured checkout' }
$gitHead = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'git rev-parse failed in the configured checkout' }
$result = [ordered]@{
  dev = Get-TaskStatus $profile.dev 'dev'
  git = [ordered]@{
    branch = $gitBranch
    dirty = $gitStatus.Count -gt 0
    head = $gitHead
    status = $gitStatus
  }
  installed = Get-TaskStatus $profile.installed 'installed'
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
  $_.CommandLine -and $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -in @('cmd.exe', 'electron.exe', 'node.exe', 'pnpm.exe', 'turbo.exe')
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
    !Number.isInteger(config.cdpPort) ||
    config.cdpPort < 1 ||
    config.cdpPort > 65_535 ||
    typeof config.taskName !== "string"
  ) {
    fail(
      `The host profile must define ${selectedTarget}.cdpPort and ${selectedTarget}.taskName.`,
    );
  }
  if (selectedTarget === "installed" && typeof config.executable !== "string") {
    fail("The host profile must define installed.executable.");
  }
  return config;
}
