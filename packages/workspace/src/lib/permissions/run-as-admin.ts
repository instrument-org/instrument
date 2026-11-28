import { APP_NAME } from "@instrument-org/shared";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { truncateMiddle } from "../truncate-buffer";
import { windowsPowerShell } from "../windows-system-program";

/**
 * Runs a command the person allowed on an admin card as an administrator,
 * behind the system's own prompt: macOS's password prompt through
 * `osascript`, Windows' User Account Control through `Start-Process -Verb
 * RunAs`. Run by the app itself, never the agent's sandboxed shell, and
 * only ever on the computer whose card it is.
 */

/** How a run as administrator ended. */
export type AdminRun =
  | { exitCode: number; is: "ran"; output: string }
  /** The person canceled the system's prompt: nothing ran. */
  | { is: "canceled" }
  /** The system could not run it, or the platform has no way to. */
  | { is: "failed"; message: string };

/**
 * The words in macOS's password prompt: fixed, never the agent's, since a
 * prompt the agent could word would be a phishing page.
 */
export const MACOS_ADMIN_PROMPT = `${APP_NAME} is running a command you allowed in a chat. Enter your password to allow this.`;

/** The longest command a card runs, which Windows' command line bounds once encoded twice. */
export const ADMIN_COMMAND_MAX_CHARS = 8000;

/** How much of what the command printed is kept, head and tail. */
const OUTPUT_KEPT_BYTES = 8 * 1024;

/**
 * The AppleScript that runs `item 1 of argv` in bash as an administrator.
 * The command arrives as an argument and is quoted by AppleScript's own
 * `quoted form of`, so no character of it is ever read as script; stderr
 * joins stdout, and the exit status follows on a line of its own, so a
 * failing command still hands back what it printed.
 */
export function macosAdminScript(): string[] {
  return [
    "on run argv",
    `do shell script "/bin/bash -c " & quoted form of (item 1 of argv) & " 2>&1; s=$?; echo; echo $s" with prompt ${JSON.stringify(MACOS_ADMIN_PROMPT)} with administrator privileges without altering line endings`,
    "end run",
  ];
}

/**
 * What `osascript` printed for `macosAdminScript`: the command's output,
 * then a line our script added, then the exit status.
 */
export function parseMacosRun(stdout: string): AdminRun {
  const trimmed = stdout.replace(/\s+$/u, "");
  const lastLine = trimmed.lastIndexOf("\n");
  const exitCode = Number(trimmed.slice(lastLine + 1));
  if (lastLine === -1 || !Number.isInteger(exitCode)) {
    return { is: "failed", message: `Unexpected output: ${stdout.trim()}` };
  }
  return {
    exitCode,
    is: "ran",
    output: trimmed.slice(0, lastLine).replace(/\n$/u, ""),
  };
}

/**
 * A PowerShell single-quoted string holding `text` as it is: nothing in one
 * is expanded, and a quote is written twice, the curly ones PowerShell also
 * reads as quotes included.
 */
export function powershellLiteral(text: string): string {
  return `'${text.replaceAll(/['‘’‚‛]/gu, (quote) => quote + quote)}'`;
}

/** PowerShell's `-EncodedCommand` form of a script: UTF-16LE in base64. */
function encodedCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * The script the elevated PowerShell runs: the command as a script block,
 * every stream of it into `outFile`, which the app reads back since an
 * elevated process's output can't be piped to the app, and its exit code.
 */
export function windowsElevatedScript(
  command: string,
  outFile: string,
): string {
  return [
    "$global:LASTEXITCODE = 0",
    "$Error.Clear()",
    "$text = ''",
    `try { $text = & ([scriptblock]::Create(${powershellLiteral(command)})) *>&1 | Out-String -Width 4096 } catch { $text = $text + ($_ | Out-String) }`,
    "$code = if ($LASTEXITCODE) { $LASTEXITCODE } elseif ($Error.Count -gt 0) { 1 } else { 0 }",
    `[IO.File]::WriteAllText(${powershellLiteral(outFile)}, [string]$text, [Text.UTF8Encoding]::new($false))`,
    "exit $code",
  ].join("\n");
}

/**
 * The script the app's own PowerShell runs: Windows' administrator prompt
 * for the elevated one, then one line saying how it ended. 1223 is "the
 * operation was canceled by the user", which declining the prompt throws.
 */
