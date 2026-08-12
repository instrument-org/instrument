/**
 * Reports which macOS Command Line Tools stubs a skill install actually
 * reaches. On a Mac that has never installed the tools, every one of them puts
 * a modal installer dialog on screen and blocks the caller until it is
 * answered, so the list this prints is the list of ways a skill load can hang.
 *
 * The audit runs on a normal developer/CI Mac, where the tools are present and
 * no dialog can appear. Three passes:
 *
 * - `shadow` (default) prepends a directory of logging stubs to PATH, so any
 *   `git`/`make`/`python3`/... resolved by name is recorded and then passed
 *   through to the real binary. The install completes as usual; the log is the
 *   evidence. Exits non-zero on a stub outside EXPECTED_SHIMS.
 * - `developer-dir` points DEVELOPER_DIR at a path that does not exist. Every
 *   stub short-circuits to a hard error instead of resolving a toolchain, which
 *   catches the invocations by absolute path that PATH shadowing cannot see. A
 *   pass that still installs cleanly is a skill that needs nothing from Xcode.
 * - `guarded` makes `xcode-select -p` fail the way it does on a machine that
 *   has never installed the tools, so the product's own guard decides. This is
 *   the end-to-end regression test for that guard, and has to run alone.
 *
 * Exits non-zero on any failed install, unrunnable interpreter, unaccounted
 * stub, or (in `guarded`) a guard that did not engage.
 *
 * Usage:
 *   pnpm script:clt-shim-audit                          # spreadsheet, first two passes
 *   pnpm script:clt-shim-audit -- --skill document-to-markdown
 *   pnpm script:clt-shim-audit -- --skill spreadsheet --skill pdf
 *   pnpm script:clt-shim-audit -- --mode shadow         # one pass only
 *   pnpm script:clt-shim-audit -- --mode guarded        # does the guard engage?
 *   pnpm script:clt-shim-audit -- --keep                # leave the scratch dirs behind
 */

import "dotenv/config";

import "./lib/define-globals-apply";

import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";

import { TASK_FOLDER_NAMES } from "../src/constants";
import {
  commandLineToolsEnv,
  MISSING_DEVELOPER_DIR,
} from "../src/lib/command-line-tools-env";
import { copySkill } from "../src/lib/copy-skill";
import { installPythonSkill } from "../src/lib/install-python-skill";
import { runPnpmCommand } from "../src/lib/run-pnpm";
import { getSkillRuntime } from "../src/lib/skill-runtime";
import { getTaskWorkDir, taskDir } from "../src/lib/task-dir-utils";
import { taskVenvPython } from "../src/lib/uv";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../src/lib/workspace-config";
import { AbsolutePathSchema } from "../src/schemas/paths";
import { TaskIdSchema } from "../src/schemas/task-id";
import {
  CLT_SHIM_NAMES,
  findUnlistedHostShims,
  SAFE_SHIM_INVOCATIONS,
} from "./lib/clt-shims";
import { createStubWorkspaceConfig } from "./lib/stub-workspace-config";

const MODES = ["shadow", "developer-dir", "guarded"] as const;
type Mode = (typeof MODES)[number];

/** `guarded` is opt-in: see the note on the probe cache in `parseArgs`. */
const DEFAULT_MODES: Mode[] = ["shadow", "developer-dir"];

/**
 * Stubs a clean run is known to reach, so anything else is new exposure to
 * reason about rather than noise to skim past. `install_name_tool` is uv
 * relocating the managed interpreter's libpython, which it treats as
 * best-effort; `xcode-select -p` is our own probe, the one stub that reports a
 * missing developer directory instead of offering to install one.
 */
const EXPECTED_SHIMS = new Set(["install_name_tool", "xcode-select"]);

/** Long enough for a cold uv cache to fetch numpy/pandas on a slow connection. */
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

interface ShimInvocation {
  args: string[];
  name: string;
  parent: string;
}

interface SkillResult {
  interpreter?: string;
  node?: { exitCode: number; output: string };
  python?: { output?: string; state: string };
  skill: string;
}

function indent(text: string) {
  return text
    .split("\n")
    .slice(0, 20)
    .map((line) => `    | ${line}`)
    .join("\n");
}

