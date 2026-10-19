import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { parse, parseAllDocuments } from "yaml";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema } from "../schemas/paths";
import { reachOf } from "./permissions/rules";
import { PNPM_NAME, runPnpmCommand, runPnpmOutsideSandbox } from "./run-pnpm";
import { runtimeLayout } from "./runtime-dir";
import { getWorkspaceConfig } from "./workspace-config";
import {
  classifyHostPath,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

/**
 * pnpm's install step outside the native sandbox.
 *
 * Installing makes links: pnpm's `node_modules` is symlinks on macOS and
 * Linux and junctions on Windows, and MXC refuses a program it holds both.
 * So an install from the npm registry runs in two steps, the same on every
 * platform. The app's own pnpm installs with no sandbox and with every
 * package's code off (install scripts, pnpmfiles, another pnpm a project
 * names), from a store no chat can change; then `pnpm rebuild --pending`
 * runs the install scripts that step skipped, held by the sandbox like any
 * other command.
 *
 * Only what is known to be the registry's runs outside: the command names
 * registry packages, and the project it installs into holds nothing that
 * reads a file or runs a program of its own choosing (a `file:`, `link:` or
 * git dependency, a lockfile entry that resolves anywhere but the registry,
 * a pnpmfile, a project `.npmrc`, settings beyond the build approvals, a
 * workspace above it, a link out of its `node_modules`). Anything else runs
 * inside the sandbox as every pnpm command did, which works where the
 * sandbox allows links.
 *
 * What the outside step can write is the project folder, which the rules
 * must let the chat write, and the install folders, which no chat writes.
 * What a program started at the same moment changes while it runs (a link
 * swapped in after the check) is not covered.
 */

type Kind = "add" | "install" | "remove" | "update";

/** The install-shaped subcommands, by each spelling pnpm takes. */
const SUBCOMMANDS: Readonly<Record<string, Kind>> = {
  add: "add",
  i: "install",
  install: "install",
  remove: "remove",
  rm: "remove",
  un: "remove",
  uninstall: "remove",
  up: "update",
  update: "update",
};

const SAVE_FLAGS = [
  "-D",
  "--save-dev",
  "-O",
  "--save-optional",
  "-P",
  "--save-prod",
];
const NETWORK_FLAGS = ["--offline", "--prefer-offline"];
const INCLUDE_FLAGS = ["--dev", "--no-optional", "--prod", "--production"];

/**
 * The options each runs outside with: none names a file, a folder, a
 * registry or a setting. `-D` and `-P` read as `--dev` and `--prod` to
 * `install` and `update`, which is as harmless.
 */
const FLAGS: Readonly<Record<Kind, ReadonlySet<string>>> = {
  add: new Set([
    ...SAVE_FLAGS,
    ...NETWORK_FLAGS,
    "-E",
    "--save-exact",
    "--save-peer",
  ]),
  install: new Set([
    ...NETWORK_FLAGS,
    ...INCLUDE_FLAGS,
    "-D",
    "-P",
    "--fix-lockfile",
    "--frozen-lockfile",
    "--lockfile-only",
    "--no-frozen-lockfile",
    "--prefer-frozen-lockfile",
  ]),
  remove: new Set(SAVE_FLAGS),
  update: new Set([
    ...NETWORK_FLAGS,
    ...INCLUDE_FLAGS,
    "-D",
    "-L",
    "-P",
    "--latest",
  ]),
};

/** A package name on the registry, scoped or not. */
const NAME = /^(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/i;

/** pnpm reads a name ending like an archive as a file to install. */
const ARCHIVE = /\.(?:tgz|tar|tar\.gz)$/i;

/**
 * A version, range or dist-tag: no `:`, `/` or `\`, so no protocol
 * (`file:`, `link:`, `workspace:`, `git+`, `https:`), no path and no
 * `owner/repo`.
 */
const RANGE = /^[\w.^~<>=*|+ -]*$/;

function isName(name: string): boolean {
  return name.length <= 214 && NAME.test(name) && !ARCHIVE.test(name);
}

/**
 * Whether a package the agent named on the command line is a registry
 * package: `name`, `@scope/name`, either with `@` and a version, range or
 * tag.
 */
export function isRegistrySpec(spec: string): boolean {
  const at = spec.lastIndexOf("@");
  if (at <= 0) {
    return isName(spec);
  }
  const range = spec.slice(at + 1);
  return isName(spec.slice(0, at)) && range !== "" && RANGE.test(range);
}

/**
 * Whether a dependency's specifier in a package.json or lockfile resolves
 * on the registry: a version, range or tag, or an alias of a registry
 * package (`npm:name@range`).
 */
export function isRegistryRange(specifier: string): boolean {
  if (specifier.startsWith("npm:")) {
    return isRegistrySpec(specifier.slice("npm:".length));
  }
  return RANGE.test(specifier);
}

/** Whether a `pnpm` command installs, adds, removes or updates packages. */
export function installsPackages(args: readonly string[]): boolean {
  const [subcommand] = args;
  return subcommand !== undefined && SUBCOMMANDS[subcommand] !== undefined;
}

/**
 * The arguments to run outside the sandbox for the agent's `pnpm` command,
 * or undefined when it runs inside as before: a subcommand that installs,
 * options from the list above, and registry packages alone. `--dir` names
 * the project, so pnpm does not look for one above it, where the rules
 * were not asked.
 */
export function outsideArgs(
  args: readonly string[],
  project: string,
): string[] | undefined {
  const [subcommand, ...rest] = args;
  const kind = subcommand === undefined ? undefined : SUBCOMMANDS[subcommand];
  if (kind === undefined || subcommand === undefined) {
    return undefined;
  }
  const flags = rest.filter((arg) => arg.startsWith("-"));
  const packages = rest.filter((arg) => !arg.startsWith("-"));
  if (flags.some((flag) => !FLAGS[kind].has(flag))) {
    return undefined;
  }
  const named =
    kind === "remove"
      ? packages.length > 0 && packages.every(isName)
      : kind === "install"
        ? packages.length === 0
        : (kind === "update" || packages.length > 0) &&
          packages.every(isRegistrySpec);
  if (!named) {
    return undefined;
  }
  return [
    subcommand,
    ...rest,
    // `remove` takes neither: the settings in the environment hold it.
    ...(kind === "remove" ? [] : ["--ignore-scripts", "--ignore-pnpmfile"]),
    // A project installed from another store is installed again from this
    // one rather than refused.
    ...(kind === "install" ? ["--config.confirm-modules-purge=false"] : []),
    "--dir",
    project,
  ];
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Why a project's package.json keeps its install in the sandbox, or
 * undefined when every dependency it names is a registry package. A
 * `devEngines` or `engines.runtime` has pnpm fetch a Node runtime, which is
 * no registry package either.
 */
export function manifestReason(manifest: unknown): string | undefined {
  if (!isRecord(manifest)) {
    return "package.json is not an object";
  }
  if (
    manifest.devEngines !== undefined ||
    (isRecord(manifest.engines) && manifest.engines.runtime !== undefined)
  ) {
    return "package.json names a runtime";
  }
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (deps === undefined) {
      continue;
    }
    if (!isRecord(deps)) {
      return `package.json ${field} is not an object`;
    }
    for (const [name, specifier] of Object.entries(deps)) {
      if (
        !isName(name) ||
        typeof specifier !== "string" ||
        !isRegistryRange(specifier)
      ) {
        return `package.json ${field} names ${name}`;
      }
    }
  }
  return undefined;
}

const LOCKFILE_KEYS = new Set([
  "importers",
  "lockfileVersion",
  "packages",
  "settings",
  "snapshots",
]);

const IMPORTER_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

/**
 * Why a project's pnpm-lock.yaml keeps its install in the sandbox, or
 * undefined when every package in it resolves on the registry. pnpm takes
 * the lockfile's word for where a package comes from, a dependency of a
 * dependency included, so a `directory:` or `tarball:` resolution there
 * would be read or fetched wherever it points.
 */
export function lockfileReason(text: string): string | undefined {
  let documents: unknown[];
  try {
    const parsed = parseAllDocuments(text);
    if (parsed.some((document) => document.errors.length > 0)) {
      return "pnpm-lock.yaml does not parse";
    }
    documents = parsed.map((document) => {
      const value: unknown = document.toJS({ maxAliasCount: 0 });
      return value;
    });
  } catch {
    return "pnpm-lock.yaml does not parse";
  }
  for (const lockfile of documents) {
    if (lockfile === null || lockfile === undefined) {
      continue;
    }
    if (!isRecord(lockfile)) {
      return "pnpm-lock.yaml is not an object";
    }
    const extra = Object.keys(lockfile).find((key) => !LOCKFILE_KEYS.has(key));
    if (extra !== undefined) {
      return `pnpm-lock.yaml has ${extra}`;
    }
    const { importers = {}, packages = {}, snapshots = {} } = lockfile;
    if (!isRecord(importers) || !isRecord(packages) || !isRecord(snapshots)) {
      return "pnpm-lock.yaml is malformed";
    }
    for (const [id, importer] of Object.entries(importers)) {
      if (id !== "." || !isRecord(importer)) {
        return `pnpm-lock.yaml has the importer ${id}`;
      }
      for (const field of IMPORTER_FIELDS) {
        const deps = importer[field];
        if (deps === undefined) {
          continue;
        }
        if (!isRecord(deps)) {
          return `pnpm-lock.yaml ${field} is malformed`;
        }
        for (const [name, dep] of Object.entries(deps)) {
          if (
            !isRecord(dep) ||
            typeof dep.specifier !== "string" ||
            !isRegistryRange(dep.specifier) ||
            typeof dep.version !== "string" ||
            dep.version.includes(":")
          ) {
            return `pnpm-lock.yaml names ${name}`;
          }
        }
      }
    }
    for (const [id, entry] of Object.entries(packages)) {
      const resolution = isRecord(entry) ? entry.resolution : undefined;
      if (
        !isRecord(resolution) ||
        Object.keys(resolution).some((key) => key !== "integrity") ||
        typeof resolution.integrity !== "string"
      ) {
        return `pnpm-lock.yaml resolves ${id} off the registry`;
      }
    }
    for (const [id, snapshot] of Object.entries(snapshots)) {
      if (!isRecord(snapshot)) {
        return `pnpm-lock.yaml has the snapshot ${id}`;
      }
      for (const field of ["dependencies", "optionalDependencies"]) {
        const deps = snapshot[field];
        if (
          deps !== undefined &&
          (!isRecord(deps) ||
            Object.values(deps).some(
              (version) => typeof version !== "string" || version.includes(":"),
            ))
        ) {
          return `pnpm-lock.yaml snapshot ${id} links off the registry`;
        }
      }
    }
  }
  return undefined;
}

/**
 * The settings a project's pnpm-workspace.yaml may hold for its install to
 * run outside: which packages' install scripts may run, which the
 * sandboxed rebuild reads, and the release-age gate. Anything else (a
 * `packages` list, `overrides`, `patchedDependencies`, `configDependencies`,
 * a store or modules folder, `catalogs`) can name a file, a folder or a
 * program, so its install stays in the sandbox.
 */
const WORKSPACE_SETTINGS = new Set([
  "allowBuilds",
  "ignoredBuiltDependencies",
  "minimumReleaseAge",
  "minimumReleaseAgeExclude",
  "neverBuiltDependencies",
  "onlyBuiltDependencies",
]);

/** Why a project's pnpm-workspace.yaml keeps its install in the sandbox. */
export function workspaceManifestReason(text: string): string | undefined {
  let documents;
  try {
    documents = parseAllDocuments(text);
  } catch {
    return "pnpm-workspace.yaml does not parse";
  }
  if (documents.length > 1 || documents[0]?.errors.length) {
    return "pnpm-workspace.yaml does not parse";
  }
  const settings: unknown = documents[0]?.toJS({ maxAliasCount: 0 });
  if (settings === null || settings === undefined) {
    return undefined;
  }
  if (!isRecord(settings)) {
    return "pnpm-workspace.yaml is not an object";
  }
  const extra = Object.keys(settings).find(
    (key) => !WORKSPACE_SETTINGS.has(key),
  );
  return extra === undefined ? undefined : `pnpm-workspace.yaml sets ${extra}`;
}

/**
 * What pnpm takes as a project's folder: the nearest one holding any of
 * these, or the folder it runs in when none does.
 */
const PROJECT_MARKERS = [
  "node_modules",
  "package.json",
  "package.json5",
  "package.yaml",
  "pnpm-workspace.yaml",
];

/** Files in a project that keep its install in the sandbox. */
const SANDBOX_ONLY_FILES = [
  ".npmrc",
  ".pnpmfile.cjs",
  ".pnpmfile.mjs",
  "package.json5",
  "package.yaml",
  "pnpm-workspace.yml",
];

/** A walk of `node_modules` longer than this stays in the sandbox. */
const MAX_WALKED_ENTRIES = 500_000;

function lstatOrUndefined(file: string) {
  try {
    return lstatSync(file, { bigint: true });
  } catch {
    return undefined;
  }
}

function isWithin(folder: string, target: string): boolean {
  const relative = path.relative(folder, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * A file the unsandboxed pnpm reads or replaces: absent, or a plain file
 * with one name, so neither a link nor a second name leads its read or
 * write anywhere else. Its text, null when absent, undefined when refused.
 */
function plainFile(file: string): string | null | undefined {
  const stat = lstatOrUndefined(file);
  if (stat === undefined) {
    return null;
  }
  if (!stat.isFile() || stat.nlink !== 1n) {
    return undefined;
  }
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The first link in a project's `node_modules` that leads out of the
 * project, or that leads nowhere: pnpm writes through the folders it
 * finds there, so one the agent made would carry its writes outside.
 */
export function linkOutOf(project: string, folder: string): string | undefined {
  const stack = [folder];
  let walked = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) {
      break;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return dir;
    }
    for (const entry of entries) {
      walked += 1;
      if (walked > MAX_WALKED_ENTRIES) {
        return folder;
      }
      const entryPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let real;
        try {
          real = realpathSync.native(entryPath);
        } catch {
          return entryPath;
        }
        if (!isWithin(project, real)) {
          return entryPath;
        }
      } else if (entry.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }
  return undefined;
}

/**
 * Why the project in `project` (a real path) keeps its install in the
 * sandbox, or undefined when the unsandboxed pnpm would read and write only
 * what is checked here.
 */
export function projectReason(project: string): string | undefined {
  for (const name of SANDBOX_ONLY_FILES) {
    if (lstatOrUndefined(path.join(project, name)) !== undefined) {
      return `the project has ${name}`;
    }
  }
  const manifest = plainFile(path.join(project, "package.json"));
  if (manifest === undefined) {
    return "package.json is not a plain file";
  }
  if (manifest !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest);
    } catch {
      return "package.json does not parse";
    }
    const reason = manifestReason(parsed);
    if (reason) {
      return reason;
    }
  }
  const lockfile = plainFile(path.join(project, "pnpm-lock.yaml"));
  if (lockfile === undefined) {
    return "pnpm-lock.yaml is not a plain file";
  }
  const lockfileWhy = lockfile === null ? undefined : lockfileReason(lockfile);
  if (lockfileWhy) {
    return lockfileWhy;
  }
  const workspace = plainFile(path.join(project, "pnpm-workspace.yaml"));
  if (workspace === undefined) {
    return "pnpm-workspace.yaml is not a plain file";
  }
  const workspaceWhy =
    workspace === null ? undefined : workspaceManifestReason(workspace);
  if (workspaceWhy) {
    return workspaceWhy;
  }
  const above = workspaceAbove(project, {
    ownManifest: manifest !== null,
    ownWorkspace: workspace !== null,
  });
  if (above !== undefined) {
    return `${above} is above the project`;
  }
  const modules = path.join(project, "node_modules");
  const modulesStat = lstatOrUndefined(modules);
  if (modulesStat !== undefined) {
    if (!modulesStat.isDirectory()) {
      return "node_modules is not a folder";
    }
    const link = linkOutOf(project, modules);
    if (link !== undefined) {
      return `${link} leads out of the project`;
    }
  }
  return undefined;
}

/**
 * The workspace manifest above a project that pnpm would take it to belong
 * to, as pnpm looks: the nearest `pnpm-workspace.yaml` from the project up,
 * none past the project's own, and none that lists no `packages` when the
 * project has a package.json of its own, since its default list holds only
 * the folder it is in.
 */
function workspaceAbove(
  project: string,
  {
    ownManifest,
    ownWorkspace,
  }: { ownManifest: boolean; ownWorkspace: boolean },
): string | undefined {
  if (ownWorkspace) {
    return undefined;
  }
  for (
    let dir = path.dirname(project);
    dir !== path.dirname(dir);
    dir = path.dirname(dir)
  ) {
    if (lstatOrUndefined(path.join(dir, "pnpm-workspace.yml")) !== undefined) {
      return path.join(dir, "pnpm-workspace.yml");
    }
    const found = path.join(dir, "pnpm-workspace.yaml");
    if (lstatOrUndefined(found) === undefined) {
      continue;
    }
    if (!ownManifest) {
      return found;
    }
    try {
      const settings: unknown = parse(readFileSync(found, "utf8"), {
        maxAliasCount: 0,
      });
      return isRecord(settings) && settings.packages !== undefined
        ? found
        : undefined;
    } catch {
      return found;
    }
  }
  return undefined;
}

/**
 * Whether the chat may change the project as the rules decide any write:
 * in a folder it reaches that is not read-only, with the project and what
 * pnpm writes in it allowed.
 */
export function chatMayWrite(
  layout: WorkspaceFsLayout,
  project: string,
): boolean {
  const held = classifyHostPath(layout, project);
  if (!held || held.escapes || held.mount.readOnly) {
    return false;
  }
  return [
    project,
    ...["node_modules", "package.json", "pnpm-lock.yaml"].map((name) =>
      path.join(project, name),
    ),
  ].every((target) => reachOf(layout.rules, target, "write").level === "allow");
}

/**
 * Whether pnpm and the executable that runs it are out of the chat's
 * reach to change: an install outside the sandbox runs whatever is there,
 * so in a checkout the agent may write, installs stay inside.
 */
function pnpmOutOfReach(layout: WorkspaceFsLayout): boolean {
  let pnpmRoot: string;
  let runtime: string;
  try {
    pnpmRoot = path.dirname(
      path.dirname(realpathSync.native(getWorkspaceConfig().pnpmBinPath)),
    );
    runtime = path.dirname(realpathSync.native(process.execPath));
  } catch {
    return false;
  }
  return [pnpmRoot, runtime].every(
    (folder) => reachOf(layout.rules, folder, "write").level !== "allow",
  );
}

/**
 * The folder pnpm takes as the project for a command run in `cwd`, as it
 * looks for one: the nearest folder holding a project marker, looked for
 * only in folders the rules let the agent read, as the sandbox lets pnpm
 * look; `cwd` itself when none does.
 */
export function projectFolder(layout: WorkspaceFsLayout, cwd: string): string {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (reachOf(layout.rules, dir, "read").level !== "allow") {
      return cwd;
    }
    if (
      PROJECT_MARKERS.some(
        (name) => lstatOrUndefined(path.join(dir, name)) !== undefined,
      )
    ) {
      return dir;
    }
    if (dir === path.dirname(dir)) {
      return cwd;
    }
  }
}

/** What runs outside the sandbox for a command, when it may. */
export interface OutsidePlan {
  args: string[];
  /** The project's real path, where pnpm writes. */
  project: string;
}

/**
 * Whether the agent's `pnpm` command, run in `cwd` (a host path), installs
 * outside the sandbox, and how.
 */
export function outsidePlan({
  args,
  cwd,
  layout,
}: {
  args: readonly string[];
  cwd: string;
  layout: WorkspaceFsLayout;
}): OutsidePlan | undefined {
  if (outsideArgs(args, "") === undefined) {
    return undefined;
  }
  let project: string;
  try {
    project = realpathSync.native(projectFolder(layout, cwd));
  } catch {
    return undefined;
  }
  if (
    !chatMayWrite(layout, project) ||
    !pnpmOutOfReach(layout) ||
    projectReason(project) !== undefined
  ) {
    return undefined;
  }
  const planned = outsideArgs(args, project);
  return planned && { args: planned, project };
}

/** The install folders' store, as `.modules.yaml` names it. */
function installStore(): string {
  return path.join(
    runtimeLayout(getWorkspaceConfig().runtimeDir).installCaches,
    "pnpm-store",
  );
}

/** What `node_modules/.modules.yaml` records, read as a plain file. */
function modulesManifest(project: string):
  | undefined
  | {
      ignoredBuilds: string[];
      pendingBuilds: string[];
      storeDir?: string;
    } {
  const text = plainFile(path.join(project, "node_modules", ".modules.yaml"));
  if (!text) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parse(text, { maxAliasCount: 0 });
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  return {
    ignoredBuilds: strings(parsed.ignoredBuilds),
    pendingBuilds: strings(parsed.pendingBuilds),
    ...(typeof parsed.storeDir === "string" && { storeDir: parsed.storeDir }),
  };
}

/**
 * pnpm's settings for a build in the sandbox of a project the install step
 * installed: its store, which the build only reads and must name as the
 * install did, or the next install would find the project linked from
 * another store. Undefined for a project installed inside.
 */
export function installedProjectConfig(
  project: string,
): Record<string, string> | undefined {
  const storeDir = modulesManifest(project)?.storeDir;
  if (storeDir === undefined || !isWithin(installStore(), storeDir)) {
    return undefined;
  }
  return {
    pnpm_config_frozen_store: "true",
    pnpm_config_side_effects_cache: "false",
    pnpm_config_store_dir: installStore(),
  };
}

type PnpmResult = Awaited<ReturnType<typeof runPnpmCommand>>;

/**
 * Runs `plan` outside the sandbox, then the install scripts it skipped
 * inside it. A project linked from another store is installed again from
 * the install store first, since pnpm refuses to add to it otherwise.
 * A package whose scripts nobody allowed is reported the way pnpm reports
 * it, so the agent learns to approve it.
 */
export async function installOutside({
  chatId,
  env,
  plan,
  signal,
}: {
  chatId: ChatId;
  /** The shell's environment, for the build in the sandbox. */
  env: Record<string, string>;
  plan: OutsidePlan;
  signal?: AbortSignal;
}): Promise<PnpmResult> {
  const cwd = AbsolutePathSchema.parse(plan.project);
  const results: PnpmResult[] = [];
  const before = modulesManifest(plan.project)?.storeDir;
  if (
    before !== undefined &&
    !isWithin(installStore(), before) &&
    plan.args[0] !== "install" &&
    plan.args[0] !== "i"
  ) {
    const reinstall = await runPnpmOutsideSandbox({
      args: outsideArgs(["install"], plan.project) ?? [],
      cwd,
      signal,
    });
    results.push(reinstall);
    if (reinstall.exitCode !== 0) {
      return combined(plan.args, results);
    }
  }
  const installed = await runPnpmOutsideSandbox({
    args: plan.args,
    cwd,
    signal,
  });
  results.push(installed);
  const pending = modulesManifest(plan.project)?.pendingBuilds ?? [];
  if (installed.exitCode !== 0 || pending.length === 0) {
    return combined(plan.args, results);
  }
  const built = await runPnpmCommand({
    args: ["rebuild", "--pending"],
    chatId,
    cwd,
    env,
    pnpmConfig: installedProjectConfig(plan.project),
    signal,
  });
  results.push(built);
  const ignored = modulesManifest(plan.project)?.ignoredBuilds ?? [];
  const result = combined(plan.args, results);
  return ignored.length === 0
    ? result
    : {
        ...result,
        // pnpm's own words for builds it skipped, which the bash tool
        // answers with how to allow them (`ignoredBuildsNote`).
        stdout: `${result.stdout}Ignored build scripts: ${ignored.join(", ")}.\nRun "${PNPM_NAME} approve-builds" to pick which dependencies should be allowed to run scripts.\n`,
      };
}

/** Each step's output on lines of its own. */
function joinedOutput(outputs: string[]): string {
  return outputs
    .filter((output) => output !== "")
    .map((output) => (output.endsWith("\n") ? output : `${output}\n`))
    .join("");
}

/** Steps run as one command: their output in order, the first failure's exit code. */
function combined(args: string[], results: PnpmResult[]): PnpmResult {
  return {
    command: `${PNPM_NAME} ${args.join(" ")}`,
    exitCode: results.find((result) => result.exitCode !== 0)?.exitCode ?? 0,
    stderr: joinedOutput(results.map((result) => result.stderr)),
    stdout: joinedOutput(results.map((result) => result.stdout)),
  };
}
