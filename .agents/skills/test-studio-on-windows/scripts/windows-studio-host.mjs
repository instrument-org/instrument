import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const PROFILE_RELATIVE_PATH = String.raw`.instrument\studio-host.json`;
// A seeded run is its own enrolled task rather than a per-start rewrite of the
// development one, so nothing mutates enrolled state at run time and `status`
// keeps reporting what each task really does.
const SEEDED_TARGET = "dev-seeded";
const PROFILE_KEYS = {
  dev: "dev",
  "dev-seeded": "devSeeded",
  installed: "installed",
};
const TARGETS = new Set(Object.keys(PROFILE_KEYS));
// Written by `pnpm workspace:seed` at the root of the workspace it built. It is
// how a fixture name gets from that run to this one.
const SEEDED_MARKER_FILE = ".seeded-workspace.json";
// A fixture directory name under `fixtures/workspaces/`. Constrained because it
// reaches the host inside a generated PowerShell literal.
const WORKSPACE_NAME_PATTERN = /^[a-z][\da-z-]*$/;
// Installed dependencies left inside a task by an agent run are the only part of
// a seeded workspace that grows, so they go sooner than a reseed would take them.
const WORK_ARTIFACT_MAX_AGE_DAYS = 3;

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

/**
 * PowerShell that establishes `$target` as the seeded profile entry. A seeded
 * workspace is rebuilt from scratch on demand, so the directory it lives in has
 * to be somewhere losing it costs nothing: never the checkout, whose contents
 * `status` reports, and never a real application data directory. The seeder
 * refuses to clear a directory it did not create, which covers the second; this
 * covers the first, before anything is written.
 */
function assertSeededProfile() {
  return `$target = $profile.${PROFILE_KEYS[SEEDED_TARGET]}
if (-not $target) {
  throw 'The host profile has no ${PROFILE_KEYS[SEEDED_TARGET]} entry. See references/host-enrollment.md.'
}
if (-not $target.cdpPort -or -not $target.taskName -or -not $target.userDataDir) {
  throw 'The host profile must define ${PROFILE_KEYS[SEEDED_TARGET]}.cdpPort, .taskName and .userDataDir.'
}
if (-not [IO.Path]::IsPathRooted($target.userDataDir)) {
  throw "${PROFILE_KEYS[SEEDED_TARGET]}.userDataDir must be an absolute path: $($target.userDataDir)"
}
$seededFullPath = [IO.Path]::GetFullPath($target.userDataDir)
$repoPrefix = [IO.Path]::GetFullPath($profile.repo).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if ($seededFullPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "${PROFILE_KEYS[SEEDED_TARGET]}.userDataDir is inside the checkout: $seededFullPath"
}`;
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
}
$configuredPorts = @($profile.dev.cdpPort, $profile.installed.cdpPort)
$configuredTaskNames = @($profile.dev.taskName, $profile.installed.taskName)
if ($profile.${PROFILE_KEYS[SEEDED_TARGET]}) {
  $configuredPorts += $profile.${PROFILE_KEYS[SEEDED_TARGET]}.cdpPort
  $configuredTaskNames += $profile.${PROFILE_KEYS[SEEDED_TARGET]}.taskName
}
if (@($configuredPorts | Sort-Object -Unique).Count -ne $configuredPorts.Count) {
  throw 'The host profile must give each target its own CDP port.'
}
if (@($configuredTaskNames | Sort-Object -Unique).Count -ne $configuredTaskNames.Count) {
  throw 'The host profile must give each target its own scheduled task.'
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
    fail(
      `Unknown target ${JSON.stringify(target)}. Use ${[...TARGETS].join(", ")}.`,
    );
  }

  switch (command) {
    case "profile": {
      assertNoArguments();
      report(readProfile(host));
      break;
    }
    case "seed": {
      if (target === "installed") {
        fail(`Only the ${SEEDED_TARGET} target has a seeded workspace.`);
      }
      const workspace = requireWorkspaceName(takeFlag("--workspace"));
      const fresh = takeSwitch("--fresh");
      assertNoArguments();
      report(runPowerShellJson(host, seedScript(workspace, fresh)));
      break;
    }
    case "start": {
      const timeout = Number(
        takeFlag("--timeout", target === "installed" ? "45" : "180"),
      );
      if (!Number.isFinite(timeout) || timeout <= 0) {
        fail("--timeout must be a positive number of seconds.");
      }
      const requestedWorkspace = takeFlag("--workspace");
      const fresh = takeSwitch("--fresh");
      assertNoArguments();
      if (target !== SEEDED_TARGET && (requestedWorkspace || fresh)) {
        fail(
          `--workspace and --fresh only apply to --target ${SEEDED_TARGET}.`,
        );
      }
      report(
        runPowerShellJson(
          host,
          startScript(target, timeout, {
            fixture:
              target === SEEDED_TARGET
                ? requireWorkspaceName(requestedWorkspace)
                : undefined,
            fresh,
          }),
        ),
      );
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
        `Unknown command ${JSON.stringify(command)}. Use profile, seed, start, status, stop, or tunnel.`,
      );
    }
  }
}

