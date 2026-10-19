import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * What starting a sandbox from this process came to: it works, or the
 * system's own settings say it cannot (the sandbox program is not
 * installed, user namespaces are closed), or the probe gave no answer (it
 * timed out under load, the system was out of processes, or it failed for a
 * reason the settings do not show).
 */
export type ProbeResult = "failed" | "unavailable" | "works";

const PROBE_TIMEOUT_MS = 5000;

/**
 * Runs a sandbox's probe. Only an answer is kept by the callers: a probe
 * that gave none is run again the next time a command needs it, since
 * keeping it would run every later command with no rules at all. A probe
 * that fails is "unavailable" only when `cannot` says, from the system's
 * own settings, that no sandbox can be made here; any other failure is no
 * answer, and the command waiting on it does not run.
 */
export function probeSandbox(
  file: string,
  args: readonly string[],
  cannot: () => boolean,
): ProbeResult {
  try {
    execFileSync(file, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: PROBE_TIMEOUT_MS,
    });
    return "works";
  } catch (error) {
    // execFileSync's error carries the spawn's fields, which its type omits.
    const failure = error as {
      code?: string;
      signal?: string | null;
      status?: number | null;
      stderr?: Buffer | string;
    };
    if (failure.code === "ENOENT") {
      return "unavailable";
    }
    if (typeof failure.status === "number" && cannot()) {
      return "unavailable";
    }
    console.warn(
      `The native sandbox probe (${path.basename(file)}) gave no answer: ${
        failure.code ?? failure.signal ?? `exit ${String(failure.status)}`
      } ${String(failure.stderr ?? "").trim()}`.trim(),
    );
    return "failed";
  }
}