/** Runs the two installs `load_skill` runs, against a throwaway task dir. */
async function installSkill({
  registrySkillsDir,
  skillName,
}: {
  registrySkillsDir: string;
  skillName: string;
}): Promise<SkillResult> {
  const skillDir = AbsolutePathSchema.parse(
    path.join(registrySkillsDir, skillName),
  );
  const runtime = getSkillRuntime(skillDir, skillName);
  if ("error" in runtime) {
    throw new Error(runtime.error);
  }

  const taskId = TaskIdSchema.parse(ulid().toLowerCase());
  const dir = taskDir(taskId);
  await fs.mkdir(dir, { recursive: true });
  // The scaffold initializeTask lays down. `work/` has to arrive from the
  // template: its package.json and pnpm-workspace.yaml are what make the
  // skill's own `pnpm install` a nested workspace install rather than an error.
  await fs.cp(getWorkspaceConfig().defaultTaskTemplateDir, dir, {
    force: false,
    recursive: true,
  });
  for (const folder of [
    TASK_FOLDER_NAMES.attachments,
    TASK_FOLDER_NAMES.output,
    TASK_FOLDER_NAMES.work,
  ]) {
    await fs.mkdir(path.join(dir, folder), { recursive: true });
  }

  const signal = AbortSignal.timeout(INSTALL_TIMEOUT_MS);
  const { destDir } = await copySkill({
    dir,
    signal,
    skillDir,
    skillName,
    skillSource: "system",
  });

  const result: SkillResult = { skill: skillName };

  if (runtime.node) {
    const { combined, exitCode } = await runPnpmCommand({
      args: ["install"],
      cwd: getTaskWorkDir(dir),
      signal,
      taskId,
    });
    result.node = { exitCode, output: combined };
  }

  if (runtime.python) {
    const installed = await installPythonSkill({
      signal,
      skillDir: destDir,
      taskId,
    });
    result.python =
      installed.state === "success"
        ? { state: "success" }
        : {
            output: installed.output,
            state: `failure (${installed.exitCode})`,
          };

    if (installed.state === "success") {
      // uv patches the managed interpreter's dylib install name with
      // install_name_tool, which is one of the stubs. Running the interpreter is
      // what proves the install survives that step being unavailable.
      const probe = await execa(
        taskVenvPython(taskId),
        ["-c", "import sys; print(sys.version.split()[0])"],
        { all: true, reject: false },
      );
      result.interpreter =
        probe.exitCode === 0
          ? `runs (${probe.stdout.trim()})`
          : `BROKEN: ${probe.all.trim()}`;
    }
  }

  return result;
}

function parseArgs(argv: string[]) {
  let keep = false;
  const modes: Mode[] = [];
  const skills: string[] = [];

  const remaining = [...argv];
  while (remaining.length > 0) {
    const arg = remaining.shift();
    switch (arg) {
      // pnpm forwards its own `--` separator.
      case "--":
      case undefined: {
        break;
      }
      case "--keep": {
        keep = true;
        break;
      }
      case "--mode": {
        const value = remaining.shift();
        const mode = MODES.find((candidate) => candidate === value);
        if (mode === undefined) {
          throw new Error(`--mode must be one of: ${MODES.join(", ")}`);
        }
        modes.push(mode);
        break;
      }
      case "--skill": {
        const skill = remaining.shift();
        if (skill !== undefined) {
          skills.push(skill);
        }
        break;
      }
      default: {
        throw new Error(`unknown argument: ${arg}`);
      }
    }
  }

  // commandLineToolsEnv caches its probe for the life of the process, so the
  // first pass decides what every later pass sees. Only `guarded` depends on
  // that answer, so it is the one mode that has to run on its own.
  if (modes.includes("guarded") && modes.length > 1) {
    throw new Error("--mode guarded cannot be combined with another mode");
  }

  return {
    keep,
    modes: modes.length > 0 ? modes : DEFAULT_MODES,
    skills: skills.length > 0 ? skills : ["spreadsheet"],
  };
}

async function readShimLog(logPath: string): Promise<ShimInvocation[]> {
  const raw = await fs.readFile(logPath, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [name = "", parent = "", ...args] = line.split("\t");
      return { args, name, parent };
    });
}