/**
 * PowerShell that reads the seeder's marker. Which fixture a workspace holds is
 * recorded there rather than anywhere the helper writes, so `status` reports what
 * is genuinely on disk even after a seed nobody here ran.
 */
function markerFunction() {
  return `function Get-SeededWorkspace([string] $dir) {
  if (-not $dir) {
    return [ordered]@{ seeded = $false }
  }
  $markerPath = Join-Path $dir '${SEEDED_MARKER_FILE}'
  try {
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  } catch {
    return [ordered]@{ seeded = $false; userDataDir = $dir }
  }
  return [ordered]@{
    fixtures = @($marker.fixtures)
    # A marker without a digest is a claim written before seeding started, so an
    # interrupted seed never reads as a finished one.
    seeded = [bool] $marker.digest
    seededAt = $marker.seededAt
    tasks = @($marker.tasks | ForEach-Object { [ordered]@{ id = $_.id; key = $_.key; name = $_.name } })
    userDataDir = $dir
  }
}`;
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

/**
 * PowerShell that drops installed dependencies left inside a task by a live agent
 * run. Nothing else in a seeded workspace grows: a replay never installs
 * anything, and a reseed rebuilds the rest anyway.
 */
function reapFunction() {
  return `function Remove-StaleWorkArtifacts([string] $dir) {
  $removed = @()
  $tasksDir = Join-Path $dir 'workspace\\tasks'
  if (-not (Test-Path -LiteralPath $tasksDir)) {
    return $removed
  }
  $cutoff = (Get-Date).AddDays(-${WORK_ARTIFACT_MAX_AGE_DAYS})
  foreach ($task in @(Get-ChildItem -LiteralPath $tasksDir -Directory)) {
    foreach ($name in @('.venv', 'node_modules')) {
      $artifact = Join-Path $task.FullName (Join-Path 'work' $name)
      if ((Test-Path -LiteralPath $artifact) -and (Get-Item -LiteralPath $artifact -Force).LastWriteTime -lt $cutoff) {
        Remove-Item -LiteralPath $artifact -Recurse -Force -ErrorAction SilentlyContinue
        $removed += $artifact
      }
    }
  }
  # Unrolled into the pipeline, so every caller's @() normalizes none, one and
  # many the same way.
  return $removed
}`;
}

function report(value) {
  console.log(JSON.stringify(value, undefined, 2));
}

function requireWorkspaceName(value) {
  if (!value) {
    fail(
      "Pass --workspace <fixture>. `pnpm workspace:seed --list` in the checkout names them.",
    );
  }
  if (!WORKSPACE_NAME_PATTERN.test(value)) {
    fail(
      `Invalid workspace name ${JSON.stringify(value)}. A fixture directory name is lowercase letters, digits and dashes.`,
    );
  }
  return value;
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

/**
 * PowerShell that builds (or reuses) the seeded workspace. The seeder is
 * idempotent and keyed by a digest of the fixture's contents, so running it
 * before every start costs nothing when nothing changed, and switching the
 * fixture in this directory rebuilds it rather than mixing the two.
 */
function seedFunction() {
  return `function Invoke-WorkspaceSeed([string] $fixture, [string] $dir, [bool] $fresh) {
  $pnpm = Join-Path $profile.nodeHome 'pnpm.cmd'
  if (-not (Test-Path -LiteralPath $pnpm)) {
    throw "Missing pnpm at $pnpm"
  }
  $seedArguments = @('workspace:seed', '--out', $dir, '--fixture', $fixture)
  if ($fresh) {
    $seedArguments += '--fresh'
  }
  $previousPath = $env:PATH
  $previousErrorAction = $ErrorActionPreference
  Push-Location -LiteralPath $profile.repo
  try {
    # Noninteractive SSH does not initialize fnm, so the configured Node
    # installation goes on PATH here as well as inside the scheduled task.
    $env:PATH = $profile.nodeHome + ';' + $env:PATH
    # A native command writing to stderr is not a failure, and under this
    # script's error preference it would otherwise end the run.
    $ErrorActionPreference = 'Continue'
    # Only stdout, and never merged with stderr: the two streams arrive in no
    # fixed order, so merging them splices a progress line into the middle of the
    # summary. The seeder's progress and its errors stay on stderr, which SSH
    # reports if this fails.
    $output = @(& $pnpm @seedArguments | ForEach-Object { [string] $_ })
    $seedExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
    $env:PATH = $previousPath
    Pop-Location
  }
  $transcript = [string]::Join("\`n", $output)
  if ($seedExitCode -ne 0) {
    throw "pnpm workspace:seed --fixture $fixture failed with exit code $seedExitCode\`n$transcript"
  }
  # The summary is printed last and pretty-printed two spaces deep, so its
  # opening brace is the final unindented one on a line of its own. Matching an
  # indented brace too would start the parse inside the object's own \`tasks\`.
  $summaryStart = -1
  for ($index = 0; $index -lt $output.Count; $index++) {
    if ($output[$index] -match '^\\{\\s*$') {
      $summaryStart = $index
    }
  }
  if ($summaryStart -lt 0) {
    throw "The seeder printed no summary for $fixture\`n$transcript"
  }
  return [string]::Join("\`n", $output[$summaryStart..($output.Count - 1)]) | ConvertFrom-Json
}`;
}

function seedScript(fixture, fresh) {
  const freshLiteral = fresh ? "$true" : "$false";
  return `${baseScript()}
${cdpFunction()}
${markerFunction()}
${reapFunction()}
${seedFunction()}
${assertSeededProfile()}
if ((Get-CdpStatus -port $target.cdpPort).live) {
  throw "Studio is running against the seeded workspace on port $($target.cdpPort). Stop the ${SEEDED_TARGET} target before reseeding."
}
$seed = Invoke-WorkspaceSeed '${fixture}' $target.userDataDir ${freshLiteral}
$reaped = @(Remove-StaleWorkArtifacts $target.userDataDir)
$workspace = Get-SeededWorkspace $target.userDataDir
$workspace.reapedWorkArtifacts = $reaped
$workspace.rebuilt = -not [bool] $seed.reused
[ordered]@{ target = '${SEEDED_TARGET}'; workspace = $workspace } | ConvertTo-Json -Depth 8 -Compress`;
}

function startScript(selectedTarget, timeoutSeconds, { fixture, fresh }) {
  const isSeeded = selectedTarget === SEEDED_TARGET;
  const freshLiteral = fresh ? "$true" : "$false";
  const targetSetup = isSeeded
    ? assertSeededProfile()
    : `$target = $profile.${PROFILE_KEYS[selectedTarget]}`;
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
    selectedTarget === "installed"
      ? `function Assert-TargetCdp($cdp) {
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
}`
      : `function Assert-TargetCdp($cdp) {
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
}`;
  // A seeded workspace has no provider credentials and must not have any, so
  // without SKIP_ONBOARDING the app opens the onboarding window and never
  // reveals the main one, which reads as a hang rather than as a missing setting.
  const seededContract = isSeeded
    ? `
if ($taskArguments.IndexOf('ELECTRON_USER_DATA_DIR=' + $target.userDataDir, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $taskArguments -notmatch 'SKIP_ONBOARDING=true') {
  throw "$($target.taskName) must point ELECTRON_USER_DATA_DIR at $($target.userDataDir) and set SKIP_ONBOARDING=true."
}`
    : "";
  const taskContract =
    selectedTarget === "installed"
      ? `$taskAction = @($task.Actions)[0]
$expectedWorkingDirectory = Split-Path -Parent $profile.installed.executable
if (-not [string]::Equals($taskAction.WorkingDirectory, $expectedWorkingDirectory, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The installed task working directory is $($taskAction.WorkingDirectory), expected $expectedWorkingDirectory"
}
if ($taskArguments.IndexOf($profile.installed.executable, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $taskArguments -notmatch 'DISABLE_AUTO_UPDATE_POLLING=true' -or $taskArguments -notmatch "--remote-debugging-port=$($target.cdpPort)") {
  throw 'The installed task must use the configured executable, disable updater polling, and pass its configured CDP port.'
}`
      : `$taskAction = @($task.Actions)[0]
$expectedWorkingDirectory = [IO.Path]::Combine($profile.repo, 'apps', 'studio')
if (-not [string]::Equals($taskAction.WorkingDirectory, $expectedWorkingDirectory, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The development task working directory is $($taskAction.WorkingDirectory), expected $expectedWorkingDirectory"
}
if ($taskArguments.IndexOf($profile.nodeHome, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $taskArguments.IndexOf('pnpm.cmd run dev', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $taskArguments -notmatch "REMOTE_DEBUGGING_PORT=$($target.cdpPort)") {
  throw 'The development task must use the configured Node installation, CDP port, and direct Studio command.'
}${seededContract}`;
  // Seeding rewrites the directory the app has open, so it only ever runs while
  // nothing is. A live instance holding the requested fixture is what the caller
  // wanted anyway; one holding another fixture is not, and says so.
  const reuseSeeded = fresh
    ? `  throw "--fresh rebuilds the seeded workspace and the instance on port $($target.cdpPort) has it open. Stop the ${SEEDED_TARGET} target first."`
    : `  $workspace = Get-SeededWorkspace $target.userDataDir
  if (-not $workspace.seeded) {
    throw "Studio is running against $($target.userDataDir), which holds no seeded workspace. Stop the ${SEEDED_TARGET} target and start it again."
  }
  if (@($workspace.fixtures) -notcontains '${fixture}') {
    throw "The running seeded instance holds $(@($workspace.fixtures) -join ', '), not ${fixture}. Stop the ${SEEDED_TARGET} target first."
  }
  $workspace.reapedWorkArtifacts = @()
  $workspace.rebuilt = $false`;
  const launch = isSeeded
    ? `if ($existing.live) {
${reuseSeeded}
} else {
  $seed = Invoke-WorkspaceSeed '${fixture}' $target.userDataDir ${freshLiteral}
  $reaped = @(Remove-StaleWorkArtifacts $target.userDataDir)
  $workspace = Get-SeededWorkspace $target.userDataDir
  $workspace.reapedWorkArtifacts = $reaped
  $workspace.rebuilt = -not [bool] $seed.reused
  Start-ScheduledTask -TaskName $target.taskName
}`
    : `if (-not $existing.live) {
  Start-ScheduledTask -TaskName $target.taskName
}`;
  const reportedWorkspace = isSeeded ? "; workspace = $workspace" : "";
  return `${baseScript()}
${cdpFunction()}${isSeeded ? `\n${markerFunction()}\n${reapFunction()}\n${seedFunction()}` : ""}
${targetSetup}
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
${launch}
$deadline = (Get-Date).AddSeconds(${timeoutSeconds})
do {
  $cdp = Get-CdpStatus -port $target.cdpPort
  if ($cdp.live) {
    Assert-TargetCdp $cdp
    if (Test-TargetReady $cdp) {
      [ordered]@{ cdp = $cdp; port = $target.cdpPort; reused = $existing.live; target = '${selectedTarget}'; taskName = $target.taskName${reportedWorkspace} } | ConvertTo-Json -Depth 8 -Compress
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
${markerFunction()}
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
  if ($kind -eq 'installed') {
    $expectedWorkingDirectory = Split-Path -Parent $profile.installed.executable
    $ownerMatches = $cdp.live -and [string]::Equals($cdp.owner.executablePath, $profile.installed.executable, [StringComparison]::OrdinalIgnoreCase)
    $rendererReady = @($cdp.targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'file:///*/resources/app.asar/out/renderer/*' }).Count -gt 0
    $userAgentMatches = $cdp.live -and $cdp.userAgent -like '*Instrument/*' -and $cdp.userAgent -notlike '*Instrument(Dev)/*'
    $commandConfigured = $arguments.IndexOf($profile.installed.executable, [StringComparison]::OrdinalIgnoreCase) -ge 0
  } else {
    $expectedWorkingDirectory = [IO.Path]::Combine($profile.repo, 'apps', 'studio')
    $expectedPrefix = [IO.Path]::GetFullPath($profile.repo).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $ownerMatches = $cdp.live -and $cdp.owner.executablePath -and [IO.Path]::GetFullPath($cdp.owner.executablePath).StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)
    $rendererReady = @($cdp.targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'http://localhost:*/renderer/*' }).Count -gt 0
    $userAgentMatches = $cdp.live -and $cdp.userAgent -like '*Instrument(Dev)/*'
    $commandConfigured = $arguments.IndexOf($profile.nodeHome, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $arguments.IndexOf('pnpm.cmd run dev', [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  $result = [ordered]@{
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
      onboardingSkipped = $arguments -match 'SKIP_ONBOARDING=true'
      ownerMatches = $ownerMatches
      rendererReady = $rendererReady
      seededWorkspaceConfigured = $target.userDataDir -and $arguments.IndexOf('ELECTRON_USER_DATA_DIR=' + $target.userDataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
      updaterPollingDisabled = $arguments -match 'DISABLE_AUTO_UPDATE_POLLING=true'
      userAgentMatches = $userAgentMatches
      workingDirectoryMatches = [string]::Equals($action.WorkingDirectory, $expectedWorkingDirectory, [StringComparison]::OrdinalIgnoreCase)
    }
  }
  if ($kind -eq '${SEEDED_TARGET}') {
    $result.workspace = Get-SeededWorkspace $target.userDataDir
  }
  return $result
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
  devSeeded = if ($profile.${PROFILE_KEYS[SEEDED_TARGET]}) { Get-TaskStatus $profile.${PROFILE_KEYS[SEEDED_TARGET]} '${SEEDED_TARGET}' } else { [ordered]@{ configured = $false; exists = $false } }
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

/**
 * Both development targets run `pnpm dev` from the same checkout, and a process
 * only carries the checkout path on its command line, not which workspace it was
 * pointed at. So stopping either one stops both, and both tasks have to be told:
 * a task left in `Running` with nothing behind it makes the next
 * `Start-ScheduledTask` a no-op, and the start after that reads as a hang.
 */
function stopScript(selectedTarget) {
  const body =
    selectedTarget === "installed"
      ? `$processes = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'Instrument.exe' -and $_.ExecutablePath -eq $profile.installed.executable
})
$ids = @($processes.ProcessId)
$roots = @($processes | Where-Object { $ids -notcontains $_.ParentProcessId })`
      : `$needle = $profile.repo
$processes = @(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -in @('cmd.exe', 'electron.exe', 'node.exe', 'pnpm.exe', 'turbo.exe')
})
$ids = @($processes.ProcessId)
$roots = @($processes | Where-Object { $ids -notcontains $_.ParentProcessId })`;
  const taskNames =
    selectedTarget === "installed"
      ? "$taskNames = @($profile.installed.taskName)"
      : `$taskNames = @($profile.dev.taskName)
