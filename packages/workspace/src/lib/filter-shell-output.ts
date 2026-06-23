import os from "node:os";

import { type TaskDir } from "../schemas/paths";
import { normalizePath } from "./normalize-path";

export function filterShellOutput(output: string, dir: TaskDir): string {
  const normalizedTaskDir = normalizePath(dir);
  const taskDirVariants = new Set([
    dir,
    normalizedTaskDir,
    normalizedTaskDir.replaceAll("/", "\\"),
  ]);

  let filtered = output;
  for (const variant of taskDirVariants) {
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
    const normalizedHome = normalizePath(home);
    for (const variant of new Set([
      home,
      normalizedHome,
      normalizedHome.replaceAll("/", "\\"),
    ])) {
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

function shouldFilter() {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}