function reportInstall(result: SkillResult) {
  const lines: string[] = [];
  if (result.node) {
    lines.push(
      `  pnpm install: ${result.node.exitCode === 0 ? "ok" : `FAILED (exit ${result.node.exitCode})`}`,
    );
    if (result.node.exitCode !== 0) {
      lines.push(indent(result.node.output));
    }
  }
  if (result.python) {
    lines.push(`  uv install:   ${result.python.state}`);
    if (result.python.output) {
      lines.push(indent(result.python.output));
    }
  }
  if (result.interpreter) {
    lines.push(`  interpreter:  ${result.interpreter}`);
  }
  return lines.join("\n");
}

function reportShims(invocations: ShimInvocation[]) {
  if (invocations.length === 0) {
    return "  no Command Line Tools stub was invoked";
  }

  const byName = new Map<string, ShimInvocation[]>();
  for (const invocation of invocations) {
    byName.set(invocation.name, [
      ...(byName.get(invocation.name) ?? []),
      invocation,
    ]);
  }

  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([name, calls]) => {
      const safeArgs = SAFE_SHIM_INVOCATIONS[name];
      const benign =
        safeArgs !== undefined &&
        calls.every((call) => call.args.every((arg) => safeArgs.includes(arg)));
      return [
        `  ${name} (${calls.length}x)${benign ? " -- probe only, never prompts" : ""}`,
        ...calls.slice(0, 5).map((call) => {
          const args = call.args.join(" ");
          return `    from ${call.parent || "?"}: ${name}${args ? ` ${args}` : ""}`;
        }),
        ...(calls.length > 5 ? [`    ... ${calls.length - 5} more`] : []),
      ];
    })
    .join("\n");
}

/**
 * The binaries Studio ships, not whatever the developer has on PATH. `pnpm` in
 * particular has to be the `.mjs` entry, because the workspace forks it with
 * node the same way the app does.
 */
async function resolveBundledBinary(bundled: string, fallbackName: string) {
  const exists = await fs
    .access(bundled)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    return AbsolutePathSchema.parse(bundled);
  }
  const { stdout } = await execa("which", [fallbackName], { reject: false });
  return AbsolutePathSchema.parse(stdout.trim() || `/usr/bin/${fallbackName}`);
}

/**
 * A stub per shim name that records the call and then hands off to the real
 * binary, so the install proceeds normally and the audit sees every invocation
 * rather than only the first.
 */
async function writeShimStubs({
  binDir,
  hideDeveloperDirectory = false,
  logPath,
}: {
  binDir: string;
  /**
   * Make `xcode-select -p` fail the way it does on a Mac that has never
   * installed the tools, so the product's own probe -- not the audit -- decides
   * the developer directory is missing.
   */
  hideDeveloperDirectory?: boolean;
  logPath: string;
}) {
  await fs.mkdir(binDir, { recursive: true });

  await Promise.all(
    CLT_SHIM_NAMES.map(async (name) => {
      const real = path.join("/usr/bin", name);
      const handoff =
        hideDeveloperDirectory && name === "xcode-select"
          ? [
              "echo 'xcode-select: error: unable to get active developer directory' >&2",
              "exit 2",
            ]
          : [`if [ -x '${real}' ]; then exec '${real}' "$@"; fi`, "exit 127"];
      const script = [
        "#!/bin/sh",
        "{",
        `  printf '%s\\t%s' '${name}' "$(ps -o comm= -p "$PPID" 2>/dev/null | sed 's|.*/||')"`,
        `  for arg in "$@"; do printf '\\t%s' "$arg"; done`,
        "  printf '\\n'",
        `} >> '${logPath}'`,
        ...handoff,
        "",
      ].join("\n");
      const stubPath = path.join(binDir, name);
      await fs.writeFile(stubPath, script, { mode: 0o755 });
    }),
  );
}

const args = parseArgs(process.argv.slice(2));