if ($profile.${PROFILE_KEYS[SEEDED_TARGET]}) {
  $taskNames += $profile.${PROFILE_KEYS[SEEDED_TARGET]}.taskName
}`;
  return `${baseScript()}
${taskNames}
foreach ($taskName in $taskNames) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
${body}
$stopped = @()
foreach ($root in $roots) {
  & taskkill.exe /PID $root.ProcessId /T /F | Out-Null
  if ($LASTEXITCODE -eq 0) { $stopped += $root.ProcessId }
}
[ordered]@{ stoppedProcessTrees = $stopped; target = '${selectedTarget}'; taskNames = $taskNames } | ConvertTo-Json -Depth 4 -Compress`;
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

function takeSwitch(name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return false;
  }
  argv.splice(index, 1);
  return true;
}

function targetConfig(profile, selectedTarget) {
  const key = PROFILE_KEYS[selectedTarget];
  const config = profile[key];
  if (
    !config ||
    !Number.isInteger(config.cdpPort) ||
    config.cdpPort < 1 ||
    config.cdpPort > 65_535 ||
    typeof config.taskName !== "string"
  ) {
    fail(`The host profile must define ${key}.cdpPort and ${key}.taskName.`);
  }
  if (selectedTarget === "installed" && typeof config.executable !== "string") {
    fail("The host profile must define installed.executable.");
  }
  if (
    selectedTarget === SEEDED_TARGET &&
    typeof config.userDataDir !== "string"
  ) {
    fail(`The host profile must define ${key}.userDataDir.`);
  }
  return config;
}
