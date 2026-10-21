import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { isRegistrySpec, outsidePlan } from "./pnpm-outside";
import { runtimeLayout } from "./runtime-dir";
import { getWorkspaceConfig } from "./workspace-config";
import { type WorkspaceFsLayout } from "./workspace-fs-layout";

/**
 * `pnpm dlx` where the sandbox refuses links (MXC on Windows): dlx installs
 * a package into a cache of its own and runs its program, and installing
 * makes junctions, which MXC refuses a program it holds. So the install is
 * the app's install step outside the sandbox (`pnpm-outside.ts`: registry
 * packages only, every package's own code off), into a folder of the app's
 * for that set of packages; the install scripts it skipped and the
 * package's program then run inside, as every command does. Inside only
 * reads through the links, which the sandbox allows.
 *
 * Only dlx's own options are read (`--package`/`-p` before the command);
 * any other, or a package that is not the registry's, is left to `pnpm
 * dlx` as it is.
 */
export interface DlxPlan {
  /** What follows the command, passed to its program as given. */
  args: string[];
  /** The program to run: its bin name, or the package's when it has one. */
  command: string;
  /** Where the packages are installed, a folder of the app's. */
  dir: string;
  packages: string[];
}

/** How long an install is run from before it is made again, as dlx's own cache. */
const FRESH_MS = 24 * 60 * 60 * 1000;

export function dlxPlan(args: readonly string[]): DlxPlan | undefined {
  const packages: string[] = [];
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--package" || arg === "-p") {
      index += 1;
      packages.push(args[index] ?? "");
    } else if (arg.startsWith("--package=")) {
      packages.push(arg.slice("--package=".length));
    } else if (arg.startsWith("-")) {
      return undefined;
    } else {
      break;
    }
  }
  const command = args[index];
  if (command === undefined) {
    return undefined;
  }
  const wanted = packages.length > 0 ? packages : [command];
  if (!wanted.every(isRegistrySpec)) {
    return undefined;
  }
  const key = createHash("sha256")
    .update(wanted.toSorted().join("\n"))
    .digest("hex")
    .slice(0, 16);
  return {
    args: args.slice(index + 1),
    command: packages.length > 0 ? command : unscoped(nameOf(command)),
    dir: path.join(
      runtimeLayout(getWorkspaceConfig().runtimeDir).caches,
      "dlx",
      key,
    ),
    packages: wanted,
  };
}

/**
 * The outside install for a plan, or nothing when the one there is fresh.
 * Undefined `install` with `ready` false means the folder cannot be
 * installed outside, and dlx runs as it is.
 */
export function dlxInstall(
  plan: DlxPlan,
  layout: WorkspaceFsLayout,
): { install?: ReturnType<typeof outsidePlan>; ready: boolean } {
  mkdirSync(plan.dir, { recursive: true });
  if (isFresh(plan.dir)) {
    return { ready: true };
  }
  // A project of its own, so pnpm installs here and nowhere above, whose
  // install scripts may run for the packages asked for, as dlx's may.
  writeFileSync(path.join(plan.dir, "package.json"), "{}\n");
  writeFileSync(
    path.join(plan.dir, "pnpm-workspace.yaml"),
    `allowBuilds:\n${plan.packages
      .map((spec) => `  ${JSON.stringify(nameOf(spec))}: true\n`)
      .join("")}`,
  );
  const install = outsidePlan({
    args: ["add", ...plan.packages],
    cwd: plan.dir,
    layout,
  });
  return install ? { install, ready: false } : { ready: false };
}

/**
 * The file a plan's program is, from its package's `bin`: the entry named
 * by the command, or the package's only one. Undefined where no package
 * installed has it.
 */
export function dlxProgram(plan: DlxPlan): string | undefined {
  for (const spec of plan.packages) {
    const folder = path.join(plan.dir, "node_modules", nameOf(spec));
    let manifest: unknown;
    try {
      manifest = JSON.parse(
        readFileSync(path.join(folder, "package.json"), "utf8"),
      );
    } catch {
      continue;
    }
    const bin =
      typeof manifest === "object" && manifest !== null && "bin" in manifest
        ? manifest.bin
        : undefined;
    const own = unscoped(nameOf(spec));
    const file =
      typeof bin === "string"
        ? plan.command === own
          ? bin
          : undefined
        : isStringRecord(bin)
          ? (bin[plan.command] ??
            (Object.keys(bin).length === 1 ? Object.values(bin)[0] : undefined))
          : undefined;
    if (file !== undefined) {
      return path.resolve(folder, file);
    }
  }
  return undefined;
}

/** A package's name from what was asked for: `name` or `@scope/name`, without the version. */
function nameOf(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

function unscoped(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

function isFresh(dir: string): boolean {
  const manifest = path.join(dir, "node_modules", ".modules.yaml");
  if (!existsSync(manifest)) {
    return false;
  }
  return Date.now() - statSync(manifest).mtimeMs < FRESH_MS;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((each) => typeof each === "string")
  );
}