export function windowsLauncherScript(
  command: string,
  outFile: string,
): string {
  const encoded = encodedCommand(windowsElevatedScript(command, outFile));
  return [
    "try {",
    `  $p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'`,
    "  'instrument-exit ' + $p.ExitCode",
    "} catch {",
    "  $e = $_.Exception",
    "  $canceled = $false",
    "  while ($e) { if ($e.NativeErrorCode -eq 1223 -or $e.HResult -eq -2147023673) { $canceled = $true }; $e = $e.InnerException }",
    "  if ($canceled) { 'instrument-canceled' } else { 'instrument-failed ' + $_.Exception.Message }",
    "}",
  ].join("\n");
}

/** What the launcher printed, with the output file's text for a run. */
export function parseWindowsRun(stdout: string, output: string): AdminRun {
  const line = stdout.trim().split(/\r?\n/u).at(-1) ?? "";
  if (line === "instrument-canceled") {
    return { is: "canceled" };
  }
  const exit = /^instrument-exit (-?\d+)$/u.exec(line);
  if (exit?.[1] !== undefined) {
    return {
      exitCode: Number(exit[1]),
      is: "ran",
      output: output.replace(/\r\n/gu, "\n").replace(/\s+$/u, ""),
    };
  }
  return {
    is: "failed",
    message: line.replace(/^instrument-failed /u, "") || stdout.trim(),
  };
}

function run(
  file: string,
  args: string[],
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({
          code,
          stderr: stderr || (error && code === 1 ? error.message : ""),
          stdout,
        });
      },
    );
  });
}

async function runOnMac(command: string): Promise<AdminRun> {
  const script = macosAdminScript().flatMap((line) => ["-e", line]);
  const { code, stderr, stdout } = await run("/usr/bin/osascript", [
    ...script,
    command,
  ]);
  return code === 0 ? parseMacosRun(stdout) : readMacosFailure(stderr, code);
}

/**
 * What a failed `osascript` run means. -128 is "User canceled." -60007 is
 * Authorization Services refusing to ask at all, which AppleScript words as a
 * wrong password: the app is not in the person's login session (started over
 * SSH, say), so no prompt could show.
 */
export function readMacosFailure(stderr: string, code: number): AdminRun {
  if (/\(-128\)/u.test(stderr)) {
    return { is: "canceled" };
  }
  if (/\(-60007\)/u.test(stderr)) {
    return {
      is: "failed",
      message:
        "macOS couldn't show its password prompt, so no password was asked for. Instrument isn't running in the user's own login session.",
    };
  }
  return { is: "failed", message: stderr.trim() || `osascript exited ${code}` };
}

async function runOnWindows(command: string): Promise<AdminRun> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "instrument-admin-"));
  const outFile = path.join(folder, "output.txt");
  try {
    const { stdout } = await run(windowsPowerShell(), [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      windowsLauncherScript(command, outFile),
    ]);
    const output = await fs.readFile(outFile, "utf8").catch(() => "");
    return parseWindowsRun(stdout, output);
  } finally {
    await fs.rm(folder, { force: true, recursive: true }).catch(() => {});
  }
}

/** Whether this computer has a way to run a command as an administrator. */
export function canRunAsAdmin(platform = process.platform): boolean {
  return platform === "darwin" || platform === "win32";
}

type AdminRunner = (command: string) => Promise<AdminRun>;

/** The system's own route, or none on a platform without one. */
const systemRunner: AdminRunner = (command) =>
  process.platform === "darwin"
    ? runOnMac(command)
    : process.platform === "win32"
      ? runOnWindows(command)
      : Promise.resolve({
          is: "failed",
          message:
            "This computer has no way to run a command as an administrator.",
        });

let runner: AdminRunner = systemRunner;

/**
 * Puts a stand-in where the system's prompt would be, for tests and evals,
 * which must never put a real password prompt in front of anyone; nothing
 * puts the system's own back.
 */
export function setAdminRunner(standIn: AdminRunner | undefined): void {
  runner = standIn ?? systemRunner;
}

/**
 * Runs `command` as an administrator behind the system's prompt, with what
 * it printed kept to its head and tail. Never throws: a failure is a run
 * that says why.
 */
export async function runAsAdmin(command: string): Promise<AdminRun> {
  try {
    const ran = await runner(command);
    return ran.is === "ran"
      ? {
          ...ran,
          output: truncateMiddle(ran.output, {
            headBytes: OUTPUT_KEPT_BYTES,
            tailBytes: OUTPUT_KEPT_BYTES,
          }).content,
        }
      : ran;
  } catch (error) {
    return {
      is: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
