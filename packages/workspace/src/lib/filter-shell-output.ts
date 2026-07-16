import os from "node:os";

import { type TaskDir } from "../schemas/paths";
import { normalizePath } from "./normalize-path";

export function filterShellOutput(output: string, dir: TaskDir): string {
  let filtered = output;
  for (const variant of pathVariants(dir)) {
    filtered = filtered.replaceAll(
      new RegExp(escapeRegExp(variant), "gi"),
      ".",
    );
  }

  // Redact the host home dir (the pnpm store/cache/dlx paths and tool stack
  // traces sit beneath it) so output stays sandbox-shaped and never leaks the
  // host layout or username. Runs after the task-dir pass so task paths still
  // collapse to ".".
  const home = os.homedir();
  if (home) {
    for (const variant of pathVariants(home)) {
      filtered = filtered.replaceAll(
        new RegExp(escapeRegExp(variant), "gi"),
        "~",
      );
    }
  }

  // Keep agent-facing shell output consistent with tool path inputs.
  filtered = filtered.replaceAll("\\", "/");

  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
  ) {
    filtered = filtered
      .replaceAll(/^.*Debugger attached\..*$\n?/gm, "")
      .replaceAll(/^.*Waiting for the debugger to disconnect\.\.\..*$\n?/gm, "")
      .trim();
  }

  return filtered;
}

export function shouldFilterDebuggerMessage(message: string): boolean {
  return (
    shouldFilter() &&
    (message.includes("Debugger attached.") ||
      message.includes("Waiting for the debugger to disconnect..."))
  );
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every spelling of a path that can appear in subprocess output: as given,
 * slash-normalized, backslash-separated, and the string-escaped form of each
 * -- printed error objects render Windows paths with doubled backslashes
 * (`path: 'C:\\Users\\...'`), which the plain variants never match.
 */
function pathVariants(value: string): Set<string> {
  const normalized = normalizePath(value);
  const base = [value, normalized, normalized.replaceAll("/", "\\")];
  const escaped = base
    .filter((variant) => variant.includes("\\"))
    .map((variant) => variant.replaceAll("\\", "\\\\"));
  return new Set([...base, ...escaped]);
}

function shouldFilter() {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}
