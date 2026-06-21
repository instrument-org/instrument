import {
  type AppDir,
} from "../schemas/paths";
import {
  normalizePath,
} from "./normalize-path";

export function filterShellOutput(output: string, appDir: AppDir): string {
  const normalizedAppDir = normalizePath(appDir);
  const appDirVariants = new Set([
    appDir,
    normalizedAppDir,
    normalizedAppDir.replaceAll("/", "\\"),
  ]);

  let filtered = output;
  for (const variant of appDirVariants) {
    filtered = filtered.replaceAll(
      new RegExp(escapeRegExp(variant), "gi"),
      ".",
    );
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