if (process.platform !== "darwin") {
  throw new Error("clt-shim-audit only means anything on macOS.");
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const registrySkillsDir = path.join(repoRoot, "registry", "skills");

const unlisted = await findUnlistedHostShims();
if (unlisted.length > 0) {
  process.stderr.write(
    `warning: this macOS ships stubs not in CLT_SHIM_NAMES: ${unlisted.join(", ")}\n\n`,
  );
}

const uvBinPath = await resolveBundledBinary(
  path.join(repoRoot, "apps/studio/resources/uv/uv"),
  "uv",
);
const pnpmBinPath = await resolveBundledBinary(
  path.join(repoRoot, "apps/studio/node_modules/pnpm/bin/pnpm.mjs"),
  "pnpm",
);
const originalPath = process.env.PATH ?? "";

let failures = 0;

for (const mode of args.modes) {
  // A cold uv cache and pnpm store per pass. A warm one skips the downloads,
  // and with them every subprocess the audit exists to observe.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `clt-audit-${mode}-`));
  const logPath = path.join(root, "shims.log");
  const binDir = path.join(root, "shim-bin");

  process.env.PATH = originalPath;
  delete process.env.DEVELOPER_DIR;

  if (mode === "developer-dir") {
    process.env.DEVELOPER_DIR = MISSING_DEVELOPER_DIR;
  } else {
    await writeShimStubs({
      binDir,
      hideDeveloperDirectory: mode === "guarded",
      logPath,
    });
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  }

  setWorkspaceConfig({
    ...createStubWorkspaceConfig({ tasksDir: path.join(root, "tasks") }),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.join(repoRoot, "packages/workspace/templates/default"),
    ),
    pnpmBinPath,
    uvBinPath,
  });
  await fs.mkdir(path.join(root, "tasks"), { recursive: true });

  process.stdout.write(`\n=== pass: ${mode} ===\n`);
  if (mode === "developer-dir") {
    process.stdout.write(`DEVELOPER_DIR=${MISSING_DEVELOPER_DIR}\n`);
  }
  if (mode === "guarded") {
    // What the product decided on its own, with xcode-select reporting nothing.
    const guard = commandLineToolsEnv();
    if (Object.keys(guard).length > 0) {
      process.stdout.write(
        `guard engaged: ${Object.entries(guard)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")}\n`,
      );
    } else {
      failures++;
      process.stdout.write(
        "guard DID NOT ENGAGE -- the probe still sees a developer directory\n",
      );
    }
  }
  process.stdout.write(`scratch: ${root}\n`);

  for (const skillName of args.skills) {
    process.stdout.write(`\n${skillName}\n`);
    try {
      const result = await installSkill({ registrySkillsDir, skillName });
      const installReport = reportInstall(result);
      if (installReport) {
        process.stdout.write(`${installReport}\n`);
      }
      // Independent conditions: a skill that installs its Node half and fails
      // its Python half is still a failure, as is one that installs both and
      // leaves an interpreter that cannot run.
      if (result.node !== undefined && result.node.exitCode !== 0) {
        failures++;
      }
      if (result.python?.state.startsWith("failure")) {
        failures++;
      }
      if (result.interpreter?.startsWith("BROKEN")) {
        failures++;
      }
    } catch (error) {
      failures++;
      process.stdout.write(
        `  install threw: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  if (mode !== "developer-dir") {
    const invocations = await readShimLog(logPath);
    process.stdout.write(`\nCommand Line Tools stubs reached:\n`);
    process.stdout.write(`${reportShims(invocations)}\n`);

    const unexpected = [
      ...new Set(
        invocations
          .map(({ name }) => name)
          .filter((name) => !EXPECTED_SHIMS.has(name)),
      ),
    ];
    if (unexpected.length > 0) {
      failures++;
      process.stdout.write(
        `\nUNEXPECTED: ${unexpected.join(", ")} -- a stub no previous run reached. ` +
          `On a Mac without the Command Line Tools this is a new way for the ` +
          `installer dialog to appear. Work out who calls it before adding it ` +
          `to EXPECTED_SHIMS.\n`,
      );
    }
  }

  if (!args.keep) {
    await fs.rm(root, { force: true, recursive: true });
  }
}

process.env.PATH = originalPath;
delete process.env.DEVELOPER_DIR;
process.exitCode = failures > 0 ? 1 : 0;
