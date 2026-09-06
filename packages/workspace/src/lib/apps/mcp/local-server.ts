import { execa } from "execa";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { type AbsolutePath } from "../../../schemas/paths";
import { absolutePathJoin } from "../../absolute-path-join";
import { commandLineToolsEnv } from "../../command-line-tools-env";
import { getWorkspaceConfig } from "../../workspace-config";
import { type LocalMcpAppManifest } from "../manifest";

/** How a local server is started: what to run, with what, in what environment. */
export interface LocalServerLaunch {
  args: string[];
  command: string;
  env: Record<string, string>;
}

// Installed servers live beside the apps folder rather than inside it. The
// folder is the app's record and the agent writes it; a package's own code is
// neither, and the agent has no mount here.
const SERVERS_DIR_NAME = ".app-servers";

// What the last install put in a server's directory, so an unchanged package
// spec starts the server without going to the registry again.
const INSTALLED_MARKER = ".installed";

const INSTALL_TIMEOUT_MS = 120_000;

/**
 * One line naming what will run, for the card that asks the user to allow it.
 * The package and the runtime are the whole of it: there is no command line to
 * show, because the manifest cannot name one.
 */
export function describeLocalLaunch(manifest: LocalMcpAppManifest): string {
  const registry = manifest.runtime === "node" ? "npm" : "PyPI";
  const args =
    manifest.args && manifest.args.length > 0
      ? ` with ${manifest.args.join(" ")}`
      : "";
  return `the ${registry} package ${manifest.package}${args}`;
}

/**
 * Make a local MCP server runnable and say how to run it.
 *
 * Node servers are installed once into a workspace-managed folder and then
 * launched with the runtime Instrument already ships, by absolute path: no
 * `node` on PATH, no shebang to resolve, and no download on the calls that
 * follow. Python servers go through uv, which manages its own interpreter and
 * caches the environment after the first run.
 *
 * Never throws: an install that fails comes back as a message the agent can
 * act on.
 */
export async function prepareLocalServer({
  manifest,
  signal,
  slug,
}: {
  manifest: LocalMcpAppManifest;
  signal?: AbortSignal;
  slug: string;
}): Promise<Result<LocalServerLaunch, string>> {
  if (manifest.runtime === "python") {
    return ok({
      args: ["tool", "run", manifest.package, ...(manifest.args ?? [])],
      command: getWorkspaceConfig().uvBinPath,
      env: uvEnv(),
    });
  }

  const dir = localServerDir(slug);
  const installed = await installNodePackage({ dir, manifest, signal });
  if (installed.isErr()) {
    return err(installed.error);
  }
  return ok({
    args: [installed.value, ...(manifest.args ?? [])],
    command: process.execPath,
    env: { ...getWorkspaceConfig().nodeExecEnv },
  });
}

/** Throw away a local server's installed code, for an app being removed. */
export async function removeLocalServer(slug: string): Promise<void> {
  await fs.rm(localServerDir(slug), { force: true, recursive: true });
}

/**
 * The entry file of the installed package: its `bin` (the first, when it
 * declares several), else what it exports. This is the file the registry's own
 * launcher would have run, minus the shim that resolves an interpreter.
 */
async function entryFile(
  dir: AbsolutePath,
  name: string,
): Promise<Result<string, string>> {
  const root = path.join(dir, "node_modules", ...name.split("/"));
  let manifest: {
    bin?: Record<string, string> | string;
    main?: string;
  };
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    ) as typeof manifest;
  } catch (error) {
    return err(
      `Installed ${name} but could not read its package.json: ${message(error)}`,
    );
  }
  const bin =
    typeof manifest.bin === "string"
      ? manifest.bin
      : Object.values(manifest.bin ?? {})[0];
  const entry = bin ?? manifest.main ?? "index.js";
  const resolved = path.join(root, entry);
  if (!(await exists(resolved))) {
    return err(
      `${name} does not ship the entry point it declares (${entry}), so there is nothing to run.`,
    );
  }
  return ok(resolved);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function installNodePackage({
  dir,
  manifest,
  signal,
}: {
  dir: AbsolutePath;
  manifest: LocalMcpAppManifest;
  signal?: AbortSignal;
}): Promise<Result<string, string>> {
  const name = packageName(manifest.package);
  const marker = path.join(dir, INSTALLED_MARKER);
  const alreadyInstalled =
    (await fs.readFile(marker, "utf8").catch(() => null)) === manifest.package;
  if (alreadyInstalled) {
    const entry = await entryFile(dir, name);
    if (entry.isOk()) {
      return entry;
    }
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: `instrument-app-server`, private: true, version: "0.0.0" }, null, 2)}\n`,
  );

  const { nodeExecEnv, pnpmBinPath } = getWorkspaceConfig();
  // pnpm ships as a script for node to run, and the node that runs it is the
  // one this process is: the same way every other install in the app goes out
  // (see run-pnpm.ts), and the reason no `node` has to be on PATH.
  const result = await execa(
    pnpmBinPath,
    ["add", manifest.package, "--ignore-workspace"],
    {
      cancelSignal: signal,
      cwd: dir,
      env: {
        ...nodeExecEnv,
        ...commandLineToolsEnv(),
        // pnpm locates its store through os.homedir(); the real home is where
        // every other install in this app already writes (see run-pnpm.ts).
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        pnpm_config_loglevel: "error",
      },
      node: true,
      nodeOptions: [],
      reject: false,
      timeout: INSTALL_TIMEOUT_MS,
    },
  );
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().slice(-400);
    return err(
      `Could not install ${manifest.package} from npm: ${detail || `pnpm exited ${result.exitCode ?? "without a code"}`}`,
    );
  }

  const entry = await entryFile(dir, name);
  if (entry.isErr()) {
    return entry;
  }
  await fs.writeFile(marker, manifest.package);
  return entry;
}

/** Where one app's installed server lives. */
function localServerDir(slug: string): AbsolutePath {
  return absolutePathJoin(getWorkspaceConfig().rootDir, SERVERS_DIR_NAME, slug);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The package's name without the version an install spec may carry. */
function packageName(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/**
 * uv pinned to the app's own dirs and its managed interpreter, the same way
 * the sandbox's python runs it, minus the per-task virtualenv: a local MCP
 * server belongs to the workspace rather than to whichever task calls it.
 */
function uvEnv(): Record<string, string> {
  const { uvBinPath, uvDataDir } = getWorkspaceConfig();
  return {
    ...commandLineToolsEnv(),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    PATH: [
      path.dirname(uvBinPath),
      ...(process.env.PATH ? [process.env.PATH] : []),
    ].join(path.delimiter),
    TERM: "dumb",
    UV_CACHE_DIR: path.join(uvDataDir, "cache"),
    UV_NO_CONFIG: "1",
    UV_PYTHON_DOWNLOADS: "automatic",
    UV_PYTHON_INSTALL_DIR: path.join(uvDataDir, "python"),
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_TOOL_DIR: path.join(uvDataDir, "tools"),
    XDG_CACHE_HOME: path.join(uvDataDir, "cache-home"),
  };
}
