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
 *   has never installed the tools, then sets the guard on this process with
 *   `applyCommandLineToolsEnv`, as Studio's startup does. Every stub reached
 *   afterwards, by the install and by a `make` run through `execShim` the way
 *   the agent's shell runs one, must see the guard's DEVELOPER_DIR. Then a
 *   real chat shell must refuse `make`, `/usr/bin/make`, `xcrun` and `env
 *   make` and have `which` say they need the tools, without reaching a stub,
 *   and a program it starts must be refused the installer service, the one
 *   check that holds for a child that clears its environment (skipped where
 *   no GUI session offers the service at all, as on a CI runner). This is the
 *   end-to-end regression test for the boundary, and has to run alone.
 *
 * Exits non-zero on any failed install, unrunnable interpreter, unaccounted
 * stub, or (in `guarded`) a guard that did not engage or a stub reached
 * without it.
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

import { CHAT_FOLDER_NAMES } from "../src/constants";
import {
  applyCommandLineToolsEnv,
  COMMAND_LINE_TOOLS_INSTALLER,
  MISSING_DEVELOPER_DIR,
} from "../src/lib/command-line-tools-env";
import { copySkill } from "../src/lib/copy-skill";
import { createBashEnv } from "../src/lib/create-bash-env";
import { seatbeltAvailable } from "../src/lib/native-sandbox";
import { installPythonSkill } from "../src/lib/install-python-skill";
import { runPnpmCommand } from "../src/lib/run-pnpm";
import { execShim } from "../src/lib/shell-commands/exec-shim";
import { getSkillRuntime } from "../src/lib/skill-runtime";
import { placeChat } from "../src/lib/record-folders";
import { chatVenvPython, uvSubprocessEnv } from "../src/lib/uv";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../src/lib/workspace-config";
import { AbsolutePathSchema } from "../src/schemas/paths";
import { StoreId } from "../src/schemas/store-id";
import { ChatIdSchema } from "../src/schemas/chat-id";
import {
  CLT_SHIM_NAMES,
  compareHostShims,
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
  /** The DEVELOPER_DIR the stub was handed, empty when it had none. */
  developerDir: string;
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

/** A chat folder from the template, as initializeTask lays one down. */
async function placeAuditChat() {
  const chatId = ChatIdSchema.parse(ulid().toLowerCase());
  // Put in the chat index, so every later lookup of the id finds its folder.
  const sessionId = StoreId.newSessionId();
  const dir = placeChat(chatId, sessionId);
  await fs.mkdir(dir, { recursive: true });
  // `work/` has to arrive from the template: its package.json and
  // pnpm-workspace.yaml are what make the skill's own `pnpm install` a nested
  // workspace install rather than an error.
  await fs.cp(getWorkspaceConfig().chatTemplateDir, dir, {
    force: false,
    recursive: true,
  });
  for (const folder of [
    CHAT_FOLDER_NAMES.attachments,
    CHAT_FOLDER_NAMES.work,
  ]) {
    await fs.mkdir(path.join(dir, folder), { recursive: true });
  }
  return { chatId, dir, sessionId };
}

/**
 * Runs `make`, a stub, the two ways a chat's shell hands a native command its
 * env: with the overlay the python, pip, and git commands pass, and with only
 * what `execShim` inherits from this process, which is all a command found by
 * PATH fall-through or a user app's process gets.
 */
async function probeShellStubs() {
  const { chatId, dir } = await placeAuditChat();
  for (const env of [uvSubprocessEnv({ chatId }), undefined]) {
    await execShim("make", ["--version"], {
      cwd: dir,
      ...(env ? { env } : {}),
    });
  }
}

/**
 * Does the mach-lookup of the installer service a stub makes, as Python's
 * ctypes can, and prints the kern_return_t: 0 is a port, anything else is
 * no service to ask.
 */
const INSTALLER_LOOKUP = [
  "import ctypes, sys",
  'lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")',
  "port = ctypes.c_uint(0)",
  'print(lib.bootstrap_look_up(ctypes.c_uint.in_dll(lib, "bootstrap_port"), sys.argv[1].encode(), ctypes.byref(port)))',
].join("\n");

/**
 * The boundary on a Mac without the tools, through a real chat shell: the
 * shell refuses a stub by bare name, by path, through `xcrun` and `env`, and
 * `which` says it needs the tools, none of it reaching the stub; and a program
 * the shell starts cannot ask for the installer, the case a child that clears
 * its environment leaves to the sandbox alone. Returns the failures.
 */
async function probeBoundary(logPath: string) {
  const { chatId, sessionId } = await placeAuditChat();
  const bash = await createBashEnv({
    chatId,
    sessionId,
  });
  const before = (await readShimLog(logPath)).length;
  let failed = 0;
  const report = (ok: boolean, line: string) => {
    if (!ok) {
      failed++;
    }
    process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${line}\n`);
  };

  process.stdout.write("\nshell boundary:\n");
  for (const command of [
    "make --version",
    "/usr/bin/make --version",
    "xcrun --find clang",
    "env make --version",
    "which make",
  ]) {
    const result = await bash.exec(command);
    report(
      result.stderr.includes("needs Apple's Command Line Tools") &&
        result.exitCode !== 0,
      `${command}: ${result.stderr.trim().split("\n")[0] ?? `exit ${result.exitCode}`}`,
    );
  }
  // xcode-select is the recheck asking whether the tools arrived since.
  const reached = (await readShimLog(logPath))
    .slice(before)
    .filter(({ name }) => name !== "xcode-select");
  report(
    reached.length === 0,
    `stubs reached through the refusals: ${reached.map(({ name }) => name).join(", ") || "none"}`,
  );

  // The sandbox's half needs a Python; the chat's is the one a script runs.
  const lookup = `python3 -c '${INSTALLER_LOOKUP}' ${COMMAND_LINE_TOOLS_INSTALLER}`;
  const wrapped = await bash.exec(lookup);
  const unwrapped = await execa(
    chatVenvPython(chatId),
    ["-c", INSTALLER_LOOKUP, COMMAND_LINE_TOOLS_INSTALLER],
    { reject: false },
  );
  if (!seatbeltAvailable()) {
    process.stdout.write(
      "  skip installer service: Seatbelt cannot be applied from this process\n",
    );
  } else if (unwrapped.stdout.trim() !== "0") {
    // Without a GUI session (a CI runner) the service is not in reach of
    // anything, so a refusal inside the sandbox would prove nothing.
    process.stdout.write(
      `  skip installer service: not reachable outside the sandbox either (${unwrapped.stdout.trim() || unwrapped.stderr.trim()})\n`,
    );
  } else {
    report(
      wrapped.exitCode === 0 && wrapped.stdout.trim() !== "0",
      `installer service from inside the sandbox: ${wrapped.stdout.trim() || wrapped.stderr.trim()} (0 outside it)`,
    );
  }
  return failed;
}

/** Runs the two installs `load_skill` runs, against a throwaway chat folder. */
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

  const { chatId, dir } = await placeAuditChat();

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
    const { exitCode, stderr, stdout } = await runPnpmCommand({
      args: ["install"],
      cwd: dir,
      signal,
      chatId,
    });
    result.node = { exitCode, output: stdout + stderr };
  }

  if (runtime.python) {
    const installed = await installPythonSkill({
      signal,
      skillDir: destDir,
      chatId,
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
        chatVenvPython(chatId),
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
      const [name = "", parent = "", developerDir = "", ...args] =
        line.split("\t");
      return { args, developerDir, name, parent };
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
        // Carries the symbol a real stub imports, so the shell takes this
        // stand-in for one as it would the stub it shadows.
        "# _xcselect_invoke_xcrun",
        "{",
        `  printf '%s\\t%s\\t%s' '${name}' "$(ps -o comm= -p "$PPID" 2>/dev/null | sed 's|.*/||')" "$DEVELOPER_DIR"`,
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

const { notStubs, unlisted } = await compareHostShims();
if (unlisted.length > 0) {
  process.stderr.write(
    `warning: this macOS ships stubs not in CLT_SHIM_NAMES: ${unlisted.join(", ")}\n\n`,
  );
}

let failures = 0;

// The shell refuses a stub by what isCommandLineToolsStub reads off the
// binary, so a listed name it no longer recognizes is a stub the agent would
// run, and on a Mac without the tools only the sandbox would stop it.
if (notStubs.length > 0) {
  failures++;
  process.stderr.write(
    `isCommandLineToolsStub does not recognize these listed stubs on this macOS: ${notStubs.join(", ")}\n\n`,
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
    chatTemplateDir: AbsolutePathSchema.parse(
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
    // What the product decided on its own, with xcode-select reporting
    // nothing, set where Studio sets it: on the process every spawn descends
    // from, so the passes below see what the app's subprocesses would.
    applyCommandLineToolsEnv();
    if (process.env.DEVELOPER_DIR === MISSING_DEVELOPER_DIR) {
      process.stdout.write(
        `guard engaged: DEVELOPER_DIR=${MISSING_DEVELOPER_DIR} CC=${process.env.CC ?? "unset"} CXX=${process.env.CXX ?? "unset"}\n`,
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

    if (mode === "guarded") {
      // Read after the install's report, so the stubs this probe reaches on
      // purpose are not counted against EXPECTED_SHIMS.
      await probeShellStubs();
      const probed = (await readShimLog(logPath)).slice(invocations.length);
      process.stdout.write(`\nshell probe (make --version via execShim):\n`);
      process.stdout.write(`${reportShims(probed)}\n`);
      if (probed.length < 2) {
        failures++;
        process.stdout.write(
          "shell probe DID NOT REACH the make stub -- the check proved nothing\n",
        );
      }

      failures += await probeBoundary(logPath);

      // xcode-select is the guard's own probe, which runs before the guard
      // exists and never prompts.
      const unguarded = [...invocations, ...probed].filter(
        ({ developerDir, name }) =>
          name !== "xcode-select" && developerDir !== MISSING_DEVELOPER_DIR,
      );
      if (unguarded.length > 0) {
        failures++;
        process.stdout.write(
          `\nUNGUARDED: ${unguarded
            .map(
              ({ developerDir, name, parent }) =>
                `${name} from ${parent || "?"} (DEVELOPER_DIR=${developerDir || "unset"})`,
            )
            .join(", ")} -- on a Mac without the Command Line Tools each of ` +
            `these opens the installer dialog. The guard is on this process, ` +
            `so the spawn site's env dropped it.\n`,
        );
      }
    }
  }

  if (!args.keep) {
    await fs.rm(root, { force: true, recursive: true });
  }
}

process.env.PATH = originalPath;
delete process.env.DEVELOPER_DIR;
process.exitCode = failures > 0 ? 1 : 0;
