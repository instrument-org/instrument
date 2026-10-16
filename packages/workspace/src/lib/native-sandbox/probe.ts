import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * What starting a sandbox from this process came to: it works, or the system
 * said it cannot (no bubblewrap installed, user namespaces closed, Seatbelt
 * already applied to this process, which does not nest), or the probe gave
 * no answer (it timed out under load, or the system was out of processes).
 */
export type ProbeResult = "failed" | "unavailable" | "works";

const PROBE_TIMEOUT_MS = 5000;

/**
 * Runs a sandbox's probe. Only an answer is kept by the callers: a probe
 * that gave none is run again the next time a command needs it, since
 * keeping it would run every later command with no rules at all.
 */
export function probeSandbox(
  file: string,
  args: readonly string[],
  /** What the system prints when it refuses to make the sandbox here. */
  refusals: readonly string[],
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
    const stderr = String(failure.stderr ?? "");
    if (
      failure.code === "ENOENT" ||
      (typeof failure.status === "number" &&
        refusals.some((refusal) => stderr.includes(refusal)))
    ) {
      return "unavailable";
    }
    console.warn(
      `The native sandbox probe (${path.basename(file)}) gave no answer: ${
        failure.code ?? failure.signal ?? `exit ${String(failure.status)}`
      } ${stderr.trim()}`.trim(),
    );
    return "failed";
  }
}
