import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import { readJsonRecordSync, updateJsonRecord } from "./json-record-file";

// An app started from the Dock, Finder or a desktop entry gets the session's
// bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS), not the one the
// person's shell builds, so Homebrew, nvm, pyenv and the rest are missing from
// every program the agent starts. The login shell's PATH is read in the
// background and applied to this process; until it arrives, the copy saved
// from the last read stands in, and the first spawns that reach a person's
// programs wait on `shellPathReady`.

export const SHELL_PATH_MARKER = "_INSTRUMENT_SHELL_PATH_";

/**
 * Prints the environment between two markers, so whatever the rc files echo
 * (banners, prompts, warnings) falls outside them.
 */
const SHELL_ARGS = [
  "-ilc",
  `echo -n "${SHELL_PATH_MARKER}"; env; echo -n "${SHELL_PATH_MARKER}"; exit`,
];

/** How long the login shell has to print its environment. */
const SHELL_PATH_TIMEOUT_MS = 10_000;

/** Where a Mac or Linux user's own programs usually are, when no read has succeeded yet. */
function commonProgramDirs(home: string = os.homedir()): string[] {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
  ];
}

/**
 * The PATH lists joined in order, each folder kept at its first appearance
 * and empty entries dropped.
 */
export function joinPaths(
  ...lists: (readonly string[] | string | undefined)[]
): string {
  const seen = new Set<string>();
  for (const list of lists) {
    const entries =
      typeof list === "string" ? list.split(path.delimiter) : (list ?? []);
    for (const entry of entries) {
      if (entry) {
        seen.add(entry);
      }
    }
  }
  return [...seen].join(path.delimiter);
}

/** The PATH the shell printed between the markers, or undefined when it printed none. */
export function parseShellPath(stdout: string): string | undefined {
  const parts = stdout.split(SHELL_PATH_MARKER);
  if (parts.length < 3) {
    return undefined;
  }
  for (const line of stripVTControlCharacters(parts[1] ?? "").split("\n")) {
    if (line.startsWith("PATH=")) {
      return line.slice("PATH=".length).trim() || undefined;
    }
  }
  return undefined;
}

/** The PATH saved by the last successful read, or undefined when there is none to trust. */
export function readSavedPath(file: string): string | undefined {
  const read = readJsonRecordSync(file);
  return read.kind === "read" &&
    typeof read.record.path === "string" &&
    read.record.path
    ? read.record.path
    : undefined;
}

export async function savePath(file: string, value: string): Promise<void> {
  await updateJsonRecord(file, () => ({ path: value }));
}

/** The person's login shell, the way `default-shell` finds it. */
function loginShell(): string {
  try {
    const { shell } = os.userInfo();
    if (shell) {
      return shell;
    }
  } catch {
    // No passwd entry: fall through to the environment.
  }
  return (
    process.env.SHELL ||
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh")
  );
}

/**
 * Runs the login shell as an interactive one, so both its profile and its rc
 * files are read, and returns the PATH it ends up with. Never rejects: a
 * shell that fails, prints no PATH, or outlasts `timeoutMs` (which kills its
 * whole process group) comes back as an error to log.
 */
export function readLoginShellPath({
  env,
  shell,
  timeoutMs,
}: {
  env: NodeJS.ProcessEnv;
  shell: string;
  timeoutMs: number;
}): Promise<{ error: string } | { path: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const child = spawn(shell, SHELL_ARGS, {
      // Its own session, so an interactive shell never reaches for the
      // terminal a development build was started from, and a timeout can end
      // whatever the rc files started along with it.
      detached: true,
      // Keeps Oh My Zsh from stopping to ask about an update.
      env: { ...env, DISABLE_AUTO_UPDATE: "true" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const killGroup = () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    };
    const finish = (result: { error: string } | { path: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      process.off("exit", killGroup);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killGroup();
      finish({
        error: `${shell} did not print its PATH within ${timeoutMs} ms`,
      });
    }, timeoutMs);
    process.on("exit", killGroup);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      finish({ error: `${shell} could not start: ${error.message}` });
    });
    // On close rather than exit, so every byte written to stdout is in.
    child.on("close", (code, signal) => {
      const found = parseShellPath(stdout);
      finish(
        found
          ? { path: found }
          : {
              error: `${shell} printed no PATH (exit ${String(code ?? signal)})`,
            },
      );
    });
  });
}

let ready: Promise<void> = Promise.resolve();

/**
 * Settles once the login shell's PATH is on this process, or once reading it
 * has failed or timed out. Already settled when no read was started (Windows,
 * tests, scripts), so awaiting it before a spawn is always safe.
 */
export function shellPathReady(): Promise<void> {
  return ready;
}

/**
 * Puts the saved PATH on this process now, without spawning anything, and
 * starts reading the login shell's in the background. Call once, as early as
 * the cache file's folder is known.
 *
 * What a read applies is the shell's PATH, after any folder this process put
 * at the front since (the app's own `bin/`) and before the PATH it was
 * launched with, so nothing the app or its launcher set is lost.
 */
export function startLoginShellPath({
  cacheFile,
  log,
  shell = loginShell(),
  timeoutMs = SHELL_PATH_TIMEOUT_MS,
}: {
  cacheFile: string;
  log: (message: string) => void;
  shell?: string;
  timeoutMs?: number;
}): void {
  if (process.platform === "win32") {
    return;
  }
  const launched = process.env.PATH;
  const saved = readSavedPath(cacheFile);
  const startup = saved
    ? joinPaths(saved, launched)
    : joinPaths(launched, commonProgramDirs());
  process.env.PATH = startup;

  const started = Date.now();
  ready = readLoginShellPath({
    // The shell builds its PATH from the one the app was launched with, so
    // what it prints never depends on the saved copy.
    env: { ...process.env, PATH: launched },
    shell,
    timeoutMs,
  }).then(async (result) => {
    if ("error" in result) {
      log(
        `Login shell PATH not read, keeping ${saved ? "the saved one" : "the fallback"}: ${result.error}`,
      );
      return;
    }
    process.env.PATH = applyShellPath({
      current: process.env.PATH,
      launched,
      shell: result.path,
      startup,
    });
    log(`Login shell PATH read from ${shell} in ${Date.now() - started} ms`);
    if (result.path !== saved) {
      await savePath(cacheFile, result.path).catch((error: unknown) => {
        log(
          `Could not save the login shell PATH: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  });
}

/**
 * The PATH once the shell's has arrived: folders put on `current` since
 * startup first, then the shell's, then what the process was launched with.
 * The saved copy and the fallback folders only stood in, so they go.
 */
export function applyShellPath({
  current,
  launched,
  shell,
  startup,
}: {
  current: string | undefined;
  launched: string | undefined;
  shell: string;
  startup: string;
}): string {
  const before = new Set(startup.split(path.delimiter));
  const added = (current ?? "")
    .split(path.delimiter)
    .filter((entry) => !before.has(entry));
  return joinPaths(added, shell, launched);
}
